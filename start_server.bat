@echo off
cd /d D:\Study\expense_tracker\app
D:\Study\expense_tracker\.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8001 --reload
