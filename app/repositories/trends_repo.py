from typing import Optional
from sqlalchemy import text
from sqlalchemy.orm import Session

from repositories.tag_display import dup_join, label_expr


def get_monthly_trends(
    db: Session,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    source: Optional[str] = None,
    tag: Optional[str] = None,
) -> list[dict]:
    rows = db.execute(
        text("""
            SELECT
                TO_CHAR(t.transaction_date, 'YYYY-MM') AS month,
                SUM(
                  CASE
                    WHEN COALESCE(rtd.linked_as_recovery, FALSE) THEN 0
                    WHEN lower(COALESCE(t.primary_flow_type,'')) IN ('transfer','investment_buy','loan_given') THEN 0
                    WHEN lower(COALESCE(sd.split_mode,'')) = 'self_transfer' THEN 0
                    WHEN lower(COALESCE(t.direction,'')) = 'withdrawal'
                      THEN GREATEST(ABS(COALESCE(t.amount,0)) - COALESCE(rd.recovery_amount,0) - COALESCE(sj.shared_joy_amount,0), 0)
                    ELSE 0
                  END
                ) AS total_expense,
                SUM(
                  CASE
                    WHEN COALESCE(rtd.linked_as_recovery, FALSE) THEN 0
                    WHEN lower(COALESCE(t.primary_flow_type,'')) = 'transfer' THEN 0
                    WHEN lower(COALESCE(sd.split_mode,'')) = 'self_transfer' THEN 0
                    WHEN lower(COALESCE(t.direction,'')) <> 'withdrawal'
                      THEN ABS(COALESCE(t.amount,0))
                    ELSE 0
                  END
                ) AS total_income,
                SUM(
                  CASE
                    WHEN lower(COALESCE(t.primary_flow_type,'')) = 'investment_buy'
                      AND lower(COALESCE(t.direction,'')) = 'withdrawal'
                      THEN GREATEST(ABS(COALESCE(t.amount,0)) - COALESCE(rd.recovery_amount,0), 0)
                    ELSE 0
                  END
                ) AS total_invested,
                SUM(
                  CASE
                    WHEN lower(COALESCE(t.primary_flow_type,'')) = 'investment_sell'
                      AND lower(COALESCE(t.direction,'')) <> 'withdrawal'
                      THEN ABS(COALESCE(t.amount,0))
                    ELSE 0
                  END
                ) AS total_investment_return,
                COUNT(*) AS transaction_count
            FROM public.transactions t
            LEFT JOIN (
                SELECT r.recovery_transaction_id AS transaction_id, TRUE AS linked_as_recovery
                FROM public.transaction_split_recoveries r
                GROUP BY r.recovery_transaction_id
            ) rtd ON rtd.transaction_id = t.id
            LEFT JOIN (
                SELECT s.transaction_id, MAX(s.split_mode) AS split_mode
                FROM public.transaction_splits s
                GROUP BY s.transaction_id
            ) sd ON sd.transaction_id = t.id
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
            WHERE (:from_date IS NULL OR t.transaction_date >= CAST(:from_date AS date))
              AND (:to_date   IS NULL OR t.transaction_date <= CAST(:to_date   AS date))
              AND (:source    IS NULL OR t.payment_source_name = :source)
              AND (
                  :tag IS NULL
                  OR EXISTS (
                      SELECT 1
                      FROM public.transaction_tags tt
                      JOIN public.system_tags st ON st.id = tt.tag_id
                      WHERE tt.transaction_id = t.id
                        AND lower(st.normalized) = lower(:tag)
                  )
              )
            GROUP BY TO_CHAR(t.transaction_date, 'YYYY-MM')
            ORDER BY month ASC
        """),
        {"from_date": from_date, "to_date": to_date, "source": source, "tag": tag},
    ).mappings().all()

    return [
        {
            "month":             row["month"],
            "total_expense":     float(row["total_expense"] or 0),
            "total_income":      float(row["total_income"] or 0),
            "total_invested":           float(row["total_invested"] or 0),
            "total_investment_return":  float(row["total_investment_return"] or 0),
            "transaction_count":        int(row["transaction_count"]),
        }
        for row in rows
    ]


