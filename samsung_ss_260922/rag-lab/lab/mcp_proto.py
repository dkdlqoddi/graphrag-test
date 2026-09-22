# -*- coding: utf-8 -*-
"""MCP(Model Context Protocol) 의 말 — JSON-RPC 2.0.

SDK 를 쓰지 않고 직접 구현한다. `lab/web.py` 가 BaseHTTPRequestHandler 로 HTTP 를
직접 받는 것과, `lab/llm.py` 가 urllib 로 OpenAI 를 직접 부르는 것과 같은 이유다 —
이 앱은 단계를 감추지 않는 것이 목적이고 프로토콜도 그 단계 중 하나다. 실제로
오가는 것은 **JSON 한 덩이**가 전부다.

    요청  {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search",…}}
    응답  {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"…"}]}}

다루는 메서드는 네 개뿐이다.

    initialize                규격·능력·서버 이름을 맞춘다 (악수)
    notifications/initialized 클라이언트가 준비됐다는 알림 — **답하지 않는다**
    tools/list                도구 목록과 입력 스키마
    tools/call                도구 하나를 부른다
    ping                      살아 있는지 묻는다 → {}

**말과 전송을 나눠 둔다.** 이 모듈의 `dispatch()` 는 메시지 하나를 받아 응답 하나를
**돌려줄 뿐 아무 데도 보내지 않는다.** 보내는 일은 전송 계층이 한다.

    lab/mcp_proto.py  serve_stdio()   stdin/stdout 에 한 줄씩       (클라이언트가 프로세스를 띄울 때)
    lab/mcp_http.py   serve_http()    POST /mcp 의 본문             (서버를 먼저 띄워 둘 때)

같은 `dispatch()` 를 두 전송이 함께 쓰므로 어느 쪽으로 붙어도 같은 답이 나온다
(`lab/pipeline.py` 를 화면과 MCP 가 함께 쓰는 것과 같은 짜임이다).

지켜야 하는 것 세 가지:

**stdio 에서 stdout 은 프로토콜 전용이다.** 한 줄이라도 다른 글이 섞이면 클라이언트가
JSON 을 못 읽고 연결이 끊긴다. 그런데 이 앱은 진행 상황을 print 로 알리도록 만들어져
있고(`lab/pipeline.py`, 청킹·임베딩 진행률) chromadb·pypdf 도 제 사정을 출력한다.
도구를 실행하는 동안 stdout 을 stderr 로 돌려 두는 `quiet()` 가 그래서 있다 — 진행
로그는 사라지지 않고 클라이언트의 서버 로그로 간다. HTTP 전송에서는 stdout 이
프로토콜과 무관하므로 이 장치를 걸지 않는다(`protect_stdout=False`).

**id 가 없는 메시지(알림)에는 답하지 않는다.** 답을 보내면 클라이언트가 짝이 없는
응답을 받는다. `dispatch()` 는 그때 None 을 돌려준다.

**도구 실행 중의 오류는 JSON-RPC 오류가 아니라 `isError` 다.** 프로토콜이 깨진 것과
도구가 실패한 것은 다르다. 후자는 모델이 읽고 다음 수를 고를 수 있어야 하므로
한국어 설명을 결과 본문에 담아 돌려준다(`lab/llm.py` 의 `_explain` 과 같은 태도).
"""

import contextlib
import json
import sys
import traceback

from . import config

# JSON-RPC 2.0 이 정한 오류 번호. 우리가 쓰는 것은 이 셋뿐이다.
PARSE_ERROR = -32700
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602


class ToolError(Exception):
    """도구가 사람에게 설명하며 멈출 때 쓴다. 이 예외만 통째로 본문이 된다."""


@contextlib.contextmanager
def quiet():
    """도구가 도는 동안 stdout 을 stderr 로 돌린다. 위 docstring 참고."""
    with contextlib.redirect_stdout(sys.stderr):
        yield


def log(msg):
    """진행 상황을 stderr 에 적는다. 클라이언트의 서버 로그에 남는다."""
    sys.stderr.write("%s\n" % msg)
    sys.stderr.flush()


def ok(mid, result):
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def err(mid, code, message):
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def _text(s):
    return {"content": [{"type": "text", "text": s}]}


def _find(tools, name):
    for t in tools:
        if t["name"] == name:
            return t
    return None


