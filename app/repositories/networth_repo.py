import json
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


def _money_float(value) -> float:
    try:
        return float(Decimal(str(value or 0)).quantize(Decimal("0.01")))
    except Exception:
        return 0.0


def calculate_current_net_worth(db: Session) -> dict:
    # For bank-linked accounts, use the statement closing balance (most accurate).
    # For manual accounts, use the manually-entered current_balance.
    rows = db.execute(text("""
        SELECT
            ap.asset_class,
            ap.account_type,
            COALESCE(ap.account_subtype, ap.account_type) AS account_subtype,
            COUNT(*)                                       AS account_count,
            MAX(COALESCE(ap.balance_as_of, CURRENT_DATE)) AS latest_as_of,
            SUM(
                CASE
                    WHEN ap.is_bank_linked = TRUE AND ap.source_name IS NOT NULL
                    THEN COALESCE((
                        SELECT running_balance
                        FROM public.transactions t
                        WHERE UPPER(TRIM(t.payment_source_name)) = UPPER(TRIM(ap.source_name))
                          AND t.running_balance IS NOT NULL
                        ORDER BY t.transaction_date DESC, t.transaction_time DESC NULLS LAST, t.id DESC
                        LIMIT 1
                    ), ap.current_balance)
                    ELSE ap.current_balance
                END
            ) AS total_balance
        FROM public.account_profiles ap
        WHERE ap.is_active = TRUE
        GROUP BY ap.asset_class, ap.account_type, COALESCE(ap.account_subtype, ap.account_type)
        ORDER BY ap.asset_class ASC, total_balance DESC
    """)).mappings().all()

    assets = []
    liabilities = []
    total_assets = Decimal("0.00")
    total_liabilities = Decimal("0.00")
    latest_as_of = None

    for row in rows:
        balance = Decimal(str(row["total_balance"] or 0))
        entry = {
            "account_type":    row["account_type"],
            "account_subtype": row["account_subtype"],
            "total_balance":   _money_float(balance),
            "account_count":   int(row["account_count"]),
        }
        as_of = row["latest_as_of"]
        if as_of and (latest_as_of is None or as_of > latest_as_of):
            latest_as_of = as_of

        if str(row["asset_class"] or "asset").lower() == "liability":
            liabilities.append(entry)
            total_liabilities += abs(balance)
        else:
            assets.append(entry)
            total_assets += balance

    net_worth = total_assets - total_liabilities
    return {
        "net_worth":         _money_float(net_worth),
        "total_assets":      _money_float(total_assets),
        "total_liabilities": _money_float(total_liabilities),
        "as_of":             str(latest_as_of) if latest_as_of else str(date.today()),
        "breakdown": {
            "assets":      assets,
            "liabilities": liabilities,
        },
    }


def save_net_worth_snapshot(db: Session, notes: Optional[str] = None) -> dict:
    nw = calculate_current_net_worth(db)
    row = db.execute(
        text("""
            INSERT INTO public.net_worth_snapshots
                (snapshot_date, total_assets, total_liabilities, net_worth, breakdown, notes)
            VALUES
                (:snapshot_date, :total_assets, :total_liabilities, :net_worth, CAST(:breakdown AS jsonb), :notes)
            ON CONFLICT (snapshot_date) DO UPDATE SET
                total_assets      = EXCLUDED.total_assets,
                total_liabilities = EXCLUDED.total_liabilities,
                net_worth         = EXCLUDED.net_worth,
                breakdown         = EXCLUDED.breakdown,
                notes             = COALESCE(EXCLUDED.notes, net_worth_snapshots.notes)
            RETURNING
                id::text AS id,
                snapshot_date,
                total_assets,
                total_liabilities,
                net_worth
        """),
        {
            "snapshot_date":     date.today(),
            "total_assets":      nw["total_assets"],
            "total_liabilities": nw["total_liabilities"],
            "net_worth":         nw["net_worth"],
            "breakdown":         json.dumps(nw["breakdown"]),
            "notes":             notes,
        },
    ).mappings().first()
    db.commit()
    return {
        "id":                str(row["id"]),
        "snapshot_date":     str(row["snapshot_date"]),
        "total_assets":      _money_float(row["total_assets"]),
        "total_liabilities": _money_float(row["total_liabilities"]),
        "net_worth":         _money_float(row["net_worth"]),
    }


