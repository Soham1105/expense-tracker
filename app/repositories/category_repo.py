from sqlalchemy import text
from sqlalchemy.orm import Session

from repositories.tag_display import dup_join, label_expr


def ensure_category_tables(db: Session):
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.categories (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.subcategories (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                category_id UUID NOT NULL,
                parent_subcategory_id UUID,
                name TEXT NOT NULL,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_subcategories_category
                    FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE,
                CONSTRAINT fk_subcategories_parent
                    FOREIGN KEY (parent_subcategory_id) REFERENCES public.subcategories(id) ON DELETE CASCADE,
                CONSTRAINT uq_subcategories_category_name UNIQUE (category_id, name)
            );
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE public.subcategories
            ADD COLUMN IF NOT EXISTS parent_subcategory_id UUID
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE public.subcategories
            DROP CONSTRAINT IF EXISTS uq_subcategories_category_name
            """
        )
    )
    db.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategories_parent_name
            ON public.subcategories (
                category_id,
                COALESCE(parent_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
                lower(name)
            )
            """
        )
    )
    # Fix transaction_tags columns that were created with wrong types
    db.execute(text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name   = 'transaction_tags'
                  AND column_name  = 'applied_by'
                  AND data_type    = 'character varying'
            ) THEN
                ALTER TABLE public.transaction_tags
                    ALTER COLUMN applied_by TYPE TEXT;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name   = 'transaction_tags'
                  AND column_name  = 'applied_at'
                  AND data_type    = 'character varying'
            ) THEN
                ALTER TABLE public.transaction_tags
                    ALTER COLUMN applied_at TYPE TIMESTAMP USING
                        CASE WHEN applied_at ~ '^\d{4}-\d{2}-\d{2}'
                             THEN applied_at::timestamp
                             ELSE NOW()
                        END;
            END IF;
        END
        $$;
    """))
    db.commit()


def ensure_tag_tables(db: Session):
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.system_tags (
                id BIGSERIAL PRIMARY KEY,
                tag_type TEXT NOT NULL DEFAULT 'USER',
                name TEXT NOT NULL,
                normalized TEXT NOT NULL,
                parent_id BIGINT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            );
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
    # Bind a tag to the exact node it represents so same-named leaves under different
    # parents (e.g. "petrol" under 2-Wheeler vs 4-Wheeler) are distinct tags.
    db.execute(text("ALTER TABLE public.system_tags ADD COLUMN IF NOT EXISTS subcategory_id UUID"))
    db.execute(text("ALTER TABLE public.system_tags ADD COLUMN IF NOT EXISTS category_id UUID"))
    db.execute(
        text(
            """
            UPDATE public.system_tags
            SET
                normalized = COALESCE(NULLIF(BTRIM(normalized), ''), lower(BTRIM(name))),
                tag_type = COALESCE(NULLIF(BTRIM(tag_type), ''), 'USER')
            """
        )
    )
    # Deduplicate ONLY unbound legacy flat tags (one row per normalized). Node-bound tags
    # (subcategory_id / category_id set) are intentionally allowed to share a normalized
    # name across different parents, so they are excluded from this collapse.
    db.execute(
        text(
            """
            WITH ranked_tags AS (
                SELECT
                    id,
                    FIRST_VALUE(id) OVER (
                        PARTITION BY normalized
                        ORDER BY COALESCE(managed_by_schema, FALSE) DESC,
                                 COALESCE(is_active, TRUE) DESC, id ASC
                    ) AS keep_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY normalized
                        ORDER BY COALESCE(managed_by_schema, FALSE) DESC,
                                 COALESCE(is_active, TRUE) DESC, id ASC
                    ) AS rn
                FROM public.system_tags
                WHERE subcategory_id IS NULL AND category_id IS NULL
                  AND COALESCE(NULLIF(BTRIM(name), ''), '') <> ''
            )
            INSERT INTO public.transaction_tags (transaction_id, tag_id)
            SELECT DISTINCT tt.transaction_id, ranked_tags.keep_id
            FROM public.transaction_tags tt
            JOIN ranked_tags ON ranked_tags.id = tt.tag_id
            WHERE ranked_tags.rn > 1 AND ranked_tags.keep_id <> ranked_tags.id
            ON CONFLICT (transaction_id, tag_id) DO NOTHING
            """
        )
    )
    db.execute(
        text(
            """
            WITH ranked_tags AS (
                SELECT id,
                    ROW_NUMBER() OVER (
                        PARTITION BY normalized
                        ORDER BY COALESCE(managed_by_schema, FALSE) DESC,
                                 COALESCE(is_active, TRUE) DESC, id ASC
                    ) AS rn
                FROM public.system_tags
                WHERE subcategory_id IS NULL AND category_id IS NULL
                  AND COALESCE(NULLIF(BTRIM(name), ''), '') <> ''
            )
            DELETE FROM public.transaction_tags
            WHERE tag_id IN (SELECT id FROM ranked_tags WHERE rn > 1)
            """
        )
    )
    db.execute(
        text(
            """
            WITH ranked_tags AS (
                SELECT id,
                    ROW_NUMBER() OVER (
                        PARTITION BY normalized
                        ORDER BY COALESCE(managed_by_schema, FALSE) DESC,
                                 COALESCE(is_active, TRUE) DESC, id ASC
                    ) AS rn
                FROM public.system_tags
                WHERE subcategory_id IS NULL AND category_id IS NULL
                  AND COALESCE(NULLIF(BTRIM(name), ''), '') <> ''
            )
            DELETE FROM public.system_tags
            WHERE id IN (SELECT id FROM ranked_tags WHERE rn > 1)
            """
        )
    )
    # Replace the global unique-on-normalized indexes/constraints with a per-parent one
    # so a leaf name may repeat under different parents while top-level tags stay
    # globally unique. These legacy uniques exist in some DBs as a CONSTRAINT and in
    # others as an INDEX, so drop both forms defensively.
    db.execute(text("DROP INDEX IF EXISTS public.uq_system_tags_normalized"))
    db.execute(text("ALTER TABLE public.system_tags DROP CONSTRAINT IF EXISTS uq_system_tags_normalized"))
    db.execute(text("DROP INDEX IF EXISTS public.uq_system_tags_type_normalized"))
    db.execute(text("ALTER TABLE public.system_tags DROP CONSTRAINT IF EXISTS uq_system_tags_type_normalized"))
    db.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_system_tags_parent_normalized
            ON public.system_tags (COALESCE(parent_id, 0), normalized)
            """
        )
    )
    db.commit()


