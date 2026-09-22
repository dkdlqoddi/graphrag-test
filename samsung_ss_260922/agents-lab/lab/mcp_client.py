# -*- coding: utf-8 -*-
"""MCP 클라이언트 — mcp_config.json 에 적힌 서버에 연결해 도구 목록을 받아 온다.

두 가지 연결 방식을 지원한다 (업계 관례 그대로).
  - 로컬 stdio : {"command": "python", "args": ["...server.py"]}
  - 원격 HTTP  : {"url": "https://..."}   (Streamable HTTP)

설정 값에 `${TAVILY_API_KEY}` 처럼 적으면 연결할 때 .env 의 값으로 채운다.
열쇠를 설정 파일에 적지 않기 위한 것이다 (expand_env 참고).

설정은 앱을 다시 실행할 때 반영된다. 한 서버가 실패해도 나머지는 그대로 쓴다.
파이썬 표준 라이브러리만 사용한다.
"""

import json
import os
import queue
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

from . import config

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "tool-lab", "version": "1.0"}
RESULT_LIMIT = 12000         # 도구 결과가 너무 길면 잘라서 넘긴다 (주간 예약 전량이 잘리지 않을 크기)

_CACHE = {"entries": None, "errors": None, "servers": []}
LAUNCH_LOG = []              # 어떤 서버를 어떤 실행 파일로 띄웠는지 (기동 로그용)


# ── 설정 속 ${VAR} 치환 ───────────────────────────────────────────────
# 열쇠가 필요한 원격 서버가 있다. 그 값을 설정 파일에 적으면 카탈로그에도
# mcp_config.json 에도 그대로 남는다. 그래서 파일에는 ${TAVILY_API_KEY} 같은
# 자리표시자만 두고, **연결하는 순간에만** .env 의 값으로 채운다.
# 채운 주소는 메모리에만 있고 어디에도 기록하지 않는다.

_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def is_local(host):
    """내 PC 를 가리키는 주소인가. 기본 규약(http/https)과 오류 문구를 여기에 맞춘다."""
    host = (host or "").strip().lower().strip("[]")
    return host in ("localhost", "127.0.0.1", "0.0.0.0", "::1") or host.endswith(".local")


class MissingEnv(Exception):
    """자리표시자에 해당하는 값이 .env 에 없다. 메시지에는 이름만 담는다."""


def expand_env(value):
    """문자열 안의 ${VAR} 를 환경 변수 값으로 바꾼다. 값이 없으면 MissingEnv."""
    if not isinstance(value, str) or "${" not in value:
        return value
    missing = []

    def replace(match):
        name = match.group(1)
        found = os.environ.get(name, "").strip()
        if not found:
            missing.append(name)
            return ""
        return found

    filled = _ENV_PATTERN.sub(replace, value)
    if missing:
        raise MissingEnv(", ".join(sorted(set(missing))))
    return filled


# ── 로컬 stdio 서버 ───────────────────────────────────────────────────

