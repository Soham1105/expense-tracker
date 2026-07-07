import json
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from repositories.transaction_search import get_balance_reconciliation, tag_transactions


def _clean_text(value):
    cleaned = str(value or "").strip()
    return cleaned or None


def _money(value):
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def _money_float(value):
    return float(_money(value))


def _coerce_month_start(value) -> date:
    if hasattr(value, "date") and not hasattr(value, "day"):
        value = value.date()
    if hasattr(value, "replace") and hasattr(value, "day"):
        return value.replace(day=1)
    cleaned = str(value or "").strip()
    if not cleaned:
        return date.today().replace(day=1)
    return date.fromisoformat(cleaned[:10]).replace(day=1)


def _row_dict(row):
    return dict(row) if row else None


def _normalize_tags(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    if isinstance(value, tuple):
        return [str(item).strip() for item in value if str(item or "").strip()]
    cleaned = str(value or "").strip()
    return [cleaned] if cleaned else []


def _primary_spend_bucket(row):
    tags = _normalize_tags(row.get("tags"))
    return tags[0] if tags else "Uncategorized"


def ensure_planning_tables(db: Session):
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.account_profiles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                account_name TEXT NOT NULL,
                account_type TEXT NOT NULL DEFAULT 'bank',
                institution_name TEXT,
                source_name TEXT,
                current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
                balance_as_of DATE,
                is_bank_linked BOOLEAN NOT NULL DEFAULT FALSE,
                link_status TEXT NOT NULL DEFAULT 'manual',
                notes TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_account_profiles_source_name
            ON public.account_profiles (upper(source_name))
            WHERE source_name IS NOT NULL AND BTRIM(source_name) <> '' AND is_active = TRUE
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.planned_expenses (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                amount NUMERIC(14, 2) NOT NULL,
                due_date DATE NOT NULL,
                frequency TEXT NOT NULL DEFAULT 'one_time',
                category TEXT,
                account_id UUID REFERENCES public.account_profiles(id) ON DELETE SET NULL,
                status TEXT NOT NULL DEFAULT 'planned',
                priority TEXT NOT NULL DEFAULT 'normal',
                notes TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.wishlist_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                item_name TEXT NOT NULL,
                expected_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                target_date DATE,
                priority TEXT NOT NULL DEFAULT 'nice_to_have',
                status TEXT NOT NULL DEFAULT 'wishlist',
                notes TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.monthly_budgets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                month_start DATE NOT NULL,
                budget_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                notes TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_budgets_month_start
            ON public.monthly_budgets (month_start)
            WHERE is_active = TRUE
            """
        )
    )
    db.execute(text("""
        ALTER TABLE public.monthly_budgets
        ADD COLUMN IF NOT EXISTS expected_income NUMERIC(14,2) NOT NULL DEFAULT 0
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.monthly_budget_closures (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            month_start DATE NOT NULL,
            budget_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
            actual_spent NUMERIC(14,2) NOT NULL DEFAULT 0,
            carry_forward_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
            statement_status JSONB NOT NULL DEFAULT '[]'::jsonb,
            closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            closed_by TEXT,
            notes TEXT,
            is_closed BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_budget_closures_month
        ON public.monthly_budget_closures (month_start)
        WHERE is_closed = TRUE
    """))
    # Net worth: expand account_profiles with asset classification
    db.execute(text("""
        ALTER TABLE public.account_profiles
        ADD COLUMN IF NOT EXISTS asset_class    TEXT NOT NULL DEFAULT 'asset',
        ADD COLUMN IF NOT EXISTS account_subtype TEXT,
        ADD COLUMN IF NOT EXISTS currency       TEXT NOT NULL DEFAULT 'INR'
    """))
    # Net worth: snapshot history
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.net_worth_snapshots (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            snapshot_date     DATE NOT NULL,
            total_assets      NUMERIC(14,2) NOT NULL DEFAULT 0,
            total_liabilities NUMERIC(14,2) NOT NULL DEFAULT 0,
            net_worth         NUMERIC(14,2) NOT NULL DEFAULT 0,
            breakdown         JSONB,
            notes             TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_net_worth_snapshots_date
        ON public.net_worth_snapshots (snapshot_date)
    """))
    # Net worth: goals
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.net_worth_goals (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title         TEXT NOT NULL,
            target_amount NUMERIC(14,2) NOT NULL,
            target_date   DATE,
            notes         TEXT,
            is_active     BOOLEAN NOT NULL DEFAULT TRUE,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    # Category budgets — keyed by name, no FK to system_tags
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.category_budgets (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            month_start   DATE NOT NULL,
            tag_name      TEXT NOT NULL,
            parent_name   TEXT,
            budget_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
            is_active     BOOLEAN NOT NULL DEFAULT TRUE,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_category_budgets_month_name
            ON public.category_budgets (month_start, LOWER(tag_name)) WHERE is_active = TRUE
    """))
    # Drop old tag_id column if it still exists from a previous schema
    db.execute(text("ALTER TABLE public.category_budgets DROP COLUMN IF EXISTS tag_id"))
    db.execute(text("DROP INDEX IF EXISTS uq_category_budgets_month_tag"))
    # Add parent_name column if missing
    db.execute(text("ALTER TABLE public.category_budgets ADD COLUMN IF NOT EXISTS parent_name TEXT"))
    # Back-fill: accounts whose type implies liability but got default 'asset'
    db.execute(text("""
        UPDATE public.account_profiles
        SET asset_class = 'liability'
        WHERE account_type IN ('credit_card', 'personal_loan', 'home_loan', 'vehicle_loan', 'other_liability')
          AND asset_class = 'asset'
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.shared_joy_budgets (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            month_start          DATE NOT NULL,
            goal_amount          NUMERIC(14, 2) NOT NULL DEFAULT 0,
            reward_note          TEXT,
            carry_forward_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
            achieved_at          TIMESTAMPTZ,
            is_active            BOOLEAN NOT NULL DEFAULT TRUE,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_joy_budgets_month
        ON public.shared_joy_budgets (month_start) WHERE is_active = TRUE
    """))
    _ensure_planning_state_table(db)
    db.commit()


def _ensure_planning_state_table(db: Session):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.planning_state (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))


def _ensure_monthly_budget_closure_table(db: Session):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.monthly_budget_closures (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            month_start DATE NOT NULL,
            budget_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
            actual_spent NUMERIC(14,2) NOT NULL DEFAULT 0,
            carry_forward_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
            statement_status JSONB NOT NULL DEFAULT '[]'::jsonb,
            closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            closed_by TEXT,
            notes TEXT,
            is_closed BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_budget_closures_month
        ON public.monthly_budget_closures (month_start)
        WHERE is_closed = TRUE
    """))


def _get_active_month_override(db: Session) -> date | None:
    _ensure_planning_state_table(db)
    value = db.execute(text("""
        SELECT value
        FROM public.planning_state
        WHERE key = 'active_month_start'
        LIMIT 1
    """)).scalar()
    if not value:
        return None
    try:
        return _coerce_month_start(value)
    except Exception:
        return None


def _set_active_month(db: Session, month_start: date):
    _ensure_planning_state_table(db)
    db.execute(text("""
        INSERT INTO public.planning_state (key, value, updated_at)
        VALUES ('active_month_start', :value, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    """), {"value": month_start.isoformat()})


def _copy_category_budgets(db: Session, source_month: date, target_month: date):
    return db.execute(text("""
        INSERT INTO public.category_budgets (month_start, tag_name, parent_name, budget_amount)
        SELECT :target_month, tag_name, parent_name, budget_amount
        FROM (
            SELECT DISTINCT ON (LOWER(cb.tag_name))
                cb.tag_name,
                cb.parent_name,
                cb.budget_amount
            FROM public.category_budgets cb
            WHERE cb.month_start = :source_month
              AND EXISTS (
                  SELECT 1
                  FROM public.system_tags st
                  WHERE LOWER(st.name) = LOWER(cb.tag_name)
                    AND st.is_active = TRUE
              )
            ORDER BY LOWER(cb.tag_name), cb.is_active DESC, cb.updated_at DESC, cb.created_at DESC
        ) cb
        WHERE NOT EXISTS (
            SELECT 1 FROM public.category_budgets cb2
            WHERE cb2.month_start = :target_month
              AND LOWER(cb2.tag_name) = LOWER(cb.tag_name)
              AND cb2.is_active = TRUE
        )
    """), {"source_month": source_month, "target_month": target_month})


def _copy_shared_joy_budget(db: Session, source_month: date, target_month: date):
    return db.execute(text("""
        INSERT INTO public.shared_joy_budgets (month_start, goal_amount, reward_note, carry_forward_amount)
        SELECT :target_month, goal_amount, reward_note, 0
        FROM public.shared_joy_budgets
        WHERE month_start = :source_month
          AND is_active = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM public.shared_joy_budgets sjb2
              WHERE sjb2.month_start = :target_month
                AND sjb2.is_active = TRUE
          )
        ORDER BY updated_at DESC
        LIMIT 1
    """), {"source_month": source_month, "target_month": target_month})


def list_account_profiles(db: Session):

    rows = db.execute(
        text(
            """
            SELECT
                ap.id::text AS id,
                ap.account_name,
                ap.account_type,
                ap.asset_class,
                ap.account_subtype,
                ap.currency,
                ap.institution_name,
                ap.source_name,
                ap.current_balance,
                ap.balance_as_of,
                ap.is_bank_linked,
                ap.link_status,
                ap.notes,
                ap.is_active,
                stmt.last_stmt_date,
                stmt.tx_count
            FROM public.account_profiles ap
            LEFT JOIN (
                SELECT
                    UPPER(TRIM(payment_source_name)) AS src,
                    MAX(transaction_date)            AS last_stmt_date,
                    COUNT(*)                         AS tx_count
                FROM public.transactions
                WHERE payment_source_name IS NOT NULL
                GROUP BY UPPER(TRIM(payment_source_name))
            ) stmt ON UPPER(TRIM(ap.source_name)) = stmt.src
            WHERE ap.is_active = TRUE
            ORDER BY ap.asset_class ASC, ap.account_type ASC, ap.account_name ASC
            """
        )
    ).mappings().all()
    return [dict(row) for row in rows]


def upsert_account_profile(payload: dict, db: Session):

    source_name = _clean_text(payload.get("source_name"))
    account_type = (_clean_text(payload.get("account_type")) or "bank").lower()
    asset_class = (_clean_text(payload.get("asset_class")) or (
        "liability" if account_type in {"credit_card", "personal_loan", "home_loan", "vehicle_loan", "other_liability"}
        else "asset"
    )).lower()
    params = {
        "id": payload.get("id") or str(uuid4()),
        "account_name": _clean_text(payload.get("account_name")) or source_name or "Manual account",
        "account_type": account_type,
        "asset_class": asset_class,
        "account_subtype": _clean_text(payload.get("account_subtype")),
        "currency": _clean_text(payload.get("currency")) or "INR",
        "institution_name": _clean_text(payload.get("institution_name")),
        "source_name": source_name.upper() if source_name else None,
        "current_balance": _money(payload.get("current_balance")),
        "balance_as_of": payload.get("balance_as_of") or date.today(),
        "is_bank_linked": bool(payload.get("is_bank_linked") or source_name),
        "link_status": _clean_text(payload.get("link_status")) or ("linked" if source_name else "manual"),
        "notes": _clean_text(payload.get("notes")),
    }
    row = db.execute(
        text(
            """
            INSERT INTO public.account_profiles (
                id, account_name, account_type, asset_class, account_subtype, currency,
                institution_name, source_name, current_balance, balance_as_of,
                is_bank_linked, link_status, notes
            ) VALUES (
                CAST(:id AS uuid), :account_name, :account_type, :asset_class, :account_subtype, :currency,
                :institution_name, :source_name, :current_balance, :balance_as_of,
                :is_bank_linked, :link_status, :notes
            )
            ON CONFLICT (id)
            DO UPDATE SET
                account_name     = EXCLUDED.account_name,
                account_type     = EXCLUDED.account_type,
                asset_class      = EXCLUDED.asset_class,
                account_subtype  = EXCLUDED.account_subtype,
                currency         = EXCLUDED.currency,
                institution_name = EXCLUDED.institution_name,
                source_name      = EXCLUDED.source_name,
                current_balance  = EXCLUDED.current_balance,
                balance_as_of    = EXCLUDED.balance_as_of,
                is_bank_linked   = EXCLUDED.is_bank_linked,
                link_status      = EXCLUDED.link_status,
                notes            = EXCLUDED.notes,
                is_active        = TRUE,
                updated_at       = NOW()
            RETURNING
                id::text AS id, account_name, account_type, asset_class, account_subtype,
                currency, institution_name, source_name, current_balance,
                balance_as_of, is_bank_linked, link_status, notes
            """
        ),
        params,
    ).mappings().first()
    db.commit()
    try:
        from repositories.networth_repo import save_net_worth_snapshot
        save_net_worth_snapshot(db)
    except Exception:
        db.rollback()
    return dict(row)


def link_account_to_source(account_id: str, source_name: str, db: Session):

    normalized_source = (_clean_text(source_name) or "").upper()
    if not normalized_source:
        raise ValueError("Source name is required.")
    row = db.execute(
        text(
            """
            UPDATE public.account_profiles
            SET
                source_name = :source_name,
                is_bank_linked = TRUE,
                link_status = 'linked',
                updated_at = NOW()
            WHERE id = CAST(:account_id AS uuid)
              AND is_active = TRUE
            RETURNING
                id::text AS id,
                account_name,
                account_type,
                institution_name,
                source_name,
                current_balance,
                balance_as_of,
                is_bank_linked,
                link_status,
                notes
            """
        ),
        {"account_id": account_id, "source_name": normalized_source},
    ).mappings().first()
    db.commit()
    return dict(row) if row else None


def create_planned_expense(payload: dict, db: Session):

    params = {
        "id": str(uuid4()),
        "title": _clean_text(payload.get("title")) or "Planned expense",
        "amount": _money(payload.get("amount")),
        "due_date": payload.get("due_date") or date.today(),
        "frequency": (_clean_text(payload.get("frequency")) or "one_time").lower(),
        "category": _clean_text(payload.get("category")),
        "account_id": payload.get("account_id"),
        "status": (_clean_text(payload.get("status")) or "planned").lower(),
        "priority": (_clean_text(payload.get("priority")) or "normal").lower(),
        "notes": _clean_text(payload.get("notes")),
    }
    row = db.execute(
        text(
            """
            INSERT INTO public.planned_expenses (
                id, title, amount, due_date, frequency, category, account_id, status, priority, notes
            ) VALUES (
                CAST(:id AS uuid), :title, :amount, :due_date, :frequency, :category,
                CAST(:account_id AS uuid), :status, :priority, :notes
            )
            RETURNING
                id::text AS id,
                title,
                amount,
                due_date,
                frequency,
                category,
                account_id::text AS account_id,
                status,
                priority,
                notes
            """
        ),
        params,
    ).mappings().first()
    db.commit()
    return dict(row)


def create_wishlist_item(payload: dict, db: Session):

    row = db.execute(
        text(
            """
            INSERT INTO public.wishlist_items (
                id, item_name, expected_amount, target_date, priority, status, notes
            ) VALUES (
                CAST(:id AS uuid), :item_name, :expected_amount, :target_date, :priority, :status, :notes
            )
            RETURNING
                id::text AS id,
                item_name,
                expected_amount,
                target_date,
                priority,
                status,
                notes
            """
        ),
        {
            "id": str(uuid4()),
            "item_name": _clean_text(payload.get("item_name")) or "Wishlist item",
            "expected_amount": _money(payload.get("expected_amount")),
            "target_date": payload.get("target_date"),
            "priority": (_clean_text(payload.get("priority")) or "nice_to_have").lower(),
            "status": (_clean_text(payload.get("status")) or "wishlist").lower(),
            "notes": _clean_text(payload.get("notes")),
        },
    ).mappings().first()
    db.commit()
    return dict(row)


def delete_wishlist_item(item_id: str, db: Session) -> bool:
    db.execute(
        text("UPDATE public.wishlist_items SET is_active = FALSE, updated_at = NOW() WHERE id = CAST(:id AS uuid)"),
        {"id": item_id},
    )
    db.commit()
    return True


def delete_planned_expense(item_id: str, db: Session) -> bool:
    result = db.execute(
        text("UPDATE public.planned_expenses SET is_active = FALSE, updated_at = NOW() WHERE id = CAST(:id AS uuid) AND is_active = TRUE"),
        {"id": item_id},
    )
    db.commit()
    return result.rowcount > 0


def update_planned_expense(item_id: str, payload: dict, db: Session):
    allowed = {"title", "amount", "due_date", "frequency", "category", "account_id", "status", "priority", "notes"}
    updates = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if not updates:
        return None
    set_parts = ", ".join(f"{k} = :{k}" for k in updates)
    updates["_id"] = item_id
    row = db.execute(
        text(f"""
            UPDATE public.planned_expenses
            SET {set_parts}, updated_at = NOW()
            WHERE id = CAST(:_id AS uuid) AND is_active = TRUE
            RETURNING id::text, title, amount, due_date, frequency, category, status, priority, notes
        """),
        updates,
    ).mappings().first()
    db.commit()
    return dict(row) if row else None


def update_wishlist_item_full(item_id: str, payload: dict, db: Session):
    allowed = {"item_name", "expected_amount", "target_date", "priority", "status", "notes"}
    updates = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if not updates:
        return None
    set_parts = ", ".join(f"{k} = :{k}" for k in updates)
    updates["_id"] = item_id
    row = db.execute(
        text(f"""
            UPDATE public.wishlist_items
            SET {set_parts}, updated_at = NOW()
            WHERE id = CAST(:_id AS uuid) AND is_active = TRUE
            RETURNING id::text, item_name, expected_amount, target_date, priority, status, notes
        """),
        updates,
    ).mappings().first()
    db.commit()
    return dict(row) if row else None


def get_planned_for_month(db: Session, month_start: str) -> list:
    """Planned expenses AND wishlist items whose date falls within the given month.
    Returns a combined list with an item_type field ('planned' or 'wishlist')."""
    import calendar as _cal
    try:
        from_dt = date.fromisoformat(month_start)
    except ValueError:
        return []
    last_day = _cal.monthrange(from_dt.year, from_dt.month)[1]
    to_dt = from_dt.replace(day=last_day)

    planned = db.execute(text("""
        SELECT id::text, title, amount, due_date, category, status, priority, 'planned' AS item_type
        FROM public.planned_expenses
        WHERE is_active = TRUE
          AND status NOT IN ('completed', 'cancelled')
          AND due_date <= :to_dt
        ORDER BY due_date, priority DESC
    """), {"to_dt": str(to_dt)}).mappings().all()

    wishlist = db.execute(text("""
        SELECT id::text, item_name AS title, expected_amount AS amount,
               target_date AS due_date, NULL::text AS category, status, priority,
               'wishlist' AS item_type
        FROM public.wishlist_items
        WHERE is_active = TRUE
          AND status NOT IN ('completed', 'purchased', 'cancelled')
          AND target_date <= :to_dt
        ORDER BY target_date, priority DESC
    """), {"to_dt": str(to_dt)}).mappings().all()

    return [dict(r) for r in planned] + [dict(r) for r in wishlist]


def update_wishlist_status(item_id: str, status: str, db: Session) -> bool:
    db.execute(
        text("UPDATE public.wishlist_items SET status = :status, updated_at = NOW() WHERE id = CAST(:id AS uuid)"),
        {"id": item_id, "status": status},
    )
    db.commit()
    return True


def upsert_monthly_budget(payload: dict, db: Session):

    source_month = _resolve_active_month(db).replace(day=1)
    _raw_month = payload.get("month_start") or source_month
    month_start = _coerce_month_start(_raw_month)
    row = db.execute(
        text(
            """
            INSERT INTO public.monthly_budgets (
                month_start, budget_amount, expected_income, notes
            ) VALUES (
                :month_start, :budget_amount, :expected_income, :notes
            )
            ON CONFLICT (month_start)
            WHERE is_active = TRUE
            DO UPDATE SET
                budget_amount    = EXCLUDED.budget_amount,
                expected_income  = EXCLUDED.expected_income,
                notes            = EXCLUDED.notes,
                updated_at       = NOW()
            RETURNING
                id::text AS id, month_start, budget_amount, expected_income, notes
            """
        ),
        {
            "month_start":     month_start,
            "budget_amount":   _money(payload.get("budget_amount")),
            "expected_income": _money(payload.get("expected_income")),
            "notes":           _clean_text(payload.get("notes")),
        },
    ).mappings().first()
    if payload.get("month_start"):
        if month_start != source_month:
            _copy_category_budgets(db, source_month, month_start)
            _copy_shared_joy_budget(db, source_month, month_start)
        _set_active_month(db, month_start)
    db.commit()
    return dict(row)


def _list_planned_expenses(db: Session):
    rows = db.execute(
        text(
            """
            SELECT
                e.id::text AS id,
                e.title,
                e.amount,
                e.due_date,
                e.frequency,
                e.category,
                e.account_id::text AS account_id,
                a.account_name,
                e.status,
                e.priority,
                e.notes
            FROM public.planned_expenses e
            LEFT JOIN public.account_profiles a
              ON a.id = e.account_id
            WHERE e.is_active = TRUE
            ORDER BY e.due_date ASC, e.amount DESC, e.title ASC
            """
        )
    ).mappings().all()
    return [dict(row) for row in rows]


def _list_wishlist(db: Session):
    rows = db.execute(
        text(
            """
            SELECT
                id::text AS id,
                item_name,
                expected_amount,
                target_date,
                priority,
                status,
                notes
            FROM public.wishlist_items
            WHERE is_active = TRUE
            ORDER BY
                CASE priority
                    WHEN 'must_have' THEN 0
                    WHEN 'important' THEN 1
                    WHEN 'nice_to_have' THEN 2
                    ELSE 3
                END,
                target_date ASC NULLS LAST,
                expected_amount DESC
            """
        )
    ).mappings().all()
    return [dict(row) for row in rows]


def _month_bounds(today: date):
    start = today.replace(day=1)
    if start.month == 12:
        next_month = start.replace(year=start.year + 1, month=1)
    else:
        next_month = start.replace(month=start.month + 1)
    return start, next_month


def _current_month_budget(db: Session):
    month_start, _ = _month_bounds(_resolve_active_month(db))
    return _budget_for_month(db, month_start)


def _budget_for_month(db: Session, month_start: date):
    row = db.execute(
        text(
            """
            SELECT
                id::text AS id,
                month_start,
                budget_amount,
                expected_income,
                notes
            FROM public.monthly_budgets
            WHERE is_active = TRUE
              AND month_start = :month_start
            ORDER BY updated_at DESC
            LIMIT 1
            """
        ),
        {"month_start": month_start},
    ).mappings().first()
    return dict(row) if row else None


def _resolve_active_month(db: Session) -> date:
    """Return current month if it has transactions, else the most recent month that does."""
    override = _get_active_month_override(db)
    if override:
        return override

    today = date.today()
    count = db.execute(text("""
        SELECT COUNT(*) FROM public.transactions
        WHERE transaction_date >= DATE_TRUNC('month', CURRENT_DATE)
    """)).scalar()
    if count and count > 0:
        return today
    # Fall back to last month with data
    row = db.execute(text("""
        SELECT MAX(transaction_date) FROM public.transactions
    """)).scalar()
    return row if row else today


def start_new_budget_month(db: Session, target_month_start=None) -> dict:
    """Move the budget tracker to a new active month and carry the saved plan forward."""
    source_month = _resolve_active_month(db).replace(day=1)
    target_month = _coerce_month_start(target_month_start) if target_month_start else _month_bounds(source_month)[1]

    monthly_budget_row = db.execute(text("""
        INSERT INTO public.monthly_budgets (month_start, budget_amount, expected_income, notes)
        SELECT :target_month, budget_amount, expected_income, notes
        FROM public.monthly_budgets
        WHERE month_start = :source_month
          AND is_active = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM public.monthly_budgets mb2
              WHERE mb2.month_start = :target_month
                AND mb2.is_active = TRUE
          )
        ORDER BY updated_at DESC
        LIMIT 1
    """), {"source_month": source_month, "target_month": target_month})

    category_rows = _copy_category_budgets(db, source_month, target_month)
    shared_joy_row = _copy_shared_joy_budget(db, source_month, target_month)

    _set_active_month(db, target_month)
    db.commit()

    return {
        "source_month_start": source_month.isoformat(),
        "active_month_start": target_month.isoformat(),
        "copied_monthly_budget": max(monthly_budget_row.rowcount or 0, 0),
        "copied_category_budgets": max(category_rows.rowcount or 0, 0),
        "copied_shared_joy_budget": max(shared_joy_row.rowcount or 0, 0),
    }


def _month_end(month_start: date) -> date:
    return _month_bounds(month_start)[1] - timedelta(days=1)


def _month_actual_spent(db: Session, month_start: date) -> Decimal:
    month_end = _month_end(month_start)
    rows = tag_transactions(
        SimpleNamespace(
            from_date=month_start,
            to_date=month_end,
            vendor_filter=None,
            amount_filter=None,
            tag_filter=None,
        ),
        db,
    )
    return sum(_money(row.get("effective_expense_amount")) for row in rows)


def _budget_amount_for_month(db: Session, month_start: date) -> Decimal:
    amount = db.execute(text("""
        SELECT budget_amount
        FROM public.monthly_budgets
        WHERE month_start = :month_start
          AND is_active = TRUE
        ORDER BY updated_at DESC
        LIMIT 1
    """), {"month_start": month_start}).scalar()
    return _money(amount)


def _statement_status_for_month(db: Session, month_start: date) -> list[dict]:
    month_end = _month_end(month_start)
    rows = db.execute(text("""
        WITH sources AS (
            SELECT DISTINCT UPPER(TRIM(source_name)) AS source_name
            FROM public.account_profiles
            WHERE is_active = TRUE
              AND source_name IS NOT NULL
              AND BTRIM(source_name) <> ''
            UNION
            SELECT DISTINCT UPPER(TRIM(payment_source_name)) AS source_name
            FROM public.transactions
            WHERE payment_source_name IS NOT NULL
              AND BTRIM(payment_source_name) <> ''
        ),
        stats AS (
            SELECT
                UPPER(TRIM(payment_source_name)) AS source_name,
                MIN(transaction_date) AS first_transaction_date,
                MAX(transaction_date) AS latest_transaction_date,
                COUNT(*) FILTER (
                    WHERE transaction_date >= :month_start
                      AND transaction_date <= :month_end
                ) AS transactions_in_month
            FROM public.transactions
            WHERE payment_source_name IS NOT NULL
              AND BTRIM(payment_source_name) <> ''
            GROUP BY UPPER(TRIM(payment_source_name))
        )
        SELECT
            s.source_name,
            st.first_transaction_date,
            st.latest_transaction_date,
            COALESCE(st.transactions_in_month, 0) AS transactions_in_month
        FROM sources s
        LEFT JOIN stats st ON st.source_name = s.source_name
        ORDER BY s.source_name
    """), {"month_start": month_start, "month_end": month_end}).mappings().all()

    status = []
    for row in rows:
        latest = row.get("latest_transaction_date")
        txn_count = int(row.get("transactions_in_month") or 0)
        covers_end = bool(latest and latest >= month_end)
        has_month_activity = txn_count > 0
        status.append({
            "source_name": row["source_name"],
            "first_transaction_date": row.get("first_transaction_date").isoformat() if row.get("first_transaction_date") else None,
            "latest_transaction_date": latest.isoformat() if latest else None,
            "transactions_in_month": txn_count,
            "covers_month_end": covers_end,
            "has_month_activity": has_month_activity,
            "is_ready": covers_end and has_month_activity,
            "message": (
                "Ready"
                if covers_end and has_month_activity
                else (
                    f"Latest transaction is before {_month_end(month_start).isoformat()}"
                    if not covers_end
                    else "No transactions found in this month"
                )
            ),
        })
    return status


def get_month_close_preview(db: Session, month_start=None) -> dict:
    _ensure_monthly_budget_closure_table(db)
    active_month = _resolve_active_month(db).replace(day=1)
    close_month = _coerce_month_start(month_start) if month_start else (
        active_month.replace(year=active_month.year - 1, month=12)
        if active_month.month == 1
        else active_month.replace(month=active_month.month - 1)
    )
    budget_amount = _budget_amount_for_month(db, close_month)
    actual_spent = _month_actual_spent(db, close_month)
    carry_forward = budget_amount - actual_spent
    statements = _statement_status_for_month(db, close_month)
    missing = [row for row in statements if not row["is_ready"]]
    existing = db.execute(text("""
        SELECT
            month_start,
            budget_amount,
            actual_spent,
            carry_forward_amount,
            statement_status,
            closed_at,
            notes
        FROM public.monthly_budget_closures
        WHERE month_start = :month_start
          AND is_closed = TRUE
        LIMIT 1
    """), {"month_start": close_month}).mappings().first()

    return {
        "month_start": close_month.isoformat(),
        "active_month_start": active_month.isoformat(),
        "budget_amount": _money_float(budget_amount),
        "actual_spent": _money_float(actual_spent),
        "carry_forward_amount": _money_float(carry_forward),
        "is_over_budget": carry_forward < 0,
        "statement_status": statements,
        "missing_statement_sources": missing,
        "statements_ready": len(missing) == 0,
        "already_closed": bool(existing),
        "closed_at": existing.get("closed_at").isoformat() if existing and existing.get("closed_at") else None,
    }


def close_budget_month(db: Session, month_start=None, force: bool = False, notes: str | None = None) -> dict:
    _ensure_monthly_budget_closure_table(db)
    preview = get_month_close_preview(db, month_start)
    if preview["already_closed"]:
        return {"success": False, "error_code": "ALREADY_CLOSED", "message": "This month is already closed.", "data": preview}
    if not preview["statements_ready"] and not force:
        return {
            "success": False,
            "error_code": "STATEMENTS_NOT_READY",
            "message": "Some statement sources do not yet cover the month being closed.",
            "data": preview,
        }

    row = db.execute(text("""
        INSERT INTO public.monthly_budget_closures (
            month_start,
            budget_amount,
            actual_spent,
            carry_forward_amount,
            statement_status,
            notes
        ) VALUES (
            CAST(:month_start AS date),
            :budget_amount,
            :actual_spent,
            :carry_forward_amount,
            CAST(:statement_status AS jsonb),
            :notes
        )
        ON CONFLICT (month_start) WHERE is_closed = TRUE
        DO UPDATE SET
            budget_amount = EXCLUDED.budget_amount,
            actual_spent = EXCLUDED.actual_spent,
            carry_forward_amount = EXCLUDED.carry_forward_amount,
            statement_status = EXCLUDED.statement_status,
            notes = EXCLUDED.notes,
            closed_at = NOW(),
            updated_at = NOW()
        RETURNING id::text AS id, month_start, budget_amount, actual_spent, carry_forward_amount, closed_at
    """), {
        "month_start": preview["month_start"],
        "budget_amount": preview["budget_amount"],
        "actual_spent": preview["actual_spent"],
        "carry_forward_amount": preview["carry_forward_amount"],
        "statement_status": json.dumps(preview["statement_status"]),
        "notes": _clean_text(notes),
    }).mappings().first()
    db.commit()

    return {
        "success": True,
        "data": {
            **preview,
            "closure_id": row["id"],
            "closed_at": row["closed_at"].isoformat() if row.get("closed_at") else None,
        },
    }


def _month_state(db: Session, selected_month_start: date):
    month_start, next_month_start = _month_bounds(selected_month_start)
    real_today = date.today()
    if real_today < month_start:
        today = month_start
    elif real_today >= next_month_start:
        today = next_month_start - timedelta(days=1)
    else:
        today = real_today
    rows = tag_transactions(
        SimpleNamespace(
            from_date=month_start,
            to_date=today,
            vendor_filter=None,
            amount_filter=None,
            tag_filter=None,
        ),
        db,
    )
    expenses = sum(_money(row.get("effective_expense_amount")) for row in rows)
    income = sum(_money(row.get("effective_income_amount")) for row in rows)
    raw_debits = sum(
        _money(row.get("amount"))
        for row in rows
        if str(row.get("direction") or "").lower() == "withdrawal"
    )
    open_review_count = sum(
        1
        for row in rows
        if str(row.get("review_status") or "").lower() in {"needs_review", "unknown", "unreviewed"}
    )
    planned_due = db.execute(
        text(
            """
            SELECT COALESCE(SUM(amount), 0)
            FROM public.planned_expenses
            WHERE is_active = TRUE
              AND status IN ('planned', 'due')
              AND due_date >= :today
              AND due_date < :next_month_start
            """
        ),
        {"today": today, "next_month_start": next_month_start},
    ).scalar()
    spend_buckets = {}
    for row in rows:
        expense_amount = _money(row.get("effective_expense_amount"))
        if expense_amount <= 0:
            continue
        bucket_name = _primary_spend_bucket(row)
        spend_buckets[bucket_name] = spend_buckets.get(bucket_name, Decimal("0.00")) + expense_amount

    top_spend_buckets = sorted(  # noqa: E501 (limit raised to 10 for budget page)
        (
            {
                "name": name,
                "amount": _money_float(amount),
                "share_percent": round((_money_float(amount) / max(_money_float(expenses), 0.01)) * 100, 1),
            }
            for name, amount in spend_buckets.items()
        ),
        key=lambda bucket: bucket["amount"],
        reverse=True,
    )[:10]
    days_in_month = max((next_month_start - month_start).days, 1)
    days_elapsed = max((today - month_start).days + 1, 1)
    return {
        "month_start": month_start,
        "as_of_date": today,
        "days_elapsed": days_elapsed,
        "days_in_month": days_in_month,
        "transaction_count": len(rows),
        "spent_so_far": _money_float(expenses),
        "income_so_far": _money_float(income),
        "net_so_far": _money_float(income - expenses),
        "raw_debits_so_far": _money_float(raw_debits),
        "planned_remaining": _money_float(planned_due),
        "projected_month_outflow": _money_float(
            # daily rate × days in month + upcoming planned expenses
            (_money(expenses) / max(days_elapsed, 1)) * days_in_month + _money(planned_due)
        ),
        "open_review_count": open_review_count,
        "top_spend_buckets": top_spend_buckets,
    }


def _current_month_state(db: Session):
    return _month_state(db, _resolve_active_month(db))


def _account_snapshot(db: Session):
    profiles = list_account_profiles(db)
    linked_by_source = {
        str(profile.get("source_name") or "").upper(): profile
        for profile in profiles
        if profile.get("source_name")
    }
    reconciliation_rows = get_balance_reconciliation(db)
    accounts = []
    seen_profile_ids = set()

    for row in reconciliation_rows:
        source_name = str(row.get("source_name") or "").upper()
        profile = linked_by_source.get(source_name)
        statement_balance = _money(row.get("statement_closing_balance"))
        system_balance = _money(row.get("calculated_closing_balance"))
        account_delta = _money(row.get("mismatch_amount"))
        opening_component_count = int(row.get("opening_component_count") or 0)
        closing_component_count = int(row.get("closing_component_count") or 0)
        balance_component_count = len(row.get("balance_components") or [])
        latest_rows_without_time = int(row.get("latest_date_rows_without_time") or 0)
        reconciliation_issues = []
        if abs(account_delta) > Decimal("0.01"):
            reconciliation_issues.append("Statement closing balance does not match the system calculation.")
        if max(opening_component_count, closing_component_count) > 1:
            reconciliation_issues.append("Multiple possible opening or closing balances were found.")
        if balance_component_count > 1:
            reconciliation_issues.append("Statement rows are split into multiple balance chains.")
        if latest_rows_without_time > 1:
            reconciliation_issues.append("Multiple final-day rows have no transaction time, so the final balance is ambiguous.")
        account_match_status = "matched" if not reconciliation_issues else (
            "mismatch" if abs(account_delta) > Decimal("0.01") else "needs_review"
        )
        if profile:
            seen_profile_ids.add(profile["id"])
            balance = statement_balance
            status = "linked"
            link_hint = "Bank statement balance is being used."
        else:
            balance = statement_balance
            status = "needs_link"
            link_hint = "Create or link an account profile for this imported source."
        accounts.append(
            {
                "id": profile.get("id") if profile else None,
                "account_name": profile.get("account_name") if profile else f"{source_name} statement",
                "account_type": profile.get("account_type") if profile else "bank",
                "institution_name": profile.get("institution_name") if profile else source_name,
                "source_name": source_name,
                "current_balance": _money_float(balance),
                "statement_balance": _money_float(statement_balance),
                "system_balance": _money_float(system_balance),
                "account_delta": _money_float(account_delta),
                "account_match_status": account_match_status,
                "reconciliation_issue_count": len(reconciliation_issues),
                "reconciliation_issue_reason": " ".join(reconciliation_issues),
                "opening_component_count": opening_component_count,
                "closing_component_count": closing_component_count,
                "balance_component_count": balance_component_count,
                "latest_date_rows_without_time": latest_rows_without_time,
                "balance_as_of": row.get("latest_transaction_date"),
                "is_bank_linked": bool(profile),
                "link_status": status,
                "link_hint": link_hint,
                "mismatch_amount": _money_float(row.get("mismatch_amount")),
                "statement_period_from": row.get("first_transaction_date"),
                "statement_period_to": row.get("latest_transaction_date"),
                # Last uploaded/statement date + txn count (frontend shows these under the balance).
                "last_stmt_date": (profile.get("last_stmt_date") if profile else None) or row.get("latest_transaction_date"),
                "tx_count": (profile.get("tx_count") if profile else None) or row.get("transaction_count"),
            }
        )

    for profile in profiles:
        if profile["id"] in seen_profile_ids:
            continue
        accounts.append(
            {
                **profile,
                "current_balance": _money_float(profile.get("current_balance")),
                "statement_balance": None,
                "system_balance": _money_float(profile.get("current_balance")),
                "account_delta": None,
                "account_match_status": "manual",
                "link_hint": "Manual balance. Link a bank source when a matching statement is available.",
                "mismatch_amount": 0.0,
                "statement_period_from": None,
                "statement_period_to": None,
            }
        )

    total_assets = sum(
        _money(account.get("current_balance"))
        for account in accounts
        if str(account.get("asset_class") or "asset").lower() != "liability"
    )
    total_liabilities = sum(
        abs(_money(account.get("current_balance")))
        for account in accounts
        if str(account.get("asset_class") or "asset").lower() == "liability"
    )
    total_balance = total_assets - total_liabilities
    return {
        "total_balance": _money_float(total_balance),
        "total_assets": _money_float(total_assets),
        "total_liabilities": _money_float(total_liabilities),
        "needs_link_count": sum(1 for account in accounts if account.get("link_status") == "needs_link"),
        "manual_count": sum(1 for account in accounts if not account.get("is_bank_linked")),
        "accounts": accounts,
    }


def get_carry_forward(db: Session, current_month_start) -> float:
    """Sum finalized month-close carry amounts before the active month."""
    _ensure_monthly_budget_closure_table(db)
    total = db.execute(text("""
        SELECT COALESCE(SUM(carry_forward_amount), 0)
        FROM public.monthly_budget_closures
        WHERE is_closed = TRUE
          AND DATE_TRUNC('month', month_start) < DATE_TRUNC('month', CAST(:current_month AS date))
    """), {"current_month": str(current_month_start)}).scalar()
    return _money_float(total)


def get_planning_summary(db: Session):

    planned_expenses = _list_planned_expenses(db)
    wishlist = _list_wishlist(db)
    current_month = _current_month_state(db)
    current_budget = _current_month_budget(db)
    wishlist_open_total = sum(
        _money(row.get("expected_amount"))
        for row in wishlist
        if row.get("status") in {"wishlist", "planned"}
    )
    future_planned_total = sum(
        _money(row.get("amount"))
        for row in planned_expenses
        if row.get("status") in {"planned", "due"}
    )
    current_month_start = current_month.get("month_start")
    carry_forward    = get_carry_forward(db, current_month_start) if current_month_start else 0.0
    base_budget      = _money_float(current_budget.get("budget_amount")) if current_budget else 0.0
    effective_budget = base_budget + carry_forward
    spent            = _money(current_month.get("spent_so_far"))

    return {
        "accounts": _account_snapshot(db),
        "current_month": current_month,
        "budget": {
            "month_start":      current_budget.get("month_start") if current_budget else current_month_start,
            "budget_amount":    base_budget,
            "expected_income":  _money_float(current_budget.get("expected_income")) if current_budget else 0.0,
            "notes":            current_budget.get("notes") if current_budget else None,
            "carry_forward":    carry_forward,
            "effective_budget": effective_budget,
            "spent_so_far":     current_month.get("spent_so_far", 0.0),
            "remaining_amount": _money_float(_money(effective_budget) - spent),
            "usage_percent": (
                round((_money_float(spent) / max(effective_budget, 0.01)) * 100, 1)
                if effective_budget > 0 else 0.0
            ),
            "status": (
                "over_budget" if effective_budget > 0 and spent > _money(effective_budget)
                else "on_track"
            ),
            "days_elapsed":           current_month.get("days_elapsed", 0),
            "days_in_month":          current_month.get("days_in_month", 0),
            "planned_remaining":      current_month.get("planned_remaining", 0.0),
            "projected_month_outflow":current_month.get("projected_month_outflow", 0.0),
            "open_review_count":      current_month.get("open_review_count", 0),
            "top_spend_buckets":      current_month.get("top_spend_buckets", []),
            "pace_target_spend": (
                round(
                    (effective_budget * max(float(current_month.get("days_elapsed", 0)), 0))
                    / max(float(current_month.get("days_in_month", 0)), 1.0),
                    1,
                )
                if effective_budget > 0 else 0.0
            ),
            "pace_status": (
                "no_budget" if effective_budget <= 0
                else (
                    "off_track"
                    if _money_float(spent) > (
                        (effective_budget * max(float(current_month.get("days_elapsed", 0)), 0))
                        / max(float(current_month.get("days_in_month", 0)), 1.0)
                    ) + max(effective_budget * 0.05, 250.0)
                    else (
                        "ahead"
                        if _money_float(spent) < (
                            (effective_budget * max(float(current_month.get("days_elapsed", 0)), 0))
                            / max(float(current_month.get("days_in_month", 0)), 1.0)
                        ) - max(effective_budget * 0.05, 250.0)
                        else "on_track"
                    )
                )
            ),
        },
        "planned_expenses": {
            "total_open": _money_float(future_planned_total),
            "items": planned_expenses,
        },
        "wishlist": {
            "total_open": _money_float(wishlist_open_total),
            "items": wishlist,
        },
        "net_worth": _safe_net_worth(db),
    }


def get_budget_month_view(db: Session, month_start) -> dict:
    """Return Budget-page summary data for a selected month.

    Historical month views intentionally use the month budget as-is, without
    applying active-month rollover adjustments.
    """
    selected_month = _coerce_month_start(month_start)
    active_month = _resolve_active_month(db).replace(day=1)
    planned_expenses = _list_planned_expenses(db)
    wishlist = _list_wishlist(db)
    month_state = _month_state(db, selected_month)
    month_budget = _budget_for_month(db, selected_month)

    wishlist_open_total = sum(
        _money(row.get("expected_amount"))
        for row in wishlist
        if row.get("status") in {"wishlist", "planned"}
    )
    future_planned_total = sum(
        _money(row.get("amount"))
        for row in planned_expenses
        if row.get("status") in {"planned", "due"}
    )
    base_budget = _money_float(month_budget.get("budget_amount")) if month_budget else 0.0
    expected_income = _money_float(month_budget.get("expected_income")) if month_budget else 0.0
    spent = _money(month_state.get("spent_so_far"))
    effective_budget = base_budget

    return {
        "accounts": _account_snapshot(db),
        "current_month": month_state,
        "budget": {
            "month_start": month_budget.get("month_start") if month_budget else selected_month,
            "budget_amount": base_budget,
            "expected_income": expected_income,
            "notes": month_budget.get("notes") if month_budget else None,
            "carry_forward": 0.0,
            "effective_budget": effective_budget,
            "spent_so_far": month_state.get("spent_so_far", 0.0),
            "remaining_amount": _money_float(_money(effective_budget) - spent),
            "usage_percent": (
                round((_money_float(spent) / max(effective_budget, 0.01)) * 100, 1)
                if effective_budget > 0 else 0.0
            ),
            "status": (
                "over_budget" if effective_budget > 0 and spent > _money(effective_budget)
                else "on_track"
            ),
            "days_elapsed": month_state.get("days_elapsed", 0),
            "days_in_month": month_state.get("days_in_month", 0),
            "planned_remaining": month_state.get("planned_remaining", 0.0),
            "projected_month_outflow": month_state.get("projected_month_outflow", 0.0),
            "open_review_count": month_state.get("open_review_count", 0),
            "top_spend_buckets": month_state.get("top_spend_buckets", []),
            "pace_target_spend": (
                round(
                    (effective_budget * max(float(month_state.get("days_elapsed", 0)), 0))
                    / max(float(month_state.get("days_in_month", 0)), 1.0),
                    1,
                )
                if effective_budget > 0 else 0.0
            ),
            "pace_status": (
                "no_budget" if effective_budget <= 0
                else (
                    "off_track"
                    if _money_float(spent) > (
                        (effective_budget * max(float(month_state.get("days_elapsed", 0)), 0))
                        / max(float(month_state.get("days_in_month", 0)), 1.0)
                    ) + max(effective_budget * 0.05, 250.0)
                    else (
                        "ahead"
                        if _money_float(spent) < (
                            (effective_budget * max(float(month_state.get("days_elapsed", 0)), 0))
                            / max(float(month_state.get("days_in_month", 0)), 1.0)
                        ) - max(effective_budget * 0.05, 250.0)
                        else "on_track"
                    )
                )
            ),
        },
        "planned_expenses": {
            "total_open": _money_float(future_planned_total),
            "items": planned_expenses,
        },
        "wishlist": {
            "total_open": _money_float(wishlist_open_total),
            "items": wishlist,
        },
        "net_worth": _safe_net_worth(db),
        "view": {
            "month_start": selected_month.isoformat(),
            "active_month_start": active_month.isoformat(),
            "is_active_month": selected_month == active_month,
            "is_historical": selected_month != active_month,
        },
    }


def get_aggregate_period_stats(db: Session, period: str) -> dict:
    from datetime import date
    from dateutil.relativedelta import relativedelta

    active_month = _resolve_active_month(db).replace(day=1)
    today = date.today()

    if period == "last_month":
        from_date = active_month - relativedelta(months=1)
        to_date   = active_month - relativedelta(days=1)
    elif period == "six_months":
        from_date = active_month - relativedelta(months=5)
        to_date   = today
    elif period == "all_time":
        from_date = date(2000, 1, 1)
        to_date   = today
    else:
        from_date = active_month
        to_date   = today

    spent = db.execute(text("""
        SELECT COALESCE(SUM(amount), 0) FROM public.transactions
        WHERE direction = 'withdrawal'
          AND transaction_date >= :from_date AND transaction_date <= :to_date
    """), {"from_date": from_date, "to_date": to_date}).scalar()

    planned = db.execute(text("""
        SELECT COALESCE(SUM(budget_amount), 0) FROM public.category_budgets
        WHERE month_start >= :from_month AND month_start <= :to_month
          AND is_active = TRUE AND (parent_name IS NULL OR TRIM(parent_name) = '')
    """), {"from_month": from_date.replace(day=1), "to_month": to_date}).scalar()

    income = db.execute(text("""
        SELECT COALESCE(SUM(expected_income), 0) FROM public.monthly_budgets
        WHERE month_start >= :from_month AND month_start <= :to_month
          AND is_active = TRUE
    """), {"from_month": from_date.replace(day=1), "to_month": to_date}).scalar()

    return {
        "total_spent":   _money_float(spent),
        "total_planned": _money_float(planned),
        "total_income":  _money_float(income),
    }


def get_category_budgets(
    db: Session,
    month_start: str,
    include_unbudgeted: bool = False,
    include_inactive_history: bool = False,
) -> dict:
    """Return category budgets with actual spend matched by tag name.
    When include_unbudgeted=True, also includes categories with actual spend but no budget set.
    """
    active_budget_clause = "" if include_inactive_history else "AND is_active = TRUE"
    active_unbudgeted_clause = "" if include_inactive_history else "AND cb2.is_active = TRUE"
    row_id_expr = "cb.id::text" if not include_inactive_history else "CASE WHEN cb.is_active THEN cb.id::text ELSE NULL::text END"

    unbudgeted_union = f"""
        UNION ALL
        SELECT
            NULL::text AS id,
            st.name    AS tag_name,
            NULL       AS parent_name,
            0          AS budget_amount,
            TRUE        AS is_active,
            SUM(t.amount) AS spent
        FROM public.transactions t
        JOIN public.transaction_tags tt ON tt.transaction_id = t.id
        JOIN public.system_tags st      ON st.id = tt.tag_id
        WHERE t.direction = 'withdrawal'
          AND DATE_TRUNC('month', t.transaction_date) = DATE_TRUNC('month', CAST(:month_start AS date))
          AND NOT EXISTS (
              SELECT 1 FROM public.category_budgets cb2
              WHERE LOWER(cb2.tag_name) = LOWER(st.name)
                AND cb2.month_start = CAST(:month_start AS date)
                {active_unbudgeted_clause}
          )
        GROUP BY st.name
    """ if include_unbudgeted else ""

    rows = db.execute(text(f"""
        SELECT
            {row_id_expr}      AS id,
            cb.tag_name,
            cb.parent_name,
            cb.budget_amount,
            cb.is_active,
            COALESCE(sp.spent, 0) AS spent
        FROM (
            SELECT DISTINCT ON (LOWER(tag_name))
                id, tag_name, parent_name, budget_amount, month_start, is_active
            FROM public.category_budgets
            WHERE month_start = CAST(:month_start AS date)
              {active_budget_clause}
              AND EXISTS (
                  SELECT 1
                  FROM public.system_tags st
                  WHERE LOWER(st.name) = LOWER(category_budgets.tag_name)
                    AND st.is_active = TRUE
              )
            ORDER BY LOWER(tag_name), is_active DESC, updated_at DESC, created_at DESC
        ) cb
        LEFT JOIN (
            SELECT LOWER(st.name) AS tag_name_lower,
                   SUM(GREATEST(
                       ABS(t.amount)
                       - COALESCE(rd.recovery_amount, 0)
                       - COALESCE(sj.shared_joy_amount, 0),
                       0
                   )) AS spent
            FROM public.transactions t
            JOIN public.transaction_tags tt ON tt.transaction_id = t.id
            JOIN public.system_tags st      ON st.id = tt.tag_id
            LEFT JOIN (
                SELECT s.transaction_id, COALESCE(SUM(r.amount), 0) AS recovery_amount
                FROM public.transaction_splits s
                LEFT JOIN public.transaction_split_recoveries r ON s.id = r.split_id
                GROUP BY s.transaction_id
            ) rd ON rd.transaction_id = t.id
            LEFT JOIN (
                SELECT s2.transaction_id, COALESCE(SUM(li.amount), 0) AS shared_joy_amount
                FROM public.transaction_splits s2
                JOIN public.transaction_split_line_items li ON li.split_id = s2.id
                WHERE LOWER(COALESCE(li.expense_for, '')) = 'shared_joy'
                GROUP BY s2.transaction_id
            ) sj ON sj.transaction_id = t.id
            WHERE t.direction = 'withdrawal'
              AND DATE_TRUNC('month', t.transaction_date) = DATE_TRUNC('month', CAST(:month_start AS date))
            GROUP BY LOWER(st.name)
        ) sp ON sp.tag_name_lower = LOWER(cb.tag_name)
        {unbudgeted_union}
        ORDER BY budget_amount DESC, tag_name ASC
    """), {"month_start": month_start}).mappings().all()

    items = []
    total_allocated = Decimal("0")
    for r in rows:
        budget    = _money(r["budget_amount"])
        spent     = _money(r["spent"])
        remaining = budget - spent
        usage_pct = round(float(spent / budget * 100), 1) if budget > 0 else 0.0
        total_allocated += budget
        items.append({
            "id":            r["id"],
            "tag_name":      r["tag_name"],
            "parent_name":   r["parent_name"],
            "budget_amount": _money_float(budget),
            "spent":         _money_float(spent),
            "remaining":     _money_float(remaining),
            "usage_pct":     usage_pct,
            "is_over":       budget > 0 and spent > budget,
            "is_active":     bool(r["is_active"]),
        })
    return {"items": items, "total_allocated": _money_float(total_allocated)}


def upsert_category_budget(db: Session, payload: dict) -> dict:
    tag_name    = str(payload.get("tag_name") or "").strip()
    parent_name = str(payload.get("parent_name") or "").strip() or None
    amount      = _money(payload.get("budget_amount"))
    month_start = payload.get("month_start")

    if not tag_name:
        return {"success": False, "error": "Category name is required."}

    # Validation: if subcategory, sum of siblings must not exceed parent budget
    if parent_name:
        parent_row = db.execute(text("""
            SELECT budget_amount FROM public.category_budgets
            WHERE month_start = CAST(:ms AS date) AND LOWER(tag_name) = LOWER(:pname) AND is_active = TRUE
        """), {"ms": month_start, "pname": parent_name}).mappings().first()
        if parent_row:
            sibling_sum = db.execute(text("""
                SELECT COALESCE(SUM(budget_amount), 0) AS s
                FROM public.category_budgets
                WHERE month_start = CAST(:ms AS date)
                  AND LOWER(parent_name) = LOWER(:pname)
                  AND LOWER(tag_name) != LOWER(:tname)
                  AND is_active = TRUE
            """), {"ms": month_start, "pname": parent_name, "tname": tag_name}).mappings().first()
            parent_budget = _money(parent_row["budget_amount"])
            siblings      = _money(sibling_sum["s"])
            if siblings + amount > parent_budget:
                return {
                    "success": False,
                    "error": (
                        f"Sub-categories of '{parent_name}' total "
                        f"₹{_money_float(siblings + amount):,.0f} but parent budget is "
                        f"₹{_money_float(parent_budget):,.0f}."
                    ),
                }

    # Validation: if parent, children sum must not exceed new amount
    children_sum = db.execute(text("""
        SELECT COALESCE(SUM(budget_amount), 0) AS s
        FROM public.category_budgets
        WHERE month_start = CAST(:ms AS date)
          AND LOWER(parent_name) = LOWER(:tname)
          AND is_active = TRUE
    """), {"ms": month_start, "tname": tag_name}).mappings().first()
    child_total = _money(children_sum["s"])
    if child_total > 0 and amount < child_total:
        return {
            "success": False,
            "error": f"Parent budget ₹{_money_float(amount):,.0f} is less than sub-category total ₹{_money_float(child_total):,.0f}.",
        }

    row = db.execute(text("""
        INSERT INTO public.category_budgets (month_start, tag_name, parent_name, budget_amount)
        VALUES (CAST(:ms AS date), :tag_name, :parent_name, :amount)
        ON CONFLICT (month_start, LOWER(tag_name)) WHERE is_active = TRUE
        DO UPDATE SET
            budget_amount = EXCLUDED.budget_amount,
            parent_name   = EXCLUDED.parent_name,
            updated_at    = NOW()
        RETURNING id::text AS id, tag_name, parent_name, budget_amount
    """), {"ms": month_start, "tag_name": tag_name, "parent_name": parent_name, "amount": amount}).mappings().first()
    db.commit()
    return {"success": True, "data": dict(row)}


def delete_category_budget(db: Session, budget_id: str) -> bool:
    result = db.execute(
        text("UPDATE public.category_budgets SET is_active = FALSE WHERE id = CAST(:id AS uuid)"),
        {"id": budget_id},
    )
    db.commit()
    return result.rowcount > 0


def _safe_net_worth(db: Session):
    try:
        from repositories.networth_repo import calculate_current_net_worth
        return calculate_current_net_worth(db)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Shared Joy budget functions
# ---------------------------------------------------------------------------

def upsert_shared_joy_budget(db: Session, payload: dict) -> dict:
    month_start = payload.get("month_start")
    if not month_start:
        month_start = _resolve_active_month(db).replace(day=1)
    elif hasattr(month_start, "replace"):
        month_start = month_start.replace(day=1)

    goal_amount = _money(payload.get("goal_amount", 0))
    reward_note = _clean_text(payload.get("reward_note"))

    row = db.execute(text("""
        INSERT INTO public.shared_joy_budgets (month_start, goal_amount, reward_note)
        VALUES (CAST(:ms AS date), :goal_amount, :reward_note)
        ON CONFLICT (month_start) WHERE is_active = TRUE
        DO UPDATE SET
            goal_amount  = EXCLUDED.goal_amount,
            reward_note  = EXCLUDED.reward_note,
            updated_at   = NOW()
        RETURNING id::text AS id, month_start, goal_amount, reward_note, carry_forward_amount, achieved_at
    """), {"ms": str(month_start), "goal_amount": goal_amount, "reward_note": reward_note}).mappings().first()
    db.commit()
    return dict(row)


def get_shared_joy_budget(db: Session, month_start: str) -> dict | None:
    row = db.execute(text("""
        SELECT id::text AS id, month_start, goal_amount, reward_note, carry_forward_amount, achieved_at
        FROM public.shared_joy_budgets
        WHERE month_start = CAST(:ms AS date) AND is_active = TRUE
        LIMIT 1
    """), {"ms": month_start}).mappings().first()
    return dict(row) if row else None


# Stored group_type values that count as EVENT (canonical + legacy aliases) for
# event-level shared joy. Kept inline to avoid coupling planning_repo to the group repo.
_SHARED_JOY_EVENT_TYPES_SQL = "('EVENT','SPLIT','RETURN','CIRCLE','GENERAL')"

# Members of an EVENT group that carries its own shared_joy_amount must NOT have their
# per-transaction split shared joy counted too, or it double-counts.
_SHARED_JOY_MEMBER_EXCLUSION = f"""
    AND t.id NOT IN (
        SELECT gl.transaction_id
        FROM public.transaction_group_links gl
        JOIN public.transaction_groups g2 ON g2.id = gl.group_id
        WHERE g2.shared_joy_amount > 0
          AND UPPER(g2.group_type) IN {_SHARED_JOY_EVENT_TYPES_SQL}
    )
"""

# Event-level shared joy attributed to the month of the event's latest member date.
_SHARED_JOY_EVENT_MONTH_TOTAL = f"""
    SELECT COALESCE(SUM(g.shared_joy_amount), 0)
    FROM public.transaction_groups g
    WHERE g.shared_joy_amount > 0
      AND UPPER(g.group_type) IN {_SHARED_JOY_EVENT_TYPES_SQL}
      AND DATE_TRUNC('month', (
            SELECT MAX(t.transaction_date)
            FROM public.transaction_group_links gl
            JOIN public.transactions t ON t.id = gl.transaction_id
            WHERE gl.group_id = g.id
          )) = DATE_TRUNC('month', CAST(:ms AS date))
"""


def get_shared_joy_monthly_summary(db: Session, month_start: str) -> dict:
    """Return actual shared-joy spend, goal, carry-forward, achievement status, and per-category breakdown."""
    spent_row = db.execute(text(f"""
        SELECT COALESCE(SUM(ABS(li.amount)), 0) AS total
        FROM public.transaction_split_line_items li
        JOIN public.transaction_splits s ON s.id = li.split_id
        JOIN public.transactions t ON t.id = s.transaction_id
        WHERE lower(COALESCE(li.expense_for, '')) = 'shared_joy'
          AND DATE_TRUNC('month', t.transaction_date) = DATE_TRUNC('month', CAST(:ms AS date))
          {_SHARED_JOY_MEMBER_EXCLUSION}
    """), {"ms": month_start}).scalar_one()

    # Event-level shared joy (set on the combined Outing/Event group itself)
    event_spent_row = db.execute(text(_SHARED_JOY_EVENT_MONTH_TOTAL), {"ms": month_start}).scalar_one()

    by_category_rows = db.execute(text(f"""
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
        WHERE lower(COALESCE(li.expense_for, '')) = 'shared_joy'
          AND DATE_TRUNC('month', t.transaction_date) = DATE_TRUNC('month', CAST(:ms AS date))
          {_SHARED_JOY_MEMBER_EXCLUSION}
        GROUP BY st.name
    """), {"ms": month_start}).mappings().all()

    budget_row = get_shared_joy_budget(db, month_start)

    # Carry-forward: previous months where goal > 0 and spent < goal (deficit carries as a giving target)
    carry_row = db.execute(text("""
        SELECT COALESCE(SUM(
            GREATEST(sjb.goal_amount - COALESCE(spent.total, 0), 0)
        ), 0) AS carry_total
        FROM public.shared_joy_budgets sjb
        LEFT JOIN (
            SELECT
                DATE_TRUNC('month', t.transaction_date)::date AS txn_month,
                COALESCE(SUM(ABS(li.amount)), 0) AS total
            FROM public.transaction_split_line_items li
            JOIN public.transaction_splits s ON s.id = li.split_id
            JOIN public.transactions t ON t.id = s.transaction_id
            WHERE lower(COALESCE(li.expense_for, '')) = 'shared_joy'
            GROUP BY DATE_TRUNC('month', t.transaction_date)::date
        ) spent ON spent.txn_month = sjb.month_start
        WHERE sjb.is_active = TRUE
          AND sjb.goal_amount > 0
          AND DATE_TRUNC('month', sjb.month_start) < DATE_TRUNC('month', CAST(:ms AS date))
    """), {"ms": month_start}).scalar_one()

    goal = _money_float(budget_row.get("goal_amount", 0)) if budget_row else 0.0
    carry_forward = _money_float(carry_row)
    effective_goal = goal + carry_forward
    event_spent = _money_float(event_spent_row)
    spent = _money_float(spent_row) + event_spent
    achieved = effective_goal > 0 and spent >= effective_goal
    reward_note = budget_row.get("reward_note") if budget_row else None

    # Mark achieved_at if just crossed the threshold and not yet marked
    if achieved and budget_row and not budget_row.get("achieved_at"):
        db.execute(text("""
            UPDATE public.shared_joy_budgets
            SET achieved_at = NOW(), updated_at = NOW()
            WHERE month_start = CAST(:ms AS date) AND is_active = TRUE
        """), {"ms": month_start})
        db.commit()

    by_category = [
        {"tag_name": r["tag_name"], "shared_joy_amount": _money_float(r["shared_joy_amount"])}
        for r in by_category_rows
        if r["tag_name"]
    ]
    if event_spent > 0:
        by_category.append({"tag_name": "Outings / Events", "shared_joy_amount": event_spent})

    return {
        "month_start": month_start,
        "goal_amount": goal,
        "carry_forward": carry_forward,
        "effective_goal": effective_goal,
        "spent": spent,
        "remaining": round(max(effective_goal - spent, 0), 2),
        "achieved": achieved,
        "reward_note": reward_note,
        "usage_pct": round((spent / max(effective_goal, 0.01)) * 100, 1) if effective_goal > 0 else 0.0,
        "by_category": by_category,
    }


def get_shared_joy_yearly_summary(db: Session, year: int) -> dict:
    """Year (Jan–Dec) Shared Joy view. The configured monthly goal is treated as a
    recurring monthly minimum, so the annual target = monthly_goal × 12. Returns
    per-month giving (splits + event-group shared joy), YTD/annual totals, and the
    year-end shortfall (what you'd donate to meet the pledge)."""
    from datetime import date as _date

    # Recurring monthly goal = latest goal set within the year.
    goal_row = db.execute(text("""
        SELECT goal_amount FROM public.shared_joy_budgets
        WHERE is_active = TRUE AND EXTRACT(YEAR FROM month_start) = :yr
        ORDER BY month_start DESC LIMIT 1
    """), {"yr": year}).scalar_one_or_none()
    monthly_goal = _money_float(goal_row) if goal_row is not None else 0.0
    annual_target = monthly_goal * 12

    # Per-month per-transaction split shared joy (excluding event-group members).
    split_rows = db.execute(text(f"""
        SELECT EXTRACT(MONTH FROM t.transaction_date)::int AS m, COALESCE(SUM(ABS(li.amount)), 0) AS total
        FROM public.transaction_split_line_items li
        JOIN public.transaction_splits s ON s.id = li.split_id
        JOIN public.transactions t ON t.id = s.transaction_id
        WHERE lower(COALESCE(li.expense_for, '')) = 'shared_joy'
          AND EXTRACT(YEAR FROM t.transaction_date)::int = :yr
          {_SHARED_JOY_MEMBER_EXCLUSION}
        GROUP BY 1
    """), {"yr": year}).mappings().all()

    # Per-month event-level shared joy (attributed to the event's latest member date).
    event_rows = db.execute(text(f"""
        SELECT EXTRACT(MONTH FROM ev.event_date)::int AS m, COALESCE(SUM(ev.shared_joy_amount), 0) AS total
        FROM (
            SELECT g.shared_joy_amount,
                   (SELECT MAX(t.transaction_date) FROM public.transaction_group_links gl
                    JOIN public.transactions t ON t.id = gl.transaction_id WHERE gl.group_id = g.id) AS event_date
            FROM public.transaction_groups g
            WHERE g.shared_joy_amount > 0 AND UPPER(g.group_type) IN {_SHARED_JOY_EVENT_TYPES_SQL}
        ) ev
        WHERE ev.event_date IS NOT NULL AND EXTRACT(YEAR FROM ev.event_date)::int = :yr
        GROUP BY 1
    """), {"yr": year}).mappings().all()

    by_month = {m: 0.0 for m in range(1, 13)}
    for r in split_rows:
        by_month[int(r["m"])] += _money_float(r["total"])
    for r in event_rows:
        by_month[int(r["m"])] += _money_float(r["total"])

    today = _date.today()
    cur_month = today.month if today.year == year else 12
    annual_spent = round(sum(by_month.values()), 2)
    ytd_spent = round(sum(by_month[m] for m in range(1, cur_month + 1)), 2)
    shortfall = round(max(annual_target - annual_spent, 0), 2)

    months = []
    for m in range(1, 13):
        sp = round(by_month[m], 2)
        months.append({
            "month": m,
            "spent": sp,
            "goal": monthly_goal,
            "achieved": monthly_goal > 0 and sp >= monthly_goal,
            "pct": round((sp / monthly_goal) * 100, 1) if monthly_goal > 0 else 0.0,
        })

    return {
        "year": year,
        "monthly_goal": monthly_goal,
        "annual_target": round(annual_target, 2),
        "annual_spent": annual_spent,
        "ytd_spent": ytd_spent,
        "shortfall": shortfall,
        "current_month": cur_month,
        "current_month_spent": round(by_month[cur_month], 2),
        "achieved_months": sum(1 for mm in months if mm["achieved"]),
        "months": months,
    }
