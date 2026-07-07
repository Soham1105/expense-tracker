import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from sqlalchemy import text
from core.database import SessionLocal

db = SessionLocal()

def show(title, rows):
    print(f"\n=== {title} ===")
    for r in rows:
        print(dict(r))

# system_tags column list
cols = db.execute(text("""
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='system_tags' ORDER BY ordinal_position
""")).mappings().all()
show("system_tags columns", cols)

# counts
counts = db.execute(text("""
    SELECT tag_type, COUNT(*) AS n,
           COUNT(*) FILTER (WHERE parent_id IS NOT NULL) AS with_parent
    FROM public.system_tags GROUP BY tag_type ORDER BY n DESC
""")).mappings().all()
show("system_tags by type", counts)

# subcategories that share a name across different parents (the petrol case)
dup = db.execute(text("""
    SELECT lower(name) AS lname, COUNT(*) AS occurrences,
           COUNT(DISTINCT COALESCE(parent_subcategory_id::text, category_id::text)) AS distinct_parents
    FROM public.subcategories WHERE is_active = TRUE
    GROUP BY lower(name) HAVING COUNT(*) > 1
    ORDER BY occurrences DESC
""")).mappings().all()
show("duplicate-named subcategories", dup)

# detail for those dup names: show full path
dup_detail = db.execute(text("""
    WITH RECURSIVE p AS (
        SELECT s.id, s.name, s.category_id, s.parent_subcategory_id, s.name::text AS path
        FROM public.subcategories s WHERE s.parent_subcategory_id IS NULL AND s.is_active
        UNION ALL
        SELECT c.id, c.name, c.category_id, c.parent_subcategory_id, p.path || ' > ' || c.name
        FROM public.subcategories c JOIN p ON c.parent_subcategory_id = p.id WHERE c.is_active
    )
    SELECT cat.name AS category, p.path AS subpath, p.id::text AS subcategory_id
    FROM p JOIN public.categories cat ON cat.id = p.category_id
    WHERE lower(p.name) IN (SELECT lower(name) FROM public.subcategories WHERE is_active GROUP BY lower(name) HAVING COUNT(*)>1)
    ORDER BY lower(p.name), category
""")).mappings().all()
show("duplicate-named subcategory paths", dup_detail)

# how many transaction_tags point at subcategory-named tags
tt_total = db.execute(text("SELECT COUNT(*) AS n FROM public.transaction_tags")).scalar()
print(f"\ntransaction_tags total rows: {tt_total}")

db.close()
