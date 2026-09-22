# -*- coding: utf-8 -*-
"""LLM 재정렬 (rerank) — 꺼낸 조각을 모델에게 한 장씩 보여 주고 다시 줄 세운다 (선택).

검색 뒤에 붙는 **선택 스위치**(`/api/search` 의 `rerank: true`, 기본 끔)다.

검색은 질문과 조각을 **따로** 잰다. 임베딩은 각자 벡터로 바꿔 거리를 재고, BM25 는
낱말이 겹치는지를 센다. 둘 다 질문과 조각을 나란히 놓고 읽어 본 적이 없다. 그래서
"낱말은 다 들어 있지만 묻는 것과는 상관없는 조각"이 위로 올라온다.

재정렬은 그 둘을 **한 프롬프트에 같이 넣어** 모델에게 직접 묻는다.

    검색(넉넉히 N개) → 조각마다 한 번씩 Y/N 판정 → 다시 줄 세워 상위 K개

조각 하나가 곧 호출 하나다. 그래서 검색 단계에서는 K 개가 아니라 **후보를 넉넉히**
꺼내 오고(`config.RERANK_POOL_MULT`·`RERANK_POOL_MAX`), 판정이 그중 K 개를 고른다.
K 개만 꺼내 다시 줄 세우면 순서만 뒤바뀔 뿐, **원래 순위로는 화면에 못 오던 조각을
끌어올리는** 재정렬의 값어치가 사라진다.

## 판정의 꼴 — `Y 0.92`

모델은 한 줄만 답한다. 첫 글자가 `Y`(쓸모 있음) 또는 `N`(쓸모 없음)이고, 한 칸 띄운
뒤에 **이 조각이 쓸모 있을 확률**이 온다. 형식을 이렇게 좁히는 이유는 두 가지다.

- **첫 토큰이 곧 판정이 되어야** 그 자리의 로그확률을 쓸 수 있다. 앞에 "네," 나
  "판정:" 이 붙으면 재려던 자리가 사라진다.
- 확률을 뒤에 붙여 두면 **모델이 말한 확률**과 **로그확률이 말한 확률**을 같은
  화면에서 견줄 수 있다. 둘은 자주 어긋나고, 그 어긋남이 이 화면의 볼거리다.

형식을 지켰는지는 **기계로 확인한다**(`_parse`). 프롬프트에 적어 두는 것만으로는
지킨다는 보장이 없다(`lab/rewrite.py` 와 같은 규칙이다). 첫 글자가 Y·N 이 아니거나
Y 인데 확률이 0.5 미만이면 그 사실을 화면에 적는다.

## 순서는 로그확률로 정한다

모델이 적어 낸 숫자는 0.9 · 0.95 · 0.8 몇 개에 뭉친다. 열 조각이 전부 `Y 0.9` 면
줄을 세울 수가 없다. 반면 첫 토큰의 로그확률은 촘촘하다 — 같은 `Y 0.9` 라도 하나는
P(Y)=0.9997, 다른 하나는 0.72 로 갈린다.

    P(Y) = p(Y) / (p(Y) + p(N) + r)        r = 1 − (후보들의 확률 합)

Y 와 N 사이의 몫만 보도록 **정규화**한다. 후보 목록에는 공백·따옴표·엉뚱한 글자가
섞여 있는데, 우리가 알고 싶은 것은 "둘 중 어느 쪽으로 기울었나" 하나뿐이다. 이 값은
모델이 `N` 이라고 답했을 때도 그대로 나온다(작은 값이 된다) — 판정과 순서가 같은
숫자 하나로 설명된다.

`r` 은 **후보 목록에서 잘려 나간 몫**이다. API 는 `top_logprobs` 를 20 으로 청해도
확률이 충분히 큰 후보만 보낸다. 모델이 확신할 때는 고른 토큰 하나만 오고, 그러면
`p(N)=0` 이 되어 P(Y) 가 **전부 1.0 으로 뭉친다** — 줄을 세울 수가 없다. 잘려 나간
몫을 N 쪽에 보태(보수적으로) 세면 그 뭉침이 풀린다: 실측에서 확신이 센 판정은
0.999996, 그보다 무른 판정은 0.999863 으로 갈렸다.

그래도 겹치면 **모델이 적은 확률**로 가르고, 그마저 같으면 검색이 준 순서를 지킨다.

로그확률이 오지 않으면(모델이 `top_logprobs` 를 받지 않으면) **모델이 적은 확률로**,
그것마저 없으면 **Y/N 만으로**(1.0 / 0.0) 줄을 세운다. 무엇으로 세웠는지는 판정마다
`source` 에 남겨 화면에 적는다 — 숨기면 왜 이 순서인지 설명되지 않는다.

## 지키는 것

- **예외를 올리지 않는다.** 판정이 실패해도 검색 결과는 이미 있고, 그때 쓰는 것은
  검색이 준 원래 순서다(`lab/rewrite.py`·`lab/hyde.py` 와 같다). 왜 못 썼는지는
  `note` 에 담는다.
- **판정에는 원래 질문을 쓴다.** 재작성한 검색어가 아니다. 재작성은 낱말이 어긋나
  못 찾는 문제를 푸는 장치인데 모델은 질문을 그대로 읽으면 되고, 다듬느라 뜻이
  좁아진 문장으로 판정하면 사용자가 묻지 않은 기준으로 조각을 버리게 된다.
- **전후 순위를 함께 돌려준다**(`rows`). 몇 위가 몇 위로 갔는지, 어느 것이 K 밖으로
  밀려났는지가 보이지 않으면 재정렬이 무슨 일을 했는지 알 수 없다.
- 두 열(의미·BM25)을 **각각 따로** 재정렬한다. 같은 판정자를 서로 다른 후보 묶음에
  들이대는 것이라 두 열을 섞지 않는다는 규칙은 그대로다.
"""

