import logging
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("app")

SEED_TAGS = [
    ("Food & Dining",  "CATEGORY"),
    ("Groceries",      "CATEGORY"),
    ("Transport",      "CATEGORY"),
    ("Shopping",       "CATEGORY"),
    ("Entertainment",  "CATEGORY"),
    ("Health",         "CATEGORY"),
    ("Utilities",      "CATEGORY"),
    ("Swiggy",         "VENDOR"),
    ("Zomato",         "VENDOR"),
    ("Amazon",         "VENDOR"),
    ("Flipkart",       "VENDOR"),
    ("Uber",           "VENDOR"),
    ("Ola",            "VENDOR"),
    ("BigBasket",      "VENDOR"),
    ("Blinkit",        "VENDOR"),
    ("Zepto",          "VENDOR"),
    ("Netflix",        "VENDOR"),
    ("Hotstar",        "VENDOR"),
    ("Spotify",        "VENDOR"),
    ("PharmEasy",      "VENDOR"),
    ("1mg",            "VENDOR"),
    ("IRCTC",          "VENDOR"),
    ("MakeMyTrip",     "VENDOR"),
]

SEED_RULES = [
    # Food delivery — vendor tags
    {"tag_name": "Swiggy",        "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "swiggy",      "base_confidence": 0.95, "priority": 100},
    {"tag_name": "Swiggy",        "match_field": "narration",               "match_type": "CONTAINS", "match_value": "swiggy",      "base_confidence": 0.85, "priority": 90},
    {"tag_name": "Zomato",        "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "zomato",      "base_confidence": 0.95, "priority": 100},
    {"tag_name": "Zomato",        "match_field": "narration",               "match_type": "CONTAINS", "match_value": "zomato",      "base_confidence": 0.85, "priority": 90},
    # Food delivery — category tags
    {"tag_name": "Food & Dining", "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "swiggy",      "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Food & Dining", "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "zomato",      "base_confidence": 0.90, "priority": 80},
    # Shopping — vendor tags
    {"tag_name": "Amazon",        "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "amazon",      "base_confidence": 0.95, "priority": 100},
    {"tag_name": "Amazon",        "match_field": "narration",               "match_type": "CONTAINS", "match_value": "amazon",      "base_confidence": 0.85, "priority": 90},
    {"tag_name": "Flipkart",      "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "flipkart",    "base_confidence": 0.95, "priority": 100},
    {"tag_name": "Flipkart",      "match_field": "narration",               "match_type": "CONTAINS", "match_value": "flipkart",    "base_confidence": 0.85, "priority": 90},
    # Shopping — category tags
    {"tag_name": "Shopping",      "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "amazon",      "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Shopping",      "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "flipkart",    "base_confidence": 0.90, "priority": 80},
    # Transport — vendor tags
    {"tag_name": "Uber",          "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "uber",        "base_confidence": 0.95, "priority": 100},
    {"tag_name": "Ola",           "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "olacabs",     "base_confidence": 0.95, "priority": 100},
    {"tag_name": "Ola",           "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "ola",         "base_confidence": 0.85, "priority": 90},
    {"tag_name": "IRCTC",         "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "irctc",       "base_confidence": 0.95, "priority": 100},
    {"tag_name": "MakeMyTrip",    "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "makemytrip",  "base_confidence": 0.95, "priority": 100},
    # Transport — category tags
    {"tag_name": "Transport",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "uber",        "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Transport",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "olacabs",     "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Transport",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "irctc",       "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Transport",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "makemytrip",  "base_confidence": 0.85, "priority": 80},
    # Groceries — vendor tags
    {"tag_name": "BigBasket",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "bigbasket",   "base_confidence": 0.95, "priority": 100},
    {"tag_name": "Blinkit",       "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "blinkit",     "base_confidence": 0.95, "priority": 100},
    {"tag_name": "Zepto",         "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "zepto",       "base_confidence": 0.95, "priority": 100},
    # Groceries — category tags
    {"tag_name": "Groceries",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "bigbasket",   "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Groceries",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "blinkit",     "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Groceries",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "zepto",       "base_confidence": 0.90, "priority": 80},
    # Entertainment — vendor tags
    {"tag_name": "Netflix",       "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "netflix",     "base_confidence": 0.97, "priority": 100},
    {"tag_name": "Hotstar",       "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "hotstar",     "base_confidence": 0.97, "priority": 100},
    {"tag_name": "Spotify",       "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "spotify",     "base_confidence": 0.97, "priority": 100},
    # Entertainment — category tags
    {"tag_name": "Entertainment", "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "netflix",     "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Entertainment", "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "hotstar",     "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Entertainment", "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "spotify",     "base_confidence": 0.90, "priority": 80},
    # Health — vendor tags
    {"tag_name": "PharmEasy",     "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "pharmeasy",   "base_confidence": 0.95, "priority": 100},
    {"tag_name": "1mg",           "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "1mg",         "base_confidence": 0.95, "priority": 100},
    # Health — category tags
    {"tag_name": "Health",        "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "pharmeasy",   "base_confidence": 0.90, "priority": 80},
    {"tag_name": "Health",        "match_field": "counterparty_identifier", "match_type": "CONTAINS", "match_value": "1mg",         "base_confidence": 0.90, "priority": 80},
]


def ensure_seed_data(db: Session):
    # Unique index on tag_rules so ON CONFLICT works
    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_rules_scope_tag_match
        ON public.tag_rules (tag_id, match_field, match_type, lower(match_value))
        WHERE is_active = TRUE
    """))

    # Unique index on tag_suggestions so ON CONFLICT works
    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_txn_tag_suggestions
        ON public.transaction_tag_suggestions (transaction_id, tag_id)
    """))

    db.commit()

    # Insert seed system_tags
    for name, tag_type in SEED_TAGS:
        db.execute(
            text("""
                INSERT INTO public.system_tags (name, normalized, tag_type, is_active, managed_by_schema)
                VALUES (:name, lower(:name), :tag_type, TRUE, TRUE)
                ON CONFLICT (COALESCE(parent_id, 0), normalized) DO NOTHING
            """),
            {"name": name, "tag_type": tag_type},
        )

    db.commit()

    # Insert seed tag_rules (resolve tag_id via subquery)
    for rule in SEED_RULES:
        db.execute(
            text("""
                INSERT INTO public.tag_rules
                    (scope_key, tag_id, match_field, match_type, match_value,
                     confidence_source, base_confidence, priority, is_active)
                SELECT
                    '',
                    st.id,
                    :match_field,
                    :match_type,
                    :match_value,
                    'SEED',
                    :base_confidence,
                    :priority,
                    TRUE
                FROM public.system_tags st
                WHERE st.normalized = lower(:tag_name)
                ON CONFLICT DO NOTHING
            """),
            {
                "tag_name":        rule["tag_name"],
                "match_field":     rule["match_field"],
                "match_type":      rule["match_type"],
                "match_value":     rule["match_value"],
                "base_confidence": rule["base_confidence"],
                "priority":        rule["priority"],
            },
        )

    db.commit()
    logger.info("Seed data applied successfully.")
