# -*- coding: utf-8 -*-
"""문서를 조각으로 자르는 네 가지 방식. 오버랩 없이 자른다.

  fixed      길이만 보고 자른다. 문서 사정을 모른다.
  structure  절 번호나 제목 줄을 경계로 삼는다. 구획이 뚜렷한 문서에서 산다.
  paragraph  빈 줄로 나뉜 문단을 최소 단위로 삼는다. 문단 중간을 자르지 않는다.
  semantic   문장을 벡터로 바꿔 뜻이 바뀌는 자리에서 자른다. 임베딩을 부른다.

앞의 셋은 글의 모양만 보고, 마지막 하나는 글의 뜻을 본다.
"""

import math
import re

from . import config, llm, parsing

# "2.2.1", "제10조", "Section 4", "4.1 Title" 같은 구획 시작 줄
_HEADING = re.compile(
    r"^\s*("
    r"\d+(\.\d+)+\.?\s+\S"                 # 2.2.1 제목
    r"|제\s*\d+\s*조"                       # 제10조
    r"|(Section|Chapter|Appendix)\s+\S"     # Section 4
    r"|\d+\.\s+[A-Z가-힣]"                  # 4. Title
    r")",
    re.IGNORECASE,
)


# 문장 경계는 두 가지로 본다.
#   · 문장부호(. ! ? 。 ！ ？) 뒤의 공백 — 언제나 경계다. 뒤에 공백을 요구하므로
#     "3.5" 나 "rev05.pdf" 의 점에서는 끊기지 않고, 앞이 "숫자." 면 절 번호로 보아
#     ("7.7. USB" 의 "7.7.") 역시 끊지 않는다.
#   · 줄바꿈 — 빈 줄이거나, 다음 줄이 번호·기호·대문자 제목처럼 새 덩어리로 시작할 때만.
#
# 줄바꿈을 무조건 경계로 보면 PDF 에서 줄이 바뀐 자리가 전부 문장 끝이 된다. 한 문장이
# 여러 줄에 걸쳐 오는 것이 PDF 의 기본값이라, "...requires processes / compliant with..."
# 처럼 문장 한복판이 경계가 되고 의미 경계 청킹은 바로 거기서 자른다.
#
# 문장은 두 곳에서 쓴다 — 의미 경계 청킹이 자를 후보로, 근거 하이라이트가 칠할 단위로.
# 같은 앱 안에서 "문장"이 두 가지 뜻이면 화면이 설명되지 않으므로 한 곳에 둔다.
_END = re.compile(r"(?<![0-9]\.)(?<=[.!?。！？])\s+")
_NEWLINE = re.compile(r"\n+")
_NEW_BLOCK = re.compile(r"\s*(\d+(\.\d+)*\.?\s|[-•·*]\s|제\s*\d+\s*조|[A-Z][A-Z ]{3,})")


def _sentence_ends(text):
    """문장이 끝나는 자리 (오름차순)."""
    cuts = set()
    for m in _END.finditer(text):
        cuts.add(m.end())
    for m in _NEWLINE.finditer(text):
        if m.group().count("\n") > 1 or _NEW_BLOCK.match(text, m.end()):
            cuts.add(m.end())
    return sorted(cuts)


def _sent_trim(text, a, b):
    """앞뒤 공백을 오프셋에서 털어 낸다. → (a, b) 또는 None"""
    while a < b and text[a].isspace():
        a += 1
    while b > a and text[b - 1].isspace():
        b -= 1
    return (a, b) if b > a else None


