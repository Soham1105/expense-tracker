"""Password gate for the whole app.

Adds simple HTTP Basic authentication in front of every request — both the
JSON API and the static frontend served at ``/`` — so that once the app is
hosted publicly only someone with the credentials can reach your financial
data.

Credentials come from environment variables:

    APP_USERNAME   (default: "admin")
    APP_PASSWORD   (required to enable auth)

If ``APP_PASSWORD`` is not set, authentication is DISABLED. This keeps local
development frictionless — set the variable only in the hosted environment.
"""

from __future__ import annotations

import base64
import binascii
import os
import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": 'Basic realm="Expense Tracker"'}


class BasicAuthMiddleware(BaseHTTPMiddleware):
    """Reject any request that doesn't carry the right Basic-Auth credentials."""

    def __init__(self, app):
        super().__init__(app)
        self._username = os.getenv("APP_USERNAME", "admin")
        self._password = os.getenv("APP_PASSWORD")
        # Auth is only enforced when a password is configured.
        self._enabled = bool(self._password)

    async def dispatch(self, request, call_next):
        if not self._enabled:
            return await call_next(request)

        if self._is_authorized(request.headers.get("Authorization")):
            return await call_next(request)

        return Response(status_code=401, headers=_UNAUTHORIZED_HEADERS)

    def _is_authorized(self, header_value: str | None) -> bool:
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

        # Constant-time comparison to avoid leaking length/content via timing.
        user_ok = secrets.compare_digest(username, self._username)
        pass_ok = secrets.compare_digest(password, self._password or "")
        return user_ok and pass_ok