def get_spending_by_category(
    db: Session,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    tag_type: Optional[str] = None,
) -> list[dict]:
    # Group by the tag's node identity (st.id), not its bare name, so a leaf name
    # that repeats under different parents (e.g. "petrol" under 2-Wheeler vs
    # 4-Wheeler) stays separate. The label is collision-aware: plain name when
    # unique, "<name> (<parent>)" when the name is shared across parents.
    rows = db.execute(
        text(f"""
            SELECT
                st.id AS tag_id,
                COALESCE({label_expr("st", "st_")}, 'Untagged') AS category,
                SUM(CASE
                    WHEN t.direction = 'withdrawal'
                     AND lower(COALESCE(t.primary_flow_type,'')) NOT IN ('investment_buy')
                    THEN GREATEST(ABS(COALESCE(t.amount,0)) - COALESCE(rd.recovery_amount,0), 0)
                    ELSE 0
                END)                          AS total_expense,
                SUM(CASE
                    WHEN t.direction = 'withdrawal'
                     AND lower(COALESCE(t.primary_flow_type,'')) = 'investment_buy'
                    THEN GREATEST(ABS(COALESCE(t.amount,0)) - COALESCE(rd.recovery_amount,0), 0)
                    ELSE 0
                END)                          AS total_invested,
                SUM(CASE
                    WHEN COALESCE(rtd.linked_as_recovery, FALSE) THEN 0
                    WHEN t.direction <> 'withdrawal'
                     AND lower(COALESCE(t.primary_flow_type,'')) NOT IN ('transfer')
                    THEN ABS(COALESCE(t.amount,0))
                    ELSE 0
                END)                          AS total_income,
                COUNT(CASE WHEN t.direction = 'withdrawal' THEN 1 END) AS transaction_count
            FROM public.transactions t
            LEFT JOIN public.transaction_tags tt ON tt.transaction_id = t.id
            LEFT JOIN public.system_tags st
                ON st.id = tt.tag_id
               AND st.is_active = TRUE
               AND (:tag_type IS NULL OR st.tag_type = :tag_type)
            {dup_join("st", "st_")}
            LEFT JOIN (
                SELECT r.recovery_transaction_id AS transaction_id, TRUE AS linked_as_recovery
                FROM public.transaction_split_recoveries r
                GROUP BY r.recovery_transaction_id
            ) rtd ON rtd.transaction_id = t.id
            LEFT JOIN (
                SELECT s.transaction_id, COALESCE(SUM(r.amount), 0) AS recovery_amount
                FROM public.transaction_splits s
                LEFT JOIN public.transaction_split_recoveries r ON s.id = r.split_id
                GROUP BY s.transaction_id
            ) rd ON rd.transaction_id = t.id
            WHERE (:from_date IS NULL OR t.transaction_date >= CAST(:from_date AS date))
              AND (:to_date   IS NULL OR t.transaction_date <= CAST(:to_date   AS date))
            GROUP BY st.id, COALESCE({label_expr("st", "st_")}, 'Untagged')
            ORDER BY total_expense DESC
        """),
        {"from_date": from_date, "to_date": to_date, "tag_type": tag_type},
    ).mappings().all()

    return [
        {
            "tag_id":            int(row["tag_id"]) if row["tag_id"] is not None else None,
            "category":          row["category"],
            "total_expense":     float(row["total_expense"] or 0),
            "total_invested":    float(row["total_invested"] or 0),
            "total_income":      float(row["total_income"] or 0),
            "transaction_count": int(row["transaction_count"]),
        }
        for row in rows
    ]


