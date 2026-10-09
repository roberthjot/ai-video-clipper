@echo off
cd /d "%~dp0backend"
echo Iniciando servidor...
if exist "C:\Users\Owner\AppData\Local\Python\pythoncore-3.14-64\python.exe" (
    "C:\Users\Owner\AppData\Local\Python\pythoncore-3.14-64\python.exe" -m uvicorn app.main:app --port 8000
) else if exist "C:\Users\Owner\AppData\Local\Python\bin\python.exe" (
    "C:\Users\Owner\AppData\Local\Python\bin\python.exe" -m uvicorn app.main:app --port 8000
) else (
    python -m uvicorn app.main:app --port 8000
)
pause
