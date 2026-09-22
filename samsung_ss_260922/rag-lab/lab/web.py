# -*- coding: utf-8 -*-
"""로컬 웹서버와 API.

화면은 네 구획이고, 각 구획이 앞 구획의 산출물을 받는다.
  ① 문서   → ② 청킹 → ③ 임베딩·적재 → ④ 검색 테스트
"""

import json
import os
import re
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import bm25, chunking, config, llm, parsing, pipeline, store

# 파싱 결과와 청킹 결과를 메모리에 들고 있는다. 서버를 끄면 사라진다.
# 적재된 것만 chroma_db 에 남는다.
#
# sem_cache 는 의미 경계 청킹이 잰 문장 거리다. 백분위만 바꿔 다시 자를 때
# 임베딩을 다시 부르지 않기 위한 것이므로, 문서가 바뀌면 반드시 비워야 한다.
STATE = {"doc": None, "name": None, "chunks": [], "strategy": None, "size": None,
         "percentile": None, "sem_cache": {}}


def _read_upload(headers, rfile):
    """multipart/form-data 에서 파일 하나를 꺼낸다. → (파일명, 바이트)

    표준 라이브러리의 cgi 모듈은 Python 3.13 에서 없어졌다. PC 마다
    파이썬 버전이 갈릴 수 있어 직접 읽는다.
    """
    ctype = headers.get("Content-Type") or ""
    m = re.search(r'boundary="?([^";]+)"?', ctype)
    if not m:
        return None, None
    boundary = ("--" + m.group(1)).encode()
    raw = rfile.read(int(headers.get("Content-Length") or 0))

    for part in raw.split(boundary):
        if b"\r\n\r\n" not in part:
            continue
        head, _, data = part.partition(b"\r\n\r\n")
        head_s = head.decode("utf-8", "replace")
        if "filename=" not in head_s:
            continue
        fn = re.search(r'filename="([^"]*)"', head_s)
        if not fn or not fn.group(1):
            continue
        return fn.group(1), data.rstrip(b"\r\n-")
    return None, None