def get_spending_by_source(
    db: Session,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list[dict]:
    rows = db.execute(
        text("""
            SELECT
                COALESCE(t.payment_source_name, 'Unknown') AS payment_source,
                SUM(CASE WHEN t.direction = 'withdrawal' THEN t.amount ELSE 0 END) AS total_expense,
                SUM(CASE WHEN t.direction = 'credit'     THEN t.amount ELSE 0 END) AS total_income,
                COUNT(*) AS transaction_count
            FROM public.transactions t
            WHERE (:from_date IS NULL OR t.transaction_date >= CAST(:from_date AS date))
              AND (:to_date   IS NULL OR t.transaction_date <= CAST(:to_date   AS date))
            GROUP BY COALESCE(t.payment_source_name, 'Unknown')
            ORDER BY total_expense DESC
        """),
        {"from_date": from_date, "to_date": to_date},
    ).mappings().all()

    return [
        {
            "payment_source":    row["payment_source"],
            "total_expense":     float(row["total_expense"] or 0),
            "total_income":      float(row["total_income"] or 0),
            "transaction_count": int(row["transaction_count"]),
        }
        for row in rows
    ]


def get_subcategory_breakdown(
    db: Session,
    parent_name: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    source: Optional[str] = None,
) -> list[dict]:
    rows = db.execute(
        text("""
            WITH cat AS (
                SELECT id FROM public.categories
                WHERE lower(name) = lower(:parent_name) AND is_active = TRUE
                LIMIT 1
            ),
            l1 AS (
                SELECT s.id, s.name, :parent_name AS parent_name, 1 AS level
                FROM public.subcategories s
                JOIN cat ON s.category_id = cat.id
                WHERE s.parent_subcategory_id IS NULL AND s.is_active = TRUE
            ),
            l2 AS (
                SELECT s.id, s.name, l1.name AS parent_name, 2 AS level
                FROM public.subcategories s
                JOIN l1 ON s.parent_subcategory_id = l1.id
                WHERE s.is_active = TRUE
            ),
            all_subs AS (SELECT * FROM l1 UNION ALL SELECT * FROM l2)
            SELECT
                sub.name        AS subcategory,
                sub.parent_name,
                sub.level,
                COALESCE(SUM(
                    CASE
                        WHEN COALESCE(rtd.linked_as_recovery, FALSE) THEN 0
                        WHEN t.direction = 'withdrawal'
                            THEN GREATEST(ABS(COALESCE(t.amount, 0)) - COALESCE(rd.recovery_amount, 0), 0)
                        ELSE 0
                    END
                ), 0) AS total_expense,
                COUNT(DISTINCT tt.transaction_id) AS transaction_count
            FROM all_subs sub
            -- Bind to the exact subcategory node, not by name, so a same-named leaf
            -- under a different parent is not pulled into this parent's breakdown.
            LEFT JOIN public.system_tags st
                   ON st.subcategory_id = sub.id AND st.is_active = TRUE
            LEFT JOIN public.transaction_tags tt ON tt.tag_id = st.id
            LEFT JOIN public.transactions t
                   ON tt.transaction_id = t.id
                  AND t.direction = 'withdrawal'
                  AND (:from_date IS NULL OR t.transaction_date >= CAST(:from_date AS date))
                  AND (:to_date   IS NULL OR t.transaction_date <= CAST(:to_date   AS date))
                  AND (:source    IS NULL OR t.payment_source_name = :source)
            LEFT JOIN (
                SELECT r.recovery_transaction_id AS transaction_id, TRUE AS linked_as_recovery
                FROM public.transaction_split_recoveries r
                GROUP BY r.recovery_transaction_id
            ) rtd ON rtd.transaction_id = t.id
            LEFT JOIN (
                SELECT s.transaction_id, COALESCE(SUM(r.amount), 0) AS recovery_amount
                FROM public.transaction_splits s
                LEFT JOIN public.transaction_split_recoveries r ON s.id = r.split_id
                GROUP BY s.transaction_id
            ) rd ON rd.transaction_id = t.id
            GROUP BY sub.name, sub.parent_name, sub.level
            ORDER BY sub.level ASC, total_expense DESC
        """),
        {"parent_name": parent_name, "from_date": from_date, "to_date": to_date, "source": source},
    ).mappings().all()

    return [
        {
            "subcategory":       row["subcategory"],
            "parent_name":       row["parent_name"],
            "level":             int(row["level"]),
            "total_expense":     float(row["total_expense"] or 0),
            "transaction_count": int(row["transaction_count"]),
        }
        for row in rows
    ]


def get_merchant_insights(
    db: Session,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    min_count: int = 1,
    tag: Optional[str] = None,
) -> list[dict]:
    label = label_expr("st", "st_")
    dupj = dup_join("st", "st_")
    rows = db.execute(
        text(f"""
            WITH merchant_groups AS (
                SELECT
                    COALESCE(
                        NULLIF(BTRIM(t.vendor_name), ''),
                        NULLIF(BTRIM(t.counterparty_entity_name), ''),
                        NULLIF(BTRIM(t.counterparty_identifier), ''),
                        'Unknown'
                    )                                   AS merchant,
                    NULLIF(BTRIM(t.vendor_name), '')             AS vendor_name,
                    NULLIF(BTRIM(t.counterparty_identifier), '')  AS counterparty_identifier,
                    NULLIF(BTRIM(t.counterparty_entity_name), '') AS counterparty_entity_name,
                    t.id                                          AS txn_id,
                    t.amount,
                    t.transaction_date
                FROM public.transactions t
                WHERE t.direction = 'withdrawal'
                  AND (:from_date IS NULL OR t.transaction_date >= CAST(:from_date AS date))
                  AND (:to_date   IS NULL OR t.transaction_date <= CAST(:to_date   AS date))
                  AND (:tag IS NULL OR EXISTS (
                          SELECT 1 FROM public.transaction_tags tt2
                          JOIN public.system_tags st2 ON st2.id = tt2.tag_id
                          WHERE tt2.transaction_id = t.id
                            AND lower(st2.normalized) = lower(:tag)
                  ))
            ),
            merchant_stats AS (
                SELECT
                    merchant,
                    COUNT(*)                        AS transaction_count,
                    SUM(amount)                     AS total_spend,
                    AVG(amount)                     AS avg_spend,
                    MAX(transaction_date)           AS last_transaction_date,
                    MAX(vendor_name)                   AS vendor_name,
                    MAX(counterparty_identifier)       AS counterparty_identifier,
                    MAX(counterparty_entity_name)      AS counterparty_entity_name,
                    MAX(txn_id::text)                  AS sample_transaction_id
                FROM merchant_groups
                GROUP BY merchant
                HAVING COUNT(*) >= :min_count
            ),
            tag_counts AS (
                SELECT
                    mg.merchant,
                    {label} AS tag_name,
                    COUNT(*)                AS tag_freq,
                    ROW_NUMBER() OVER (
                        PARTITION BY mg.merchant
                        ORDER BY COUNT(*) DESC
                    )                       AS rn
                FROM merchant_groups mg
                JOIN public.transaction_tags tt ON tt.transaction_id = mg.txn_id
                JOIN public.system_tags st      ON st.id = tt.tag_id AND st.is_active = TRUE
                {dupj}
                GROUP BY mg.merchant, st.id, {label}
            )
            SELECT
                ms.merchant,
                ms.transaction_count,
                ms.total_spend,
                ms.avg_spend,
                ms.last_transaction_date,
                ms.vendor_name,
                ms.counterparty_identifier,
                ms.counterparty_entity_name,
                ms.sample_transaction_id,
                tc.tag_name AS top_tag
            FROM merchant_stats ms
            LEFT JOIN tag_counts tc ON tc.merchant = ms.merchant AND tc.rn = 1
            ORDER BY ms.total_spend DESC
        """),
        {"from_date": from_date, "to_date": to_date, "min_count": min_count, "tag": tag},
    ).mappings().all()

    return [
        {
            "merchant":              row["merchant"],
            "transaction_count":     int(row["transaction_count"]),
            "total_spend":              float(row["total_spend"] or 0),
            "avg_spend":                float(row["avg_spend"] or 0),
            "last_transaction_date":    str(row["last_transaction_date"]) if row["last_transaction_date"] else None,
            "top_tag":                  row["top_tag"],
            "vendor_name":                row["vendor_name"],
            "counterparty_identifier":    row["counterparty_identifier"],
            "counterparty_entity_name":   row["counterparty_entity_name"],
            "sample_transaction_id":      row["sample_transaction_id"],
        }
        for row in rows
    ]
