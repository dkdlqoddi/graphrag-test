@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
title rag-lab

set PY=
where py >nul 2>&1 && set PY=py -3
if not defined PY (
    where python >nul 2>&1 && set PY=python
)
if not defined PY (
    echo.
    echo   [ERROR] Python not found. Install Python and run again.
    echo.
    pause
    exit /b 1
)

%PY% app.py

echo.
pause
