import re
from datetime import datetime
from io import BytesIO


CATEGORY_KEYWORDS = {
    "Grocery": [
        "rice", "dal", "atta", "flour", "oil", "ghee", "sugar", "salt", "masala",
        "spice", "lentil", "pulse", "besan", "maida", "suji", "poha", "chivda",
        "murmura", "soya", "toor", "moong", "chana", "rajma", "urad", "mustard",
        "turmeric", "haldi", "jeera", "cumin", "coriander", "dhania", "chilli",
    ],
    "Snacks": [
        "chips", "biscuit", "cookie", "snack", "namkeen", "chocolate", "wafer",
        "kurkure", "lays", "doritos", "bhujia", "chikki", "murukku", "nachos",
        "popcorn", "candy", "toffee", "cracker", "puff",
    ],
    "Dairy": [
        "milk", "curd", "dahi", "paneer", "cheese", "butter", "cream", "amul",
        "nestle", "lactogen", "lassi", "buttermilk", "chaas", "whey", "skimmed",
    ],
    "Vegetables": [
        "vegetable", "onion", "tomato", "potato", "capsicum", "carrot", "cabbage",
        "spinach", "palak", "methi", "ladyfinger", "bhindi", "brinjal", "baingan",
        "gourd", "bottle gourd", "bitter gourd", "karela", "peas", "matar", "corn",
        "cucumber", "kakdi", "radish", "mooli", "turnip", "beetroot",
    ],
    "Fruits": [
        "apple", "banana", "mango", "orange", "grapes", "watermelon", "papaya",
        "guava", "pomegranate", "kiwi", "pineapple", "melon", "fruit", "lemon", "lime",
    ],
    "Household": [
        "soap", "shampoo", "detergent", "surf", "vim", "toilet", "tissue", "napkin",
        "floor cleaner", "phenyl", "broom", "mop", "brush", "bucket", "colgate",
        "pepsodent", "dettol", "lifebuoy", "harpic", "lizol", "domex", "colin",
        "dishwash", "utensil", "steel wool",
    ],
    "Health": [
        "medicine", "tablet", "capsule", "syrup", "ointment", "antiseptic",
        "vitamin", "supplement", "health", "wellness", "bandage", "gauze",
    ],
    "Beverage": [
        "juice", "water", "cola", "pepsi", "sprite", "coke", "coca-cola", "tea",
        "coffee", "horlicks", "bournvita", "milo", "complan", "energy drink",
        "frooti", "maaza", "appy", "tropicana", "real juice", "nimbu", "lemonade",
    ],
    "Food": [
        "bread", "egg", "noodle", "pasta", "sauce", "jam", "pickle", "achar",
        "papad", "honey", "ketchup", "mayonnaise", "spread", "peanut butter",
        "oats", "cereal", "cornflakes", "muesli", "ready to cook", "instant",
    ],
    "Personal Care": [
        "moisturizer", "lotion", "perfume", "deodorant", "hair oil", "face wash",
        "sunscreen", "toner", "serum", "foundation", "lipstick", "kajal",
        "nail", "cotton", "sanitary", "razor", "shaving", "talcum", "powder",
    ],
}

TOTAL_KEYWORDS = {
    "total", "subtotal", "net amount", "net payable", "payable", "gst", "cgst",
    "sgst", "igst", "tax", "discount", "grand total", "bill amount", "savings",
    "you save", "round off", "rounded", "balance", "change", "refund amount",
    "total amount", "mrp", "vat", "cess", "surcharge", "service charge",
    "delivery", "packing", "packaging", "convenience fee",
}

