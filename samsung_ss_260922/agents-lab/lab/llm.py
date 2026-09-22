# -*- coding: utf-8 -*-
"""OpenAI API 호출 (파이썬 표준 라이브러리만 사용).

외부 SDK 를 쓰지 않는 이유 — pip 설치 없이 그대로 실행돼야 한다.
API 키는 URL 이 아니라 Authorization 헤더로 보낸다. URL 은 오류 메시지에 찍힐 수 있다.

Responses API(`POST /v1/responses`)를 쓴다.
  · 한 턴의 입력은 항목(item) 배열이다 — 사용자 메시지, 앞선 응답의 출력 항목, 도구 결과.
  · 응답의 `output` 항목들을 **그대로 다음 입력에 이어 붙이면** 대화가 이어진다.
  · 내장 웹 검색은 `{"type": "web_search"}` 도구 하나로 켠다. 내 함수와 같은 요청에 넣을 수 있다.
"""

import json
import time
import urllib.error
import urllib.request

from . import config

BASE = "https://api.openai.com/v1"


class QuotaExceeded(Exception):
    """분당 호출 한도 또는 잔액 초과 (HTTP 429)."""


class LLMError(Exception):
    """그 밖의 API 오류. 메시지에 키를 담지 않는다."""


# 모델이 temperature 를 거부하면(400) 그 뒤로는 보내지 않는다. 추론 모델은 이 값을 받지 않는다.
_STATE = {"temperature_ok": True}


def _message(detail):
    """OpenAI 오류 본문에서 사람이 읽을 문장만 꺼낸다."""
    try:
        return json.loads(detail)["error"]["message"]
    except (ValueError, KeyError, TypeError):
        return detail


def _post(path, payload, timeout=150, retries=1):
    # 문서 여러 장을 안고 부르는 호출은 90초를 넘길 수 있다. 150초로 둔다.
    url = "%s/%s" % (BASE, path)
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json",
               "Authorization": "Bearer %s" % config.api_key()}
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = _message(e.read().decode("utf-8", "replace"))[:300]
            if e.code == 429:
                raise QuotaExceeded(detail)
            if e.code in (500, 502, 503, 504) and attempt < retries:
                last = LLMError("HTTP %d" % e.code)
                time.sleep(2.0)
                continue
            raise LLMError("HTTP %d %s" % (e.code, detail))
        except (urllib.error.URLError, OSError) as e:
            # URLError 는 연결 실패, TimeoutError(OSError) 는 응답을 기다리다 끊긴 것. 둘 다 한 번 더 시도한다.
            if attempt < retries:
                last = LLMError("network")
                time.sleep(2.0)
                continue
            raise LLMError("network: %s" % (getattr(e, "reason", None) or e.__class__.__name__,))
    raise last or LLMError("unknown")


def _function_tools(declarations):
    out = []
    for d in declarations:
        out.append({
            "type": "function",
            "name": d["name"],
            "description": d.get("description", ""),
            "parameters": d.get("parameters") or {"type": "object", "properties": {}},
        })
    return out


def call(system_prompt, items, declarations, web_search=False, temperature=None):
    """한 턴을 호출한다.

    items         : Responses API 입력 항목 배열 (user 메시지 · 앞선 output 항목 · function_call_output)
    declarations  : 함수 선언 배열 [{"name", "description", "parameters"}]. 빈 배열이면 내 도구 없이 호출한다
    web_search    : 내장 웹 검색을 켠다. 웹 검색이 필요한 역할에서만 켠다

    반환 : {"items", "text", "calls", "tokens", "searches"}
           items    — 응답의 output 항목 전부. 다음 입력에 그대로 이어 붙인다
           calls    — [{"name", "args", "call_id"}]. call_id 로 결과를 돌려준다
           searches — 내장 검색이 실제로 쓴 검색어 목록 (로그에 남긴다)
    """
    payload = {
        "model": config.GEN_MODEL,
        "input": items,
        "store": False,                   # 서버에 대화를 남기지 않는다. 필요한 것은 우리가 들고 있다
    }
    if system_prompt:
        payload["instructions"] = system_prompt

    effort = (config.REASONING_EFFORT or "none").strip().lower()
    payload["reasoning"] = {"effort": effort}
    if effort == "none" and _STATE["temperature_ok"]:
        payload["temperature"] = config.TEMPERATURE if temperature is None else temperature

    tools = []
    if web_search:
        tools.append({"type": "web_search"})
    tools.extend(_function_tools(declarations))
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    include = []
    if web_search:
        include.append("web_search_call.action.sources")
    if effort != "none":
        # store=false 에서 추론 항목을 다음 턴에 되돌려 주려면 암호화된 본문이 필요하다
        include.append("reasoning.encrypted_content")
    if include:
        payload["include"] = include

    try:
        data = _post("responses", payload, retries=1)
    except LLMError as exc:
        if "temperature" in payload and "temperature" in str(exc):
            _STATE["temperature_ok"] = False
            payload.pop("temperature", None)
            data = _post("responses", payload, retries=1)
        else:
            raise

    output = data.get("output") or []
    calls, texts, searches = [], [], []
    for item in output:
        kind = item.get("type")
        if kind == "function_call":
            try:
                args = json.loads(item.get("arguments") or "{}")
            except ValueError:
                args = {}
            calls.append({"name": item.get("name", ""),
                          "args": args if isinstance(args, dict) else {},
                          "call_id": item.get("call_id", "")})
        elif kind == "message":
            for part in item.get("content") or []:
                if part.get("type") == "output_text" and part.get("text"):
                    texts.append(part["text"])
        elif kind == "web_search_call":
            query = (item.get("action") or {}).get("query")
            if query and query not in searches:
                searches.append(query)

    if data.get("status") == "incomplete" and not calls and not texts:
        reason = (data.get("incomplete_details") or {}).get("reason", "")
        raise LLMError("응답이 끝나지 않았습니다 (%s)" % reason)

    usage = data.get("usage") or {}
    return {
        "items": output,
        "text": "".join(texts).strip(),
        "calls": calls,
        "tokens": int(usage.get("total_tokens") or 0),
        "searches": searches,
    }
