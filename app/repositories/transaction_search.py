from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID, uuid4
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict
from repositories.transaction_repo import backfill_transaction_sources
from repositories.tag_display import dup_join, label_expr

KNOWN_ENTITY_TYPES = {"self", "friend", "family", "merchant", "employer", "bank", "government", "unknown"}


def _normalize_identity_text(value):
    return " ".join(str(value or "").strip().split()).lower()


def _normalize_entity_type(value):
    normalized = _normalize_identity_text(value)
    return normalized if normalized in KNOWN_ENTITY_TYPES else ""

def ensure_transaction_source_columns(db: Session):
    db.execute(
        text(
            """
            ALTER TABLE public.transactions
            ADD COLUMN IF NOT EXISTS payment_source_name TEXT,
            ADD COLUMN IF NOT EXISTS payment_mode TEXT,
            ADD COLUMN IF NOT EXISTS transaction_time TIME,
            ADD COLUMN IF NOT EXISTS narration TEXT,
            ADD COLUMN IF NOT EXISTS vendor_name TEXT,
            ADD COLUMN IF NOT EXISTS review_status TEXT,
            ADD COLUMN IF NOT EXISTS review_status_manual BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS counterparty_type TEXT,
            ADD COLUMN IF NOT EXISTS primary_flow_type TEXT,
            ADD COLUMN IF NOT EXISTS consumption_ownership TEXT,
            ADD COLUMN IF NOT EXISTS settlement_state TEXT,
            ADD COLUMN IF NOT EXISTS counterparty_entity_name TEXT,
            ADD COLUMN IF NOT EXISTS counterparty_entity_type TEXT,
            ADD COLUMN IF NOT EXISTS no_tag_required BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS no_split_required BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS statement_sources TEXT
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE public.transactions
            ALTER COLUMN counterparty_identifier TYPE TEXT,
            ALTER COLUMN payment_source_name TYPE TEXT,
            ALTER COLUMN payment_mode TYPE TEXT,
            ALTER COLUMN narration TYPE TEXT,
            ALTER COLUMN vendor_name TYPE TEXT,
            ALTER COLUMN review_status TYPE TEXT,
            ALTER COLUMN counterparty_type TYPE TEXT,
            ALTER COLUMN primary_flow_type TYPE TEXT,
            ALTER COLUMN consumption_ownership TYPE TEXT,
            ALTER COLUMN settlement_state TYPE TEXT,
            ALTER COLUMN counterparty_entity_name TYPE TEXT,
            ALTER COLUMN counterparty_entity_type TYPE TEXT
            """
        )
    )
    db.execute(
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'transactions'
                      AND column_name = 'transaction_nature'
                ) OR EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'transactions'
                      AND column_name = 'party_type'
                ) THEN
                    UPDATE public.transactions
                    SET
                        counterparty_type = CASE
                            WHEN COALESCE(NULLIF(BTRIM(counterparty_type), ''), '') <> '' THEN counterparty_type
                            WHEN lower(COALESCE(NULLIF(BTRIM(party_type), ''), '')) IN ('merchant', 'friend', 'family', 'employer', 'unknown')
                                THEN lower(NULLIF(BTRIM(party_type), ''))
                            ELSE counterparty_type
                        END,
                        primary_flow_type = CASE
                            WHEN COALESCE(NULLIF(BTRIM(primary_flow_type), ''), '') <> '' THEN primary_flow_type
                            WHEN lower(COALESCE(NULLIF(BTRIM(transaction_nature), ''), '')) IN ('expense', 'income', 'transfer')
                                THEN lower(NULLIF(BTRIM(transaction_nature), ''))
                            WHEN lower(COALESCE(NULLIF(BTRIM(transaction_nature), ''), '')) = 'reimbursement'
                                THEN 'refund'
                            WHEN lower(COALESCE(NULLIF(BTRIM(transaction_nature), ''), '')) = 'charge'
                                THEN 'fee'
                            ELSE primary_flow_type
                        END,
                        consumption_ownership = CASE
                            WHEN COALESCE(NULLIF(BTRIM(consumption_ownership), ''), '') <> '' THEN consumption_ownership
                            WHEN lower(COALESCE(NULLIF(BTRIM(primary_flow_type), ''), COALESCE(NULLIF(BTRIM(transaction_nature), ''), ''))) = 'transfer'
                                THEN 'not_consumption'
                            ELSE consumption_ownership
                        END,
                        settlement_state = CASE
                            WHEN COALESCE(NULLIF(BTRIM(settlement_state), ''), '') <> '' THEN settlement_state
                            WHEN lower(COALESCE(NULLIF(BTRIM(primary_flow_type), ''), COALESCE(NULLIF(BTRIM(transaction_nature), ''), ''))) = 'transfer'
                                THEN 'none'
                            ELSE settlement_state
                        END;

                    ALTER TABLE public.transactions
                    DROP COLUMN IF EXISTS transaction_nature,
                    DROP COLUMN IF EXISTS party_type;
                END IF;
            END $$;
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.counterparty_entities (
                id UUID PRIMARY KEY,
                entity_name TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                normalized_entity_name TEXT NOT NULL,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT counterparty_entities_unique_name_type
                    UNIQUE (normalized_entity_name, entity_type)
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.counterparty_entity_aliases (
                id UUID PRIMARY KEY,
                entity_id UUID NOT NULL REFERENCES public.counterparty_entities(id) ON DELETE CASCADE,
                counterparty_identifier TEXT NOT NULL,
                normalized_counterparty_identifier TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_counterparty_entity_aliases_entity_id
            ON public.counterparty_entity_aliases(entity_id)
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE public.transactions
            SET statement_sources = UPPER(COALESCE(payment_source_name, ''))
            WHERE COALESCE(NULLIF(BTRIM(statement_sources), ''), '') = ''
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE public.system_tags
            ADD COLUMN IF NOT EXISTS managed_by_schema BOOLEAN NOT NULL DEFAULT FALSE
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE public.transactions AS t
            SET
                counterparty_entity_name = e.entity_name,
                counterparty_entity_type = e.entity_type
            FROM public.counterparty_entity_aliases AS a
            JOIN public.counterparty_entities AS e
              ON e.id = a.entity_id
            WHERE lower(COALESCE(t.counterparty_identifier, '')) = a.normalized_counterparty_identifier
              AND (
                COALESCE(NULLIF(BTRIM(t.counterparty_entity_name), ''), '') <> COALESCE(e.entity_name, '')
                OR COALESCE(NULLIF(BTRIM(t.counterparty_entity_type), ''), '') <> COALESCE(e.entity_type, '')
              )
            """
        )
    )
    # One-time fix: transactions tagged only via manual UI (applied_by IS NULL or 'USER')
    # were never marked review_status_manual=TRUE. Fix them so they stop showing as "auto".
    db.execute(
        text(
            """
            UPDATE public.transactions t
            SET review_status_manual = TRUE
            WHERE review_status_manual = FALSE
              AND EXISTS (
                  SELECT 1 FROM public.transaction_tags tt
                  WHERE tt.transaction_id = t.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM public.transaction_tags tt
                  WHERE tt.transaction_id = t.id
                    AND tt.applied_by IN ('SYSTEM', 'RULE')
              )
            """
        )
    )
    db.commit()


def get_counterparty_entity_for_identifier(counterparty_identifier, db: Session):
    normalized_counterparty = _normalize_identity_text(counterparty_identifier)
    if not normalized_counterparty:
        return None

    row = db.execute(
        text(
            """
            SELECT
                e.id::text AS entity_id,
                e.entity_name,
                e.entity_type
            FROM public.counterparty_entity_aliases AS a
            JOIN public.counterparty_entities AS e
              ON e.id = a.entity_id
            WHERE a.normalized_counterparty_identifier = :normalized_counterparty
            """
        ),
        {"normalized_counterparty": normalized_counterparty},
    ).mappings().first()
    return dict(row) if row else None


def refresh_counterparty_entity_cache(
    db: Session,
    *,
    entity_id=None,
    counterparty_identifier=None,
):
    normalized_counterparty = _normalize_identity_text(counterparty_identifier)
    if not entity_id and not normalized_counterparty:
        return

    conditions = []
    params = {}
    if entity_id:
        conditions.append("a.entity_id = :entity_id")
        params["entity_id"] = entity_id
    if normalized_counterparty:
        conditions.append("a.normalized_counterparty_identifier = :normalized_counterparty")
        params["normalized_counterparty"] = normalized_counterparty

    db.execute(
        text(
            f"""
            UPDATE public.transactions AS t
            SET
                counterparty_entity_name = entity_data.entity_name,
                counterparty_entity_type = entity_data.entity_type
            FROM (
                SELECT
                    a.normalized_counterparty_identifier,
                    e.entity_name,
                    e.entity_type
                FROM public.counterparty_entity_aliases AS a
                JOIN public.counterparty_entities AS e
                  ON e.id = a.entity_id
                WHERE {" OR ".join(conditions)}
            ) AS entity_data
            WHERE lower(COALESCE(t.counterparty_identifier, '')) = entity_data.normalized_counterparty_identifier
            """
        ),
        params,
    )
    db.commit()


def save_counterparty_entity_assignment(counterparty_identifier, entity_name, entity_type, db: Session):
    normalized_counterparty = _normalize_identity_text(counterparty_identifier)
    normalized_entity_name = _normalize_identity_text(entity_name)
    normalized_entity_type = _normalize_entity_type(entity_type)
    pretty_entity_name = " ".join(str(entity_name or "").strip().split())

    if not normalized_counterparty or not normalized_entity_name or not normalized_entity_type:
        return None

    # Priority 1: does this specific counterparty_identifier already have an entity?
    # If so, update the entity name/type in place — don't change which entity it belongs to.
    existing_alias = db.execute(
        text(
            """
            SELECT a.id::text AS alias_id, a.entity_id::text AS entity_id
            FROM public.counterparty_entity_aliases a
            WHERE a.normalized_counterparty_identifier = :normalized_counterparty
            """
        ),
        {"normalized_counterparty": normalized_counterparty},
    ).mappings().first()

    if existing_alias:
        entity_id = existing_alias["entity_id"]
        db.execute(
            text(
                """
                UPDATE public.counterparty_entities
                SET entity_name = :entity_name,
                    entity_type = :entity_type,
                    normalized_entity_name = :normalized_entity_name,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :entity_id
                """
            ),
            {
                "entity_name": pretty_entity_name,
                "entity_type": normalized_entity_type,
                "normalized_entity_name": normalized_entity_name,
                "entity_id": entity_id,
            },
        )
    else:
        # No alias yet — upsert the entity (respecting the unique name+type constraint),
        # then create the alias pointing to it.
        entity_row = db.execute(
            text(
                """
                INSERT INTO public.counterparty_entities (
                    id, entity_name, entity_type, normalized_entity_name
                ) VALUES (
                    :entity_id, :entity_name, :entity_type, :normalized_entity_name
                )
                ON CONFLICT (normalized_entity_name, entity_type) DO UPDATE
                    SET entity_name = EXCLUDED.entity_name,
                        updated_at  = CURRENT_TIMESTAMP
                RETURNING id::text AS entity_id
                """
            ),
            {
                "entity_id": str(uuid4()),
                "entity_name": pretty_entity_name,
                "entity_type": normalized_entity_type,
                "normalized_entity_name": normalized_entity_name,
            },
        ).mappings().first()
        entity_id = entity_row["entity_id"]

        db.execute(
            text(
                """
                INSERT INTO public.counterparty_entity_aliases (
                    id, entity_id, counterparty_identifier, normalized_counterparty_identifier
                ) VALUES (
                    :alias_id, :entity_id, :counterparty_identifier, :normalized_counterparty_identifier
                )
                ON CONFLICT (normalized_counterparty_identifier) DO UPDATE
                    SET entity_id = EXCLUDED.entity_id,
                        updated_at = CURRENT_TIMESTAMP
                """
            ),
            {
                "alias_id": str(uuid4()),
                "entity_id": entity_id,
                "counterparty_identifier": str(counterparty_identifier or "").strip(),
                "normalized_counterparty_identifier": normalized_counterparty,
            },
        )

    db.commit()
    refresh_counterparty_entity_cache(
        db,
        entity_id=entity_id,
        counterparty_identifier=counterparty_identifier,
    )
    return {
        "entity_id": entity_id,
        "entity_name": pretty_entity_name,
        "entity_type": normalized_entity_type,
    }


def backfill_counterparty_entities_from_transactions(db: Session, limit: int = 250):
    rows = db.execute(
        text(
            """
            SELECT DISTINCT
                t.counterparty_identifier,
                t.vendor_name,
                t.counterparty_type
            FROM public.transactions AS t
            LEFT JOIN public.counterparty_entity_aliases AS a
              ON lower(COALESCE(t.counterparty_identifier, '')) = a.normalized_counterparty_identifier
            WHERE COALESCE(NULLIF(BTRIM(t.counterparty_identifier), ''), '') <> ''
              AND COALESCE(NULLIF(BTRIM(t.vendor_name), ''), '') <> ''
              AND COALESCE(NULLIF(BTRIM(t.counterparty_type), ''), '') <> ''
              AND a.id IS NULL
            ORDER BY t.counterparty_identifier
            LIMIT :limit
            """
        ),
        {"limit": limit},
    ).mappings().all()

    processed = 0
    for row in rows:
        if save_counterparty_entity_assignment(
            row.get("counterparty_identifier"),
            row.get("vendor_name"),
            row.get("counterparty_type"),
            db,
        ):
            processed += 1
    return processed


def find_related_transaction_ids(counterparty_identifier, db: Session):
    # Always use exact counterparty_identifier match.
    # Entity grouping is intentionally NOT used here — it caused different UPI IDs
    # with the same display name to be treated as one person, spreading wrong
    # classifications across unrelated transactions.
    normalized_counterparty = _normalize_identity_text(counterparty_identifier)
    if not normalized_counterparty:
        return []
    ids = db.execute(
        text(
            """
            SELECT id
            FROM public.transactions
            WHERE lower(COALESCE(counterparty_identifier, '')) = :ci
            """
        ),
        {"ci": normalized_counterparty},
    ).scalars().all()
    return list(ids)

def tag_transactions(filters, db: Session):
    backfill_transaction_sources(db)
    # backfill_counterparty_entities_from_transactions intentionally removed from here.
    # Running it on every Reports page load silently grouped different counterparty IDs
    # under the same entity whenever they shared a display name, causing wrong bulk
    # classifications. It still runs on classification_context (when opening a specific
    # transaction), which is the right time to do it.
    _tag_label = label_expr("s_tags", "s_tags_")
    _tag_dupjoin = dup_join("s_tags", "s_tags_")
    _filter_label = label_expr("filter_s_tags", "filter_s_")
    _filter_dupjoin = dup_join("filter_s_tags", "filter_s_")
    _sql = """
WITH tag_data AS (
  SELECT
    t_tags.transaction_id,
    COALESCE(
      jsonb_agg(DISTINCT __TAG_LABEL__) FILTER (WHERE s_tags.name IS NOT NULL),
      '[]'::jsonb
    ) AS tags,
    COUNT(DISTINCT s_tags.name) FILTER (WHERE s_tags.name IS NOT NULL) AS tag_count,
    COALESCE(
      BOOL_OR(lower(COALESCE(s_tags.name, '')) IN ('salary', 'income', 'employer')),
      FALSE
    ) AS has_income_tag,
    COALESCE(
      BOOL_OR(lower(COALESCE(s_tags.name, '')) IN (
        'investment',
        'gold-silver',
        'gold',
        'silver',
        'settle',
        'settlement',
        'transfer',
        'self transfer',
        'loan',
        'advance',
        'credit card'
      )),
      FALSE
    ) AS has_non_spend_tag
  FROM transaction_tags t_tags
  LEFT JOIN system_tags s_tags
    ON t_tags.tag_id = s_tags.id
   AND COALESCE(s_tags.managed_by_schema, FALSE) = TRUE
   AND COALESCE(s_tags.is_active, TRUE) = TRUE
  __TAG_DUPJOIN__
  GROUP BY t_tags.transaction_id
),
recovery_data AS (
  SELECT
    s.transaction_id,
    COALESCE(SUM(r.amount), 0) AS recovery_amount
  FROM transaction_splits s
  LEFT JOIN transaction_split_recoveries r
    ON s.id = r.split_id
  GROUP BY s.transaction_id
),
recovery_target_data AS (
  SELECT
    r.recovery_transaction_id AS transaction_id,
    TRUE AS linked_as_recovery,
    COALESCE(
      MAX(NULLIF(BTRIM(r.recovery_type), '')),
      'Settlement'
    ) AS linked_recovery_type
  FROM transaction_split_recoveries r
  GROUP BY r.recovery_transaction_id
),
split_data AS (
  SELECT
    s.transaction_id,
    COUNT(DISTINCT s.id) AS split_count,
    MAX(NULLIF(BTRIM(s.split_mode), '')) AS split_mode,
    COALESCE(
      SUM(
        CASE
          WHEN lower(COALESCE(s.split_mode, '')) = 'self_transfer'
            THEN 0
          WHEN lower(COALESCE(s.split_mode, '')) = 'quick'
            AND (
              lower(COALESCE(li.expense_for, '')) IN ('self', 'my share', 'myshare')
              OR lower(COALESCE(li.item_name, '')) IN ('my share', 'myshare')
            )
            THEN ABS(COALESCE(li.amount, 0))
          WHEN lower(COALESCE(s.split_mode, '')) = 'itemized'
            AND lower(COALESCE(li.line_kind, li.expense_for, '')) <> 'refund'
            THEN ABS(COALESCE(li.amount, 0))
          ELSE 0
        END
      ),
      0
    ) AS split_expense_amount,
    COALESCE(
      SUM(
        CASE
          WHEN lower(COALESCE(li.expense_for, '')) = 'shared_joy'
            THEN ABS(COALESCE(li.amount, 0))
          ELSE 0
        END
      ),
      0
    ) AS shared_joy_amount
  FROM transaction_splits s
  LEFT JOIN transaction_split_line_items li
    ON s.id = li.split_id
  GROUP BY s.transaction_id
)
SELECT
  t.id::text AS id,
  t.transaction_date,
  t.transaction_time,
  t.narration,
  t.vendor_name,
  t.counterparty_identifier,
  t.counterparty_entity_name,
  t.counterparty_entity_type,
  t.amount,
  t.running_balance,
  t.direction,
  t.payment_source_name,
  t.statement_sources,
  COALESCE(NULLIF(BTRIM(t.review_status), ''), 'unreviewed') AS review_status,
  COALESCE(t.review_status_manual, FALSE) AS review_status_manual,
  COALESCE(NULLIF(BTRIM(t.counterparty_type), ''), '') AS counterparty_type,
  COALESCE(NULLIF(BTRIM(t.primary_flow_type), ''), '') AS primary_flow_type,
  COALESCE(NULLIF(BTRIM(t.consumption_ownership), ''), '') AS consumption_ownership,
  COALESCE(NULLIF(BTRIM(t.settlement_state), ''), '') AS settlement_state,
  COALESCE(t.no_tag_required, FALSE) AS no_tag_required,
  COALESCE(t.no_split_required, FALSE) AS no_split_required,
  COALESCE(rtd.linked_as_recovery, FALSE) AS linked_as_recovery,
  rtd.linked_recovery_type,
  COALESCE(td.tags, '[]'::jsonb) AS tags,
  COALESCE(td.has_income_tag, FALSE) AS has_income_tag,
  COALESCE(td.has_non_spend_tag, FALSE) AS has_non_spend_tag,
  COALESCE(rd.recovery_amount, 0) AS recovery_amount,
  COALESCE(sd.split_expense_amount, 0) AS split_expense_amount,
  COALESCE(sd.shared_joy_amount, 0) AS shared_joy_amount,
  CASE
    WHEN COALESCE(rtd.linked_as_recovery, FALSE)
      THEN 'Not Required'
    WHEN COALESCE(t.no_tag_required, FALSE)
      THEN 'Not Required'
    WHEN lower(COALESCE(t.direction, '')) = 'withdrawal' AND ABS(COALESCE(t.amount, 0)) > 0
      AND COALESCE(td.tag_count, 0) = 0
      THEN 'Needs Tag'
    ELSE 'Tagged'
  END AS tag_status,
  CASE
    WHEN COALESCE(rtd.linked_as_recovery, FALSE)
      THEN 'Not Required'
    WHEN COALESCE(t.no_split_required, FALSE)
      THEN 'Not Required'
    WHEN lower(COALESCE(t.direction, '')) <> 'withdrawal' OR ABS(COALESCE(t.amount, 0)) = 0
      THEN 'Not Required'
    WHEN COALESCE(sd.split_count, 0) > 0
      THEN 'Split Done'
    ELSE 'Needs Split'
  END AS split_status,
  CASE
    WHEN COALESCE(rtd.linked_as_recovery, FALSE)
      THEN 'Done'
    WHEN (
      COALESCE(t.no_tag_required, FALSE)
      OR lower(COALESCE(t.direction, '')) <> 'withdrawal'
      OR ABS(COALESCE(t.amount, 0)) = 0
      OR COALESCE(td.tag_count, 0) > 0
    ) AND (
      COALESCE(t.no_split_required, FALSE)
      OR lower(COALESCE(t.direction, '')) <> 'withdrawal'
      OR ABS(COALESCE(t.amount, 0)) = 0
      OR COALESCE(sd.split_count, 0) > 0
    )
      THEN 'Done'
    WHEN NOT (
      COALESCE(t.no_tag_required, FALSE)
      OR lower(COALESCE(t.direction, '')) <> 'withdrawal'
      OR ABS(COALESCE(t.amount, 0)) = 0
      OR COALESCE(td.tag_count, 0) > 0
    ) AND NOT (
      COALESCE(t.no_split_required, FALSE)
      OR lower(COALESCE(t.direction, '')) <> 'withdrawal'
      OR ABS(COALESCE(t.amount, 0)) = 0
      OR COALESCE(sd.split_count, 0) > 0
    )
      THEN 'Needs Tag & Split'
    WHEN NOT (
      COALESCE(t.no_tag_required, FALSE)
      OR lower(COALESCE(t.direction, '')) <> 'withdrawal'
      OR ABS(COALESCE(t.amount, 0)) = 0
      OR COALESCE(td.tag_count, 0) > 0
    )
      THEN 'Needs Tag'
    WHEN NOT (
      COALESCE(t.no_split_required, FALSE)
      OR lower(COALESCE(t.direction, '')) <> 'withdrawal'
      OR ABS(COALESCE(t.amount, 0)) = 0
      OR COALESCE(sd.split_count, 0) > 0
    )
      THEN 'Needs Split'
    ELSE 'Done'
  END AS completion_status,
  CASE
    WHEN lower(COALESCE(t.direction, '')) = 'withdrawal'
      THEN GREATEST(ABS(COALESCE(t.amount, 0)) - COALESCE(rd.recovery_amount, 0) - COALESCE(sd.shared_joy_amount, 0), 0)
    ELSE ABS(COALESCE(t.amount, 0))
  END AS net_amount,
  CASE
    WHEN COALESCE(rtd.linked_as_recovery, FALSE)
      THEN 0
    WHEN lower(COALESCE(t.primary_flow_type, '')) IN ('transfer', 'investment_buy', 'loan_given')
      OR lower(COALESCE(sd.split_mode, '')) = 'self_transfer'
      THEN 0
    WHEN lower(COALESCE(t.direction, '')) = 'withdrawal'
      THEN GREATEST(ABS(COALESCE(t.amount, 0)) - COALESCE(rd.recovery_amount, 0) - COALESCE(sd.shared_joy_amount, 0), 0)
    ELSE 0
  END AS effective_expense_amount,
  CASE
    WHEN COALESCE(rtd.linked_as_recovery, FALSE)
      THEN 0
    WHEN lower(COALESCE(t.primary_flow_type, '')) = 'transfer'
      OR lower(COALESCE(sd.split_mode, '')) = 'self_transfer'
      THEN 0
    WHEN lower(COALESCE(t.direction, '')) <> 'withdrawal'
      THEN ABS(COALESCE(t.amount, 0))
    ELSE 0
  END AS effective_income_amount,
  CASE
    WHEN lower(COALESCE(t.primary_flow_type, '')) = 'investment_buy'
      AND lower(COALESCE(t.direction, '')) = 'withdrawal'
      THEN ABS(COALESCE(t.amount, 0))
    ELSE 0
  END AS effective_investment_amount

FROM transactions t
LEFT JOIN tag_data td
  ON t.id = td.transaction_id
LEFT JOIN recovery_data rd
  ON t.id = rd.transaction_id
LEFT JOIN recovery_target_data rtd
  ON t.id = rtd.transaction_id
LEFT JOIN split_data sd
  ON t.id = sd.transaction_id

WHERE
  (:from_date IS NULL OR t.transaction_date >= :from_date)
  AND
  (:to_date IS NULL OR t.transaction_date <= :to_date)
  AND
  (:vendor_filter IS NULL OR :vendor_filter = '' OR (
    lower(COALESCE(t.vendor_name, '')) LIKE lower(:vendor_filter_pattern)
    OR lower(COALESCE(t.counterparty_identifier, '')) LIKE lower(:vendor_filter_pattern)
  ))
  AND
  (:amount_filter IS NULL OR ABS(ABS(COALESCE(t.amount, 0)) - :amount_filter) <= 0.01)
  AND
  (:tag_filter IS NULL OR :tag_filter = '' OR EXISTS (
    SELECT 1
    FROM public.transaction_tags filter_t_tags
    JOIN public.system_tags filter_s_tags
      ON filter_t_tags.tag_id = filter_s_tags.id
    __FILTER_DUPJOIN__
    WHERE filter_t_tags.transaction_id = t.id
      AND COALESCE(filter_s_tags.managed_by_schema, FALSE) = TRUE
      AND COALESCE(filter_s_tags.is_active, TRUE) = TRUE
      AND (
        lower(__FILTER_LABEL__) = lower(:tag_filter)
        OR lower(filter_s_tags.name) LIKE lower(:tag_filter_pattern)
      )
  ))

ORDER BY t.transaction_date ASC, t.id ASC;
    """
    _sql = (
        _sql.replace("__TAG_LABEL__", _tag_label)
            .replace("__TAG_DUPJOIN__", _tag_dupjoin)
            .replace("__FILTER_LABEL__", _filter_label)
            .replace("__FILTER_DUPJOIN__", _filter_dupjoin)
    )
    sql = text(_sql)

    amount_filter = None
    try:
        if filters.amount_filter is not None:
            amount_filter = abs(float(filters.amount_filter))
    except (TypeError, ValueError):
        amount_filter = None

    params = {
        "from_date": filters.from_date,
        "to_date": filters.to_date,
        "vendor_filter": (filters.vendor_filter or "").strip(),
        "vendor_filter_pattern": f"%{(filters.vendor_filter or '').strip()}%",
        "amount_filter": amount_filter,
        "tag_filter": (getattr(filters, "tag_filter", None) or "").strip(),
        "tag_filter_pattern": f"%{(getattr(filters, 'tag_filter', None) or '').strip()}%",
    }

    # Optional: filter by specific transaction IDs (overrides date/vendor/tag filters)
    txn_id_list = getattr(filters, "transaction_ids", None)
    if txn_id_list:
        from uuid import UUID as _UUID
        valid = []
        for tid in txn_id_list:
            try: valid.append(str(_UUID(str(tid))))
            except (ValueError, AttributeError): pass
        if valid:
            in_clause = ",".join(f"'{tid}'" for tid in valid)
            _sql_with_ids = _sql.replace(
                "ORDER BY t.transaction_date ASC",
                f"AND t.id::text IN ({in_clause})\nORDER BY t.transaction_date ASC",
            )
            result = db.execute(text(_sql_with_ids), params).mappings().all()
            return result

    result = db.execute(sql, params).mappings().all()
    return result
    

def _money(value):
    try:
        return Decimal(value or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def _money_float(value):
    return float(_money(value))


def _build_balance_components(source_rows):
    row_states = []
    balances = set()
    graph = defaultdict(set)

    for index, row in enumerate(source_rows):
        amount = _money(row["amount"])
        is_withdrawal = row["direction"] == "withdrawal"
        signed_amount = -amount if is_withdrawal else amount
        after_balance = _money(row["running_balance"])
        before_balance = after_balance - signed_amount
        balances.add(before_balance)
        balances.add(after_balance)
        graph[before_balance].add(after_balance)
        graph[after_balance].add(before_balance)
        row_states.append(
            {
                "index": index,
                "row": row,
                "before_balance": before_balance,
                "after_balance": after_balance,
                "amount": amount,
                "is_withdrawal": is_withdrawal,
            }
        )

    seen = set()
    components = []
    for balance in balances:
        if balance in seen:
            continue
        stack = [balance]
        seen.add(balance)
        component_balances = set()
        while stack:
            current = stack.pop()
            component_balances.add(current)
            for next_balance in graph[current]:
                if next_balance not in seen:
                    seen.add(next_balance)
                    stack.append(next_balance)

        component_states = [
            state
            for state in row_states
            if state["before_balance"] in component_balances
            or state["after_balance"] in component_balances
        ]
        if not component_states:
            continue

        component_rows = [state["row"] for state in component_states]
        component_before = {state["before_balance"] for state in component_states}
        component_after = {state["after_balance"] for state in component_states}
        opening_candidates = sorted(component_before - component_after)
        closing_candidates = sorted(component_after - component_before)
        total_credit = sum(
            state["amount"] for state in component_states if not state["is_withdrawal"]
        )
        total_debit = sum(
            state["amount"] for state in component_states if state["is_withdrawal"]
        )
        opening_balance = (
            opening_candidates[0]
            if opening_candidates
            else min(component_balances)
        )
        closing_balance = (
            closing_candidates[-1]
            if closing_candidates
            else max(component_balances)
        )
        net_movement = total_credit - total_debit

        components.append(
            {
                "first_transaction_date": min(row["transaction_date"] for row in component_rows),
                "latest_transaction_date": max(row["transaction_date"] for row in component_rows),
                "transaction_count": len(component_rows),
                "opening_balance": _money_float(opening_balance),
                "closing_balance": _money_float(closing_balance),
                "total_debit": _money_float(total_debit),
                "total_credit": _money_float(total_credit),
                "net_movement": _money_float(net_movement),
                "calculated_closing_balance": _money_float(opening_balance + net_movement),
                "mismatch_amount": _money_float((opening_balance + net_movement) - closing_balance),
                "opening_component_count": len(opening_candidates),
                "closing_component_count": len(closing_candidates),
            }
        )

    components.sort(key=lambda component: component["first_transaction_date"])
    for index, component in enumerate(components):
        component["component_index"] = index + 1
        component["component_count"] = len(components)
        if index + 1 < len(components):
            next_component = components[index + 1]
            component["next_component_first_date"] = next_component["first_transaction_date"]
            component["next_component_opening_balance"] = next_component["opening_balance"]
            component["gap_amount_to_next_component"] = _money_float(
                _money(next_component["opening_balance"]) - _money(component["closing_balance"])
            )
        else:
            component["next_component_first_date"] = None
            component["next_component_opening_balance"] = None
            component["gap_amount_to_next_component"] = 0.0

    return components


def get_balance_reconciliation(db: Session):
    backfill_transaction_sources(db)

    rows = db.execute(
        text(
            """
            SELECT
                COALESCE(NULLIF(BTRIM(payment_source_name), ''), 'UNKNOWN') AS source_name,
                transaction_date,
                transaction_time,
                lower(COALESCE(direction, '')) AS direction,
                ABS(COALESCE(amount, 0)) AS amount,
                running_balance
            FROM public.transactions
            WHERE running_balance IS NOT NULL
            ORDER BY payment_source_name ASC, transaction_date ASC
            """
        )
    ).mappings().all()

    grouped_rows = {}
    for row in rows:
        grouped_rows.setdefault(row["source_name"], []).append(row)

    reconciliation_rows = []
    for source_name, source_rows in sorted(grouped_rows.items()):
        balance_components = _build_balance_components(source_rows)
        first_date = min(row["transaction_date"] for row in source_rows)
        latest_date = max(row["transaction_date"] for row in source_rows)
        latest_rows = [row for row in source_rows if row["transaction_date"] == latest_date]
        latest_rows.sort(
            key=lambda row: (
                row["transaction_time"] is not None,
                row["transaction_time"] or "",
                _money(row["running_balance"]),
            )
        )
        latest_row = latest_rows[-1]

        total_credit = Decimal("0.00")
        total_debit = Decimal("0.00")
        after_balances = set()
        before_balances = set()
        first_date_before_balances = []

        for row in source_rows:
            amount = _money(row["amount"])
            is_withdrawal = row["direction"] == "withdrawal"
            signed_amount = -amount if is_withdrawal else amount
            running_balance = _money(row["running_balance"])
            before_balance = running_balance - signed_amount
            after_balances.add(running_balance)
            before_balances.add(before_balance)
            if row["transaction_date"] == first_date:
                first_date_before_balances.append(before_balance)
            if is_withdrawal:
                total_debit += amount
            else:
                total_credit += amount

        opening_candidates = sorted(before_balances - after_balances)
        closing_candidates = sorted(after_balances - before_balances)
        first_day_opening_candidates = [
            balance for balance in sorted(set(first_date_before_balances))
            if balance in opening_candidates
        ]
        inferred_opening = (
            first_day_opening_candidates[0]
            if first_day_opening_candidates
            else (opening_candidates[0] if opening_candidates else Decimal("0.00"))
        )
        net_movement = total_credit - total_debit
        calculated_closing = inferred_opening + net_movement
        statement_closing = (
            closing_candidates[-1]
            if closing_candidates
            else _money(latest_row["running_balance"])
        )
        latest_date_rows_without_time = sum(
            1 for row in latest_rows if row["transaction_time"] is None
        )

        reconciliation_rows.append(
            {
                "source_name": source_name,
                "transaction_count": len(source_rows),
                "first_transaction_date": first_date,
                "latest_transaction_date": latest_date,
                "opening_reference_date": first_date,
                "inferred_opening_balance": _money_float(inferred_opening),
                "total_debit": _money_float(total_debit),
                "total_credit": _money_float(total_credit),
                "net_movement": _money_float(net_movement),
                "closing_reference_date": latest_row["transaction_date"],
                "closing_reference_time": latest_row["transaction_time"],
                "statement_closing_balance": _money_float(statement_closing),
                "calculated_closing_balance": _money_float(calculated_closing),
                "mismatch_amount": _money_float(calculated_closing - statement_closing),
                "opening_component_count": len(opening_candidates),
                "closing_component_count": len(closing_candidates),
                "latest_date_rows_without_time": latest_date_rows_without_time,
                "balance_components": balance_components,
            }
        )

    return reconciliation_rows


def transaction_details(txn_id: UUID, db: Session):
    _td_label = label_expr("s_tags", "s_tags_")
    _td_dupjoin = dup_join("s_tags", "s_tags_")
    _sql = """
    SELECT jsonb_build_object(
        'transaction_date', t.transaction_date,
        'transaction_time', t.transaction_time,
        'amount', t.amount,
        'counterparty_identifier', t.counterparty_identifier,
        'direction', t.direction,
        'narration', t.narration,
        'vendor_name', t.vendor_name,
        'counterparty_entity_name', t.counterparty_entity_name,
        'counterparty_entity_type', t.counterparty_entity_type,
        'payment_source_name', t.payment_source_name,
        'statement_sources', t.statement_sources,
        'review_status', COALESCE(NULLIF(BTRIM(t.review_status), ''), 'unreviewed'),
        'review_status_manual', COALESCE(t.review_status_manual, FALSE),
        'counterparty_type', COALESCE(NULLIF(BTRIM(t.counterparty_type), ''), ''),
        'primary_flow_type', COALESCE(NULLIF(BTRIM(t.primary_flow_type), ''), ''),
        'consumption_ownership', COALESCE(NULLIF(BTRIM(t.consumption_ownership), ''), ''),
        'settlement_state', COALESCE(NULLIF(BTRIM(t.settlement_state), ''), ''),
        'no_tag_required', COALESCE(t.no_tag_required, FALSE),
        'no_split_required', COALESCE(t.no_split_required, FALSE),
        'linked_as_recovery', EXISTS(
            SELECT 1
            FROM public.transaction_split_recoveries r
            WHERE r.recovery_transaction_id = t.id
        ),
        'tag_names', ARRAY_AGG(DISTINCT __TD_LABEL__),
        'tag_subcategory_ids', COALESCE(
            ARRAY_AGG(DISTINCT s_tags.subcategory_id::text)
                FILTER (WHERE s_tags.subcategory_id IS NOT NULL),
            ARRAY[]::text[]
        ),
        'tag_category_ids', COALESCE(
            ARRAY_AGG(DISTINCT s_tags.category_id::text)
                FILTER (WHERE s_tags.category_id IS NOT NULL AND s_tags.subcategory_id IS NULL),
            ARRAY[]::text[]
        )
    )
    FROM public.transactions t
    LEFT JOIN transaction_tags AS t_tags
        ON t.id = t_tags.transaction_id
    LEFT JOIN system_tags AS s_tags
        ON t_tags.tag_id = s_tags.id
       AND COALESCE(s_tags.managed_by_schema, FALSE) = TRUE
       AND COALESCE(s_tags.is_active, TRUE) = TRUE
    __TD_DUPJOIN__
    WHERE t.id = :txn_id
    GROUP BY t.id;
    """
    _sql = _sql.replace("__TD_LABEL__", _td_label).replace("__TD_DUPJOIN__", _td_dupjoin)
    sql = text(_sql)

    row = db.execute(sql, {"txn_id": txn_id}).mappings().first()
    if not row:
        return None
    return dict(row)["jsonb_build_object"]


def get_counterparty_learning_profile(txn_id: UUID, counterparty_identifier, db: Session):
    normalized_counterparty = (counterparty_identifier or "").strip()
    if not normalized_counterparty:
        return None

    entity = get_counterparty_entity_for_identifier(normalized_counterparty, db)
    if entity:
        total_matches = db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM public.transactions t
                JOIN public.counterparty_entity_aliases a
                  ON lower(COALESCE(t.counterparty_identifier, '')) = a.normalized_counterparty_identifier
                WHERE t.id <> :txn_id
                  AND a.entity_id = :entity_id
                """
            ),
            {"txn_id": txn_id, "entity_id": entity["entity_id"]},
        ).scalar() or 0

        learned_row = db.execute(
            text(
                """
                SELECT
                    t.id::text AS transaction_id,
                    COALESCE(NULLIF(BTRIM(t.vendor_name), ''), :entity_name) AS vendor_name,
                    NULLIF(BTRIM(t.primary_flow_type), '') AS primary_flow_type,
                    COALESCE(NULLIF(BTRIM(t.counterparty_type), ''), :entity_type) AS counterparty_type,
                    COALESCE(NULLIF(BTRIM(t.review_status), ''), 'unreviewed') AS review_status,
                    t.transaction_date,
                    :entity_name AS entity_name,
                    :entity_type AS entity_type
                FROM public.transactions t
                JOIN public.counterparty_entity_aliases a
                  ON lower(COALESCE(t.counterparty_identifier, '')) = a.normalized_counterparty_identifier
                WHERE t.id <> :txn_id
                  AND a.entity_id = :entity_id
                  AND (
                    COALESCE(NULLIF(BTRIM(t.vendor_name), ''), '') <> ''
                    OR COALESCE(NULLIF(BTRIM(t.primary_flow_type), ''), '') <> ''
                    OR COALESCE(NULLIF(BTRIM(t.counterparty_type), ''), '') <> ''
                  )
                ORDER BY t.transaction_date DESC, t.id DESC
                LIMIT 1
                """
            ),
            {
                "txn_id": txn_id,
                "entity_id": entity["entity_id"],
                "entity_name": entity["entity_name"],
                "entity_type": entity["entity_type"],
            },
        ).mappings().first()

        alias_count = db.execute(
            text(
                """
                SELECT COUNT(*)::int
                FROM public.counterparty_entity_aliases
                WHERE entity_id = :entity_id
                """
            ),
            {"entity_id": entity["entity_id"]},
        ).scalar() or 0

        if not learned_row and not total_matches:
            return {
                "vendor_name": entity["entity_name"],
                "counterparty_type": entity["entity_type"],
                "entity_name": entity["entity_name"],
                "entity_type": entity["entity_type"],
                "match_count": 0,
                "alias_count": int(alias_count),
            }

        profile = dict(learned_row) if learned_row else {}
        profile["vendor_name"] = profile.get("vendor_name") or entity["entity_name"]
        profile["counterparty_type"] = profile.get("counterparty_type") or entity["entity_type"]
        profile["entity_name"] = entity["entity_name"]
        profile["entity_type"] = entity["entity_type"]
        profile["match_count"] = int(total_matches)
        profile["alias_count"] = int(alias_count)
        profile["learned_from_entity"] = True
        return profile

    total_matches = db.execute(
        text(
            """
            SELECT COUNT(*)
            FROM public.transactions t
            WHERE t.id <> :txn_id
              AND lower(COALESCE(t.counterparty_identifier, '')) = lower(:counterparty_identifier)
            """
        ),
        {"txn_id": txn_id, "counterparty_identifier": normalized_counterparty},
    ).scalar() or 0

    learned_row = db.execute(
        text(
            """
            SELECT
                t.id::text AS transaction_id,
                NULLIF(BTRIM(t.vendor_name), '') AS vendor_name,
                NULLIF(BTRIM(t.primary_flow_type), '') AS primary_flow_type,
                NULLIF(BTRIM(t.counterparty_type), '') AS counterparty_type,
                COALESCE(NULLIF(BTRIM(t.review_status), ''), 'unreviewed') AS review_status,
                t.transaction_date
            FROM public.transactions t
            WHERE t.id <> :txn_id
              AND lower(COALESCE(t.counterparty_identifier, '')) = lower(:counterparty_identifier)
              AND (
                COALESCE(NULLIF(BTRIM(t.vendor_name), ''), '') <> ''
                OR COALESCE(NULLIF(BTRIM(t.primary_flow_type), ''), '') <> ''
                OR COALESCE(NULLIF(BTRIM(t.counterparty_type), ''), '') <> ''
              )
            ORDER BY t.transaction_date DESC, t.id DESC
            LIMIT 1
            """
        ),
        {"txn_id": txn_id, "counterparty_identifier": normalized_counterparty},
    ).mappings().first()

    if not learned_row and not total_matches:
        return None

    profile = dict(learned_row) if learned_row else {}
    profile["match_count"] = int(total_matches)
    profile["learned_from_entity"] = False
    return profile


