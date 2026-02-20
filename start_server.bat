@echo off
cd /d "%~dp0backend"
echo Iniciando servidor...
python -m uvicorn app.main:app --reload --port 8000
pause
