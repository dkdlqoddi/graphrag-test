# -*- coding: utf-8 -*-
"""질문을 검색용 한 줄로 바꾼다 (선택).

사람이 묻는 말과 문서에 쓰인 말은 다르다. "소프트 에러가 왜 나?" 로는 `soft error`
라고 적힌 영문 문서의 낱말과 하나도 겹치지 않아 BM25 가 아무것도 못 찾고, 의미 검색도
질문의 군말(왜, 뭐야, 알려 줘)까지 벡터에 섞인다. 그래서 **검색에 쓸 문장만** 따로 만든다.

  검색에는 바뀐 질의를 쓰고, **답변에는 원래 질문을 쓴다.**

바꾼 질의로 답까지 만들면 사용자가 묻지 않은 것에 답하게 된다. 이 분리가 이 모듈의 요점이다.

모델에게 문서 목록을 함께 준다. 그 문서들에 쓰일 법한 용어를 고르라는 뜻이지 문서를
지정하라는 뜻이 아니다 — 문서 이름·번호를 질의에 넣지 못하게 막는다(`_check`).

**모델이 규칙을 지켰는지는 기계로 확인한다.** "넣지 마라"고 적는 것만으로는 안 넣는다는
보장이 없고, 질의는 검색 결과를 통째로 좌우한다. 원문에 없던 숫자가 들어왔거나 길이가
터무니없으면 바꾼 질의를 버리고 원문으로 검색한다. 버렸다는 사실은 화면에 적는다.
"""

import re
import time

from . import config, llm

PROMPT = """당신은 검색 질의를 다듬는 사람입니다.
아래 질문을 문서 검색에 쓸 한 줄로 바꾸세요.

규칙
- 문서 목록을 보고 그 문서들에 쓰일 법한 용어를 고르세요.
- 한국어 용어에는 필요하면 영문 용어를 괄호로 병기하세요. 예: 소프트 에러(soft error)
- 질문에 없는 조건·수치·연도·버전·범위를 넣지 마세요.
- 질문에 대한 답을 넣지 마세요. 찾을 말을 고르는 것이지 답하는 것이 아닙니다.
- 문서 이름이나 번호는 넣지 마세요. 문서 목록은 용어를 고르는 데만 씁니다.
- 설명도 따옴표도 없이, 바꾼 질의 한 줄만 출력하세요.

{docs}
[질문] {question}"""

_NUM = re.compile(r"\d+")


def _docs_block(documents):
    names = [d.get("document", "") for d in (documents or []) if d.get("document")]
    if not names:
        return "[검색 대상 문서] (아직 적재된 문서가 없습니다)\n"
    return "[검색 대상 문서]\n" + "\n".join("- %s" % n for n in names) + "\n"


def _first_line(text):
    """설명을 덧붙여 오는 경우가 있다. 첫 줄만, 따옴표는 떼고."""
    for line in (text or "").splitlines():
        line = line.strip().strip('"“”‘’\'')
        if line:
            return line
    return ""


def _check(original, text):
    """규칙을 지켰는지 본다. → 어긴 이유(한 줄) 또는 None"""
    if not text:
        return "빈 답이 돌아왔습니다"
    if len(text) > max(120, len(original) * 4):
        return "질의가 너무 길어졌습니다(%d자)" % len(text)
    had = set(_NUM.findall(original))
    new = [n for n in _NUM.findall(text) if n not in had]
    if new:
        return "질문에 없던 숫자가 들어갔습니다 — %s" % ", ".join(sorted(set(new))[:3])
    return None


def rewrite(question, documents):
    """→ {on, applied, original, query, note, model, latency}

    실패해도 예외를 올리지 않는다. 검색은 어떤 경우에도 계속되어야 하고,
    그때 쓰는 것은 원래 질문이다. 왜 못 썼는지는 note 에 담아 화면이 알리게 한다.
    """
    out = {"on": True, "applied": False, "original": question, "query": question,
           "note": "", "model": config.GEN_MODEL, "latency": 0.0}
    t0 = time.time()
    try:
        raw = llm.generate(PROMPT.format(docs=_docs_block(documents), question=question),
                           max_tokens=config.REWRITE_MAX_TOKENS)
    except llm.LLMError as exc:
        out["note"] = "재작성에 실패해 원문으로 검색했습니다 — %s" % exc
        out["latency"] = round(time.time() - t0, 2)
        return out

    text = _first_line(raw)
    bad = _check(question, text)
    out["latency"] = round(time.time() - t0, 2)
    if bad:
        out["note"] = "바꾼 질의를 버리고 원문으로 검색했습니다 — %s" % bad
        out["rejected"] = text
        return out
    if text == question:
        out["note"] = "바꿀 것이 없어 원문 그대로 검색했습니다"
        return out

    out["applied"] = True
    out["query"] = text
    return out
