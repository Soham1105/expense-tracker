from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.database import get_db
from repositories.category_repo import (
    create_category,
    create_system_tag,
    create_subcategory,
    deactivate_category,
    deactivate_subcategory,
    get_category_details,
    get_node_tag_label,
    get_subcategory_details,
    get_subcategory_path,
    list_category_tree,
    list_system_tags,
    move_subcategory,
    rename_category,
    rename_subcategory,
    sync_category_tags,
)
from repositories.transaction_search import (
    _resolve_tag_id,
    add_new_narration,
    add_transaction_tags,
    backfill_counterparty_entities_from_transactions,
    clear_all_transaction_tags,
    count_counterparty_identifier_sql,
    find_related_transaction_ids,
    get_counterparty_entity_for_identifier,
    get_counterparty_learning_profile,
    is_linked_recovery_transaction,
    list_self_transfer_candidates_for_transaction,
    list_recovery_candidates_for_transaction,
    remove_transaction_tags,
    save_counterparty_entity_assignment,
    transaction_details,
    update_transaction_requirement_flags,
    update_transaction_review_fields,
)
from repositories.transaction_split_repo import (
    delete_transaction_split,
    save_split_recovery_link,
    get_split_with_line_items,
    save_transaction_split,
)

templates = Jinja2Templates(directory=str(Path(__file__).resolve().parents[1] / "templates"))
templates.env.auto_reload = True
classification_router = APIRouter(prefix="/classification", tags=["classification"])


class CategoryCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None


class SubcategoryCreateRequest(BaseModel):
    category_id: str
    parent_subcategory_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    color: Optional[str] = None


