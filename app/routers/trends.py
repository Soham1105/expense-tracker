from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.database import get_db
from sqlalchemy import text

from repositories.trends_repo import (
    get_merchant_insights,
    get_monthly_trends,
    get_spending_by_category,
    get_spending_by_source,
    get_subcategory_breakdown,
)

trends_router = APIRouter(prefix="/reports", tags=["trends"])


@trends_router.get("/trends/monthly")
def monthly_trends(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    data = get_monthly_trends(db, from_date=from_date, to_date=to_date, source=source, tag=tag)
    return {"success": True, "data": data}


@trends_router.get("/trends/by_category")
def spending_by_category(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    tag_type: Optional[str] = Query(None, description="Filter tags by type e.g. CATEGORY or VENDOR"),
    db: Session = Depends(get_db),
):
    data = get_spending_by_category(db, from_date=from_date, to_date=to_date, tag_type=tag_type)
    return {"success": True, "data": data}


@trends_router.get("/trends/by_source")
def spending_by_source(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    data = get_spending_by_source(db, from_date=from_date, to_date=to_date)
    return {"success": True, "data": data}


@trends_router.get("/trends/subcategories")
def subcategory_breakdown(
    parent_name: str = Query(..., description="Parent category name"),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    data = get_subcategory_breakdown(
        db, parent_name=parent_name, from_date=from_date, to_date=to_date, source=source
    )
    return {"success": True, "data": data}


@trends_router.get("/debug/categories")
def debug_categories(db: Session = Depends(get_db)):
    from sqlalchemy import text
    cats = db.execute(text(
        "SELECT id, name, is_active FROM public.categories ORDER BY name"
    )).mappings().all()
    subs = db.execute(text(
        "SELECT id, name, category_id, parent_subcategory_id, is_active FROM public.subcategories ORDER BY category_id, name"
    )).mappings().all()
    tags = db.execute(text(
        "SELECT id, name, normalized, tag_type, is_active FROM public.system_tags ORDER BY name LIMIT 50"
    )).mappings().all()
    return {
        "categories": [dict(r) for r in cats],
        "subcategories": [dict(r) for r in subs],
        "system_tags_sample": [dict(r) for r in tags],
    }


@trends_router.get("/trends/balance")
def balance_over_time(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return the last running_balance per day per payment source, for a balance-over-time chart."""
    filters = []
    params: dict = {}
    if from_date:
        filters.append("transaction_date >= :from_date")
        params["from_date"] = from_date
    if to_date:
        filters.append("transaction_date <= :to_date")
        params["to_date"] = to_date
    if source:
        filters.append("upper(payment_source_name) = upper(:source)")
        params["source"] = source

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    sql = text(f"""
        SELECT DISTINCT ON (payment_source_name, transaction_date)
            transaction_date::text AS date,
            running_balance        AS balance,
            payment_source_name    AS source
        FROM public.transactions
        {where}
        ORDER BY payment_source_name, transaction_date, id DESC
    """)
    rows = db.execute(sql, params).mappings().all()
    data = [
        {"date": r["date"], "balance": float(r["balance"] or 0), "source": r["source"] or "Unknown"}
        for r in rows
        if r["balance"] is not None
    ]
    return {"success": True, "data": data}


@trends_router.get("/merchants")
def merchant_insights(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    min_transaction_count: int = Query(1, ge=1),
    tag: Optional[str] = Query(None, description="Filter merchants to transactions tagged with this tag"),
    db: Session = Depends(get_db),
):
    data = get_merchant_insights(
        db, from_date=from_date, to_date=to_date, min_count=min_transaction_count, tag=tag
    )
    return {"success": True, "data": data}
