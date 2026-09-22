# -*- coding: utf-8 -*-
"""MCP 도구 — ① 파싱 → ② 청킹 → ③ 적재 → ④ 검색을 도구 열두 개로 연다.

`lab/web.py` 와 짝을 이루는 또 하나의 창구다. 같은 `lab/*` 모듈을 부르고 검색은
같은 `lab/pipeline.py` 를 지난다. 다른 것은 **무엇을 통해 사람에게 보이느냐**뿐이다.

  화면  브라우저가 JSON 을 받아 카드·막대·하이라이트로 그린다
  MCP   모델이 글을 받아 읽는다 — 그러므로 **결과 자체가 화면이어야 한다**

그래서 이 모듈의 도구들은 JSON 을 그대로 돌려주지 않고 한국어 설명문을 짓는다.
유사도 0.5821 옆에 "청크 전체보다 이 문장이 가까웠다"를 적고, BM25 가 0건이면
"한국어 질문으로 영문 문서를 찾으면 0건이 납니다 — 이 방식의 성질입니다"를 적는다.
숫자만 넘기면 무엇이 왜 이렇게 되었는지가 사라진다. 이 앱의 목적이 바로 그것이므로
**결과를 JSON 덤프로 바꾸지 말 것.**

단계 사이의 전달은 화면과 똑같다 — 모듈 전역 `STATE` 가 ①②③ 을 잇고, 디스크로
넘어가는 것은 ③ 적재 결과(`chroma_db/`)뿐이다. 다만 **서버가 다르면 STATE 도 다르다**:
`python app.py` 로 띄운 화면과 이 MCP 서버는 서로 다른 프로세스라 파싱·청킹 결과를
주고받지 못한다. 공유되는 것은 저장소뿐이다.

본문을 통째로 싣지 않는 이유도 화면과 다르다. 화면은 스크롤로 넘기면 그만이지만
여기서는 청크 원문이 그대로 모델의 문맥을 차지한다. 그래서 검색 결과의 본문은
`config.MCP_SNIPPET_CHARS` 에서 자르고, 전문이 필요하면 `show_chunks` 로 따로 청한다.
"""

import os
import time

from . import bm25, chunking, config, llm, parsing, pipeline, store
from .mcp_proto import ToolError, log

# 화면(`lab/web.py`)의 STATE 와 같은 뜻이다. 서버가 다르므로 내용은 공유되지 않는다.
STATE = {"doc": None, "name": None, "path": None, "chunks": [],
         "strategy": None, "size": None, "percentile": None, "sem_cache": {}}

INSTRUCTIONS = """rag-lab — PDF 를 파싱·청킹·임베딩해 적재하고, 같은 질문을 의미 검색과
BM25 두 가지로 나란히 돌려 보는 교육용 RAG 실험실입니다.

순서가 있습니다: parse_pdf → chunk → embed_and_store → search.
이미 적재된 문서가 있으면(store_status 로 확인) 앞의 셋을 건너뛰고 바로 search 해도 됩니다.

search 의 스위치(rewrite · hyde · rerank · answer)는 전부 기본 꺼짐입니다. 무엇이 달라지는지
보는 것이 목적이므로 먼저 끄고 한 번, 켜고 한 번 불러 견주는 쓰임을 권합니다.
켤 때마다 OpenAI 호출이 늘어납니다(재정렬은 조각 하나가 곧 호출 하나입니다)."""


# ── 글 짓는 잔손 ────────────────────────────────────────────────────
def _snip(text, n=None):
    text = " ".join((text or "").split())
    n = n or config.MCP_SNIPPET_CHARS
    return text if len(text) <= n else text[:n] + " …"


def _n(x):
    return "{:,}".format(int(x))


def _bool(args, key, default=False):
    v = args.get(key, default)
    return bool(v) if not isinstance(v, str) else v.strip().lower() in ("1", "true", "y", "yes")


def _need_doc():
    if not STATE["doc"]:
        raise ToolError("아직 읽은 PDF 가 없습니다. list_pdfs 로 파일을 고르고"
                        " parse_pdf 를 먼저 부르세요.")
    return STATE["doc"]


def _need_chunks():
    if not STATE["chunks"]:
        raise ToolError("아직 자른 조각이 없습니다. chunk 를 먼저 부르세요.")
    return STATE["chunks"]


