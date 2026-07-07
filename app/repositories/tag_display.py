"""Collision-aware tag display names.

A leaf tag name may legitimately repeat under different parents (e.g. "petrol"
under both "2-Wheeler" and "4-Wheeler"). Tags are stored node-bound (each row
carries its own ``parent_id`` / ``subcategory_id``), so they are distinct rows
that happen to share a ``name``. For display and for round-tripping a tag token
between the UI and the API we use a *display name* that is:

    - the plain ``name`` when that name is unique among active managed tags, or
    - ``"<name> (<parent name>)"`` when the same name exists under 2+ parents.

This module centralises the SQL so every read/write/aggregation site computes
the exact same token. Aliases are caller-supplied and always hard-coded (never
user input), so string interpolation here is safe.
"""


def dup_join(tag_alias: str, prefix: str) -> str:
    """LEFT JOINs that expose a parent row and a duplicate-name marker.

    ``{prefix}p`` -> the parent tag row (for the suffix); ``{prefix}d`` -> a
    one-row-per-colliding-normalized marker (NULL when the name is unique).
    """
    return f"""
        LEFT JOIN public.system_tags {prefix}p
               ON {prefix}p.id = {tag_alias}.parent_id
        LEFT JOIN (
            SELECT normalized
            FROM public.system_tags
            WHERE COALESCE(is_active, TRUE) = TRUE
              AND COALESCE(managed_by_schema, FALSE) = TRUE
            GROUP BY normalized
            HAVING COUNT(*) > 1
        ) {prefix}d ON {prefix}d.normalized = {tag_alias}.normalized
    """


def label_expr(tag_alias: str, prefix: str) -> str:
    """SQL expression yielding the collision-aware display name."""
    return f"""
        CASE
            WHEN {prefix}d.normalized IS NOT NULL AND {prefix}p.name IS NOT NULL
            THEN {tag_alias}.name || ' (' || {prefix}p.name || ')'
            ELSE {tag_alias}.name
        END
    """