import re
import time
from concurrent.futures import ThreadPoolExecutor

from . import config, llm

PROMPT = """아래 [조각] 이 [질문] 에 답하는 근거로 쓸모가 있는지 판정하세요.

다음 한 줄만 출력합니다. 다른 말은 한 글자도 쓰지 마세요.

Y 0.92

- 첫 글자는 쓸모가 있으면 Y, 없으면 N 입니다.
- 한 칸(스페이스) 띄운 뒤, 이 조각이 쓸모 있을 확률을 0 과 1 사이 소수 두 자리로 적습니다.
- Y 로 판정했으면 0.5 이상, N 으로 판정했으면 0.5 미만이어야 합니다.
- 설명·따옴표·줄바꿈을 덧붙이지 마세요.

[질문] {question}

[조각]
{text}"""

# 지킨 꼴: 첫 글자가 Y 나 N, 한 칸, 0~1 사이 숫자. 그것만.
_STRICT = re.compile(r"^([YN]) (0(?:\.\d+)?|1(?:\.0+)?)$")
_LOOSE_YN = re.compile(r"[YNyn]")
_LOOSE_NUM = re.compile(r"(?:0?\.\d+|[01](?:\.\d+)?)")


def _parse(raw):
    """모델이 적어 낸 글 → {verdict, said, bad}

    형식을 지켰는지 기계로 본다. 어긋났어도 첫 글자와 숫자를 건질 수 있으면 쓰되,
    어긋났다는 사실은 화면에 적는다 — 판정이 곧 순위이므로 조용히 넘어가면 안 된다.
    """
    text = ""
    for line in (raw or "").splitlines():
        line = line.strip().strip('"“”‘’\'')
        if line:
            text = line
            break

    got = {"verdict": "", "said": None, "bad": ""}
    m = _STRICT.match(text)
    if m:
        got["verdict"] = m.group(1)
        got["said"] = float(m.group(2))
    else:
        yn = _LOOSE_YN.search(text[:4])      # 앞머리에서만 찾는다. 본문의 N 을 줍지 않게.
        num = _LOOSE_NUM.search(text)
        got["verdict"] = yn.group(0).upper() if yn else ""
        got["said"] = float(num.group(0)) if num else None
        got["bad"] = "형식이 어긋났습니다 — %s" % (text[:40] or "빈 답")
        if not yn:
            got["bad"] = "Y 나 N 으로 시작하지 않았습니다 — %s" % (text[:40] or "빈 답")

    said, verdict = got["said"], got["verdict"]
    if said is not None and verdict and not got["bad"]:
        if (verdict == "Y") != (said >= 0.5):
            got["bad"] = "%s 인데 확률이 %.2f 입니다" % (verdict, said)
    return got