def sync_category_tags(db: Session):
    """Mirror the categories/subcategories tree into system_tags.

    Each category becomes a CATEGORY tag (category_id bound, parent_id NULL); each
    subcategory node becomes a SUBCATEGORY tag (subcategory_id bound, parent_id = the
    parent node's tag). Same-named leaves under different parents therefore become
    distinct tag rows. Idempotent: rebinds by node id on every run.
    """
    categories = db.execute(
        text("SELECT id::text AS id, name FROM public.categories WHERE is_active = TRUE")
    ).mappings().all()

    cat_tag_id = {}
    for cat in categories:
        norm = cat["name"].strip().lower()
        bound = db.execute(
            text(
                "SELECT id FROM public.system_tags "
                "WHERE category_id = CAST(:cid AS uuid) AND subcategory_id IS NULL LIMIT 1"
            ),
            {"cid": cat["id"]},
        ).mappings().first()
        if not bound:
            bound = db.execute(
                text(
                    """
                    SELECT id FROM public.system_tags
                    WHERE normalized = :norm AND parent_id IS NULL
                      AND subcategory_id IS NULL AND category_id IS NULL
                    ORDER BY id ASC LIMIT 1
                    """
                ),
                {"norm": norm},
            ).mappings().first()
        if bound:
            db.execute(
                text(
                    """
                    UPDATE public.system_tags
                    SET name = :name, normalized = :norm, tag_type = 'CATEGORY',
                        parent_id = NULL, category_id = CAST(:cid AS uuid),
                        subcategory_id = NULL, is_active = TRUE, managed_by_schema = TRUE
                    WHERE id = :id
                    """
                ),
                {"name": cat["name"].strip(), "norm": norm, "cid": cat["id"], "id": bound["id"]},
            )
            cat_tag_id[cat["id"]] = bound["id"]
        else:
            cat_tag_id[cat["id"]] = db.execute(
                text(
                    """
                    INSERT INTO public.system_tags
                        (name, normalized, tag_type, parent_id, category_id, is_active, managed_by_schema)
                    VALUES (:name, :norm, 'CATEGORY', NULL, CAST(:cid AS uuid), TRUE, TRUE)
                    RETURNING id
                    """
                ),
                {"name": cat["name"].strip(), "norm": norm, "cid": cat["id"]},
            ).scalar()

    subs = db.execute(
        text(
            """
            SELECT id::text AS id, category_id::text AS category_id,
                   parent_subcategory_id::text AS parent_subcategory_id, name
            FROM public.subcategories WHERE is_active = TRUE
            """
        )
    ).mappings().all()

    sub_tag_id = {}
    pending = list(subs)
    progressed = True
    while pending and progressed:
        progressed = False
        deferred = []
        for sub in pending:
            parent_sub_id = sub["parent_subcategory_id"]
            if parent_sub_id is None:
                parent_tag = cat_tag_id.get(sub["category_id"])
            else:
                parent_tag = sub_tag_id.get(parent_sub_id)
                if parent_tag is None:
                    deferred.append(sub)
                    continue
            if parent_tag is None:
                # Orphan: category inactive/missing. Skip; nothing to bind under.
                continue
            norm = sub["name"].strip().lower()
            bound = db.execute(
                text("SELECT id FROM public.system_tags WHERE subcategory_id = CAST(:sid AS uuid) LIMIT 1"),
                {"sid": sub["id"]},
            ).mappings().first()
            if not bound:
                bound = db.execute(
                    text(
                        """
                        SELECT id FROM public.system_tags
                        WHERE normalized = :norm AND subcategory_id IS NULL AND category_id IS NULL
                          AND tag_type ILIKE 'SUBCATEGORY'
                          AND (parent_id IS NULL OR parent_id = :ptag)
                        ORDER BY (parent_id = :ptag) DESC, id ASC LIMIT 1
                        """
                    ),
                    {"norm": norm, "ptag": parent_tag},
                ).mappings().first()
            if bound:
                db.execute(
                    text(
                        """
                        UPDATE public.system_tags
                        SET name = :name, normalized = :norm, tag_type = 'SUBCATEGORY',
                            parent_id = :ptag, subcategory_id = CAST(:sid AS uuid),
                            category_id = NULL, is_active = TRUE, managed_by_schema = TRUE
                        WHERE id = :id
                        """
                    ),
                    {"name": sub["name"].strip(), "norm": norm, "ptag": parent_tag, "sid": sub["id"], "id": bound["id"]},
                )
                sub_tag_id[sub["id"]] = bound["id"]
            else:
                sub_tag_id[sub["id"]] = db.execute(
                    text(
                        """
                        INSERT INTO public.system_tags
                            (name, normalized, tag_type, parent_id, subcategory_id, is_active, managed_by_schema)
                        VALUES (:name, :norm, 'SUBCATEGORY', :ptag, CAST(:sid AS uuid), TRUE, TRUE)
                        RETURNING id
                        """
                    ),
                    {"name": sub["name"].strip(), "norm": norm, "ptag": parent_tag, "sid": sub["id"]},
                ).scalar()
            progressed = True
        pending = deferred

    db.commit()


