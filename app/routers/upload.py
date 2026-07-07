from io import BytesIO
from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, Depends, Form, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from core.database import get_db
from services.statement_parser import parse_statement
from services.receipt_parser import parse_receipt
from services.auto_tagger import auto_tagging_transactions
from repositories.transaction_repo import (
    write_transactions_to_db,
    backfill_transaction_sources,
    dedupe_exact_transaction_rows,
    align_transactions_to_statement,
    insert_new_transactions,
)
from repositories.transaction_search import (
    backfill_vendor_names_from_overlaps,
    get_balance_reconciliation,
)
from repositories.transaction_split_repo import save_transaction_split

router = APIRouter(prefix="/upload", tags=["Upload"])


class ManualTransactionRequest(BaseModel):
    transaction_date: date
    transaction_time: Optional[str] = None
    direction: str
    amount: float = Field(..., gt=0)
    running_balance: float
    payment_source_name: str = "RBL"
    payment_mode: Optional[str] = None
    counterparty_identifier: Optional[str] = None
    narration: Optional[str] = None
    vendor_name: Optional[str] = None


def money(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def money_float(value) -> float:
    return float(money(value))


def normalized_direction(transaction: dict) -> str:
    return str(
        transaction.get("direction")
        or transaction.get("type")
        or ""
    ).strip().lower()


def summarize_balance_window(rows: list[dict]) -> dict:
    balance_rows = [
        row for row in rows
        if row.get("running_balance") is not None
    ]
    total_credit = Decimal("0.00")
    total_debit = Decimal("0.00")
    after_balances = set()
    before_balances = set()

    for row in balance_rows:
        amount = money(row.get("amount"))
        is_withdrawal = normalized_direction(row) == "withdrawal"
        signed_amount = -amount if is_withdrawal else amount
        running_balance = money(row.get("running_balance"))
        before_balance = running_balance - signed_amount
        before_balances.add(before_balance)
        after_balances.add(running_balance)
        if is_withdrawal:
            total_debit += amount
        else:
            total_credit += amount

    opening_candidates = sorted(before_balances - after_balances)
    closing_candidates = sorted(after_balances - before_balances)
    opening_balance = opening_candidates[0] if opening_candidates else Decimal("0.00")
    closing_balance = closing_candidates[-1] if closing_candidates else (
        money(balance_rows[-1].get("running_balance")) if balance_rows else Decimal("0.00")
    )
    net_movement = total_credit - total_debit
    calculated_closing = opening_balance + net_movement

    return {
        "transaction_count": len(rows),
        "balance_row_count": len(balance_rows),
        "opening_balance": money_float(opening_balance),
        "closing_balance": money_float(closing_balance),
        "total_debit": money_float(total_debit),
        "total_credit": money_float(total_credit),
        "net_movement": money_float(net_movement),
        "calculated_closing_balance": money_float(calculated_closing),
        "opening_component_count": len(opening_candidates),
        "closing_component_count": len(closing_candidates),
    }


def summarize_statement_transactions(transactions: list[dict]) -> dict:
    dated_transactions = [
        transaction
        for transaction in transactions
        if transaction.get("transaction_date") is not None
    ]
    source_names = sorted({
        str(transaction.get("payment_source_name") or "").strip().upper()
        for transaction in transactions
        if str(transaction.get("payment_source_name") or "").strip()
    })
    rows_with_balance = [
        transaction
        for transaction in transactions
        if transaction.get("running_balance") is not None
    ]

    if not dated_transactions:
        return {
            "source_names": source_names,
            "from_date": None,
            "to_date": None,
            "transaction_count": len(transactions),
            "rows_with_balance_count": len(rows_with_balance),
        }

    return {
        "source_names": source_names,
        "from_date": min(transaction["transaction_date"] for transaction in dated_transactions),
        "to_date": max(transaction["transaction_date"] for transaction in dated_transactions),
        "transaction_count": len(transactions),
        "rows_with_balance_count": len(rows_with_balance),
    }


def find_source_reconciliation(source_name: str, db: Session) -> dict | None:
    normalized_source = str(source_name or "").strip().upper()
    for row in get_balance_reconciliation(db):
        if str(row.get("source_name") or "").strip().upper() == normalized_source:
            return row
    return None


def normalize_optional_text(value: Optional[str]) -> Optional[str]:
    cleaned = str(value or "").strip()
    return cleaned or None


def build_manual_transaction(payload: ManualTransactionRequest) -> dict:
    source_name = str(payload.payment_source_name or "RBL").strip().upper() or "RBL"
    direction = str(payload.direction or "").strip().lower()
    if direction not in {"withdrawal", "credit"}:
        raise HTTPException(
            status_code=400,
            detail="Manual transaction direction must be withdrawal or credit.",
        )
    narration = normalize_optional_text(payload.narration)
    vendor_name = normalize_optional_text(payload.vendor_name)
    counterparty_identifier = (
        normalize_optional_text(payload.counterparty_identifier)
        or vendor_name
        or narration
        or "Manual entry"
    )
    return {
        "transaction_date": payload.transaction_date,
        "transaction_time": normalize_optional_text(payload.transaction_time),
        "type": direction,
        "amount": float(abs(payload.amount)),
        "running_balance": float(payload.running_balance),
        "payment_source_name": source_name,
        "payment_mode": normalize_optional_text(payload.payment_mode) or "manual",
        "counterparty_identifier": counterparty_identifier,
        "narration": narration or counterparty_identifier or "Manual statement entry",
        "vendor_name": vendor_name,
        "statement_sources": source_name,
    }


def build_statement_period_reconciliation(
    transactions: list[dict],
    statement_summary: dict,
    source_name: str,
    db: Session,
) -> dict | None:
    from_date = statement_summary.get("from_date")
    to_date = statement_summary.get("to_date")
    normalized_source = str(source_name or "").strip().upper()
    if not from_date or not to_date or not normalized_source:
        return None

    statement_window = summarize_balance_window(transactions)
    db_rows = db.execute(
        text(
            """
            SELECT
                transaction_date,
                transaction_time,
                lower(COALESCE(direction, '')) AS direction,
                ABS(COALESCE(amount, 0)) AS amount,
                running_balance
            FROM public.transactions
            WHERE payment_source_name = :source_name
              AND transaction_date BETWEEN :from_date AND :to_date
              AND running_balance IS NOT NULL
            ORDER BY transaction_date ASC, transaction_time ASC NULLS LAST, id ASC
            """
        ),
        {
            "source_name": normalized_source,
            "from_date": from_date,
            "to_date": to_date,
        },
    ).mappings().all()
    db_window = summarize_balance_window([dict(row) for row in db_rows])

    statement_closing = money(statement_window.get("closing_balance"))
    db_calculated_closing = money(statement_window.get("opening_balance")) + money(db_window.get("net_movement"))
    mismatch = db_calculated_closing - statement_closing
    row_count_delta = int(db_window.get("transaction_count", 0)) - int(statement_window.get("transaction_count", 0))
    component_count = max(
        int(db_window.get("opening_component_count", 0)),
        int(db_window.get("closing_component_count", 0)),
    )
    is_aligned = (
        abs(mismatch) <= Decimal("0.01")
        and row_count_delta == 0
        and component_count <= 1
    )

    return {
        "source_name": normalized_source,
        "from_date": from_date,
        "to_date": to_date,
        "is_aligned": is_aligned,
        "mismatch_amount": money_float(mismatch),
        "row_count_delta": row_count_delta,
        "statement": statement_window,
        "database": {
            **db_window,
            "calculated_closing_balance": money_float(db_calculated_closing),
        },
    }


def build_statement_checkpoint_reconciliation(
    transactions: list[dict],
    statement_summary: dict,
    source_name: str,
    db: Session,
) -> dict | None:
    to_date = statement_summary.get("to_date")
    normalized_source = str(source_name or "").strip().upper()
    if not to_date or not normalized_source:
        return None

    statement_window = summarize_balance_window(transactions)
    statement_closing_balance = money(statement_window.get("closing_balance"))
    db_rows = db.execute(
        text(
            """
            SELECT
                transaction_date,
                transaction_time,
                lower(COALESCE(direction, '')) AS direction,
                ABS(COALESCE(amount, 0)) AS amount,
                running_balance
            FROM public.transactions
            WHERE payment_source_name = :source_name
              AND transaction_date <= :to_date
              AND running_balance IS NOT NULL
            ORDER BY transaction_date ASC, transaction_time ASC NULLS LAST, id ASC
            """
        ),
        {
            "source_name": normalized_source,
            "to_date": to_date,
        },
    ).mappings().all()
    db_window = summarize_balance_window([dict(row) for row in db_rows])
    db_calculated_closing = money(db_window.get("calculated_closing_balance"))
    mismatch = db_calculated_closing - statement_closing_balance
    component_count = max(
        int(db_window.get("opening_component_count", 0)),
        int(db_window.get("closing_component_count", 0)),
    )
    is_aligned = abs(mismatch) <= Decimal("0.01") and component_count <= 1

    return {
        "source_name": normalized_source,
        "to_date": to_date,
        "is_aligned": is_aligned,
        "mismatch_amount": money_float(mismatch),
        "statement_closing_balance": money_float(statement_closing_balance),
        "database_calculated_closing_balance": money_float(db_calculated_closing),
        "database": db_window,
    }


@router.post("/manual_transaction")
def add_manual_transaction(
    payload: ManualTransactionRequest,
    db: Session = Depends(get_db),
):
    manual_transaction = build_manual_transaction(payload)
    insert_new_transactions([manual_transaction], db)
    db.commit()
    deduped_count = dedupe_exact_transaction_rows(db)
    source_backfill_count = backfill_transaction_sources(db)
    backfill_vendor_names_from_overlaps(db)
    auto_tagging_transactions(db)
    source_reconciliation = find_source_reconciliation(
        manual_transaction["payment_source_name"],
        db,
    )
    return {
        "success": True,
        "message": "Manual transaction added successfully.",
        "statement_source": manual_transaction["payment_source_name"],
        "transaction_count": 1,
        "inserted_count": 1,
        "deduped_count": deduped_count,
        "source_backfill_count": source_backfill_count,
        "source_reconciliation": source_reconciliation,
    }


@router.post("/statement")
def upload_statement(
    file: UploadFile = File(...),
    statement_source: str = Form(""),
    pdf_password: str = Form(""),
    db: Session = Depends(get_db)
):
    try:
        return _upload_statement_inner(file, statement_source, pdf_password, db)
    except Exception as exc:
        import logging, traceback
        logging.getLogger("app").error("Unhandled upload error: %s\n%s", exc, traceback.format_exc())
        return JSONResponse(status_code=500, content={
            "success": False,
            "error_code": "UPLOAD_ERROR",
            "message": f"Upload failed: {exc}",
        })


def _upload_statement_inner(file, statement_source, pdf_password, db):
    transactions = []

    filename = (file.filename or "").lower()
    if filename.endswith(".csv") or filename.endswith(".pdf"):
        file.file.seek(0)
        statement_bytes = file.file.read()
        transactions = parse_statement(
            BytesIO(statement_bytes),
            statement_source,
            pdf_password,
            filename=file.filename,
        )
        statement_bytes = b""
        if isinstance(transactions, dict):
            status_code = 400 if transactions.get("success") is False else 200
            return JSONResponse(status_code=status_code, content=transactions)
        if not isinstance(transactions, list):
            return {
                "success": False,
                "error_code": "PARSING_ERROR",
                "message": "Parsed statement did not return transaction rows.",
            }
        if not transactions:
            return {
                "success": False,
                "error_code": "PARSING_ERROR",
                "message": "No transactions could be extracted from this statement.",
            }
        statement_summary = summarize_statement_transactions(transactions)
        normalized_statement_source = str(statement_source or "").strip().upper()
        if normalized_statement_source == "RBL":
            alignment_summary = align_transactions_to_statement(transactions, db)
            write_summary = {
                "processed_count": len(transactions),
                "inserted_count": alignment_summary.get("inserted_count", 0),
                "merged_count": (
                    alignment_summary.get("matched_count", 0)
                    + alignment_summary.get("updated_count", 0)
                    + alignment_summary.get("retimed_count", 0)
                ),
                "skipped_count": 0,
                "alignment": alignment_summary,
            }
        else:
            write_summary = write_transactions_to_db(transactions, db)
        deduped_count = dedupe_exact_transaction_rows(db)
        source_backfill_count = backfill_transaction_sources(db)
        backfill_vendor_names_from_overlaps(db)
        auto_tagging_transactions(db)
        source_reconciliation = find_source_reconciliation(
            normalized_statement_source,
            db,
        )
        period_reconciliation = build_statement_period_reconciliation(
            transactions,
            statement_summary,
            normalized_statement_source,
            db,
        )
        checkpoint_reconciliation = build_statement_checkpoint_reconciliation(
            transactions,
            statement_summary,
            normalized_statement_source,
            db,
        )
        return {
            "success": True,
            "message": "Statement uploaded successfully.",
            "statement_source": normalized_statement_source,
            "statement_period": statement_summary,
            "period_reconciliation": period_reconciliation,
            "checkpoint_reconciliation": checkpoint_reconciliation,
            "source_reconciliation": source_reconciliation,
            "transaction_count": len(transactions),
            "inserted_count": write_summary.get("inserted_count", 0),
            "merged_count": write_summary.get("merged_count", 0),
            "skipped_count": write_summary.get("skipped_count", 0),
            "alignment": write_summary.get("alignment"),
            "deduped_count": deduped_count,
            "source_backfill_count": source_backfill_count,
        }
    else:
        return {
            "success": False,
            "error_code": "CUSTOMER_ERROR",
            "message": "Unsupported file format. Please upload a CSV or supported PDF file."
        }


# ── Receipt / Bill OCR upload ─────────────────────────────────────────────────

class ReceiptItemPayload(BaseModel):
    item_name: str
    amount: float = Field(..., gt=0)
    category: str = "Other"


class ReceiptConfirmRequest(BaseModel):
    store_name: str = ""
    date: date
    payment_source: str = "CASH"
    items: List[ReceiptItemPayload]


class _ReceiptLineItem:
    """Minimal object compatible with save_transaction_split line_items API."""

    def __init__(self, item_name: str, amount: float, category: str):
        self.item_name = item_name
        self.amount = amount
        self.category = category
        self.expense_for = "self"
        self.assignee = "self"
        self.id = None
        self.category_id = None
        self.subcategory_id = None
        self.line_kind = "itemized"
        self.owner_type = "self"
        self.primary_flow_type = "expense"


_RECEIPT_IMAGE_TYPES = {
    "image/jpeg", "image/jpg", "image/png",
    "image/bmp", "image/tiff", "image/webp",
}

# (#12) Keyword → category for auto-suggesting a category per scanned line item.
# Categories must match the frontend RECEIPT_CATEGORIES vocabulary. First match wins,
# so order more specific buckets (Dairy/Produce) before the generic Grocery/Food.
_RECEIPT_CATEGORY_KEYWORDS = {
    "Dairy": ["milk", "curd", "yogurt", "yoghurt", "paneer", "butter", "cheese", "ghee", "cream", "lassi"],
    "Vegetables": ["potato", "onion", "tomato", "spinach", "carrot", "cabbage", "brinjal", "capsicum", "cauliflower", "peas", "bhindi", "okra", "ginger", "garlic", "chilli", "veg"],
    "Fruits": ["apple", "banana", "mango", "orange", "grape", "papaya", "pomegranate", "watermelon", "guava", "fruit"],
    "Snacks": ["chips", "biscuit", "cookie", "namkeen", "kurkure", "lays", "snack", "chocolate", "wafer", "popcorn"],
    "Beverage": ["juice", "soda", "coke", "pepsi", "cola", "beer", "wine", "coffee", "tea", "redbull", "thums", "drink"],
    "Household": ["detergent", "soap", "cleaner", "tissue", "towel", "broom", "dishwash", "harpic", "phenyl", "garbage", "battery", "bulb"],
    "Personal Care": ["shampoo", "toothpaste", "brush", "razor", "lotion", "deodorant", "perfume", "sanitary", "handwash", "facewash", "conditioner"],
    "Health": ["tablet", "medicine", "syrup", "capsule", "ointment", "bandage", "mask", "sanitizer", "vitamin", "paracetamol", "dolo", "crocin"],
    "Grocery": ["rice", "atta", "flour", "dal", "sugar", "salt", "oil", "masala", "spice", "wheat", "pulse", "besan", "poha", "sooji", "maida"],
    "Food": ["bread", "egg", "pizza", "burger", "meal", "dosa", "roti", "paratha", "sandwich", "noodle", "pasta", "maggi", "chicken", "mutton", "fish"],
}


def _suggest_receipt_item_category(name: str) -> str:
    n = (name or "").lower()
    if not n.strip():
        return "Other"
    for cat, kws in _RECEIPT_CATEGORY_KEYWORDS.items():
        if any(k in n for k in kws):
            return cat
    return "Other"


@router.post("/receipt")
def extract_receipt(file: UploadFile = File(...)):
    content_type = (file.content_type or "").lower()
    filename = (file.filename or "").lower()
    is_image = content_type in _RECEIPT_IMAGE_TYPES or any(
        filename.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp")
    )
    if not is_image:
        return JSONResponse(status_code=400, content={
            "success": False,
            "message": "Unsupported format. Please upload a JPG or PNG image of the bill.",
        })
    image_bytes = file.file.read()
    result = parse_receipt(image_bytes)
    # (#12) Suggest a category per scanned line item so split rows pre-fill instead
    # of every item defaulting to "Other".
    if isinstance(result, dict):
        for it in (result.get("items") or []):
            if isinstance(it, dict) and not it.get("suggested_category"):
                it["suggested_category"] = _suggest_receipt_item_category(it.get("item_name", ""))
    return result


def _apply_category_tags(transaction_id, categories: list[str], db: Session) -> list[str]:
    """Find-or-create a system tag for each unique category, apply to the transaction.
    Returns the list of tag names that were applied."""
    unique_cats = sorted({c.strip() for c in categories if c and c.strip() and c.lower() != "other"})
    applied = []
    for cat in unique_cats:
        # Look up existing tag (case-insensitive, must be managed/active)
        existing = db.execute(
            text(
                """
                SELECT id FROM public.system_tags
                WHERE lower(name) = lower(:name)
                  AND COALESCE(managed_by_schema, FALSE) = TRUE
                  AND COALESCE(is_active, TRUE) = TRUE
                LIMIT 1
                """
            ),
            {"name": cat},
        ).mappings().first()

        if existing:
            tag_id = existing["id"]
        else:
            # Create tag — ON CONFLICT DO UPDATE so we always get the id back
            result = db.execute(
                text(
                    """
                    INSERT INTO public.system_tags (name, normalized, tag_type, is_active, managed_by_schema)
                    VALUES (:name, :normalized, 'USER', TRUE, TRUE)
                    ON CONFLICT (normalized) DO UPDATE SET is_active = TRUE, managed_by_schema = TRUE
                    RETURNING id
                    """
                ),
                {"name": cat, "normalized": cat.strip().lower()},
            ).mappings().first()
            if not result:
                continue
            tag_id = result["id"]

        db.execute(
            text(
                """
                INSERT INTO public.transaction_tags (transaction_id, tag_id, applied_by, applied_at)
                VALUES (:transaction_id, :tag_id, 'USER', NOW())
                ON CONFLICT (transaction_id, tag_id) DO NOTHING
                """
            ),
            {"transaction_id": transaction_id, "tag_id": tag_id},
        )
        applied.append(cat)

    if applied:
        db.commit()
    return applied


@router.get("/receipt/match")
def find_matching_transaction(
    amount: float,
    date: str,
    store: str = "",
    db: Session = Depends(get_db),
):
    """Search for an existing unclassified withdrawal transaction that matches
    the receipt by amount (±10%) and date (±1 day), ranked by relevance."""
    store_words = [w.lower() for w in (store or "").split() if len(w) > 2]
    rows = db.execute(
        text(
            """
            SELECT
                t.id,
                t.transaction_date,
                t.amount,
                t.direction,
                t.vendor_name,
                t.narration,
                t.payment_source_name,
                t.payment_mode,
                t.review_status,
                (SELECT COUNT(*) FROM public.transaction_splits ts WHERE ts.transaction_id = t.id) AS has_split
            FROM public.transactions t
            WHERE t.direction = 'withdrawal'
              AND ABS(t.amount - :amount) / GREATEST(t.amount, 1) <= 0.10
              AND t.transaction_date BETWEEN :date_from::date AND :date_to::date
              AND COALESCE(t.review_status, '') != 'confirmed'
            ORDER BY ABS(t.amount - :amount) ASC, ABS(t.transaction_date - :date::date) ASC
            LIMIT 5
            """
        ),
        {
            "amount": float(amount),
            "date": date,
            "date_from": date,
            "date_to": date,
        },
    ).mappings().all()

    results = []
    for row in rows:
        row_dict = dict(row)
        narration = str(row_dict.get("narration") or "").lower()
        vendor = str(row_dict.get("vendor_name") or "").lower()
        score = 0
        for word in store_words:
            if word in narration or word in vendor:
                score += 1
        results.append({**row_dict, "match_score": score, "id": str(row_dict["id"])})

    results.sort(key=lambda r: (-r["match_score"], abs(float(r["amount"]) - amount)))
    return {"matches": results}


class ReceiptLinkRequest(BaseModel):
    transaction_id: str
    items: List[ReceiptItemPayload]
    store_name: str = ""


@router.post("/receipt/link")
def link_receipt_to_transaction(payload: ReceiptLinkRequest, db: Session = Depends(get_db)):
    """Attach receipt line items to an existing transaction (UPI/card payment)."""
    if not payload.items:
        return JSONResponse(status_code=400, content={"success": False, "message": "No items provided."})

    total = sum(item.amount for item in payload.items)
    store_name = str(payload.store_name or "").strip() or "Store Purchase"

    line_item_objs = [
        _ReceiptLineItem(item_name=item.item_name, amount=item.amount, category=item.category)
        for item in payload.items
    ]

    save_transaction_split(
        transaction_id=payload.transaction_id,
        vendor_name=store_name,
        notes="Receipt linked",
        split_mode="itemized",
        total_amount=total,
        line_items=line_item_objs,
        db=db,
    )

    category_names = [item.category for item in payload.items]
    tags_applied = _apply_category_tags(payload.transaction_id, category_names, db)

    db.execute(
        text(
            """
            UPDATE public.transactions
            SET review_status = 'confirmed', primary_flow_type = 'expense',
                vendor_name = COALESCE(NULLIF(vendor_name, ''), :vendor_name)
            WHERE id = :id
            """
        ),
        {"id": payload.transaction_id, "vendor_name": store_name},
    )
    db.commit()

    auto_tagging_transactions(db)
    db.commit()

    return {
        "success": True,
        "message": "Receipt linked to existing transaction.",
        "transaction_id": payload.transaction_id,
        "total": float(total),
        "item_count": len(payload.items),
        "tags_applied": tags_applied,
    }


@router.post("/receipt/confirm")
def confirm_receipt(payload: ReceiptConfirmRequest, db: Session = Depends(get_db)):
    if not payload.items:
        return JSONResponse(status_code=400, content={
            "success": False,
            "message": "No items provided.",
        })

    total = sum(item.amount for item in payload.items)
    store_name = str(payload.store_name or "").strip() or "Store Purchase"
    source_name = str(payload.payment_source or "CASH").strip().upper() or "CASH"
    payment_mode = "cash" if source_name == "CASH" else "card"

    row = db.execute(
        text(
            """
            INSERT INTO public.transactions (
                transaction_date, amount, running_balance,
                counterparty_identifier, direction, payment_source_name,
                payment_mode, transaction_time, narration, vendor_name,
                statement_sources, primary_flow_type, review_status
            ) VALUES (
                :transaction_date, :amount, :running_balance,
                :counterparty_identifier, :direction, :payment_source_name,
                :payment_mode, :transaction_time, :narration, :vendor_name,
                :statement_sources, 'expense', 'confirmed'
            ) RETURNING id
            """
        ),
        {
            "transaction_date": payload.date,
            "amount": float(total),
            "running_balance": None,
            "counterparty_identifier": None,
            "direction": "withdrawal",
            "payment_source_name": source_name,
            "payment_mode": payment_mode,
            "transaction_time": None,
            "narration": store_name,
            "vendor_name": store_name,
            "statement_sources": source_name,
        },
    ).mappings().first()

    transaction_id = row["id"]
    db.flush()  # make the row visible within this session before FK references

    line_item_objs = [
        _ReceiptLineItem(
            item_name=item.item_name,
            amount=item.amount,
            category=item.category,
        )
        for item in payload.items
    ]

    save_transaction_split(
        transaction_id=transaction_id,
        vendor_name=store_name,
        notes="Receipt import",
        split_mode="itemized",
        total_amount=total,
        line_items=line_item_objs,
        db=db,
    )

    # Apply transaction-level tags from categories (these drive analytics/budget)
    category_names = [item.category for item in payload.items]
    tags_applied = _apply_category_tags(transaction_id, category_names, db)

    auto_tagging_transactions(db)
    db.commit()  # persist any tag writes from auto-tagging

    return {
        "success": True,
        "message": "Receipt saved successfully.",
        "transaction_id": str(transaction_id),
        "total": float(total),
        "item_count": len(payload.items),
        "tags_applied": tags_applied,
    }

