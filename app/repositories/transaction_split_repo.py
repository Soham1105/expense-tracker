from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import text, bindparam
from sqlalchemy.orm import Session


CREATE_SPLIT_TRANSACTIONS_TABLE_SQL = text(
    """
    CREATE TABLE IF NOT EXISTS public.transaction_splits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL UNIQUE,
        vendor_name TEXT,
        notes TEXT,
        split_mode VARCHAR(20),
        total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_transaction_splits_transaction
            FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE
    );
    """
)

CREATE_SPLIT_LINE_ITEMS_TABLE_SQL = text(
    """
    CREATE TABLE IF NOT EXISTS public.transaction_split_line_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        split_id UUID NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT,
        expense_for TEXT,
        amount NUMERIC(12, 2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_transaction_split_line_items_split
            FOREIGN KEY (split_id) REFERENCES public.transaction_splits(id) ON DELETE CASCADE
    );
    """
)

CREATE_SPLIT_RECOVERIES_TABLE_SQL = text(
    """
    CREATE TABLE IF NOT EXISTS public.transaction_split_recoveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        split_id UUID NOT NULL,
        split_line_item_id UUID,
        recovery_transaction_id UUID NOT NULL UNIQUE,
        recovery_type TEXT,
        amount NUMERIC(12, 2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_transaction_split_recoveries_split
            FOREIGN KEY (split_id) REFERENCES public.transaction_splits(id) ON DELETE CASCADE,
        CONSTRAINT fk_transaction_split_recoveries_line_item
            FOREIGN KEY (split_line_item_id) REFERENCES public.transaction_split_line_items(id) ON DELETE SET NULL,
        CONSTRAINT fk_transaction_split_recoveries_transaction
            FOREIGN KEY (recovery_transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE
    );
    """
)


def ensure_split_tables(db: Session):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto;"))
    db.execute(CREATE_SPLIT_TRANSACTIONS_TABLE_SQL)
    db.execute(CREATE_SPLIT_LINE_ITEMS_TABLE_SQL)
    db.execute(CREATE_SPLIT_RECOVERIES_TABLE_SQL)
    db.execute(
        text(
            "ALTER TABLE public.transaction_split_line_items "
            "ADD COLUMN IF NOT EXISTS expense_for TEXT"
        )
    )
    db.execute(
        text(
            "ALTER TABLE public.transaction_split_line_items "
            "ADD COLUMN IF NOT EXISTS category_id UUID, "
            "ADD COLUMN IF NOT EXISTS subcategory_id UUID, "
            "ADD COLUMN IF NOT EXISTS line_kind TEXT, "
            "ADD COLUMN IF NOT EXISTS owner_type TEXT"
        )
    )
    db.execute(
        text(
            "ALTER TABLE public.transaction_split_line_items "
            "ADD COLUMN IF NOT EXISTS primary_flow_type TEXT"
        )
    )
    # Backfill: copy parent transaction tags to existing recovery transactions that missed them
    db.execute(text("""
        INSERT INTO public.transaction_tags (transaction_id, tag_id, applied_by, applied_at)
        SELECT r.recovery_transaction_id, tt.tag_id, 'USER', to_char(NOW(), 'YYYY-MM-DD')
        FROM public.transaction_split_recoveries r
        JOIN public.transaction_splits s ON s.id = r.split_id
        JOIN public.transaction_tags tt ON tt.transaction_id = s.transaction_id
        WHERE NOT EXISTS (
            SELECT 1 FROM public.transaction_tags ex
            WHERE ex.transaction_id = r.recovery_transaction_id
              AND ex.tag_id = tt.tag_id
        )
    """))
    db.commit()


