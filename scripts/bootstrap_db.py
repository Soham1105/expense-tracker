import os
import sys
from urllib.parse import urlparse

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT


ROOT_DIR = os.path.dirname(os.path.dirname(__file__))
APP_DIR = os.path.join(ROOT_DIR, "app")
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

from core.database import DATABASE_URL, SessionLocal  # noqa: E402
from repositories.transaction_split_repo import ensure_split_tables  # noqa: E402
from repositories.planning_repo import ensure_planning_tables  # noqa: E402


def build_admin_dsn(parsed_url):
    admin_db = os.getenv("POSTGRES_ADMIN_DB", "postgres")
    return (
        f"dbname={admin_db} "
        f"user={parsed_url.username or ''} "
        f"password={parsed_url.password or ''} "
        f"host={parsed_url.hostname or 'localhost'} "
        f"port={parsed_url.port or 5432}"
    )


def build_target_db_name(parsed_url):
    return (parsed_url.path or "/expense_tracker").lstrip("/") or "expense_tracker"


def ensure_database_exists():
    parsed = urlparse(DATABASE_URL)
    target_db = build_target_db_name(parsed)
    admin_dsn = build_admin_dsn(parsed)

    conn = psycopg2.connect(admin_dsn)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target_db,))
            exists = cur.fetchone() is not None
            if not exists:
                cur.execute(f'CREATE DATABASE "{target_db}"')
                print(f"Created database: {target_db}")
            else:
                print(f"Database already exists: {target_db}")
    finally:
        conn.close()


def ensure_schema():
    db = SessionLocal()
    try:
        ensure_split_tables(db)
        ensure_planning_tables(db)
        print("Split schema synced successfully.")
    finally:
        db.close()


if __name__ == "__main__":
    ensure_database_exists()
    ensure_schema()