def _build_subcategory_tree(subcategories):
    by_id = {}
    for subcategory in subcategories:
        node = {
            **dict(subcategory),
            "children": [],
        }
        by_id[node["id"]] = node

    root_nodes = []
    for node in by_id.values():
        parent_id = node.get("parent_subcategory_id")
        if parent_id and parent_id in by_id:
            by_id[parent_id]["children"].append(node)
        else:
            root_nodes.append(node)

    for node in by_id.values():
        node["children"] = sorted(node["children"], key=lambda child: child["name"].lower())
    return sorted(root_nodes, key=lambda child: child["name"].lower())


def list_category_tree(db: Session):
    # Idempotent migrations for color columns
    db.execute(text("ALTER TABLE public.categories   ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#607AFB'"))
    db.execute(text("ALTER TABLE public.subcategories ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT NULL"))
    db.commit()

    categories = db.execute(
        text(
            """
            SELECT c.id::text AS id, c.name, c.description, c.is_active,
                   COALESCE(c.color, '#607AFB') AS color,
                   COALESCE(
                       (SELECT COUNT(DISTINCT tt.transaction_id)
                        FROM public.system_tags st
                        JOIN public.transaction_tags tt ON tt.tag_id = st.id
                        WHERE st.category_id = c.id AND st.is_active = TRUE),
                       0
                   ) AS transaction_count
            FROM public.categories c
            WHERE c.is_active = TRUE
            ORDER BY c.name ASC
            """
        )
    ).mappings().all()
    subcategories = db.execute(
        text(
            """
            SELECT
                s.id::text AS id,
                s.category_id::text AS category_id,
                s.parent_subcategory_id::text AS parent_subcategory_id,
                s.name,
                s.description,
                s.is_active,
                s.color,
                COALESCE(
                    (SELECT COUNT(DISTINCT tt.transaction_id)
                     FROM public.system_tags st
                     JOIN public.transaction_tags tt ON tt.tag_id = st.id
                     WHERE st.subcategory_id = s.id AND st.is_active = TRUE),
                    0
                ) AS transaction_count
            FROM public.subcategories s
            WHERE s.is_active = TRUE
            ORDER BY s.name ASC
            """
        )
    ).mappings().all()

    sub_by_category = {}
    for sub in subcategories:
        sub_by_category.setdefault(sub["category_id"], []).append(dict(sub))

    return [
        {
            **dict(category),
            "subcategories": _build_subcategory_tree(sub_by_category.get(category["id"], [])),
        }
        for category in categories
    ]


