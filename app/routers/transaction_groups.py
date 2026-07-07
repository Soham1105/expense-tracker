from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.database import get_db
from repositories.transaction_group_repo import (
    create_group, list_groups, get_group_detail, update_group, delete_group,
    add_link, remove_link,
    add_participant, remove_participant,
    add_settlement, remove_settlement,
    get_open_group_flags,
    get_group_transaction_ids,
    update_group_meta,
    canonical_group_type,
    resolve_writable_group_type,
    CANONICAL_GROUP_TYPES,
)
from repositories.transaction_search import (
    update_transaction_review_fields,
    update_transaction_requirement_flags,
    transaction_details,
    add_transaction_tags,
    remove_transaction_tags,
    clear_all_transaction_tags,
    add_new_narration,
    _resolve_tag_id,
)
from repositories.tag_rules_repo import create_tag_rule

groups_router = APIRouter(prefix="/groups", tags=["groups"])


class GroupCreate(BaseModel):
    name: str
    group_type: str = "EVENT"     # EVENT | PATTERN | PORTFOLIO
    notes: Optional[str] = None


class GroupMetaUpdate(BaseModel):
    shared_joy_amount: Optional[float] = None
    meta_patch: Optional[dict] = None


class GroupUpdate(BaseModel):
    name: str
    status: str
    notes: Optional[str] = None
    group_type: Optional[str] = None     # set to re-classify the bucket; None = leave unchanged


class LinkCreate(BaseModel):
    transaction_id: str
    role: str = "EXPENSE"
    attributed_amount: Optional[float] = None
    notes: Optional[str] = None


class ParticipantCreate(BaseModel):
    person_name: str


class SettlementCreate(BaseModel):
    from_person: Optional[str] = None
    amount: float
    notes: Optional[str] = None
    settled_at: str


class MerchantGroupCreate(BaseModel):
    name: str
    transaction_ids: List[str]


class PropagateClassification(BaseModel):
    vendor_name: Optional[str] = None
    tag_names: List[str] = []
    primary_flow_type: Optional[str] = None
    counterparty_type: Optional[str] = None
    consumption_ownership: Optional[str] = None
    settlement_state: Optional[str] = None
    no_tag_required: bool = False
    create_tag_rule: bool = False
    tag_rule_match_field: Optional[str] = None
    tag_rule_match_value: Optional[str] = None


@groups_router.post("/merchant")
def create_merchant_group(payload: MerchantGroupCreate, db: Session = Depends(get_db)):
    if not payload.transaction_ids:
        raise HTTPException(status_code=400, detail="At least one transaction is required")
    g = create_group(db, payload.name.strip() or "Merchant Group", "MERCHANT", None)
    group_id = g["id"]
    for txn_id in payload.transaction_ids:
        add_link(db, group_id, txn_id, "EXPENSE", None, None)
    return {"success": True, "data": {"group_id": group_id, "linked_count": len(payload.transaction_ids)}}


@groups_router.post("/{group_id}/propagate")
def propagate_classification(group_id: str, payload: PropagateClassification, db: Session = Depends(get_db)):
    transaction_ids = get_group_transaction_ids(db, group_id)
    if not transaction_ids:
        raise HTTPException(status_code=404, detail="Group has no linked transactions")

    apply_tags = bool(payload.tag_names or payload.no_tag_required)
    if apply_tags:
        normalized_tags = [t.strip() for t in payload.tag_names if t and t.strip()]
        from uuid import UUID
        for txn_id in transaction_ids:
            txn_uuid = UUID(str(txn_id))
            txn_id_str = str(txn_uuid)
            existing = transaction_details(txn_uuid, db)
            if not existing:
                continue
            current_tags = set(existing.get("tag_names") or [])
            next_tags = set([] if payload.no_tag_required else normalized_tags)
            update_transaction_requirement_flags(txn_id_str, db, no_tag_required=payload.no_tag_required)
            tags_to_add = next_tags - current_tags
            tags_to_remove = current_tags - next_tags
            if tags_to_add:
                add_transaction_tags(tags_to_add, txn_id_str, db)
            if tags_to_remove:
                remove_transaction_tags(tags_to_remove, txn_id_str, db)
            if payload.no_tag_required:
                clear_all_transaction_tags(txn_id_str, db)
            if payload.vendor_name:
                add_new_narration(txn_id_str, payload.vendor_name, db)
    elif payload.vendor_name:
        for txn_id in transaction_ids:
            add_new_narration(str(txn_id), payload.vendor_name, db)

    has_field_updates = any([
        payload.primary_flow_type,
        payload.counterparty_type,
        payload.consumption_ownership,
        payload.settlement_state,
    ])
    if has_field_updates:
        for txn_id in transaction_ids:
            update_transaction_review_fields(
                str(txn_id), db,
                primary_flow_type=payload.primary_flow_type,
                counterparty_type=payload.counterparty_type,
                consumption_ownership=payload.consumption_ownership,
                settlement_state=payload.settlement_state,
            )

    if (payload.create_tag_rule and payload.tag_rule_match_field
            and payload.tag_rule_match_value and payload.tag_names):
        normalized_tags = [t.strip() for t in payload.tag_names if t and t.strip()]
        for tag_name in normalized_tags:
            # Resolve the collision-aware display token to its exact node tag id.
            resolved_id = _resolve_tag_id(tag_name, db)
            if resolved_id is not None:
                create_tag_rule(db, {
                    "name": f"Auto: {tag_name} for {payload.tag_rule_match_value[:40]}",
                    "scope_key": "",
                    "match_field": payload.tag_rule_match_field,
                    "match_type": "CONTAINS",
                    "match_value": payload.tag_rule_match_value,
                    "tag_id": int(resolved_id),
                    "base_confidence": 0.85,
                    "priority": 50,
                })

    return {"success": True, "data": {"updated_count": len(transaction_ids), "transaction_ids": transaction_ids}}


