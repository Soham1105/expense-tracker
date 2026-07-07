from decimal import Decimal, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session


BANK_SOURCE_PRIORITY = {
    "BOB": 100,
    "RBL": 100,
    "HDFC": 100,
    "ICICI": 100,
    "SBI": 100,
    "AXIS": 100,
    "KOTAK": 100,
    "IDFC": 100,
    "YES": 100,
    "INDUSIND": 100,
    "CRED": 70,
    "CREDIT": 70,
    "GPAY": 40,
    "SUPERMONEY": 40,
}
BANK_SOURCE_NAMES = {"BOB", "RBL", "HDFC", "ICICI", "SBI", "AXIS", "KOTAK", "IDFC", "YES", "INDUSIND"}
CHANNEL_SOURCE_NAMES = {"GPAY", "CRED", "CREDIT", "OTHER", "SUPERMONEY"}


def normalize_source_name(value):
    normalized = str(value or "").strip().upper()
    return normalized or None


def parse_statement_sources(value):
    return {
        token.strip().upper()
        for token in str(value or "").split(",")
        if token and token.strip()
    }


def serialize_statement_sources(sources):
    normalized_sources = sorted(
        {normalize_source_name(source) for source in sources if normalize_source_name(source)}
    )
    return ",".join(normalized_sources)


def get_source_priority(source_name):
    normalized = normalize_source_name(source_name)
    if not normalized:
        return 0
    return BANK_SOURCE_PRIORITY.get(normalized, 10)


def choose_primary_source(existing_source, incoming_source):
    existing_priority = get_source_priority(existing_source)
    incoming_priority = get_source_priority(incoming_source)
    if incoming_priority > existing_priority:
        return normalize_source_name(incoming_source)
    return normalize_source_name(existing_source) or normalize_source_name(incoming_source)


def pick_better_text(existing_value, incoming_value):
    existing_text = str(existing_value or "").strip()
    incoming_text = str(incoming_value or "").strip()
    if not existing_text:
        return incoming_text or None
    if incoming_text and len(incoming_text) > len(existing_text):
        return incoming_text
    return existing_text


def sanitize_narration_text(value):
    text = str(value or "").strip()
    if not text:
        return ""

    trim_markers = [
        "total",
        "account summary",
        "statement summary",
        "for any queries",
        "customer care",
        "registered office",
        "website",
        "rbl bank",
    ]
    lowered = text.lower()
    cut_index = None
    for marker in trim_markers:
        marker_index = lowered.find(marker)
        if marker_index >= 0:
            cut_index = marker_index if cut_index is None else min(cut_index, marker_index)
    if cut_index is not None:
        text = text[:cut_index]

    return " ".join(text.split()).strip(" -:|")


def score_narration_quality(value):
    text = sanitize_narration_text(value)
    if not text:
        return (-1, -1)
    return (1, len(text))


def pick_better_narration(existing_value, incoming_value):
    existing_text = sanitize_narration_text(existing_value)
    incoming_text = sanitize_narration_text(incoming_value)
    if not existing_text:
        return incoming_text or None
    if not incoming_text:
        return existing_text
    if score_narration_quality(incoming_text) >= score_narration_quality(existing_text):
        return incoming_text
    return existing_text


def source_group(source_name):
    normalized = normalize_source_name(source_name)
    if normalized in {"GPAY", "CRED"}:
        return "aggregator"
    if normalized:
        return "bank"
    return None


def can_merge_without_time(existing_row, incoming_transaction):
    existing_source_group = source_group(existing_row.get("payment_source_name"))
    incoming_source_group = source_group(incoming_transaction.get("payment_source_name"))
    if not existing_source_group or not incoming_source_group:
        return False
    if existing_source_group == incoming_source_group:
        return False

    existing_counterparty = str(existing_row.get("counterparty_identifier") or "").strip().lower()
    incoming_counterparty = str(
        incoming_transaction.get("counterparty_identifier") or ""
    ).strip().lower()
    if existing_counterparty and incoming_counterparty:
        return existing_counterparty == incoming_counterparty

    return False


def normalize_text_value(value):
    return str(value or "").strip()


def normalize_counterparty_value(value):
    return normalize_text_value(value).lower()


def normalize_time_value(value):
    return normalize_text_value(value)


def amounts_match(left_value, right_value, tolerance: str = "0.01"):
    if left_value is None or right_value is None:
        return False
    try:
        left_amount = Decimal(str(left_value))
        right_amount = Decimal(str(right_value))
    except (InvalidOperation, ValueError):
        return False
    return abs(left_amount - right_amount) <= Decimal(tolerance)


