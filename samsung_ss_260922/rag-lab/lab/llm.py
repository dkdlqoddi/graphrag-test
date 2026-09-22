# -*- coding: utf-8 -*-
"""OpenAI 임베딩·생성 호출.

SDK 를 쓰지 않고 표준 라이브러리로 직접 부른다. 의존성이 줄고, 무엇이 오가는지
코드에서 그대로 보인다. 청크 원문이 외부로 전송되는 지점은 여기 한 곳뿐이다.

생성은 `respond()` 하나로 모은다. `generate()` 는 글자만 돌려주고, 토큰별 로그확률까지
필요한 쪽(LLM 재정렬)이 `respond()` 를 직접 부른다 — Responses API 응답의 생김새를
아는 자리를 한 곳으로 두기 위해서다.
"""

import json
import math
import time
import urllib.error
import urllib.request

from . import config

BASE = "https://api.openai.com/v1"
TIMEOUT = 60

# 토큰별 로그확률은 Responses API 에서 include 로 따로 청해야 실려 온다.
LOGPROBS_INCLUDE = "message.output_text.logprobs"


class LLMError(Exception):
    pass


# 모델이 받지 않는 설정은 한 번 거절당한 뒤로는 보내지 않는다(400 을 매번 한 번씩
# 더 맞을 이유가 없다). temperature 와 top_logprobs 가 모델마다 갈린다.
_STATE = {"temperature_ok": True, "logprobs_ok": True}


def _explain(code, raw):
    """API 오류를 사람이 읽을 수 있는 한 줄로 바꾼다.

    원문 JSON 을 그대로 띄우면 아무도 읽지 않는다. 자주 나오는 것만 골라
    무엇을 하면 되는지까지 적는다. 그 밖의 것은 원문을 짧게 붙인다.
    """
    try:
        msg = json.loads(raw)["error"]["message"]
    except Exception:                          # noqa: BLE001
        msg = raw[:160]
    if code == 401:
        return "API 키가 유효하지 않습니다. .env 파일의 OPENAI_API_KEY 를 확인하세요."
    if code == 403:
        return "이 키로는 호출할 수 없습니다. 발급한 프로젝트와 허용 모델을 확인하세요."
    if code == 429:
        if "quota" in msg.lower() or "billing" in msg.lower():
            return "이 키의 사용 한도(잔액)가 소진되었습니다. 키를 발급한 곳에 문의하세요."
        return "호출 한도에 걸렸습니다. 1~2분 뒤에 다시 시도하세요."
    if code >= 500:
        return "OpenAI 쪽 일시적인 오류입니다(%d). 잠시 뒤 다시 시도하세요." % code
    return "요청이 거절되었습니다(%d) — %s" % (code, msg)


def _post(path, payload, retries=2):
    key = config.api_key()
    if not key:
        raise LLMError("OPENAI_API_KEY 가 없습니다. .env 파일을 확인하세요.")
    url = "%s/%s" % (BASE, path)
    body = json.dumps(payload).encode("utf-8")
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer %s" % key)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            last = LLMError(_explain(e.code, raw))
            # 429(한도)와 5xx 는 잠깐 쉬고 다시
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise last
        except (urllib.error.URLError, OSError) as e:
            # 연결 실패(URLError)와 응답 대기 중 끊김(TimeoutError) 둘 다 여기로 온다.
            last = LLMError("네트워크 실패 — %s" % (getattr(e, "reason", None) or e.__class__.__name__))
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise last
    raise last


def embed_many(texts, on_progress=None):
    """여러 문장 → 여러 벡터. 배치로 나눠 부른다.

    질문과 문서를 같은 모델·같은 설정으로 임베딩한다. 이 모델에는 문서용·질문용 구분이 없다.
    """
    out = []
    total = len(texts)
    for i in range(0, total, config.EMBED_BATCH):
        batch = texts[i:i + config.EMBED_BATCH]
        res = _post("embeddings", {
            "model": config.EMBED_MODEL,
            "input": [t if t.strip() else " " for t in batch],   # 빈 문자열은 거절된다
            "dimensions": config.EMBED_DIM,
            "encoding_format": "float",
        })
        rows = sorted(res["data"], key=lambda d: d["index"])
        out += [d["embedding"] for d in rows]
        if on_progress:
            on_progress(min(i + len(batch), total), total)
    return out


def embed_one(text):
    """문장 하나 → 벡터 하나."""
    return embed_many([text])[0]


def cosine(a, b):
    """코사인 유사도. 거리는 1 - 유사도 이고, 저장소(hnsw:space=cosine)와 같은 기준이다.

    OpenAI 임베딩은 이미 길이 1 로 정규화되어 오지만, 차원을 줄여 받는 설정에서도
    어긋나지 않도록 직접 나눈다.
    """
    dot = na = nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