class GroupExtendRequest(BaseModel):
    transaction_ids: List[str]


@groups_router.post("/{group_id}/extend")
def extend_group_classification(group_id: str, payload: GroupExtendRequest, db: Session = Depends(get_db)):
    """Drag-and-drop "drop on existing group" target: add new transactions to a
    Bulk Classify group and apply the group's canonical classification to them.
    Canonical = the most-common tags / flow_type / counterparty_type /
    consumption_ownership / settlement_state across the group's EXISTING linked
    transactions (i.e. ignoring the ids supplied in this call)."""
    from uuid import UUID
    from collections import Counter

    new_ids = [str(i).strip() for i in (payload.transaction_ids or []) if str(i).strip()]
    if not new_ids:
        raise HTTPException(status_code=400, detail="At least one transaction_id is required")

    existing_ids = [str(i) for i in get_group_transaction_ids(db, group_id) if str(i) not in new_ids]
    if not existing_ids:
        raise HTTPException(status_code=400, detail="Group has no existing classification to inherit")

    # Derive canonical classification from the EXISTING linked txns.
    tag_counter = Counter()
    flow_counter = Counter()
    cpt_counter  = Counter()
    own_counter  = Counter()
    set_counter  = Counter()
    sample_count = 0
    for eid in existing_ids:
        try:
            d = transaction_details(UUID(str(eid)), db)
        except Exception:
            continue
        if not d:
            continue
        sample_count += 1
        for t in (d.get("tag_names") or []):
            t = (t or "").strip()
            if t:
                tag_counter[t] += 1
        for fld, cnt in (("primary_flow_type", flow_counter),
                         ("counterparty_type",  cpt_counter),
                         ("consumption_ownership", own_counter),
                         ("settlement_state",   set_counter)):
            v = (d.get(fld) or "")
            v = v.strip() if isinstance(v, str) else ""
            if v:
                cnt[v] += 1
    if sample_count == 0:
        raise HTTPException(status_code=400, detail="Could not read any existing transaction to derive classification")

    # Strict majority — tag must appear in > half of existing linked txns to be
    # considered canonical (filters out drift from manual edits). With 1 sample
    # the only tags are canonical, which is the intuitive behaviour.
    threshold = sample_count // 2 + 1
    canonical_tags = sorted([t for t, c in tag_counter.items() if c >= threshold])
    def _mode(cnt):
        return cnt.most_common(1)[0][0] if cnt else None
    canonical_flow = _mode(flow_counter)
    canonical_cpt  = _mode(cpt_counter)
    canonical_own  = _mode(own_counter)
    canonical_set  = _mode(set_counter)

    # 1) Add the new transactions as links to the group.
    added = 0
    for new_id in new_ids:
        try:
            add_link(db, group_id, new_id, "EXPENSE", None, None)
            added += 1
        except Exception:
            # already linked / invalid — keep going so the classification still applies
            continue

    # 2) Apply canonical classification to the NEW txns only.
    classified = 0
    for new_id in new_ids:
        try:
            existing = transaction_details(UUID(str(new_id)), db)
        except Exception:
            continue
        if not existing:
            continue
        current_tags = set(existing.get("tag_names") or [])
        tags_to_add = set(canonical_tags) - current_tags
        if tags_to_add:
            add_transaction_tags(tags_to_add, str(new_id), db)
        update_transaction_review_fields(
            str(new_id), db,
            primary_flow_type=canonical_flow,
            counterparty_type=canonical_cpt,
            consumption_ownership=canonical_own,
            settlement_state=canonical_set,
        )
        classified += 1

    g = get_group_detail(db, group_id) or {}
    return {
        "success": True,
        "data": {
            "added": added,
            "classified": classified,
            "group_name": g.get("name") or "Bulk Classify",
            "tag_names": canonical_tags,
        },
    }