def normalize_amount_value(value):
    try:
        return str(Decimal(str(value or 0)).quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return "0.00"


def build_transaction_match_key(row: dict):
    return (
        str(row.get("transaction_date") or ""),
        normalize_time_value(row.get("transaction_time")),
        normalize_text_value(row.get("type") or row.get("direction")).lower(),
        normalize_amount_value(row.get("amount")),
        normalize_counterparty_value(row.get("counterparty_identifier")),
    )


def build_transaction_loose_key(row: dict):
    return (
        str(row.get("transaction_date") or ""),
        normalize_text_value(row.get("type") or row.get("direction")).lower(),
        normalize_amount_value(row.get("amount")),
        normalize_counterparty_value(row.get("counterparty_identifier")),
    )


def infer_bank_from_row_text(*values):
    searchable_text = " ".join(normalize_text_value(value).upper() for value in values if value)
    if not searchable_text:
        return None
    if "RBL" in searchable_text:
        return "RBL"
    if "BANK OF BARODA" in searchable_text or "BOB" in searchable_text:
        return "BOB"
    if "HDFC" in searchable_text:
        return "HDFC"
    if "ICICI" in searchable_text:
        return "ICICI"
    if "STATE BANK OF INDIA" in searchable_text or " SBI " in f" {searchable_text} ":
        return "SBI"
    if "AXIS" in searchable_text:
        return "AXIS"
    if "KOTAK" in searchable_text:
        return "KOTAK"
    if "IDFC" in searchable_text:
        return "IDFC"
    if "YES BANK" in searchable_text or " YES " in f" {searchable_text} ":
        return "YES"
    if "INDUSIND" in searchable_text:
        return "INDUSIND"
    return None


def infer_channel_from_row_text(*values):
    searchable_text = " ".join(normalize_text_value(value).upper() for value in values if value)
    if not searchable_text:
        return "OTHER"
    if "GPAY" in searchable_text or "GOOGLE PAY" in searchable_text:
        return "GPAY"
    if "CRED" in searchable_text:
        return "CRED"
    return "OTHER"


def normalize_statement_sources_for_storage(payment_source_name, statement_sources, narration, counterparty_identifier, vendor_name):
    existing_sources = parse_statement_sources(statement_sources)
    inferred_bank = normalize_source_name(payment_source_name)
    if inferred_bank not in BANK_SOURCE_NAMES:
        inferred_bank = infer_bank_from_row_text(
            payment_source_name,
            statement_sources,
            narration,
            counterparty_identifier,
            vendor_name,
        )

    inferred_channel = None
    for source in existing_sources:
        if source in CHANNEL_SOURCE_NAMES:
            inferred_channel = source
            break
    if not inferred_channel:
        inferred_channel = infer_channel_from_row_text(
            payment_source_name,
            statement_sources,
            narration,
            counterparty_identifier,
            vendor_name,
        )

    normalized_sources = []
    for source in (inferred_bank, inferred_channel):
        normalized = normalize_source_name(source)
        if normalized and normalized not in normalized_sources:
            normalized_sources.append(normalized)

    for source in existing_sources:
        if source in BANK_SOURCE_NAMES:
            continue
        if source in CHANNEL_SOURCE_NAMES and source != "OTHER":
            if source not in normalized_sources:
                normalized_sources.append(source)
            continue
        if source not in normalized_sources and source not in {"OTHER"}:
            normalized_sources.append(source)

    # Keep "OTHER" only as a fallback channel marker. When we know the bank,
    # persisting just the bank keeps report grouping deterministic and avoids
    # old rows looking like "OTHER,RBL".
    if inferred_bank and inferred_channel == "OTHER":
        normalized_sources = [source for source in normalized_sources if source != "OTHER"]
        if inferred_bank not in normalized_sources:
            normalized_sources.insert(0, inferred_bank)

    if inferred_bank:
        normalized_sources = [
            source for source in normalized_sources
            if source == inferred_bank or source not in BANK_SOURCE_NAMES
        ]
        if inferred_bank not in normalized_sources:
            normalized_sources.insert(0, inferred_bank)

    preferred_channel = next(
        (source for source in normalized_sources if source in {"GPAY", "CRED", "CREDIT"}),
        None,
    )
    non_channel_sources = [
        source for source in normalized_sources
        if source not in CHANNEL_SOURCE_NAMES
    ]
    normalized_sources = non_channel_sources + ([preferred_channel] if preferred_channel else [])

    normalized_payment_source = inferred_bank or normalize_source_name(payment_source_name)
    return normalized_payment_source, serialize_statement_sources(normalized_sources)


def normalize_transaction_row(transaction: dict) -> dict:
    narration = sanitize_narration_text(transaction.get("narration"))
    vendor_name = normalize_text_value(transaction.get("vendor_name"))
    counterparty_identifier = normalize_text_value(
        transaction.get("counterparty_identifier")
    )
    if not counterparty_identifier:
        counterparty_identifier = vendor_name or narration
    source_name, statement_sources = normalize_statement_sources_for_storage(
        transaction.get("payment_source_name"),
        transaction.get("statement_sources"),
        narration,
        counterparty_identifier,
        vendor_name,
    )
    return {
        "transaction_date": transaction.get("transaction_date"),
        "amount": transaction.get("amount"),
        "running_balance": transaction.get("running_balance"),
        "counterparty_identifier": counterparty_identifier,
        "type": transaction.get("type"),
        "payment_source_name": source_name,
        "payment_mode": transaction.get("payment_mode"),
        "transaction_time": transaction.get("transaction_time"),
        "narration": narration,
        "vendor_name": vendor_name or None,
        "statement_sources": statement_sources,
    }


def backfill_transaction_sources(db: Session):
    rows = db.execute(
        text(
            """
            SELECT
                id::text AS id,
                payment_source_name,
                statement_sources,
                narration,
                counterparty_identifier,
                vendor_name
            FROM public.transactions
            """
        )
    ).mappings().all()

    updated_count = 0
    for row in rows:
        normalized_payment_source, normalized_statement_sources = normalize_statement_sources_for_storage(
            row.get("payment_source_name"),
            row.get("statement_sources"),
            row.get("narration"),
            row.get("counterparty_identifier"),
            row.get("vendor_name"),
        )
        if (
            normalize_text_value(row.get("payment_source_name")) != normalize_text_value(normalized_payment_source)
            or normalize_text_value(row.get("statement_sources")) != normalize_text_value(normalized_statement_sources)
        ):
            db.execute(
                text(
                    """
                    UPDATE public.transactions
                    SET payment_source_name = :payment_source_name,
                        statement_sources = :statement_sources
                    WHERE id = :transaction_id
                    """
                ),
                {
                    "transaction_id": row["id"],
                    "payment_source_name": normalized_payment_source,
                    "statement_sources": normalized_statement_sources,
                },
            )
            updated_count += 1

    if updated_count:
        db.commit()
    return updated_count


def ensure_transaction_source_columns(db: Session):
    db.execute(
        text(
            """
            ALTER TABLE public.transactions
            ADD COLUMN IF NOT EXISTS payment_source_name TEXT,
            ADD COLUMN IF NOT EXISTS payment_mode TEXT,
            ADD COLUMN IF NOT EXISTS transaction_time TIME,
            ADD COLUMN IF NOT EXISTS narration TEXT,
            ADD COLUMN IF NOT EXISTS vendor_name TEXT,
            ADD COLUMN IF NOT EXISTS review_status TEXT,
            ADD COLUMN IF NOT EXISTS review_status_manual BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS counterparty_type TEXT,
            ADD COLUMN IF NOT EXISTS primary_flow_type TEXT,
            ADD COLUMN IF NOT EXISTS consumption_ownership TEXT,
            ADD COLUMN IF NOT EXISTS settlement_state TEXT,
            ADD COLUMN IF NOT EXISTS no_tag_required BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS no_split_required BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS statement_sources TEXT
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE public.transactions
            ALTER COLUMN counterparty_identifier TYPE TEXT,
            ALTER COLUMN payment_source_name TYPE TEXT,
            ALTER COLUMN payment_mode TYPE TEXT,
            ALTER COLUMN narration TYPE TEXT,
            ALTER COLUMN vendor_name TYPE TEXT,
            ALTER COLUMN review_status TYPE TEXT,
            ALTER COLUMN counterparty_type TYPE TEXT,
            ALTER COLUMN primary_flow_type TYPE TEXT,
            ALTER COLUMN consumption_ownership TYPE TEXT,
            ALTER COLUMN settlement_state TYPE TEXT
            """
        )
    )
    db.execute(
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'transactions'
                      AND column_name = 'transaction_nature'
                ) OR EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'transactions'
                      AND column_name = 'party_type'
                ) THEN
                    UPDATE public.transactions
                    SET
                        counterparty_type = CASE
                            WHEN COALESCE(NULLIF(BTRIM(counterparty_type), ''), '') <> '' THEN counterparty_type
                            WHEN lower(COALESCE(NULLIF(BTRIM(party_type), ''), '')) IN ('merchant', 'friend', 'family', 'employer', 'unknown')
                                THEN lower(NULLIF(BTRIM(party_type), ''))
                            ELSE counterparty_type
                        END,
                        primary_flow_type = CASE
                            WHEN COALESCE(NULLIF(BTRIM(primary_flow_type), ''), '') <> '' THEN primary_flow_type
                            WHEN lower(COALESCE(NULLIF(BTRIM(transaction_nature), ''), '')) IN ('expense', 'income', 'transfer')
                                THEN lower(NULLIF(BTRIM(transaction_nature), ''))
                            WHEN lower(COALESCE(NULLIF(BTRIM(transaction_nature), ''), '')) = 'reimbursement'
                                THEN 'refund'
                            WHEN lower(COALESCE(NULLIF(BTRIM(transaction_nature), ''), '')) = 'charge'
                                THEN 'fee'
                            ELSE primary_flow_type
                        END,
                        consumption_ownership = CASE
                            WHEN COALESCE(NULLIF(BTRIM(consumption_ownership), ''), '') <> '' THEN consumption_ownership
                            WHEN lower(COALESCE(NULLIF(BTRIM(primary_flow_type), ''), COALESCE(NULLIF(BTRIM(transaction_nature), ''), ''))) = 'transfer'
                                THEN 'not_consumption'
                            ELSE consumption_ownership
                        END,
                        settlement_state = CASE
                            WHEN COALESCE(NULLIF(BTRIM(settlement_state), ''), '') <> '' THEN settlement_state
                            WHEN lower(COALESCE(NULLIF(BTRIM(primary_flow_type), ''), COALESCE(NULLIF(BTRIM(transaction_nature), ''), ''))) = 'transfer'
                                THEN 'none'
                            ELSE settlement_state
                        END;

                    ALTER TABLE public.transactions
                    DROP COLUMN IF EXISTS transaction_nature,
                    DROP COLUMN IF EXISTS party_type;
                END IF;
            END $$;
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE public.transactions
            SET statement_sources = UPPER(COALESCE(payment_source_name, ''))
            WHERE COALESCE(NULLIF(BTRIM(statement_sources), ''), '') = ''
            """
        )
    )
    db.commit()


def find_overlapping_transaction(
    transaction: dict, db: Session, tolerance_seconds: int = 300
):
    sql = text(
        """
        SELECT
            t.id::text AS id,
            t.payment_source_name,
            t.statement_sources,
            t.vendor_name,
            t.narration,
            t.counterparty_identifier,
            t.transaction_time,
            t.running_balance,
            CASE
                WHEN :transaction_time IS NOT NULL AND t.transaction_time IS NOT NULL THEN ABS(
                    EXTRACT(
                        EPOCH FROM (t.transaction_time::time - CAST(:transaction_time AS time))
                    )
                )
                ELSE NULL
            END AS time_diff_seconds
        FROM public.transactions AS t
        WHERE
            t.transaction_date = :transaction_date
            AND lower(COALESCE(t.direction, '')) = lower(:direction)
            AND ABS(COALESCE(t.amount, 0)) = ABS(:amount)
            AND COALESCE(t.payment_mode, '') = COALESCE(:payment_mode, '')
        ORDER BY id ASC
        LIMIT 10
        """
    )

    candidates = db.execute(
        sql,
        {
            "transaction_date": transaction.get("transaction_date"),
            "direction": transaction.get("type"),
            "amount": transaction.get("amount"),
            "payment_mode": transaction.get("payment_mode"),
            "transaction_time": transaction.get("transaction_time"),
        },
    ).mappings().all()
    if not candidates:
        return None

    incoming_counterparty = normalize_counterparty_value(
        transaction.get("counterparty_identifier")
    )
    incoming_running_balance = transaction.get("running_balance")

    def has_counterparty_match(candidate):
        if not incoming_counterparty:
            return False
        return (
            normalize_counterparty_value(candidate.get("counterparty_identifier"))
            == incoming_counterparty
        )

    def has_running_balance_match(candidate):
        candidate_running_balance = candidate.get("running_balance")
        if incoming_running_balance is None or candidate_running_balance is None:
            return False
        return amounts_match(candidate_running_balance, incoming_running_balance)

    timed_matches = [
        candidate
        for candidate in candidates
        if candidate.get("time_diff_seconds") is not None
        and candidate["time_diff_seconds"] <= tolerance_seconds
    ]
    if timed_matches:
        timed_with_balance = [
            candidate for candidate in timed_matches if has_running_balance_match(candidate)
        ]
        if len(timed_with_balance) == 1:
            return timed_with_balance[0]

        timed_with_counterparty = [
            candidate for candidate in timed_matches if has_counterparty_match(candidate)
        ]
        if len(timed_with_counterparty) == 1:
            return timed_with_counterparty[0]

        if len(timed_matches) == 1:
            candidate = timed_matches[0]
            existing_source_group = source_group(candidate.get("payment_source_name"))
            incoming_source_group = source_group(transaction.get("payment_source_name"))
            if (
                incoming_running_balance is not None
                and candidate.get("running_balance") is not None
                and not has_running_balance_match(candidate)
                and existing_source_group == incoming_source_group == "bank"
            ):
                return None
            return candidate
        return None

    balance_matches = [
        candidate for candidate in candidates if has_running_balance_match(candidate)
    ]
    if len(balance_matches) == 1:
        return balance_matches[0]

    balance_and_counterparty_matches = [
        candidate for candidate in balance_matches if has_counterparty_match(candidate)
    ]
    if len(balance_and_counterparty_matches) == 1:
        return balance_and_counterparty_matches[0]

    counterparty_matches = [
        candidate for candidate in candidates if has_counterparty_match(candidate)
    ]
    if len(counterparty_matches) == 1:
        candidate = counterparty_matches[0]
        if can_merge_without_time(candidate, transaction):
            return candidate

    if len(candidates) == 1:
        candidate = candidates[0]
        incoming_time = transaction.get("transaction_time")
        if incoming_time is None or candidate.get("transaction_time") is None:
            return candidate

    return None


def find_overlap_without_time(transaction: dict, db: Session):
    incoming_counterparty = str(transaction.get("counterparty_identifier") or "").strip()
    if not incoming_counterparty:
        return None

    sql = text(
        """
        SELECT
            t.id::text AS id,
            t.payment_source_name,
            t.statement_sources,
            t.vendor_name,
            t.narration,
            t.counterparty_identifier,
            t.transaction_time,
            t.running_balance
        FROM public.transactions AS t
        WHERE
            t.transaction_date = :transaction_date
            AND lower(COALESCE(t.direction, '')) = lower(:direction)
            AND ABS(COALESCE(t.amount, 0)) = ABS(:amount)
            AND COALESCE(t.payment_mode, '') = COALESCE(:payment_mode, '')
            AND lower(COALESCE(t.counterparty_identifier, '')) = lower(:counterparty_identifier)
        ORDER BY t.id ASC
        LIMIT 5
        """
    )

    candidates = db.execute(
        sql,
        {
            "transaction_date": transaction.get("transaction_date"),
            "direction": transaction.get("type"),
            "amount": transaction.get("amount"),
            "payment_mode": transaction.get("payment_mode"),
            "counterparty_identifier": incoming_counterparty,
        },
    ).mappings().all()

    incoming_running_balance = transaction.get("running_balance")
    if incoming_running_balance is not None:
        balance_matches = [
            candidate
            for candidate in candidates
            if amounts_match(candidate.get("running_balance"), incoming_running_balance)
        ]
        if len(balance_matches) == 1:
            return balance_matches[0]

    if len(candidates) != 1:
        return None

    candidate = candidates[0]
    if can_merge_without_time(candidate, transaction):
        return candidate
    return None


def find_matching_running_balance(
    transaction: dict, db: Session, tolerance_seconds: int = 300
):
    sql = text(
        """
        WITH candidate_rows AS (
            SELECT
                t.counterparty_identifier,
                t.running_balance,
                t.transaction_time,
                CASE
                    WHEN :transaction_time IS NOT NULL AND t.transaction_time IS NOT NULL THEN ABS(
                        EXTRACT(
                            EPOCH FROM (t.transaction_time::time - CAST(:transaction_time AS time))
                        )
                    )
                    ELSE NULL
                END AS time_diff_seconds,
                COUNT(*) OVER () AS candidate_count
            FROM public.transactions AS t
            WHERE
                t.transaction_date = :transaction_date
                AND lower(COALESCE(t.direction, '')) = lower(:direction)
                AND ABS(COALESCE(t.amount, 0)) = ABS(:amount)
                AND t.running_balance IS NOT NULL
                AND (
                    :payment_mode IS NULL
                    OR COALESCE(t.payment_mode, '') = COALESCE(:payment_mode, '')
                )
        )
        SELECT
            running_balance
        FROM candidate_rows
        WHERE
            (
                time_diff_seconds IS NOT NULL
                AND time_diff_seconds <= :tolerance_seconds
            )
            OR (
                candidate_count = 1
                AND (
                    :transaction_time IS NULL
                    OR transaction_time IS NULL
                )
            )
        ORDER BY
            CASE
                WHEN time_diff_seconds IS NOT NULL THEN time_diff_seconds
                ELSE 999999
            END,
            running_balance ASC
        LIMIT 1
        """
    )

    row = db.execute(
        sql,
        {
            "transaction_date": transaction.get("transaction_date"),
            "direction": transaction.get("type"),
            "amount": transaction.get("amount"),
            "payment_mode": transaction.get("payment_mode"),
            "transaction_time": transaction.get("transaction_time"),
            "tolerance_seconds": tolerance_seconds,
        },
    ).mappings().first()

    return row.get("running_balance") if row else None


def update_existing_transaction_from_overlap(
    existing_row, incoming_transaction: dict, db: Session
):
    incoming_source = normalize_source_name(incoming_transaction.get("payment_source_name"))
    merged_sources = parse_statement_sources(existing_row.get("statement_sources"))
    if incoming_source:
        merged_sources.add(incoming_source)
    merged_primary_source = choose_primary_source(
        existing_row.get("payment_source_name"), incoming_source
    )

    sql = text(
        """
        UPDATE public.transactions
        SET
            payment_source_name = :payment_source_name,
            statement_sources = :statement_sources,
            vendor_name = :vendor_name,
            narration = :narration,
            counterparty_identifier = :counterparty_identifier,
            running_balance = COALESCE(:running_balance, running_balance),
            transaction_time = COALESCE(:transaction_time, transaction_time)
        WHERE id = :transaction_id
        """
    )

    db.execute(
        sql,
        {
            "transaction_id": existing_row["id"],
            "payment_source_name": merged_primary_source,
            "statement_sources": serialize_statement_sources(merged_sources),
            "vendor_name": pick_better_text(
                existing_row.get("vendor_name"), incoming_transaction.get("vendor_name")
            ),
            "narration": pick_better_narration(
                existing_row.get("narration"), incoming_transaction.get("narration")
            ),
            "counterparty_identifier": pick_better_text(
                existing_row.get("counterparty_identifier"),
                incoming_transaction.get("counterparty_identifier"),
            ),
            "running_balance": incoming_transaction.get("running_balance"),
            "transaction_time": incoming_transaction.get("transaction_time"),
        },
    )


def choose_duplicate_keep_row(rows: list[dict]) -> dict:
    return max(
        rows,
        key=lambda row: (
            row.get("transaction_time") is not None,
            len(parse_statement_sources(row.get("statement_sources"))),
            len(normalize_text_value(row.get("vendor_name"))),
            len(normalize_text_value(row.get("narration"))),
            len(normalize_text_value(row.get("counterparty_identifier"))),
            row.get("id"),
        ),
    )


def merge_duplicate_text(rows: list[dict], field_name: str):
    merged_value = None
    for row in rows:
        merged_value = pick_better_text(merged_value, row.get(field_name))
    return merged_value


def merge_duplicate_narration(rows: list[dict]):
    merged_value = None
    for row in rows:
        merged_value = pick_better_narration(merged_value, row.get("narration"))
    return merged_value


def should_dedupe_exact_group(rows: list[dict]) -> bool:
    distinct_non_null_times = {
        normalize_time_value(row.get("transaction_time"))
        for row in rows
        if normalize_time_value(row.get("transaction_time"))
    }
    return len(distinct_non_null_times) <= 1


def dedupe_exact_transaction_rows(db: Session):
    duplicate_groups = db.execute(
        text(
            """
            SELECT
                COALESCE(payment_source_name, '') AS payment_source_name,
                transaction_date,
                lower(COALESCE(direction, '')) AS direction,
                ABS(COALESCE(amount, 0)) AS amount,
                running_balance,
                COALESCE(lower(counterparty_identifier), '') AS counterparty_identifier
            FROM public.transactions
            WHERE running_balance IS NOT NULL
            GROUP BY
                COALESCE(payment_source_name, ''),
                transaction_date,
                lower(COALESCE(direction, '')),
                ABS(COALESCE(amount, 0)),
                running_balance,
                COALESCE(lower(counterparty_identifier), '')
            HAVING COUNT(*) > 1
            """
        )
    ).mappings().all()

    removed_count = 0
    for group in duplicate_groups:
        rows = db.execute(
            text(
                """
                SELECT
                    id::text AS id,
                    payment_source_name,
                    statement_sources,
                    vendor_name,
                    narration,
                    counterparty_identifier,
                    transaction_time,
                    running_balance
                FROM public.transactions
                WHERE COALESCE(payment_source_name, '') = :payment_source_name
                  AND transaction_date = :transaction_date
                  AND lower(COALESCE(direction, '')) = :direction
                  AND ABS(COALESCE(amount, 0)) = :amount
                  AND running_balance = :running_balance
                  AND COALESCE(lower(counterparty_identifier), '') = :counterparty_identifier
                ORDER BY id ASC
                """
            ),
            dict(group),
        ).mappings().all()
        if len(rows) <= 1:
            continue
        if not should_dedupe_exact_group(rows):
            continue

        keep_row = choose_duplicate_keep_row(rows)
        duplicate_rows = [row for row in rows if row["id"] != keep_row["id"]]
        merged_primary_source = keep_row.get("payment_source_name")
        merged_sources = parse_statement_sources(keep_row.get("statement_sources"))
        for row in duplicate_rows:
            merged_primary_source = choose_primary_source(
                merged_primary_source, row.get("payment_source_name")
            )
            merged_sources.update(parse_statement_sources(row.get("statement_sources")))

        db.execute(
            text(
                """
                UPDATE public.transactions
                SET
                    payment_source_name = :payment_source_name,
                    statement_sources = :statement_sources,
                    vendor_name = :vendor_name,
                    narration = :narration,
                    counterparty_identifier = :counterparty_identifier,
                    transaction_time = :transaction_time
                WHERE id = :transaction_id
                """
            ),
            {
                "transaction_id": keep_row["id"],
                "payment_source_name": merged_primary_source,
                "statement_sources": serialize_statement_sources(merged_sources),
                "vendor_name": merge_duplicate_text(rows, "vendor_name"),
                "narration": merge_duplicate_narration(rows),
                "counterparty_identifier": merge_duplicate_text(
                    rows, "counterparty_identifier"
                ),
                "transaction_time": keep_row.get("transaction_time")
                or next(
                    (
                        row.get("transaction_time")
                        for row in duplicate_rows
                        if row.get("transaction_time") is not None
                    ),
                    None,
                ),
            },
        )
        for row in duplicate_rows:
            db.execute(
                text(
                    """
                    DELETE FROM public.transactions
                    WHERE id = :transaction_id
                    """
                ),
                {"transaction_id": row["id"]},
            )
        removed_count += len(duplicate_rows)

    if removed_count:
        db.commit()
    return removed_count


def update_statement_matched_transaction(existing_row: dict, authoritative_row: dict, db: Session):
    db.execute(
        text(
            """
            UPDATE public.transactions
            SET
                payment_source_name = :payment_source_name,
                statement_sources = :statement_sources,
                payment_mode = :payment_mode,
                transaction_time = :transaction_time,
                running_balance = :running_balance,
                narration = :narration,
                counterparty_identifier = :counterparty_identifier,
                vendor_name = :vendor_name
            WHERE id = :transaction_id
            """
        ),
        {
            "transaction_id": existing_row["id"],
            "payment_source_name": authoritative_row.get("payment_source_name"),
            "statement_sources": authoritative_row.get("statement_sources"),
            "payment_mode": authoritative_row.get("payment_mode"),
            "transaction_time": authoritative_row.get("transaction_time"),
            "running_balance": authoritative_row.get("running_balance"),
            "narration": authoritative_row.get("narration"),
            "counterparty_identifier": authoritative_row.get("counterparty_identifier"),
            "vendor_name": pick_better_text(
                authoritative_row.get("vendor_name"),
                existing_row.get("vendor_name"),
            ),
        },
    )


def move_transaction_tags(old_transaction_id: str, new_transaction_id: str, db: Session):
    db.execute(
        text(
            """
            INSERT INTO public.transaction_tags (transaction_id, tag_id, applied_by, applied_at)
            SELECT
                CAST(:new_transaction_id AS uuid),
                tt.tag_id,
                tt.applied_by,
                tt.applied_at
            FROM public.transaction_tags tt
            WHERE tt.transaction_id = CAST(:old_transaction_id AS uuid)
            ON CONFLICT (transaction_id, tag_id) DO NOTHING
            """
        ),
        {
            "old_transaction_id": old_transaction_id,
            "new_transaction_id": new_transaction_id,
        },
    )
    db.execute(
        text(
            """
            DELETE FROM public.transaction_tags
            WHERE transaction_id = CAST(:old_transaction_id AS uuid)
            """
        ),
        {"old_transaction_id": old_transaction_id},
    )


def move_transaction_split(old_transaction_id: str, new_transaction_id: str, db: Session):
    existing_new_split = db.execute(
        text(
            """
            SELECT id
            FROM public.transaction_splits
            WHERE transaction_id = CAST(:transaction_id AS uuid)
            """
        ),
        {"transaction_id": new_transaction_id},
    ).scalar()
    if existing_new_split:
        return False

    updated = db.execute(
        text(
            """
            UPDATE public.transaction_splits
            SET transaction_id = CAST(:new_transaction_id AS uuid)
            WHERE transaction_id = CAST(:old_transaction_id AS uuid)
            """
        ),
        {
            "old_transaction_id": old_transaction_id,
            "new_transaction_id": new_transaction_id,
        },
    ).rowcount or 0
    return bool(updated)


def move_recovery_links(old_transaction_id: str, new_transaction_id: str, db: Session):
    existing_new_recovery = db.execute(
        text(
            """
            SELECT id
            FROM public.transaction_split_recoveries
            WHERE recovery_transaction_id = CAST(:transaction_id AS uuid)
            """
        ),
        {"transaction_id": new_transaction_id},
    ).scalar()
    if existing_new_recovery:
        return False

    updated = db.execute(
        text(
            """
            UPDATE public.transaction_split_recoveries
            SET recovery_transaction_id = CAST(:new_transaction_id AS uuid)
            WHERE recovery_transaction_id = CAST(:old_transaction_id AS uuid)
            """
        ),
        {
            "old_transaction_id": old_transaction_id,
            "new_transaction_id": new_transaction_id,
        },
    ).rowcount or 0
    return bool(updated)


def delete_transaction_and_dependents(transaction_id: str, db: Session):
    db.execute(
        text(
            """
            DELETE FROM public.transaction_tags
            WHERE transaction_id = CAST(:transaction_id AS uuid)
            """
        ),
        {"transaction_id": transaction_id},
    )
    db.execute(
        text(
            """
            DELETE FROM public.transaction_split_recoveries
            WHERE recovery_transaction_id = CAST(:transaction_id AS uuid)
            """
        ),
        {"transaction_id": transaction_id},
    )
    db.execute(
        text(
            """
            DELETE FROM public.transaction_splits
            WHERE transaction_id = CAST(:transaction_id AS uuid)
            """
        ),
        {"transaction_id": transaction_id},
    )
    db.execute(
        text(
            """
            DELETE FROM public.transactions
            WHERE id = CAST(:transaction_id AS uuid)
            """
        ),
        {"transaction_id": transaction_id},
    )


def align_transactions_to_statement(transactions: list[dict], db: Session):
    normalized_transactions = [
        normalize_transaction_row(transaction)
        for transaction in transactions
        if transaction.get("transaction_date") is not None
    ]
    if not normalized_transactions:
        return {
            "matched_count": 0,
            "updated_count": 0,
            "retimed_count": 0,
            "inserted_count": 0,
            "deleted_count": 0,
        }

    source_names = {
        normalize_source_name(transaction.get("payment_source_name"))
        for transaction in normalized_transactions
        if normalize_source_name(transaction.get("payment_source_name"))
    }
    if len(source_names) != 1:
        raise ValueError("Statement alignment expects rows from one source at a time.")

    source_name = next(iter(source_names))
    from_date = min(transaction["transaction_date"] for transaction in normalized_transactions)
    to_date = max(transaction["transaction_date"] for transaction in normalized_transactions)

    existing_rows = db.execute(
        text(
            """
            SELECT
                id::text AS id,
                transaction_date,
                transaction_time,
                lower(COALESCE(direction, '')) AS direction,
                amount,
                running_balance,
                counterparty_identifier,
                vendor_name,
                narration,
                payment_mode,
                payment_source_name,
                statement_sources
            FROM public.transactions
            WHERE payment_source_name = :payment_source_name
              AND transaction_date BETWEEN :from_date AND :to_date
            ORDER BY transaction_date ASC, transaction_time ASC NULLS LAST, id ASC
            """
        ),
        {
            "payment_source_name": source_name,
            "from_date": from_date,
            "to_date": to_date,
        },
    ).mappings().all()

    parsed_by_full = {}
    for row in normalized_transactions:
        parsed_by_full[build_transaction_match_key(row)] = row
    existing_by_full = {}
    for row in existing_rows:
        existing_by_full.setdefault(build_transaction_match_key(row), []).append(row)

    matched_pairs = []
    matched_existing_ids = set()
    matched_parsed_keys = set()

    for match_key, parsed_row in parsed_by_full.items():
        candidates = existing_by_full.get(match_key, [])
        if len(candidates) == 1:
            matched_pairs.append((candidates[0], parsed_row, "exact"))
            matched_existing_ids.add(candidates[0]["id"])
            matched_parsed_keys.add(match_key)

    unmatched_parsed_rows = [
        row for key, row in parsed_by_full.items() if key not in matched_parsed_keys
    ]
    unmatched_existing_rows = [
        row for row in existing_rows if row["id"] not in matched_existing_ids
    ]

    unmatched_existing_by_loose = {}
    for row in unmatched_existing_rows:
        unmatched_existing_by_loose.setdefault(build_transaction_loose_key(row), []).append(row)

    for parsed_row in unmatched_parsed_rows:
        candidates = unmatched_existing_by_loose.get(build_transaction_loose_key(parsed_row), [])
        if len(candidates) != 1:
            continue
        candidate = candidates[0]
        matched_pairs.append((candidate, parsed_row, "retimed"))
        matched_existing_ids.add(candidate["id"])
        matched_parsed_keys.add(build_transaction_match_key(parsed_row))
        unmatched_existing_by_loose[build_transaction_loose_key(parsed_row)] = []

    unmatched_parsed_rows = [
        row for key, row in parsed_by_full.items() if key not in matched_parsed_keys
    ]
    unmatched_existing_rows = [
        row for row in existing_rows if row["id"] not in matched_existing_ids
    ]

    updated_count = 0
    retimed_count = 0
    for existing_row, authoritative_row, match_kind in matched_pairs:
        existing_key = build_transaction_match_key(existing_row)
        authoritative_key = build_transaction_match_key(authoritative_row)
        if (
            existing_key != authoritative_key
            or normalize_amount_value(existing_row.get("running_balance"))
            != normalize_amount_value(authoritative_row.get("running_balance"))
            or normalize_text_value(existing_row.get("payment_mode"))
            != normalize_text_value(authoritative_row.get("payment_mode"))
            or normalize_text_value(existing_row.get("narration"))
            != normalize_text_value(authoritative_row.get("narration"))
        ):
            update_statement_matched_transaction(existing_row, authoritative_row, db)
            updated_count += 1
            if match_kind == "retimed":
                retimed_count += 1

    if unmatched_parsed_rows:
        insert_new_transactions(unmatched_parsed_rows, db)

    deleted_count = 0
    for existing_row in unmatched_existing_rows:
        same_direction_candidates = db.execute(
            text(
                """
                SELECT id::text AS id
                FROM public.transactions
                WHERE payment_source_name = :payment_source_name
                  AND transaction_date = :transaction_date
                  AND lower(COALESCE(direction, '')) = :direction
                  AND ABS(COALESCE(amount, 0)) = :amount
                  AND lower(COALESCE(counterparty_identifier, '')) = :counterparty_identifier
                  AND id::text <> :transaction_id
                ORDER BY transaction_time ASC NULLS LAST, id ASC
                """
            ),
            {
                "payment_source_name": source_name,
                "transaction_date": existing_row.get("transaction_date"),
                "direction": normalize_text_value(existing_row.get("direction")).lower(),
                "amount": normalize_amount_value(existing_row.get("amount")),
                "counterparty_identifier": normalize_counterparty_value(
                    existing_row.get("counterparty_identifier")
                ),
                "transaction_id": existing_row["id"],
            },
        ).scalars().all()

        if len(same_direction_candidates) == 1:
            canonical_id = same_direction_candidates[0]
            move_transaction_tags(existing_row["id"], canonical_id, db)
            move_transaction_split(existing_row["id"], canonical_id, db)
            move_recovery_links(existing_row["id"], canonical_id, db)
            delete_transaction_and_dependents(existing_row["id"], db)
            deleted_count += 1
            continue

        delete_transaction_and_dependents(existing_row["id"], db)
        deleted_count += 1

    db.commit()
    return {
        "matched_count": len(matched_pairs),
        "updated_count": updated_count,
        "retimed_count": retimed_count,
        "inserted_count": len(unmatched_parsed_rows),
        "deleted_count": deleted_count,
    }


def insert_new_transactions(transactions: list[dict], db: Session):
    if not transactions:
        return

    sql = text(
        """
        INSERT INTO transactions (
            transaction_date,
            amount,
            running_balance,
            counterparty_identifier,
            direction,
            payment_source_name,
            payment_mode,
            transaction_time,
            narration,
            vendor_name,
            statement_sources
        )
        VALUES (
            :transaction_date,
            :amount,
            :running_balance,
            :counterparty_identifier,
            :type,
            :payment_source_name,
            :payment_mode,
            :transaction_time,
            :narration,
            :vendor_name,
            :statement_sources
        )
        """
    )

    db.execute(sql, transactions)


def write_transactions_to_db(transactions: list[dict], db: Session):
    if not transactions:
        return {"processed_count": 0, "inserted_count": 0, "merged_count": 0}

    normalized_transactions = [
        normalize_transaction_row(transaction) for transaction in transactions
    ]

    inserts = []
    merged_count = 0
    skipped_count = 0
    for transaction in normalized_transactions:
        if transaction.get("running_balance") is None:
            transaction["running_balance"] = find_matching_running_balance(transaction, db)

        existing_row = find_overlapping_transaction(transaction, db)
        if not existing_row and transaction.get("transaction_time") is None:
            existing_row = find_overlap_without_time(transaction, db)
        if existing_row:
            update_existing_transaction_from_overlap(existing_row, transaction, db)
            merged_count += 1
        else:
            if transaction.get("running_balance") is None:
                skipped_count += 1
                # # print(
                #     "Skipping transaction because running_balance could not be inferred:",
                #     transaction,
                # )
                continue
            inserts.append(transaction)

    insert_new_transactions(inserts, db)
    db.commit()
    return {
        "processed_count": len(normalized_transactions),
        "inserted_count": len(inserts),
        "merged_count": merged_count,
        "skipped_count": skipped_count,
    }