def _from_logprobs(tokens):
    """첫 토큰의 후보에서 Y 와 N 의 몫을 갈라 낸다. → {p_yes, ...} 또는 None

    앞에 공백 토큰이 붙어 오는 모델이 있으므로 **Y 나 N 으로 읽히는 첫 토큰**을 찾아
    그 자리를 쓴다. 셈은 모듈 docstring 의 식 그대로다 — 잘려 나간 몫(`rest`)을
    N 쪽에 보태는 이유도 거기에 적어 두었다.
    """
    for tok in tokens or []:
        head = (tok.get("token") or "").strip().upper()[:1]
        if head not in ("Y", "N"):
            continue
        yes = no = seen = 0.0
        alts = []
        for a in tok.get("top") or []:
            p = a.get("prob")
            if p is None:
                continue
            seen += p
            k = (a.get("token") or "").strip().upper()[:1]
            if k == "Y":
                yes += p
            elif k == "N":
                no += p
            alts.append({"token": a.get("token") or "", "prob": round(p, 6),
                         "logprob": round(float(a.get("logprob")), 6)
                         if a.get("logprob") is not None else None})
        # 후보 목록은 잘려서 온다. 남은 몫은 Y 가 아닌 무언가이므로 N 쪽에 보탠다.
        rest = max(0.0, 1.0 - seen)
        bottom = yes + no + rest
        if bottom <= 0:
            return None
        return {
            "p_yes": yes / bottom,
            "p_raw": round(yes, 6),            # 정규화 전 — 다른 글자로 샌 몫이 보인다
            "n_raw": round(no, 6),
            "rest": round(rest, 6),            # 후보 목록에서 잘려 나간 몫
            "n_alts": len(alts),
            # Y·N 중 후보 목록에서 아예 빠진 쪽. 잘려서 온다는 사실을 화면이 그대로 적는다.
            "missing": "N" if no <= 0 else ("Y" if yes <= 0 else ""),
            "token": tok.get("token") or "",
            "logprob": round(float(tok["logprob"]), 6) if tok.get("logprob") is not None else None,
            "prob": round(tok["prob"], 6) if tok.get("prob") is not None else None,
            "alts": alts[:6],
        }
    return None


def judge(question, hit):
    """조각 하나를 판정한다. → {ok, verdict, said, score, source, logprobs, raw, note}

    예외를 올리지 않는다. 실패한 판정은 ok=False 로 돌아가고, 부른 쪽이 그 조각을
    원래 순위에 그대로 둔다.
    """
    out = {"ok": False, "verdict": "", "said": None, "score": None, "source": "",
           "logprobs": None, "raw": "", "note": "", "latency": 0.0}
    t0 = time.time()
    try:
        got = llm.respond(PROMPT.format(question=question, text=hit.get("text") or ""),
                          max_tokens=config.RERANK_MAX_TOKENS,
                          top_logprobs=config.RERANK_TOP_LOGPROBS)
    except llm.LLMError as exc:
        out["note"] = "판정하지 못했습니다 — %s" % exc
        out["latency"] = round(time.time() - t0, 2)
        return out
    except Exception as exc:                   # noqa: BLE001 — 예외를 올리지 않는다
        out["note"] = "판정 중 오류가 났습니다 — %s" % exc
        out["latency"] = round(time.time() - t0, 2)
        return out

    out["latency"] = round(time.time() - t0, 2)
    out["raw"] = (got["text"] or "").strip()
    parsed = _parse(out["raw"])
    out["verdict"] = parsed["verdict"]
    out["said"] = parsed["said"]
    out["note"] = parsed["bad"]

    try:
        lp = _from_logprobs(got.get("tokens"))
    except Exception:                          # noqa: BLE001 — 로그확률이 없어도 굴러간다
        lp = None
    if lp:
        out["logprobs"] = lp
        out["score"] = lp["p_yes"]
        out["source"] = "logprob"
    elif parsed["said"] is not None:
        out["score"] = parsed["said"]
        out["source"] = "said"
    elif parsed["verdict"]:
        out["score"] = 1.0 if parsed["verdict"] == "Y" else 0.0
        out["source"] = "verdict"
    else:
        out["note"] = out["note"] or "판정을 읽지 못했습니다"
        return out

    out["ok"] = True
    return out


_SOURCE_LABEL = {"logprob": "첫 토큰의 로그확률", "said": "모델이 적은 확률",
                 "verdict": "Y/N 판정만"}


