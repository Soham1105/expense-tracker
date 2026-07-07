## Bootstrap

Local Postgres database + split tables:

```powershell
python scripts/bootstrap_db.py
```

This will:
- create the `expense_tracker` database if it does not already exist
- ensure the split tables exist
- ensure the `expense_for` column exists on split line items

## Tesseract OCR (required for the Scan Bill feature)

The `Scan Bill` button on the classification + reports pages calls Tesseract
locally via `pytesseract`. The Python wrapper (`pytesseract`) is already in
`requirements.txt`, but the **Tesseract binary itself is a separate native
install** and isn't shipped with pip.

**Install on Windows (recommended via winget):**

```powershell
winget install --id UB-Mannheim.TesseractOCR -e
```

The installer adds `C:\Program Files\Tesseract-OCR` to your PATH. **Restart the
uvicorn server** (and any open terminals) after install so the new PATH is
picked up. Test with:

```powershell
tesseract --version
```

**Install on macOS:** `brew install tesseract`
**Install on Debian/Ubuntu:** `sudo apt install tesseract-ocr`

If Tesseract is installed but PATH isn't set, edit
`app/services/receipt_parser.py` and set `pytesseract.pytesseract.tesseract_cmd`
to the absolute path of `tesseract.exe`.



- Section or amount which show bank balance, overall spend over the time or secion filter which is able to show whole user history like 17L, or investment then for that amount hide it by default even user selected visible amount since user may want to show the  overall spend to others but it's totally not recommanded to show whole bank acc summery so ask each time. Can also plan in other way such that privacy don;t breach and user not face overhead with this.


- Can improve user defined cateogirs. also current tagging page is very static make it some what dynamic and user freindly like open close section and other and where to put tag creation page 