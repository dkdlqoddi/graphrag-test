# -*- coding: utf-8 -*-
"""꺼낸 조각을 근거로 답을 만든다.

검색이 찾아온 청크를 질문과 함께 하나의 프롬프트로 묶어 모델에 보낸다.
프롬프트에 넣는 지시는 세 가지다.
  · 준 근거만 쓴다
  · 근거에 없으면 없다고 말한다
  · 어느 근거를 썼는지 번호를 밝힌다
"""

from . import llm

PROMPT = """당신은 문서 안내원입니다.
아래 근거만 사용해 답하세요. 근거에 없는 내용은 지어내지 말고
"문서에서 확인되지 않습니다"라고 답하세요.
답변은 세 문장 이내로 쓰고, 마지막에 사용한 근거 번호를 [근거 1, 3] 형식으로 밝히세요.

{context}

[질문] {question}"""


def build_context(hits):
    """검색 결과를 프롬프트에 넣을 근거 묶음으로 만든다."""
    return "\n\n".join(
        "[근거 %d] (%s · %s쪽 · 청크 #%s)\n%s"
        % (h["rank"], h.get("document", "?"), h.get("page", "?"),
           h.get("chunk_index", "?"), h.get("text", ""))
        for h in hits)


def answer(question, hits):
    """→ {text, prompt_chars, used}"""
    if not hits:
        return {"text": "검색 결과가 없어 답할 수 없습니다.",
                "prompt_chars": 0, "used": []}
    context = build_context(hits)
    prompt = PROMPT.format(context=context, question=question)
    text = llm.generate(prompt)
    return {
        "text": text,
        "prompt_chars": len(prompt),
        "used": [{"rank": h["rank"], "document": h.get("document"),
                  "chunk_index": h.get("chunk_index"), "page": h.get("page")}
                 for h in hits],
    }