def get_category_details(category_id: str, db: Session):

    row = db.execute(
        text(
            """
            SELECT id::text AS category_id, name AS category_name, description
            FROM public.categories
            WHERE id = :category_id
              AND is_active = TRUE
            """
        ),
        {"category_id": category_id},
    ).mappings().first()
    return dict(row) if row else None


def _to_title_case(name: str) -> str:
    """Normalize category/subcategory names to Title Case for visual consistency."""
    return " ".join(word.capitalize() for word in name.strip().split())


def create_category(name: str, description: str | None, db: Session, color: str | None = None):

    created = db.execute(
        text(
            """
            INSERT INTO public.categories (name, description, color)
            VALUES (:name, :description, :color)
            ON CONFLICT (name)
            DO UPDATE SET
                description = COALESCE(EXCLUDED.description, public.categories.description),
                color = COALESCE(EXCLUDED.color, public.categories.color),
                is_active = TRUE
            RETURNING id::text AS id, name, description, is_active,
                      COALESCE(color, '#607AFB') AS color
            """
        ),
        {"name": _to_title_case(name), "description": (description or "").strip() or None,
         "color": (color or "").strip() or "#607AFB"},
    ).mappings().first()
    db.commit()
    sync_category_tags(db)
    return dict(created)


def create_subcategory(category_id: str, name: str, description: str | None, db: Session, parent_subcategory_id: str | None = None, color: str | None = None):

    clean_name = _to_title_case(name)
    clean_description = (description or "").strip() or None

    category_exists = db.execute(
        text(
            """
            SELECT 1
            FROM public.categories
            WHERE id = :category_id
              AND is_active = TRUE
            """
        ),
        {"category_id": category_id},
    ).scalar()
    if not category_exists:
        raise ValueError("Selected category was not found.")

    if parent_subcategory_id:
        parent = db.execute(
            text(
                """
                SELECT id::text AS id, category_id::text AS category_id
                FROM public.subcategories
                WHERE id = :parent_subcategory_id
                  AND is_active = TRUE
                """
            ),
            {"parent_subcategory_id": parent_subcategory_id},
        ).mappings().first()
        if not parent:
            raise ValueError("Selected parent subcategory was not found.")
        if str(parent["category_id"]) != str(category_id):
            raise ValueError("Parent subcategory must stay under the same category.")

    existing = db.execute(
        text(
            """
            SELECT
                id::text AS id,
                category_id::text AS category_id,
                parent_subcategory_id::text AS parent_subcategory_id,
                name,
                description,
                is_active
            FROM public.subcategories
            WHERE category_id = :category_id
              AND COALESCE(parent_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  = COALESCE(CAST(:parent_subcategory_id AS uuid), '00000000-0000-0000-0000-000000000000'::uuid)
              AND lower(name) = lower(:name)
            """
        ),
        {
            "category_id": category_id,
            "parent_subcategory_id": parent_subcategory_id,
            "name": clean_name,
        },
    ).mappings().first()

    if existing:
        created = db.execute(
            text(
                """
                UPDATE public.subcategories
                SET
                    description = COALESCE(:description, description),
                    is_active = TRUE
                WHERE id = :subcategory_id
                RETURNING
                    id::text AS id,
                    category_id::text AS category_id,
                    parent_subcategory_id::text AS parent_subcategory_id,
                    name,
                    description,
                    is_active
                """
            ),
            {
                "subcategory_id": existing["id"],
                "description": clean_description,
            },
        ).mappings().first()
    else:
        created = db.execute(
            text(
                """
                INSERT INTO public.subcategories (category_id, parent_subcategory_id, name, description, color)
                VALUES (:category_id, :parent_subcategory_id, :name, :description, :color)
                RETURNING
                    id::text AS id,
                    category_id::text AS category_id,
                    parent_subcategory_id::text AS parent_subcategory_id,
                    name,
                    description,
                    is_active,
                    color
                """
            ),
            {
                "category_id": category_id,
                "parent_subcategory_id": parent_subcategory_id,
                "name": clean_name,
                "description": clean_description,
                "color": (color or "").strip() or None,
            },
        ).mappings().first()
    db.commit()
    sync_category_tags(db)
    return dict(created)