def is_linked_recovery_transaction(transaction_id, db: Session):
    return bool(
        db.execute(
            text(
                """
                SELECT EXISTS(
                    SELECT 1
                    FROM public.transaction_split_recoveries
                    WHERE recovery_transaction_id = :transaction_id
                )
                """
            ),
            {"transaction_id": transaction_id},
        ).scalar()
    )


def list_recovery_candidates_for_transaction(transaction_id, db: Session, limit: int = 30):
    rows = db.execute(
        text(
            """
            WITH original_tx AS (
                SELECT
                    transaction_date,
                    ABS(COALESCE(amount, 0)) AS amount
                FROM public.transactions
                WHERE id = :transaction_id
            )
            SELECT
                t.id::text AS id,
                t.transaction_date,
                t.transaction_time,
                t.vendor_name,
                t.counterparty_identifier,
                ABS(COALESCE(t.amount, 0)) AS amount,
                t.payment_source_name,
                t.statement_sources
            FROM public.transactions t
            CROSS JOIN original_tx o
            LEFT JOIN public.transaction_split_recoveries r
              ON r.recovery_transaction_id = t.id
            WHERE t.id::text <> :transaction_id
              AND lower(COALESCE(t.direction, '')) <> 'withdrawal'
              AND r.id IS NULL
              AND ABS(COALESCE(t.amount, 0)) <= o.amount
              AND t.transaction_date >= o.transaction_date
            ORDER BY
              CASE WHEN ABS(COALESCE(t.amount, 0)) = o.amount THEN 0 ELSE 1 END,
              ABS(o.amount - ABS(COALESCE(t.amount, 0))),
              t.transaction_date ASC,
              COALESCE(t.transaction_time, '00:00:00') ASC,
              t.id ASC
            LIMIT :limit
            """
        ),
        {"transaction_id": transaction_id, "limit": limit},
    ).mappings().all()
    return [dict(row) for row in rows]


