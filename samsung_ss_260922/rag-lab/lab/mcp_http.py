# -*- coding: utf-8 -*-
"""MCP 를 HTTP 로 연다 — Streamable HTTP 전송.

    http://127.0.0.1:8000/mcp

stdio 전송은 클라이언트가 우리 프로세스를 **띄워 주는** 방식이라 서버가 따로 살아
있지 않다. HTTP 전송은 반대다 — 서버를 먼저 띄워 두고 클라이언트는 주소로 붙는다.
그래서 여러 클라이언트가 같은 서버를 함께 볼 수 있고, 서버 로그를 이쪽 창에서
그대로 볼 수 있다. 실습에서 "무엇이 오갔는가"를 보여 주기에는 이쪽이 낫다.

말(JSON-RPC) 자체는 `lab/mcp_proto.py` 의 `dispatch()` 가 그대로 처리한다. 이 모듈이
맡는 것은 **봉투**뿐이다 — 어느 경로로 받아 어떤 상태 코드로 돌려줄 것인가.

    POST /mcp    요청 하나(또는 묶음)를 본문으로 받아 응답을 본문으로 돌려준다
                 답할 것이 없으면(알림뿐이면) 202 Accepted 에 빈 본문
    GET  /mcp    405 — 서버가 먼저 말을 거는 SSE 통로를 열지 않는다
    DELETE /mcp  405 — 세션이 없으므로 끊을 것도 없다

규격은 응답을 `application/json` 한 덩이로 주거나 `text/event-stream` 으로 흘려보내는
두 가지를 허용한다. **우리는 앞의 것만 쓴다.** SSE 는 서버가 일하는 도중에 진행 상황을
밀어 넣기 위한 것인데, 우리 진행 로그는 이 창(stderr)에 적히는 편이 실습에서 더 낫다.
재정렬처럼 오래 걸리는 도구도 클라이언트가 기다려 주면 그만이다.

**세션을 만들지 않는다**(`Mcp-Session-Id` 를 발급하지 않는다). `lab/mcp_tools.py` 의
STATE 가 모듈 전역이라 어차피 접속마다 따로 들고 있을 것이 없기 때문이다 — 화면
(`lab/web.py`)이 브라우저 탭 여럿에게 STATE 하나를 보여 주는 것과 같다. 세션 id 만
나눠 주고 상태는 공유하면 나뉜 척하는 거짓말이 된다.

**Origin 을 확인한다.** 로컬에 열린 서버는 아무 웹페이지나 브라우저를 시켜 두드릴 수
있다(DNS 리바인딩). 브라우저가 붙인 Origin 이 localhost 가 아니면 거절한다. Origin 이
아예 없는 요청(브라우저가 아닌 클라이언트)은 그대로 받는다.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import config
from .mcp_proto import PARSE_ERROR, err, handle_payload, log

# 브라우저에서 왔다면 이 셋 중 하나여야 한다.
_LOCAL = ("http://127.0.0.1", "http://localhost", "https://127.0.0.1", "https://localhost")

# 전송이 들고 있는 것. serve_http() 가 채운다 — 핸들러는 요청마다 새로 만들어지므로
# 인스턴스에 둘 수 없다.
_SERVER = {"tools": [], "instructions": ""}


def _local_origin(origin):
    if not origin:                             # 브라우저가 아니다 — 그대로 받는다
        return True
    return any(origin.startswith(p) for p in _LOCAL)


class Handler(BaseHTTPRequestHandler):
    server_version = "rag-lab-mcp"
    protocol_version = "HTTP/1.1"              # Content-Length 를 지키고 연결을 재사용한다

    def log_message(self, fmt, *args):
        log("  %s" % (fmt % args))

    # ── 보내기 ─────────────────────────────────────────────────────
    def _send(self, code, obj=None, ctype="application/json; charset=utf-8"):
        body = b"" if obj is None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if body:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _reject(self, code, message):
        """프로토콜 이전에 막힌 것 — JSON-RPC 오류 꼴로 알린다(id 는 모른다)."""
        self._send(code, err(None, PARSE_ERROR, message))

    # ── POST /mcp — 이것만 실제로 말을 주고받는다 ──────────────────
    def do_POST(self):
        if self.path.split("?", 1)[0] != config.MCP_HTTP_PATH:
            return self._reject(404, "MCP 는 %s 로 엽니다" % config.MCP_HTTP_PATH)
        if not _local_origin(self.headers.get("Origin")):
            return self._reject(403, "로컬에서만 받습니다 — Origin %s"
                                % self.headers.get("Origin"))

        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if not n:
            # 길이를 안 알려 주는 요청(chunked 등)은 받지 않는다. MCP 클라이언트는
            # 모두 Content-Length 를 붙인다.
            return self._reject(411, "Content-Length 가 필요합니다")

        try:
            payload = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            return self._reject(400, "JSON 을 읽지 못했습니다 — %s" % exc)

        # HTTP 에서는 stdout 이 프로토콜 통로가 아니다. 도구가 print 해도 그만이므로
        # stdout 을 가두지 않는다(stdio 전송과 다른 점).
        got = handle_payload(payload, _SERVER["tools"], _SERVER["instructions"],
                             protect_stdout=False)
        if got is None:
            # 알림만 들어 있었다 — 돌려줄 응답이 없다. 규격이 정한 자리다.
            return self._send(202)
        return self._send(200, got)

    # ── 나머지 — 열어 두지 않는 것을 분명히 말한다 ────────────────
    def do_GET(self):
        if self.path.split("?", 1)[0] != config.MCP_HTTP_PATH:
            return self._reject(404, "MCP 는 %s 로 엽니다" % config.MCP_HTTP_PATH)
        self._reject(405, "서버가 먼저 말을 거는 통로(SSE)는 열지 않습니다."
                          " 요청은 POST %s 로 보내세요." % config.MCP_HTTP_PATH)

    def do_DELETE(self):
        self._reject(405, "세션을 만들지 않으므로 끊을 것도 없습니다")


def serve_http(tools, instructions="", host=None, port=None):
    """주소를 열고 기다린다. Ctrl+C 로 끝낸다."""
    _SERVER["tools"] = tools
    _SERVER["instructions"] = instructions
    host = host or config.HOST
    port = port or config.MCP_HTTP_PORT

    srv = ThreadingHTTPServer((host, port), Handler)
    log("%s %s — http://%s:%d%s 로 기다립니다 (도구 %d개)"
        % (config.MCP_NAME, config.MCP_VERSION, host, port, config.MCP_HTTP_PATH,
           len(tools)))
    log("클라이언트는 이 주소로 붙습니다. 종료하려면 Ctrl+C 를 누르세요.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("종료합니다.")
    finally:
        srv.server_close()
    return 0
