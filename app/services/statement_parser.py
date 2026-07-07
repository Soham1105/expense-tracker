import re
from datetime import datetime
from os import PathLike

import pandas as pd
from pypdf import PdfReader
from pypdf.errors import FileNotDecryptedError
from pygrok import Grok

from core.error_handler import safe_execute
from core.exceptions import ParsingError


BOB_HEADER_MAP = {
    "TRAN DATE": ["tran date", "transaction date"],
    "VALUE DATE": ["value date"],
    "NARRATION": ["narration", "description", "particulars"],
    "CHQ.NO.": ["chq.no.", "chq", "cheque"],
    "WITHDRAWAL(DR)": ["withdrawal(dr)", "withdrawal", "debit", "dr"],
    "DEPOSIT(CR)": ["deposit(cr)", "deposit", "credit", "cr"],
    "BALANCE(INR)": ["balance(inr)", "balance"],
}

STATEMENT_SOURCE_CONFIGS = {
    "BOB":        {"payment_source_name": "BOB",        "parser": "bob"},
    "RBL":        {"payment_source_name": "RBL",        "parser": "generic"},
    "GPAY":       {"payment_source_name": "GPAY",       "parser": "generic"},
    "CRED":       {"payment_source_name": "CRED",       "parser": "generic"},
    "KOTAK":      {"payment_source_name": "KOTAK",      "parser": "kotak"},
    "SUPERMONEY": {"payment_source_name": "SUPERMONEY", "parser": "supermoney"},
    "UNION":      {"payment_source_name": "UNION",      "parser": "generic"},
    "DCB":        {"payment_source_name": "DCB",        "parser": "generic"},
}
BANK_SOURCE_NAMES = {
    "BOB",
    "RBL",
    "HDFC",
    "ICICI",
    "SBI",
    "AXIS",
    "KOTAK",
    "IDFC",
    "YES",
    "INDUSIND",
    "UNION",
    "DCB",
}

GENERIC_COLUMN_ALIASES = {
    "transaction_date": [
        "transaction date",
        "date",
        "txn date",
        "tran date",
        "post date",
        "posted date",
        "value date",
        "created date",
    ],
    "transaction_time": [
        "transaction time",
        "time",
        "txn time",
        "posted time",
    ],
    "vendor_name": [
        "vendor",
        "vendor name",
        "merchant",
        "merchant name",
        "paid to",
        "beneficiary",
        "description",
        "transaction description",
        "transaction remarks",
        "narration",
        "particulars",
        "remarks",
    ],
    "counterparty_identifier": [
        "counterparty",
        "counterparty identifier",
        "upi id",
        "vpa",
        "payer/payee",
        "receiver",
        "payee",
        "transaction id",
        "utr",
        "rrn",
    ],
    "amount": [
        "amount",
        "transaction amount",
        "txn amount",
        "value",
    ],
    "withdrawal": [
        "withdrawal(dr)",
        "withdrawal",
        "withdrawals",
        "withdrawal amt",
        "withdrawal amt.",
        "withdrawal amount",
        "debit",
        "debit amount",
        "debit amt",
        "debit amt.",
        "dr amount",
    ],
    "credit": [
        "deposit(cr)",
        "deposit",
        "deposits",
        "deposit amt",
        "deposit amt.",
        "deposit amount",
        "credit amt",
        "credit amt.",
        "credit",
        "credit amount",
        "cr amount",
    ],
    "direction": [
        "direction",
        "type",
        "transaction type",
        "dr/cr",
        "debit/credit",
    ],
    "running_balance": [
        "balance",
        "running balance",
        "current balance",
        "available balance",
    ],
    "payment_mode": [
        "payment mode",
        "mode",
        "payment method",
        "instrument",
        "channel",
    ],
}

GPAY_DATE_PATTERN = re.compile(
    r"^\d{1,2}(?:\s+[A-Za-z]{3},\s+\d{4}|[A-Za-z]{3},\d{4})$",
    re.IGNORECASE,
)
GPAY_TIME_PATTERN = re.compile(r"^\d{1,2}:\d{2}\s*(?:AM|PM)$", re.IGNORECASE)
GPAY_AMOUNT_PATTERN = re.compile(r"^(?:₹|â‚¹)?\s*([\d,]+(?:\.\d{1,2})?)$")
GPAY_UPI_ID_PATTERN = re.compile(
    r"UPI\s*Transaction\s*ID:\s*([A-Za-z0-9]+)", re.IGNORECASE
)
GPAY_HEADER_LINES = {
    "date & time",
    "transaction details",
    "amount",
    "date&time",
    "transactionstatement",
    "transaction statement",
}
RBL_DATE_PATTERN = re.compile(r"^\d{1,2}-\d{1,2}-\d{2,4}$")
RBL_REF_PATTERN = re.compile(r"^[A-Za-z0-9/\-_.]{4,}$")

SUPERMONEY_DATE_PATTERN = re.compile(
    r"^\d{1,2}\s+(?:January|February|March|April|May|June|July|August|"
    r"September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
    r"\s+\d{4}$",
    re.IGNORECASE,
)
SUPERMONEY_AMOUNT_PATTERN = re.compile(
    r"^([+\-−]?)\s*(?:₹|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)$"
)
SUPERMONEY_BANK_MAP = {
    "bank of baroda": "BOB", "bob": "BOB",
    "hdfc": "HDFC", "hdfc bank": "HDFC",
    "rbl": "RBL", "rbl bank": "RBL",
    "icici": "ICICI", "icici bank": "ICICI",
    "sbi": "SBI", "state bank": "SBI",
    "axis": "AXIS", "axis bank": "AXIS",
    "kotak": "KOTAK", "kotak mahindra": "KOTAK",
    "idfc": "IDFC", "idfc first": "IDFC",
    "yes bank": "YES", "yes": "YES",
    "indusind": "INDUSIND",
}


def normalize_header_name(value: str) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


def normalize_source_name(value):
    normalized = str(value or "").strip().upper()
    return normalized or None


def clean_string(value):
    if value is None:
        return None
    cleaned = str(value).strip()
    if not cleaned or cleaned.lower() in {"nan", "nat", "none"}:
        return None
    return cleaned


def compact_text(value):
    return re.sub(r"\s+", "", clean_string(value) or "")


def normalize_gpay_date_text(value):
    compact = compact_text(value).replace(".", "")
    if not compact:
        return None

    match = re.match(r"^(\d{1,2})([A-Za-z]{3}),(\d{4})$", compact)
    if match:
        day, month, year = match.groups()
        return f"{day} {month} {year}"
    return clean_string(value)