def list_self_transfer_candidates_for_transaction(transaction_id, db: Session, limit: int = 20):
    rows = db.execute(
        text(
            """
            WITH source_tx AS (
                SELECT
                    id,
                    transaction_date,
                    ABS(COALESCE(amount, 0)) AS amount,
                    lower(COALESCE(direction, '')) AS direction
                FROM public.transactions
                WHERE id = :transaction_id
            )
            SELECT
                t.id::text AS id,
                t.transaction_date,
                t.transaction_time,
                t.vendor_name,
                t.counterparty_identifier,
                ABS(COALESCE(t.amount, 0)) AS amount,
                lower(COALESCE(t.direction, '')) AS direction,
                t.payment_source_name,
                t.statement_sources
            FROM public.transactions t
            CROSS JOIN source_tx s
            LEFT JOIN public.transaction_split_recoveries linked
              ON linked.recovery_transaction_id = t.id
            WHERE t.id::text <> :transaction_id
              AND linked.id IS NULL
              AND ABS(COALESCE(t.amount, 0) - s.amount) <= 0.01
              AND lower(COALESCE(t.direction, '')) <> s.direction
              AND (
                t.transaction_date BETWEEN s.transaction_date - INTERVAL '7 days'
                AND s.transaction_date + INTERVAL '7 days'
              )
            ORDER BY
              ABS(EXTRACT(EPOCH FROM (t.transaction_date::timestamp - s.transaction_date::timestamp))),
              t.transaction_date DESC,
              t.id DESC
            LIMIT :limit
            """
        ),
        {"transaction_id": transaction_id, "limit": limit},
    ).mappings().all()
    return [dict(row) for row in rows]

