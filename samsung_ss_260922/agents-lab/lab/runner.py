# -*- coding: utf-8 -*-
"""도구를 쓰는 대화 한 번.

**LLM 은 어떤 도구를 어떤 인자로 부를지 결정만 한다. 실제 실행은 이 파일이 한다.**

시스템 프롬프트는 화면에서 고칠 수 있다. 고친 값은 state/system_prompt.txt 에 남는다.
"""

import json
import os
import time

from . import config, llm, registry

# 기본 시스템 프롬프트. 특정 도구를 편들지 않는 중립 지시만 둔다.
DEFAULT_SYSTEM_PROMPT = """너는 사용자의 일을 도구로 처리하는 업무 보조 AI다.

- 요청을 처리할 수 있는 도구가 있으면 되묻지 말고 바로 호출한다.
- 쓸 수 있는 도구 중에 요청을 처리할 수 있는 것이 없으면, 다른 도구로 대신하거나
  지어내지 말고 지금은 할 수 없다고 짧게 답한다.
- 도구가 돌려준 값에 있는 내용만으로 답한다.
- 답변은 한국어로 간결하게 쓴다."""


def system_prompt():
    if os.path.exists(config.SYSTEM_PROMPT_PATH):
        try:
            with open(config.SYSTEM_PROMPT_PATH, "r", encoding="utf-8") as f:
                return f.read()
        except OSError:
            pass
    return DEFAULT_SYSTEM_PROMPT


def set_system_prompt(text):
    os.makedirs(config.STATE_DIR, exist_ok=True)
    with open(config.SYSTEM_PROMPT_PATH, "w", encoding="utf-8") as f:
        f.write(text)


def clear_system_prompt():
    if os.path.exists(config.SYSTEM_PROMPT_PATH):
        os.remove(config.SYSTEM_PROMPT_PATH)


def _short(value, limit=2000):
    """로그에 남길 길이. 잘린 코드는 안 보이는 것과 같으므로 넉넉히 둔다."""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + " …"


def run(message, entries, prompt=None, web_search=False, max_steps=None, history=None,
        should_stop=None):
    """한 요청을 끝까지 처리한다.

    history 를 주지 않으면 이전 대화를 넘기지 않는다 (기본).
    후속 질의만 history 를 넘겨 앞선 대화를 이어받는다.

    should_stop 을 주면 매 단계와 도구 호출 직전에 물어보고, 참이면 거기서 멈춘다.
    **이미 시작된 호출을 중간에 끊지는 못한다.** 파이썬에서 남의 작업을 강제로
    끊을 방법이 없으므로, 끊는 대신 다음 차례를 시작하지 않는 쪽을 택했다.

    반환 : {"answer", "calls", "tokens", "searches", "elapsed", "steps", "items", "stopped"}
    """
    started = time.time()
    steps = max_steps or config.MAX_TOOL_STEPS
    prompt = system_prompt() if prompt is None else prompt
    decls = registry.declarations(entries)

    items = list(history or [])
    items.append({"role": "user", "content": message})
    calls_log, searches = [], []
    tokens, answer, used = 0, "", 0
    stopped = False

    for _ in range(steps):
        if should_stop and should_stop():
            stopped = True
            break

        out = llm.call(prompt, items, decls, web_search=web_search)
        tokens += out["tokens"]
        used += 1
        for q in out["searches"]:
            if q not in searches:
                searches.append(q)

        # 응답의 출력 항목을 그대로 이어 붙인다. 모델의 말, 도구 호출 요청이 여기 들어 있다.
        items.extend(out["items"])

        if not out["calls"]:
            answer = out["text"]
            break

        halt = False
        for c in out["calls"]:
            name, args = c["name"], c["args"]
            entry = registry.find(entries, name)
            if should_stop and should_stop():
                # 남은 호출은 시작하지 않는다. 그래도 결과 항목은 채워 둔다 —
                # function_call 하나에 output 하나가 짝을 이뤄야 다음 턴이 성립한다.
                halt = True
                result = {"오류": "사용자가 중지했습니다."}
            elif entry is None:
                result = {"오류": "그런 이름의 도구는 없습니다."}
            else:
                try:
                    result = entry["call"](dict(args))
                except Exception as exc:            # noqa: BLE001
                    # 도구가 실패해도 앱은 죽지 않는다. 오류를 그대로 모델에게 돌려주어
                    # 모델이 다시 시도하거나 다른 방법을 찾을 수 있게 한다.
                    result = {"오류": "도구를 실행하지 못했습니다.",
                              "내용": str(exc)[:300]}
            calls_log.append({
                "tool": name,
                "source": entry["source"] if entry else "알 수 없음",
                "args": _short(args, 3000),
                "result": _short(result),
            })
            # 도구 결과는 call_id 로 짝을 맞춰 돌려준다.
            items.append({"type": "function_call_output",
                          "call_id": c["call_id"],
                          "output": json.dumps(result, ensure_ascii=False)})
        if halt:
            stopped = True
            break
    else:
        answer = "요청을 끝내지 못했습니다. 조금 더 나누어서 다시 말씀해 주세요."

    if stopped and not answer:
        answer = "중지했습니다. 여기까지 진행한 내용은 아래에 남아 있습니다."
    if not answer:
        answer = "답변을 만들지 못했습니다. 다시 한 번 말씀해 주세요."
    return {
        "answer": answer,
        "calls": calls_log,
        "tokens": tokens,
        "searches": searches,
        "elapsed": round(time.time() - started, 1),
        "steps": used,
        "items": items,                # 후속 질의에서 이어 쓴다
        "stopped": stopped,
    }