def normalize_gpay_time_text(value):
    compact = compact_text(value)
    if not compact:
        return None

    match = re.match(r"^(\d{1,2}:\d{2})(AM|PM)$", compact, re.IGNORECASE)
    if match:
        time_part, meridiem = match.groups()
        return f"{time_part} {meridiem.upper()}"
    return clean_string(value)


def prettify_gpay_compact_text(value):
    compact = compact_text(value)
    if not compact:
        return None

    replacements = {
        "Receivedfrom": "Received from ",
        "Paidto": "Paid to ",
        "Paidby": "Paid by ",
        "Sentto": "Sent to ",
        "Paidfor": "Paid for ",
        "BankofBaroda": "Bank of Baroda",
        "StateBankofIndia": "State Bank of India",
        "GooglePay": "Google Pay",
    }
    pretty = compact
    for source, target in replacements.items():
        pretty = pretty.replace(source, target)

    pretty = re.sub(r"([a-z])([A-Z])", r"\1 \2", pretty)
    pretty = re.sub(r"([A-Za-z])(\d)", r"\1 \2", pretty)
    pretty = re.sub(r"(\d)([A-Za-z])", r"\1 \2", pretty)
    pretty = re.sub(r"\s+", " ", pretty).strip()
    return pretty


def infer_bank_source_name(value, fallback=None):
    normalized = normalize_header_name(value or "")
    if "bank of baroda" in normalized:
        return "BOB"
    if "rbl" in normalized:
        return "RBL"
    if "hdfc" in normalized:
        return "HDFC"
    if "icici" in normalized:
        return "ICICI"
    if "axis" in normalized:
        return "AXIS"
    if "sbi" in normalized or "state bank of india" in normalized:
        return "SBI"
    if "kotak" in normalized:
        return "KOTAK"
    if "idfc" in normalized:
        return "IDFC"
    if "yes bank" in normalized or normalized == "yes":
        return "YES"
    if "union bank" in normalized or normalized == "union" or "ubin" in normalized:
        return "UNION"
    if "dcb bank" in normalized or normalized == "dcb":
        return "DCB"
    return fallback


def infer_payment_mode_from_text(value):
    normalized = normalize_header_name(value or "")
    if not normalized:
        return "bank"

    payment_mode_keywords = {
        "upi": "upi",
        "neft": "neft",
        "rtgs": "rtgs",
        "imps": "imps",
        "ift": "ift",
        "atm": "atm",
        "cash": "cash",
        "pos": "card",
        "debit card": "card",
        "credit card": "card",
        "cheque": "cheque",
        "chq": "cheque",
    }
    for keyword, payment_mode in payment_mode_keywords.items():
        if keyword in normalized:
            return payment_mode
    return "bank"


def build_statement_sources(primary_source_name, channel_source_name="OTHER"):
    ordered_sources = []
    for source in (primary_source_name, channel_source_name):
        normalized_source = normalize_source_name(source)
        if normalized_source and normalized_source not in ordered_sources:
            ordered_sources.append(normalized_source)
    return ",".join(ordered_sources)


def parse_amount(value):
    cleaned = clean_string(value)
    if cleaned is None:
        return None

    normalized = (
        cleaned.replace(",", "")
        .replace("inr", "")
        .replace("rs.", "")
        .replace("rs", "")
        .replace("₹", "")
        .replace("â‚¹", "")
        .strip()
    )
    if normalized.endswith("cr"):
        normalized = normalized[:-2].strip()
    if normalized.endswith("dr"):
        normalized = normalized[:-2].strip()
    if normalized.startswith("(") and normalized.endswith(")"):
        normalized = f"-{normalized[1:-1].strip()}"
    try:
        return float(normalized)
    except ValueError:
        return None


def parse_date_value(value):
    cleaned = clean_string(value)
    if cleaned is None:
        return None

    parsed = pd.to_datetime(cleaned, dayfirst=True, errors="coerce")
    if pd.isna(parsed):
        parsed = pd.to_datetime(
            normalize_gpay_date_text(cleaned), dayfirst=True, errors="coerce"
        )
    if pd.isna(parsed):
        return None
    return parsed.date()


