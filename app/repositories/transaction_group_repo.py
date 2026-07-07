from typing import Optional
from sqlalchemy import text
from sqlalchemy.orm import Session


# ── Canonical group types ────────────────────────────────────────────────────
# Three user-facing kinds. Legacy values (SPLIT/RETURN/CIRCLE/GENERAL/MERCHANT)
# get folded at read-time so old data keeps working without a destructive migration.
CANONICAL_GROUP_TYPES = {"EVENT", "PATTERN", "PORTFOLIO"}

_LEGACY_TYPE_MAP = {
    "SPLIT":    "EVENT",
    "RETURN":   "EVENT",
    "CIRCLE":   "EVENT",
    "GENERAL":  "EVENT",
    "MERCHANT": "PATTERN",
}


def canonical_group_type(raw: Optional[str]) -> str:
    """Fold a stored group_type into one of EVENT / PATTERN / PORTFOLIO.
    LENIENT — used at read-time so old data with unknown values still loads."""
    if not raw:
        return "EVENT"
    v = str(raw).strip().upper()
    if v in CANONICAL_GROUP_TYPES:
        return v
    return _LEGACY_TYPE_MAP.get(v, "EVENT")


def resolve_writable_group_type(raw: Optional[str]) -> Optional[str]:
    """STRICT canonicalization for write paths. Returns the canonical type only if
    the input is a known canonical or known legacy value; returns None otherwise so
    the router can 400 on truly unknown inputs (rather than silently → EVENT)."""
    if not raw:
        return None
    v = str(raw).strip().upper()
    if v in CANONICAL_GROUP_TYPES:
        return v
    return _LEGACY_TYPE_MAP.get(v)  # None if not a known legacy alias either