def _resolve_tag_id(tag, db: Session):
    """Resolve a tag token to the exact node-bound system_tags id.

    The token is a collision-aware display name: plain ``name`` for unique tags,
    or ``"<name> (<parent>)"`` for a leaf whose name repeats under multiple
    parents. We prefer an exact display-name match (so "petrol (2-Wheeler)" hits
    the right node), then fall back to a bare-name match for legacy callers.
    """
    label = label_expr("st", "st_")
    dupj = dup_join("st", "st_")
    sql = text(f"""
        WITH labeled AS (
            SELECT st.id, {label} AS display_name, st.name
            FROM public.system_tags st
            {dupj}
            WHERE COALESCE(st.managed_by_schema, FALSE) = TRUE
              AND COALESCE(st.is_active, TRUE) = TRUE
        )
        SELECT id FROM labeled
        WHERE lower(display_name) = lower(:tag) OR lower(name) = lower(:tag)
        ORDER BY (lower(display_name) = lower(:tag)) DESC, id ASC
        LIMIT 1
    """)
    result = db.execute(sql, {"tag": tag}).mappings().first()
    return result["id"] if result else None


def add_transaction_tags(tags_to_add, transaction_id, db: Session):
    for tag in tags_to_add:
        tag_id = _resolve_tag_id(tag, db)
        if tag_id is None:
            continue

        insert_transaction_tag_sql = text("""
        INSERT INTO public.transaction_tags (transaction_id, tag_id, applied_by, applied_at)
        VALUES (:transaction_id, :tag_id, 'USER', NOW())
        ON CONFLICT (transaction_id, tag_id) DO NOTHING
        """)
        db.execute(insert_transaction_tag_sql, {"transaction_id": transaction_id, "tag_id": tag_id})
    db.commit()

