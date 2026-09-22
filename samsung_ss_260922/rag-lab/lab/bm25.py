# -*- coding: utf-8 -*-
"""BM25 — 낱말이 겹치는 정도로 찾는다.

의미 검색 옆에 나란히 놓고 보기 위한 것이다. 둘은 서로 다른 것을 센다.

  의미 검색   질문과 조각을 벡터로 바꿔 '가까운가'를 잰다. 낱말이 하나도 안 겹쳐도 찾고,
              언어가 달라도 찾는다. 대신 왜 가까운지는 숫자만 봐서는 알 수 없다.
  BM25       질문에 든 낱말이 조각에 몇 번 나오는지를 센다. 어느 낱말이 얼마나 보탰는지
              그대로 보이지만, 낱말이 안 겹치면 아무것도 못 찾는다.

외부 호출이 없다. 표준 라이브러리만 쓰고 점수는 이 자리에서 계산한다.

  점수(D,Q) = Σ IDF(q) · tf(q,D)·(k1+1) / (tf(q,D) + k1·(1 - b + b·|D|/avgdl))
  IDF(q)    = ln(1 + (N - n(q) + 0.5) / (n(q) + 0.5))

  tf    조각 안에서 그 낱말이 나온 횟수. 많을수록 오르되 k1 이 상한을 준다
        (10번 나온 조각이 1번 나온 조각보다 10배 좋지는 않다).
  IDF   그 낱말이 몇 개의 조각에 나오는가. 모든 조각에 있는 낱말은 0 에 가까워져
        "the" 같은 흔한 말이 순위를 흔들지 못한다.
  b     긴 조각이 단지 길다는 이유로 유리해지지 않도록 길이로 나눈다.

**코사인 유사도와 달리 0~1 이 아니다.** 같은 질문 안에서 순위를 매기는 값이라
의미 검색의 유사도와 숫자를 직접 견주면 안 된다.
"""

import math
import re

from . import chunking, config

# 색인은 저장소에서 만든다. 적재·초기화로 저장소가 바뀌면 invalidate() 로 버린다.
_CACHE = {"index": None}

_WORD = re.compile(r"[a-z0-9]+")
_HANGUL = re.compile(r"[가-힣]+")


def tokens(text):
    """글 → 낱말 목록.

    한국어는 조사가 붙어 다녀("소프트에러는") 띄어쓰기만으로 자르면 질문의 "소프트에러"와
    맞지 않는다. 형태소 분석기를 넣는 대신 한글은 두 글자씩 겹쳐 쪼갠다
    (소프트에러 → 소프, 프트, 트에, 에러). 검색 엔진이 CJK 에 흔히 쓰는 방법이고
    사전도 의존성도 필요 없다. 영문·숫자는 그대로 낱말 하나로 센다.
    """
    low = text.lower()
    out = _WORD.findall(low)
    for run in _HANGUL.findall(low):
        if len(run) == 1:
            out.append(run)
        else:
            out += [run[i:i + 2] for i in range(len(run) - 1)]
    return out


def build(chunks):
    """조각 목록 → 색인 {docs, idf, avgdl, n}."""
    docs, df = [], {}
    for c in chunks:
        toks = tokens(c.get("text") or "")
        tf = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        for t in tf:
            df[t] = df.get(t, 0) + 1
        docs.append({"chunk": c, "tf": tf, "len": len(toks)})
    n = len(docs)
    avgdl = (sum(d["len"] for d in docs) / n) if n else 0.0
    idf = {t: math.log(1 + (n - k + 0.5) / (k + 0.5)) for t, k in df.items()}
    return {"docs": docs, "idf": idf, "avgdl": avgdl, "n": n}


def index(load):
    """색인을 한 번 만들어 두고 다시 쓴다. load 는 저장소를 읽는 함수다."""
    if _CACHE["index"] is None:
        _CACHE["index"] = build(load())
    return _CACHE["index"]


def invalidate():
    """저장소가 바뀌었다. 다음 검색에서 색인을 새로 만든다."""
    _CACHE["index"] = None