def ensure_group_tables(db: Session):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.transaction_groups (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name        TEXT NOT NULL,
            group_type  TEXT NOT NULL DEFAULT 'EVENT',
            status      TEXT NOT NULL DEFAULT 'OPEN',
            notes       TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    # Type-specific extensions: EVENT uses shared_joy_amount;
    # PORTFOLIO stores cost_basis / current_value / asset_class inside meta JSONB.
    db.execute(text("""
        ALTER TABLE public.transaction_groups
            ADD COLUMN IF NOT EXISTS shared_joy_amount NUMERIC(12,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.transaction_group_participants (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            group_id    UUID NOT NULL,
            person_name TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT fk_tgpart_group
                FOREIGN KEY (group_id) REFERENCES public.transaction_groups(id) ON DELETE CASCADE
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.transaction_group_links (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            group_id           UUID NOT NULL,
            transaction_id     UUID NOT NULL,
            role               TEXT NOT NULL DEFAULT 'EXPENSE',
            attributed_amount  NUMERIC(12,2),
            notes              TEXT,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT fk_tglink_group
                FOREIGN KEY (group_id) REFERENCES public.transaction_groups(id) ON DELETE CASCADE,
            CONSTRAINT fk_tglink_transaction
                FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE,
            CONSTRAINT uq_tglink_group_transaction UNIQUE (group_id, transaction_id)
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.transaction_group_settlements (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            group_id    UUID NOT NULL,
            from_person TEXT,
            amount      NUMERIC(12,2) NOT NULL,
            notes       TEXT,
            settled_at  DATE NOT NULL DEFAULT CURRENT_DATE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT fk_tgsettle_group
                FOREIGN KEY (group_id) REFERENCES public.transaction_groups(id) ON DELETE CASCADE
        )
    """))
    db.commit()


# ── Groups ────────────────────────────────────────────────────────────────────

def create_group(db: Session, name: str, group_type: str, notes: Optional[str]) -> dict:
    canonical = canonical_group_type(group_type)
    row = db.execute(text("""
        INSERT INTO public.transaction_groups (name, group_type, notes)
        VALUES (:name, :group_type, :notes)
        RETURNING id::text, name, group_type, status, notes, shared_joy_amount, meta, created_at, updated_at
    """), {"name": name.strip(), "group_type": canonical, "notes": notes}).mappings().first()
    db.commit()
    out = dict(row)
    out["group_type"] = canonical_group_type(out.get("group_type"))
    out["shared_joy_amount"] = float(out.get("shared_joy_amount") or 0)
    out["meta"] = dict(out.get("meta") or {})
    return out


def list_groups(db: Session, status: Optional[str] = None) -> list[dict]:
    rows = db.execute(text("""
        SELECT
            g.id::text,
            g.name,
            g.group_type,
            g.status,
            g.notes,
            g.shared_joy_amount,
            g.meta,
            g.created_at,
            g.updated_at,
            COUNT(DISTINCT gl.id)                                           AS link_count,
            COALESCE(SUM(CASE WHEN gl.role IN ('EXPENSE','CONTRIBUTION_OUT')
                THEN COALESCE(gl.attributed_amount,
                     (SELECT ABS(t2.amount) FROM public.transactions t2 WHERE t2.id = gl.transaction_id))
                ELSE 0 END), 0)                                             AS total_expense,
            COALESCE(SUM(CASE WHEN gl.role IN ('REFUND','RECOVERY','SETTLEMENT','CONTRIBUTION_IN','PAYOUT_IN')
                THEN COALESCE(gl.attributed_amount,
                     (SELECT ABS(t2.amount) FROM public.transactions t2 WHERE t2.id = gl.transaction_id))
                ELSE 0 END), 0)                                             AS total_deducted,
            COALESCE((SELECT SUM(s.amount) FROM public.transaction_group_settlements s
                      WHERE s.group_id = g.id), 0)                          AS total_settled,
            COALESCE(SUM(
                CASE WHEN gl.role IN ('EXPENSE','CONTRIBUTION_OUT')
                THEN (
                    SELECT COALESCE(SUM(r.amount), 0)
                    FROM public.transaction_split_recoveries r
                    JOIN public.transaction_splits sp ON sp.id = r.split_id
                    WHERE sp.transaction_id = gl.transaction_id
                      AND NOT EXISTS (
                          SELECT 1 FROM public.transaction_group_links gl2
                          WHERE gl2.transaction_id = r.recovery_transaction_id
                            AND gl2.group_id = g.id
                      )
                ) ELSE 0 END
            ), 0)                                                           AS auto_recovered
        FROM public.transaction_groups g
        LEFT JOIN public.transaction_group_links gl ON gl.group_id = g.id
        WHERE (:status IS NULL OR g.status = :status)
        GROUP BY g.id
        ORDER BY g.created_at DESC
    """), {"status": status}).mappings().all()

    result = []
    for r in rows:
        expense       = float(r["total_expense"] or 0)
        deducted      = float(r["total_deducted"] or 0)
        settled       = float(r["total_settled"] or 0)
        auto_recovered = float(r["auto_recovered"] or 0)
        net_balance   = expense - deducted - auto_recovered - settled
        result.append({
            "id":               r["id"],
            "name":             r["name"],
            "group_type":       canonical_group_type(r["group_type"]),
            "group_type_raw":   r["group_type"],
            "status":           r["status"],
            "notes":            r["notes"],
            "shared_joy_amount": float(r.get("shared_joy_amount") or 0),
            "meta":             dict(r.get("meta") or {}),
            "created_at":       str(r["created_at"]),
            "link_count":       int(r["link_count"]),
            "total_expense":    expense,
            "total_deducted":   deducted,
            "total_settled":    settled,
            "auto_recovered":   auto_recovered,
            "net_balance":      net_balance,
        })
    return result


def get_group_detail(db: Session, group_id: str) -> Optional[dict]:
    g = db.execute(text("""
        SELECT id::text, name, group_type, status, notes,
               shared_joy_amount, meta, created_at, updated_at
        FROM public.transaction_groups WHERE id = :gid
    """), {"gid": group_id}).mappings().first()
    if not g:
        return None

    participants = db.execute(text("""
        SELECT id::text, person_name, created_at
        FROM public.transaction_group_participants
        WHERE group_id = :gid ORDER BY created_at
    """), {"gid": group_id}).mappings().all()

    links = db.execute(text("""
        SELECT
            gl.id::text,
            gl.transaction_id::text,
            gl.role,
            gl.notes,
            gl.created_at,
            COALESCE(gl.attributed_amount, ABS(t.amount)) AS attributed_amount,
            gl.attributed_amount IS NULL                   AS uses_full_amount,
            t.transaction_date,
            t.direction,
            ABS(t.amount)                                  AS full_amount,
            COALESCE(NULLIF(BTRIM(t.vendor_name),''),
                     NULLIF(BTRIM(t.counterparty_entity_name),''),
                     t.counterparty_identifier,
                     'Unknown')                            AS merchant,
            t.payment_source_name,
            t.narration
        FROM public.transaction_group_links gl
        JOIN public.transactions t ON t.id = gl.transaction_id
        WHERE gl.group_id = :gid
        ORDER BY t.transaction_date DESC, gl.created_at DESC
    """), {"gid": group_id}).mappings().all()

    settlements = db.execute(text("""
        SELECT id::text, from_person, amount, notes, settled_at, created_at
        FROM public.transaction_group_settlements
        WHERE group_id = :gid ORDER BY settled_at DESC
    """), {"gid": group_id}).mappings().all()

    _DEBIT  = {"EXPENSE", "CONTRIBUTION_OUT"}
    _CREDIT = {"REFUND", "RECOVERY", "SETTLEMENT", "CONTRIBUTION_IN", "PAYOUT_IN"}
    total_expense  = sum(float(l["attributed_amount"] or 0) for l in links if l["role"] in _DEBIT)
    total_deducted = sum(float(l["attributed_amount"] or 0) for l in links if l["role"] in _CREDIT)
    total_settled  = sum(float(s["amount"] or 0) for s in settlements)

    # Auto-recover: sum split recoveries not already linked as a group role
    expense_txn_ids = [l["transaction_id"] for l in links if l["role"] in _DEBIT]
    all_linked_txn_ids = {l["transaction_id"] for l in links}
    auto_recovered = 0.0
    if expense_txn_ids:
        from uuid import UUID as _UUID
        valid = [str(_UUID(str(t))) for t in expense_txn_ids if t]
        if valid:
            in_clause = ",".join(f"'{t}'" for t in valid)
            exclude_clause = ""
            valid_linked = [str(_UUID(str(t))) for t in all_linked_txn_ids if t]
            if valid_linked:
                linked_in = ",".join(f"'{t}'" for t in valid_linked)
                exclude_clause = f"AND r.recovery_transaction_id::text NOT IN ({linked_in})"
            ar = db.execute(text(f"""
                SELECT COALESCE(SUM(r.amount), 0)
                FROM public.transaction_split_recoveries r
                JOIN public.transaction_splits sp ON sp.id = r.split_id
                WHERE sp.transaction_id::text IN ({in_clause})
                {exclude_clause}
            """)).scalar_one_or_none()
            auto_recovered = float(ar or 0)

    net_balance = total_expense - total_deducted - auto_recovered - total_settled

    out = dict(g)
    out["group_type_raw"]    = out.get("group_type")
    out["group_type"]        = canonical_group_type(out.get("group_type"))
    out["shared_joy_amount"] = float(out.get("shared_joy_amount") or 0)
    out["meta"]              = dict(out.get("meta") or {})
    out["participants"]      = [dict(p) for p in participants]
    out["links"]             = [dict(l) for l in links]
    out["settlements"]       = [dict(s) for s in settlements]
    out["total_expense"]     = total_expense
    out["total_deducted"]    = total_deducted
    out["total_settled"]     = total_settled
    out["auto_recovered"]    = auto_recovered
    out["net_balance"]       = net_balance
    return out


def update_group(db: Session, group_id: str, name: str, status: str, notes: Optional[str],
                 group_type: Optional[str] = None) -> Optional[dict]:
    sets = ["name = :name", "status = :status", "notes = :notes", "updated_at = NOW()"]
    params = {"gid": group_id, "name": name.strip(), "status": status, "notes": notes}
    # group_type is the bucket; only change it when an explicit value is passed.
    if group_type is not None:
        sets.append("group_type = :group_type")
        params["group_type"] = canonical_group_type(group_type)
    row = db.execute(text(f"""
        UPDATE public.transaction_groups
        SET {", ".join(sets)}
        WHERE id = :gid
        RETURNING id::text, name, group_type, status, notes, updated_at
    """), params).mappings().first()
    db.commit()
    return dict(row) if row else None


def update_group_meta(
    db: Session,
    group_id: str,
    *,
    shared_joy_amount: Optional[float] = None,
    meta_patch: Optional[dict] = None,
) -> Optional[dict]:
    """Update type-specific fields on a group.

    - `shared_joy_amount` (EVENT type): pass a number to set, or None to leave unchanged.
    - `meta_patch` (any type, used by PORTFOLIO for cost_basis/current_value/etc.):
       merged into the existing JSONB rather than replacing it.
    """
    import json as _json

    sets = ["updated_at = NOW()"]
    params: dict = {"gid": group_id}

    if shared_joy_amount is not None:
        sets.append("shared_joy_amount = :sj")
        params["sj"] = float(shared_joy_amount)

    if meta_patch:
        sets.append("meta = COALESCE(meta, '{}'::jsonb) || CAST(:meta_patch AS jsonb)")
        params["meta_patch"] = _json.dumps(meta_patch)

    sql = f"""
        UPDATE public.transaction_groups
        SET {", ".join(sets)}
        WHERE id = :gid
        RETURNING id::text, name, group_type, status, notes,
                  shared_joy_amount, meta, updated_at
    """
    row = db.execute(text(sql), params).mappings().first()
    db.commit()
    if not row:
        return None
    out = dict(row)
    out["group_type_raw"]    = out.get("group_type")
    out["group_type"]        = canonical_group_type(out.get("group_type"))
    out["shared_joy_amount"] = float(out.get("shared_joy_amount") or 0)
    out["meta"]              = dict(out.get("meta") or {})
    return out


def delete_group(db: Session, group_id: str):
    db.execute(text("DELETE FROM public.transaction_groups WHERE id = :gid"), {"gid": group_id})
    db.commit()


# ── Links ─────────────────────────────────────────────────────────────────────

_CREDIT_ROLES = {"REFUND", "RECOVERY", "SETTLEMENT", "CONTRIBUTION_IN", "PAYOUT_IN"}
_DEBIT_ROLES  = {"EXPENSE", "CONTRIBUTION_OUT"}


def add_link(db: Session, group_id: str, transaction_id: str, role: str,
             attributed_amount: Optional[float], notes: Optional[str]) -> dict:
    row = db.execute(text("""
        INSERT INTO public.transaction_group_links
            (group_id, transaction_id, role, attributed_amount, notes)
        VALUES (:gid, :tid, :role, :amount, :notes)
        ON CONFLICT (group_id, transaction_id)
        DO UPDATE SET role = EXCLUDED.role,
                      attributed_amount = EXCLUDED.attributed_amount,
                      notes = EXCLUDED.notes
        RETURNING id::text, group_id::text, transaction_id::text, role, attributed_amount, notes
    """), {"gid": group_id, "tid": transaction_id, "role": role,
           "amount": attributed_amount, "notes": notes}).mappings().first()
    db.commit()

    # When a credit (recovery/refund) transaction is added to an event group,
    # auto-create split + recovery records so Fix 1 (budget SQL) picks it up.
    if role and role.upper() in _CREDIT_ROLES:
        _auto_link_group_recovery(db, group_id, transaction_id)

    return dict(row)


def _auto_link_group_recovery(db: Session, group_id: str, credit_transaction_id: str):
    """Create transaction_split_recoveries for each expense member of the group,
    allocating the credit proportionally by expense amount."""
    from repositories.transaction_split_repo import save_split_recovery_link

    # Get all EXPENSE-role members with their amounts
    expense_rows = db.execute(text("""
        SELECT gl.transaction_id::text, t.amount,
               COALESCE(gl.attributed_amount, ABS(t.amount)) AS effective_amount
        FROM public.transaction_group_links gl
        JOIN public.transactions t ON t.id = gl.transaction_id
        WHERE gl.group_id = CAST(:gid AS uuid)
          AND UPPER(gl.role) IN ('EXPENSE','CONTRIBUTION_OUT')
          AND LOWER(t.direction) = 'withdrawal'
    """), {"gid": group_id}).mappings().all()

    if not expense_rows:
        return

    total_expense = sum(float(r["effective_amount"] or 0) for r in expense_rows)
    if total_expense <= 0:
        return

    # Get credit transaction amount
    credit_amount = db.execute(
        text("SELECT ABS(amount) FROM public.transactions WHERE id = CAST(:tid AS uuid)"),
        {"tid": credit_transaction_id},
    ).scalar_one_or_none()
    if not credit_amount or float(credit_amount) <= 0:
        return

    credit_amount = float(credit_amount)

    for exp in expense_rows:
        exp_share = (float(exp["effective_amount"]) / total_expense) * credit_amount

        # Ensure a split row exists for this expense transaction (upsert minimal split)
        split_id = db.execute(text("""
            INSERT INTO public.transaction_splits (transaction_id, split_mode, total_amount)
            VALUES (CAST(:tid AS uuid), 'recovery', CAST(:amt AS numeric))
            ON CONFLICT (transaction_id) DO UPDATE SET updated_at = NOW()
            RETURNING id
        """), {"tid": exp["transaction_id"], "amt": float(exp["effective_amount"])}).scalar_one()
        db.commit()

        # Link the credit transaction as a recovery against this expense split
        save_split_recovery_link(
            split_id=split_id,
            split_line_item_id=None,
            recovery_transaction_id=credit_transaction_id,
            recovery_type="GROUP_RECOVERY",
            amount=exp_share,
            notes=f"Auto-linked from event group {group_id}",
            db=db,
        )


def remove_link(db: Session, link_id: str):
    db.execute(text("DELETE FROM public.transaction_group_links WHERE id = :lid"), {"lid": link_id})
    db.commit()


# ── Participants ──────────────────────────────────────────────────────────────

def add_participant(db: Session, group_id: str, person_name: str) -> dict:
    row = db.execute(text("""
        INSERT INTO public.transaction_group_participants (group_id, person_name)
        VALUES (:gid, :name)
        RETURNING id::text, group_id::text, person_name, created_at
    """), {"gid": group_id, "name": person_name.strip()}).mappings().first()
    db.commit()
    return dict(row)


def remove_participant(db: Session, participant_id: str):
    db.execute(text("DELETE FROM public.transaction_group_participants WHERE id = :pid"),
               {"pid": participant_id})
    db.commit()


# ── Settlements ───────────────────────────────────────────────────────────────

def add_settlement(db: Session, group_id: str, from_person: Optional[str],
                   amount: float, notes: Optional[str], settled_at: str) -> dict:
    row = db.execute(text("""
        INSERT INTO public.transaction_group_settlements
            (group_id, from_person, amount, notes, settled_at)
        VALUES (:gid, :person, :amount, :notes, CAST(:settled_at AS date))
        RETURNING id::text, group_id::text, from_person, amount, notes, settled_at, created_at
    """), {"gid": group_id, "person": from_person, "amount": amount,
           "notes": notes, "settled_at": settled_at}).mappings().first()
    db.commit()
    return dict(row)


def remove_settlement(db: Session, settlement_id: str):
    db.execute(text("DELETE FROM public.transaction_group_settlements WHERE id = :sid"),
               {"sid": settlement_id})
    db.commit()


# ── Reports integration ───────────────────────────────────────────────────────

def get_group_transaction_ids(db: Session, group_id: str) -> list[str]:
    rows = db.execute(text("""
        SELECT transaction_id::text
        FROM public.transaction_group_links
        WHERE group_id = :gid
    """), {"gid": group_id}).fetchall()
    return [row[0] for row in rows]


# Stored group_type values that fold to canonical EVENT (incl. legacy aliases).
_EVENT_FAMILY_TYPES = {"EVENT"} | {k for k, v in _LEGACY_TYPE_MAP.items() if v == "EVENT"}


def get_open_group_flags(db: Session, transaction_ids: list[str]) -> dict:
    if not transaction_ids:
        return {}
    from uuid import UUID as _UUID
    valid = []
    for tid in transaction_ids:
        try:
            valid.append(str(_UUID(str(tid))))
        except (ValueError, AttributeError):
            pass
    if not valid:
        return {}
    in_clause = ",".join(f"'{tid}'" for tid in valid)
    event_types = ",".join(f"'{t}'" for t in sorted(_EVENT_FAMILY_TYPES))
    # Return OPEN groups of any type (badge behavior) PLUS all EVENT-family groups
    # regardless of status, so settled events still collapse on the report page.
    # When a transaction is in both, EVENT membership wins (ordered last → overwrites).
    rows = db.execute(text(f"""
        SELECT gl.transaction_id::text,
               g.id::text AS group_id,
               g.name AS group_name,
               g.group_type,
               g.status,
               g.shared_joy_amount,
               (SELECT COUNT(*) FROM public.transaction_group_links gl2
                WHERE gl2.group_id = g.id) AS total_member_count
        FROM public.transaction_group_links gl
        JOIN public.transaction_groups g ON g.id = gl.group_id
        WHERE gl.transaction_id::text IN ({in_clause})
          AND (g.status = 'OPEN' OR UPPER(g.group_type) IN ({event_types}))
        ORDER BY CASE WHEN UPPER(g.group_type) IN ({event_types}) THEN 1 ELSE 0 END
    """)).mappings().all()
    return {r["transaction_id"]: {"group_id": r["group_id"],
                                   "group_name": r["group_name"],
                                   "group_type": canonical_group_type(r["group_type"]),
                                   "status": r["status"],
                                   "shared_joy_amount": float(r["shared_joy_amount"] or 0),
                                   "total_member_count": int(r["total_member_count"] or 0)}
            for r in rows}
