"""One-time migration: split legacy collapsed leaf tags by their parent co-tag.

When a leaf name repeats under different parents (e.g. petrol/service under
2-Wheeler vs 4-wheeler, or "other" under Shopping vs lunch-dinner), the legacy
flat tag was rebound by sync onto a single node, collapsing transactions that
actually belong to different parents.

For every such colliding leaf, this reassigns each transaction to the node whose
PARENT tag is co-applied on that transaction. Transactions with no single parent
match are left untouched (genuinely ambiguous). Idempotent.
"""
from sqlalchemy import text
from collections import defaultdict

from core.database import SessionLocal
from repositories.category_repo import (
    ensure_category_tables,
    ensure_tag_tables,
    sync_category_tags,
)


def main():
    db = SessionLocal()
    try:
        ensure_category_tables(db)
        ensure_tag_tables(db)
        sync_category_tags(db)

        # Colliding leaves: same normalized name bound to >1 active subcategory node.
        variants = db.execute(text("""
            SELECT lower(st.normalized) AS leaf, st.id AS tag_id, st.parent_id, p.name AS parent_name
            FROM public.system_tags st
            JOIN public.system_tags p ON p.id = st.parent_id
            WHERE st.is_active = TRUE AND st.subcategory_id IS NOT NULL
              AND lower(st.normalized) IN (
                  SELECT lower(normalized) FROM public.system_tags
                  WHERE is_active = TRUE AND subcategory_id IS NOT NULL
                  GROUP BY lower(normalized) HAVING COUNT(*) > 1
              )
            ORDER BY leaf
        """)).mappings().all()

        by_leaf = defaultdict(list)
        for v in variants:
            by_leaf[v["leaf"]].append(v)

        for leaf, vs in by_leaf.items():
            tag_ids = [v["tag_id"] for v in vs]
            txns = db.execute(
                text("SELECT DISTINCT transaction_id FROM public.transaction_tags WHERE tag_id = ANY(:ids)"),
                {"ids": tag_ids},
            ).scalars().all()

            moved = 0
            ambiguous = 0
            for tid in txns:
                # Which variant(s) have their parent tag co-applied on this txn?
                matched = [
                    v["tag_id"] for v in vs
                    if db.execute(
                        text("SELECT 1 FROM public.transaction_tags WHERE transaction_id = :t AND tag_id = :p"),
                        {"t": tid, "p": v["parent_id"]},
                    ).first()
                ]
                if len(set(matched)) != 1:
                    ambiguous += 1
                    continue
                target = matched[0]
                others = [t for t in tag_ids if t != target]
                db.execute(
                    text("""
                        INSERT INTO public.transaction_tags (transaction_id, tag_id, applied_by, applied_at)
                        VALUES (:t, :target, 'USER', NOW())
                        ON CONFLICT (transaction_id, tag_id) DO NOTHING
                    """),
                    {"t": tid, "target": target},
                )
                db.execute(
                    text("DELETE FROM public.transaction_tags WHERE transaction_id = :t AND tag_id = ANY(:others)"),
                    {"t": tid, "others": others},
                )
                moved += 1
            db.commit()
            label = " / ".join(f"{v['parent_name']}={v['tag_id']}" for v in vs)
            print(f"[{leaf}] variants: {label} | reassigned={moved} ambiguous(left as-is)={ambiguous}")

            for v in vs:
                cnt = db.execute(
                    text("SELECT COUNT(*) FROM public.transaction_tags WHERE tag_id = :t"),
                    {"t": v["tag_id"]},
                ).scalar()
                print(f"    {leaf} ({v['parent_name']}) tag {v['tag_id']}: {cnt} txns")
        print("done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
