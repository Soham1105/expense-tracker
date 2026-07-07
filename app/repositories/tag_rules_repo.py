from typing import Optional
from sqlalchemy import text
from sqlalchemy.orm import Session


def ensure_tag_rules_tables(db: Session):
    # tag_rules uses BIGINT tag_id to match system_tags.id (BIGSERIAL)
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.tag_rules (
            id              BIGSERIAL PRIMARY KEY,
            scope_key       TEXT NOT NULL DEFAULT '',
            match_field     TEXT NOT NULL,
            match_type      TEXT NOT NULL DEFAULT 'CONTAINS',
            match_value     TEXT NOT NULL,
            tag_id          BIGINT NOT NULL,
            base_confidence NUMERIC(5,2) NOT NULL DEFAULT 0.85,
            priority        INT  NOT NULL DEFAULT 0,
            is_active       BOOLEAN NOT NULL DEFAULT TRUE,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    db.execute(text("ALTER TABLE public.tag_rules ADD COLUMN IF NOT EXISTS name TEXT"))
    db.execute(text("ALTER TABLE public.tag_rules ADD COLUMN IF NOT EXISTS confidence_source TEXT NOT NULL DEFAULT 'MANUAL'"))
    db.commit()


def list_tag_rules(db: Session) -> list[dict]:
    rows = db.execute(text("""
        SELECT
            r.id,
            r.name,
            r.scope_key,
            r.match_field,
            r.match_type,
            r.match_value,
            r.tag_id,
            r.base_confidence,
            r.priority,
            r.is_active,
            r.created_at,
            st.name             AS tag_name,
            st.tag_type
        FROM public.tag_rules r
        LEFT JOIN public.system_tags st ON st.id = r.tag_id
        ORDER BY r.priority DESC, r.created_at ASC
    """)).mappings().all()
    return [
        {
            "id":               int(r["id"]),
            "name":             r["name"],
            "scope_key":        r["scope_key"],
            "match_field":      r["match_field"],
            "match_type":       r["match_type"],
            "match_value":      r["match_value"],
            "tag_id":           int(r["tag_id"]) if r["tag_id"] else None,
            "tag_name":         r["tag_name"],
            "tag_type":         r["tag_type"],
            "base_confidence":  float(r["base_confidence"] or 0),
            "priority":         int(r["priority"] or 0),
            "is_active":        bool(r["is_active"]),
            "created_at":       str(r["created_at"]) if r["created_at"] else None,
        }
        for r in rows
    ]


def create_tag_rule(db: Session, payload: dict) -> dict:
    row = db.execute(text("""
        INSERT INTO public.tag_rules
            (name, scope_key, match_field, match_type, match_value,
             tag_id, base_confidence, priority, is_active, confidence_source)
        VALUES
            (:name, :scope_key, :match_field, :match_type, :match_value,
             :tag_id, :base_confidence, :priority, TRUE, 'MANUAL')
        RETURNING id, name, scope_key, match_field, match_type,
                  match_value, tag_id, base_confidence, priority, is_active
    """), {
        "name":            (payload.get("name") or "").strip() or None,
        "scope_key":       (payload.get("scope_key") or "").strip(),
        "match_field":     payload["match_field"],
        "match_type":      payload.get("match_type", "CONTAINS").upper(),
        "match_value":     payload["match_value"],
        "tag_id":          payload["tag_id"],
        "base_confidence": float(payload.get("base_confidence", 0.85)),
        "priority":        int(payload.get("priority", 0)),
    }).mappings().first()
    db.commit()
    return {
        "id":               int(row["id"]),
        "name":             row["name"],
        "scope_key":        row["scope_key"],
        "match_field":      row["match_field"],
        "match_type":       row["match_type"],
        "match_value":      row["match_value"],
        "tag_id":           int(row["tag_id"]),
        "base_confidence":  float(row["base_confidence"] or 0),
        "priority":         int(row["priority"] or 0),
        "is_active":        bool(row["is_active"]),
    }


def update_tag_rule(db: Session, rule_id: int, payload: dict):
    db.execute(text("""
        UPDATE public.tag_rules
        SET name=:name, scope_key=:scope_key, match_field=:match_field,
            match_type=:match_type, match_value=:match_value,
            tag_id=:tag_id, priority=:priority, updated_at=NOW()
        WHERE id=:rid
    """), {
        "rid":         rule_id,
        "name":        (payload.get("name") or "").strip() or None,
        "scope_key":   (payload.get("scope_key") or "").strip(),
        "match_field": payload["match_field"],
        "match_type":  payload.get("match_type", "CONTAINS").upper(),
        "match_value": payload["match_value"],
        "tag_id":      int(payload["tag_id"]),
        "priority":    int(payload.get("priority", 0)),
    })
    db.commit()


def toggle_tag_rule(db: Session, rule_id: str, is_active: bool):
    db.execute(text("""
        UPDATE public.tag_rules
        SET is_active = :active, updated_at = NOW()
        WHERE id = :rid
    """), {"rid": rule_id, "active": is_active})
    db.commit()


def delete_tag_rule(db: Session, rule_id: str):
    db.execute(text("DELETE FROM public.tag_rules WHERE id = :rid"), {"rid": rule_id})
    db.commit()


def apply_tag_rules(db: Session) -> dict:
    from repositories.transaction_tagger import apply_rule_based_tags
    apply_rule_based_tags(db)
    # Count how many transactions got tags from rules this run
    affected = db.execute(text("""
        SELECT COUNT(DISTINCT transaction_id) AS n
        FROM public.transaction_tags
        WHERE applied_by = 'RULE'
    """)).scalar_one()
    return {"tagged_transactions": int(affected)}


def count_rule_matches(db: Session, match_field: str, match_type: str, match_value: str) -> dict:
    allowed = {"counterparty_identifier","narration","payment_mode","vendor_name","counterparty_entity_name"}
    if match_field not in allowed:
        return {"count": 0, "samples": []}
    mt = match_type.upper()
    if mt == "EXACT":
        pred = f"lower(COALESCE(t.{match_field},'')) = lower(:val)"
    elif mt == "CONTAINS":
        pred = f"lower(COALESCE(t.{match_field},'')) LIKE '%' || lower(:val) || '%'"
    elif mt == "REGEX":
        pred = f"COALESCE(t.{match_field},'') ~* :val"
    else:
        return {"count": 0, "samples": []}
    n = db.execute(text(f"SELECT COUNT(*) FROM public.transactions t WHERE {pred}"),
                   {"val": match_value}).scalar_one()
    samples = db.execute(text(f"""
        SELECT COALESCE(NULLIF(BTRIM(t.vendor_name),''), NULLIF(BTRIM(t.narration),''), t.counterparty_identifier) AS label
        FROM public.transactions t WHERE {pred}
        ORDER BY t.transaction_date DESC LIMIT 4
    """), {"val": match_value}).scalars().all()
    return {"count": int(n), "samples": [s for s in samples if s]}
