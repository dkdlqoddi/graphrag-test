# -*- coding: utf-8 -*-
"""HyDE — 가상 답변을 먼저 쓰고, 그 글로 검색한다 (선택).

질문과 문서는 생김새가 다르다. 질문은 짧고 의문형이고 "왜", "뭐야" 같은 군말이 섞이지만
문서는 길고 서술형이다. 벡터 공간에서도 그만큼 떨어져 있어, 질문 벡터로 찾으면 정작
답이 적힌 문단보다 질문처럼 생긴 문장이 가까워지는 일이 생긴다.

HyDE 는 그 간격을 **가짜 문서**로 메운다. 모델에게 "문서에 이렇게 쓰여 있었을 것"이라는
문단을 쓰게 하고, 질문 대신 **그 문단을 임베딩해** 검색한다. 문서끼리 견주는 셈이 된다.

  질문 → (모델) 가상 답변 → 임베딩 → 검색

**가상 답변의 내용이 맞는지는 상관없다.** 사실 확인을 하지 않았고, 틀린 문장이 섞여도
쓰인 낱말과 문체가 문서를 닮았으면 제 몫을 한다 — 우리가 쓰는 것은 그 글의 *벡터*이지
글의 주장이 아니다. 그래서 이 글은 **화면에 "검색용 추측"이라고 밝혀 보여 주고, 답변의
근거로는 절대 쓰지 않으며, 저장소에도 넣지 않는다.** 검색이 끝나면 버린다.

적용 범위는 **의미 검색(왼쪽 열)뿐**이다. HyDE 는 이름 그대로 임베딩을 바꾸는 방법이고,
낱말 검색(BM25)에까지 가상 답변을 넣으면 질문에 없던 낱말로 찾게 되어 두 열을 나란히
놓고 비교하는 뜻이 사라진다.
"""

import time

from . import config, llm

PROMPT = """아래 질문에 답하는 문단을 하나 쓰세요.

이 글은 사용자에게 보여 줄 답이 아니라 검색에 쓸 미끼입니다. 그 내용이 문서에 있었다면
어떤 문장으로 쓰여 있을지를 흉내 내는 것이 목적입니다.

- 기술 문서의 설명문처럼 쓰세요. 인사말·머리말 없이 본문만 씁니다.
- "문서에 따르면", "제 생각에는", "확인되지 않습니다" 같은 말은 쓰지 마세요.
- 세 문장 안팎으로 짧게 쓰세요.
- 한국어 용어에는 영문 용어를 괄호로 병기하세요.

[질문] {question}"""


def draft(question):
    """→ {on, ok, text, note, model, latency}

    실패해도 예외를 올리지 않는다. 검색은 계속되어야 하고, 그때 쓰는 것은 질문 그대로다.
    왜 못 썼는지는 note 에 담아 화면이 알리게 한다(조용히 넘어가면 무엇으로 검색됐는지
    알 수 없다).
    """
    out = {"on": True, "ok": False, "text": "", "note": "",
           "model": config.GEN_MODEL, "latency": 0.0}
    t0 = time.time()
    try:
        raw = llm.generate(PROMPT.format(question=question),
                           max_tokens=config.HYDE_MAX_TOKENS)
    except llm.LLMError as exc:
        out["note"] = "가상 답변을 만들지 못해 질문 그대로 검색했습니다 — %s" % exc
        out["latency"] = round(time.time() - t0, 2)
        return out

    text = (raw or "").strip()
    out["latency"] = round(time.time() - t0, 2)
    if not text:
        out["note"] = "가상 답변이 비어 있어 질문 그대로 검색했습니다"
        return out
    if len(text) > config.HYDE_MAX_CHARS:
        # 너무 길면 문서 한 조각이 아니라 문서 여러 장을 임베딩하는 꼴이 되어
        # 벡터가 뭉개진다. 앞부분만 쓴다.
        text = text[:config.HYDE_MAX_CHARS].rstrip()
        out["note"] = "가상 답변이 길어 앞 %d자만 썼습니다" % config.HYDE_MAX_CHARS

    out["ok"] = True
    out["text"] = text
    return out
