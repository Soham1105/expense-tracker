import logging
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger("app")

ALLOWED_MATCH_FIELDS = {
    "counterparty_identifier",
    "narration",
    "payment_mode",
    "vendor_name",
    "counterparty_entity_name",
}


def _build_match_predicate(match_type: str, field_col: str) -> str:
    if match_type == "EXACT":
        return f"lower(COALESCE(t.{field_col}, '')) = lower(:match_value)"
    if match_type == "CONTAINS":
        return f"lower(COALESCE(t.{field_col}, '')) LIKE '%' || lower(:match_value) || '%'"
    if match_type == "REGEX":
        return f"COALESCE(t.{field_col}, '') ~* :match_value"
    return None


def apply_rule_based_tags(db: Session):
    rules = db.execute(
        text("""
            SELECT id, scope_key, tag_id, match_field, match_type, match_value,
                   base_confidence
            FROM public.tag_rules
            WHERE is_active = TRUE
            ORDER BY priority DESC, id ASC
        """)
    ).mappings().all()

    if not rules:
        return

    for rule in rules:
        field_col = str(rule["match_field"] or "").strip().lower()
        if field_col not in ALLOWED_MATCH_FIELDS:
            logger.warning("Skipping rule %s â€” invalid match_field: %s", rule["id"], field_col)
            continue

        match_type = str(rule["match_type"] or "").strip().upper()
        predicate = _build_match_predicate(match_type, field_col)
        if not predicate:
            logger.warning("Skipping rule %s â€” unknown match_type: %s", rule["id"], match_type)
            continue

        params = {
            "tag_id":      rule["tag_id"],
            "scope_key":   rule["scope_key"],
            "match_value": rule["match_value"],
        }

        db.execute(
            text(f"""
                INSERT INTO public.transaction_tags (transaction_id, tag_id, applied_by, applied_at)
                SELECT t.id, :tag_id, 'RULE', NOW()
                FROM public.transactions t
                WHERE (:scope_key = '' OR t.payment_source_name = :scope_key)
                  AND {predicate}
                ON CONFLICT (transaction_id, tag_id) DO NOTHING
            """),
            params,
        )

        db.execute(
            text(f"""
                INSERT INTO public.transaction_tag_suggestions
                    (transaction_id, tag_id, confidence, confidence_source, reason, status)
                SELECT
                    t.id,
                    :tag_id,
                    :base_confidence,
                    'RULE',
                    'Matched ' || :match_type || ' on ' || :match_field || ': ' || :match_value,
                    'PENDING'
                FROM public.transactions t
                WHERE (:scope_key = '' OR t.payment_source_name = :scope_key)
                  AND {predicate}
                ON CONFLICT (transaction_id, tag_id) DO UPDATE
                    SET confidence = GREATEST(
                            transaction_tag_suggestions.confidence,
                            EXCLUDED.confidence
                        )
            """),
            {
                **params,
                "base_confidence": float(rule["base_confidence"]),
                "match_type":      match_type,
                "match_field":     field_col,
            },
        )

    db.commit()
    logger.info("Rule-based tagging complete. %d rules applied.", len(rules))


def tag_transactions(db: Session):
    sql = text("""
        INSERT INTO transaction_tags (
            transaction_id,
            tag_id,
            applied_by,
            applied_at
        )
        SELECT DISTINCT
            new_tx.id        AS transaction_id,
            tt.tag_id        AS tag_id,
            'SYSTEM'         AS applied_by,
            CURRENT_DATE     AS applied_at
        FROM transactions AS new_tx
        JOIN transactions tagged_tx
            ON (
                new_tx.counterparty_identifier = tagged_tx.counterparty_identifier
                OR (
                    COALESCE(NULLIF(BTRIM(new_tx.counterparty_entity_name), ''), '') <> ''
                    AND lower(COALESCE(new_tx.counterparty_entity_name, '')) = lower(COALESCE(tagged_tx.counterparty_entity_name, ''))
                    AND lower(COALESCE(new_tx.counterparty_entity_type, '')) = lower(COALESCE(tagged_tx.counterparty_entity_type, ''))
                )
            )
        AND new_tx.id <> tagged_tx.id
        JOIN transaction_tags tt
            ON tagged_tx.id = tt.transaction_id
        WHERE new_tx.id NOT IN (
            SELECT transaction_id
            FROM transaction_tags
        )
        ON CONFLICT (transaction_id, tag_id) DO NOTHING;

    """)

    db.execute(sql)

    # Auto-propagated tags are a guess from a same-counterparty history â€” flag those
    # transactions as 'needs_review' (unless the user has already reviewed them) so they
    # surface for a quick check instead of being silently confirmed. Catches the case
    # where one merchant maps to two leaves (e.g. a pump used for both 2W and 4W petrol).
    db.execute(text("""
        UPDATE public.transactions t
        SET review_status = 'needs_review'
        WHERE COALESCE(t.review_status_manual, FALSE) = FALSE
          AND COALESCE(t.review_status, '') NOT IN ('confirmed', 'needs_review')
          AND EXISTS (
              SELECT 1 FROM public.transaction_tags tt
              WHERE tt.transaction_id = t.id AND tt.applied_by = 'SYSTEM'
          )
    """))
    db.commit()