class StdioServer(object):
    def __init__(self, name, command, args, cwd):
        self.name = name
        self._next_id = 0
        self._queue = queue.Queue()
        self._lock = threading.Lock()

        argv = [_resolve_command(command)] + [_resolve_path(a, cwd) for a in args]
        self.executable = argv[0]
        kwargs = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.DEVNULL,
            "cwd": cwd,
            "env": _child_env(),
        }
        if os.name == "nt":
            kwargs["creationflags"] = 0x08000000        # CREATE_NO_WINDOW
        self._proc = subprocess.Popen(argv, **kwargs)

        self._reader = threading.Thread(target=self._read_loop)
        self._reader.daemon = True
        self._reader.start()

    def _read_loop(self):
        try:
            for raw in self._proc.stdout:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    self._queue.put(json.loads(line))
                except ValueError:
                    continue                            # 서버가 흘린 잡음은 버린다
        except Exception:
            pass

    def _send(self, message):
        data = (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
        self._proc.stdin.write(data)
        self._proc.stdin.flush()

    def request(self, method, params, timeout=20):
        with self._lock:
            return self._request(method, params, timeout)

    def _request(self, method, params, timeout):
        self._next_id += 1
        message_id = self._next_id
        self._send({"jsonrpc": "2.0", "id": message_id, "method": method, "params": params})
        waited = 0.0
        while waited < timeout:
            try:
                message = self._queue.get(timeout=0.5)
            except queue.Empty:
                waited += 0.5
                if self._proc.poll() is not None:
                    raise IOError("서버가 종료되었습니다.")
                continue
            if message.get("id") == message_id:
                if "error" in message:
                    raise IOError(str(message["error"])[:200])
                return message.get("result") or {}
        raise IOError("응답이 없습니다.")

    def notify(self, method, params):
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def close(self):
        try:
            self._proc.terminate()
        except Exception:
            pass


def _resolve_command(command):
    """설정의 python / python3 는 지금 앱을 돌리는 파이썬으로 해석한다.

    (설정 파일 본문은 그대로 두고, py 런처만 있는 노트북에서도 서버가 뜨게 한다.)
    """
    base = os.path.basename(command).lower()
    if base in ("python", "python3", "python.exe", "python3.exe", "py", "py.exe"):
        return sys.executable
    return command


def _resolve_path(value, cwd):
    """설정의 상대 경로는 앱 실행 폴더 기준으로 푼다 (절대 경로를 쓰지 않기 위한 처리)."""
    if isinstance(value, str) and value.endswith(".py") and not os.path.isabs(value):
        candidate = os.path.join(cwd, value.replace("/", os.sep))
        if os.path.exists(candidate):
            return candidate
    return value


def _child_env():
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


# ── 원격 HTTP 서버 ────────────────────────────────────────────────────

class _KeepPost(urllib.request.HTTPRedirectHandler):
    """urllib 의 자동 넘어가기를 끈다.

    urllib 는 301/302 를 만나면 **POST 를 GET 으로 바꿔** 다시 보낸다. MCP 에서 GET 은
    전혀 다른 뜻(서버가 먼저 말을 거는 통로)이라 그렇게 넘어가면 답을 못 읽는다.
    여기서는 넘겨받기를 거절하고, _post 가 같은 POST 그대로 다시 보낸다.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_KeepPost)
REDIRECT_CODES = (301, 302, 303, 307, 308)


class HttpServer(object):
    def __init__(self, name, url):
        self.name = name
        self.url = url
        self.session = None
        self._next_id = 0
        self._lock = threading.Lock()

    def _headers(self):
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
        }
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        return headers

    def _post(self, payload, timeout=30):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        url = self.url
        for _ in range(3):
            request = urllib.request.Request(url, data=data, headers=self._headers(),
                                             method="POST")
            try:
                with _OPENER.open(request, timeout=timeout) as response:
                    found = response.headers.get("Mcp-Session-Id")
                    if found:
                        self.session = found
                    return response.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as exc:
                # /mcp 로 보내면 /mcp/ 로 옮기라고 답하는 서버가 흔하다 (FastMCP 가 그렇다).
                # 그 한 번을 따라가 주지 않으면 주소가 맞는데도 연결에 실패한다.
                target = exc.headers.get("Location") if exc.code in REDIRECT_CODES else None
                if not target:
                    raise
                url = urllib.parse.urljoin(url, target)
                self.url = url                  # 다음 요청부터는 옮겨진 주소로 바로 보낸다
        raise IOError("주소를 너무 여러 번 옮깁니다.")

    def request(self, method, params, timeout=30):
        # 원격 서버는 요청마다 독립된 HTTP 호출이라 동시에 보내도 된다.
        # 잠그는 것은 번호 발급뿐 — 하위 에이전트들이 병렬로 검색할 수 있어야 한다.
        with self._lock:
            self._next_id += 1
            message_id = self._next_id
        body = self._post({"jsonrpc": "2.0", "id": message_id,
                           "method": method, "params": params}, timeout)
        for message in _parse_messages(body):
            if message.get("id") == message_id:
                if "error" in message:
                    raise IOError(str(message["error"])[:200])
                return message.get("result") or {}
        raise IOError("응답을 이해하지 못했습니다.")

    def notify(self, method, params):
        try:
            self._post({"jsonrpc": "2.0", "method": method, "params": params}, timeout=15)
        except Exception:
            pass                                        # 알림 실패는 연결을 막지 않는다

    def close(self):
        pass


def _parse_messages(body):
    """일반 JSON 응답과 SSE(text/event-stream) 응답을 함께 처리한다."""
    text = (body or "").strip()
    if not text:
        return []
    if not text.startswith("event:") and not text.startswith("data:"):
        try:
            data = json.loads(text)
            return data if isinstance(data, list) else [data]
        except ValueError:
            return []
    out = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            try:
                out.append(json.loads(line[5:].strip()))
            except ValueError:
                continue
    return out


# ── 도구 설명 다듬기 ──────────────────────────────────────────────────

ALLOWED_KEYS = ("type", "description", "properties", "items", "required", "enum", "default")


def collapse_union(node):
    """anyOf / oneOf 를 가지 하나로 접는다.

    선택 파라미터를 {"anyOf": [{진짜 타입}, {"type": "null"}], "default": null} 로
    적는 서버가 있다 (Tavily 가 그렇다). anyOf 를 그냥 버리면 타입과 enum 이 함께
    사라져 무엇이든 문자열이 되고, 모델이 빈 문자열을 넣어 서버가 거절한다.
    null 이 아닌 첫 가지를 남기고 바깥의 description 같은 값을 얹는다.
    """
    for key in ("anyOf", "oneOf"):
        options = node.get(key)
        if not isinstance(options, list):
            continue
        real = [o for o in options if isinstance(o, dict) and o.get("type") != "null"]
        if not real:
            continue
        merged = dict(real[0])
        for k, v in node.items():
            if k not in ("anyOf", "oneOf") and k not in merged:
                merged[k] = v
        return merged
    return node


def clean_schema(node):
    """서버가 준 JSON 스키마에서 함수 선언에 필요한 항목만 남긴다 (모델이 못 읽는 확장 필드 제거)."""
    if not isinstance(node, dict):
        return {"type": "string"}
    node = collapse_union(node)
    out = {}
    for key in ALLOWED_KEYS:
        if key not in node:
            continue
        value = node[key]
        if key == "properties" and isinstance(value, dict):
            out[key] = dict((k, clean_schema(v)) for k, v in value.items())
        elif key == "items":
            out[key] = clean_schema(value)
        elif key == "required" and isinstance(value, list):
            out[key] = [str(v) for v in value]
        elif key == "default":
            # 기본값이 있으면 모델이 그 인자를 아예 빼도 된다는 것을 안다.
            # null 은 넘기지 않는다 — 모델이 그대로 null 을 채워 넣는다.
            if value is not None:
                out[key] = value
        else:
            out[key] = value
    if out.get("type") == "object" and "properties" not in out:
        out["properties"] = {}
    if "type" not in out:
        out["type"] = "object" if "properties" in out else "string"
    return out


def _result_text(result):
    """MCP 도구 결과를 사람이 읽는 문자열로 바꾼다."""
    if not isinstance(result, dict):
        return str(result)[:RESULT_LIMIT]
    chunks = []
    for item in result.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text":
            chunks.append(item.get("text") or "")
    text = "\n".join(c for c in chunks if c).strip()
    if not text:
        text = json.dumps(result.get("structuredContent") or result, ensure_ascii=False)
    if len(text) > RESULT_LIMIT:
        text = text[:RESULT_LIMIT] + " …(생략)"
    if result.get("isError"):
        return {"오류": text}
    return text


# ── 연결 ──────────────────────────────────────────────────────────────

def read_config(path):
    """설정 파일을 읽어 (서버 dict, 오류 문구 목록) 을 돌려준다."""
    if not os.path.exists(path):
        return {}, []
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
    except Exception:
        return {}, ["설정 파일의 형식이 올바르지 않습니다. 내용 전체를 다시 붙여넣어 주세요."]
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        return {}, []
    return servers, []


def _connect_one(name, spec, cwd):
    if spec.get("url"):
        # 치환한 주소는 여기서만 쓰고 파일에도 로그에도 남기지 않는다.
        server = HttpServer(name, expand_env(spec["url"]))
    elif spec.get("command"):
        args = [expand_env(a) for a in (spec.get("args") or [])]
        server = StdioServer(name, expand_env(spec["command"]), args, cwd)
        LAUNCH_LOG.append((name, spec["command"], server.executable))
    else:
        raise IOError("연결 정보가 없습니다.")

    server.request("initialize", {
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": CLIENT_INFO,
    })
    server.notify("notifications/initialized", {})
    listed = server.request("tools/list", {})

    entries = []
    for tool in listed.get("tools") or []:
        tool_name = tool.get("name")
        if not tool_name:
            continue
        entries.append({
            "name": tool_name,
            "description": (tool.get("description") or "").strip(),
            "parameters": clean_schema(tool.get("inputSchema")),
            "source": name,
            "call": _make_caller(server, tool_name),
        })
    return server, entries


def _make_caller(server, tool_name):
    def call(args):
        try:
            result = server.request("tools/call", {"name": tool_name, "arguments": args or {}}, 60)
        except Exception as exc:
            return {"오류": "도구를 실행하지 못했습니다.", "내용": str(exc)[:200]}
        return _result_text(result)
    return call


class ProbeFailed(Exception):
    """확인에 실패했다. 메시지는 화면에 그대로 보여 줄 수 있는 문구여야 한다.

    주소에 ${VAR} 를 쓰면 채워진 주소에 열쇠가 들어간다. 그래서 예외 원문을 그대로
    올리지 않고, 여기서 무해한 문구로 바꿔 담는다.
    """


def probe(spec):
    """서버에 한 번 붙어 도구 목록만 받아 보고 끊는다.

    화면에서 주소를 등록할 때 쓴다. 설정 파일에 적어 두기 전에 **정말 MCP 서버인지,
    도구를 무엇을 주는지** 먼저 확인하기 위한 것이다.
    """
    config.load_env()                   # ${VAR} 치환에 쓸 값을 먼저 올린다
    try:
        server, tools = _connect_one("확인", spec, config.ROOT)
    except MissingEnv as exc:
        raise ProbeFailed(".env 에 %s 가 없습니다. 값을 넣고 다시 등록해 주세요." % exc)
    except urllib.error.HTTPError as exc:
        hint = " 주소 끝의 경로(/mcp 같은 것)가 맞는지 확인해 주세요." if exc.code in (404, 405) else ""
        raise ProbeFailed("서버가 요청을 거절했습니다 (HTTP %s).%s" % (exc.code, hint))
    except urllib.error.URLError:
        where = urllib.parse.urlparse(spec.get("url") or "")
        if is_local(where.hostname):
            raise ProbeFailed("그 주소에 닿지 못했습니다. %s 에서 아무도 듣고 있지 않습니다 — "
                              "MCP 서버를 먼저 켜 주세요." % (where.netloc or "그 주소"))
        raise ProbeFailed("그 주소에 닿지 못했습니다. 주소와 인터넷 연결을 확인해 주세요.")
    except Exception:
        raise ProbeFailed("MCP 서버로 응답하지 않는 주소입니다. 주소를 확인해 주세요.")
    try:
        return [{"name": t["name"], "description": t.get("description", "")} for t in tools]
    finally:
        server.close()                  # 확인용 연결은 여기서 끝낸다


def connect_all(path):
    """설정에 적힌 서버에 연결한다. 결과는 앱이 살아 있는 동안 재사용한다."""
    if _CACHE["entries"] is not None:
        return _CACHE["entries"], _CACHE["errors"]

    config.load_env()                   # ${VAR} 치환에 쓸 값을 먼저 올린다
    servers, errors = read_config(path)
    del LAUNCH_LOG[:]
    entries = []
    handles = []
    for name in servers:
        spec = servers[name]
        if not isinstance(spec, dict):
            errors.append("%s 서버의 설정을 읽지 못했습니다." % name)
            continue
        try:
            server, tools = _connect_one(name, spec, config.ROOT)
        except MissingEnv as exc:
            # 이름만 알려 준다. 값은 어디에도 찍지 않는다.
            errors.append("%s 서버: .env 에 %s 가 없습니다. 값을 넣고 다시 연결해 주세요."
                          % (name, exc))
            continue
        except Exception:
            errors.append("%s 서버에 연결하지 못했습니다." % name)
            continue
        if not tools:
            errors.append("%s 서버에서 도구 목록을 받지 못했습니다." % name)
            server.close()
            continue
        handles.append(server)
        entries.extend(tools)

    _CACHE["entries"] = entries
    _CACHE["errors"] = errors
    _CACHE["servers"] = handles
    return entries, errors


def reset():
    """연결을 모두 끊고 캐시를 비운다 (실측 스크립트가 설정을 바꿔 가며 쓴다)."""
    for server in _CACHE["servers"]:
        server.close()
    _CACHE["entries"] = None
    _CACHE["errors"] = None
    _CACHE["servers"] = []
    del LAUNCH_LOG[:]
