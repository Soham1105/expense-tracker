"""Login gate for the whole app.

Serves a real login page at ``/login`` and protects every other route — both
the JSON API and the static frontend — with a signed, HttpOnly session cookie.
Sign in once and stay signed in for 30 days; no browser Basic-Auth popups.

HTTP Basic credentials are still accepted as a fallback so curl/scripts can
call the API directly.

Credentials come from environment variables:

    APP_USERNAME     (default: "admin")
    APP_PASSWORD     (required to enable auth)
    SESSION_SECRET   (optional; defaults to a hash of the credentials, so
                      changing the password signs everyone out)

If ``APP_PASSWORD`` is not set, authentication is DISABLED. This keeps local
development frictionless — set the variable only in the hosted environment.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import secrets
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse

SESSION_COOKIE = "et_session"
SESSION_MAX_AGE = 30 * 24 * 3600  # 30 days

LOGIN_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Expense Tracker</title>
<style>
  :root {{
    --bg: #f1f5f9; --card: #ffffff; --text: #0f172a; --muted: #64748b;
    --border: #e2e8f0; --primary: #607AFB; --error-bg: #fef2f2;
    --error-border: #fecaca; --error-text: #b91c1c;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --muted: #94a3b8;
      --border: #334155; --error-bg: #7f1d1d22; --error-border: #b91c1c66;
      --error-text: #fca5a5;
    }}
  }}
  * {{ box-sizing: border-box; margin: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }}
  .card {{
    background: var(--card); border: 1px solid var(--border);
    border-radius: 20px; padding: 36px 32px; width: 100%; max-width: 380px;
    box-shadow: 0 10px 30px rgba(2, 6, 23, .08);
  }}
  .logo {{ font-size: 40px; text-align: center; }}
  h1 {{ font-size: 20px; font-weight: 700; text-align: center; margin: 10px 0 2px; }}
  .sub {{ font-size: 13px; color: var(--muted); text-align: center; margin-bottom: 24px; }}
  label {{
    display: block; font-size: 11px; font-weight: 700; letter-spacing: .12em;
    text-transform: uppercase; color: var(--muted); margin: 14px 0 6px;
  }}
  input {{
    width: 100%; padding: 11px 14px; font-size: 15px; color: var(--text);
    background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
    outline: none; transition: border-color .15s, box-shadow .15s;
  }}
  input:focus {{ border-color: var(--primary); box-shadow: 0 0 0 3px #607afb33; }}
  button {{
    width: 100%; margin-top: 22px; padding: 12px; font-size: 15px; font-weight: 600;
    color: #fff; background: var(--primary); border: 0; border-radius: 12px;
    cursor: pointer; transition: filter .15s;
  }}
  button:hover {{ filter: brightness(1.08); }}
  .error {{
    background: var(--error-bg); border: 1px solid var(--error-border);
    color: var(--error-text); font-size: 13px; border-radius: 10px;
    padding: 10px 12px; margin-bottom: 6px; text-align: center;
  }}
</style>
</head>
<body>
  <form class="card" method="post" action="/login">
    <div class="logo">💰</div>
    <h1>Expense Tracker</h1>
    <p class="sub">Sign in to view your finances</p>
    {error_block}
    <label for="username">Username</label>
    <input id="username" name="username" autocomplete="username" autofocus required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>"""

ERROR_BLOCK = '<div class="error">Wrong username or password. Try again.</div>'


def _session_secret() -> bytes:
    explicit = os.getenv("SESSION_SECRET")
    if explicit:
        return explicit.encode("utf-8")
    seed = f"{os.getenv('APP_USERNAME', 'admin')}:{os.getenv('APP_PASSWORD', '')}"
    return hashlib.sha256(seed.encode("utf-8")).digest()


def make_session_token() -> str:
    expiry = int(time.time()) + SESSION_MAX_AGE
    signature = hmac.new(_session_secret(), str(expiry).encode(), hashlib.sha256).hexdigest()
    return f"{expiry}.{signature}"


def verify_session_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    expiry_text, _, signature = token.partition(".")
    if not expiry_text.isdigit() or int(expiry_text) < time.time():
        return False
    expected = hmac.new(_session_secret(), expiry_text.encode(), hashlib.sha256).hexdigest()
    return secrets.compare_digest(signature, expected)


class AuthMiddleware(BaseHTTPMiddleware):
    """Session-cookie login for browsers, Basic-Auth fallback for scripts."""

    def __init__(self, app):
        super().__init__(app)
        self._username = os.getenv("APP_USERNAME", "admin")
        self._password = os.getenv("APP_PASSWORD")
        # Auth is only enforced when a password is configured.
        self._enabled = bool(self._password)

    async def dispatch(self, request, call_next):
        if not self._enabled:
            return await call_next(request)

        path = request.url.path

        if path == "/login":
            if request.method == "POST":
                return await self._handle_login(request)
            return HTMLResponse(LOGIN_PAGE.format(error_block=""))

        if path == "/logout":
            response = RedirectResponse("/login", status_code=303)
            response.delete_cookie(SESSION_COOKIE)
            return response

        if verify_session_token(request.cookies.get(SESSION_COOKIE)):
            return await call_next(request)

        if self._basic_auth_ok(request.headers.get("Authorization")):
            return await call_next(request)

        # Browser page navigations go to the login form; API/JS calls get 401
        # JSON so fetch() callers fail fast instead of parsing an HTML page.
        if "text/html" in (request.headers.get("accept") or ""):
            return RedirectResponse("/login", status_code=303)
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)

    async def _handle_login(self, request):
        form = await request.form()
        username = str(form.get("username") or "")
        password = str(form.get("password") or "")

        user_ok = secrets.compare_digest(username, self._username)
        pass_ok = secrets.compare_digest(password, self._password or "")
        if not (user_ok and pass_ok):
            return HTMLResponse(LOGIN_PAGE.format(error_block=ERROR_BLOCK), status_code=401)

        response = RedirectResponse("/", status_code=303)
        response.set_cookie(
            SESSION_COOKIE,
            make_session_token(),
            max_age=SESSION_MAX_AGE,
            httponly=True,
            samesite="lax",
            secure=self._request_is_https(request),
        )
        return response

    @staticmethod
    def _request_is_https(request) -> bool:
        forwarded_proto = (request.headers.get("x-forwarded-proto") or "").lower()
        return request.url.scheme == "https" or forwarded_proto == "https"

    def _basic_auth_ok(self, header_value: str | None) -> bool:
        if not header_value:
            return False
        scheme, _, encoded = header_value.partition(" ")
        if scheme.lower() != "basic" or not encoded:
            return False
        try:
            decoded = base64.b64decode(encoded).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            return False
        username, _, password = decoded.partition(":")
        user_ok = secrets.compare_digest(username, self._username)
        pass_ok = secrets.compare_digest(password, self._password or "")
        return user_ok and pass_ok


# Backwards-compatible alias (main.py originally imported this name).
BasicAuthMiddleware = AuthMiddleware