def remove_transaction_tags(tags_to_remove, transaction_id, db: Session):
    for tag in tags_to_remove:
        tag_id = _resolve_tag_id(tag, db)
        if tag_id is not None:
            delete_sql = text("""
            DELETE FROM public.transaction_tags WHERE transaction_id = :transaction_id AND tag_id = :tag_id
            """)
            db.execute(delete_sql, {"transaction_id": transaction_id, "tag_id": tag_id})
    db.commit()


def clear_all_transaction_tags(transaction_id, db: Session):
    db.execute(
        text(
            """
            DELETE FROM public.transaction_tags
            WHERE transaction_id = :transaction_id
            """
        ),
        {"transaction_id": transaction_id},
    )
    db.commit()

def add_new_narration(transaction_id, vendor_name, db: Session):
    sql = text("""
    UPDATE public.transactions SET vendor_name = :vendor_name WHERE id = :transaction_id
    """)
    db.execute(sql, {"vendor_name": vendor_name, "transaction_id": transaction_id})
    db.commit()


def update_transaction_requirement_flags(
    transaction_id,
    db: Session,
    no_tag_required=None,
    no_split_required=None,
):
    if no_tag_required is None and no_split_required is None:
        return

    assignments = []
    params = {"transaction_id": transaction_id}
    if no_tag_required is not None:
        assignments.append("no_tag_required = :no_tag_required")
        params["no_tag_required"] = bool(no_tag_required)
    if no_split_required is not None:
        assignments.append("no_split_required = :no_split_required")
        params["no_split_required"] = bool(no_split_required)

    sql = text(
        f"""
        UPDATE public.transactions
        SET {", ".join(assignments)}
        WHERE id = :transaction_id
        """
    )
    db.execute(sql, params)
    db.commit()