def _sent_cut_long(text, a, b):
    """상한을 넘는 문장을 다시 나눈다. 가능하면 공백에서 끊는다.

    표나 목차가 한 줄로 길게 이어지면 문장부호도 빈 줄도 나오지 않는다. 그대로 두면
    "이 부분"이라고 가리키는 뜻이 없어지므로 길이로 잘라 붙잡을 수 있게 만든다.
    """
    hi = config.SENT_MAX_CHARS
    out = []
    while b - a > hi:
        cut = -1
        for j in range(hi - 1, hi // 2, -1):        # 뒤에서부터 쓸 만한 공백을 찾는다
            if text[a + j].isspace():
                cut = j
                break
        if cut < 0:
            cut = hi
        span = _sent_trim(text, a, a + cut)
        if span:
            out.append(span)
        a += cut
    span = _sent_trim(text, a, b)
    if span:
        out.append(span)
    return out


def _sent_merge_short(text, spans):
    """짧은 조각을 앞 문장에 붙인다. 하한에 닿는 순간 멈춘다.

    목차 줄("7.7. USB")이나 표의 한 칸처럼 열 몇 자짜리 조각은 그 자체로는
    질문과의 거리가 요동친다. 이웃과 묶어 문장만 한 덩어리로 만든다.

    묶는 조건을 "앞 조각이 아직 하한에 못 미칠 때"로 둔다. 짧은 쪽을 볼 때마다
    묶으면 이미 충분히 긴 조각이 뒤따르는 짧은 문장들을 계속 삼켜, 문단 하나가
    통째로 하이라이트되는 일이 생긴다 — 그러면 "어느 부분이 근거인가"를 가리키는
    뜻이 없어진다.
    """
    lo, hi = config.SENT_MIN_CHARS, config.SENT_MAX_CHARS
    out = []
    for a, b in spans:
        if out:
            pa, pb = out[-1]
            if (pb - pa) < lo and (b - pa) <= hi:
                out[-1] = (pa, b)
                continue
        out.append((a, b))
    return out


def split_sentences(text):
    """글 → 문장 구간 [(start, end)]. 오프셋은 넘겨준 텍스트 기준이다."""
    if not text or not text.strip():
        return []
    spans, prev = [], 0
    for pos in _sentence_ends(text):
        if pos <= prev:
            continue
        span = _sent_trim(text, prev, pos)
        if span:
            spans.append(span)
        prev = pos
    span = _sent_trim(text, prev, len(text))
    if span:
        spans.append(span)

    cut = []
    for a, b in spans:
        cut += _sent_cut_long(text, a, b)
    return _sent_merge_short(text, cut)


def u16(text, i):
    """파이썬 문자 위치 → 브라우저(UTF-16) 문자 위치.

    화면은 이 오프셋으로 원문을 잘라 칠한다. 파이썬은 코드포인트로 세고
    자바스크립트는 UTF-16 단위로 센다 — BMP 밖 글자(이모지 등)가 한 자라도
    섞이면 그 뒤의 표시가 통째로 밀린다. 보내기 전에 브라우저 기준으로 바꾼다.
    """
    return i + sum(1 for ch in text[:i] if ord(ch) > 0xFFFF)


def _mk(text, start, pages, index, strategy):
    text = text.strip()
    return {
        "index": index,
        "text": text,
        "n_chars": len(text),
        "page": parsing.page_of(pages, start),
        "strategy": strategy,
    }


def _split_long(text, start, size):
    """상한을 넘는 덩어리를 길이로 다시 나눈다. (조각, 시작위치) 목록.

    마지막 꼬리가 너무 짧으면 앞 조각에 붙인다. `tations.` 처럼 단어 중간이
    잘린 8자짜리 조각을 만들지 않기 위해서다.
    """
    out = []
    for i in range(0, len(text), size):
        out.append((text[i:i + size], start + i))
    if len(out) > 1 and len(out[-1][0].strip()) < size * 0.2:
        tail = out.pop()
        prev, prev_start = out[-1]
        out[-1] = (prev + tail[0], prev_start)
    return out


def _merge_short(blocks, size, floor_ratio=0.4):
    """연속된 짧은 덩어리를 상한까지 묶는다.

    구조 경계 전략은 목차 페이지에서 무너진다. `7.7. USB` 같은 항목이
    한 줄씩 끊겨 8~10자짜리 조각을 수백 개 만든다. 이웃끼리 묶어 준다.
    """
    floor = size * floor_ratio
    out = []
    for body, start in blocks:
        if out and len(body.strip()) < floor and len(out[-1][0]) + len(body) + 1 <= size:
            prev, prev_start = out[-1]
            out[-1] = (prev + "\n" + body, prev_start)
        else:
            out.append((body, start))
    return out


def chunk_fixed(doc, size, ctx=None):
    pages, text = doc["pages"], doc["text"]
    out = []
    for i in range(0, len(text), size):
        piece = text[i:i + size]
        if piece.strip():
            out.append(_mk(piece, i, pages, len(out), "fixed"))
    return out


def chunk_structure(doc, size, ctx=None):
    pages, text = doc["pages"], doc["text"]
    lines = text.split("\n")

    # 제목 줄에서 끊어 덩어리를 만든다
    blocks, cur, cur_start, pos = [], [], 0, 0
    for ln in lines:
        if _HEADING.match(ln) and cur:
            blocks.append(("\n".join(cur), cur_start))
            cur, cur_start = [], pos
        cur.append(ln)
        pos += len(ln) + 1
    if cur:
        blocks.append(("\n".join(cur), cur_start))

    blocks = _merge_short(blocks, size)

    out = []
    for body, start in blocks:
        if not body.strip():
            continue
        for piece, off in (_split_long(body, start, size) if len(body) > size
                           else [(body, start)]):
            if piece.strip():
                out.append(_mk(piece, off, pages, len(out), "structure"))
    return out


def chunk_paragraph(doc, size, ctx=None):
    pages, text = doc["pages"], doc["text"]

    # 빈 줄로 문단을 나누되 시작 위치를 함께 들고 간다
    paras, pos = [], 0
    for part in re.split(r"\n\s*\n", text):
        paras.append((part, pos))
        pos += len(part) + 2

    out, buf, buf_start = [], "", None
    for body, start in paras:
        if not body.strip():
            continue
        if len(body) > size:                          # 문단 하나가 상한을 넘으면
            if buf:
                out.append(_mk(buf, buf_start, pages, len(out), "paragraph"))
                buf, buf_start = "", None
            for piece, off in _split_long(body, start, size):
                if piece.strip():
                    out.append(_mk(piece, off, pages, len(out), "paragraph"))
            continue
        if buf and len(buf) + len(body) + 2 > size:   # 더 담으면 넘친다
            out.append(_mk(buf, buf_start, pages, len(out), "paragraph"))
            buf, buf_start = "", None
        if not buf:
            buf, buf_start = body, start
        else:
            buf += "\n\n" + body
    if buf:
        out.append(_mk(buf, buf_start, pages, len(out), "paragraph"))
    return out


# ── 의미 경계 (semantic) ────────────────────────────────────────────
# 문장을 벡터로 바꾸고 이웃한 두 문장이 얼마나 다른지를 재, 많이 다른 자리에서 자른다.
# 자르는 자리는 "거리 상위 몇 %" 로 정한다. 거리의 절댓값은 문서마다 달라 고정 임계값을
# 쓰면 어떤 문서는 한 번도 안 잘리고 어떤 문서는 문장마다 잘린다. 백분위는 그 문서 안에서의
# 상대적인 순위라서 문서가 바뀌어도 뜻이 유지된다.
#
# 임베딩을 부르는 유일한 청킹 전략이다. 백분위만 바꿀 때는 다시 부르지 않는다.


def sentence_distances(doc, cache=None, on_progress=None):
    """문장마다 벡터를 얻어 이웃 문장 사이의 거리를 잰다.

    → {key, spans, distances, cached}
        spans      문서 전체 텍스트 안에서의 (시작, 끝). 청크의 시작 오프셋이 여기서 나온다.
        distances  distances[i] = spans[i] 와 spans[i+1] 사이의 코사인 거리

    벡터는 들고 있지 않는다. 거리를 얻고 나면 (문장 수 x 1536) 개의 숫자를 계속 쥐고
    있을 이유가 없고, 백분위를 바꿔 다시 자를 때 필요한 것도 거리뿐이다. 그래서 화면에서
    백분위를 움직이는 동안에는 임베딩 호출이 한 번도 나가지 않는다.
    """
    text = doc["text"]
    key = "%d:%d" % (len(text), len(doc["pages"]))
    if cache is not None and cache.get("key") == key:
        return {"key": key, "spans": cache["spans"],
                "distances": cache["distances"], "cached": True}

    spans = split_sentences(text)
    vectors = llm.embed_many([text[a:b] for a, b in spans], on_progress)
    distances = [round(1.0 - llm.cosine(vectors[i], vectors[i + 1]), 4)
                 for i in range(len(vectors) - 1)]
    got = {"key": key, "spans": spans, "distances": distances, "cached": False}
    if cache is not None:
        cache.clear()
        cache.update(got)
    return got


def _percentile(values, p):
    """오름차순으로 늘어놓았을 때 p% 지점의 값 (선형 보간)."""
    if not values:
        return 0.0
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * (p / 100.0)
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    if lo == hi:
        return s[lo]
    return s[lo] * (hi - k) + s[hi] * (k - lo)


def breakpoints(distances, top_pct):
    """거리가 상위 top_pct % 안에 드는 경계를 자를 자리로 본다.

    → (자를 경계 번호 목록, 임계 거리)
    """
    if not distances:
        return [], 0.0
    threshold = round(_percentile(distances, 100 - top_pct), 4)
    return [i for i, d in enumerate(distances) if d >= threshold], threshold


def _snippets(text, spans, width=30):
    """경계마다 앞 문장의 끝과 뒤 문장의 처음. 화면에서 무엇이 바뀌었는지 보여 준다."""
    out = []
    for i in range(len(spans) - 1):
        a, b = spans[i]
        c, d = spans[i + 1]
        out.append([text[max(a, b - width):b].strip(), text[c:min(d, c + width)].strip()])
    return out


def chunk_semantic(doc, size, ctx=None):
    """뜻이 바뀌는 자리에서 자른다. ctx 로 백분위와 캐시를 주고받는다.

    size 는 쓰지 않는다 — 조각의 길이를 정하는 것이 백분위이기 때문이다. 다만 뜻이
    좀처럼 안 바뀌면 한 묶음이 끝없이 길어지므로 상한(CHUNK_SIZE_MAX)에서만 끊는다.
    """
    ctx = {} if ctx is None else ctx
    pct = int(ctx.get("percentile") or config.SEMANTIC_PCT_DEFAULT)
    pct = max(config.SEMANTIC_PCT_MIN, min(config.SEMANTIC_PCT_MAX, pct))

    got = sentence_distances(doc, ctx.get("cache"), ctx.get("on_progress"))
    spans, distances = got["spans"], got["distances"]
    cuts, threshold = breakpoints(distances, pct)
    cut_at = set(cuts)

    # 자를 자리를 기준으로 문장을 묶는다. 묶음 하나가 청크 하나다.
    groups, cur = [], [0]
    for i in range(len(distances)):
        if i in cut_at:
            groups.append(cur)
            cur = []
        cur.append(i + 1)
    if cur:
        groups.append(cur)

    pages, text = doc["pages"], doc["text"]
    out, capped = [], 0
    for g in groups:
        if not g:
            continue
        start, stop = spans[g[0]][0], spans[g[-1]][1]
        body = text[start:stop]                # 원문을 그대로 잘라 낸다(사이 공백까지)
        if not body.strip():
            continue
        pieces = (_split_long(body, start, config.CHUNK_SIZE_MAX)
                  if len(body) > config.CHUNK_SIZE_MAX else [(body, start)])
        if len(pieces) > 1:
            capped += 1
        for piece, off in pieces:
            if piece.strip():
                out.append(_mk(piece, off, pages, len(out), "semantic"))

    ctx["report"] = {
        "percentile": pct,
        "threshold": threshold,
        "sentences": len(spans),
        "boundaries": len(distances),
        "cuts": len(cuts),
        "cached": got["cached"],
        "capped": capped,
        "distances": distances,
        "snippets": _snippets(text, spans),
    }
    return out


_FN = {"fixed": chunk_fixed, "structure": chunk_structure,
       "paragraph": chunk_paragraph, "semantic": chunk_semantic}


def chunk(doc, strategy, size=None, ctx=None):
    if strategy not in _FN:
        raise ValueError("모르는 전략: %s" % strategy)
    size = int(size or config.CHUNK_SIZE_DEFAULT)
    size = max(config.CHUNK_SIZE_MIN, min(config.CHUNK_SIZE_MAX, size))
    chunks = _FN[strategy](doc, size, ctx)
    for i, c in enumerate(chunks):             # 번호를 다시 매긴다
        c["index"] = i
    return chunks


def summarize(chunks):
    if not chunks:
        return {"count": 0, "min": 0, "max": 0, "avg": 0}
    sizes = [c["n_chars"] for c in chunks]
    return {
        "count": len(chunks),
        "min": min(sizes),
        "max": max(sizes),
        "avg": round(sum(sizes) / len(sizes)),
    }