DATE_FORMATS = [
    ("%d/%m/%Y", re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")),
    ("%d-%m-%Y", re.compile(r"\b(\d{2}-\d{2}-\d{4})\b")),
    ("%d/%m/%y", re.compile(r"\b(\d{2}/\d{2}/\d{2})\b")),
    ("%d-%m-%y", re.compile(r"\b(\d{2}-\d{2}-\d{2})\b")),
    ("%Y-%m-%d", re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")),
]

# Any numeric token that looks like a price: optional ₹/Rs prefix, optional thousands
# separators, optional 1 or 2 decimals. Anchored to end-of-line via parser.
PRICE_TOKEN_RE = re.compile(r"(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s*$", re.IGNORECASE)
# Total/subtotal lines often have multiple numbers — we want the LAST one
AMOUNT_ANY_RE = re.compile(r"[\d,]+(?:\.\d{1,2})?")
# More strict (used only as a hint for total detection — prefer numbers with decimals)
AMOUNT_DECIMAL_RE = re.compile(r"[\d,]+\.\d{1,2}")
LONG_DIGIT_RE = re.compile(r"\d{6,}")          # ignore phone/GST/barcode noise
GSTIN_RE = re.compile(r"^[0-9A-Z]{15}$")
DATE_LIKE_RE = re.compile(r"\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b")
TIME_LIKE_RE = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b")


def suggest_category(item_name: str) -> str:
    name_lower = item_name.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if " " in kw:
                # Multi-word keyword: substring match is fine
                if kw in name_lower:
                    return category
            else:
                # Single word: require word boundary to avoid "salt" matching "salted"
                if re.search(r"\b" + re.escape(kw) + r"\b", name_lower):
                    return category
    return "Other"


def is_total_line(text: str) -> bool:
    normalized = text.lower().strip()
    for kw in TOTAL_KEYWORDS:
        if " " in kw:
            if kw in normalized:
                return True
        else:
            if re.search(r"\b" + re.escape(kw) + r"\b", normalized):
                return True
    return False


def parse_amount_str(s: str) -> float | None:
    cleaned = re.sub(r"[^\d.]", "", s.replace(",", ""))
    try:
        v = float(cleaned)
        return v if v > 0 else None
    except ValueError:
        return None


def extract_date_from_text(text: str) -> str | None:
    for fmt, pattern in DATE_FORMATS:
        match = pattern.search(text)
        if match:
            try:
                return datetime.strptime(match.group(1), fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
    return None


_STORE_SKIP_KEYWORDS = {
    "invoice", "receipt", "bill", "gstin", "date", "time",
    "tax", "phone", "tel", "email", "address", "pincode", "gst",
    "fssai", "cin", "pan", "reg", "regd",
}


def extract_store_name(lines: list[str]) -> str:
    for line in lines[:8]:
        stripped = line.strip()
        if len(stripped) < 3:
            continue
        if LONG_DIGIT_RE.search(stripped):
            continue
        if GSTIN_RE.match(stripped.replace(" ", "")):
            continue
        # Word-boundary match so "tel" doesn't kill "Hotel ABC"
        lower = stripped.lower()
        if any(re.search(r"\b" + re.escape(kw) + r"\b", lower) for kw in _STORE_SKIP_KEYWORDS):
            continue
        return stripped
    return ""


# Lines that are receipt meta-data (header/footer), not actual item rows.
# Matched anchored to start so "Bill No:" / "Invoice #" trips it but a real
# item that just happens to contain "no" in the name doesn't.
META_LINE_RE = re.compile(
    r"^\s*(invoice|bill\s*no|receipt\s*no|order\s*no|gstin|gst\b|pan|cin|fssai|"
    r"date|time|phone|tel|mob(?:ile)?|email|address|pincode|cashier|customer|"
    r"server|table|terminal)\b",
    re.IGNORECASE,
)


# A line is a "table header" if it mentions 2+ of these column tokens.
# Once we hit one, all subsequent non-total lines are treated as item rows.
_TABLE_HEADER_TOKENS = {
    "item", "items", "particulars", "description", "product", "goods",
    "qty", "quantity", "nos", "units",
    "rate", "price", "mrp", "unit",
    "amount", "total", "value", "subtotal",
    "hsn", "sac", "sl", "sr", "no",
}

# Words that indicate "table is over" — totals/footers usually follow these.
_TABLE_END_TOKENS = {
    "subtotal", "sub total", "grand total", "net total", "net amount",
    "net payable", "payable", "round off", "rounded", "balance", "thank you",
    "thanks", "visit again",
}


def _is_table_header(line: str) -> bool:
    lower = line.lower()
    hits = 0
    for tok in _TABLE_HEADER_TOKENS:
        if re.search(r"\b" + re.escape(tok) + r"\b", lower):
            hits += 1
            if hits >= 2:
                return True
    return False


def _is_table_end(line: str) -> bool:
    lower = line.lower()
    return any(tok in lower for tok in _TABLE_END_TOKENS)


def _looks_like_item_line(stripped: str, name: str, amount: float, *, inside_table: bool = False) -> bool:
    """Heuristic guard: is this line plausibly a line-item (item + price)?
    Once we're INSIDE the items table (header detected), the bar is lower —
    we trust the table structure and reject only obvious meta/total noise."""
    if not name or amount <= 0:
        return False
    # Reject receipt meta-lines (Bill No:, GSTIN:, Invoice, Date, Phone, ...)
    if META_LINE_RE.search(stripped):
        return False
    # Name must contain at least one letter and be at least 2 chars
    if not re.search(r"[A-Za-z]", name):
        return False
    if len(name.strip()) < 2:
        return False
    # Reject GSTIN/PAN-like all-caps alphanumeric blobs
    if GSTIN_RE.match(stripped.replace(" ", "")):
        return False
    # Cap absurd amounts (probably an OCR-merged total)
    if amount > 1_000_000:
        return False
    # Skip the header row itself
    header_words = {"item", "items", "qty", "rate", "amount", "price", "hsn", "sac",
                    "particulars", "description", "no", "sl", "sr", "product",
                    "quantity", "total", "value", "mrp", "unit", "nos", "units"}
    name_words = {w.lower() for w in re.findall(r"[A-Za-z]+", name)}
    if name_words and name_words.issubset(header_words):
        return False
    # OUTSIDE the table, be cautious about dates/times/long-digit lines.
    # INSIDE the table we trust the structure — a line could legitimately have
    # "23 May" or "1 L" as part of a product description.
    if not inside_table:
        if DATE_LIKE_RE.search(stripped) or TIME_LIKE_RE.search(stripped):
            return False
        if LONG_DIGIT_RE.search(stripped):
            return False
    return True


def _extract_item_from_line(stripped: str):
    """Try to parse an item-and-price out of a single line, returning (name, amount)
    or (None, None) if it doesn't look like an item line.

    Strategy:
      • Last numeric token on the line is the price/amount.
      • If a number sits at the very start of the line (Sl/Sr no), skip it and
        take the next chunk of text as the start of the item name.
      • If multiple interior numbers exist (Sl … name … qty … rate … amount),
        the name ends at the first interior number; everything between leading
        Sl-no (if present) and first interior number is the name.
    """
    matches = list(re.finditer(r"(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)", stripped, re.IGNORECASE))
    if not matches:
        return None, None
    last = matches[-1]
    amount = parse_amount_str(last.group(1))
    if amount is None:
        return None, None

    # Find where the item name lives in the line.
    name_start = 0
    name_end = last.start()

    leading_is_sl = matches[0].start() <= 1  # number at very beginning ≈ Sl/Sr column
    if leading_is_sl and len(matches) >= 2:
        # Skip past the leading Sl number; name starts after it
        name_start = matches[0].end()
        # If there's still more interior structure (qty/rate before amount),
        # name ends at the SECOND number; otherwise at the last.
        name_end = matches[1].start() if len(matches) >= 3 else last.start()
    elif len(matches) >= 2:
        # No Sl, but multi-column row → name ends at first interior number
        name_end = matches[0].start()
    # else: single number on the line → name is everything before it (default)

    name_raw = stripped[name_start:name_end].rstrip(" -:\t")
    name = re.sub(r"\s{2,}", " ", name_raw).strip()
    return name, amount


def parse_lines(text: str) -> dict:
    raw_text = text
    lines = [line for line in text.splitlines() if line.strip()]

    items = []
    detected_total = None
    detected_date = None

    for line in lines:
        detected_date = extract_date_from_text(line)
        if detected_date:
            break

    store_name = extract_store_name(lines)
    seen_names = set()  # de-dupe identical item+amount rows
    inside_table = False  # flips True once we hit "Item Qty Rate Amount"-style header

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Detect "Item / Qty / Rate / Amount" header line and flip into table mode.
        # Skip the header line itself — it's not an item.
        if not inside_table and _is_table_header(stripped):
            inside_table = True
            continue

        # Once inside the table, totals/footers mark the end.
        if inside_table and _is_table_end(stripped):
            # Capture the total if it has a number
            amounts = AMOUNT_DECIMAL_RE.findall(stripped) or AMOUNT_ANY_RE.findall(stripped)
            if amounts:
                candidate = parse_amount_str(amounts[-1])
                if candidate:
                    detected_total = candidate
            inside_table = False
            continue

        if is_total_line(stripped):
            amounts = AMOUNT_DECIMAL_RE.findall(stripped) or AMOUNT_ANY_RE.findall(stripped)
            if amounts:
                candidate = parse_amount_str(amounts[-1])
                if candidate:
                    detected_total = candidate
            continue

        name, amount = _extract_item_from_line(stripped)
        if not _looks_like_item_line(stripped, name or "", amount or 0, inside_table=inside_table):
            continue
        key = (name.lower(), round(amount, 2))
        if key in seen_names:
            continue
        seen_names.add(key)
        items.append({
            "item_name": name,
            "amount": amount,
            "suggested_category": suggest_category(name),
        })

    return {
        "store_name": store_name,
        "date": detected_date or datetime.today().strftime("%Y-%m-%d"),
        "items": items,
        "detected_total": detected_total,
        # Raw OCR text — only meant for debugging in the browser console / dev tools
        # so we can see what Tesseract actually read off the bill image.
        "debug_text": raw_text,
    }


def preprocess_image(image_bytes: bytes):
    from PIL import Image, ImageEnhance, UnidentifiedImageError

    try:
        img = Image.open(BytesIO(image_bytes))
    except (UnidentifiedImageError, Exception) as exc:
        raise ValueError(f"Cannot open image: the file may be corrupt or not a supported image format. ({exc})")

    img = img.convert("L")
    w, h = img.size
    if w < 50 or h < 50:
        raise ValueError("Image is too small for text recognition. Please upload a clearer, higher-resolution photo.")
    if w < 1200:
        scale = 1200 / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(2.0)
    return img


def _resolve_tesseract_cmd():
    """Locate the tesseract executable. UB-Mannheim's Windows installer doesn't
    always add itself to PATH, so probe the standard install locations first
    and fall back to whatever pytesseract finds on PATH."""
    import os, shutil
    # 1) Honour an explicit env override
    explicit = os.environ.get("TESSERACT_CMD")
    if explicit and os.path.isfile(explicit):
        return explicit
    # 2) Common Windows install dirs
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    # 3) Last-resort: PATH
    return shutil.which("tesseract") or None


def extract_text(image_bytes: bytes) -> str:
    import pytesseract

    cmd = _resolve_tesseract_cmd()
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd

    img = preprocess_image(image_bytes)
    return pytesseract.image_to_string(img, lang="eng", config="--psm 4")


def parse_receipt(image_bytes: bytes) -> dict:
    try:
        text = extract_text(image_bytes)
    except ImportError:
        return {
            "store_name": "",
            "date": datetime.today().strftime("%Y-%m-%d"),
            "items": [],
            "detected_total": None,
            "ocr_error": (
                "Tesseract OCR is not installed. "
                "Install it with: winget install --id UB-Mannheim.TesseractOCR -e "
                "(macOS: brew install tesseract · Linux: apt install tesseract-ocr), "
                "then restart the server."
            ),
        }
    except Exception as exc:
        msg = str(exc)
        # pytesseract raises a plain Exception when the binary isn't on PATH —
        # detect that and rewrite to a clearer install message.
        if "tesseract is not installed" in msg.lower() or "not in your path" in msg.lower():
            msg = (
                "Tesseract OCR binary not found on PATH. "
                "Install it with: winget install --id UB-Mannheim.TesseractOCR -e "
                "(macOS: brew install tesseract · Linux: apt install tesseract-ocr), "
                "then restart the server. See README.md for details."
            )
        return {
            "store_name": "",
            "date": datetime.today().strftime("%Y-%m-%d"),
            "items": [],
            "detected_total": None,
            "ocr_error": msg,
        }
    return parse_lines(text)