def parse_time_value(value):
    cleaned = clean_string(value)
    if cleaned is None:
        return None

    for fmt in ("%H:%M:%S", "%H:%M", "%I:%M %p", "%I:%M:%S %p"):
        try:
            return datetime.strptime(cleaned, fmt).time().strftime("%H:%M:%S")
        except ValueError:
            continue

    normalized = normalize_gpay_time_text(cleaned)
    if normalized and normalized != cleaned:
        for fmt in ("%I:%M %p", "%I:%M:%S %p"):
            try:
                return datetime.strptime(normalized, fmt).time().strftime("%H:%M:%S")
            except ValueError:
                continue

    parsed = pd.to_datetime(cleaned, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.time().strftime("%H:%M:%S")


def infer_direction(raw_direction, amount, withdrawal_amount, credit_amount):
    normalized_direction = (clean_string(raw_direction) or "").lower()
    if normalized_direction:
        if any(token in normalized_direction for token in ["withdraw", "debit", "dr"]):
            return "withdrawal"
        if any(token in normalized_direction for token in ["credit", "deposit", "cr"]):
            return "credit"

    if withdrawal_amount is not None and withdrawal_amount > 0:
        return "withdrawal"
    if credit_amount is not None and credit_amount > 0:
        return "credit"
    if amount is not None:
        return "credit" if amount < 0 else "withdrawal"
    return None


def find_matching_column(columns, canonical_name):
    aliases = GENERIC_COLUMN_ALIASES.get(canonical_name, [])
    normalized_columns = {normalize_header_name(column): column for column in columns}
    for alias in aliases:
        if alias in normalized_columns:
            return normalized_columns[alias]
    return None


def extract_transaction_id(transaction_id):
    cleaned_id = clean_string(transaction_id) or ""
    if cleaned_id.lower().startswith("upi/"):
        normalized_id = cleaned_id.lower()
        patterns = [
            Grok(
                "upi/[0-9]+/%{TIME:transaction_time}/%{DATA:payment_mode}/%{GREEDYDATA:counterparty_identifier}"
            ),
            Grok("upi/[0-9]+/%{TIME:transaction_time}/%{GREEDYDATA:payment_mode}"),
        ]
        for pattern in patterns:
            extracted = pattern.match(normalized_id)
            if extracted:
                extracted.setdefault("counterparty_identifier", normalized_id)
                return extracted
    return {}


def extract_bank_narration_metadata(narration):
    cleaned_narration = clean_string(narration) or ""
    if not cleaned_narration:
        return {}

    compact_narration = cleaned_narration.strip()
    upi_start = compact_narration.lower().find("upi/")
    if upi_start >= 0:
        extracted = extract_transaction_id(compact_narration[upi_start:])
        if extracted:
            return {
                "transaction_time": parse_time_value(extracted.get("transaction_time")),
                "payment_mode": clean_string(extracted.get("payment_mode")) or "upi",
                "counterparty_identifier": clean_string(
                    extracted.get("counterparty_identifier")
                ),
            }

    payment_mode = infer_payment_mode_from_text(cleaned_narration)
    return {"payment_mode": payment_mode}


def validate_bob_transaction(transaction):
    try:
        if transaction["transaction_date"]:
            datetime.strptime(transaction["transaction_date"], "%d/%m/%Y")
        datetime.strptime(transaction["value_date"], "%d/%m/%Y")
        if transaction.get("withdrawal"):
            float(transaction["withdrawal"])
        if transaction.get("credit"):
            float(transaction["credit"])
        float(transaction["balance"])
        return True
    except (ValueError, KeyError):
        return False


def normalize_bob_transaction(transaction, payment_source_name="BOB"):
    raw_transaction_text = clean_string(transaction.get("transaction_id", "")) or ""
    extracted_transaction_id = extract_transaction_id(raw_transaction_text)
    narration_metadata = extract_bank_narration_metadata(raw_transaction_text)

    transaction_date = (
        datetime.strptime(transaction["transaction_date"], "%d/%m/%Y").date()
        if transaction["transaction_date"]
        else None
    )

    if transaction.get("withdrawal"):
        direction = "withdrawal"
        amount = float(transaction["withdrawal"])
    elif transaction.get("credit"):
        direction = "credit"
        amount = float(transaction["credit"])
    else:
        return {}

    counterparty_identifier = (
        clean_string(extracted_transaction_id.get("counterparty_identifier"))
        or clean_string(narration_metadata.get("counterparty_identifier"))
        or raw_transaction_text
        or f"{payment_source_name}-{transaction_date}-{direction}-{amount}-{transaction.get('balance')}"
    )
    payment_mode = (
        clean_string(extracted_transaction_id.get("payment_mode"))
        or clean_string(narration_metadata.get("payment_mode"))
        or infer_payment_mode_from_text(raw_transaction_text)
    )

    return {
        "transaction_date": transaction_date,
        "type": direction,
        "amount": amount,
        "running_balance": float(transaction["balance"]),
        "narration": raw_transaction_text,
        "transaction_time": (
            parse_time_value(extracted_transaction_id.get("transaction_time"))
            or narration_metadata.get("transaction_time")
        ),
        "payment_mode": payment_mode,
        "counterparty_identifier": counterparty_identifier,
        "payment_source_name": payment_source_name,
        "vendor_name": None,
        "statement_sources": build_statement_sources(payment_source_name, "OTHER"),
    }


def extract_bob_transactions(df, payment_source_name):
    transactions = []
    check_the_header = 0
    pattern = Grok(
        "%{DATE:transaction_date}  %{DATE:value_date}  %{DATA:transaction_id}    (%{NUMBER:withdrawal})?    (%{NUMBER:credit})?   %{NUMBER:balance}cr"
    )

    for _, row in df.iterrows():
        row_text = " ".join(row.astype(str).str.lower())
        if check_the_header < 4:
            check_the_header = sum(
                any(alias in row_text for alias in aliases)
                for aliases in BOB_HEADER_MAP.values()
            )
        elif check_the_header > 4:
            extracted_transaction = pattern.match(row_text)
            if extracted_transaction and validate_bob_transaction(extracted_transaction):
                normalized_transaction = normalize_bob_transaction(
                    extracted_transaction, payment_source_name
                )
                if normalized_transaction:
                    transactions.append(normalized_transaction)

    return transactions


def parse_generic_statement(df, payment_source_name):
    prepared_df = df.copy()
    prepared_df.columns = [
        clean_string(column) or f"column_{index}"
        for index, column in enumerate(prepared_df.columns)
    ]
    prepared_df = prepared_df.fillna("")

    date_column = find_matching_column(prepared_df.columns, "transaction_date")
    amount_column = find_matching_column(prepared_df.columns, "amount")
    withdrawal_column = find_matching_column(prepared_df.columns, "withdrawal")
    credit_column = find_matching_column(prepared_df.columns, "credit")

    if not date_column:
        raise ParsingError("Could not find a transaction date column in this statement.")
    if not any([amount_column, withdrawal_column, credit_column]):
        raise ParsingError("Could not find an amount column in this statement.")

    time_column = find_matching_column(prepared_df.columns, "transaction_time")
    vendor_column = find_matching_column(prepared_df.columns, "vendor_name")
    counterparty_column = find_matching_column(prepared_df.columns, "counterparty_identifier")
    direction_column = find_matching_column(prepared_df.columns, "direction")
    balance_column = find_matching_column(prepared_df.columns, "running_balance")
    payment_mode_column = find_matching_column(prepared_df.columns, "payment_mode")

    transactions = []
    for _, row in prepared_df.iterrows():
        transaction_date = parse_date_value(row.get(date_column))
        if not transaction_date:
            continue

        withdrawal_amount = parse_amount(row.get(withdrawal_column)) if withdrawal_column else None
        credit_amount = parse_amount(row.get(credit_column)) if credit_column else None
        amount = parse_amount(row.get(amount_column)) if amount_column else None

        direction = infer_direction(
            row.get(direction_column) if direction_column else None,
            amount,
            withdrawal_amount,
            credit_amount,
        )
        if not direction:
            continue

        normalized_amount = amount
        if normalized_amount is None:
            normalized_amount = withdrawal_amount if direction == "withdrawal" else credit_amount
        if normalized_amount is None:
            continue

        vendor_name = clean_string(row.get(vendor_column)) if vendor_column else None
        counterparty_identifier = (
            clean_string(row.get(counterparty_column)) if counterparty_column else None
        )
        narration = vendor_name or counterparty_identifier or ""

        transactions.append(
            {
                "transaction_date": transaction_date,
                "type": direction,
                "amount": abs(normalized_amount),
                "running_balance": parse_amount(row.get(balance_column)) if balance_column else None,
                "narration": narration,
                "transaction_time": parse_time_value(row.get(time_column)) if time_column else None,
                "payment_mode": clean_string(row.get(payment_mode_column)) if payment_mode_column else "upi",
                "counterparty_identifier": counterparty_identifier,
                "payment_source_name": payment_source_name,
                "vendor_name": vendor_name,
                "statement_sources": build_statement_sources(payment_source_name, "OTHER"),
            }
        )

    return transactions


def parse_gpay_detail_line(detail_line: str):
    normalized = prettify_gpay_compact_text(detail_line) or clean_string(detail_line) or ""
    compact = compact_text(detail_line).lower()
    if compact.startswith("paidto"):
        return "withdrawal", normalized[len("Paid to "):].strip()
    if compact.startswith("receivedfrom"):
        return "credit", normalized[len("Received from "):].strip()
    if compact.startswith("sentto"):
        return "withdrawal", normalized[len("Sent to "):].strip()
    if compact.startswith("paidfor"):
        return "withdrawal", normalized[len("Paid for "):].strip()
    return None, normalized


def parse_gpay_bank_line(bank_line: str):
    compact = compact_text(bank_line)
    if not compact:
        return None

    compact_lower = compact.lower()
    for prefix in ("paidto", "paidby"):
        if compact_lower.startswith(prefix):
            tail = compact[len(prefix):]
            match = re.match(r"^(.*?)([0-9Xx*]{2,})?$", tail)
            if not match:
                break
            bank_name = prettify_gpay_compact_text(match.group(1))
            account_suffix = clean_string(match.group(2))
            action = "Paid to" if prefix == "paidto" else "Paid by"
            if account_suffix:
                return f"{action} {bank_name} {account_suffix}".strip()
            return f"{action} {bank_name}".strip()

    return prettify_gpay_compact_text(bank_line)


def open_pdf_reader(file_path: str, pdf_password: str | None = None):
    normalized_password = clean_string(pdf_password)
    try:
        if hasattr(file_path, "seek"):
            file_path.seek(0)
        reader = PdfReader(file_path)
        if getattr(reader, "is_encrypted", False):
            if not normalized_password:
                raise ParsingError(
                    "This PDF is password protected. Please enter the PDF password and try again."
                )
            decrypt_result = reader.decrypt(normalized_password)
            if not decrypt_result:
                raise ParsingError(
                    "Could not open the PDF with the provided password. Please check the password and try again."
                )

        # Force a lightweight page access check so encrypted PDFs fail here,
        # not later during extraction with a lower-level pypdf error.
        if len(reader.pages):
            reader.pages[0]
        return reader
    except ParsingError:
        raise
    except FileNotDecryptedError as exc:
        if normalized_password:
            raise ParsingError(
                "Could not open the PDF with the provided password. Please check the password and try again."
            ) from exc
        raise ParsingError(
            "This PDF is password protected. Please enter the PDF password and try again."
        ) from exc
    except Exception as exc:
        if normalized_password:
            raise ParsingError(
                "Could not open the PDF with the provided password. Please check the password and try again."
            ) from exc
        raise ParsingError(
            "Could not open the PDF. If the file is password protected, provide the PDF password and try again."
        ) from exc
    finally:
        normalized_password = None


def parse_gpay_pdf_statement(
    file_path: str,
    payment_source_name: str,
    pdf_password: str | None = None,
):
    lines = extract_gpay_pdf_text(file_path, pdf_password)
    transactions = []
    index = 0

    while index < len(lines):
        line = lines[index]
        if not GPAY_DATE_PATTERN.match(line):
            index += 1
            continue

        transaction_date = parse_date_value(line)
        time_line = lines[index + 1] if index + 1 < len(lines) else None
        detail_line = lines[index + 2] if index + 2 < len(lines) else None
        upi_line = lines[index + 3] if index + 3 < len(lines) else None
        bank_line = lines[index + 4] if index + 4 < len(lines) else None
        amount_line = lines[index + 5] if index + 5 < len(lines) else None

        if not all([transaction_date, time_line, detail_line, upi_line, bank_line, amount_line]):
            index += 1
            continue
        if not GPAY_TIME_PATTERN.match(time_line):
            index += 1
            continue

        amount_match = GPAY_AMOUNT_PATTERN.match(amount_line)
        upi_match = GPAY_UPI_ID_PATTERN.search(upi_line)
        direction, vendor_name = parse_gpay_detail_line(detail_line)
        bank_name = parse_gpay_bank_line(bank_line)

        if not amount_match or not upi_match or not bank_name or not direction:
            index += 1
            continue

        pretty_detail_line = prettify_gpay_compact_text(detail_line) or detail_line
        bank_source_name = infer_bank_source_name(bank_name, payment_source_name)

        transactions.append(
            {
                "transaction_date": transaction_date,
                "type": direction,
                "amount": parse_amount(amount_match.group(1)),
                "running_balance": None,
                "narration": " | ".join(part for part in [pretty_detail_line, bank_name] if part),
                "transaction_time": parse_time_value(time_line),
                "payment_mode": "upi",
                "counterparty_identifier": upi_match.group(1),
                "payment_source_name": bank_source_name,
                "vendor_name": vendor_name,
                "statement_sources": build_statement_sources(bank_source_name, "GPAY"),
            }
        )
        index += 6

    if not transactions:
        raise ParsingError(
            "Could not extract any transactions from the GPay PDF statement."
        )

    return transactions


def extract_gpay_pdf_text(file_path: str, pdf_password: str | None = None):
    reader = open_pdf_reader(file_path, pdf_password)
    lines = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        for raw_line in page_text.splitlines():
            line = clean_string(raw_line)
            if not line:
                continue
            normalized_line = normalize_header_name(line)
            compact_line = compact_text(line).lower()
            if normalized_line in GPAY_HEADER_LINES or compact_line in GPAY_HEADER_LINES:
                continue
            if compact_line.startswith("page") and "of" in compact_line:
                continue
            lines.append(line)
    return lines


def is_rbl_non_transaction_line(line: str):
    normalized = normalize_header_name(line)
    if not normalized:
        return True
    if (
        "date" in normalized
        and "narration" in normalized
        and "withdrawals" in normalized
        and "deposits" in normalized
        and "balance" in normalized
    ):
        return True
    ignored_snippets = (
        "statement of account",
        "account statement",
        "customer id",
        "account number",
        "branch",
        "page ",
        "generated on",
        "computer-generated statement",
        "this is computer-generated statement",
        "opening balance",
        "closing balance",
        "total ",
        "for any queries",
        "customer care",
        "call us",
        "email us",
        "registered office",
        "ifsc",
        "micr",
        "swift",
        "gstin",
        "website",
        "www.",
        "rbl bank",
        "account summary",
        "statement period",
    )
    return any(snippet in normalized for snippet in ignored_snippets)


def is_rbl_table_header_line(line: str):
    normalized = normalize_header_name(line)
    has_date      = "date" in normalized
    has_narration = "narration" in normalized or "particulars" in normalized or "description" in normalized
    has_debit     = "withdrawal" in normalized or "debit" in normalized or "dr" in normalized
    has_credit    = "deposit" in normalized or "credit" in normalized or "cr" in normalized
    has_balance   = "balance" in normalized
    return has_date and has_narration and has_debit and has_credit and has_balance


def is_rbl_table_end_line(line: str):
    normalized = normalize_header_name(line)
    if normalized == "total":
        return True
    return normalized.startswith("total ")


def trim_rbl_narration_text(value: str):
    narration = clean_string(value) or ""
    if not narration:
        return ""

    trim_markers = [
        r"\bTotal\b",
        r"\bAccount Summary\b",
        r"\bStatement Summary\b",
        r"\bPage\s+\d+\b",
        r"\bFor any queries\b",
        r"\bCustomer Care\b",
    ]
    for marker in trim_markers:
        narration = re.split(marker, narration, maxsplit=1, flags=re.IGNORECASE)[0]

    account_summary_index = narration.lower().find("account summary")
    if account_summary_index >= 0:
        narration = narration[:account_summary_index]

    narration = re.sub(r"\s+", " ", narration).strip(" -:|")
    return narration


def trim_bob_narration_text(value: str):
    narration = clean_string(value) or ""
    if not narration:
        return ""

    trim_markers = [
        r"\bClosing Balance\b",
        r"\bTotal\b",
        r"\bAccount Summary\b",
        r"\bStatement Summary\b",
        r"\bPage\s+\d+\b",
        r"\bFor any queries\b",
        r"\bCustomer Care\b",
    ]
    for marker in trim_markers:
        narration = re.split(marker, narration, maxsplit=1, flags=re.IGNORECASE)[0]

    return re.sub(r"\s+", " ", narration).strip(" -:|")


def extract_rbl_pdf_lines(file_path: str, pdf_password: str | None = None):
    reader = open_pdf_reader(file_path, pdf_password)
    lines = []
    within_transaction_table = False  # persists across pages for multi-page PDFs
    for page in reader.pages:
        page_text = ""
        for kwargs in [{"extraction_mode": "layout"}, {}]:
            try:
                page_text = page.extract_text(**kwargs) or ""
                if page_text.strip():
                    break
            except Exception:
                continue

        for raw_line in page_text.splitlines():
            cleaned_line = clean_string(raw_line)
            if not cleaned_line:
                continue

            if is_rbl_table_header_line(cleaned_line):
                within_transaction_table = True
                continue

            if not within_transaction_table:
                continue

            if is_rbl_table_end_line(cleaned_line):
                # Don't break — "Total" may appear mid-statement on one page;
                # reset and keep scanning for another header section
                within_transaction_table = False
                continue

            if is_rbl_non_transaction_line(cleaned_line):
                continue
            lines.append(cleaned_line)
    return lines


def is_rbl_narration_continuation(line: str):
    cleaned_line = clean_string(line)
    if not cleaned_line:
        return False
    if is_rbl_non_transaction_line(cleaned_line) or is_rbl_table_header_line(cleaned_line):
        return False
    if parse_rbl_pdf_row(cleaned_line):
        return False

    normalized = normalize_header_name(cleaned_line)
    if normalized.startswith(("from ", "to ", "period ", "address ", "mobile ", "phone ")):
        return False
    if ":" in cleaned_line and len(cleaned_line) > 20:
        return False
    if re.search(r"https?://|www\.", cleaned_line, re.IGNORECASE):
        return False
    return True


def parse_rbl_pdf_row(line: str):
    tokens = [token.strip() for token in re.split(r"\s{2,}", line.strip()) if token.strip()]
    if not tokens:
        return None

    date_token = tokens[0]
    if not RBL_DATE_PATTERN.match(date_token):
        return None

    transaction_date = parse_date_value(date_token)
    if not transaction_date:
        return None

    body_tokens = tokens[1:]
    numeric_tail = []
    while body_tokens and parse_amount(body_tokens[-1]) is not None:
        numeric_tail.insert(0, body_tokens.pop())

    if len(numeric_tail) < 2:
        return None

    withdrawal_amount = parse_amount(numeric_tail[-3]) if len(numeric_tail) >= 3 else None
    deposit_amount = parse_amount(numeric_tail[-2]) if len(numeric_tail) >= 2 else None
    running_balance = parse_amount(numeric_tail[-1])

    chq_ref = None
    narration_tokens = body_tokens
    if len(body_tokens) >= 2 and RBL_REF_PATTERN.match(body_tokens[-1]):
        chq_ref = body_tokens[-1]
        narration_tokens = body_tokens[:-1]

    narration = " ".join(token.strip() for token in narration_tokens if token.strip())
    narration = trim_rbl_narration_text(narration)
    if not narration:
        narration = chq_ref or ""

    return {
        "transaction_date": transaction_date,
        "withdrawal_amount": withdrawal_amount,
        "deposit_amount": deposit_amount,
        "running_balance": running_balance,
        "narration": narration,
        "counterparty_identifier": chq_ref,
    }


def finalize_rbl_transaction(record: dict, payment_source_name: str):
    withdrawal_amount = record.get("withdrawal_amount") or 0
    deposit_amount = record.get("deposit_amount") or 0
    if deposit_amount > 0:
        direction = "credit"
        amount = deposit_amount
    elif withdrawal_amount > 0:
        direction = "withdrawal"
        amount = withdrawal_amount
    else:
        return None

    narration = trim_rbl_narration_text(
        re.sub(r"\s+", " ", clean_string(record.get("narration")) or "").strip()
    )
    narration_metadata = extract_bank_narration_metadata(narration)
    counterparty_identifier = clean_string(
        record.get("counterparty_identifier")
        or narration_metadata.get("counterparty_identifier")
    )
    return {
        "transaction_date": record["transaction_date"],
        "type": direction,
        "amount": amount,
        "running_balance": record.get("running_balance"),
        "narration": narration,
        "transaction_time": narration_metadata.get("transaction_time"),
        "payment_mode": narration_metadata.get("payment_mode")
        or infer_payment_mode_from_text(
            " ".join(part for part in [narration, counterparty_identifier] if part)
        ),
        "counterparty_identifier": counterparty_identifier,
        "payment_source_name": payment_source_name,
        "vendor_name": None,
        "statement_sources": build_statement_sources(payment_source_name, "OTHER"),
    }


def parse_rbl_pdf_statement(
    file_path: str,
    payment_source_name: str,
    pdf_password: str | None = None,
):
    lines = extract_rbl_pdf_lines(file_path, pdf_password)
    transactions = []
    current_record = None

    for raw_line in lines:
        line = raw_line.strip()
        parsed_row = parse_rbl_pdf_row(line)
        if parsed_row:
            if current_record:
                finalized = finalize_rbl_transaction(current_record, payment_source_name)
                if finalized:
                    transactions.append(finalized)
            current_record = parsed_row
            continue

        if not current_record or not is_rbl_narration_continuation(line):
            continue

        continuation = clean_string(line)
        if continuation:
            existing_narration = clean_string(current_record.get("narration")) or ""
            current_record["narration"] = " ".join(
                part for part in [existing_narration, continuation] if part
            )

    if current_record:
        finalized = finalize_rbl_transaction(current_record, payment_source_name)
        if finalized:
            transactions.append(finalized)

    if not transactions:
        raise ParsingError(
            "Could not extract any transactions from the RBL PDF statement."
        )

    return transactions


# ── Kotak Bank PDF parser ─────────────────────────────────────────────────────
# Header format: # Date  Description  Chq/Ref. No.  Withdrawal (Dr.)  Deposit (Cr.)  Balance
# No "Value Date" column. Chq/Ref is pure digits (e.g. 000000000).
# Direction is ambiguous from layout (blank column = missing amount), so we use
# balance trend: balance_after > balance_before → credit, else → debit.

# Kotak uses "DD MMM YYYY" (e.g. "13 Apr 2026") AND sometimes "DD/MM/YYYY"
KOTAK_DATE_PATTERN = re.compile(
    r"^\d{1,2}/\d{1,2}/\d{2,4}$"               # DD/MM/YYYY
    r"|^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$"         # DD MMM YYYY
)
_KOTAK_PURE_DIGITS = re.compile(r"^\d+$")        # matches row numbers and Chq/Ref like 000000000


def is_kotak_table_header_line(line: str) -> bool:
    n = normalize_header_name(line)
    return (
        "date" in n
        and ("description" in n or "narration" in n or "particulars" in n)
        and ("withdrawal" in n or "debit" in n or "dr." in n)
        and ("deposit" in n or "credit" in n or "cr." in n)
        and "balance" in n
    )


def is_kotak_table_end_line(line: str) -> bool:
    n = normalize_header_name(line)
    return (
        n.startswith("total")
        or "closing balance" in n
        or "statement summary" in n
        or "debit total" in n
        or "credit total" in n
        or "no of transaction" in n
        or "number of transaction" in n
        or "net amount" in n
        or "brought forward" in n
        or "carry forward" in n
        or "transaction count" in n
        or "dr total" in n
        or "cr total" in n
    )


def is_kotak_non_transaction_line(line: str) -> bool:
    n = normalize_header_name(line)
    if not n:
        return True
    skip = (
        "kotak mahindra", "account no", "branch", "ifsc", "customer id",
        "page ", "generated on", "statement period", "opening balance",
        "savings account transactions", "current account transactions",
        "for any queries", "disclaimer", "www.", "authorized signatory",
        "cin:", "registered office", "transaction summary",
        "account information", "account statement", "account details",
        "computer generated", "digitally signed", "this statement",
        "note:", "important:", "terms and", "grievance",
    )
    return any(s in n for s in skip)


def parse_kotak_pdf_row(line: str):
    tokens = [t.strip() for t in re.split(r"\s{2,}", line.strip()) if t.strip()]
    if not tokens:
        return None

    # Row-number prefix: lines start with "1", "2" etc. before the date
    # e.g. ["1", "13 Apr 2026", "NARRATION", "81,100.00", "81,100.00"]
    start = 0
    if len(tokens) > 1 and _KOTAK_PURE_DIGITS.match(tokens[0]):
        start = 1

    if start >= len(tokens):
        return None
    date_token = tokens[start]
    if not KOTAK_DATE_PATTERN.match(date_token):
        return None
    transaction_date = parse_date_value(date_token)
    if not transaction_date:
        return None

    body = list(tokens[start + 1:])

    # Collect numeric amounts from the right, but STOP at pure-digit strings
    # (Chq/Ref numbers like "000000000" are all digits with no decimal/comma).
    nums = []
    while body:
        last = body[-1]
        if _KOTAK_PURE_DIGITS.match(last):
            break          # it's a Chq/Ref, not an amount
        amt = parse_amount(last)
        if amt is None:
            break
        nums.insert(0, body.pop())

    if len(nums) < 2:
        return None

    running_balance = parse_amount(nums[-1])
    # The second-to-last is whichever of Withdrawal/Deposit was non-blank.
    # Direction is resolved later using the balance trend.
    raw_amount = parse_amount(nums[-2])

    # Pull Chq/Ref from body (pure-digit token immediately before the amounts)
    chq_ref = None
    if body and _KOTAK_PURE_DIGITS.match(body[-1]):
        chq_ref = body.pop()

    narration = " ".join(body).strip() or ""
    return {
        "transaction_date": transaction_date,
        "raw_amount": raw_amount,       # withdrawal OR deposit — direction TBD
        "running_balance": running_balance,
        "narration": narration,
        "counterparty_identifier": chq_ref,
    }


def finalize_kotak_transaction(record: dict, payment_source_name: str, prev_balance=None):
    raw_amount = record.get("raw_amount") or 0
    current_balance = record.get("running_balance")

    if not raw_amount or current_balance is None:
        return None

    # Determine direction from balance change (most reliable for Kotak layout)
    if prev_balance is not None:
        diff = float(current_balance) - float(prev_balance)
        if diff > 0:
            direction = "credit"
            amount = round(abs(diff), 2)
        elif diff < 0:
            direction = "withdrawal"
            amount = round(abs(diff), 2)
        else:
            # Balance unchanged (charge + reversal same day, or rounding) — skip
            return None
    else:
        # First transaction: infer from narration keywords
        narr_lower = (record.get("narration") or "").lower()
        credit_hints = ("credit", "salary", "refund", "interest", "reversal",
                        "cashback", "reward", "neft cr", "imps cr")
        direction = "credit" if any(h in narr_lower for h in credit_hints) else "withdrawal"
        amount = raw_amount

    narration = re.sub(r"\s+", " ", clean_string(record.get("narration")) or "").strip()
    meta = extract_bank_narration_metadata(narration)
    cp = clean_string(record.get("counterparty_identifier") or meta.get("counterparty_identifier"))
    return {
        "transaction_date": record["transaction_date"],
        "type": direction,
        "amount": amount,
        "running_balance": current_balance,
        "narration": narration,
        "transaction_time": meta.get("transaction_time"),
        "payment_mode": meta.get("payment_mode") or infer_payment_mode_from_text(
            " ".join(p for p in [narration, cp] if p)
        ),
        "counterparty_identifier": cp,
        "payment_source_name": payment_source_name,
        "vendor_name": None,
        "statement_sources": build_statement_sources(payment_source_name, "OTHER"),
    }


def _parse_kotak_opening_balance(line: str):
    """Extract opening balance amount from lines like '- - Opening Balance - - 12,345.67'
    Returns float or None (None means 0 — all dashes)."""
    n = normalize_header_name(line)
    if "opening balance" not in n:
        return None
    # Collect any numeric values in the line
    tokens = line.replace(",", "").split()
    amounts = []
    for t in tokens:
        try:
            v = float(t)
            if v > 0:
                amounts.append(v)
        except ValueError:
            pass
    return amounts[-1] if amounts else 0.0


def extract_kotak_pdf_lines(file_path: str, pdf_password=None):
    """Returns (lines, opening_balance)."""
    reader = open_pdf_reader(file_path, pdf_password)
    lines = []
    opening_balance = None
    within_table = False
    for page in reader.pages:
        page_text = ""
        for kwargs in [{"extraction_mode": "layout"}, {}]:
            try:
                page_text = page.extract_text(**kwargs) or ""
                if page_text.strip():
                    break
            except Exception:
                continue
        for raw_line in page_text.splitlines():
            cl = clean_string(raw_line)
            if not cl:
                continue
            if is_kotak_table_header_line(cl):
                within_table = True
                continue
            if not within_table:
                continue
            if is_kotak_table_end_line(cl):
                within_table = False
                continue
            # Capture opening balance before skipping
            if "opening balance" in normalize_header_name(cl):
                if opening_balance is None:
                    opening_balance = _parse_kotak_opening_balance(cl)
                continue
            if is_kotak_non_transaction_line(cl):
                continue
            lines.append(cl)
    return lines, (opening_balance if opening_balance is not None else 0.0)


def parse_kotak_pdf_statement(
    file_path: str,
    payment_source_name: str,
    pdf_password=None,
):
    lines, opening_balance = extract_kotak_pdf_lines(file_path, pdf_password)
    transactions = []
    current = None
    prev_balance = opening_balance  # seed with opening balance so first tx direction is correct

    for raw_line in lines:
        line = raw_line.strip()
        parsed = parse_kotak_pdf_row(line)
        if parsed:
            if current:
                t = finalize_kotak_transaction(current, payment_source_name, prev_balance)
                if t:
                    transactions.append(t)
                prev_balance = current.get("running_balance")
            current = parsed
            continue
        if not current:
            continue
        if is_kotak_non_transaction_line(line) or is_kotak_table_header_line(line):
            continue
        if parse_kotak_pdf_row(line):
            continue
        # Narration continuation line — skip lines that are pure numbers/amounts
        # (those are footer/summary lines that slipped through filtering).
        cont = clean_string(line)
        if cont and any(c.isalpha() for c in cont):
            existing = clean_string(current.get("narration")) or ""
            current["narration"] = " ".join(p for p in [existing, cont] if p)

    if current:
        t = finalize_kotak_transaction(current, payment_source_name, prev_balance)
        if t:
            transactions.append(t)

    if not transactions:
        raise ParsingError(
            "Could not extract any transactions from the Kotak PDF statement. "
            "Make sure the file is a Kotak Bank account statement (PDF)."
        )
    return transactions


# ── End Kotak parser ──────────────────────────────────────────────────────────

def parse_statement_dataframe(df, statement_source: str):
    source_key = (statement_source or "BOB").strip().upper()
    config = STATEMENT_SOURCE_CONFIGS.get(source_key) or {
        "payment_source_name": source_key,
        "parser": "generic",
    }

    payment_source_name = config["payment_source_name"]
    parser_type = config["parser"]

    if parser_type == "bob":
        transactions = extract_bob_transactions(df.fillna(""), payment_source_name)
        if transactions:
            return transactions
        # Grok pattern matched nothing — fall back to generic CSV parser
        # (handles newer BOB statement formats with proper column headers)
        try:
            return parse_generic_statement(df, payment_source_name)
        except Exception:
            return []
    return parse_generic_statement(df, payment_source_name)


@safe_execute
def parse_csv(file_path: str, statement_source: str = "BOB") -> list[dict]:
    source_key = (statement_source or "BOB").strip().upper()
    if hasattr(file_path, "seek"):
        file_path.seek(0)
    if source_key == "BOB":
        df = pd.read_csv(file_path, header=None, dtype=str).fillna("")
    else:
        df = pd.read_csv(file_path, dtype=str).fillna("")

    transactions = parse_statement_dataframe(df, source_key)
    return transactions


@safe_execute
def parse_excel(file_path, statement_source: str = "BOB") -> list[dict]:
    source_key = (statement_source or "BOB").strip().upper()
    if hasattr(file_path, "seek"):
        file_path.seek(0)
    # Bank Excel exports usually carry a proper header row; read every column as
    # text so amounts/dates keep their original formatting for the parsers.
    df = pd.read_excel(file_path, dtype=str).fillna("")
    return parse_statement_dataframe(df, source_key)


# Right-to-left single-line parsers for Super Money rows
_SM_STATUS_RE  = re.compile(r"\s+(SUCCESS|FAILED|PENDING)\s*$", re.IGNORECASE)
_SM_DATE_RE    = re.compile(
    r"\s+(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|"
    r"September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
    r"\s+\d{4})\s*$",
    re.IGNORECASE,
)
_SM_AMOUNT_RE  = re.compile(r"\s+([+\-−]?\s*(?:₹|Rs\.?)?\s*[\d,]+(?:\.\d{1,2})?)\s*$")
_SM_ACCT_RE    = re.compile(r"\s+(\d{4,})\s*$")   # trailing account suffix digits
_SM_SKIP_RE    = re.compile(
    r"^\d{1,2}\s+\w+\s+\d{4}\s+to\s+\d{1,2}\s+\w+\s+\d{4}$", re.IGNORECASE
)
_SM_SKIP_SET   = {
    "name", "bank", "amount", "date", "status",
    "transaction history", "transaction details",
    "name bank amount date status",
}


def _sm_find_bank(text: str):
    """Find a bank code + its span in text. Returns (code, start, end) or None."""
    lower = text.lower()
    # Longest matches first to avoid partial hits (e.g. "rbl bank" before "rbl")
    ordered = sorted(SUPERMONEY_BANK_MAP.keys(), key=len, reverse=True)
    for kw in ordered:
        idx = lower.find(kw)
        if idx != -1:
            end = idx + len(kw)
            # Grab an optional trailing account-suffix (digits) e.g. "BoB 6180"
            m = _SM_ACCT_RE.search(text[end:])
            if m:
                end += m.end()
            return SUPERMONEY_BANK_MAP[kw], idx, end
    return None, -1, -1


def _sm_parse_line(line: str):
    """
    Parse one Super Money PDF row (single extracted line).
    Format: <Name> <Bank> [AcctSuffix] <Amount> <DD Month YYYY> <STATUS>
    Returns a dict or None if the line is not a transaction row.
    """
    s = line.strip()

    # 1. Strip STATUS from the right
    m = _SM_STATUS_RE.search(s)
    if not m:
        return None
    status = m.group(1).upper()
    s = s[:m.start()].strip()

    # 2. Strip DATE from the right
    m = _SM_DATE_RE.search(s)
    if not m:
        return None
    date_str = m.group(1).strip()
    s = s[:m.start()].strip()

    # 3. Strip AMOUNT from the right
    m = _SM_AMOUNT_RE.search(s)
    if not m:
        return None
    amount_raw = m.group(1).replace("−", "-").replace(",", "").replace("₹", "").replace("Rs.", "").strip()
    s = s[:m.start()].strip()

    # 4. Find bank keyword in what remains ("Name BankName [AcctSuffix]")
    bank_code, b_start, b_end = _sm_find_bank(s)
    if b_start >= 0:
        name     = s[:b_start].strip()
        bank_raw = s[b_start:b_end].strip()
    else:
        name     = s
        bank_raw = ""

    # 5. Parse amount → Decimal + direction
    try:
        from decimal import Decimal
        sign     = -1 if amount_raw.startswith("-") else 1
        digits   = amount_raw.lstrip("+-").strip()
        amt      = Decimal(digits)
        direction = "withdrawal" if sign < 0 else "credit"
    except Exception:
        return None

    if amt <= 0:
        return None

    return {
        "name":      name or s,
        "bank_raw":  bank_raw,
        "bank_code": bank_code,
        "amount":    amt,
        "direction": direction,
        "date_str":  date_str,
        "status":    status,
    }


def parse_supermoney_pdf_statement(
    file_path,
    payment_source_name: str = "SUPERMONEY",
    pdf_password: str | None = None,
) -> list[dict]:
    reader = open_pdf_reader(file_path, pdf_password)
    transactions = []

    for page in reader.pages:
        raw_text = page.extract_text() or ""
        for raw_line in raw_text.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            low = line.lower()
            # Skip title / date-range / column-header / page lines
            if (low in _SM_SKIP_SET
                    or _SM_SKIP_RE.match(line)
                    or low.startswith("page ")
                    or low.startswith("transaction history")):
                continue

            parsed = _sm_parse_line(line)
            if parsed is None:
                continue

            # Only import successful transactions
            if parsed["status"] != "SUCCESS":
                continue

            tx_date = parse_date_value(parsed["date_str"])
            if tx_date is None:
                continue

            bank_code    = parsed["bank_code"]
            stmt_sources = build_statement_sources(bank_code, "SUPERMONEY") if bank_code else "SUPERMONEY"
            name         = parsed["name"]
            bank_raw     = parsed["bank_raw"]

            transactions.append({
                "transaction_date":        tx_date,
                "type":                    parsed["direction"],
                "amount":                  parsed["amount"],
                "running_balance":         None,
                "narration":               f"{name} | {bank_raw}" if bank_raw else name,
                "transaction_time":        None,
                "payment_mode":            "upi",
                "counterparty_identifier": None,
                "payment_source_name":     bank_code or payment_source_name,
                "vendor_name":             name,
                "statement_sources":       stmt_sources,
            })

    if not transactions:
        raise ParsingError(
            "Could not extract any transactions from the Super Money PDF statement. "
            "Make sure the file is a Super Money transaction history PDF."
        )
    return transactions


def resolve_statement_filename(file_path, filename: str | None = None) -> str:
    explicit_name = clean_string(filename)
    if explicit_name:
        return explicit_name
    candidate = getattr(file_path, "name", None)
    if isinstance(candidate, (str, PathLike)):
        return str(candidate)
    return ""


@safe_execute
def parse_statement(
    file_path: str,
    statement_source: str = "BOB",
    pdf_password: str | None = None,
    filename: str | None = None,
) -> list[dict]:
    source_key = (statement_source or "BOB").strip().upper()
    statement_filename = resolve_statement_filename(file_path, filename).lower()
    if statement_filename.endswith(".pdf"):
        if source_key == "GPAY":
            return parse_gpay_pdf_statement(
                file_path,
                STATEMENT_SOURCE_CONFIGS[source_key]["payment_source_name"],
                pdf_password,
            )
        if source_key == "RBL":
            return parse_rbl_pdf_statement(
                file_path,
                STATEMENT_SOURCE_CONFIGS[source_key]["payment_source_name"],
                pdf_password,
            )
        if source_key == "KOTAK":
            return parse_kotak_pdf_statement(
                file_path,
                STATEMENT_SOURCE_CONFIGS[source_key]["payment_source_name"],
                pdf_password,
            )
        if source_key == "SUPERMONEY":
            return parse_supermoney_pdf_statement(
                file_path,
                STATEMENT_SOURCE_CONFIGS[source_key]["payment_source_name"],
                pdf_password,
            )
        raise ParsingError(
            "PDF parsing is currently supported only for GPay, RBL, Kotak, and Super Money statements."
        )

    if statement_filename.endswith((".xlsx", ".xls")):
        return parse_excel(file_path, source_key)

    return parse_csv(file_path, source_key)