def update_transaction_review_fields(
    transaction_id,
    db: Session,
    review_status=None,
    review_status_manual=None,
    counterparty_type=None,
    primary_flow_type=None,
    consumption_ownership=None,
    settlement_state=None,
):
    if (
        review_status is None
        and review_status_manual is None
        and counterparty_type is None
        and primary_flow_type is None
        and consumption_ownership is None
        and settlement_state is None
    ):
        return

    assignments = []
    params = {"transaction_id": transaction_id}
    if review_status is not None:
        assignments.append("review_status = :review_status")
        params["review_status"] = (review_status or "").strip() or "unreviewed"
    if review_status_manual is not None:
        assignments.append("review_status_manual = :review_status_manual")
        params["review_status_manual"] = bool(review_status_manual)
    if counterparty_type is not None:
        assignments.append("counterparty_type = :counterparty_type")
        params["counterparty_type"] = (counterparty_type or "").strip() or None
    if primary_flow_type is not None:
        assignments.append("primary_flow_type = :primary_flow_type")
        params["primary_flow_type"] = (primary_flow_type or "").strip() or None
    if consumption_ownership is not None:
        assignments.append("consumption_ownership = :consumption_ownership")
        params["consumption_ownership"] = (consumption_ownership or "").strip() or None
    if settlement_state is not None:
        assignments.append("settlement_state = :settlement_state")
        params["settlement_state"] = (settlement_state or "").strip() or None

    sql = text(
        f"""
        UPDATE public.transactions
        SET {", ".join(assignments)}
        WHERE id = :transaction_id
        """
    )
    db.execute(sql, params)
    db.commit()