def rerank(question, hits, k):
    """검색 결과를 다시 줄 세운다. → {applied, hits, rows, ...}

    `hits` 를 그 자리에서 고친다 — 조각마다 `rerank` 를 붙이고 `rank` 를 새로 매긴다.
    돌려주는 `hits` 는 상위 k 개이고, 밀려난 것까지 포함한 전후 순위는 `rows` 에 있다.
    """
    out = {"on": True, "applied": False, "model": config.GEN_MODEL,
           "pool": len(hits), "k": k, "calls": 0, "judged": 0, "failed": 0,
           "latency": 0.0, "note": "", "sources": {}, "moved": 0,
           "hits": hits, "rows": []}
    if not hits:
        out["note"] = "꺼낸 조각이 없어 재정렬할 것이 없습니다"
        return out

    t0 = time.time()
    # 판정은 서로 독립이다(조각끼리 견주지 않는다). 순서는 결과를 받아 다시 맞춘다.
    with ThreadPoolExecutor(max_workers=config.RERANK_WORKERS) as workers:
        verdicts = list(workers.map(lambda h: judge(question, h), hits))
    out["latency"] = round(time.time() - t0, 2)
    out["calls"] = len(verdicts)

    for hit, v in zip(hits, verdicts):
        v["rank_before"] = hit["rank"]
        hit["rerank"] = v
        if v["ok"]:
            out["judged"] += 1
            out["sources"][v["source"]] = out["sources"].get(v["source"], 0) + 1
        else:
            out["failed"] += 1

    if not out["judged"]:
        # 재정렬을 못 했을 뿐이지 검색은 멀쩡하다. 화면에는 재정렬을 껐을 때와 똑같이
        # K 개가 나가야 한다 — 후보를 넉넉히 꺼냈다는 사정이 결과 개수로 새면 안 된다.
        out["note"] = "조각을 하나도 판정하지 못해 검색 순서를 그대로 두었습니다"
        out["rows"] = [_row(h, h["rank"], h["rank"] <= k) for h in hits]
        out["hits"] = hits[:k]
        return out

    # 판정된 것이 앞, 판정 못 한 것이 뒤. 판정 못 한 것끼리는 검색이 준 순서 그대로다.
    # (점수를 지어내 끼워 넣으면 판정하지 못했다는 사실이 화면에서 사라진다.)
    order = sorted(hits, key=lambda h: (not h["rerank"]["ok"],
                                        -(h["rerank"]["score"] or 0.0),
                                        -(h["rerank"]["said"] or 0.0),
                                        h["rerank"]["rank_before"]))
    for rank, hit in enumerate(order, 1):
        v = hit["rerank"]
        v["rank_after"] = rank
        v["moved"] = v["rank_before"] - rank           # 양수면 올라간 것
        v["kept"] = rank <= k
        hit["rank"] = rank                             # 근거 번호도 이 순위를 따른다

    out["applied"] = True
    out["hits"] = order[:k]
    out["rows"] = [_row(h, h["rerank"]["rank_after"], h["rerank"]["kept"]) for h in order]
    out["moved"] = sum(1 for h in order if h["rerank"]["moved"])
    if out["failed"]:
        out["note"] = ("%d개를 판정하지 못해 검색 순서 그대로 뒤에 두었습니다"
                       % out["failed"])
    return out


def _row(hit, rank_after, kept):
    """전후 순위 표 한 줄. 밀려난 조각도 남겨야 재정렬이 무엇을 했는지 보인다."""
    v = hit.get("rerank") or {}
    text = hit.get("text") or ""
    return {
        "rank_before": v.get("rank_before", hit.get("rank")),
        "rank_after": rank_after,
        "moved": v.get("moved", 0),
        "kept": bool(kept),
        "ok": bool(v.get("ok")),
        "verdict": v.get("verdict") or "?",
        "score": round(v["score"], 6) if v.get("score") is not None else None,
        "said": v.get("said"),
        "source": v.get("source") or "",
        "source_label": _SOURCE_LABEL.get(v.get("source") or "", ""),
        "note": v.get("note") or "",
        "document": hit.get("document"),
        "chunk_index": hit.get("chunk_index"),
        "page": hit.get("page"),
        "source_kind": hit.get("source"),      # document / generated
        "head": text[:60],
    }
