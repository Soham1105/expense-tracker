# Deploying the Expense Tracker (Supabase + Render)

This app is now ready to host: the database URL is configurable via environment
variables, the whole app is password-protected, and it ships with a Dockerfile
that includes Tesseract OCR for the "Scan Bill" feature.

**Architecture:** Supabase (managed Postgres) + Render (runs the FastAPI Docker
container) + HTTP Basic password login.

---

## Step 1 — Create the Supabase database

1. Sign up at https://supabase.com and create a new project. Save the database
   password it gives you.
2. Go to **Project Settings → Database → Connection string** and copy the
   **URI** under **Connection pooling** (Transaction mode, port `6543`).
3. Turn it into a SQLAlchemy URL for this app:
   - change the scheme `postgresql://` → `postgresql+psycopg2://`
   - append `?sslmode=require`

   Result looks like:
   ```
   postgresql+psycopg2://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
   ```

## Step 2 — Load your existing data into Supabase

Your data is in `expense_tracker.sql` (a pg_dump custom-format file). From this
folder, using the **direct** connection (port `5432`, not the pooler) so
DDL/restore works cleanly:

```bash
pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require" \
  "../../expense_tracker.sql"
```

Notes:
- Restores into Supabase's existing `postgres` database, `public` schema.
- A few harmless errors about `SCHEMA public`/roles already existing are normal.
- Verify in the Supabase Table Editor that your tables and rows are present.

## Step 3 — Push the code to GitHub

From this folder (`June/expense_tracker/`):

```bash
git init
git add .
git commit -m "Prepare expense tracker for hosting"
git branch -M main
git remote add origin https://github.com/<you>/expense-tracker.git
git push -u origin main
```

The `.gitignore` already excludes `*.sql` (your financial data), `.env`, the
`.venv`, and logs — none of those get committed.

## Step 4 — Deploy on Render

1. Sign up at https://render.com and connect your GitHub account.
2. **New → Blueprint**, pick the repo (it reads `render.yaml`), or
   **New → Web Service → Docker** if you prefer manual setup.
3. Set these environment variables (Render dashboard → Environment):
   | Key            | Value                                              |
   |----------------|----------------------------------------------------|
   | `DATABASE_URL` | the Supabase pooler URL from Step 1                |
   | `APP_USERNAME` | your chosen login name                             |
   | `APP_PASSWORD` | a strong password                                  |
4. Deploy. Render builds the Docker image and gives you an HTTPS URL.

## Step 5 — Verify

- Open the Render URL → the browser prompts for username/password.
- Wrong credentials → rejected (401). Correct → dashboard loads with your data.
- Try **Scan Bill** to confirm OCR works in the container.
- Check Render logs for a clean startup (no DB connection errors).

---

## Local development

Nothing changed for local runs. Without `APP_PASSWORD` set, the login is
disabled and the app uses the local Postgres default. To test the hosted setup
locally, copy `.env.example` to `.env`, fill it in, and run from `app/`:

```bash
cd app
uvicorn main:app --reload --port 8001
```

## Notes / gotchas

- **Render free web services sleep when idle** — the first request after a
  while is slow to wake. Railway (usage-billed) avoids this; the same Dockerfile
  works there.
- **Free Postgres has few connections** — this is why we use the Supabase
  connection pooler and a small SQLAlchemy pool (`DB_POOL_SIZE`).
- **Never commit `expense_tracker.sql` or `.env`** — they hold real financial
  data / secrets. `.gitignore` guards against this.
- HTTP Basic sends credentials on every request; safe over Render's HTTPS. A
  nicer session-based login page can be added later if you want.
