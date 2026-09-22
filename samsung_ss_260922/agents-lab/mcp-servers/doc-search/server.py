# -*- coding: utf-8 -*-
"""자료 조사 MCP 서버 — 내 PC 에서 돈다.

`docs/` 폴더의 문서를 찾아 준다. 인터넷을 쓰지 않으므로 회선 상태와 무관하다.

MCP 의 stdio 전송이란 이런 것이다 — 표준 입력으로 JSON 한 줄을 받고,
표준 출력으로 JSON 한 줄을 돌려준다. 그 밖의 것은 절대 출력하지 않는다.
디버그 출력을 stdout 에 흘리면 프로토콜이 깨진다.

    initialize                 인사. 서버가 자기를 소개한다
    tools/list                 무엇을 할 수 있는지 알려준다  ← "광고"
    tools/call                 실제로 하나를 실행한다
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "docs")

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "doc-search", "version": "1.0.0"}
SNIPPET = 400          # 검색 결과로 보여줄 앞뒤 길이


# ── 문서 ──────────────────────────────────────────────────────────────

def load_docs():
    """docs/ 의 .md .txt 를 읽는다. 폴더가 없으면 빈 목록."""
    out = []
    if not os.path.isdir(DOCS):
        return out
    for name in sorted(os.listdir(DOCS)):
        if not name.lower().endswith((".md", ".txt")):
            continue
        path = os.path.join(DOCS, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                body = f.read()
        except OSError:
            continue
        first = next((l.strip(" #\t") for l in body.splitlines() if l.strip()), name)
        out.append({"file": name, "title": first[:80], "body": body})
    return out


def tool_doc_list(_args):
    docs = load_docs()
    if not docs:
        return "자료 폴더에 문서가 없습니다."
    return "\n".join("- %s (%s, %d자)" % (d["title"], d["file"], len(d["body"]))
                     for d in docs)


def tool_doc_search(args):
    query = (args.get("query") or "").strip()
    if not query:
        return "찾을 말을 넣어 주세요."
    words = [w for w in query.split() if w]
    hits = []
    for doc in load_docs():
        low = doc["body"].lower()
        for word in words:
            at = low.find(word.lower())
            if at < 0:
                continue
            start = max(0, at - SNIPPET // 4)
            hits.append("[%s] …%s…" % (
                doc["title"], doc["body"][start:start + SNIPPET].replace("\n", " ")))
            break
    if not hits:
        return "'%s' 에 해당하는 내용을 자료에서 찾지 못했습니다." % query
    return "\n\n".join(hits[:5])


TOOLS = [
    {
        "name": "doc_list",
        "description": "이 컴퓨터에 있는 자료 문서의 목록을 보여준다. 무엇을 조사할 수 있는지 먼저 확인할 때 쓴다.",
        "inputSchema": {"type": "object", "properties": {}},
        "run": tool_doc_list,
    },
    {
        "name": "doc_search",
        "description": "이 컴퓨터에 있는 자료 문서 안에서 찾는 말이 나오는 부분을 뽑아 준다.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "찾을 말"}},
            "required": ["query"],
        },
        "run": tool_doc_search,
    },
]


# ── JSON-RPC ──────────────────────────────────────────────────────────

def handle(message):
    """요청 하나를 처리한다. 알림(id 없음)이면 None 을 돌려준다."""
    method = message.get("method")
    mid = message.get("id")

    if method == "initialize":
        result = {"protocolVersion": PROTOCOL_VERSION,
                  "capabilities": {"tools": {}},
                  "serverInfo": SERVER_INFO}
    elif method == "tools/list":
        result = {"tools": [{"name": t["name"],
                             "description": t["description"],
                             "inputSchema": t["inputSchema"]} for t in TOOLS]}
    elif method == "tools/call":
        params = message.get("params") or {}
        name = params.get("name")
        tool = next((t for t in TOOLS if t["name"] == name), None)
        if tool is None:
            return {"jsonrpc": "2.0", "id": mid,
                    "error": {"code": -32602, "message": "그런 도구가 없습니다: %s" % name}}
        try:
            text = tool["run"](params.get("arguments") or {})
        except Exception as exc:                        # noqa: BLE001
            text = "도구를 실행하지 못했습니다: %s" % str(exc)[:200]
        result = {"content": [{"type": "text", "text": text}]}
    elif mid is None:
        return None                                     # 알림에는 답하지 않는다
    else:
        return {"jsonrpc": "2.0", "id": mid,
                "error": {"code": -32601, "message": "모르는 요청입니다: %s" % method}}

    if mid is None:
        return None
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        reply = handle(message)
        if reply is not None:
            sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
