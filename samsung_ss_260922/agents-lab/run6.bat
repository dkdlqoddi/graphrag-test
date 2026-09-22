@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
title agent-lab

if not exist ".env" (
  echo.
  echo   [ERROR] .env file not found.
  echo   Copy .env.example to .env and put your OPENAI_API_KEY in it.
  echo.
  pause
  exit /b 1
)

rem opens the agents tab
set AGENT_LAB_MULTI=1
python app.py
pause
