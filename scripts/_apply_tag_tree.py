import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from sqlalchemy import text
from core.database import SessionLocal
from repositories.category_repo import ensure_category_tables, ensure_tag_tables, sync_category_tags

db = SessionLocal()

# 1. One-time backups (idempotent: keep first snapshot only)
for tbl in ("system_tags", "transaction_tags"):
    exists = db.execute(text(
        "SELECT to_regclass(:n)"), {"n": f"public.{tbl}_bak_tagfix"}).scalar()
    if exists is None:
        db.execute(text(f"CREATE TABLE public.{tbl}_bak_tagfix AS TABLE public.{tbl}"))
        print(f"backed up {tbl} -> {tbl}_bak_tagfix")
    else:
        print(f"backup {tbl}_bak_tagfix already exists (left as-is)")
db.commit()

# 2. Structural setup
ensure_category_tables(db)
ensure_tag_tables(db)
sync_category_tags(db)
print("structural setup complete")

# 3. Verify the duplicate-leaf cases now resolve to distinct, parent-aware tags
rows = db.execute(text("""
    SELECT st.id, st.name, st.parent_id, p.name AS parent_name,
           st.subcategory_id::text AS subcategory_id, st.category_id::text AS category_id,
           st.tag_type, st.is_active
    FROM public.system_tags st
    LEFT JOIN public.system_tags p ON p.id = st.parent_id
    WHERE lower(st.name) IN ('petrol','service','other')
    ORDER BY lower(st.name), st.parent_id NULLS FIRST
""")).mappings().all()
print("\n=== petrol / service / other tags ===")
for r in rows:
    print(dict(r))

# 4. Confirm composite uniqueness index is in place, old one gone
idx = db.execute(text("""
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='system_tags'
    ORDER BY indexname
""")).scalars().all()
print("\nsystem_tags indexes:", idx)

# 5. Sanity: every active subcategory node has exactly one bound tag
unbound = db.execute(text("""
    SELECT COUNT(*) FROM public.subcategories s
    WHERE s.is_active = TRUE
      AND NOT EXISTS (SELECT 1 FROM public.system_tags st WHERE st.subcategory_id = s.id)
""")).scalar()
print("active subcategories without a bound tag:", unbound)

db.close()
