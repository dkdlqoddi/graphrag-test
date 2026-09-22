# -*- coding: utf-8 -*-
"""검색된 조각이 왜 뽑혔는지를 임베딩만으로 밝힌다.

생성 모델을 부르지 않는다. 쓰는 것은 검색에 쓴 것과 같은 임베딩 모델 하나뿐이고,
방법도 검색과 똑같다. 대상만 작아진다.

  ① 뽑힌 청크를 문장 단위로 다시 쪼갠다 (chunking.split_sentences)
  ② 그 문장들을 질문과 같은 모델 · 같은 차원으로 임베딩한다
  ③ 질문 벡터와의 코사인 거리를 잰다
  ④ 가까운 문장을 청크 안에서 표시한다

그래서 화면의 하이라이트는 모델이 "여기가 근거다"라고 말한 결과가 아니라
검색이 청크 단위로 한 계산을 문장 단위로 한 번 더 한 결과다. 검색 순위와
같은 기준으로 설명되는 것이 이 방식의 목적이다.

기준선은 **질문 ↔ 청크 거리**다. 청크 벡터는 그 안의 문장들이 뭉뚱그려진 것이므로,
청크 전체보다 질문에 가까운 문장이 있다면 그 문장이 이 청크를 끌어올린 쪽이다.
어느 문장도 기준선을 넘지 못하면 특정 문장이 아니라 조각 전체가 맞은 경우이고,
그것도 화면에 그대로 적는다(없는 근거를 만들어 내지 않는다).

문장의 오프셋(청크 텍스트 안에서의 시작 위치)을 끝까지 들고 다녀야 화면에서 원문의
그 자리에 표시할 수 있다 — 청킹이 페이지 오프셋을 들고 다니는 것과 같은 이유다.
"""

from . import config, llm
from .chunking import split_sentences, u16

def _line(segs, best, base):
    """왜 뽑혔는지를 한 줄로 적는다. 생성 모델이 아니라 계산 결과를 옮기는 것이다."""
    order = segs.index(best) + 1
    if best["score"] >= base:
        return ("문장 %d개로 다시 재 보니 %d번째 문장이 질문에 가장 가까웠습니다"
                " — 거리 %.4f (유사도 %.4f). 청크 전체 거리 %.4f 보다 %.4f 가깝습니다."
                % (len(segs), order, best["distance"], best["score"],
                   1.0 - base, (1.0 - base) - best["distance"]))
    return ("문장 %d개로 다시 재 봤지만 청크 전체(거리 %.4f)보다 가까운 문장은 없었습니다."
            " 특정 문장이 아니라 조각 전체가 질문과 맞은 경우입니다."
            " 그중 가장 가까운 것은 %d번째 문장(거리 %.4f)입니다."
            % (len(segs), 1.0 - base, order, best["distance"]))


def _mark(hit, segs):
    """문장마다 표시 등급을 매기고 요약을 붙인다.

      top   질문과 가장 가까운 문장 하나. 기준선을 못 넘어도 표시한다.
      high  청크 전체보다 질문에 가까운 문장. 이 청크를 끌어올린 쪽이다.
    """
    base = float(hit.get("score") or 0.0)      # 질문 ↔ 청크 유사도 = 기준선
    best = max(segs, key=lambda s: s["score"])
    for s in segs:
        s["level"] = "top" if s is best else ("high" if s["score"] >= base else "")
    for rank, s in enumerate(sorted(segs, key=lambda s: -s["score"]), 1):
        s["rank"] = rank

    hit["segments"] = segs
    hit["why"] = {
        "base_score": round(base, 4),
        "base_distance": round(1.0 - base, 4),
        "best_score": best["score"],
        "best_distance": best["distance"],
        "gain": round((1.0 - base) - best["distance"], 4),   # 기준선보다 얼마나 가까운가
        "n_segments": len(segs),
        "n_marked": sum(1 for s in segs if s["level"]),
        "line": _line(segs, best, base),
    }


def explain(query_vector, hits):
    """검색 결과에 '왜 뽑혔는지'를 붙인다. hits 를 그 자리에서 고친다.

    임베딩 호출은 문장 전체를 모아 한 번에 보낸다(llm.embed_many 가 100개씩 나눈다).
    → {segments, model, dim}
    """
    info = {"segments": 0, "model": config.EMBED_MODEL, "dim": config.EMBED_DIM}
    if not hits:
        return info

    jobs = []                                   # (hit 순번, 시작, 끝)
    for i, h in enumerate(hits):
        for a, b in split_sentences(h.get("text") or ""):
            jobs.append((i, a, b))
    if not jobs:
        return info

    vectors = llm.embed_many([hits[i]["text"][a:b] for i, a, b in jobs])

    by_hit = {}
    for (i, a, b), vec in zip(jobs, vectors):
        sim = llm.cosine(query_vector, vec)
        text = hits[i]["text"]
        by_hit.setdefault(i, []).append({
            "start": u16(text, a),
            "end": u16(text, b),
            "text": text[a:b],
            "score": round(sim, 4),
            "distance": round(1.0 - sim, 4),
        })
    for i, segs in by_hit.items():
        _mark(hits[i], segs)

    info["segments"] = len(jobs)
    return info