def propagate_vendor_name_to_overlapping_transactions(
    transaction_id,
    vendor_name,
    db: Session,
    tolerance_seconds: int = 300,
):
    normalized_vendor_name = (vendor_name or "").strip()
    if not normalized_vendor_name:
        return []

    sql = text("""
    WITH source_tx AS (
        SELECT
            id,
            transaction_date,
            amount,
            direction,
            narration,
            counterparty_identifier,
            transaction_time,
            payment_source_name,
            payment_mode
        FROM public.transactions
        WHERE id = :transaction_id
    ),
    updated_rows AS (
        UPDATE public.transactions AS target
        SET
            vendor_name = CASE
                WHEN COALESCE(NULLIF(BTRIM(target.vendor_name), ''), '') = ''
                    THEN :vendor_name
                ELSE target.vendor_name
            END,
            narration = CASE
                WHEN COALESCE(NULLIF(BTRIM(target.narration), ''), '') = ''
                    THEN source.narration
                ELSE target.narration
            END,
            counterparty_identifier = CASE
                WHEN COALESCE(NULLIF(BTRIM(target.counterparty_identifier), ''), '') = ''
                    THEN source.counterparty_identifier
                ELSE target.counterparty_identifier
            END
        FROM source_tx AS source
        WHERE
            target.id <> source.id
            AND target.transaction_date = source.transaction_date
            AND lower(COALESCE(target.direction, '')) = lower(COALESCE(source.direction, ''))
            AND ABS(COALESCE(target.amount, 0)) = ABS(COALESCE(source.amount, 0))
            AND COALESCE(target.payment_source_name, '') <> COALESCE(source.payment_source_name, '')
            AND COALESCE(target.payment_mode, '') = COALESCE(source.payment_mode, '')
            AND target.transaction_time IS NOT NULL
            AND source.transaction_time IS NOT NULL
            AND ABS(
                EXTRACT(
                    EPOCH FROM (
                        target.transaction_time::time - source.transaction_time::time
                    )
                )
            ) <= :tolerance_seconds
            AND (
                COALESCE(NULLIF(BTRIM(target.vendor_name), ''), '') = ''
                OR COALESCE(NULLIF(BTRIM(target.narration), ''), '') = ''
                OR COALESCE(NULLIF(BTRIM(target.counterparty_identifier), ''), '') = ''
            )
        RETURNING target.id::text AS id
    )
    SELECT id FROM updated_rows
    """)
    result = db.execute(
        sql,
        {
            "transaction_id": transaction_id,
            "vendor_name": normalized_vendor_name,
            "tolerance_seconds": tolerance_seconds,
        },
    ).scalars().all()
    db.commit()
    return list(result)