class RenameTagRequest(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None


class MoveSubcategoryRequest(BaseModel):
    target_category_id: str
    target_parent_subcategory_id: Optional[str] = None


class SimpleClassificationRequest(BaseModel):
    transaction_id: str
    vendor_name: Optional[str] = None
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    review_status: Optional[str] = None
    review_status_manual: bool = False
    no_tag_required: bool = False
    apply_to_similar_transactions: bool = False
    counterparty_identifier: Optional[str] = None
    self_transfer_transaction_id: Optional[str] = None
    counterparty_type: Optional[str] = None
    primary_flow_type: Optional[str] = None
    consumption_ownership: Optional[str] = None
    settlement_state: Optional[str] = None


ALLOWED_REVIEW_STATUSES = {
    "confirmed",
    "needs_review",
    "unknown",
    "no_action_needed",
    "unreviewed",
}


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

    # Total recovered across ALL linked recoveries (regardless of split_line_item_id).
    # Recovery rows are frequently saved with split_line_item_id=None, so per-item
    # keying misses them entirely. Using totals is correct and more robust.
    total_recovered = sum(Decimal(str(r.get("amount") or 0)) for r in recoveries)

    if split_mode == "quick":
        # "quick" = split by person. Non-self items are what need recovery.
        non_self_items = [item for item in line_items if not _is_self_split_item(item)]
        total_owed = sum(Decimal(str(abs(item.get("amount") or 0))) for item in non_self_items)
        if total_owed <= Decimal("0.00"):
            return "confirmed"
        return "confirmed" if (total_owed - total_recovered) <= Decimal("0.01") else "needs_review"

    elif split_mode == "itemized":
        # "itemized" = split by item. Only "refund" line_kind rows need recovery.
        refund_rows = [
            item for item in line_items
            if str(item.get("line_kind") or item.get("expense_for") or "").strip().lower() == "refund"
        ]
        # Per-item matching first, unassigned pool covers remainder.
        recovered_by_item: dict = {}
        unassigned_pool = Decimal("0.00")
        for r in recoveries:
            lid = str(r.get("split_line_item_id") or "")
            amt = Decimal(str(r.get("amount") or 0))
            if lid:
                recovered_by_item[lid] = recovered_by_item.get(lid, Decimal("0.00")) + amt
            else:
                unassigned_pool += amt

        remaining_pool = unassigned_pool
        for item in refund_rows:
            row_amount = Decimal(str(abs(item.get("amount") or 0)))
            if row_amount <= Decimal("0.00"):
                continue
            recovered = recovered_by_item.get(str(item.get("id") or ""), Decimal("0.00"))
            shortfall = row_amount - recovered
            if shortfall > Decimal("0.01"):
                cover = min(remaining_pool, shortfall)
                remaining_pool -= cover
                shortfall -= cover
            if shortfall > Decimal("0.01"):
                return "needs_review"
        return "confirmed"

    return "confirmed"


def _normalize_split_consumption_bucket(value: Optional[str]) -> Optional[str]:
    normalized = str(value or "").strip().lower().replace("/", "_").replace(" ", "_")
    if not normalized:
        return None
    if normalized in {"self", "my_share", "myshare"}:
        return "self"
    if normalized in {"family", "family_household", "household"}:
        return "family_household"
    if normalized in {"shared"}:
        return "shared"
    if normalized in {"business", "office", "work"}:
        return "business"
    if normalized in {"other", "friend", "friends"}:
        return "other"
    return None


def _derive_split_consumption_ownership(mode: str, line_items: List[dict]) -> Optional[str]:
    positive_rows = []
    refund_rows = 0

    for item in line_items or []:
        amount = Decimal(str(item.get("amount") or 0))
        if amount <= Decimal("0.00"):
            continue
        line_kind = str(item.get("line_kind") or "").strip().lower()
        expense_for = str(item.get("expense_for") or "").strip().lower()
        if line_kind == "refund" or expense_for == "refund":
            refund_rows += 1
            continue
        positive_rows.append(item)

    if not positive_rows:
        return "not_consumption" if refund_rows else None

    if str(mode or "").strip().lower() == "person":
        has_self = any(_is_self_split_item(item) for item in positive_rows)
        has_other = any(not _is_self_split_item(item) for item in positive_rows)
        if has_self and has_other:
            return "shared"
        if has_self:
            return "self"
        return "other"

    owner_buckets = {
        bucket
        for bucket in (
            _normalize_split_consumption_bucket(item.get("owner_type") or item.get("expense_for"))
            for item in positive_rows
        )
        if bucket
    }
    if not owner_buckets:
        return None
    if len(owner_buckets) == 1:
        return next(iter(owner_buckets))
    return "shared"


def _derive_split_primary_flow_type(original_details: Optional[dict], line_items: List[dict]) -> Optional[str]:
    existing_flow = str((original_details or {}).get("primary_flow_type") or "").strip().lower()
    if existing_flow and existing_flow != "expense":
        return existing_flow

    has_amount = any(Decimal(str(item.get("amount") or 0)) > Decimal("0.00") for item in (line_items or []))
    if not has_amount:
        return existing_flow or None

    # Split rows model how an outgoing transaction should be allocated.
    # Recoverable portions stay part of the expense; later linked transactions
    # can represent refunds or repayments explicitly.
    return "expense"


def _derive_split_settlement_state(transaction_id: str, db: Session) -> Optional[str]:
    split_data = get_split_with_line_items(transaction_id, db)
    if not split_data:
        return None

    split_mode = str(split_data.get("split", {}).get("split_mode") or "").strip().lower()
    line_items = split_data.get("line_items") or []
    recoveries = split_data.get("recoveries") or []
    recovered_by_line_item = {}
    for recovery in recoveries:
        key = str(recovery.get("split_line_item_id") or "")
        recovered_by_line_item[key] = recovered_by_line_item.get(key, Decimal("0.00")) + Decimal(
            str(recovery.get("amount") or 0)
        )

    tracked_rows = []
    if split_mode == "quick":
        tracked_rows = [item for item in line_items if not _is_self_split_item(item)]
    elif split_mode == "itemized":
        tracked_rows = [
            item
            for item in line_items
            if str(item.get("line_kind") or item.get("expense_for") or "").strip().lower() == "refund"
        ]

    if not tracked_rows:
        return "none"

    outstanding_total = Decimal("0.00")
    recovered_total = Decimal("0.00")
    tracked_total = Decimal("0.00")
    for item in tracked_rows:
        row_amount = Decimal(str(abs(item.get("amount") or 0)))
        if row_amount <= Decimal("0.00"):
            continue
        tracked_total += row_amount
        recovered_amount = recovered_by_line_item.get(str(item.get("id") or ""), Decimal("0.00"))
        recovered_total += recovered_amount
        outstanding_total += max(Decimal("0.00"), row_amount - recovered_amount)

    if tracked_total <= Decimal("0.00"):
        return "none"
    if outstanding_total <= Decimal("0.01"):
        return "settled"
    if recovered_total > Decimal("0.00"):
        return "partial"
    return "owed_to_me"


def _normalize_review_status(value: Optional[str]) -> str:
    normalized = (value or "").strip().lower()
    if normalized == "done":
        normalized = "confirmed"
    if normalized in ALLOWED_REVIEW_STATUSES:
        return normalized
    return "unreviewed"


def _derive_simple_review_status(payload: SimpleClassificationRequest, original_details: Optional[dict] = None):
    explicit_status = _normalize_review_status(payload.review_status)
    if payload.review_status_manual:
        return explicit_status, True

    original_details = original_details or {}
    has_category_decision = bool(
        (payload.category_id or "").strip()
        or (payload.subcategory_id or "").strip()
        or payload.no_tag_required
    )
    has_vendor = bool(
        (payload.vendor_name or "").strip()
        or (original_details.get("vendor_name") or "").strip()
        or (original_details.get("counterparty_entity_name") or "").strip()
    )
    has_nature = bool((payload.primary_flow_type or "").strip() or (original_details.get("primary_flow_type") or "").strip())
    has_party = bool((payload.counterparty_type or "").strip() or (original_details.get("counterparty_type") or "").strip())
    has_self_transfer = bool((payload.self_transfer_transaction_id or "").strip())

    if has_self_transfer or payload.no_tag_required or (has_vendor and (has_category_decision or has_party or has_nature)):
        return "confirmed", False
    if has_category_decision or has_vendor or has_nature or has_party:
        return "needs_review", False
    if not has_category_decision and not has_vendor and not has_nature and not has_party:
        return "unknown", False
    return "needs_review", False


def _coalesce_text_value(*values: Optional[str]) -> Optional[str]:
    for value in values:
        normalized = (value or "").strip()
        if normalized:
            return normalized
    return None


def _derive_counterparty_type(
    payload: SimpleClassificationRequest,
    original_details: Optional[dict] = None,
) -> Optional[str]:
    original_details = original_details or {}
    if payload.counterparty_type is not None:
        return (payload.counterparty_type or "").strip().lower() or None
    return _coalesce_text_value(
        original_details.get("counterparty_type"),
        original_details.get("counterparty_entity_type"),
    )


def _derive_primary_flow_type(
    payload: SimpleClassificationRequest,
    original_details: Optional[dict] = None,
) -> Optional[str]:
    original_details = original_details or {}
    if payload.primary_flow_type is not None:
        return (payload.primary_flow_type or "").strip().lower() or None
    return _coalesce_text_value(original_details.get("primary_flow_type"))


def _derive_consumption_ownership(
    payload: SimpleClassificationRequest,
    original_details: Optional[dict] = None,
) -> Optional[str]:
    original_details = original_details or {}
    if payload.consumption_ownership is not None:
        return (payload.consumption_ownership or "").strip().lower() or None

    existing_value = _coalesce_text_value(original_details.get("consumption_ownership"))
    if existing_value:
        return existing_value.lower()

    primary_flow_type = _derive_primary_flow_type(payload, original_details)
    if primary_flow_type == "transfer":
        return "not_consumption"
    return None


def _derive_settlement_state(
    payload: SimpleClassificationRequest,
    original_details: Optional[dict] = None,
) -> Optional[str]:
    original_details = original_details or {}
    if payload.settlement_state is not None:
        return (payload.settlement_state or "").strip().lower() or None

    existing_value = _coalesce_text_value(original_details.get("settlement_state"))
    if existing_value:
        return existing_value.lower()
    return None


def _maybe_link_simple_self_transfer(
    payload: SimpleClassificationRequest,
    original_details: dict,
    db: Session,
):
    target_id = (payload.self_transfer_transaction_id or "").strip()
    if not target_id:
        return None

    target_details = transaction_details(UUID(target_id), db)
    if not target_details:
        raise ValueError("Selected self transfer transaction was not found.")
    if is_linked_recovery_transaction(target_id, db):
        raise ValueError("Selected self transfer transaction is already linked elsewhere.")

    original_id = str(payload.transaction_id)
    original_direction = str(original_details.get("direction") or "").strip().lower()
    target_direction = str(target_details.get("direction") or "").strip().lower()
    if original_direction == target_direction:
        raise ValueError("Self transfer link needs one debit and one credit transaction.")

    original_amount = Decimal(str(abs(original_details.get("amount") or 0))).quantize(Decimal("0.01"))
    target_amount = Decimal(str(abs(target_details.get("amount") or 0))).quantize(Decimal("0.01"))
    if abs(original_amount - target_amount) > Decimal("0.01"):
        raise ValueError("Self transfer pair must have the same amount.")

    base_details = original_details if original_direction == "withdrawal" else target_details
    base_transaction_id = original_id if original_direction == "withdrawal" else target_id
    linked_transaction_id = target_id if original_direction == "withdrawal" else original_id

    delete_transaction_split(base_transaction_id, db)
    split_result = save_transaction_split(
        transaction_id=base_transaction_id,
        vendor_name=(base_details.get("vendor_name") or payload.vendor_name or "").strip() or None,
        notes="Self transfer",
        split_mode="self_transfer",
        total_amount=float(original_amount),
        line_items=[],
        db=db,
    )
    save_split_recovery_link(
        split_id=split_result["split_id"],
        split_line_item_id=None,
        recovery_transaction_id=linked_transaction_id,
        recovery_type="Self Transfer",
        amount=original_amount,
        notes="Self transfer",
        db=db,
    )
    update_transaction_requirement_flags(
        base_transaction_id,
        db,
        no_split_required=True,
    )
    update_transaction_requirement_flags(linked_transaction_id, db, no_tag_required=True, no_split_required=True)
    clear_all_transaction_tags(linked_transaction_id, db)
    update_transaction_review_fields(
        base_transaction_id,
        db,
        review_status="confirmed",
        review_status_manual=False,
        counterparty_type=None,
        primary_flow_type="transfer",
        consumption_ownership="not_consumption",
        settlement_state="none",
    )
    update_transaction_review_fields(
        linked_transaction_id,
        db,
        review_status="confirmed",
        review_status_manual=False,
        counterparty_type=None,
        primary_flow_type="transfer",
        consumption_ownership="not_consumption",
        settlement_state="none",
    )
    return {
        "base_transaction_id": base_transaction_id,
        "linked_transaction_id": linked_transaction_id,
    }


class ClassificationSplitLineItem(BaseModel):
    id: Optional[str] = None
    item_name: Optional[str] = None
    expense_for: Optional[str] = None
    amount: float
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    line_kind: Optional[str] = None
    owner_type: Optional[str] = None
    primary_flow_type: Optional[str] = None


class SplitClassificationRequest(BaseModel):
    transaction_id: str
    vendor_name: Optional[str] = None
    notes: Optional[str] = None
    mode: str
    no_split_required: bool = False
    line_items: List[ClassificationSplitLineItem] = []


def _apply_tag_payload(
    transaction_ids: List[str],
    vendor_name: Optional[str],
    tag_names: List[str],
    no_tag_required: bool,
    db: Session,
):
    normalized_tags = [tag.strip() for tag in tag_names if tag and tag.strip()]
    for transaction_id in transaction_ids:
        transaction_uuid = transaction_id if isinstance(transaction_id, UUID) else UUID(str(transaction_id))
        transaction_id_str = str(transaction_uuid)
        existing = transaction_details(transaction_uuid, db)
        if not existing:
            continue  # skip if transaction no longer exists (e.g. stale apply_to_similar list)
        current_tags = set(existing.get("tag_names") or [])
        next_tags = set([] if no_tag_required else normalized_tags)
        update_transaction_requirement_flags(
            transaction_id_str,
            db,
            no_tag_required=no_tag_required,
        )
        tags_to_add = next_tags - current_tags
        tags_to_remove = current_tags - next_tags
        if tags_to_add:
            add_transaction_tags(tags_to_add, transaction_id_str, db)
        if tags_to_remove:
            remove_transaction_tags(tags_to_remove, transaction_id_str, db)
        if no_tag_required:
            clear_all_transaction_tags(transaction_id_str, db)
        if vendor_name:
            add_new_narration(transaction_id_str, vendor_name, db)


@classification_router.get("/manage")
def manage_categories(request: Request, db: Session = Depends(get_db)):
    try:
        tags = list_system_tags(db)
    except Exception:
        tags = []
    return templates.TemplateResponse(
        request,
        "category_manager.html",
        {
            "categories": list_category_tree(db),
            "tags": tags,
        },
    )


@classification_router.get("/tags")
def manage_tags(request: Request, db: Session = Depends(get_db)):
    return RedirectResponse(url="/classification/manage", status_code=307)


@classification_router.get("/transaction/{txn_id}")
def classification_page(txn_id: UUID, request: Request):
    return templates.TemplateResponse(
        request,
        "transaction_classification.html",
        {
            "transaction_id": str(txn_id),
        },
    )


@classification_router.get("/api/categories/by_usage")
def get_categories_by_usage(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT
            c.id::text AS id,
            c.name,
            COUNT(DISTINCT tt.transaction_id) AS usage
        FROM public.categories c
        LEFT JOIN public.system_tags st ON lower(st.name) = lower(c.name)
        LEFT JOIN public.transaction_tags tt ON tt.tag_id = st.id
        WHERE c.is_active = TRUE
        GROUP BY c.id, c.name
        ORDER BY COUNT(DISTINCT tt.transaction_id) DESC, c.name ASC
    """)).mappings().all()
    data = [{"id": row["id"], "name": row["name"]} for row in rows]
    return {"success": True, "data": data}


@classification_router.get("/api/categories")
def category_tree_api(db: Session = Depends(get_db)):
    return {"success": True, "data": list_category_tree(db)}


@classification_router.post("/api/categories")
def create_category_api(payload: CategoryCreateRequest, db: Session = Depends(get_db)):
    if not payload.name.strip():
        return {"success": False, "message": "Category name is required."}
    try:
        return {"success": True, "data": create_category(payload.name, payload.description, db, color=payload.color)}
    except Exception as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})


@classification_router.post("/api/subcategories")
def create_subcategory_api(payload: SubcategoryCreateRequest, db: Session = Depends(get_db)):
    if not payload.name.strip():
        return {"success": False, "message": "Subcategory name is required."}
    try:
        return {
            "success": True,
            "data": create_subcategory(
                payload.category_id,
                payload.name,
                payload.description,
                db,
                parent_subcategory_id=payload.parent_subcategory_id,
                color=payload.color,
            ),
        }
    except Exception as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})


@classification_router.post("/api/categories/{category_id}/delete")
def delete_category_api(category_id: str, db: Session = Depends(get_db)):
    try:
        deactivate_category(category_id, db)
        return {"success": True}
    except Exception as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})


class CategoryColorRequest(BaseModel):
    color: str


@classification_router.post("/api/categories/{category_id}/color")
def update_category_color_api(
    category_id: str, payload: CategoryColorRequest, db: Session = Depends(get_db)
):
    color = (payload.color or "").strip()
    if not color.startswith("#") or len(color) not in (4, 7):
        return {"success": False, "message": "Invalid color format."}
    db.execute(
        text("UPDATE public.categories SET color = :color WHERE id = CAST(:id AS uuid)"),
        {"color": color, "id": category_id},
    )
    db.commit()
    return {"success": True, "data": {"id": category_id, "color": color}}


@classification_router.post("/api/categories/{category_id}/rename")
def rename_category_api(
    category_id: str, payload: RenameTagRequest, db: Session = Depends(get_db)
):
    if not payload.name.strip():
        return {"success": False, "message": "Category name is required."}
    try:
        return {
            "success": True,
            "data": rename_category(category_id, payload.name, payload.description, db, color=payload.color),
        }
    except Exception as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})


@classification_router.post("/api/subcategories/{subcategory_id}/delete")
def delete_subcategory_api(subcategory_id: str, db: Session = Depends(get_db)):
    try:
        deactivate_subcategory(subcategory_id, db)
        return {"success": True}
    except Exception as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})


@classification_router.post("/api/subcategories/{subcategory_id}/color")
def update_subcategory_color_api(
    subcategory_id: str, payload: CategoryColorRequest, db: Session = Depends(get_db)
):
    color = (payload.color or "").strip()
    if not color.startswith("#") or len(color) not in (4, 7):
        return {"success": False, "message": "Invalid color format."}
    db.execute(
        text("UPDATE public.subcategories SET color = :color WHERE id = CAST(:id AS uuid)"),
        {"color": color, "id": subcategory_id},
    )
    db.commit()
    return {"success": True, "data": {"id": subcategory_id, "color": color}}


@classification_router.post("/api/subcategories/{subcategory_id}/rename")
def rename_subcategory_api(
    subcategory_id: str, payload: RenameTagRequest, db: Session = Depends(get_db)
):
    if not payload.name.strip():
        return {"success": False, "message": "Subcategory name is required."}
    try:
        return {
            "success": True,
            "data": rename_subcategory(subcategory_id, payload.name, payload.description, db, color=payload.color),
        }
    except Exception as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})


@classification_router.post("/api/subcategories/{subcategory_id}/move")
def move_subcategory_api(
    subcategory_id: str, payload: MoveSubcategoryRequest, db: Session = Depends(get_db)
):
    try:
        result = move_subcategory(
            subcategory_id,
            payload.target_category_id,
            payload.target_parent_subcategory_id,
            db,
        )
        return {"success": True, "data": result}
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})
    except Exception as exc:
        db.rollback()
        return JSONResponse(status_code=500, content={"success": False, "message": str(exc)})


@classification_router.get("/api/tags")
def tags_api(db: Session = Depends(get_db)):
    return {"success": True, "data": list_system_tags(db)}


class TagCreateRequest(BaseModel):
    name: str


@classification_router.post("/api/tags")
def create_tag(payload: TagCreateRequest, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Tag name is required.")
    try:
        tag = create_system_tag(name, db, tag_type="USER")
        return {"success": True, "data": {"id": tag["id"], "name": tag["name"]}}
    except Exception as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})


@classification_router.post("/api/tags/{tag_id}/delete")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    result = db.execute(text("""
        UPDATE public.system_tags SET is_active = FALSE
        WHERE id = :id AND tag_type = 'USER' AND managed_by_schema = TRUE
    """), {"id": tag_id})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Tag not found or not deletable.")
    return {"success": True}


class TagRenameRequest2(BaseModel):
    name: str


@classification_router.post("/api/tags/{tag_id}/rename")
def rename_tag(tag_id: int, payload: TagRenameRequest2, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name required.")
    row = db.execute(text("""
        UPDATE public.system_tags SET name = :name
        WHERE id = :id AND tag_type = 'USER' AND managed_by_schema = TRUE AND is_active = TRUE
        RETURNING id, name
    """), {"id": tag_id, "name": name}).mappings().first()
    db.commit()
    if not row:
        raise HTTPException(404, "Tag not found.")
    return {"success": True, "data": dict(row)}


class TagMergeRequest(BaseModel):
    source_tag_id: int   # tag to absorb / delete
    target_tag_id: int   # tag to keep


@classification_router.post("/api/tags/merge")
def merge_tags(payload: TagMergeRequest, db: Session = Depends(get_db)):
    src, tgt = payload.source_tag_id, payload.target_tag_id
    if src == tgt:
        return {"success": False, "message": "Source and target must be different."}
    from sqlalchemy import text as _text
    try:
        # Validate both tags exist
        exists = db.execute(_text("""
            SELECT COUNT(*) FROM public.system_tags
            WHERE id IN (:src, :tgt) AND is_active = TRUE
        """), {"src": src, "tgt": tgt}).scalar_one()
        if exists < 2:
            return {"success": False, "message": "One or both tags not found."}
        # Re-point all transaction_tags from source → target (skip duplicates)
        db.execute(_text("""
            UPDATE public.transaction_tags
            SET tag_id = :tgt
            WHERE tag_id = :src
              AND NOT EXISTS (
                  SELECT 1 FROM public.transaction_tags t2
                  WHERE t2.transaction_id = transaction_tags.transaction_id
                    AND t2.tag_id = :tgt
              )
        """), {"src": src, "tgt": tgt})
        # Remove leftover source tags (were duplicates)
        db.execute(_text("DELETE FROM public.transaction_tags WHERE tag_id = :src"), {"src": src})
        # Deactivate the source system_tag
        db.execute(_text("UPDATE public.system_tags SET is_active = FALSE WHERE id = :src"), {"src": src})
        moved = db.execute(_text(
            "SELECT COUNT(*) FROM public.transaction_tags WHERE tag_id = :tgt"
        ), {"tgt": tgt}).scalar_one()
        db.commit()
        return {"success": True, "message": f"Merged. Target tag now on {moved} transactions."}
    except Exception as e:
        db.rollback()
        return {"success": False, "message": str(e)}


@classification_router.get("/api/context/{txn_id}")
def classification_context(txn_id: UUID, db: Session = Depends(get_db)):
    try:
        backfill_counterparty_entities_from_transactions(db)
        try:
            details = transaction_details(txn_id, db)
        except Exception:
            return {"success": False, "message": "Transaction not found."}
        if not details:
            return {"success": False, "message": "Transaction not found."}
        counterparty_identifier = details.get("counterparty_identifier")
        if counterparty_identifier:
            entity = get_counterparty_entity_for_identifier(counterparty_identifier, db)
            if entity:
                details["counterparty_entity_name"] = entity.get("entity_name")
                details["counterparty_entity_type"] = entity.get("entity_type")
            details["counterparty_count"] = count_counterparty_identifier_sql(
                counterparty_identifier, db
            )
        details["learned_defaults"] = get_counterparty_learning_profile(
            txn_id, counterparty_identifier, db
        )
        details["self_transfer_candidates"] = list_self_transfer_candidates_for_transaction(
            str(txn_id), db
        )
        split_data = get_split_with_line_items(str(txn_id), db)
        return {
            "success": True,
            "data": {
                "transaction": details,
                "split": split_data,
                "categories": list_category_tree(db),
                "recovery_candidates": list_recovery_candidates_for_transaction(str(txn_id), db),
            },
        }
    except Exception as exc:
        db.rollback()
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": f"Internal Server Error: {exc}"},
        )


@classification_router.get("/api/recovery_candidates/{txn_id}")
def recovery_candidates(txn_id: UUID, db: Session = Depends(get_db)):
    return {
        "success": True,
        "data": list_recovery_candidates_for_transaction(str(txn_id), db),
    }


@classification_router.get("/api/insights/{txn_id}")
def classification_insights(txn_id: UUID, db: Session = Depends(get_db)):
    """Read-only signals for the classify page:
    (#3) a category guess from this counterparty's history,
    (#4) how many similar txns 'Apply to similar' would touch,
    (#8) amount-in-context vs the usual spend at this counterparty."""
    try:
        details = transaction_details(txn_id, db)
        if not details:
            return {"success": False, "message": "Transaction not found."}
        ci = (details.get("counterparty_identifier") or "").strip()
        amount = abs(float(details.get("amount") or 0))

        # (#4) exactly what apply_to_similar would target, excluding this txn.
        similar_ids = find_related_transaction_ids(ci, db) if ci else []
        similar_count = len([i for i in similar_ids if str(i) != str(txn_id)])

        suggestion = None
        amount_ctx = None
        if ci:
            # (#3) most-common leaf category among other txns at this counterparty.
            row = db.execute(
                text(
                    """
                    SELECT st.name AS name,
                           st.subcategory_id::text AS subcategory_id,
                           st.category_id::text AS category_id,
                           COUNT(*) AS n
                    FROM public.transactions t
                    JOIN public.transaction_tags tt ON tt.transaction_id = t.id
                    JOIN public.system_tags st ON st.id = tt.tag_id
                    WHERE lower(COALESCE(t.counterparty_identifier, '')) = lower(:ci)
                      AND t.id <> :txn_id
                      AND st.subcategory_id IS NOT NULL
                    GROUP BY st.name, st.subcategory_id, st.category_id
                    ORDER BY n DESC, st.name ASC
                    LIMIT 1
                    """
                ),
                {"ci": ci, "txn_id": str(txn_id)},
            ).mappings().first()
            if row and row["n"]:
                label = get_node_tag_label(db, subcategory_id=row["subcategory_id"]) or row["name"]
                suggestion = {
                    "label": label,
                    "subcategory_id": row["subcategory_id"],
                    "category_id": row["category_id"],
                    "count": int(row["n"]),
                }

            # (#8) median spend at this counterparty (need a few samples to matter).
            med = db.execute(
                text(
                    """
                    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ABS(amount)) AS median,
                           COUNT(*) AS n
                    FROM public.transactions
                    WHERE lower(COALESCE(counterparty_identifier, '')) = lower(:ci)
                      AND id <> :txn_id
                      AND ABS(amount) > 0
                    """
                ),
                {"ci": ci, "txn_id": str(txn_id)},
            ).mappings().first()
            if med and (med["n"] or 0) >= 3 and med["median"]:
                median = float(med["median"])
                if median > 0:
                    ratio = amount / median
                    amount_ctx = {
                        "median": median,
                        "ratio": ratio,
                        "samples": int(med["n"]),
                        "is_anomaly": bool(ratio >= 2.5 and amount >= 500),
                    }

        return {
            "success": True,
            "data": {
                "similar_count": similar_count,
                "suggestion": suggestion,
                "amount": amount_ctx,
            },
        }
    except Exception as exc:
        db.rollback()
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": f"Internal Server Error: {exc}"},
        )


@classification_router.get("/api/next_unreviewed")
def next_unreviewed(exclude: Optional[str] = None, db: Session = Depends(get_db)):
    """Fallback for the Save & Next workflow: the next transaction still needing
    review (needs_review first, then unreviewed), most recent first."""
    params = {}
    where_exclude = ""
    if exclude:
        try:
            params["exclude"] = str(UUID(exclude))
            where_exclude = "AND id <> :exclude"
        except (ValueError, AttributeError):
            pass
    row = db.execute(
        text(
            f"""
            SELECT id::text AS id
            FROM public.transactions
            WHERE COALESCE(review_status, '') IN ('needs_review', 'unreviewed', 'unknown', '')
              AND COALESCE(no_tag_required, FALSE) = FALSE
              {where_exclude}
            ORDER BY (review_status = 'needs_review') DESC, transaction_date DESC, id DESC
            LIMIT 1
            """
        ),
        params,
    ).mappings().first()
    return {"success": True, "data": {"transaction_id": row["id"] if row else None}}


@classification_router.post("/api/simple")
def save_simple_classification(
    payload: SimpleClassificationRequest, db: Session = Depends(get_db)
):
    if is_linked_recovery_transaction(payload.transaction_id, db):
        return {"success": False, "message": "Settlement transactions cannot be reclassified."}

    original_details = transaction_details(UUID(payload.transaction_id), db)
    if not original_details:
        return {"success": False, "message": "Transaction not found."}

    normalized_vendor_name = (payload.vendor_name or "").strip() or None
    normalized_counterparty_identifier = (payload.counterparty_identifier or "").strip() or None
    if (payload.self_transfer_transaction_id or "").strip():
        payload.counterparty_type = None
        payload.primary_flow_type = "transfer"
        payload.consumption_ownership = "not_consumption"
        payload.settlement_state = "none"

    # Normalize primary_flow_type against actual transaction direction.
    # Silently correct impossible combinations (e.g. cashback on a withdrawal)
    # rather than raising an error, so old bad data is fixed on next save.
    _CREDIT_ONLY_FLOW_TYPES = {"cashback", "income", "refund", "investment_sell", "loan_taken", "repayment_in"}
    _DEBIT_ONLY_FLOW_TYPES  = {"expense", "investment_buy", "loan_given", "repayment_out", "fee"}
    _tx_direction = str(original_details.get("direction") or "").strip().lower()
    if payload.primary_flow_type and not (payload.self_transfer_transaction_id or "").strip():
        _pft = payload.primary_flow_type.strip().lower()
        if _tx_direction == "withdrawal" and _pft in _CREDIT_ONLY_FLOW_TYPES:
            payload.primary_flow_type = "expense"
        elif _tx_direction != "withdrawal" and _pft in _DEBIT_ONLY_FLOW_TYPES:
            payload.primary_flow_type = "income"

    payload.counterparty_type = _derive_counterparty_type(payload, original_details)
    payload.primary_flow_type = _derive_primary_flow_type(payload, original_details)
    payload.consumption_ownership = _derive_consumption_ownership(payload, original_details)
    payload.settlement_state = _derive_settlement_state(payload, original_details)

    entity_assignment = None
    if normalized_vendor_name and normalized_counterparty_identifier and (payload.counterparty_type or "").strip():
        entity_assignment = save_counterparty_entity_assignment(
            normalized_counterparty_identifier,
            normalized_vendor_name,
            payload.counterparty_type,
            db,
        )
        if entity_assignment:
            original_details["counterparty_entity_name"] = entity_assignment["entity_name"]
            original_details["counterparty_entity_type"] = entity_assignment["entity_type"]

    resolved_review_status, resolved_review_status_manual = _derive_simple_review_status(
        payload,
        original_details,
    )

    tag_names: List[str] = []
    if not payload.no_tag_required:
        if payload.subcategory_id:
            subcategory = get_subcategory_details(payload.subcategory_id, db)
            if not subcategory:
                return {"success": False, "message": "Selected subcategory was not found."}
            path = get_subcategory_path(payload.subcategory_id, db)
            # Use the node-bound tag label per node id (collision-aware) so picking
            # "Vehicle > 4-wheeler > petrol" applies the 4-wheeler petrol tag, not
            # a same-named leaf under another parent.
            cat_label = get_node_tag_label(db, category_id=subcategory["category_id"]) or subcategory["category_name"]
            path_labels = [get_node_tag_label(db, subcategory_id=node["id"]) or node["name"] for node in path]
            tag_names = [cat_label, *path_labels]
        elif payload.category_id:
            category = get_category_details(payload.category_id, db)
            if not category:
                return {"success": False, "message": "Selected category was not found."}
            tag_names = [get_node_tag_label(db, category_id=category["category_id"]) or category["category_name"]]
        elif resolved_review_status == "confirmed" and not (payload.self_transfer_transaction_id or "").strip():
            return {"success": False, "message": "Choose a category before saving."}

    transaction_ids = [payload.transaction_id]
    if payload.apply_to_similar_transactions and normalized_counterparty_identifier:
        transaction_ids = find_related_transaction_ids(normalized_counterparty_identifier, db)
        if not transaction_ids:
            transaction_ids = [payload.transaction_id]

    # Node tags already exist (sync); only create a tag for a token that doesn't
    # resolve, and never spawn a junk tag from a display token like "petrol (4-wheeler)".
    for index, tag_name in enumerate(tag_names):
        if _resolve_tag_id(tag_name, db) is None:
            create_system_tag(tag_name, db, tag_type="CATEGORY" if index == 0 else "SUBCATEGORY")

    _apply_tag_payload(
        transaction_ids=transaction_ids,
        vendor_name=normalized_vendor_name,
        tag_names=tag_names,
        no_tag_required=payload.no_tag_required,
        db=db,
    )
    sync_category_tags(db)
    primary_transaction_id = str(payload.transaction_id)
    for transaction_id in transaction_ids:
        is_primary = str(transaction_id) == primary_transaction_id
        # Secondary transactions (propagated via "apply to similar") are system-tagged.
        # They get needs_review + review_status_manual=False so the UI can distinguish
        # them from transactions the user explicitly reviewed.
        if is_primary:
            _status      = resolved_review_status
            _status_manual = True  # user explicitly classified this transaction
        else:
            _status      = resolved_review_status  # user chose to apply to all — treat as confirmed
            _status_manual = True
        update_transaction_review_fields(
            transaction_id,
            db,
            review_status=_status,
            review_status_manual=_status_manual,
            counterparty_type=payload.counterparty_type,
            primary_flow_type=payload.primary_flow_type,
            consumption_ownership=payload.consumption_ownership,
            settlement_state=payload.settlement_state,
        )
    for transaction_id in transaction_ids:
        delete_transaction_split(transaction_id, db)
        update_transaction_requirement_flags(transaction_id, db, no_split_required=True)

    self_transfer_link = None
    if (payload.self_transfer_transaction_id or "").strip():
        try:
            self_transfer_link = _maybe_link_simple_self_transfer(
                payload,
                original_details,
                db,
            )
        except ValueError as exc:
            return {"success": False, "message": str(exc)}

    return {
        "success": True,
        "data": {
            "transaction_ids": transaction_ids,
            "tags": tag_names,
            "no_tag_required": payload.no_tag_required,
            "review_status": resolved_review_status,
            "review_status_manual": resolved_review_status_manual,
            "counterparty_type": payload.counterparty_type,
            "primary_flow_type": payload.primary_flow_type,
            "consumption_ownership": payload.consumption_ownership,
            "settlement_state": payload.settlement_state,
            "entity_assignment": entity_assignment,
            "self_transfer_link": self_transfer_link,
        },
    }


@classification_router.post("/api/split")
def save_split_classification(
    payload: SplitClassificationRequest, db: Session = Depends(get_db)
):
    if is_linked_recovery_transaction(payload.transaction_id, db):
        return {"success": False, "message": "Settlement transactions cannot be reclassified."}

    txn_uuid = UUID(payload.transaction_id)
    details = transaction_details(txn_uuid, db)
    if not details:
        return {"success": False, "message": "Transaction not found."}

    if payload.no_split_required:
        delete_transaction_split(payload.transaction_id, db)
        update_transaction_requirement_flags(payload.transaction_id, db, no_split_required=True)
        update_transaction_review_fields(
            payload.transaction_id,
            db,
            review_status="confirmed",
            review_status_manual=False,
        )
        return {"success": True, "data": {"transaction_id": payload.transaction_id, "line_items": []}}

    if not payload.line_items:
        return {"success": False, "message": "Add at least one split row."}

    normalized_line_items = []
    tag_names = set()
    for index, line_item in enumerate(payload.line_items, start=1):
        subcategory = None
        category = None
        category_name = None
        subcategory_name = None
        if line_item.subcategory_id:
            subcategory = get_subcategory_details(line_item.subcategory_id, db)
            if not subcategory:
                return {"success": False, "message": f"Invalid subcategory on row {index}."}
            category_name = subcategory["category_name"]
            subcategory_name = subcategory["subcategory_name"]
            path = get_subcategory_path(line_item.subcategory_id, db)
            # Node-bound, collision-aware labels (see single-classify above).
            cat_label = get_node_tag_label(db, category_id=subcategory["category_id"]) or category_name
            path_labels = [get_node_tag_label(db, subcategory_id=node["id"]) or node["name"] for node in path]
            tag_names.update([cat_label, *path_labels])
        elif line_item.category_id:
            category = get_category_details(line_item.category_id, db)
            if not category:
                return {"success": False, "message": f"Invalid category on row {index}."}
            category_name = category["category_name"]
            tag_names.add(get_node_tag_label(db, category_id=category["category_id"]) or category_name)

        normalized_line_items.append(
            {
                "id": line_item.id,
                "item_name": (line_item.item_name or "").strip() or " ",
                "category": subcategory_name or category_name or None,
                "category_id": subcategory["category_id"] if subcategory else (category["category_id"] if category else None),
                "subcategory_id": subcategory["subcategory_id"] if subcategory else None,
                "line_kind": (line_item.line_kind or "").strip() or None,
                "owner_type": (line_item.owner_type or "").strip() or None,
                "expense_for": (line_item.expense_for or "Other").strip(),
                "amount": line_item.amount,
            }
        )

    split_result = save_transaction_split(
        transaction_id=payload.transaction_id,
        vendor_name=(payload.vendor_name or "").strip() or details.get("vendor_name"),
        notes=(payload.notes or "").strip() or None,
        split_mode="quick" if payload.mode == "person" else "itemized",
        total_amount=abs(details.get("amount") or 0),
        line_items=[type("SplitRow", (), item)() for item in normalized_line_items],
        db=db,
    )
    update_transaction_requirement_flags(payload.transaction_id, db, no_split_required=False)
    resolved_split_review_status = _derive_split_review_status(payload.transaction_id, db)
    resolved_split_consumption_ownership = _derive_split_consumption_ownership(
        payload.mode,
        normalized_line_items,
    )
    resolved_split_primary_flow_type = _derive_split_primary_flow_type(
        details,
        normalized_line_items,
    )
    resolved_split_settlement_state = _derive_split_settlement_state(
        payload.transaction_id,
        db,
    )
    update_transaction_review_fields(
        payload.transaction_id,
        db,
        review_status=resolved_split_review_status,
        review_status_manual=False,
        primary_flow_type=resolved_split_primary_flow_type if resolved_split_primary_flow_type is not None else "",
        consumption_ownership=resolved_split_consumption_ownership if resolved_split_consumption_ownership is not None else "",
        settlement_state=resolved_split_settlement_state if resolved_split_settlement_state is not None else "",
    )
    for tag_name in sorted(tag_names):
        if _resolve_tag_id(tag_name, db) is None:
            create_system_tag(tag_name, db, tag_type="SUBCATEGORY")
    _apply_tag_payload(
        transaction_ids=[payload.transaction_id],
        vendor_name=(payload.vendor_name or "").strip() or None,
        tag_names=sorted(tag_names),
        no_tag_required=False,
        db=db,
    )

    return {
        "success": True,
        "data": {
            "split_id": str(split_result["split_id"]),
            "line_items": [
                {
                    "id": str(item["id"]),
                    "category": item["category"],
                    "category_id": str(item["category_id"]) if item.get("category_id") else None,
                    "subcategory_id": str(item["subcategory_id"]) if item.get("subcategory_id") else None,
                    "line_kind": item.get("line_kind"),
                    "owner_type": item.get("owner_type"),
                    "expense_for": item["expense_for"],
                    "amount": float(item["amount"]),
                }
                for item in split_result["line_items"]
            ],
            "tags": sorted(tag_names),
        },
    }


@classification_router.delete("/api/split/line_items/{line_item_id}")
def delete_split_line_item(line_item_id: str, db: Session = Depends(get_db)):
    """Remove a single line item from a split without deleting the whole split."""
    from sqlalchemy import text as _text
    try:
        result = db.execute(
            _text("DELETE FROM public.transaction_split_line_items WHERE id = CAST(:id AS uuid)"),
            {"id": line_item_id},
        )
        db.commit()
        if result.rowcount == 0:
            return {"success": False, "message": "Line item not found."}
        return {"success": True, "deleted_id": line_item_id}
    except Exception as exc:
        db.rollback()
        return {"success": False, "message": str(exc)}
