import shutil
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session
from datetime import date
from typing import List, Optional
from pydantic import BaseModel

from uuid import UUID
from core.database import get_db
from repositories.transaction_search import (
    tag_transactions,
    transaction_details,
    add_transaction_tags,
    remove_transaction_tags,
    clear_all_transaction_tags,
    _resolve_tag_id,
    add_new_narration,
    update_transaction_requirement_flags,
    update_transaction_review_fields,
    propagate_vendor_name_to_overlapping_transactions,
    is_linked_recovery_transaction,
    count_counterparty_identifier_sql,
    find_related_transaction_ids,
    get_balance_reconciliation,
)
from repositories.transaction_split_repo import (
    save_transaction_split,
    get_split_id_by_transaction,
    get_split_line_item,
    get_split_with_line_items,
    get_total_recovery_amount,
    get_existing_recovery_amount,
    save_split_recovery_link,
    delete_split_recovery_link,
)
from repositories.category_repo import create_system_tag
from fastapi.templating import Jinja2Templates


report_router = APIRouter(prefix="/reports", tags=["reports"])
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parents[1] / "templates"))
templates.env.auto_reload = True


def _is_self_split_item(item: dict) -> bool:
    expense_for = str(item.get("expense_for") or "").strip().lower()
    item_name = str(item.get("item_name") or "").strip().lower()
    return expense_for in {"self", "my share", "myshare"} or item_name in {"my share", "myshare"}


def _derive_split_review_status(transaction_id: str, db: Session) -> str:
    split_data = get_split_with_line_items(transaction_id, db)
    if not split_data:
        return "confirmed"

    split_mode = str(split_data.get("split", {}).get("split_mode") or "").strip().lower()
    line_items = split_data.get("line_items") or []
    recoveries = split_data.get("recoveries") or []
    recovered_by_line_item = {}
    for recovery in recoveries:
        key = str(recovery.get("split_line_item_id") or "")
        recovered_by_line_item[key] = recovered_by_line_item.get(key, Decimal("0.00")) + Decimal(str(recovery.get("amount") or 0))

    tracked_rows = []
    if split_mode == "quick":
        tracked_rows = [item for item in line_items if not _is_self_split_item(item)]
    elif split_mode == "itemized":
        tracked_rows = [
            item
            for item in line_items
            if str(item.get("line_kind") or item.get("expense_for") or "").strip().lower() == "refund"
        ]

    for item in tracked_rows:
        row_amount = Decimal(str(abs(item.get("amount") or 0)))
        if row_amount <= Decimal("0.00"):
            continue
        recovered_amount = recovered_by_line_item.get(str(item.get("id") or ""), Decimal("0.00"))
        if (row_amount - recovered_amount) > Decimal("0.01"):
            return "needs_review"
    return "confirmed"


def _get_transaction_id_for_split(split_id: str, db: Session) -> Optional[str]:
    row = db.execute(
        text(
            """
            SELECT transaction_id::text AS transaction_id
            FROM public.transaction_splits
            WHERE id = :split_id
            """
        ),
        {"split_id": split_id},
    ).mappings().first()
    return row["transaction_id"] if row else None


class TransactionFilter(BaseModel):
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    report_type: Optional[str] = None
    vendor_filter: Optional[str] = None
    amount_filter: Optional[float] = None
    tag_filter: Optional[str] = None
    transaction_ids: Optional[list] = None  # fetch specific transactions by ID (ignores date filters)


class TransactionUpdate(BaseModel):
    amount: Optional[float] = None
    vendor_name: Optional[str] = None
    tags: List[str] = None
    transaction_id: Optional[str] = None
    id: Optional[str] = None
    apply_to_similar_transactions: Optional[bool] = False
    counterparty_identifier: Optional[str] = None
    no_tag_required: Optional[bool] = None


class MerchantMergeRequest(BaseModel):
    canonical_name: str
    counterparty_identifiers: List[str]


class BulkTagRequest(BaseModel):
    transaction_ids: List[str] = []
    tags: List[str] = []


class BulkConfirmRequest(BaseModel):
    transaction_ids: List[str] = []


class SplitLineItem(BaseModel):
    item_name: Optional[str] = None
    category: Optional[str] = None
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    expense_for: Optional[str] = None
    assignee: Optional[str] = None
    amount: float


class SplitTransactionRequest(BaseModel):
    transaction_id: str
    line_items: List[SplitLineItem] = []
    notes: Optional[str] = None
    vendor_name: Optional[str] = None
    split_mode: Optional[str] = "itemized"
    default_category: Optional[str] = None
    transaction_tags: Optional[List[str]] = None
    no_split_required: Optional[bool] = None


class SplitRecoveryLinkRequest(BaseModel):
    transaction_id: str
    recovery_transaction_id: str
    split_line_item_id: Optional[str] = None
    amount: Optional[float] = None
    recovery_type: Optional[str] = None
    notes: Optional[str] = None


class SharedJoyQuickTagRequest(BaseModel):
    transaction_id: str
    shared_joy_amount: float
    context: Optional[str] = None


VALID_SPLIT_MODES = {"itemized", "quick", "equal"}
SMALL_TRANSACTION_LABEL_OPTIONAL_LIMIT = Decimal("300.00")


