from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from core.database import get_db
from repositories.tag_rules_repo import (
    list_tag_rules, create_tag_rule, update_tag_rule, toggle_tag_rule,
    delete_tag_rule, apply_tag_rules, count_rule_matches,
)

tag_rules_router = APIRouter(prefix="/tag-rules", tags=["tag-rules"])


class TagRuleRequest(BaseModel):
    name: Optional[str] = None
    scope_key: Optional[str] = ""
    match_field: str
    match_type: str = "CONTAINS"
    match_value: str
    tag_id: int
    base_confidence: float = 0.85
    priority: int = 0


@tag_rules_router.get("/")
def get_rules(db: Session = Depends(get_db)):
    try:
        data = list_tag_rules(db)
        return {"success": True, "data": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


@tag_rules_router.post("/")
def add_rule(payload: TagRuleRequest, db: Session = Depends(get_db)):
    if not payload.match_field or not payload.match_value or not payload.tag_id:
        return {"success": False, "message": "match_field, match_value and tag_id are required."}
    try:
        rule = create_tag_rule(db, payload.model_dump())
        return {"success": True, "data": rule}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}


@tag_rules_router.put("/{rule_id}")
def edit_rule(rule_id: int, payload: TagRuleRequest, db: Session = Depends(get_db)):
    try:
        update_tag_rule(db, rule_id, payload.model_dump())
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}


@tag_rules_router.patch("/{rule_id}/toggle")
def toggle_rule(rule_id: str, active: bool = True, db: Session = Depends(get_db)):
    toggle_tag_rule(db, rule_id, active)
    return {"success": True}


@tag_rules_router.delete("/{rule_id}")
def remove_rule(rule_id: str, db: Session = Depends(get_db)):
    delete_tag_rule(db, rule_id)
    return {"success": True}


@tag_rules_router.post("/apply")
def apply_rules(db: Session = Depends(get_db)):
    result = apply_tag_rules(db)
    return {"success": True, "data": result}


@tag_rules_router.get("/preview")
def preview_rule(
    match_field: str,
    match_type: str = "CONTAINS",
    match_value: str = "",
    db: Session = Depends(get_db),
):
    if not match_value:
        return {"success": True, "data": {"count": 0, "samples": []}}
    result = count_rule_matches(db, match_field, match_type, match_value)
    return {"success": True, "data": result}