def _mark_terms(text, terms):
    """본문에서 질문 낱말이 나온 자리. 겹치는 구간은 하나로 합친다.

    → [(시작, 끝, 가장 크게 기여한 낱말인가)]

    한글 바이그램은 서로 한 글자씩 겹치므로, 합치고 나면 "소프트 에러"처럼 낱말
    덩어리 전체가 하나로 칠해진다. 영문은 낱말 경계를 요구해 "fit" 이 "fitting"
    안에서 걸리지 않게 한다 — 점수를 준 그 낱말만 칠해야 화면이 점수와 같은
    이야기를 한다.

    기여가 가장 큰 낱말만 진하게 칠한다. "is" 처럼 IDF 가 낮아 점수를 거의 못 준
    낱말까지 똑같이 칠하면, 정작 이 조각을 끌어올린 낱말이 묻힌다.
    """
    best = terms[0]["term"] if terms else None
    spans = []
    low = text.lower()
    for p in terms:
        t = p["term"]
        top = t == best
        if _WORD.fullmatch(t):
            pat = re.compile(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])")
            spans += [(m.start(), m.end(), top) for m in pat.finditer(low)]
        else:
            at = low.find(t)
            while at >= 0:
                spans.append((at, at + len(t), top))
                at = low.find(t, at + 1)       # 겹치는 것도 잡는다(바이그램)
    spans.sort()
    merged = []
    for a, b, top in spans:
        if merged and a <= merged[-1][1]:
            pa, pb, ptop = merged[-1]
            merged[-1] = (pa, max(pb, b), ptop or top)
        else:
            merged.append((a, b, top))
    return merged


def _why(parts, n_query_terms, total):
    """왜 이 조각인가 — BM25 의 말로 한 줄. 생성 모델이 아니라 계산 결과다."""
    top = ", ".join("%s(%d회)" % (p["term"], p["tf"]) for p in parts[:3])
    return ("질문의 낱말 %d개 가운데 %d개가 이 조각에 있습니다 — %s. 점수 %.4f 는 낱말마다의"
            " 기여(흔하지 않을수록·자주 나올수록 큼)를 더한 값입니다."
            % (n_query_terms, len(parts), top, total))


def search(load, query, k, include_generated=True):
    """→ 점수 순 상위 k개. 어느 낱말이 얼마나 보탰는지와 칠할 자리를 함께 돌려준다.

    생성된 근거를 뺄 때는 색인을 다시 만들지 않고 점수를 매기는 자리에서 건너뛴다.
    스위치를 켜고 끌 때마다 말뭉치 전체를 다시 훑으면 색인을 두는 뜻이 없다.
    IDF·평균 길이는 저장소 전체로 계산한 값이 그대로 쓰인다 — 생성분은 문서에 견줘
    아주 적어 순위를 흔들지 않지만, 정확히는 근사라는 점을 적어 둔다.
    """
    idx = index(load)
    qt = list(dict.fromkeys(tokens(query)))        # 중복은 빼되 순서는 지킨다
    if not idx["n"] or not qt:
        return [], {"query_terms": qt, "corpus": idx["n"], "matched": 0,
                    "avgdl": round(idx["avgdl"], 1)}

    k1, b, avgdl = config.BM25_K1, config.BM25_B, idx["avgdl"]
    scored = []
    for d in idx["docs"]:
        if not include_generated and d["chunk"].get("source") == "generated":
            continue
        tf, dl = d["tf"], d["len"]
        total, parts = 0.0, []
        for t in qt:
            f = tf.get(t, 0)
            if not f:
                continue
            w = idx["idf"].get(t, 0.0)
            s = w * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl if avgdl else 1.0)))
            total += s
            parts.append({"term": t, "tf": f, "idf": round(w, 4), "score": round(s, 4)})
        if total > 0:
            scored.append((total, d["chunk"], parts))

    scored.sort(key=lambda x: -x[0])
    out = []
    for rank, (total, chunk, parts) in enumerate(scored[:k], 1):
        parts.sort(key=lambda p: -p["score"])
        text = chunk.get("text") or ""
        segs = [{"start": chunking.u16(text, a), "end": chunking.u16(text, b),
                 "text": text[a:b], "level": "top" if top else "term"}
                for a, b, top in _mark_terms(text, parts)]
        out.append({"rank": rank, "score": round(total, 4), **chunk,
                    "segments": segs,
                    "why": {"terms": parts[:6], "n_terms": len(parts),
                            "n_query_terms": len(qt),
                            "line": _why(parts, len(qt), total)}})
    return out, {"query_terms": qt, "corpus": idx["n"], "matched": len(scored),
                 "avgdl": round(avgdl, 1)}
