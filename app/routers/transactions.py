from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.database import get_db
from repositories.transaction_repo import delete_transaction_and_dependents
from schemas.transaction import TransactionUpdateRequest

router = APIRouter(prefix="/transactions", tags=["Transactions"])


def _row_to_dict(row) -> dict:
    return dict(row._mapping)


@router.get("")
def list_transactions(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    tag_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    offset = (page - 1) * page_size
    filters = []
    params: dict = {"limit": page_size, "offset": offset}

    if from_date:
        filters.append("t.transaction_date >= :from_date")
        params["from_date"] = from_date
    if to_date:
        filters.append("t.transaction_date <= :to_date")
        params["to_date"] = to_date
    if source:
        filters.append("upper(t.payment_source_name) = upper(:source)")
        params["source"] = source
    if direction:
        filters.append("lower(t.direction) = lower(:direction)")
        params["direction"] = direction
    if tag_id:
        filters.append(
            "EXISTS (SELECT 1 FROM public.transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = :tag_id)"
        )
        params["tag_id"] = tag_id
    if search:
        filters.append(
            "(t.vendor_name ILIKE :search OR t.narration ILIKE :search OR t.counterparty_identifier ILIKE :search)"
        )
        params["search"] = f"%{search}%"

    where_clause = ("WHERE " + " AND ".join(filters)) if filters else ""

    count_sql = text(f"SELECT COUNT(*) FROM public.transactions t {where_clause}")
    total = db.execute(count_sql, params).scalar() or 0

    rows_sql = text(
        f"""
        SELECT
            t.id::text AS id,
            t.transaction_date,
            t.direction,
            t.amount,
            t.running_balance,
            t.counterparty_identifier,
            t.counterparty_entity_name,
            t.counterparty_entity_type,
            t.counterparty_type,
            t.payment_source_name,
            t.payment_mode,
            t.statement_sources,
            t.transaction_time,
            t.narration,
            t.vendor_name,
            t.primary_flow_type,
            t.consumption_ownership,
            t.settlement_state,
            t.review_status,
            t.review_status_manual,
            t.no_tag_required,
            t.no_split_required
        FROM public.transactions t
        {where_clause}
        ORDER BY t.transaction_date DESC, t.transaction_time DESC NULLS LAST, t.id DESC
        LIMIT :limit OFFSET :offset
        """
    )
    rows = db.execute(rows_sql, params).mappings().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "transactions": [dict(row) for row in rows],
    }


@router.get("/{transaction_id}")
def get_transaction(transaction_id: str, db: Session = Depends(get_db)):
    try:
        from uuid import UUID as _UUID
        _UUID(transaction_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid transaction ID format.")
    row = db.execute(
        text(
            """
            SELECT
                t.id::text AS id,
                t.transaction_date,
                t.direction,
                t.amount,
                t.running_balance,
                t.counterparty_identifier,
                t.counterparty_entity_name,
                t.counterparty_entity_type,
                t.counterparty_type,
                t.payment_source_name,
                t.payment_mode,
                t.statement_sources,
                t.transaction_time,
                t.narration,
                t.vendor_name,
                t.primary_flow_type,
                t.consumption_ownership,
                t.settlement_state,
                t.review_status,
                t.review_status_manual,
                t.no_tag_required,
                t.no_split_required
            FROM public.transactions t
            WHERE t.id = CAST(:transaction_id AS uuid)
            """
        ),
        {"transaction_id": transaction_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    tags = db.execute(
        text(
            """
            SELECT tt.tag_id, st.name AS tag_name, st.tag_type
            FROM public.transaction_tags tt
            JOIN public.system_tags st ON st.id = tt.tag_id
            WHERE tt.transaction_id = CAST(:transaction_id AS uuid)
            """
        ),
        {"transaction_id": transaction_id},
    ).mappings().all()

    return {
        **dict(row),
        "tags": [dict(tag) for tag in tags],
    }


@router.patch("/{transaction_id}")
def update_transaction(
    transaction_id: str,
    payload: TransactionUpdateRequest,
    db: Session = Depends(get_db),
):
    try:
        from uuid import UUID as _UUID
        _UUID(transaction_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid transaction ID format.")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided to update.")

    set_clause = ", ".join(f"{col} = :{col}" for col in updates)
    updates["transaction_id"] = transaction_id

    result = db.execute(
        text(
            f"""
            UPDATE public.transactions
            SET {set_clause}
            WHERE id = CAST(:transaction_id AS uuid)
            """
        ),
        updates,
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    db.commit()
    return {"success": True, "updated_fields": list(payload.model_dump(exclude_none=True).keys())}


@router.delete("/{transaction_id}")
def delete_transaction(transaction_id: str, db: Session = Depends(get_db)):
    exists = db.execute(
        text("SELECT 1 FROM public.transactions WHERE id = CAST(:id AS uuid)"),
        {"id": transaction_id},
    ).scalar()

    if not exists:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    delete_transaction_and_dependents(transaction_id, db)
    db.commit()
    return {"success": True, "deleted_id": transaction_id}
