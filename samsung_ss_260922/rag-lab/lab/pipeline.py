# -*- coding: utf-8 -*-
"""검색 한 번이 지나는 길.

  질의 재작성 → HyDE → 두 열 검색(의미 · BM25) → 재정렬 → 근거 하이라이트
  → 답변 생성 → 생성분 되먹임

화면(`lab/web.py`)과 MCP(`lab/mcp_tools.py`)가 이 길을 함께 쓴다. 두 벌로 나눠 두면
CLAUDE.md 가 적어 둔 규칙들 — **답변·판정에는 원래 질문을 쓴다**, **재정렬 뒤 hits 를
다시 묶는다**, **HyDE 는 의미 검색에만 건다** — 이 한쪽에서만 지켜지고 다른 쪽은
조용히 어긋난다. 규칙이 한 곳에 있어야 두 창구가 같은 것을 보여 준다.

부르는 쪽마다 다른 것은 **진행 상황을 어디에 적느냐**뿐이라 그것만 함수로 받는다(`log`).
화면은 콘솔에 print 하고, MCP 는 stderr 로 보낸다 — MCP 의 stdout 은 프로토콜 전용이라
한 줄이라도 다른 글이 섞이면 연결이 끊긴다(`lab/mcp_proto.py`).
"""

import time

from . import answer as answer_mod
from . import bm25, config, evidence, hyde as hyde_mod, llm
from . import rerank as rerank_mod
from . import rewrite as rewrite_mod
from . import store


def clamp_k(k):
    """K 를 1 ~ TOP_K_MAX 로 가둔다."""
    try:
        k = int(k or config.TOP_K_DEFAULT)
    except (TypeError, ValueError):
        k = config.TOP_K_DEFAULT
    return max(1, min(k, config.TOP_K_MAX))