def _describe(tool):
    """도구 하나를 tools/list 가 쓰는 꼴로. title 은 화면에 뜨는 한국어 이름이다."""
    out = {"name": tool["name"],
           "description": tool["description"],
           "inputSchema": tool.get("schema") or {"type": "object", "properties": {}}}
    if tool.get("title"):
        out["title"] = tool["title"]
    return out


def dispatch(msg, tools, instructions="", protect_stdout=True):
    """메시지 하나 → 응답 하나. **아무 데도 보내지 않는다.** 알림이면 None."""
    mid = msg.get("id")
    method = msg.get("method") or ""
    params = msg.get("params") or {}

    if mid is None:                            # 알림 — 답하지 않는다
        if method == "notifications/initialized":
            log("클라이언트 준비 완료 — 도구 %d개를 열어 둡니다" % len(tools))
        return None

    if method == "initialize":
        want = (params.get("protocolVersion") or "").strip()
        client = params.get("clientInfo") or {}
        log("접속 — %s %s / 규격 %s"
            % (client.get("name", "?"), client.get("version", "?"), want or "(없음)"))
        return ok(mid, {
            # 클라이언트가 청한 규격을 그대로 돌려준다. 우리가 쓰는 것은 메서드 네 개라
            # 버전 사이에 달라지는 자리가 없다.
            "protocolVersion": want or config.MCP_PROTOCOL,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": config.MCP_NAME, "version": config.MCP_VERSION},
            "instructions": instructions,
        })

    if method == "ping":
        return ok(mid, {})

    if method == "tools/list":
        return ok(mid, {"tools": [_describe(t) for t in tools]})

    if method == "tools/call":
        name = params.get("name") or ""
        args = params.get("arguments") or {}
        tool = _find(tools, name)
        if not tool:
            return err(mid, INVALID_PARAMS, "모르는 도구입니다: %s" % name)
        log("도구 — %s %s" % (name, json.dumps(args, ensure_ascii=False)[:160]))
        guard = quiet() if protect_stdout else contextlib.nullcontext()
        try:
            with guard:                        # stdio 에서 stdout 을 더럽히지 않는다
                text = tool["fn"](args)
        except ToolError as exc:
            return ok(mid, {**_text(str(exc)), "isError": True})
        except Exception as exc:               # noqa: BLE001 — 서버는 멈추지 않는다
            traceback.print_exc(file=sys.stderr)
            return ok(mid, {**_text("도구를 실행하다 오류가 났습니다 — %s: %s"
                                    % (type(exc).__name__, exc)),
                            "isError": True})
        return ok(mid, _text(text))

    return err(mid, METHOD_NOT_FOUND, "다루지 않는 메서드입니다: %s" % method)


def handle_payload(payload, tools, instructions="", protect_stdout=True):
    """메시지 하나 또는 묶음 → 응답 하나/묶음. 답할 것이 없으면 None.

    2025-06-18 규격에서 묶음(JSON 배열)은 빠졌지만 옛 클라이언트가 보내올 수 있어
    받아 둔다. 알림만 들어 있으면 돌려줄 것이 없다 — 그때 None 이다.
    """
    if isinstance(payload, list):
        out = [r for r in (dispatch(m, tools, instructions, protect_stdout)
                           for m in payload) if r is not None]
        return out or None
    return dispatch(payload, tools, instructions, protect_stdout)


# ── 전송 ① stdio ───────────────────────────────────────────────────
def _send_line(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def serve_stdio(tools, instructions=""):
    """stdin 에서 한 줄씩 읽어 처리한다. EOF 가 오면 끝난다."""
    # 한글이 오간다. 윈도우 기본 코드페이지(cp949)로는 깨지므로 양쪽을 UTF-8 로 맞춘다.
    # 줄바꿈도 "\n" 으로 고정한다 — 윈도우가 "\r\n" 을 넣으면 한 줄이 두 줄로 보인다.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8")

    log("%s %s — stdio 로 기다립니다 (도구 %d개)"
        % (config.MCP_NAME, config.MCP_VERSION, len(tools)))
    while True:
        line = sys.stdin.readline()
        if not line:                           # EOF — 클라이언트가 닫았다
            log("연결이 닫혔습니다. 종료합니다.")
            return 0
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except ValueError as exc:
            _send_line(err(None, PARSE_ERROR, "JSON 을 읽지 못했습니다 — %s" % exc))
            continue
        got = handle_payload(payload, tools, instructions, protect_stdout=True)
        if got is None:
            continue
        for one in (got if isinstance(got, list) else [got]):
            _send_line(one)