def quantize_amount(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def save_transaction_split(
    transaction_id,
    vendor_name,
    notes,
    split_mode,
    total_amount,
    line_items,
    db: Session,
):
    normalized_total_amount = quantize_amount(total_amount)
    upsert_split_sql = text(
        """
        INSERT INTO public.transaction_splits (
            transaction_id,
            vendor_name,
            notes,
            split_mode,
            total_amount
        )
        VALUES (
            :transaction_id,
            :vendor_name,
            :notes,
            :split_mode,
            :total_amount
        )
        ON CONFLICT (transaction_id)
        DO UPDATE SET
            vendor_name = EXCLUDED.vendor_name,
            notes = EXCLUDED.notes,
            split_mode = EXCLUDED.split_mode,
            total_amount = EXCLUDED.total_amount,
            updated_at = NOW()
        RETURNING id;
        """
    )

    split_id = db.execute(
      upsert_split_sql,
      {
              "transaction_id": transaction_id,
              "vendor_name": vendor_name,
              "notes": notes,
              "split_mode": split_mode,
          "total_amount": normalized_total_amount,
      },
    ).scalar_one()

    persisted_line_items = []
    incoming_ids = [
        str(item.id)
        for item in line_items
        if getattr(item, "id", None)
    ]

    if incoming_ids:
        db.execute(
            text(
                """
                DELETE FROM public.transaction_split_line_items
                WHERE split_id = :split_id
                  AND id::text NOT IN :incoming_ids
                """
            ).bindparams(bindparam("incoming_ids", expanding=True)),
            {"split_id": split_id, "incoming_ids": incoming_ids},
        )
    else:
        db.execute(
            text("DELETE FROM public.transaction_split_line_items WHERE split_id = :split_id"),
            {"split_id": split_id},
        )

    update_line_item_sql = text(
        """
        UPDATE public.transaction_split_line_items
        SET
            item_name = :item_name,
            category = :category,
            category_id = :category_id,
            subcategory_id = :subcategory_id,
            line_kind = :line_kind,
            owner_type = :owner_type,
            expense_for = :expense_for,
            amount = :amount,
            primary_flow_type = :primary_flow_type
        WHERE split_id = :split_id
          AND id = :line_item_id
        RETURNING id, item_name, category, category_id, subcategory_id, line_kind, owner_type, expense_for, amount, primary_flow_type
        """
    )

    insert_line_item_sql = text(
        """
        INSERT INTO public.transaction_split_line_items (
            split_id,
            item_name,
            category,
            category_id,
            subcategory_id,
            line_kind,
            owner_type,
            expense_for,
            amount,
            primary_flow_type
        )
        VALUES (
            :split_id,
            :item_name,
            :category,
            :category_id,
            :subcategory_id,
            :line_kind,
            :owner_type,
            :expense_for,
            :amount,
            :primary_flow_type
        )
        RETURNING id, item_name, category, category_id, subcategory_id, line_kind, owner_type, expense_for, amount, primary_flow_type
        """
    )

    for item in line_items:
        payload = {
            "split_id": split_id,
            "item_name": item.item_name,
            "category": item.category,
            "category_id": getattr(item, "category_id", None),
            "subcategory_id": getattr(item, "subcategory_id", None),
            "line_kind": getattr(item, "line_kind", None),
            "owner_type": getattr(item, "owner_type", None),
            "expense_for": item.expense_for if hasattr(item, "expense_for") and item.expense_for is not None else item.assignee,
            "amount": quantize_amount(item.amount),
            "primary_flow_type": getattr(item, "primary_flow_type", None),
        }
        row = None
        if getattr(item, "id", None):
            row = db.execute(
                update_line_item_sql,
                {
                    **payload,
                    "line_item_id": str(item.id),
                },
            ).mappings().first()
        if not row:
            row = db.execute(insert_line_item_sql, payload).mappings().first()
        persisted_line_items.append(row)

    db.commit()

    return {
        "split_id": split_id,
        "line_items": persisted_line_items,
    }


def get_split_id_by_transaction(transaction_id, db: Session):
    return db.execute(
        text("SELECT id FROM public.transaction_splits WHERE transaction_id = :transaction_id"),
        {"transaction_id": transaction_id},
    ).scalar_one_or_none()


def get_split_line_item(split_line_item_id, split_id, db: Session):
    return db.execute(
        text(
            """
            SELECT id, amount
            FROM public.transaction_split_line_items
            WHERE id = :split_line_item_id
              AND split_id = :split_id
            """
        ),
        {"split_line_item_id": split_line_item_id, "split_id": split_id},
    ).mappings().first()


def get_split_with_line_items(transaction_id, db: Session):
    split = db.execute(
        text(
            """
            SELECT id, transaction_id, vendor_name, notes, split_mode, total_amount
            FROM public.transaction_splits
            WHERE transaction_id = :transaction_id
            """
        ),
        {"transaction_id": transaction_id},
    ).mappings().first()

    if not split:
        return None

    line_items = db.execute(
        text(
            """
            SELECT id, item_name, category, category_id, subcategory_id, line_kind, owner_type, expense_for, amount
            FROM public.transaction_split_line_items
            WHERE split_id = :split_id
            ORDER BY created_at, id
            """
        ),
        {"split_id": split["id"]},
    ).mappings().all()

    recoveries = db.execute(
        text(
            """
            SELECT
                r.id,
                r.split_line_item_id,
                r.recovery_transaction_id,
                r.recovery_type,
                r.amount,
                r.notes,
                t.transaction_date,
                t.counterparty_identifier,
                t.vendor_name
            FROM public.transaction_split_recoveries r
            JOIN public.transactions t ON t.id = r.recovery_transaction_id
            WHERE r.split_id = :split_id
            ORDER BY r.created_at DESC, r.id DESC
            """
        ),
        {"split_id": split["id"]},
    ).mappings().all()

    return {
        "split": split,
        "line_items": line_items,
        "recoveries": recoveries,
    }


def delete_transaction_split(transaction_id, db: Session):
    split = db.execute(
        text(
            """
            SELECT id
            FROM public.transaction_splits
            WHERE transaction_id = :transaction_id
            """
        ),
        {"transaction_id": transaction_id},
    ).mappings().first()
    if not split:
        return None

    db.execute(
        text(
            """
            DELETE FROM public.transaction_splits
            WHERE id = :split_id
            """
        ),
        {"split_id": split["id"]},
    )
    db.commit()
    return split["id"]




def get_total_recovery_amount(split_id, split_line_item_id, db: Session):
    return db.execute(
        text(
            """
            SELECT COALESCE(SUM(amount), 0)
            FROM public.transaction_split_recoveries
            WHERE split_id = :split_id
              AND (
                (:split_line_item_id IS NULL AND split_line_item_id IS NULL)
                OR split_line_item_id = :split_line_item_id
              )
            """
        ),
        {"split_id": split_id, "split_line_item_id": split_line_item_id},
    ).scalar_one()


def get_existing_recovery_amount(recovery_transaction_id: str, db: Session):
    return db.execute(
        text("""
            SELECT COALESCE(amount, 0)
            FROM public.transaction_split_recoveries
            WHERE recovery_transaction_id = :rtid
            LIMIT 1
        """),
        {"rtid": recovery_transaction_id},
    ).scalar_one_or_none() or 0


def save_split_recovery_link(
    split_id,
    split_line_item_id,
    recovery_transaction_id,
    recovery_type,
    amount,
    notes,
    db: Session,
):
    recovery_id = db.execute(
        text(
            """
            INSERT INTO public.transaction_split_recoveries (
                split_id,
                split_line_item_id,
                recovery_transaction_id,
                recovery_type,
                amount,
                notes
            )
            VALUES (
                :split_id,
                :split_line_item_id,
                :recovery_transaction_id,
                :recovery_type,
                :amount,
                :notes
            )
            ON CONFLICT (recovery_transaction_id)
            DO UPDATE SET
                split_id = EXCLUDED.split_id,
                split_line_item_id = EXCLUDED.split_line_item_id,
                recovery_type = EXCLUDED.recovery_type,
                amount = EXCLUDED.amount,
                notes = EXCLUDED.notes
            RETURNING id
            """
        ),
        {
            "split_id": split_id,
            "split_line_item_id": split_line_item_id,
            "recovery_transaction_id": recovery_transaction_id,
            "recovery_type": recovery_type,
            "amount": quantize_amount(amount),
            "notes": notes,
        },
    ).scalar_one()
    db.commit()

    # Auto-inherit tags from the parent transaction so the recovery shows
    # under the same categories (e.g. Gold-Silver recovery gets the Gold-Silver tag)
    parent_txn_id = db.execute(
        text("SELECT transaction_id FROM public.transaction_splits WHERE id = :sid"),
        {"sid": split_id},
    ).scalar_one_or_none()

    if parent_txn_id:
        db.execute(
            text("""
                INSERT INTO public.transaction_tags (transaction_id, tag_id, applied_by, applied_at)
                SELECT CAST(:rtid AS uuid), tt.tag_id, 'USER', NOW()
                FROM public.transaction_tags tt
                WHERE tt.transaction_id = :ptid
                ON CONFLICT (transaction_id, tag_id) DO NOTHING
            """),
            {"rtid": recovery_transaction_id, "ptid": str(parent_txn_id)},
        )
        db.execute(
            text("""
                UPDATE public.transactions
                SET review_status_manual = TRUE,
                    review_status = COALESCE(NULLIF(review_status, ''), 'confirmed')
                WHERE id = CAST(:id AS uuid)
            """),
            {"id": recovery_transaction_id},
        )
        db.commit()

    return recovery_id


def delete_split_recovery_link(recovery_id, db: Session):
    deleted_row = db.execute(
        text(
            """
            DELETE FROM public.transaction_split_recoveries
            WHERE id = :recovery_id
            RETURNING id, split_id, recovery_transaction_id
            """
        ),
        {"recovery_id": recovery_id},
    ).mappings().first()
    db.commit()
    return deleted_row