def backfill_vendor_names_from_overlaps(db: Session, tolerance_seconds: int = 300):
    sql = text("""
    WITH candidate_matches AS (
        SELECT DISTINCT ON (target.id)
            target.id,
            source.vendor_name,
            source.narration,
            source.counterparty_identifier
        FROM public.transactions AS target
        JOIN public.transactions AS source
            ON target.id <> source.id
            AND target.transaction_date = source.transaction_date
            AND lower(COALESCE(target.direction, '')) = lower(COALESCE(source.direction, ''))
            AND ABS(COALESCE(target.amount, 0)) = ABS(COALESCE(source.amount, 0))
            AND COALESCE(target.payment_source_name, '') <> COALESCE(source.payment_source_name, '')
            AND COALESCE(target.payment_mode, '') = COALESCE(source.payment_mode, '')
            AND target.transaction_time IS NOT NULL
            AND source.transaction_time IS NOT NULL
            AND ABS(
                EXTRACT(
                    EPOCH FROM (
                        target.transaction_time::time - source.transaction_time::time
                    )
                )
            ) <= :tolerance_seconds
        WHERE
            (
                COALESCE(NULLIF(BTRIM(target.vendor_name), ''), '') = ''
                OR COALESCE(NULLIF(BTRIM(target.narration), ''), '') = ''
                OR COALESCE(NULLIF(BTRIM(target.counterparty_identifier), ''), '') = ''
            )
            AND (
                COALESCE(NULLIF(BTRIM(source.vendor_name), ''), '') <> ''
                OR COALESCE(NULLIF(BTRIM(source.narration), ''), '') <> ''
                OR COALESCE(NULLIF(BTRIM(source.counterparty_identifier), ''), '') <> ''
            )
        ORDER BY
            target.id,
            ABS(
                EXTRACT(
                    EPOCH FROM (
                        target.transaction_time::time - source.transaction_time::time
                    )
                )
            ) ASC,
            source.id ASC
    ),
    updated_rows AS (
        UPDATE public.transactions AS target
        SET
            vendor_name = CASE
                WHEN COALESCE(NULLIF(BTRIM(target.vendor_name), ''), '') = ''
                    THEN candidate_matches.vendor_name
                ELSE target.vendor_name
            END,
            narration = CASE
                WHEN COALESCE(NULLIF(BTRIM(target.narration), ''), '') = ''
                    THEN candidate_matches.narration
                ELSE target.narration
            END,
            counterparty_identifier = CASE
                WHEN COALESCE(NULLIF(BTRIM(target.counterparty_identifier), ''), '') = ''
                    THEN candidate_matches.counterparty_identifier
                ELSE target.counterparty_identifier
            END
        FROM candidate_matches
        WHERE target.id = candidate_matches.id
        RETURNING target.id::text AS id
    )
    SELECT COUNT(*)::int FROM updated_rows
    """)
    updated_count = db.execute(
        sql, {"tolerance_seconds": tolerance_seconds}
    ).scalar() or 0
    db.commit()
    return updated_count

def count_counterparty_identifier_sql(counterparty_identifier, db: Session):
    sql = text("""
    SELECT COUNT(counterparty_identifier) FROM public.transactions WHERE counterparty_identifier=:counterparty_identifier
    """)

    result = db.execute(sql, {"counterparty_identifier": counterparty_identifier}).scalar()
    return result


def find_ids_of_counterparty_identifier(counterparty_identifier, db: Session):
    sql = text("""
    SELECT id FROM public.transactions WHERE counterparty_identifier=:counterparty_identifier
    """)

    result = db.execute(sql, {"counterparty_identifier": counterparty_identifier}).scalars().all()
    ids = [row for row in result]
    return ids