# ── ① 문서 ─────────────────────────────────────────────────────────
def list_pdfs(args):
    out = ["data/ 폴더의 PDF"]
    if not os.path.isdir(config.DATA_DIR):
        return "data/ 폴더가 없습니다. PDF 를 넣고 다시 부르세요 — %s" % config.DATA_DIR
    names = sorted(f for f in os.listdir(config.DATA_DIR) if f.lower().endswith(".pdf"))
    if not names:
        return ("data/ 폴더에 PDF 가 없습니다 — %s\n"
                "다른 곳에 있는 파일은 parse_pdf 에 전체 경로를 주면 됩니다."
                % config.DATA_DIR)
    for f in names:
        size = os.path.getsize(os.path.join(config.DATA_DIR, f))
        out.append("  %-52s %6.1f MB" % (f, size / 1048576.0))
    st = store.status()
    loaded = {d["document"] for d in st["documents"]}
    out.append("")
    out.append("이미 적재된 문서: %s" % (", ".join(sorted(loaded)) if loaded else "없음"))
    out.append("다음 — parse_pdf(path=\"%s\")" % names[0])
    return "\n".join(out)


def parse_pdf(args):
    raw = (args.get("path") or "").strip()
    if not raw:
        raise ToolError("path 가 필요합니다. data/ 안의 파일명이거나 전체 경로입니다.")
    path = raw if os.path.isabs(raw) else os.path.join(config.DATA_DIR, raw)
    if not os.path.isfile(path):
        path = os.path.abspath(raw)
    if not os.path.isfile(path):
        raise ToolError("그런 파일이 없습니다 — %s\nlist_pdfs 로 목록을 보세요." % raw)

    name = os.path.basename(path)
    log("파싱 시작 — %s" % name)
    t0 = time.time()
    doc = parsing.parse_pdf(path)
    took = time.time() - t0

    STATE.update({"doc": doc, "name": name, "path": path, "chunks": [],
                  "strategy": None, "size": None, "percentile": None})
    STATE["sem_cache"].clear()             # 다른 문서의 문장 거리를 물려주지 않는다
    log("파싱 완료 — %d쪽 / %d자" % (doc["n_pages"], doc["n_chars"]))

    out = ["① 파싱 — %s" % name,
           "  %s쪽 / %s자 / %.1f초 (pypdf 기본 추출)"
           % (_n(doc["n_pages"]), _n(doc["n_chars"]), took)]
    if doc["n_pages"]:
        per = [p["n_chars"] for p in doc["pages"]]
        out.append("  페이지당 글자 수  최소 %s · 최대 %s · 평균 %s"
                   % (_n(min(per)), _n(max(per)), _n(sum(per) // len(per))))
    if doc["thin_pages"]:
        out.append("  글자가 거의 없는 페이지 %d쪽 — %s"
                   % (len(doc["thin_pages"]),
                      ", ".join(str(p) for p in doc["thin_pages"][:25])
                      + (" …" if len(doc["thin_pages"]) > 25 else "")))
        out.append("    그 자리에는 그림·표만 있었다는 뜻입니다. 표의 행·열은 복원하지"
                   " 않고, 이미지 안의 글자는 나오지 않습니다.")
    else:
        out.append("  글자가 거의 없는 페이지: 없음")
    if doc["empty_pages"]:
        out.append("  한 글자도 안 나온 페이지 %d쪽 — %s"
                   % (len(doc["empty_pages"]),
                      ", ".join(str(p) for p in doc["empty_pages"][:25])))
    out.append("")
    out.append("페이지 원문은 read_page(page=1) 로 봅니다.")
    out.append("다음 — chunk(strategy=\"fixed\"|\"structure\"|\"paragraph\"|\"semantic\")")
    return "\n".join(out)


def read_page(args):
    doc = _need_doc()
    try:
        page = int(args.get("page") or 1)
    except (TypeError, ValueError):
        raise ToolError("page 는 숫자여야 합니다")
    page = max(1, min(page, doc["n_pages"]))
    p = doc["pages"][page - 1]
    text = p["text"]
    cut = ""
    if len(text) > config.MCP_PAGE_CHARS:
        text = text[:config.MCP_PAGE_CHARS]
        cut = "\n… (%s자 중 앞 %s자만 실었습니다)" % (_n(p["n_chars"]),
                                                     _n(config.MCP_PAGE_CHARS))
    head = "① 파싱 결과 — %s %d/%d쪽 · %s자%s" % (
        STATE["name"], page, doc["n_pages"], _n(p["n_chars"]),
        "  ← 글자가 거의 없는 페이지입니다" if parsing.is_thin(p) else "")
    return "%s\n%s\n%s%s" % (head, "─" * 60, text if text.strip() else "(빈 페이지)", cut)


# ── ② 청킹 ─────────────────────────────────────────────────────────
def chunk(args):
    doc = _need_doc()
    strategy = (args.get("strategy") or "fixed").strip()
    if strategy not in config.STRATEGIES:
        raise ToolError("모르는 전략입니다: %s\n고를 수 있는 것 — %s"
                        % (strategy, " · ".join("%s(%s)" % (k, v)
                                                for k, v in config.STRATEGIES.items())))
    size = args.get("size") or config.CHUNK_SIZE_DEFAULT
    pct = args.get("percentile") or config.SEMANTIC_PCT_DEFAULT

    if strategy == "semantic" and not STATE["sem_cache"]:
        log("의미 경계 — 문장을 임베딩합니다 (처음 한 번)")
    ctx = {"percentile": pct, "cache": STATE["sem_cache"],
           "on_progress": lambda done, total: log("  문장 임베딩 %d/%d" % (done, total))}

    t0 = time.time()
    chunks = chunking.chunk(doc, strategy, size, ctx)
    took = time.time() - t0
    report = ctx.get("report")
    STATE.update({"chunks": chunks, "strategy": strategy, "size": size,
                  "percentile": report["percentile"] if report else None})

    s = chunking.summarize(chunks)
    out = ["② 청킹 — %s(%s)" % (config.STRATEGIES[strategy], strategy)]
    if report:
        # 의미 경계는 길이가 아니라 백분위로 자른다 — size 를 쓰지 않는다.
        out.append("  상위 %d%% 자리에서 자름 / 임계 거리 %.4f"
                   % (report["percentile"], report["threshold"]))
        out.append("  문장 %s개 중 %s곳에서 잘랐습니다%s"
                   % (_n(report["sentences"]), _n(report["cuts"]),
                      " (문장 거리를 다시 쓰므로 임베딩 호출 없음)"
                      if report["cached"] else " (문장 임베딩 1회)"))
        out.append("  길이 기준(size)은 쓰지 않습니다. 뜻이 좀처럼 안 바뀌면"
                   " %s자에서만 끊습니다." % _n(config.CHUNK_SIZE_MAX))
    else:
        out.append("  %s자 기준 / 오버랩 없음" % _n(int(size)))
    out.append("  조각 %s개 — 최소 %s자 · 최대 %s자 · 평균 %s자 / %.2f초"
               % (_n(s["count"]), _n(s["min"]), _n(s["max"]), _n(s["avg"]), took))

    pages = sorted({c["page"] for c in chunks})
    out.append("  걸쳐 있는 페이지 %d쪽 (%s~%s)"
               % (len(pages), pages[0] if pages else "-", pages[-1] if pages else "-"))
    out.append("")
    out.append("미리보기 (앞 %d개, 전문은 show_chunks)" % min(config.MCP_PREVIEW_CHUNKS,
                                                              len(chunks)))
    for c in chunks[:config.MCP_PREVIEW_CHUNKS]:
        out.append("  #%-4d %3d쪽 %5d자  %s"
                   % (c["index"], c["page"], c["n_chars"], _snip(c["text"], 90)))
    out.append("")
    out.append("전략을 바꿔 다시 부르면 이 결과를 덮어씁니다. 다음 — embed_and_store()")
    return "\n".join(out)


def show_chunks(args):
    chunks = _need_chunks()
    try:
        start = max(0, int(args.get("start") or 0))
        count = int(args.get("count") or 3)
    except (TypeError, ValueError):
        raise ToolError("start · count 는 숫자여야 합니다")
    count = max(1, min(count, config.MCP_MAX_CHUNKS))
    picked = chunks[start:start + count]
    if not picked:
        raise ToolError("그 자리에는 조각이 없습니다. 지금 조각은 0 ~ %d번입니다."
                        % (len(chunks) - 1))

    out = ["② 청크 원문 — %s / %s / %d ~ %d번 (전체 %s개)"
           % (STATE["name"], config.STRATEGIES[STATE["strategy"]],
              start, start + len(picked) - 1, _n(len(chunks)))]
    for c in picked:
        out.append("")
        out.append("── #%d · %d쪽 · %s자 %s"
                   % (c["index"], c["page"], _n(c["n_chars"]), "─" * 28))
        out.append(c["text"])
    return "\n".join(out)


# ── ③ 임베딩 · 적재 ────────────────────────────────────────────────
def embed_and_store(args):
    chunks = _need_chunks()
    before = store.status()
    log("임베딩 시작 — %d개" % len(chunks))
    t0 = time.time()
    vectors = llm.embed_many([c["text"] for c in chunks],
                             lambda done, total: log("  임베딩 %d/%d" % (done, total)))
    embed_took = time.time() - t0

    t1 = time.time()
    store.add(STATE["name"], chunks, vectors)
    bm25.invalidate()                          # 말뭉치가 늘었다 — 색인을 새로 만든다
    add_took = time.time() - t1
    after = store.status()
    log("적재 완료 — %s / %d건" % (STATE["name"], len(chunks)))

    out = ["③ 임베딩 · 적재 — %s" % STATE["name"],
           "  %s / %d차원 / 조각 %s개 → %d번 호출 (%d개씩 묶음)"
           % (config.EMBED_MODEL, config.EMBED_DIM, _n(len(chunks)),
              (len(chunks) + config.EMBED_BATCH - 1) // config.EMBED_BATCH,
              config.EMBED_BATCH),
           "  임베딩 %.2f초 · 적재 %.2f초" % (embed_took, add_took),
           "  저장소 %s건 → %s건" % (_n(before["total"]), _n(after["total"])),
           "",
           "  ID 는 \"{문서명}#{번호}\" 입니다 — 같은 문서를 다른 전략으로 다시 적재하면"
           " 겹쳐 덮어씁니다.",
           "  전략을 바꿔 견줄 때는 reset_store 로 먼저 비우세요.",
           "",
           "  낱말 검색(BM25) 색인은 버렸습니다. 다음 search 에서 다시 만듭니다.",
           "다음 — search(query=\"…\")"]
    return "\n".join(out)


def store_status(args):
    st = store.status()
    if not st["total"]:
        return ("③ 저장소가 비어 있습니다.\n"
                "parse_pdf → chunk → embed_and_store 순으로 채우세요.")
    out = ["③ 저장소 — 모두 %s건 (%s / %d차원, hnsw:space=cosine)"
           % (_n(st["total"]), st.get("model"), st.get("dim") or 0)]
    for d in st["documents"]:
        kind = "생성분" if d["source"] == "generated" else "문서"
        out.append("  %-52s %5s개  %-10s %s"
                   % (d["document"], _n(d["chunks"]),
                      config.STRATEGIES.get(d["strategy"], d["strategy"]), kind))
    gen = st.get("generated") or 0
    out.append("")
    if gen:
        out.append("  그중 모델이 쓴 답변이 %s건입니다. 검색에서 빼려면"
                   " search(include_generated=false), 지우려면 clear_generated()." % _n(gen))
    else:
        out.append("  모델이 쓴 답변은 아직 없습니다 (search 의 save_answer 로 쌓입니다).")
    out.append("  의미 검색과 BM25 는 **이 하나의 저장소**를 함께 봅니다 —"
               " 말뭉치가 달라지면 나란히 견주는 뜻이 없습니다.")
    return "\n".join(out)


def peek_vector(args):
    doc = (args.get("document") or "").strip()
    if not doc:
        raise ToolError("document 가 필요합니다. store_status 로 이름을 보세요.")
    try:
        idx = int(args.get("chunk_index") or 0)
    except (TypeError, ValueError):
        raise ToolError("chunk_index 는 숫자여야 합니다")
    got = store.peek_vector(doc, idx)
    if not got:
        raise ToolError("적재되지 않은 청크입니다 — %s#%d" % (doc, idx))
    return ("③ 벡터 들여다보기 — %s#%d\n"
            "  %d차원 가운데 앞 %d개\n  %s\n\n"
            "  문장이 이런 숫자 묶음이 되어 저장되고, 검색은 이 숫자들 사이의"
            " 코사인 거리를 잽니다."
            % (doc, idx, got["dim"], len(got["head"]),
               "  ".join("%+.4f" % x for x in got["head"])))


def reset_store(args):
    if not _bool(args, "confirm"):
        st = store.status()
        raise ToolError("되돌릴 수 없는 작업입니다. 지금 %s건이 들어 있습니다.\n"
                        "정말 비우려면 confirm=true 로 다시 부르세요." % _n(st["total"]))
    before = store.status()["total"]
    store.reset()
    bm25.invalidate()
    return ("③ 저장소를 비웠습니다 — %s건 삭제.\n"
            "  파일(data/)과 chroma_db/ 폴더 자체는 그대로입니다." % _n(before))


def clear_generated(args):
    n = store.clear_generated()
    bm25.invalidate()
    return ("③ 모델이 쓴 근거 %s건을 지웠습니다. 문서에서 온 조각은 그대로입니다.\n"
            "  지금 저장소: %s건" % (_n(n), _n(store.status()["total"])))


# ── ④ 검색 ─────────────────────────────────────────────────────────
def _hit_head(h, score_label):
    src = "생성" if h.get("source") == "generated" else "문서"
    page = h.get("page")
    return ("%2d위  %s %.4f   %s · %s쪽 · #%s · %s"
            % (h["rank"], score_label, h.get("score") or 0.0,
               h.get("document"), page if page else "—", h.get("chunk_index"), src))


def _render_semantic(col, k):
    out = ["── 왼쪽: 의미 검색 (임베딩) — %.2f초, 조각 %d개 ──"
           % (col["latency"], len(col["hits"]))]
    if not col["hits"]:
        out.append("  꺼낸 조각이 없습니다. 저장소가 비어 있는지 store_status 로 보세요.")
        return out
    for h in col["hits"]:
        out.append("")
        out.append("  " + _hit_head(h, "유사도"))
        out.append("     거리 %.4f (= 1 − 유사도, hnsw:space=cosine)" % (h.get("distance") or 0))
        out.append("     %s" % _snip(h.get("text")))
        why = h.get("why") or {}
        if why.get("line"):
            out.append("     근거: %s" % why["line"])
            best = [s for s in (h.get("segments") or []) if s.get("level") == "top"]
            if best:
                out.append("       가장 가까운 문장 → %s" % _snip(best[0]["text"], 160))
        if h.get("source") == "generated":
            out.append("       ※ 이것은 모델이 쓴 답변입니다 — 질문 %r / 근거 %s"
                       % (_snip(h.get("question"), 40), _snip(h.get("based_on"), 60)))
    hl = col.get("highlight")
    if hl:
        out.append("")
        out.append("  근거 하이라이트: 문장 %s개를 질문과 같은 모델로 다시 재었습니다"
                   " (%.2f초). 생성 모델은 쓰지 않습니다 — 거리 계산 결과입니다."
                   % (_n(hl["segments"]), hl["latency"]))
    return out


def _render_bm25(col, k):
    st = col["stats"]
    out = ["── 오른쪽: BM25 (낱말) — %.3f초, 외부 호출 없음 ──" % col["latency"],
           "  질문에서 뽑은 낱말 %d개: %s"
           % (len(st["query_terms"]), " ".join(st["query_terms"][:14])
              + (" …" if len(st["query_terms"]) > 14 else "")),
           "  말뭉치 %s개 중 한 낱말이라도 걸린 조각 %s개 (평균 길이 %s)"
           % (_n(st["corpus"]), _n(st["matched"]), st["avgdl"])]
    if not col["hits"]:
        out.append("")
        out.append("  0건입니다. 질문의 낱말이 문서에 한 번도 나오지 않았습니다.")
        out.append("  한국어 질문으로 영문 문서를 찾으면 흔히 이렇게 됩니다 — 버그가 아니라"
                   " 낱말 검색의 성질입니다. 왼쪽(의미 검색)은 같은 질문으로 찾아냅니다.")
        out.append("  rewrite=true 를 켜면 질의를 문서의 말로 바꿔 다시 찾습니다.")
        return out
    for h in col["hits"]:
        out.append("")
        out.append("  " + _hit_head(h, "점수  "))
        out.append("     %s" % _snip(h.get("text")))
        why = h.get("why") or {}
        terms = why.get("terms") or []
        if terms:
            out.append("     보탠 낱말: %s"
                       % " · ".join("%s(%d회 %.3f)" % (t["term"], t["tf"], t["score"])
                                    for t in terms[:5]))
    out.append("")
    out.append("  ※ BM25 점수는 0~1 이 아닙니다. 상한이 없고 같은 질문 안에서만 뜻이"
               " 있으므로 왼쪽의 유사도와 숫자를 직접 견주면 안 됩니다.")
    return out


def _render_rerank(col, label):
    rr = col.get("rerank")
    if not rr:
        return []
    out = ["", "[재정렬 · %s] %s — 후보 %d개를 %d회 판정, %.2f초 (%s)"
           % (label, "적용" if rr["applied"] else "미적용", rr["pool"], rr["calls"],
              rr["latency"], rr["model"])]
    if rr["note"]:
        out.append("  %s" % rr["note"])
    if rr["sources"]:
        out.append("  줄 세운 값: %s"
                   % " · ".join("%s %d개" % (k, v) for k, v in rr["sources"].items()))
        out.append("  (logprob = 첫 토큰의 로그확률. 모델이 적어 낸 숫자는 0.9·0.95 에"
                   " 뭉쳐 줄 세울 수 없어 로그확률을 씁니다.)")
    for row in rr["rows"]:
        mark = "  " if row["kept"] else "밀림"
        moved = ("↑%d" % row["moved"] if row["moved"] > 0 else
                 "↓%d" % -row["moved"] if row["moved"] < 0 else "—")
        out.append("  %s %2d위 ← %2d위 %3s  %s %s  #%s %s"
                   % (mark, row["rank_after"], row["rank_before"], moved,
                      row["verdict"],
                      ("%.6f" % row["score"]) if row["score"] is not None else "   —    ",
                      row["chunk_index"], _snip(row["head"], 40)))
    return out


def _render_search(out_d):
    q = out_d["query"]
    lines = ["④ 검색 — %r" % q,
             "  K=%d · 생성분 %s · 재정렬 %s (후보 %d개까지 꺼냄)"
             % (out_d["k"], "포함" if out_d["include_generated"] else "제외",
                "켬" if out_d["rerank_on"] else "끔", out_d["pool"]),
             "  질문 벡터 %d차원, 앞 5개 %s"
             % (out_d["dim"], out_d["query_vector_head"][:5])]

    rw = out_d.get("rewrite")
    if rw:
        lines += ["", "[질의 재작성] %s — %.2f초"
                  % ("적용" if rw["applied"] else "미적용", rw["latency"]),
                  "  원래 질문   %s" % rw["original"],
                  "  실제 검색어 %s" % out_d["search_query"]]
        if rw.get("note"):
            lines.append("  %s" % rw["note"])
        if rw.get("rejected"):
            lines.append("  버린 질의: %s" % rw["rejected"])
        lines.append("  ※ 바뀐 질의는 검색에만 씁니다. 답변은 원래 질문으로 만듭니다.")

    hy = out_d.get("hyde")
    if hy:
        lines += ["", "[HyDE] %s — %.2f초" % ("적용" if hy["ok"] else "미적용", hy["latency"])]
        if hy.get("note"):
            lines.append("  %s" % hy["note"])
        if hy["ok"]:
            lines.append("  검색용 추측(내용의 참·거짓은 상관없습니다. 쓰는 것은 이 글의"
                         " 벡터입니다):")
            lines.append("    %s" % _snip(hy["text"], 400))
            lines.append("  이 글은 답변의 근거로 쓰지 않고 저장소에도 넣지 않습니다."
                         " 의미 검색에만 걸고 BM25 에는 걸지 않습니다.")

    sem, bm = out_d["results"]["semantic"], out_d["results"]["bm25"]
    lines.append("")
    lines += _render_semantic(sem, out_d["k"])
    lines.append("")
    lines += _render_bm25(bm, out_d["k"])
    lines += _render_rerank(sem, "의미 검색")
    lines += _render_rerank(bm, "BM25")

    if sem.get("answer") or bm.get("answer"):
        lines.append("")
        lines.append("[답변 생성] 같은 프롬프트 · 다른 근거로 두 번 만들었습니다"
                     " (%s). 꺼내 온 조각이 다르면 답도 달라집니다."
                     % config.GEN_MODEL)
        for col in (sem, bm):
            a = col.get("answer") or {}
            lines.append("")
            lines.append("  ── %s 근거로 만든 답 (%.2f초, 프롬프트 %s자) ──"
                         % (col["label"], a.get("latency") or 0,
                            _n(a.get("prompt_chars") or 0)))
            lines.append("  %s" % (a.get("text") or "(없음)"))

    saved = out_d.get("saved")
    if saved:
        lines.append("")
        lines.append("[근거로 저장] 만든 답변을 임베딩해 저장소에 넣었습니다.")
        for s in saved["saved"]:
            lines.append("  저장 — %s / %s자 / id=%s" % (s["label"], _n(s["n_chars"]), s["id"]))
        for s in saved["skipped"]:
            lines.append("  건너뜀 — %s: %s" % (s["engine"], s["why"]))
        lines.append("  다음 검색부터 이 글이 근거로 걸립니다. 되돌리려면 clear_generated().")
    return "\n".join(lines)


def search(args):
    q = (args.get("query") or "").strip()
    if not q:
        raise ToolError("query 가 필요합니다")
    if not store.status()["total"]:
        raise ToolError("저장소가 비어 있어 검색할 것이 없습니다.\n"
                        "parse_pdf → chunk → embed_and_store 를 먼저 하세요.")
    opts = {"rewrite": _bool(args, "rewrite"),
            "hyde": _bool(args, "hyde"),
            "rerank": _bool(args, "rerank"),
            "highlight": _bool(args, "highlight", True),
            "answer": _bool(args, "answer"),
            "save_answer": _bool(args, "save_answer"),
            "include_generated": _bool(args, "include_generated", True)}
    if opts["save_answer"] and not opts["answer"]:
        raise ToolError("save_answer 는 answer=true 일 때만 뜻이 있습니다."
                        " 저장할 답이 없습니다.")
    got = pipeline.search(q, args.get("k"), opts, log)
    return _render_search(got)


# ── 설정 보기 ──────────────────────────────────────────────────────
def show_config(args):
    st = store.status()
    return "\n".join([
        "rag-lab 설정 (lab/config.py)",
        "  임베딩   %s / %d차원 / %d개씩 묶어 호출"
        % (config.EMBED_MODEL, config.EMBED_DIM, config.EMBED_BATCH),
        "  생성     %s / 최대 %s토큰" % (config.GEN_MODEL, _n(config.GEN_MAX_TOKENS)),
        "  저장소   %s (컬렉션 %s)" % (config.STORE_DIR, config.COLLECTION),
        "  화면     http://%s:%d/  (python app.py 로 따로 띄웁니다)"
        % (config.HOST, config.PORT),
        "",
        "  청킹 전략  %s" % " · ".join("%s=%s" % (k, v)
                                        for k, v in config.STRATEGIES.items()),
        "  청크 길이  기본 %s자 (범위 %s~%s)"
        % (_n(config.CHUNK_SIZE_DEFAULT), _n(config.CHUNK_SIZE_MIN),
           _n(config.CHUNK_SIZE_MAX)),
        "  의미 경계  상위 %d%% (범위 %d~%d%%) — 절댓값이 아니라 백분위로 자릅니다"
        % (config.SEMANTIC_PCT_DEFAULT, config.SEMANTIC_PCT_MIN, config.SEMANTIC_PCT_MAX),
        "  문장 길이  %d ~ %d자" % (config.SENT_MIN_CHARS, config.SENT_MAX_CHARS),
        "  검색 K     기본 %d (최대 %d)" % (config.TOP_K_DEFAULT, config.TOP_K_MAX),
        "  BM25       k1=%s · b=%s" % (config.BM25_K1, config.BM25_B),
        "  재정렬     후보 K×%d (최대 %d) · 토큰 후보 %d개 · 동시 %d개"
        % (config.RERANK_POOL_MULT, config.RERANK_POOL_MAX,
           config.RERANK_TOP_LOGPROBS, config.RERANK_WORKERS),
        "",
        "  지금 이 서버가 들고 있는 것 — 문서 %s / 조각 %s개 / 전략 %s"
        % (STATE["name"] or "없음", _n(len(STATE["chunks"])),
           STATE["strategy"] or "없음"),
        "  저장소에 적재된 것 — %s건 (이것만 디스크에 남습니다)" % _n(st["total"]),
        "",
        "  주의: 화면(app.py)과 이 MCP 서버는 서로 다른 프로세스입니다. 파싱·청킹 결과는"
        " 공유되지 않고, 함께 보는 것은 chroma_db/ 저장소뿐입니다.",
        "  EMBED_MODEL 이나 EMBED_DIM 을 바꾸면 기존 저장소와 섞이므로 먼저"
        " reset_store 하세요.",
    ])


# ── 도구 목록 ──────────────────────────────────────────────────────
# 이름·설명·입력 스키마·함수를 한 줄에 묶어 둔다. `lab/mcp_proto.py` 는 이 목록만 본다.
# 새 도구는 **여기 한 곳만** 고치면 tools/list 에 나온다.
TOOLS = [
    {"name": "list_pdfs", "title": "① PDF 목록",
     "description": "data/ 폴더의 PDF 파일과 이미 적재된 문서를 보여 준다. 시작점.",
     "schema": {"type": "object", "properties": {}},
     "fn": list_pdfs},

    {"name": "parse_pdf", "title": "① 파싱",
     "description": ("PDF 에서 글자를 뽑는다(pypdf). 쪽수·글자수와 함께 '글자가 거의 없는"
                     " 페이지'를 짚어 준다 — 그 자리에 그림·표가 있었다는 뜻이다."
                     " 표의 행·열은 복원하지 않는다."),
     "schema": {"type": "object",
                "properties": {"path": {"type": "string",
                                        "description": "data/ 안의 파일명 또는 전체 경로"}},
                "required": ["path"]},
     "fn": parse_pdf},

    {"name": "read_page", "title": "① 페이지 원문",
     "description": "파싱한 문서의 한 페이지 원문을 본다. 추출이 제대로 됐는지 눈으로 확인할 때.",
     "schema": {"type": "object",
                "properties": {"page": {"type": "integer", "minimum": 1,
                                        "description": "페이지 번호 (1부터)"}},
                "required": ["page"]},
     "fn": read_page},

    {"name": "chunk", "title": "② 청킹",
     "description": ("파싱한 글을 조각으로 자른다. 전략 네 가지 — fixed(고정 길이) ·"
                     " structure(구조 경계) · paragraph(문단) · semantic(의미 경계)."
                     " semantic 만 임베딩을 부르고 size 대신 percentile 로 자른다."
                     " 오버랩은 의도적으로 없다."),
     "schema": {"type": "object",
                "properties": {
                    "strategy": {"type": "string",
                                 "enum": list(config.STRATEGIES.keys()),
                                 "description": "청킹 전략"},
                    "size": {"type": "integer",
                             "minimum": config.CHUNK_SIZE_MIN,
                             "maximum": config.CHUNK_SIZE_MAX,
                             "description": "조각 길이 기준(자). semantic 은 쓰지 않는다"},
                    "percentile": {"type": "integer",
                                   "minimum": config.SEMANTIC_PCT_MIN,
                                   "maximum": config.SEMANTIC_PCT_MAX,
                                   "description": ("semantic 전용 — 이웃 문장 거리가 상위"
                                                   " 몇 퍼센트인 자리에서 자를지")}},
                "required": ["strategy"]},
     "fn": chunk},

    {"name": "show_chunks", "title": "② 청크 원문",
     "description": "지금 잘라 둔 조각의 전문을 본다. 검색 결과의 본문은 잘려 오므로 여기서 마저 본다.",
     "schema": {"type": "object",
                "properties": {
                    "start": {"type": "integer", "minimum": 0, "description": "시작 번호"},
                    "count": {"type": "integer", "minimum": 1,
                              "maximum": config.MCP_MAX_CHUNKS,
                              "description": "몇 개를 볼지"}}},
     "fn": show_chunks},

    {"name": "embed_and_store", "title": "③ 임베딩·적재",
     "description": ("잘라 둔 조각을 임베딩해 Chroma 에 넣는다. 디스크로 넘어가는 것은"
                     " 이 단계의 결과뿐이다. 같은 문서를 다른 전략으로 다시 적재하면"
                     " ID 가 겹쳐 덮어쓴다."),
     "schema": {"type": "object", "properties": {}},
     "fn": embed_and_store},

    {"name": "store_status", "title": "③ 저장소 현황",
     "description": "적재된 문서·조각 수와 전략, 그중 모델이 쓴 답변이 몇 건인지.",
     "schema": {"type": "object", "properties": {}},
     "fn": store_status},

    {"name": "peek_vector", "title": "③ 벡터 들여다보기",
     "description": "적재된 청크 하나의 벡터 앞부분. 문장이 실제로 숫자가 된 모습을 본다.",
     "schema": {"type": "object",
                "properties": {
                    "document": {"type": "string", "description": "문서 이름"},
                    "chunk_index": {"type": "integer", "minimum": 0,
                                    "description": "청크 번호"}},
                "required": ["document", "chunk_index"]},
     "fn": peek_vector},

    {"name": "search", "title": "④ 검색",
     "description": ("같은 질문을 의미 검색(임베딩)과 BM25(낱말) 두 가지로 돌려 나란히"
                     " 보여 준다. 둘을 섞거나 한쪽을 고르지 않는다 — 차이를 보는 것이"
                     " 목적이다. 스위치는 모두 기본 꺼짐(highlight 만 켬)이며 켤 때마다"
                     " OpenAI 호출이 늘어난다."),
     "schema": {"type": "object",
                "properties": {
                    "query": {"type": "string", "description": "질문"},
                    "k": {"type": "integer", "minimum": 1,
                          "maximum": config.TOP_K_MAX,
                          "description": "열마다 몇 개를 꺼낼지 (기본 %d)"
                                         % config.TOP_K_DEFAULT},
                    "rewrite": {"type": "boolean",
                                "description": ("질의 재작성 — 문서에 쓰인 말로 검색어를"
                                                " 바꾼다. 답변은 원래 질문으로 만든다."
                                                " 생성 호출 1회")},
                    "hyde": {"type": "boolean",
                             "description": ("HyDE — 가상 답변을 쓰고 그 글을 임베딩해"
                                             " 찾는다. 의미 검색에만 적용. 생성 호출 1회")},
                    "rerank": {"type": "boolean",
                               "description": ("LLM 재정렬 — 후보를 넉넉히 꺼내 조각마다"
                                               " Y/N 을 묻고 첫 토큰의 로그확률로 줄 세운다."
                                               " 조각 하나가 곧 호출 하나(두 열이면 2배)")},
                    "highlight": {"type": "boolean",
                                  "description": ("근거 하이라이트 — 뽑힌 조각을 문장으로"
                                                  " 쪼개 질문과의 거리를 다시 잰다."
                                                  " 임베딩만 쓴다. 기본 켬")},
                    "answer": {"type": "boolean",
                               "description": ("답변 생성 — 두 열의 근거로 각각 한 번씩,"
                                               " 모두 2회 생성한다")},
                    "save_answer": {"type": "boolean",
                                    "description": ("만든 답변을 근거로 저장소에 넣는다."
                                                    " answer=true 일 때만. 저장소가 모델의"
                                                    " 말로 물들 수 있다")},
                    "include_generated": {"type": "boolean",
                                          "description": "저장된 생성분을 검색에 포함할지 (기본 포함)"}},
                "required": ["query"]},
     "fn": search},

    {"name": "clear_generated", "title": "③ 생성분만 지우기",
     "description": "모델이 쓴 답변만 저장소에서 지운다. 문서에서 온 조각은 그대로 둔다.",
     "schema": {"type": "object", "properties": {}},
     "fn": clear_generated},

    {"name": "reset_store", "title": "③ 저장소 비우기",
     "description": ("적재한 것을 전부 지운다. 되돌릴 수 없으므로 confirm=true 가 있어야"
                     " 실행한다. 청킹 전략을 바꿔 견줄 때 쓴다."),
     "schema": {"type": "object",
                "properties": {"confirm": {"type": "boolean",
                                           "description": "true 여야 실제로 지운다"}},
                "required": ["confirm"]},
     "fn": reset_store},

    {"name": "show_config", "title": "설정 보기",
     "description": "모델·차원·청킹 기본값·한계값과 지금 이 서버가 들고 있는 상태.",
     "schema": {"type": "object", "properties": {}},
     "fn": show_config},
]