def search(q, k=None, opts=None, log=None):
    """같은 질문을 두 방식으로 검색한다 — 벡터(의미)와 낱말(BM25).

    나란히 돌려주는 것이 요점이다. 어느 한쪽을 고르거나 둘을 섞지 않는다
    (섞으면 무엇이 무엇을 찾았는지 화면에서 사라진다).

    `opts` 의 스위치는 전부 기본 꺼짐이고 `highlight` 만 기본 켜짐이다 —
    rewrite · hyde · rerank · answer · save_answer · include_generated · highlight.
    """
    opts = opts or {}
    log = log or (lambda _msg: None)
    q = (q or "").strip()
    if not q:
        raise ValueError("질문이 비어 있습니다")
    k = clamp_k(k)

    # ── 질의 재작성(선택) — 검색에 쓸 문장만 바꾼다. 답변은 원래 질문으로 만든다 ──
    # 실패하든 규칙을 어겼든 검색은 계속된다. 그때 쓰는 것은 q 그대로다.
    rw = None
    search_q = q
    if opts.get("rewrite"):
        rw = rewrite_mod.rewrite(q, store.status().get("documents"))
        if rw["applied"]:
            search_q = rw["query"]
        log("질의 재작성 — %s / %.2f초%s"
            % ("적용" if rw["applied"] else "미적용", rw["latency"],
               (" (%s)" % rw["note"]) if rw["note"] else ""))
        if rw["applied"]:
            log("   %r → %r" % (q[:40], search_q[:60]))

    # ── HyDE(선택) — 가상 답변을 먼저 쓰고 그 글을 임베딩한다 ──
    # 초안은 질문 원문에서 만든다. 답을 흉내 내는 글이므로 사용자가 물은 문장이
    # 들어가야 한다(재작성한 검색어가 아니라).
    hy = None
    embed_text = search_q
    if opts.get("hyde"):
        hy = hyde_mod.draft(q)
        if hy["ok"]:
            embed_text = hy["text"]
        log("HyDE — %s / %.2f초%s"
            % ("적용" if hy["ok"] else "미적용", hy["latency"],
               (" (%s)" % hy["note"]) if hy["note"] else ""))

    include_gen = bool(opts.get("include_generated", True))

    # ── LLM 재정렬(선택) — 켜면 검색이 K 개가 아니라 후보를 넉넉히 꺼내 온다 ──
    # K 개만 꺼내 다시 줄 세우면 순서만 바뀐다. 원래 순위로는 화면에 못 오던
    # 조각을 끌어올리는 것이 재정렬의 값어치이므로 뽑는 그물을 먼저 넓힌다.
    want_rr = bool(opts.get("rerank"))
    pool = k
    if want_rr:
        pool = max(k, min(k * config.RERANK_POOL_MULT, config.RERANK_POOL_MAX))

    # ── 의미 검색 — 임베딩해 가까운 순으로 ──
    t0 = time.time()
    vec = llm.embed_one(embed_text)
    hits = store.query(vec, pool, include_gen)
    sem = {"label": "의미 검색", "hits": hits,
           "latency": round(time.time() - t0, 2)}

    # ── BM25 — 같은 저장소를 낱말로 훑는다. 외부 호출 없음 ──
    # HyDE 는 여기에 쓰지 않는다. 가상 답변의 낱말로 찾으면 질문에 없던 말로
    # 검색하는 셈이라 두 열을 나란히 놓고 비교하는 뜻이 사라진다.
    t0 = time.time()
    bhits, stats = bm25.search(store.all_chunks, search_q, pool, include_gen)
    # 소수 3자리로 잰다. 임베딩 쪽과의 속도 차이가 이 화면에서 볼거리인데
    # 2자리로 자르면 "0초" 로 보여 아무것도 말해 주지 않는다.
    bm = {"label": "BM25", "hits": bhits, "stats": stats,
          "latency": round(time.time() - t0, 3)}

    log("검색 — %r → 의미 1위 %s / BM25 1위 %s (낱말 %d개, 걸린 조각 %d개)"
        % (search_q[:40], hits[0]["chunk_index"] if hits else "없음",
           bhits[0]["chunk_index"] if bhits else "없음",
           len(stats["query_terms"]), stats["matched"]))

    # ── 재정렬 — 두 열을 **각각 따로** 다시 줄 세운다 ──
    # 판정에 넘기는 것은 **원래 질문(q)** 이다. 조각은 바꾼 질의로 찾았더라도
    # 쓸모가 있는지는 사용자가 물은 것에 견줘 따져야 한다.
    #
    # hits · bhits 를 다시 묶어 두는 것이 중요하다 — 뒤의 근거 하이라이트와
    # 답변 생성이 이 이름을 쓰므로, 밀려난 후보가 그대로 남으면 화면에 없는
    # 조각을 임베딩하고 근거로 넘기게 된다.
    if want_rr:
        for col, label in ((sem, "의미"), (bm, "BM25")):
            got = rerank_mod.rerank(q, col["hits"], k)
            col["hits"] = got.pop("hits")
            col["rerank"] = got
            log("   재정렬(%s) — 후보 %d개 / 판정 %d회 %.2f초 / %s%s"
                % (label, got["pool"], got["calls"], got["latency"],
                   "적용" if got["applied"] else "미적용",
                   (" (%s)" % got["note"]) if got["note"] else ""))
            for row in got["rows"][:k]:
                log("      %2d위 ← %2d위  %s %s  #%s"
                    % (row["rank_after"], row["rank_before"], row["verdict"],
                       ("%.4f" % row["score"]) if row["score"] is not None else "  —   ",
                       row["chunk_index"]))
        hits, bhits = sem["hits"], bm["hits"]

    out = {"query": q, "search_query": search_q, "rewrite": rw, "hyde": hy,
           "embed_text": embed_text, "include_generated": include_gen, "k": k,
           "rerank_on": want_rr, "pool": pool,
           "query_vector_head": [round(float(x), 4) for x in vec[:10]],
           "dim": len(vec),
           "results": {"semantic": sem, "bm25": bm}}

    # 근거 하이라이트는 의미 검색 쪽에만 건다. BM25 는 제 말(맞은 낱말)로
    # 이미 설명되므로 여기에 임베딩을 또 부를 이유가 없다.
    if opts.get("highlight", True):
        t0 = time.time()
        got = evidence.explain(vec, hits)
        sem["highlight"] = {**got, "latency": round(time.time() - t0, 2)}
        log("   근거 하이라이트 — 문장 %d개 재계산 / %.2f초"
            % (got["segments"], sem["highlight"]["latency"]))

    # 답변 생성은 선택이다. 켜면 **양쪽에 따로** 만든다 — 꺼내 온 조각이 다르면
    # 답도 달라진다는 것이 이 화면에서 보여 주려는 것이다. 생성 호출은 2회다.
    #
    # 여기에 넘기는 것은 **원래 질문(q)** 이다. 조각은 바꾼 질의로 찾았더라도
    # 답은 사용자가 물은 것에 해야 한다. search_q 를 넘기지 말 것.
    if opts.get("answer"):
        for key in ("semantic", "bm25"):
            r = out["results"][key]
            t0 = time.time()
            got = answer_mod.answer(q, r["hits"])
            r["answer"] = {**got, "latency": round(time.time() - t0, 2),
                           "model": config.GEN_MODEL}
            log("   답변 생성(%s) — %d자 프롬프트 / %.2f초"
                % (key, got["prompt_chars"], r["answer"]["latency"]))

        # 만든 답변을 근거로 저장(선택). 저장은 답변이 있을 때만 뜻이 있다.
        if opts.get("save_answer"):
            out["saved"] = save_answers(q, out["results"], log)
    return out