def normalize_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def quantize_amount(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def build_default_split_item_name(index: int, expense_for: Optional[str], split_mode: str) -> str:
    if split_mode == "quick":
        if expense_for == "Self":
            return "Personal Spend"
        if expense_for == "Family":
            return "Family Spend"
        if expense_for == "Friends":
            return "Friends Spend"
        if expense_for == "Work":
            return "Work Spend"
        if expense_for == "Reimbursable":
            return "Reimbursable Spend"
        return "Other Spend"
    return f"Item {index}"


def is_generic_split_item_name(item_name: Optional[str], index: int, expense_for: Optional[str], split_mode: str) -> bool:
    normalized_name = normalize_text(item_name)
    if not normalized_name:
        return True
    return normalized_name == build_default_split_item_name(index, expense_for, split_mode)


@report_router.post("/transactions_filter")
def transactions_filter(filters: TransactionFilter, db: Session = Depends(get_db)):
    # When specific transaction IDs are requested (e.g. out-of-range group members),
    # bypass date/vendor filters and fetch exactly those transactions.
    if filters.transaction_ids:
        from uuid import UUID as _UUID
        from types import SimpleNamespace
        valid_ids = []
        for tid in filters.transaction_ids:
            try: valid_ids.append(str(_UUID(str(tid))))
            except (ValueError, AttributeError): pass
        if not valid_ids:
            return {"success": True, "data": {"transactions": [], "total": 0}}
        id_filter = SimpleNamespace(
            from_date=None, to_date=None, vendor_filter=None,
            amount_filter=None, tag_filter=None, transaction_ids=valid_ids,
        )
        searched_transactions = tag_transactions(id_filter, db)
        return {"success": True, "data": list(searched_transactions)}

    searched_transactions = tag_transactions(filters, db)

    if not searched_transactions:
        return {
            "success": False,
            "error_code": "NO_DATA",
            "message": "No transactions found for the given filters.",
        }
    return {"success": True, "data": searched_transactions}


@report_router.get("/recurring")
def get_recurring_transactions(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        WITH base AS (
            SELECT
                COALESCE(NULLIF(BTRIM(t.vendor_name),''),
                         NULLIF(BTRIM(t.counterparty_entity_name),''),
                         t.counterparty_identifier, 'Unknown') AS merchant,
                t.direction,
                DATE_TRUNC('month', t.transaction_date)::date  AS txn_month,
                ABS(t.amount)                                   AS amount,
                MAX(t.transaction_date)                         AS last_date
            FROM public.transactions t
            WHERE t.transaction_date >= CURRENT_DATE - INTERVAL '6 months'
            GROUP BY merchant, t.direction,
                     DATE_TRUNC('month', t.transaction_date)::date, ABS(t.amount)
        )
        SELECT
            merchant,
            direction,
            COUNT(DISTINCT txn_month)                     AS months_seen,
            ROUND(AVG(amount)::numeric, 2)                AS avg_amount,
            ROUND(STDDEV(amount)::numeric, 2)             AS stddev_amount,
            MAX(last_date)                                AS last_date,
            BOOL_OR(txn_month = DATE_TRUNC('month', CURRENT_DATE)::date) AS seen_this_month
        FROM base
        GROUP BY merchant, direction
        HAVING COUNT(DISTINCT txn_month) >= 2
        ORDER BY months_seen DESC, avg_amount DESC
        LIMIT 60
    """)).mappings().all()

    return {"success": True, "data": [
        {
            "merchant":        r["merchant"],
            "direction":       r["direction"],
            "months_seen":     int(r["months_seen"]),
            "avg_amount":      float(r["avg_amount"] or 0),
            "stddev_amount":   float(r["stddev_amount"] or 0),
            "last_date":       str(r["last_date"]) if r["last_date"] else None,
            "seen_this_month": bool(r["seen_this_month"]),
        }
        for r in rows
    ]}


@report_router.get("/balance_reconciliation")
def balance_reconciliation(db: Session = Depends(get_db)):
    rows = get_balance_reconciliation(db)
    return {"success": True, "data": rows}


@report_router.get("/")
def index(request: Request):
    return templates.TemplateResponse(request, "report_shower.html")


@report_router.get("/analytics")
def analytics_page(request: Request, db: Session = Depends(get_db)):
    from repositories.trends_repo import get_monthly_trends

    def fmt(v):
        return "â‚¹{:,.2f}".format(abs(float(v or 0)))

    ctx = {
        "kpi_expense": "â€”", "kpi_income": "â€”", "kpi_invested": "â€”",
        "kpi_net": "â€”", "kpi_net_pos": True, "kpi_savings_rate": "â€”", "kpi_count": "â€”",
        "kpi_inv_deployed": "â€”", "kpi_inv_returned": "â€”",
        "kpi_inv_pnl": "â€”", "kpi_inv_pnl_pos": True, "kpi_inv_roi": "â€”",
    }
    try:
        rows = get_monthly_trends(db)
        total_expense         = sum(r["total_expense"]           for r in rows)
        total_income          = sum(r["total_income"]            for r in rows)
        total_invested        = sum(r["total_invested"]          for r in rows)
        total_inv_return      = sum(r["total_investment_return"] for r in rows)
        total_count           = sum(r["transaction_count"]       for r in rows)
        net          = total_income - total_expense
        savings_rate = (net / total_income * 100) if total_income > 0 else 0
        inv_pnl      = total_inv_return - total_invested
        inv_roi      = (inv_pnl / total_invested * 100) if total_invested > 0 else 0
        ctx = {
            "kpi_expense":       fmt(total_expense),
            "kpi_income":        fmt(total_income),
            "kpi_invested":      fmt(total_invested),
            "kpi_net":           ("+" if net >= 0 else "-") + fmt(net),
            "kpi_net_pos":       net >= 0,
            "kpi_savings_rate":  f"{savings_rate:.1f}%",
            "kpi_count":         f"{int(total_count):,}",
            "kpi_inv_deployed":  fmt(total_invested),
            "kpi_inv_returned":  fmt(total_inv_return),
            "kpi_inv_pnl":       ("+" if inv_pnl >= 0 else "-") + fmt(inv_pnl),
            "kpi_inv_pnl_pos":   inv_pnl >= 0,
            "kpi_inv_roi":       f"{inv_roi:+.1f}%",
        }
    except Exception:
        pass
    return templates.TemplateResponse(request, "analytics.html", ctx)


@report_router.get("/transaction_details/{txn_id}")
def get_transaction_details(txn_id: UUID, db: Session = Depends(get_db)):
    details = transaction_details(txn_id, db)
    if not details:
        return {
            "success": False,
            "error_code": "NOT_FOUND",
            "message": "Transaction details not found.",
        }
    counterparty_identifier = details.get("counterparty_identifier")
    if counterparty_identifier:
        details["counterparty_count"] = count_counterparty_identifier_sql(
            counterparty_identifier, db
        )

    return details


@report_router.post("/transaction_update")
def transaction_update(
    updated_transaction_details: TransactionUpdate, db: Session = Depends(get_db)
):
    if is_linked_recovery_transaction(updated_transaction_details.id, db):
        return {
            "success": False,
            "error_code": "SETTLEMENT_LOCKED",
            "message": "Settlement transactions do not support tagging changes.",
        }

    get_transaction_details_response = get_transaction_details(
        updated_transaction_details.id, db
    )
    if not get_transaction_details_response:
        return {
            "success": False,
            "error_code": "NOT_FOUND",
            "message": "Transaction details not found for update.",
        }

    prev_transaction_details_tag_set = set(
        get_transaction_details_response.get("tag_names", [])
    )
    no_tag_required = bool(updated_transaction_details.no_tag_required)
    new_transaction_details_tag_set = set([] if no_tag_required else (updated_transaction_details.tags or []))

    tags_to_add = new_transaction_details_tag_set - prev_transaction_details_tag_set
    tags_to_remove = prev_transaction_details_tag_set - new_transaction_details_tag_set

    apply_to_similar_transactions = (
        updated_transaction_details.apply_to_similar_transactions
    )
    ids = [updated_transaction_details.id]
    if apply_to_similar_transactions:
        ids = find_related_transaction_ids(
            updated_transaction_details.counterparty_identifier, db
        )

    for id in ids:
        update_transaction_requirement_flags(
            id,
            db,
            no_tag_required=no_tag_required,
        )
        if tags_to_add:
            add_transaction_tags(tags_to_add, id, db)
            db.execute(
                text("""
                    UPDATE public.transactions
                    SET review_status_manual = TRUE,
                        review_status = CASE
                            WHEN review_status IS NULL OR review_status = 'unknown' THEN 'confirmed'
                            ELSE review_status
                        END
                    WHERE id = CAST(:tid AS uuid)
                """),
                {"tid": id},
            )
            db.commit()
        if tags_to_remove:
            remove_transaction_tags(tags_to_remove, id, db)

        vendor_name = updated_transaction_details.vendor_name
        if vendor_name:
            # Normalise to title-case so "SWIGGY" and "swiggy" are stored uniformly
            vendor_name = " ".join(w.capitalize() for w in vendor_name.strip().split())
            add_new_narration(id, vendor_name, db)
            propagate_vendor_name_to_overlapping_transactions(id, vendor_name, db)

    return {
        "success": True,
        "message": "Transaction tags/details updated successfully.",
    }


@report_router.post("/bulk_tag")
def bulk_tag_transactions(payload: BulkTagRequest, db: Session = Depends(get_db)):
    transaction_ids = [
        str(transaction_id).strip()
        for transaction_id in (payload.transaction_ids or [])
        if str(transaction_id or "").strip()
    ]
    tags = [
        str(tag).strip()
        for tag in (payload.tags or [])
        if str(tag or "").strip()
    ]

    if not transaction_ids:
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "Select at least one transaction.",
        }
    if not tags:
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "Choose at least one tag.",
        }

    updated_count = 0
    skipped_count = 0
    # Only create a brand-new tag for tokens that don't already resolve to an
    # existing tag. A collision-aware display token (e.g. "petrol (4-wheeler)")
    # resolves to its node tag and must NOT spawn a junk flat tag.
    for tag in tags:
        if _resolve_tag_id(tag, db) is None:
            create_system_tag(tag, db, tag_type="USER")

    for transaction_id in transaction_ids:
        try:
            UUID(transaction_id)
        except ValueError:
            skipped_count += 1
            continue

        if is_linked_recovery_transaction(transaction_id, db):
            skipped_count += 1
            continue

        add_transaction_tags(set(tags), transaction_id, db)
        update_transaction_requirement_flags(
            transaction_id,
            db,
            no_tag_required=False,
        )
        db.execute(
            text("""
                UPDATE public.transactions
                SET review_status_manual = TRUE,
                    review_status = CASE
                        WHEN review_status IS NULL OR review_status = 'unknown' THEN 'confirmed'
                        ELSE review_status
                    END
                WHERE id = CAST(:tid AS uuid)
            """),
            {"tid": transaction_id},
        )
        updated_count += 1

    db.commit()
    return {
        "success": True,
        "message": f"Applied tags to {updated_count} transaction{'' if updated_count == 1 else 's'}.",
        "updated_count": updated_count,
        "skipped_count": skipped_count,
    }


@report_router.post("/bulk_confirm")
def bulk_confirm_transactions(payload: BulkConfirmRequest, db: Session = Depends(get_db)):
    ids = [s.strip() for s in (payload.transaction_ids or []) if s.strip()]
    if not ids:
        return {"success": False, "message": "No transaction IDs provided."}
    valid_ids = []
    for i in ids:
        try:
            valid_ids.append(str(UUID(i)))
        except ValueError:
            pass
    if not valid_ids:
        return {"success": False, "message": "No valid transaction IDs."}
    # IDs already validated as UUIDs above â€” safe to inline in SQL
    in_clause = ",".join(f"'{i}'" for i in valid_ids)
    result = db.execute(
        text(f"""
            UPDATE public.transactions
            SET review_status = 'confirmed',
                review_status_manual = TRUE
            WHERE id::text IN ({in_clause})
        """)
    )
    db.commit()
    return {"success": True, "updated": result.rowcount}


class BulkUpdateRequest(BaseModel):
    transaction_ids: List[str] = []
    action: str = ""
    value: Optional[str] = None


@report_router.post("/bulk_update")
def bulk_update_transactions(payload: BulkUpdateRequest, db: Session = Depends(get_db)):
    """Bulk row actions from the Reports selection toolbar (#4):
    confirm (mark reviewed), no_tag (clear tags + mark no-tag-needed), flow_type (set/clear)."""
    valid_ids = []
    for i in (payload.transaction_ids or []):
        try:
            valid_ids.append(str(UUID(str(i).strip())))
        except ValueError:
            pass
    if not valid_ids:
        return {"success": False, "message": "No valid transaction IDs."}

    action = (payload.action or "").strip().lower()
    # IDs validated as UUIDs above â€” safe to inline.
    in_clause = ",".join(f"'{i}'" for i in valid_ids)

    if action == "confirm":
        db.execute(text(f"""
            UPDATE public.transactions
            SET review_status = 'confirmed', review_status_manual = TRUE
            WHERE id::text IN ({in_clause})
        """))
    elif action == "no_tag":
        for i in valid_ids:
            clear_all_transaction_tags(i, db)
        db.execute(text(f"""
            UPDATE public.transactions
            SET no_tag_required = TRUE, review_status = 'confirmed', review_status_manual = TRUE
            WHERE id::text IN ({in_clause})
        """))
    elif action == "flow_type":
        flow = (payload.value or "").strip().lower()
        allowed = {"transfer", "investment_buy", "investment_sell", "loan_given"}
        if flow == "none":
            flow = ""
        elif flow not in allowed:
            return {"success": False, "message": "Invalid flow type."}
        db.execute(text(f"""
            UPDATE public.transactions
            SET primary_flow_type = :flow, review_status_manual = TRUE
            WHERE id::text IN ({in_clause})
        """), {"flow": flow})
    else:
        return {"success": False, "message": "Unknown action."}

    db.commit()
    return {"success": True, "updated": len(valid_ids)}


@report_router.post("/transaction_split")
def transaction_split(payload: SplitTransactionRequest, db: Session = Depends(get_db)):
    try:
        txn_uuid = UUID(payload.transaction_id)
    except ValueError:
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "Invalid transaction_id.",
        }

    if is_linked_recovery_transaction(str(txn_uuid), db):
        return {
            "success": False,
            "error_code": "SETTLEMENT_LOCKED",
            "message": "Settlement transactions do not support split changes.",
        }

    details = transaction_details(txn_uuid, db)
    if not details:
        return {
            "success": False,
            "error_code": "NOT_FOUND",
            "message": "Transaction not found for split.",
        }

    if payload.no_split_required:
        update_transaction_requirement_flags(
            str(txn_uuid),
            db,
            no_split_required=True,
        )
        return {
            "success": True,
            "message": "Split marked as not required.",
            "data": {
                "transaction_id": payload.transaction_id,
                "split_mode": None,
                "line_items": [],
            },
        }

    if not payload.line_items:
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "At least one split line item is required.",
        }

    split_mode = normalize_text(payload.split_mode or "itemized")
    if split_mode == "equal":
        split_mode = "quick"
    if split_mode not in VALID_SPLIT_MODES:
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "Invalid split_mode. Use 'itemized' or 'quick'.",
        }

    default_category = normalize_text(payload.default_category)
    transaction_tags = [
        normalized_tag
        for normalized_tag in (
            normalize_text(tag) for tag in (payload.transaction_tags or [])
        )
        if normalized_tag
    ]
    original_amount = quantize_amount(abs(details.get("amount") or 0))
    requires_custom_labels = (
        split_mode == "itemized"
        and len(payload.line_items) > 1
        and original_amount > SMALL_TRANSACTION_LABEL_OPTIONAL_LIMIT
    )

    normalized_items = []
    for index, item in enumerate(payload.line_items, start=1):
        expense_for = normalize_text(item.expense_for or item.assignee)
        item_name = normalize_text(item.item_name)
        category = normalize_text(item.category) or default_category
        default_item_name = build_default_split_item_name(index, expense_for, split_mode)

        if requires_custom_labels and is_generic_split_item_name(
            item_name, index, expense_for, split_mode
        ):
            return {
                "success": False,
                "error_code": "VALIDATION_ERROR",
                "message": (
                    f"Line item {index} needs a label for larger itemized splits."
                ),
            }
        item_name = item_name or default_item_name

        try:
            amount = quantize_amount(item.amount)
        except Exception:
            return {
                "success": False,
                "error_code": "VALIDATION_ERROR",
                "message": f"Line item {index} has an invalid amount.",
            }

        if amount <= Decimal("0.00"):
            return {
                "success": False,
                "error_code": "VALIDATION_ERROR",
                "message": f"Line item {index} amount must be greater than zero.",
            }

        if not expense_for:
            return {
                "success": False,
                "error_code": "VALIDATION_ERROR",
                "message": f"Line item {index} is missing expense_for.",
            }

        normalized_items.append(
            SplitLineItem(
                item_name=item_name,
                category=category,
                category_id=item.category_id,
                subcategory_id=item.subcategory_id,
                expense_for=expense_for,
                amount=float(amount),
            )
        )

    total_split_amount = sum(quantize_amount(item.amount) for item in normalized_items)
    if total_split_amount != original_amount:
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "Split total must match the original transaction amount.",
        }

    split_result = save_transaction_split(
        transaction_id=payload.transaction_id,
        vendor_name=normalize_text(payload.vendor_name) or normalize_text(details.get("vendor_name")),
        notes=normalize_text(payload.notes),
        split_mode=split_mode,
        total_amount=total_split_amount,
        line_items=normalized_items,
        db=db,
    )
    update_transaction_requirement_flags(
        str(txn_uuid),
        db,
        no_split_required=False,
    )

    return {
        "success": True,
        "message": "Split transaction saved successfully.",
        "data": {
            "split_id": str(split_result["split_id"]),
            "transaction_id": payload.transaction_id,
            "line_item_count": len(normalized_items),
            "total_split_amount": float(total_split_amount),
            "notes": normalize_text(payload.notes),
            "split_mode": split_mode,
            "line_items": [
                {
                    "id": str(item["id"]),
                    "item_name": item["item_name"],
                    "category": item["category"],
                    "category_id": str(item["category_id"]) if item.get("category_id") else None,
                    "subcategory_id": str(item["subcategory_id"]) if item.get("subcategory_id") else None,
                    "expense_for": item["expense_for"],
                    "amount": float(item["amount"] or 0),
                }
                for item in split_result["line_items"]
            ],
        },
    }


@report_router.post("/transaction_split/recovery_link")
def transaction_split_recovery_link(
    payload: SplitRecoveryLinkRequest, db: Session = Depends(get_db)
):
    try:
        txn_uuid = str(UUID(payload.transaction_id))
        recovery_txn_uuid = str(UUID(payload.recovery_transaction_id))
    except ValueError:
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "Invalid transaction id provided.",
        }

    split_id = get_split_id_by_transaction(txn_uuid, db)
    if not split_id:
        return {
            "success": False,
            "error_code": "NOT_FOUND",
            "message": "No saved split found for the original transaction.",
        }
    split_details = get_split_with_line_items(txn_uuid, db)
    if not split_details or not split_details.get("line_items"):
        return {
            "success": False,
            "error_code": "NOT_FOUND",
            "message": "No saved split found for the original transaction.",
        }

    original_details = transaction_details(UUID(txn_uuid), db)
    recovery_details = transaction_details(UUID(recovery_txn_uuid), db)
    if not original_details or not recovery_details:
        return {
            "success": False,
            "error_code": "NOT_FOUND",
            "message": "Original or recovery transaction not found.",
        }

    split_line_item_id = None
    max_linkable_amount = quantize_amount(abs(original_details.get("amount") or 0))
    if payload.split_line_item_id:
        try:
            split_line_item_id = str(UUID(payload.split_line_item_id))
        except ValueError:
            return {
                "success": False,
                "error_code": "VALIDATION_ERROR",
                "message": "Invalid split line item id.",
            }

        line_item = get_split_line_item(split_line_item_id, split_id, db)
        if not line_item:
            return {
                "success": False,
                "error_code": "NOT_FOUND",
                "message": "Split line item not found for this transaction.",
            }
        max_linkable_amount = quantize_amount(line_item["amount"])

    recovery_amount = quantize_amount(
        payload.amount if payload.amount is not None else abs(recovery_details.get("amount") or 0)
    )
    if recovery_amount <= Decimal("0.00"):
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "Recovery amount must be greater than zero.",
        }

    existing_recovery_total = quantize_amount(
        get_total_recovery_amount(split_id, split_line_item_id, db)
    )
    # For updates (same recovery_transaction_id already linked), subtract its old amount
    # so we don't double-count it, and allow exceeding the line item estimate by using
    # the full original transaction amount as the cap
    existing_this = quantize_amount(get_existing_recovery_amount(recovery_txn_uuid, db))
    is_update = existing_this > Decimal("0.00")
    effective_cap = quantize_amount(abs(original_details.get("amount") or 0)) if is_update else max_linkable_amount
    if existing_recovery_total - existing_this + recovery_amount > effective_cap:
        return {
            "success": False,
            "error_code": "VALIDATION_ERROR",
            "message": "Linked recovery exceeds the original split amount.",
        }

    recovery_id = save_split_recovery_link(
        split_id=split_id,
        split_line_item_id=split_line_item_id,
        recovery_transaction_id=recovery_txn_uuid,
        recovery_type=normalize_text(payload.recovery_type) or "Recovery",
        amount=recovery_amount,
        notes=normalize_text(payload.notes),
        db=db,
    )
    update_transaction_requirement_flags(
        recovery_txn_uuid,
        db,
        no_tag_required=True,
        no_split_required=True,
    )
    clear_all_transaction_tags(recovery_txn_uuid, db)
    update_transaction_review_fields(
        txn_uuid,
        db,
        review_status=_derive_split_review_status(txn_uuid, db),
        review_status_manual=False,
    )
    update_transaction_review_fields(
        recovery_txn_uuid,
        db,
        review_status="confirmed",
        review_status_manual=False,
    )

    return {
        "success": True,
        "message": "Recovery linked successfully.",
        "data": {
            "recovery_id": str(recovery_id),
            "split_id": str(split_id),
            "transaction_id": txn_uuid,
            "recovery_transaction_id": recovery_txn_uuid,
            "split_line_item_id": split_line_item_id,
            "amount": float(recovery_amount),
        },
    }


@report_router.delete("/transaction_split/recovery_link/{recovery_id}")
def delete_transaction_split_recovery_link(recovery_id: UUID, db: Session = Depends(get_db)):
    deleted_row = delete_split_recovery_link(str(recovery_id), db)
    if not deleted_row:
        return {
            "success": False,
            "error_code": "NOT_FOUND",
            "message": "Recovery link not found.",
        }

    if deleted_row.get("recovery_transaction_id"):
        update_transaction_requirement_flags(
            str(deleted_row["recovery_transaction_id"]),
            db,
            no_tag_required=False,
            no_split_required=False,
        )
        update_transaction_review_fields(
            str(deleted_row["recovery_transaction_id"]),
            db,
            review_status="unreviewed",
            review_status_manual=False,
        )

    split_id = str(deleted_row.get("split_id") or "")
    original_transaction_id = _get_transaction_id_for_split(split_id, db) if split_id else None
    if original_transaction_id:
        update_transaction_review_fields(
            original_transaction_id,
            db,
            review_status=_derive_split_review_status(original_transaction_id, db),
            review_status_manual=False,
        )

    return {
        "success": True,
        "message": "Recovery link removed successfully.",
        "data": {
            "recovery_id": str(deleted_row["id"]),
            "recovery_transaction_id": str(deleted_row["recovery_transaction_id"]),
        },
    }


@report_router.get("/person-balances")
def get_person_balances(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT
            sli.expense_for                                                    AS person,
            COALESCE(SUM(sli.amount), 0)                                       AS total_owed,
            COALESCE(SUM(r.amount), 0)                                         AS total_recovered,
            COALESCE(SUM(sli.amount), 0) - COALESCE(SUM(r.amount), 0)         AS net_balance,
            COUNT(DISTINCT s.transaction_id)                                   AS txn_count,
            MAX(t.transaction_date)                                            AS last_date
        FROM public.transaction_split_line_items sli
        JOIN public.transaction_splits s ON s.id = sli.split_id
        JOIN public.transactions t       ON t.id = s.transaction_id
        LEFT JOIN public.transaction_split_recoveries r
               ON r.split_id = s.id AND r.split_line_item_id = sli.id
        WHERE sli.expense_for IS NOT NULL
          AND LOWER(TRIM(sli.expense_for)) NOT IN ('self','my share','myshare','refund','other','')
        GROUP BY sli.expense_for
        ORDER BY net_balance DESC
    """)).mappings().all()

    return {"success": True, "data": [
        {
            "person":          r["person"],
            "total_owed":      float(r["total_owed"] or 0),
            "total_recovered": float(r["total_recovered"] or 0),
            "net_balance":     float(r["net_balance"] or 0),
            "txn_count":       int(r["txn_count"] or 0),
            "last_date":       str(r["last_date"]) if r["last_date"] else None,
        }
        for r in rows
    ]}


@report_router.get("/person-balance/{person_name}")
def get_person_balance_detail(person_name: str, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT
            sli.id::text                   AS line_item_id,
            sli.item_name,
            sli.amount                     AS owed_amount,
            COALESCE(r.amount, 0)          AS recovered_amount,
            sli.amount - COALESCE(r.amount,0) AS outstanding,
            t.id::text                     AS transaction_id,
            t.transaction_date,
            COALESCE(NULLIF(BTRIM(t.vendor_name),''),
                     NULLIF(BTRIM(t.counterparty_entity_name),''),
                     t.counterparty_identifier, 'Unknown') AS merchant,
            t.narration
        FROM public.transaction_split_line_items sli
        JOIN public.transaction_splits s ON s.id = sli.split_id
        JOIN public.transactions t       ON t.id = s.transaction_id
        LEFT JOIN public.transaction_split_recoveries r
               ON r.split_id = s.id AND r.split_line_item_id = sli.id
        WHERE LOWER(TRIM(sli.expense_for)) = LOWER(TRIM(:person))
        ORDER BY t.transaction_date DESC
    """), {"person": person_name}).mappings().all()

    return {"success": True, "data": [
        {
            "line_item_id":     r["line_item_id"],
            "item_name":        r["item_name"],
            "owed_amount":      float(r["owed_amount"] or 0),
            "recovered_amount": float(r["recovered_amount"] or 0),
            "outstanding":      float(r["outstanding"] or 0),
            "transaction_id":   r["transaction_id"],
            "transaction_date": str(r["transaction_date"]) if r["transaction_date"] else None,
            "merchant":         r["merchant"],
            "narration":        r["narration"],
        }
        for r in rows
    ]}


@report_router.get("/transaction_split/{txn_id}")
def get_transaction_split_state(txn_id: UUID, db: Session = Depends(get_db)):
    split_data = get_split_with_line_items(str(txn_id), db)
    if not split_data:
        return {"success": True, "data": None}

    split = split_data["split"]
    return {
        "success": True,
        "data": {
            "split_id": str(split["id"]),
            "transaction_id": str(split["transaction_id"]),
            "vendor_name": split["vendor_name"],
            "notes": split["notes"],
            "split_mode": split["split_mode"],
            "total_amount": float(split["total_amount"] or 0),
            "line_items": [
                {
                    "id": str(item["id"]),
                    "item_name": item["item_name"],
                    "category": item["category"],
                    "category_id": str(item["category_id"]) if item.get("category_id") else None,
                    "subcategory_id": str(item["subcategory_id"]) if item.get("subcategory_id") else None,
                    "expense_for": item["expense_for"],
                    "amount": float(item["amount"] or 0),
                }
                for item in split_data["line_items"]
            ],
            "recoveries": [
                {
                    "id": str(item["id"]),
                    "split_line_item_id": str(item["split_line_item_id"]) if item["split_line_item_id"] else None,
                    "recovery_transaction_id": str(item["recovery_transaction_id"]),
                    "recovery_type": item["recovery_type"],
                    "amount": float(item["amount"] or 0),
                    "notes": item["notes"],
                    "transaction_date": str(item["transaction_date"]) if item["transaction_date"] else None,
                    "counterparty_identifier": item["counterparty_identifier"],
                    "vendor_name": item["vendor_name"],
                }
                for item in split_data["recoveries"]
            ],
        },
    }


@report_router.post("/merge-merchant")
def merge_merchant(payload: MerchantMergeRequest, db: Session = Depends(get_db)):
    name = payload.canonical_name.strip()
    if not name or not payload.counterparty_identifiers:
        return {"success": False, "message": "canonical_name and counterparty_identifiers required"}
    # Normalise: title-case so "HDFC bank" and "hdfc bank" both become "Hdfc Bank"
    name_normalised = " ".join(w.capitalize() for w in name.split())
    try:
        result = db.execute(text("""
            UPDATE public.transactions
            SET vendor_name = :name
            WHERE counterparty_identifier = ANY(:ids)
        """), {"name": name_normalised, "ids": payload.counterparty_identifiers})
        db.commit()
        return {"success": True, "data": {"updated": result.rowcount, "canonical_name": name_normalised}}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}


@report_router.post("/shared-joy/quick-tag")
def shared_joy_quick_tag(payload: SharedJoyQuickTagRequest, db: Session = Depends(get_db)):
    """Mark a portion of a transaction as Shared Joy (spent on others, not self)."""
    try:
        txn_uuid = str(UUID(payload.transaction_id))
    except ValueError:
        return {"success": False, "error_code": "VALIDATION_ERROR", "message": "Invalid transaction_id."}

    if is_linked_recovery_transaction(txn_uuid, db):
        return {"success": False, "error_code": "SETTLEMENT_LOCKED", "message": "Settlement transactions cannot be tagged."}

    details = transaction_details(UUID(txn_uuid), db)
    if not details:
        return {"success": False, "error_code": "NOT_FOUND", "message": "Transaction not found."}

    if str(details.get("direction") or "").lower() != "withdrawal":
        return {"success": False, "error_code": "VALIDATION_ERROR", "message": "Shared Joy can only be tagged on expense transactions."}

    original_amount = quantize_amount(abs(details.get("amount") or 0))
    shared_joy_amount = quantize_amount(payload.shared_joy_amount)

    if shared_joy_amount < Decimal("0.00"):
        return {"success": False, "error_code": "VALIDATION_ERROR", "message": "Shared Joy amount cannot be negative."}

    if shared_joy_amount > original_amount:
        return {"success": False, "error_code": "VALIDATION_ERROR", "message": "Shared Joy amount cannot exceed the transaction amount."}

    # Remove any existing shared_joy split for this transaction so we can rebuild cleanly
    existing_split = get_split_with_line_items(txn_uuid, db)

    if shared_joy_amount == Decimal("0.00"):
        # Remove Shared Joy: delete the entire split if it only had shared_joy items, else remove those items
        if existing_split:
            non_joy_items = [li for li in existing_split.get("line_items", []) if str(li.get("expense_for") or "").lower() != "shared_joy"]
            if not non_joy_items:
                from repositories.transaction_split_repo import delete_transaction_split
                delete_transaction_split(txn_uuid, db)
            else:
                # Rebuild split without joy items
                items = [SplitLineItem(
                    item_name=li["item_name"],
                    category=li.get("category"),
                    expense_for=li["expense_for"],
                    amount=float(li["amount"]),
                ) for li in non_joy_items]
                save_transaction_split(
                    transaction_id=txn_uuid,
                    vendor_name=existing_split["split"]["vendor_name"],
                    notes=existing_split["split"]["notes"],
                    split_mode=existing_split["split"]["split_mode"] or "quick",
                    total_amount=sum(quantize_amount(i.amount) for i in items),
                    line_items=items,
                    db=db,
                )
        return {"success": True, "message": "Shared Joy removed.", "data": {"shared_joy_amount": 0.0}}

    context_label = normalize_text(payload.context) or "Others"
    self_amount = original_amount - shared_joy_amount

    if existing_split:
        # Keep non-joy items from any existing detailed split, replace/add the joy item
        non_joy_items = [li for li in existing_split.get("line_items", []) if str(li.get("expense_for") or "").lower() != "shared_joy"]
        if non_joy_items and self_amount > Decimal("0.00"):
            # Proportionally rescale existing non-joy items so they sum to self_amount.
            # Do NOT add a separate "My share" entry â€” these items already represent the self portion.
            non_joy_total = sum(quantize_amount(li["amount"]) for li in non_joy_items)
            if non_joy_total != self_amount:
                ratio = self_amount / non_joy_total if non_joy_total > 0 else Decimal("1")
                adjusted = []
                running = Decimal("0")
                for i, li in enumerate(non_joy_items):
                    if i == len(non_joy_items) - 1:
                        amt = self_amount - running
                    else:
                        amt = quantize_amount(quantize_amount(li["amount"]) * ratio)
                    running += amt
                    adjusted.append(SplitLineItem(
                        item_name=li["item_name"], category=li.get("category"),
                        expense_for=li["expense_for"], amount=float(max(amt, Decimal("0.01"))),
                    ))
                line_items = adjusted
            else:
                line_items = [SplitLineItem(
                    item_name=li["item_name"], category=li.get("category"),
                    expense_for=li["expense_for"], amount=float(li["amount"]),
                ) for li in non_joy_items]
        else:
            # No pre-existing non-joy items: create a single "My share" self entry
            line_items = []
            if self_amount > Decimal("0.00"):
                line_items.append(SplitLineItem(item_name="My share", expense_for="Self", amount=float(self_amount)))
        line_items.append(SplitLineItem(item_name=f"Shared Joy ({context_label})", expense_for="shared_joy", amount=float(shared_joy_amount)))
        split_mode = existing_split["split"]["split_mode"] or "quick"
    else:
        line_items = []
        if self_amount > Decimal("0.00"):
            line_items.append(SplitLineItem(item_name="My share", expense_for="Self", amount=float(self_amount)))
        line_items.append(SplitLineItem(item_name=f"Shared Joy ({context_label})", expense_for="shared_joy", amount=float(shared_joy_amount)))
        split_mode = "quick"

    save_transaction_split(
        transaction_id=txn_uuid,
        vendor_name=normalize_text(details.get("vendor_name")),
        notes=None,
        split_mode=split_mode,
        total_amount=original_amount,
        line_items=line_items,
        db=db,
    )
    update_transaction_requirement_flags(txn_uuid, db, no_split_required=True)

    return {
        "success": True,
        "message": "Shared Joy tagged successfully.",
        "data": {
            "transaction_id": txn_uuid,
            "shared_joy_amount": float(shared_joy_amount),
            "self_amount": float(self_amount),
            "context": context_label,
        },
    }


@report_router.get("/shared-joy/summary")
def shared_joy_summary(month_start: Optional[str] = None, db: Session = Depends(get_db)):
    """Return Shared Joy spend summary for a month."""
    from repositories.planning_repo import get_shared_joy_monthly_summary, _resolve_active_month
    ms = month_start or _resolve_active_month(db).replace(day=1).isoformat()
    return {"success": True, "data": get_shared_joy_monthly_summary(db, ms)}


@report_router.get("/shared-joy/period-summary")
def shared_joy_period_summary(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return total Shared Joy spend + per-category breakdown for an arbitrary date range.

    Includes event-level shared joy set on Outing/Event groups (attributed to the
    group's latest member date), and excludes those groups' member transactions from
    the per-transaction split sum to avoid double-counting.
    """
    from sqlalchemy import text as _text
    _event_types = "('EVENT','SPLIT','RETURN','CIRCLE','GENERAL')"
    _member_exclusion = f"""
        AND t.id NOT IN (
            SELECT gl.transaction_id FROM public.transaction_group_links gl
            JOIN public.transaction_groups g2 ON g2.id = gl.group_id
            WHERE g2.shared_joy_amount > 0 AND UPPER(g2.group_type) IN {_event_types}
        )
    """
    where = "lower(COALESCE(li.expense_for, '')) = 'shared_joy'" + _member_exclusion
    params = {}
    if from_date:
        where += " AND t.transaction_date >= :from_date"
        params["from_date"] = from_date
    if to_date:
        where += " AND t.transaction_date <= :to_date"
        params["to_date"] = to_date

    total = db.execute(_text(f"""
        SELECT COALESCE(SUM(ABS(li.amount)), 0)
        FROM public.transaction_split_line_items li
        JOIN public.transaction_splits s ON s.id = li.split_id
        JOIN public.transactions t ON t.id = s.transaction_id
        WHERE {where}
    """), params).scalar_one()

    # Event-level shared joy, attributed to each event's latest member date.
    event_date_filter = ""
    event_params = {}
    if from_date:
        event_date_filter += " AND ev.event_date >= :from_date"
        event_params["from_date"] = from_date
    if to_date:
        event_date_filter += " AND ev.event_date <= :to_date"
        event_params["to_date"] = to_date
    event_total = db.execute(_text(f"""
        SELECT COALESCE(SUM(ev.shared_joy_amount), 0)
        FROM (
            SELECT g.id, g.shared_joy_amount,
                   (SELECT MAX(t.transaction_date)
                    FROM public.transaction_group_links gl
                    JOIN public.transactions t ON t.id = gl.transaction_id
                    WHERE gl.group_id = g.id) AS event_date
            FROM public.transaction_groups g
            WHERE g.shared_joy_amount > 0 AND UPPER(g.group_type) IN {_event_types}
        ) ev
        WHERE ev.event_date IS NOT NULL {event_date_filter}
    """), event_params).scalar_one()

    by_cat = db.execute(_text(f"""
        SELECT
            COALESCE(st.name, 'Uncategorized') AS tag_name,
            SUM(ABS(li.amount)) AS shared_joy_amount
        FROM public.transaction_split_line_items li
        JOIN public.transaction_splits s ON s.id = li.split_id
        JOIN public.transactions t ON t.id = s.transaction_id
        LEFT JOIN public.transaction_tags tt ON tt.transaction_id = t.id
        LEFT JOIN public.system_tags st ON st.id = tt.tag_id
            AND COALESCE(st.managed_by_schema, FALSE) = TRUE
            AND COALESCE(st.is_active, TRUE) = TRUE
        WHERE {where}
        GROUP BY st.name
    """), params).mappings().all()

    by_category = [
        {"tag_name": r["tag_name"], "shared_joy_amount": float(r["shared_joy_amount"])}
        for r in by_cat if r["tag_name"]
    ]
    if float(event_total) > 0:
        by_category.append({"tag_name": "Outings / Events", "shared_joy_amount": float(event_total)})

    return {
        "success": True,
        "data": {
            "total": float(total) + float(event_total),
            "by_category": by_category,
        },
    }