# 모델이 거절할 수 있는 선택 설정. (거절을 알아볼 이름, 꺼 둘 스위치, 함께 뺄 칸들)
# 로그확률은 top_logprobs 와 include 두 칸이 한 벌이라 뺄 때도 함께 뺀다.
_OPTIONAL = (
    ("temperature", "temperature_ok", ("temperature",)),
    ("top_logprobs", "logprobs_ok", ("top_logprobs", "include")),
    ("include", "logprobs_ok", ("top_logprobs", "include")),
)


def _unsupported(exc, payload):
    """400 이 가리키는, 이 모델이 받지 않는 설정. → payload 에서 뺄 칸 이름들

    한 번 거절당한 설정은 _STATE 에 적어 두고 이후로는 아예 보내지 않는다.
    temperature 로 이미 겪은 일을 top_logprobs 에서 또 겪으므로 한 자리에 묶는다.
    """
    msg = str(exc)
    for name, flag, drop in _OPTIONAL:
        if name in payload and name in msg:
            _STATE[flag] = False
            return drop
    return ()


def _tokens(part):
    """출력 한 토막의 토큰별 로그확률 → 화면이 쓸 수 있는 꼴.

    한 칸이 토큰 하나다. `top` 은 그 자리에서 모델이 저울질한 후보들이고,
    로그확률을 확률로 바꿔 함께 담는다(exp). 모델이 무엇을 얼마나 망설였는지가
    여기에 그대로 남는다 — LLM 재정렬의 Y/N 판정이 이 숫자를 쓴다.
    """
    out = []
    for lp in part.get("logprobs") or []:
        out.append({
            "token": lp.get("token") or "",
            "logprob": lp.get("logprob"),
            "prob": _prob(lp.get("logprob")),
            "top": [{"token": a.get("token") or "",
                     "logprob": a.get("logprob"),
                     "prob": _prob(a.get("logprob"))}
                    for a in (lp.get("top_logprobs") or [])],
        })
    return out


def _prob(logprob):
    """로그확률 → 확률. 없으면 None."""
    if logprob is None:
        return None
    try:
        return math.exp(float(logprob))
    except (TypeError, ValueError, OverflowError):
        return None


def respond(prompt, max_tokens=None, top_logprobs=0):
    """프롬프트 하나 → {"text", "tokens"}. 생성 호출은 전부 여기를 지난다.

    Responses API(Chat Completions 가 아니다) 를 부르고, 응답에서
    `output[] → type=="message" → content[] → type=="output_text"` 만 이어 붙인다.

    `top_logprobs` 를 주면 토큰마다 후보와 로그확률을 함께 받는다(`tokens`).
    모델이 이 설정을 400 으로 거부하면 빼고 다시 보낸다 — 그때 `tokens` 는 빈 칸이
    되고, 부른 쪽이 로그확률 없이도 굴러가게 만들어 두어야 한다.
    """
    payload = {
        "model": config.GEN_MODEL,
        "input": prompt,
        "max_output_tokens": max_tokens or config.GEN_MAX_TOKENS,
        "reasoning": {"effort": "none"},   # 추론 토큰 없이 곧바로 답한다
        "store": False,
    }
    if _STATE["temperature_ok"]:
        payload["temperature"] = 0
    if top_logprobs and _STATE["logprobs_ok"]:
        # top_logprobs 만 보내면 logprobs 가 빈 칸으로 온다. include 로 따로 청해야
        # 실제로 실려 온다(실측). 둘은 한 벌이다.
        payload["top_logprobs"] = top_logprobs
        payload["include"] = [LOGPROBS_INCLUDE]

    while True:
        try:
            res = _post("responses", payload)
            break
        except LLMError as exc:
            drop = _unsupported(exc, payload)
            if not drop:
                raise
            for name in drop:
                payload.pop(name, None)

    texts, tokens = [], []
    for item in res.get("output") or []:
        if item.get("type") != "message":
            continue
        for part in item.get("content") or []:
            if part.get("type") != "output_text":
                continue
            if part.get("text"):
                texts.append(part["text"])
            tokens += _tokens(part)
    text = "".join(texts).strip()
    if not text:
        reason = (res.get("incomplete_details") or {}).get("reason") or res.get("status", "이유 불명")
        raise LLMError("답변이 비어 있습니다 (%s). 다시 시도해 보세요." % reason)
    return {"text": text, "tokens": tokens}


def generate(prompt, max_tokens=None):
    """프롬프트 하나 → 답변 문자열. RAG 의 마지막 단계인 생성에 쓴다."""
    return respond(prompt, max_tokens)["text"]