def _json(handler, obj, code=200):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    server_version = "rag-lab"

    def log_message(self, fmt, *args):
        print("  %s" % (fmt % args))

    # ── 정적 파일 ───────────────────────────────────────────────────
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            path = "/index.html"
        if path == "/api/status":
            return self._api_status()
        if path == "/api/document":
            return self._api_document()
        if path == "/api/chunks":
            return self._api_chunks()

        fs = os.path.join(config.STATIC_DIR, path.lstrip("/"))
        if not os.path.isfile(fs):
            return _json(self, {"error": "not found"}, 404)
        ctype = ("text/html" if fs.endswith(".html") else
                 "text/css" if fs.endswith(".css") else
                 "application/javascript" if fs.endswith(".js") else
                 "application/octet-stream")
        with open(fs, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "%s; charset=utf-8" % ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            if path == "/api/upload":
                return self._api_upload()
            if path == "/api/chunk":
                return self._api_chunk()
            if path == "/api/embed":
                return self._api_embed()
            if path == "/api/search":
                return self._api_search()
            if path == "/api/vector":
                return self._api_vector()
            if path == "/api/reset":
                store.reset()
                bm25.invalidate()
                return _json(self, {"ok": True, "status": store.status()})
            if path == "/api/clear-generated":
                n = store.clear_generated()
                bm25.invalidate()
                print("생성된 근거 %d건을 지웠습니다" % n)
                return _json(self, {"ok": True, "removed": n, "status": store.status()})
            return _json(self, {"error": "not found"}, 404)
        except Exception as e:                 # noqa: BLE001
            traceback.print_exc()
            return _json(self, {"error": str(e)}, 500)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    # ── ① 문서 ─────────────────────────────────────────────────────
    def _api_upload(self):
        filename, data = _read_upload(self.headers, self.rfile)
        if not filename or not data:
            return _json(self, {"error": "파일이 없습니다"}, 400)

        os.makedirs(config.DATA_DIR, exist_ok=True)
        name = os.path.basename(filename)
        dest = os.path.join(config.DATA_DIR, name)
        with open(dest, "wb") as f:
            f.write(data)

        print("파싱 시작 — %s" % name)
        doc = parsing.parse_pdf(dest)
        STATE.update({"doc": doc, "name": name, "chunks": [],
                      "strategy": None, "size": None, "percentile": None})
        STATE["sem_cache"].clear()         # 다른 문서의 문장 거리를 물려주지 않는다
        print("파싱 완료 — %d쪽 / %d자 / 글자가 거의 없는 페이지 %d쪽"
              % (doc["n_pages"], doc["n_chars"], len(doc["thin_pages"])))
        return _json(self, self._doc_payload())

    def _doc_payload(self):
        doc = STATE["doc"]
        if not doc:
            return {"loaded": False}
        return {
            "loaded": True,
            "name": STATE["name"],
            "n_pages": doc["n_pages"],
            "n_chars": doc["n_chars"],
            "thin_pages": doc["thin_pages"],
            "empty_pages": doc["empty_pages"],
            "pages": [{"page": p["page"], "n_chars": p["n_chars"],
                       "thin": parsing.is_thin(p)} for p in doc["pages"]],
        }

    def _api_document(self):
        q = self.path.split("?", 1)
        page = 1
        if len(q) > 1:
            for kv in q[1].split("&"):
                if kv.startswith("page="):
                    page = int(kv[5:] or 1)
        doc = STATE["doc"]
        if not doc:
            return _json(self, {"loaded": False})
        page = max(1, min(page, doc["n_pages"]))
        p = doc["pages"][page - 1]
        return _json(self, {"loaded": True, "page": page,
                            "n_pages": doc["n_pages"],
                            "n_chars": p["n_chars"],
                            "thin": parsing.is_thin(p),
                            "text": p["text"]})

    # ── ② 청킹 ─────────────────────────────────────────────────────
    def _api_chunk(self):
        if not STATE["doc"]:
            return _json(self, {"error": "먼저 PDF 를 올려 주세요"}, 400)
        body = self._body()
        strategy = body.get("strategy", "fixed")
        size = body.get("size", config.CHUNK_SIZE_DEFAULT)

        def progress(done, total):
            print("  문장 임베딩 %d/%d" % (done, total))

        # 의미 경계 전략만 ctx 를 본다. 캐시가 있으면 임베딩을 다시 부르지 않는다.
        ctx = {"percentile": body.get("percentile", config.SEMANTIC_PCT_DEFAULT),
               "cache": STATE["sem_cache"], "on_progress": progress}
        if strategy == "semantic" and not STATE["sem_cache"]:
            print("의미 경계 — 문장을 임베딩합니다 (처음 한 번)")

        chunks = chunking.chunk(STATE["doc"], strategy, size, ctx)
        report = ctx.get("report")
        STATE.update({"chunks": chunks, "strategy": strategy, "size": size,
                      "percentile": report["percentile"] if report else None})
        if report:
            print("청킹 — %s / 상위 %d%% / 임계 거리 %.4f / 문장 %d개 중 %d곳에서 자름"
                  " / 청크 %d개%s"
                  % (config.STRATEGIES[strategy], report["percentile"], report["threshold"],
                     report["sentences"], report["cuts"], len(chunks),
                     " (임베딩 재사용)" if report["cached"] else ""))
        else:
            print("청킹 — %s / %d자 기준 / 청크 %d개"
                  % (config.STRATEGIES[strategy], size, len(chunks)))
        return _json(self, {"strategy": strategy,
                            "strategy_label": config.STRATEGIES[strategy],
                            "size": size,
                            "semantic": report,
                            "summary": chunking.summarize(chunks),
                            "chunks": chunks})

    def _api_chunks(self):
        return _json(self, {"chunks": STATE["chunks"],
                            "strategy": STATE["strategy"],
                            "summary": chunking.summarize(STATE["chunks"])})

    # ── ③ 임베딩 · 적재 ────────────────────────────────────────────
    def _api_embed(self):
        if not STATE["chunks"]:
            return _json(self, {"error": "먼저 청킹을 실행하세요"}, 400)
        chunks = STATE["chunks"]
        print("임베딩 시작 — %d개" % len(chunks))

        def progress(done, total):
            print("  임베딩 %d/%d" % (done, total))

        vectors = llm.embed_many([c["text"] for c in chunks], progress)
        store.add(STATE["name"], chunks, vectors)
        bm25.invalidate()                      # 말뭉치가 늘었다 — 색인을 새로 만든다
        print("적재 완료 — %s / %d건" % (STATE["name"], len(chunks)))
        return _json(self, {"ok": True, "added": len(chunks),
                            "status": store.status()})

    def _api_status(self):
        # 새로고침해도 지금까지 온 단계가 화면에 그대로 복원되어야 한다
        return _json(self, {"store": store.status(),
                            "document": self._doc_payload(),
                            "chunking": {"strategy": STATE["strategy"],
                                         "label": config.STRATEGIES.get(STATE["strategy"]),
                                         "size": STATE["size"],
                                         "percentile": STATE["percentile"],
                                         "summary": chunking.summarize(STATE["chunks"])},
                            "strategies": config.STRATEGIES,
                            "defaults": {"size": config.CHUNK_SIZE_DEFAULT,
                                         "k": config.TOP_K_DEFAULT,
                                         "percentile": config.SEMANTIC_PCT_DEFAULT}})

    def _api_vector(self):
        body = self._body()
        got = store.peek_vector(body.get("document"), int(body.get("chunk_index", 0)))
        return _json(self, got or {"error": "적재되지 않은 청크입니다"})

    # ── ④ 검색 ─────────────────────────────────────────────────────
    def _api_search(self):
        """④ 검색 — 실제 일은 `lab/pipeline.py` 가 한다.

        여기서 하는 것은 요청을 풀어 넘기고 결과를 JSON 으로 돌려주는 것뿐이다.
        검색이 지나는 길(재작성 → HyDE → 두 열 → 재정렬 → 하이라이트 → 생성 → 되먹임)은
        MCP 창구(`lab/mcp_tools.py`)와 함께 쓰므로 한 곳에 둔다 — 두 벌로 나누면
        규칙이 한쪽에서만 지켜진다.
        """
        body = self._body()
        q = (body.get("query") or "").strip()
        if not q:
            return _json(self, {"error": "질문을 입력하세요"}, 400)
        return _json(self, pipeline.search(q, body.get("k"), body, print))


def serve():
    os.makedirs(config.DATA_DIR, exist_ok=True)
    srv = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    print("rag-lab  http://%s:%d/" % (config.HOST, config.PORT))
    print("종료하려면 이 창에서 Ctrl+C 를 누르세요.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
