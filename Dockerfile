# Expense Tracker — production container
# Runs the FastAPI app with Tesseract OCR available for the "Scan Bill" feature.

FROM python:3.12-slim

# tesseract-ocr: native binary required by pytesseract (receipt/bill scanning).
# The rest are minimal runtime libs. psycopg2-binary ships its own libpq, so no
# build toolchain is needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code.
COPY app ./app

# The app uses absolute imports rooted at the `app/` directory
# (e.g. `from core.database import ...`), matching how it's run locally
# (`cd app && uvicorn main:app`).
WORKDIR /app/app
ENV PYTHONPATH=/app/app

EXPOSE 8001

# Render/Railway inject $PORT; default to 8001 for local `docker run`.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}"]