def get_net_worth_history(
    db: Session,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 24,
) -> list[dict]:
    rows = db.execute(
        text("""
            SELECT
                id::text AS id,
                snapshot_date,
                total_assets,
                total_liabilities,
                net_worth,
                breakdown,
                notes
            FROM public.net_worth_snapshots
            WHERE (:from_date IS NULL OR snapshot_date >= CAST(:from_date AS date))
              AND (:to_date   IS NULL OR snapshot_date <= CAST(:to_date   AS date))
            ORDER BY snapshot_date ASC
            LIMIT :limit
        """),
        {"from_date": from_date, "to_date": to_date, "limit": limit},
    ).mappings().all()

    return [
        {
            "id":                str(row["id"]),
            "snapshot_date":     str(row["snapshot_date"]),
            "total_assets":      _money_float(row["total_assets"]),
            "total_liabilities": _money_float(row["total_liabilities"]),
            "net_worth":         _money_float(row["net_worth"]),
            "notes":             row["notes"],
        }
        for row in rows
    ]


def get_net_worth_goals(db: Session) -> list[dict]:
    latest_nw = calculate_current_net_worth(db)
    current_net_worth = latest_nw["net_worth"]

    rows = db.execute(text("""
        SELECT id::text AS id, title, target_amount, target_date, notes, created_at
        FROM public.net_worth_goals
        WHERE is_active = TRUE
        ORDER BY target_date ASC NULLS LAST, created_at ASC
    """)).mappings().all()

    result = []
    for row in rows:
        target = _money_float(row["target_amount"])
        progress_pct = round((current_net_worth / target * 100), 1) if target > 0 else 0.0
        result.append({
            "id":             str(row["id"]),
            "title":          row["title"],
            "target_amount":  target,
            "target_date":    str(row["target_date"]) if row["target_date"] else None,
            "notes":          row["notes"],
            "current_amount": current_net_worth,
            "progress_pct":   min(progress_pct, 100.0),
        })
    return result


def save_net_worth_goal(payload: dict, db: Session) -> dict:
    from uuid import uuid4
    goal_id = payload.get("id") or str(uuid4())
    row = db.execute(
        text("""
            INSERT INTO public.net_worth_goals (id, title, target_amount, target_date, notes)
            VALUES (CAST(:id AS uuid), :title, :target_amount, :target_date, :notes)
            ON CONFLICT (id) DO UPDATE SET
                title         = EXCLUDED.title,
                target_amount = EXCLUDED.target_amount,
                target_date   = EXCLUDED.target_date,
                notes         = EXCLUDED.notes,
                is_active     = TRUE
            RETURNING id::text AS id, title, target_amount, target_date, notes
        """),
        {
            "id":            goal_id,
            "title":         str(payload.get("title") or "").strip() or "Net worth goal",
            "target_amount": _money_float(payload.get("target_amount") or 0),
            "target_date":   payload.get("target_date"),
            "notes":         str(payload.get("notes") or "").strip() or None,
        },
    ).mappings().first()
    db.commit()
    return {
        "id":            str(row["id"]),
        "title":         row["title"],
        "target_amount": _money_float(row["target_amount"]),
        "target_date":   str(row["target_date"]) if row["target_date"] else None,
        "notes":         row["notes"],
    }


def delete_net_worth_goal(goal_id: str, db: Session) -> bool:
    result = db.execute(
        text("UPDATE public.net_worth_goals SET is_active = FALSE WHERE id = CAST(:id AS uuid)"),
        {"id": goal_id},
    )
    db.commit()
    return result.rowcount > 0