def get_subcategory_details(subcategory_id: str, db: Session):

    return db.execute(
        text(
            """
            SELECT
                s.id::text AS subcategory_id,
                s.name AS subcategory_name,
                s.parent_subcategory_id::text AS parent_subcategory_id,
                c.id::text AS category_id,
                c.name AS category_name
            FROM public.subcategories s
            JOIN public.categories c
              ON c.id = s.category_id
            WHERE s.id = :subcategory_id
            """
        ),
        {"subcategory_id": subcategory_id},
    ).mappings().first()


def get_subcategory_path(subcategory_id: str, db: Session):

    rows = db.execute(
        text(
            """
            WITH RECURSIVE sub_path AS (
                SELECT
                    s.id::text AS id,
                    s.parent_subcategory_id::text AS parent_subcategory_id,
                    s.name,
                    0 AS depth
                FROM public.subcategories s
                WHERE s.id = :subcategory_id

                UNION ALL

                SELECT
                    parent.id::text AS id,
                    parent.parent_subcategory_id::text AS parent_subcategory_id,
                    parent.name,
                    sub_path.depth + 1 AS depth
                FROM public.subcategories parent
                JOIN sub_path
                  ON parent.id::text = sub_path.parent_subcategory_id
            )
            SELECT id, parent_subcategory_id, name, depth
            FROM sub_path
            ORDER BY depth DESC
            """
        ),
        {"subcategory_id": subcategory_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def list_system_tags(db: Session):
    ensure_tag_tables(db)
    # display_name is collision-aware: plain name when unique, "<name> (<parent>)"
    # when the same leaf name exists under multiple parents. The UI uses it as the
    # canonical tag token so the right node round-trips on tagging.
    rows = db.execute(
        text(
            f"""
            SELECT
                st.id,
                st.name,
                {label_expr("st", "st_")} AS display_name,
                st_p.name AS parent_name,
                st.normalized,
                st.tag_type,
                st.is_active,
                st.parent_id
            FROM public.system_tags st
            {dup_join("st", "st_")}
            WHERE st.is_active = TRUE
              AND st.managed_by_schema = TRUE
            ORDER BY st.name ASC
            """
        )
    ).mappings().all()
    return [dict(row) for row in rows]


def get_node_tag_label(db: Session, subcategory_id: str | None = None, category_id: str | None = None):
    """Collision-aware display token for the tag bound to a category/subcategory node.

    Lets classification apply the *exact* node tag (resolved from the node id the
    user picked) rather than a bare name that could match a same-named leaf under
    a different parent. Returns None if no bound tag exists.
    """
    if subcategory_id:
        row = db.execute(
            text(
                f"""
                SELECT {label_expr("st", "st_")} AS display_name
                FROM public.system_tags st
                {dup_join("st", "st_")}
                WHERE st.subcategory_id = CAST(:sid AS uuid) AND st.is_active = TRUE
                LIMIT 1
                """
            ),
            {"sid": subcategory_id},
        ).mappings().first()
    elif category_id:
        row = db.execute(
            text(
                f"""
                SELECT {label_expr("st", "st_")} AS display_name
                FROM public.system_tags st
                {dup_join("st", "st_")}
                WHERE st.category_id = CAST(:cid AS uuid) AND st.subcategory_id IS NULL
                  AND st.is_active = TRUE
                LIMIT 1
                """
            ),
            {"cid": category_id},
        ).mappings().first()
    else:
        return None
    return row["display_name"] if row else None


def create_system_tag(name: str, db: Session, tag_type: str = "USER"):
    ensure_tag_tables(db)
    normalized = name.strip().lower()
    created = db.execute(
        text(
            """
            INSERT INTO public.system_tags (name, normalized, tag_type, is_active, managed_by_schema)
            VALUES (:name, :normalized, :tag_type, TRUE, TRUE)
            ON CONFLICT (COALESCE(parent_id, 0), normalized)
            DO UPDATE SET
                name = EXCLUDED.name,
                tag_type = EXCLUDED.tag_type,
                is_active = TRUE,
                managed_by_schema = TRUE
            RETURNING id, name, normalized, tag_type, is_active, managed_by_schema
            """
        ),
        {"name": name.strip(), "normalized": normalized, "tag_type": tag_type},
    ).mappings().first()
    db.commit()
    return dict(created)


def _rename_system_tag(old_name: str, new_name: str, db: Session):
    old_normalized = old_name.strip().lower()
    new_normalized = new_name.strip().lower()
    existing = db.execute(
        text(
            """
            SELECT id
            FROM public.system_tags
            WHERE normalized = :new_normalized
              AND normalized <> :old_normalized
              AND COALESCE(is_active, TRUE) = TRUE
            """
        ),
        {"new_normalized": new_normalized, "old_normalized": old_normalized},
    ).mappings().first()
    if existing:
        raise ValueError("A tag with this name already exists.")

    db.execute(
        text(
            """
            UPDATE public.system_tags
            SET
                name = :new_name,
                normalized = :new_normalized,
                managed_by_schema = TRUE,
                is_active = TRUE
            WHERE normalized = :old_normalized
              AND COALESCE(managed_by_schema, FALSE) = TRUE
            """
        ),
        {
            "new_name": new_name.strip(),
            "new_normalized": new_normalized,
            "old_normalized": old_normalized,
        },
    )


def deactivate_category(category_id: str, db: Session):

    category = db.execute(
        text(
            """
            SELECT name
            FROM public.categories
            WHERE id = :category_id
            """
        ),
        {"category_id": category_id},
    ).mappings().first()
    if not category:
        raise ValueError("Category was not found.")

    db.execute(
        text(
            """
            UPDATE public.categories
            SET is_active = FALSE
            WHERE id = :category_id
            """
        ),
        {"category_id": category_id},
    )
    db.execute(
        text(
            """
            WITH RECURSIVE descendants AS (
                SELECT id
                FROM public.subcategories
                WHERE category_id = :category_id

                UNION ALL

                SELECT s.id
                FROM public.subcategories s
                JOIN descendants d
                  ON s.parent_subcategory_id = d.id
            )
            UPDATE public.subcategories
            SET is_active = FALSE
            WHERE id IN (SELECT id FROM descendants)
            """
        ),
        {"category_id": category_id},
    )
    # Deactivate the bound tags by node id (not by name) so same-named leaves under
    # other parents are left untouched.
    db.execute(
        text(
            """
            UPDATE public.system_tags
            SET is_active = FALSE
            WHERE category_id = CAST(:category_id AS uuid)
               OR subcategory_id IN (
                    WITH RECURSIVE descendants AS (
                        SELECT id FROM public.subcategories WHERE category_id = CAST(:category_id AS uuid)
                        UNION ALL
                        SELECT s.id FROM public.subcategories s
                        JOIN descendants d ON s.parent_subcategory_id = d.id
                    )
                    SELECT id FROM descendants
               )
            """
        ),
        {"category_id": category_id},
    )
    db.commit()


def deactivate_subcategory(subcategory_id: str, db: Session):

    names = db.execute(
        text(
            """
            WITH RECURSIVE descendants AS (
                SELECT id, name
                FROM public.subcategories
                WHERE id = :subcategory_id

                UNION ALL

                SELECT s.id, s.name
                FROM public.subcategories s
                JOIN descendants d
                  ON s.parent_subcategory_id = d.id
            )
            SELECT DISTINCT name
            FROM descendants
            """
        ),
        {"subcategory_id": subcategory_id},
    ).scalars().all()
    if not names:
        raise ValueError("Subcategory was not found.")

    db.execute(
        text(
            """
            WITH RECURSIVE descendants AS (
                SELECT id
                FROM public.subcategories
                WHERE id = :subcategory_id

                UNION ALL

                SELECT s.id
                FROM public.subcategories s
                JOIN descendants d
                  ON s.parent_subcategory_id = d.id
            )
            UPDATE public.subcategories
            SET is_active = FALSE
            WHERE id IN (SELECT id FROM descendants)
            """
        ),
        {"subcategory_id": subcategory_id},
    )
    db.execute(
        text(
            """
            UPDATE public.system_tags
            SET is_active = FALSE
            WHERE subcategory_id IN (
                WITH RECURSIVE descendants AS (
                    SELECT id FROM public.subcategories WHERE id = CAST(:subcategory_id AS uuid)
                    UNION ALL
                    SELECT s.id FROM public.subcategories s
                    JOIN descendants d ON s.parent_subcategory_id = d.id
                )
                SELECT id FROM descendants
            )
            """
        ),
        {"subcategory_id": subcategory_id},
    )
    db.commit()


def rename_category(category_id: str, name: str, description: str | None, db: Session, color: str | None = None):

    existing = db.execute(
        text(
            """
            SELECT id::text AS id, name
            FROM public.categories
            WHERE id = :category_id
              AND is_active = TRUE
            """
        ),
        {"category_id": category_id},
    ).mappings().first()
    if not existing:
        raise ValueError("Category was not found.")

    clean_name = _to_title_case(name)
    duplicate = db.execute(
        text(
            """
            SELECT 1
            FROM public.categories
            WHERE lower(name) = lower(:name)
              AND id <> :category_id
              AND is_active = TRUE
            """
        ),
        {"name": clean_name, "category_id": category_id},
    ).scalar()
    if duplicate:
        raise ValueError("A category with this name already exists.")

    updated = db.execute(
        text(
            """
            UPDATE public.categories
            SET
                name = :name,
                description = :description,
                color = CASE WHEN :color IS NOT NULL AND :color <> '' THEN :color
                             ELSE color END
            WHERE id = :category_id
            RETURNING id::text AS id, name, description, is_active,
                      COALESCE(color, '#607AFB') AS color
            """
        ),
        {
            "category_id": category_id,
            "name": clean_name,
            "description": (description or "").strip() or None,
            "color": (color or "").strip() or None,
        },
    ).mappings().first()
    db.commit()
    sync_category_tags(db)
    return dict(updated)


def rename_subcategory(subcategory_id: str, name: str, description: str | None, db: Session, color: str | None = None):

    existing = db.execute(
        text(
            """
            SELECT
                id::text AS id,
                category_id::text AS category_id,
                parent_subcategory_id::text AS parent_subcategory_id,
                name
            FROM public.subcategories
            WHERE id = :subcategory_id
              AND is_active = TRUE
            """
        ),
        {"subcategory_id": subcategory_id},
    ).mappings().first()
    if not existing:
        raise ValueError("Subcategory was not found.")

    clean_name = _to_title_case(name)
    duplicate = db.execute(
        text(
            """
            SELECT 1
            FROM public.subcategories
            WHERE category_id = :category_id
              AND COALESCE(parent_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  = COALESCE(CAST(:parent_subcategory_id AS uuid), '00000000-0000-0000-0000-000000000000'::uuid)
              AND lower(name) = lower(:name)
              AND id <> :subcategory_id
              AND is_active = TRUE
            """
        ),
        {
            "category_id": existing["category_id"],
            "parent_subcategory_id": existing["parent_subcategory_id"],
            "name": clean_name,
            "subcategory_id": subcategory_id,
        },
    ).scalar()
    if duplicate:
        raise ValueError("A subcategory with this name already exists here.")

    updated = db.execute(
        text(
            """
            UPDATE public.subcategories
            SET
                name = :name,
                description = :description,
                color = CASE WHEN :color IS NOT NULL AND :color <> '' THEN :color ELSE color END
            WHERE id = :subcategory_id
            RETURNING
                id::text AS id,
                category_id::text AS category_id,
                parent_subcategory_id::text AS parent_subcategory_id,
                name,
                description,
                is_active,
                color
            """
        ),
        {
            "subcategory_id": subcategory_id,
            "name": clean_name,
            "description": (description or "").strip() or None,
            "color": (color or "").strip() or None,
        },
    ).mappings().first()
    db.commit()
    sync_category_tags(db)
    return dict(updated)


def move_subcategory(
    subcategory_id: str,
    target_category_id: str,
    target_parent_subcategory_id: str | None,
    db: Session,
) -> dict:
    # 1. Load the node being moved
    node = db.execute(
        text("""
            SELECT id::text, category_id::text, parent_subcategory_id::text, name
            FROM public.subcategories
            WHERE id = CAST(:sub_id AS uuid) AND is_active = TRUE
        """),
        {"sub_id": subcategory_id},
    ).mappings().first()
    if not node:
        raise ValueError("Subcategory not found.")

    # 2. No-op guard
    if (node["category_id"] == target_category_id
            and node["parent_subcategory_id"] == target_parent_subcategory_id):
        raise ValueError("Subcategory is already in this location.")

    # 3. Validate target category
    cat_row = db.execute(
        text("""
            SELECT id, name FROM public.categories
            WHERE id = CAST(:cat_id AS uuid) AND is_active = TRUE
        """),
        {"cat_id": target_category_id},
    ).mappings().first()
    if not cat_row:
        raise ValueError("Target category not found.")

    # 4. Validate target parent; determine new parent name for budget rows
    new_parent_name: str = cat_row["name"]
    if target_parent_subcategory_id:
        parent_row = db.execute(
            text("""
                SELECT id, category_id::text, name FROM public.subcategories
                WHERE id = CAST(:parent_id AS uuid) AND is_active = TRUE
            """),
            {"parent_id": target_parent_subcategory_id},
        ).mappings().first()
        if not parent_row:
            raise ValueError("Target parent subcategory not found.")
        if parent_row["category_id"] != target_category_id:
            raise ValueError("Target parent subcategory belongs to a different category.")
        new_parent_name = parent_row["name"]

    # 5. Circular reference: ensure target parent is not a descendant of the moving node
    if target_parent_subcategory_id:
        is_cycle = db.execute(
            text("""
                WITH RECURSIVE descendants AS (
                    SELECT id FROM public.subcategories WHERE id = CAST(:sub_id AS uuid)
                    UNION ALL
                    SELECT s.id FROM public.subcategories s
                    JOIN descendants d ON s.parent_subcategory_id = d.id
                )
                SELECT 1 FROM descendants WHERE id = CAST(:target_parent_id AS uuid)
            """),
            {"sub_id": subcategory_id, "target_parent_id": target_parent_subcategory_id},
        ).first()
        if is_cycle:
            raise ValueError("Cannot move a subcategory under one of its own descendants.")

    # 6. Name uniqueness at the target location
    conflict = db.execute(
        text("""
            SELECT 1 FROM public.subcategories
            WHERE category_id = CAST(:cat_id AS uuid)
              AND COALESCE(parent_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  = COALESCE(CAST(:parent_id AS uuid), '00000000-0000-0000-0000-000000000000'::uuid)
              AND lower(name) = lower(:name)
              AND is_active = TRUE
              AND id != CAST(:sub_id AS uuid)
        """),
        {
            "cat_id": target_category_id,
            "parent_id": target_parent_subcategory_id,
            "name": node["name"],
            "sub_id": subcategory_id,
        },
    ).first()
    if conflict:
        raise ValueError(f"A subcategory named '{node['name']}' already exists at the target location.")

    cross_category = node["category_id"] != target_category_id

    # 7. Move the node
    db.execute(
        text("""
            UPDATE public.subcategories
            SET category_id = CAST(:cat_id AS uuid),
                parent_subcategory_id = CAST(:parent_id AS uuid)
            WHERE id = CAST(:sub_id AS uuid)
        """),
        {
            "cat_id": target_category_id,
            "parent_id": target_parent_subcategory_id,
            "sub_id": subcategory_id,
        },
    )

    if cross_category:
        # 8. Cascade category_id to all descendants
        db.execute(
            text("""
                WITH RECURSIVE descendants AS (
                    SELECT id FROM public.subcategories WHERE id = CAST(:sub_id AS uuid)
                    UNION ALL
                    SELECT s.id FROM public.subcategories s
                    JOIN descendants d ON s.parent_subcategory_id = d.id
                )
                UPDATE public.subcategories
                SET category_id = CAST(:cat_id AS uuid)
                WHERE id IN (SELECT id FROM descendants)
                AND id != CAST(:sub_id AS uuid)
            """),
            {"cat_id": target_category_id, "sub_id": subcategory_id},
        )

        # 9. Keep transaction_split_line_items category_id consistent
        split_table = db.execute(
            text("""
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'transaction_split_line_items'
            """)
        ).first()
        if split_table:
            db.execute(
                text("""
                    WITH RECURSIVE descendants AS (
                        SELECT id FROM public.subcategories WHERE id = CAST(:sub_id AS uuid)
                        UNION ALL
                        SELECT s.id FROM public.subcategories s
                        JOIN descendants d ON s.parent_subcategory_id = d.id
                    )
                    UPDATE public.transaction_split_line_items
                    SET category_id = CAST(:cat_id AS uuid)
                    WHERE subcategory_id IN (SELECT id FROM descendants)
                """),
                {"cat_id": target_category_id, "sub_id": subcategory_id},
            )

    # 10. Fix category_budgets parent_name for the moved node (name-based, no FK)
    budget_table = db.execute(
        text("""
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'category_budgets'
        """)
    ).first()
    if budget_table:
        db.execute(
            text("""
                UPDATE public.category_budgets
                SET parent_name = :new_parent
                WHERE lower(tag_name) = lower(:tag_name)
            """),
            {"new_parent": new_parent_name, "tag_name": node["name"]},
        )

    db.commit()

    # 11. Rebind system_tags tree — idempotent, updates parent_id chain in one pass
    sync_category_tags(db)

    return {
        "id": subcategory_id,
        "name": node["name"],
        "category_id": target_category_id,
        "parent_subcategory_id": target_parent_subcategory_id,
    }