def save_answers(question, results, log=None):
    """만든 답변을 임베딩해 저장소에 근거로 넣는다. → {saved, skipped, status}

    **아무 답이나 넣지 않는다.** 근거가 없어 못 만든 답, 너무 짧은 답, "문서에서
    확인되지 않습니다" 라고 한 답은 건너뛴다. 그런 문장이 근거로 쌓이면 다음
    검색에서 "확인되지 않습니다" 가 근거로 붙어 나오고, 그 위에 또 답이 쌓인다.

    두 열의 답이 글자까지 같으면 한 번만 넣는다.
    """
    log = log or (lambda _msg: None)
    saved, skipped, seen = [], [], {}
    for key in ("semantic", "bm25"):
        r = results[key]
        a = r.get("answer") or {}
        text = (a.get("text") or "").strip()
        why = None
        if not r["hits"]:
            why = "꺼낸 조각이 없어 만든 답이 아닙니다"
        elif len(text) < config.GENERATED_MIN_CHARS:
            why = "답이 너무 짧습니다(%d자)" % len(text)
        elif "확인되지 않습니다" in text:
            why = "문서에서 확인되지 않았다는 답입니다"
        elif text in seen:
            why = "%s 쪽 답과 글자까지 같아 한 번만 저장했습니다" % seen[text]
        if why:
            skipped.append({"engine": key, "why": why})
            continue

        based = ", ".join("%s#%s" % (h.get("document"), h.get("chunk_index"))
                          for h in r["hits"])
        rid = store.add_generated(text, llm.embed_one(text), question, key, based)
        seen[text] = r["label"]
        saved.append({"engine": key, "label": r["label"], "id": rid,
                      "n_chars": len(text), "based_on": based, "text": text})
        log("   근거로 저장(%s) — %d자 / %s" % (key, len(text), rid))

    if saved:
        bm25.invalidate()                      # 말뭉치가 늘었다
    for x in skipped:
        log("   저장 건너뜀(%s) — %s" % (x["engine"], x["why"]))
    return {"saved": saved, "skipped": skipped, "status": store.status()}
