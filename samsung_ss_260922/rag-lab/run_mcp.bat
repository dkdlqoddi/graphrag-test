@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title rag-lab MCP

REM MCP 서버를 http://127.0.0.1:8000/mcp 로 연다. 이 창을 띄워 둔 채 클라이언트가
REM 그 주소로 붙는다. 요청은 이 창에 한 줄씩 찍힌다. 종료는 Ctrl+C.
REM
REM 손으로 확인하려면:
REM   curl -s -H "Content-Type: application/json" -H "Accept: application/json" ^
REM        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}" ^
REM        http://127.0.0.1:8000/mcp
REM
REM 클라이언트가 프로세스를 직접 띄우는 stdio 방식은 run_mcp.bat --stdio

set PY=
where py >nul 2>&1 && set PY=py -3
if not defined PY (
    where python >nul 2>&1 && set PY=python
)
if not defined PY (
    echo   [ERROR] Python not found. Install Python and run again. 1>&2
    exit /b 1
)

%PY% mcp_server.py %*
