# -*- coding: utf-8 -*-
"""agent-lab 로컬 서버.

run.bat 이 이 파일을 실행한다. 브라우저 화면과 /api/* 를 제공한다.
"""

import json
import os
import re
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lab import (config, datafile, llm, mcp_client, orchestrator,      # noqa: E402
                 registry, roles, runner, tools)

STATIC = os.path.join(config.ROOT, "static")
CATALOG_PATH = os.path.join(config.ROOT, "mcp_catalog.json")
LOCK = threading.Lock()
MAX_BODY = 8 * 1024 * 1024            # 파일을 base64 로 실어 보내므로 상한을 둔다

MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml"}


# ── 상태 ──────────────────────────────────────────────────────────────

def _read_json(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
    except (ValueError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def custom_servers():
    """화면에서 주소를 넣어 등록한 서버. 같이 딸려온 카탈로그와 파일을 나눠 둔다.

    mcp_catalog.json 은 수업에서 미리 고른 목록이라 그대로 두고,
    사용자가 등록한 것은 state/mcp_custom.json 에만 쌓는다 (지우면 처음 상태로 돌아간다).
    """
    book = {}
    for name, item in _read_json(config.MCP_CUSTOM_PATH).items():
        if isinstance(item, dict) and isinstance(item.get("spec"), dict):
            book[name] = item
    return book


def save_custom(book):
    os.makedirs(config.STATE_DIR, exist_ok=True)
    with open(config.MCP_CUSTOM_PATH, "w", encoding="utf-8") as f:
        json.dump(book, f, ensure_ascii=False, indent=2)
        f.write("\n")


def catalog():
    """연결할 수 있는 MCP 서버 목록. 화면에서 고른다 (기본 목록 + 직접 등록한 것)."""
    book = {}
    for name, item in _read_json(CATALOG_PATH).items():
        if isinstance(item, dict):
            book[name] = item
    for name, item in custom_servers().items():
        book[name] = dict(item, custom=True)
    return book


def connected_names():
    servers, _ = mcp_client.read_config(config.MCP_CONFIG_PATH)
    return list(servers)


def write_mcp_config(names):
    book = catalog()
    servers = {n: book[n]["spec"] for n in names if n in book}
    with open(config.MCP_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump({"mcpServers": servers}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    mcp_client.reset()            # 다음 build 에서 새 설정으로 다시 연결한다


def param_names(entry):
    props = (entry.get("parameters") or {}).get("properties") or {}
    return list(props)


def state():
    entries, errors = registry.build()
    book = catalog()
    live = connected_names()
    counts = {}                                     # 서버마다 몇 개를 내주었는지
    for entry in entries:
        key = entry.get("source", "")
        counts[key] = counts.get(key, 0) + 1
    return {
        "tools": [{
            "name": e["name"],
            "description": e.get("description", ""),
            "default": e.get("default_description", e.get("description", "")),
            "params": param_names(e),
            "source": e.get("source", ""),
        } for e in entries],
        "prompt": runner.system_prompt(),
        "prompt_default": runner.DEFAULT_SYSTEM_PROMPT,
        "prompt_edited": os.path.exists(config.SYSTEM_PROMPT_PATH),
        "data_path": config.notes_path(),
        "data_path_default": config.NOTES_PATH,
        "notes": tools.read_notes(),
        "research_files": datafile.listing_detail(),
        "errors": errors,
        "mcp": {
            "catalog": [{"name": n,
                         "label": book[n].get("label", n),
                         "detail": book[n].get("detail", ""),
                         "on": n in live,
                         "custom": bool(book[n].get("custom")),
                         "tools": counts.get(n, 0)} for n in book],
        },
        "multi": config.multi_enabled(),
    }


# ── 요청 처리 ─────────────────────────────────────────────────────────

def handle_chat(payload):
    message = (payload.get("message") or "").strip()
    if not message:
        return {"ok": False, "message": "무엇을 도와드릴지 입력해 주세요."}
    entries, _ = registry.build()
    if not entries:
        return {"ok": False, "message": "쓸 수 있는 도구가 없습니다."}
    try:
        out = runner.run(message, entries)
    except llm.QuotaExceeded:
        return {"ok": False, "message": "잠시 후 다시 시도해 주세요 (약 1분)."}
    except RuntimeError as exc:
        if str(exc) == "NO_API_KEY":
            return {"ok": False,
                    "message": ".env 파일에 키가 없습니다. OPENAI_API_KEY 를 확인해 주세요."}
        return {"ok": False, "message": "처리 중 문제가 생겼습니다."}
    except llm.LLMError:
        return {"ok": False, "message": "응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요."}
    out["ok"] = True
    out["notes"] = tools.read_notes()          # 도구가 바꾼 결과를 바로 보여준다
    return out


ROUTES = {}
NO_LOCK = set()          # 락을 기다리면 안 되는 경로 (아래 설명)


def route(path, lock=True):
    """POST 처리기를 등록한다.

    lock=False 는 **연구가 도는 중에도 받아야 하는 요청**에 쓴다. 모든 POST 는
    LOCK 하나로 줄 세워 처리하는데, /api/research 가 그 락을 몇 분씩 쥐고 있다.
    중지 요청을 락 뒤에 세우면 연구가 끝난 뒤에야 도착해 아무 의미가 없다.
    """
    def wrap(fn):
        ROUTES[path] = fn
        if not lock:
            NO_LOCK.add(path)
        return fn
    return wrap


@route("/api/chat")
def _chat(p):
    return handle_chat(p)


@route("/api/tool/description")
def _tool_desc(p):
    name = (p.get("name") or "").strip()
    if not name:
        return {"ok": False, "message": "도구 이름이 없습니다."}
    registry.set_override(name, p.get("description") or "")
    return {"ok": True}


@route("/api/tools/reset")
def _tools_reset(_p):
    registry.clear_overrides()
    return {"ok": True}


@route("/api/prompt")
def _prompt(p):
    runner.set_system_prompt(p.get("text") or "")
    return {"ok": True}


@route("/api/prompt/reset")
def _prompt_reset(_p):
    runner.clear_system_prompt()
    return {"ok": True}


@route("/api/data_path")
def _data_path(p):
    value = (p.get("path") or "").strip()
    os.makedirs(config.STATE_DIR, exist_ok=True)
    if not value or value == config.NOTES_PATH:
        if os.path.exists(config.DATA_PATH_OVERRIDE):
            os.remove(config.DATA_PATH_OVERRIDE)
    else:
        with open(config.DATA_PATH_OVERRIDE, "w", encoding="utf-8") as f:
            f.write(value)
    return {"ok": True}


@route("/api/notes/reset")
def _notes_reset(_p):
    try:
        count = tools.reset_notes()
    except (OSError, ValueError):
        return {"ok": False, "message": "초기화에 실패했습니다."}
    return {"ok": True, "count": count}


@route("/api/agents/start")
def _agent_start(p):
    name = p.get("role")
    if name not in roles.ROLES:
        return {"ok": False, "message": "그런 역할이 없습니다."}
    out = orchestrator.start(name)
    out["agents"] = orchestrator.status()
    return out


@route("/api/agents/stop")
def _agent_stop(p):
    name = p.get("role")
    if name not in roles.ROLES:
        return {"ok": False, "message": "그런 역할이 없습니다."}
    out = orchestrator.stop(name)
    out["agents"] = orchestrator.status()
    return out


@route("/api/research")
def _research(p):
    question = (p.get("question") or "").strip()
    if not question:
        return {"ok": False, "message": "연구 질문을 입력해 주세요."}
    follow_up = bool(p.get("follow_up")) and orchestrator.has_session()
    out = orchestrator.research(question, follow_up=follow_up)
    out["has_session"] = orchestrator.has_session()
    return out


@route("/api/research/stop", lock=False)
def _research_stop(_p):
    return orchestrator.request_stop()


@route("/api/research/reset")
def _research_reset(_p):
    orchestrator.reset_session()
    return {"ok": True, "has_session": False}


@route("/api/data/upload")
def _data_upload(p):
    out = datafile.save_upload(p.get("name"), p.get("data"))
    out["files"] = datafile.listing_detail()
    return out


@route("/api/data/delete")
def _data_delete(p):
    out = datafile.delete_file(p.get("name"))
    out["files"] = datafile.listing_detail()
    return out


def _with_scheme(url):
    """주소에 http(s):// 가 없으면 붙인다.

    내 PC 에서 띄운 서버는 대개 http 다 (127.0.0.1:8000/mcp). 무조건 https 를 붙이면
    바로 그 주소가 연결되지 않는다. 그래서 내 PC 주소는 http, 그 밖은 https 로 본다.
    """
    if "://" in url:
        return url
    head = url.split("/")[0]
    host = head.split("]")[0] if head.startswith("[") else head.split(":")[0]
    return ("http://" if mcp_client.is_local(host) else "https://") + url


def _server_label(parsed):
    """화면에 띄울 이름. 포트까지 적는다 — 내 PC 에 여러 서버를 띄우면 그것으로 갈린다."""
    host = parsed.hostname or "mcp"
    return "%s:%d" % (host, parsed.port) if parsed.port else host


def _server_name(url, taken):
    """주소에서 서버 이름을 짓는다. 이름은 설정 파일의 열쇠이자 도구 목록의 출처 표시가 된다."""
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    base = re.sub(r"[^a-z0-9.-]", "-", host).strip("-.") or "mcp"
    if parsed.port:
        base = "%s-%d" % (base, parsed.port)
    name, number = base, 2
    while name in taken:                            # 같은 곳을 다른 경로로 또 등록한 경우
        name = "%s-%d" % (base, number)
        number += 1
    return name


@route("/api/mcp/register")
def _mcp_register(p):
    """주소를 받아 **먼저 붙어 보고** 도구 목록을 확인한 뒤 등록한다.

    확인에 성공하면 곧바로 연결까지 해 둔다. 등록한 서버의 도구가 [도구] 탭 목록에
    그대로 들어온다 — 내장 도구와 구분 없이 한 목록이 된다.
    """
    url = (p.get("url") or "").strip()
    if not url:
        return {"ok": False, "message": "MCP 서버 주소를 입력해 주세요."}
    url = _with_scheme(url)                         # 주소만 적어도 되게 한다
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"ok": False,
                "message": "http:// 또는 https:// 로 시작하는 주소를 넣어 주세요."}

    book = catalog()
    already = None
    for name in book:
        if ((book[name].get("spec") or {}).get("url") or "") == url:
            already = name
            break

    try:
        found = mcp_client.probe({"url": url})
    except mcp_client.ProbeFailed as exc:
        return {"ok": False, "message": str(exc)}
    if not found:
        return {"ok": False, "message": "그 서버는 도구를 하나도 내주지 않았습니다."}

    if already:
        name = already
        label = book[name].get("label", name)
    else:
        name = _server_name(url, book)
        label = _server_label(parsed)
        book_custom = custom_servers()
        book_custom[name] = {"label": label, "detail": url, "spec": {"url": url}}
        save_custom(book_custom)

    live = connected_names()
    if name not in live:
        live.append(name)
    write_mcp_config(live)                          # 여기서 연결이 끊기고
    _entries, errors = registry.build()             # 다음 줄에서 새 설정으로 다시 붙는다
    return {"ok": True, "name": name, "label": label, "tools": found,
            "errors": errors,
            "message": "%s — 도구 %d개를 가져왔습니다.%s"
                       % (label, len(found),
                          " (이미 등록된 주소라 연결만 했습니다)" if already else "")}


@route("/api/mcp/remove")
def _mcp_remove(p):
    """직접 등록한 서버를 목록에서 지운다. 기본 목록은 지우지 않는다."""
    name = (p.get("name") or "").strip()
    book_custom = custom_servers()
    if name not in book_custom:
        return {"ok": False, "message": "직접 등록한 서버만 지울 수 있습니다."}
    del book_custom[name]
    save_custom(book_custom)
    write_mcp_config([n for n in connected_names() if n != name])
    _entries, errors = registry.build()
    return {"ok": True, "errors": errors}


@route("/api/mcp/toggle")
def _mcp_toggle(p):
    name = (p.get("name") or "").strip()
    if name not in catalog():
        return {"ok": False, "message": "그런 서버가 목록에 없습니다."}
    live = connected_names()
    if p.get("on"):
        if name not in live:
            live.append(name)
    else:
        live = [n for n in live if n != name]
    write_mcp_config(live)
    _entries, errors = registry.build()
    return {"ok": True, "errors": errors}


# ── HTTP ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass                                    # 콘솔을 깨끗하게 둔다

    def _send(self, code, body, content_type):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, payload, code=200):
        self._send(code, json.dumps(payload, ensure_ascii=False),
                   "application/json; charset=utf-8")

    def _static(self, name):
        path = os.path.join(STATIC, os.path.basename(name))
        if not os.path.isfile(path):
            self._send(404, "not found", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            self._send(200, f.read(), MIME.get(ext, "application/octet-stream"))

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._static("index.html")
        elif path.startswith("/static/"):
            self._static(path[len("/static/"):])
        elif path == "/api/state":
            with LOCK:
                self._json(state())
        elif path == "/api/agents":
            self._json({"agents": orchestrator.status()})
        elif path == "/api/research/progress":
            # 일부러 LOCK 을 잡지 않는다. /api/research 가 그 락을 쥔 채 도는 동안
            # 진행 상황을 읽어야 하기 때문이다.
            self._json(orchestrator.progress())
        else:
            self._send(404, "not found", "text/plain; charset=utf-8")

    def do_POST(self):
        path = self.path.split("?")[0]
        handler = ROUTES.get(path)
        if handler is None:
            self._send(404, "not found", "text/plain; charset=utf-8")
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                self._json({"ok": False, "message": "보낸 내용이 너무 큽니다."}, 413)
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (ValueError, UnicodeDecodeError):
            self._json({"ok": False, "message": "요청을 읽지 못했습니다."}, 400)
            return
        if path in NO_LOCK:
            self._json(handler(payload))        # 연구가 도는 중에도 받아야 한다
        else:
            with LOCK:
                self._json(handler(payload))


def main():
    print("agent-lab 을 시작합니다.")
    if not os.path.exists(config.NOTES_PATH):
        tools.reset_notes()

    left = orchestrator.cleanup_stale()
    if left:
        print("지난 실행에서 남아 있던 프로세스를 정리했습니다: %s" % ", ".join(left))

    entries, errors = registry.build()
    print("도구 %d개" % len(entries))
    for entry in entries:
        print("  %-28s %s" % (entry["name"], entry["source"]))
    for line in errors:
        print("  " + line)

    address = "http://%s:%d/" % (config.HOST, config.PORT)
    server = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    print("\n주소: %s" % address)
    print("이 창을 닫으면 앱이 종료됩니다.\n")

    if not os.environ.get("AGENT_LAB_NO_BROWSER"):
        threading.Timer(1.0, lambda: webbrowser.open(address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        # 자식을 반드시 정리한다. 남으면 포트가 막혀 다시 켜지지 않는다.
        orchestrator.stop_all()
        mcp_client.reset()


if __name__ == "__main__":
    main()