@groups_router.get("/")
def list_all_groups(status: Optional[str] = Query(None), db: Session = Depends(get_db)):
    return {"success": True, "data": list_groups(db, status=status)}


@groups_router.post("/")
def create_new_group(payload: GroupCreate, db: Session = Depends(get_db)):
    # Strict on write: accept canonical (EVENT/PATTERN/PORTFOLIO) or known legacy
    # aliases (SPLIT/RETURN/CIRCLE/GENERAL/MERCHANT). Reject anything else with 400.
    canonical = resolve_writable_group_type(payload.group_type)
    if canonical is None:
        raise HTTPException(
            status_code=400,
            detail=f"group_type must be one of {sorted(CANONICAL_GROUP_TYPES)}",
        )
    g = create_group(db, payload.name, canonical, payload.notes)
    return {"success": True, "data": g}


@groups_router.patch("/{group_id}/meta")
def patch_group_meta(group_id: str, payload: GroupMetaUpdate, db: Session = Depends(get_db)):
    """Update type-specific fields: shared_joy_amount (EVENT) or meta JSONB (PORTFOLIO)."""
    g = update_group_meta(
        db,
        group_id,
        shared_joy_amount=payload.shared_joy_amount,
        meta_patch=payload.meta_patch,
    )
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"success": True, "data": g}


@groups_router.get("/transaction-flags")
def transaction_flags(ids: str = Query(""), db: Session = Depends(get_db)):
    id_list = [i.strip() for i in ids.split(",") if i.strip()]
    return {"success": True, "data": get_open_group_flags(db, id_list)}


class TransactionFlagsRequest(BaseModel):
    ids: List[str] = []


@groups_router.post("/transaction-flags")
def transaction_flags_post(payload: TransactionFlagsRequest, db: Session = Depends(get_db)):
    # POST variant: large result sets blow past URL-length limits on the GET form.
    return {"success": True, "data": get_open_group_flags(db, payload.ids)}


@groups_router.get("/{group_id}/member-transactions")
def group_member_transaction_ids(group_id: str, db: Session = Depends(get_db)):
    """Return all transaction IDs that belong to this group (regardless of date range)."""
    ids = get_group_transaction_ids(db, group_id)
    return {"success": True, "data": ids}


@groups_router.get("/{group_id}")
def get_group(group_id: str, db: Session = Depends(get_db)):
    g = get_group_detail(db, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"success": True, "data": g}


@groups_router.put("/{group_id}")
def update_existing_group(group_id: str, payload: GroupUpdate, db: Session = Depends(get_db)):
    canonical_type = None
    if payload.group_type is not None:
        canonical_type = resolve_writable_group_type(payload.group_type)
        if canonical_type is None:
            raise HTTPException(
                status_code=400,
                detail=f"group_type must be one of {sorted(CANONICAL_GROUP_TYPES)}",
            )
    g = update_group(db, group_id, payload.name, payload.status, payload.notes, group_type=canonical_type)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"success": True, "data": g}


@groups_router.delete("/{group_id}")
def delete_existing_group(group_id: str, db: Session = Depends(get_db)):
    delete_group(db, group_id)
    return {"success": True, "message": "Group deleted"}


@groups_router.post("/{group_id}/links")
def add_transaction_link(group_id: str, payload: LinkCreate, db: Session = Depends(get_db)):
    link = add_link(db, group_id, payload.transaction_id, payload.role,
                    payload.attributed_amount, payload.notes)
    return {"success": True, "data": link}


@groups_router.delete("/{group_id}/links/{link_id}")
def remove_transaction_link(group_id: str, link_id: str, db: Session = Depends(get_db)):
    remove_link(db, link_id)
    return {"success": True, "message": "Link removed"}


@groups_router.post("/{group_id}/participants")
def add_group_participant(group_id: str, payload: ParticipantCreate, db: Session = Depends(get_db)):
    p = add_participant(db, group_id, payload.person_name)
    return {"success": True, "data": p}


@groups_router.delete("/{group_id}/participants/{participant_id}")
def remove_group_participant(group_id: str, participant_id: str, db: Session = Depends(get_db)):
    remove_participant(db, participant_id)
    return {"success": True, "message": "Participant removed"}


@groups_router.post("/{group_id}/settlements")
def add_group_settlement(group_id: str, payload: SettlementCreate, db: Session = Depends(get_db)):
    s = add_settlement(db, group_id, payload.from_person, payload.amount,
                       payload.notes, payload.settled_at)
    return {"success": True, "data": s}


@groups_router.delete("/{group_id}/settlements/{settlement_id}")
def remove_group_settlement(group_id: str, settlement_id: str, db: Session = Depends(get_db)):
    remove_settlement(db, settlement_id)
    return {"success": True, "message": "Settlement removed"}
