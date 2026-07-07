from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from routers import upload, reports, classification, planning, transactions
from routers.trends import trends_router
from routers.transaction_groups import groups_router

from fastapi.staticfiles import StaticFiles
from pathlib import Path
from core.database import SessionLocal
from repositories.transaction_split_repo import ensure_split_tables
from repositories.category_repo import ensure_category_tables, ensure_tag_tables, sync_category_tags
from repositories.planning_repo import ensure_planning_tables
from repositories.transaction_repo import ensure_transaction_source_columns
from repositories.transaction_search import ensure_transaction_source_columns as ensure_transaction_source_columns_extended
from repositories.seed_repo import ensure_seed_data
from repositories.networth_repo import save_net_worth_snapshot
from repositories.transaction_group_repo import ensure_group_tables
from repositories.tag_rules_repo import ensure_tag_rules_tables
from routers.tag_rules import tag_rules_router
from core.auth import BasicAuthMiddleware

BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        ensure_transaction_source_columns(db)
        ensure_transaction_source_columns_extended(db)
        ensure_split_tables(db)
        ensure_category_tables(db)
        ensure_tag_tables(db)
        ensure_planning_tables(db)
        ensure_seed_data(db)
        sync_category_tags(db)
        save_net_worth_snapshot(db)
        ensure_group_tables(db)
        ensure_tag_rules_tables(db)
    finally:
        db.close()
    yield


app = FastAPI(lifespan=lifespan)

# Password-protect the entire app (API + static frontend). Enforced only when
# APP_PASSWORD is set in the environment, so local dev stays frictionless.
app.add_middleware(BasicAuthMiddleware)

# Compress JSON/HTML responses — some pages ship 90KB+ payloads, which matters
# when the user is far from the server.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.include_router(upload.router)
app.include_router(reports.report_router)
app.include_router(classification.classification_router)
app.include_router(planning.planning_router)
app.include_router(transactions.router)
app.include_router(trends_router)
app.include_router(groups_router)
app.include_router(tag_rules_router)

app.mount("/", StaticFiles(directory=str(BASE_DIR / "templates"), html=True), name="templates")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=True)
