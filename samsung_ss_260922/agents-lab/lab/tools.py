# -*- coding: utf-8 -*-
"""이 앱이 AI 에게 건네주는 내장 도구 — 메모 파일 하나를 탐색·저장·수정·삭제한다.

**메모를 지울 수 있는 것은 `memo_tool_3` 하나뿐이다.**

말로만 정해 두면 언젠가 깨진다. 그래서 코드로 막았다. 메모 파일에 쓰는 통로는
`_write()` 하나뿐이고, 거기서 "없어진 메모가 있는가" 를 매번 확인한다. 삭제 도구가
아닌 호출이 메모를 하나라도 잃으면 쓰기 자체가 거부된다 (`MemoDeletionBlocked`).
저장 도구도 수정 도구도 이 검사를 통과할 수 없으므로, 무엇을 시키든 메모를 지우지
못한다. `run_python` 으로 파일을 직접 덮어쓰던 길은 lab/sandbox_guard.py 가 막는다.

메모마다 번호가 붙는다. `memo_tool_1` 로 번호를 확인하고, 그 번호로 한 건을 지목해
고치거나 지운다. 키워드에 걸리는 것을 한꺼번에 지우던 예전 방식은 없앴다 —
"회의" 로 지우면 세 건이 같이 사라졌다.

파라미터 이름은 `text` (내용) 과 `memo_id` (번호) 둘뿐이다.
설명문은 화면에서 고칠 수 있다. 여기 적힌 것은 기본값이며,
화면에서 고친 값은 state/tool_overrides.json 에 저장되어 이 값 위에 덮인다.
"""

import json
import os

from . import config


class MemoDeletionBlocked(RuntimeError):
    """삭제 도구가 아닌 길로 메모가 사라지려 할 때 올린다. 쓰기는 일어나지 않는다."""


# ── 메모 파일 읽고 쓰기 ───────────────────────────────────────────────

def _assign_ids(notes):
    """메모마다 번호를 붙인다. 파일에 이미 있으면 그대로 둔다.

    파일에 없는 번호는 여기서 만드는데, **같은 파일이면 언제 불러도 같은 번호가
    나오도록** 앞에서부터 빈 번호를 차례로 채운다. 탐색으로 본 번호가 수정·삭제할
    때 달라지면 엉뚱한 메모를 건드리게 된다.
    """
    used = set()
    for note in notes:
        value = note.get("id")
        value = value.strip() if isinstance(value, str) else ""
        note["id"] = value if value and value not in used else ""
        if note["id"]:
            used.add(note["id"])

    nxt = 1
    for note in notes:
        if note["id"]:
            continue
        while ("m%d" % nxt) in used:
            nxt += 1
        note["id"] = "m%d" % nxt
        used.add(note["id"])
    return notes


def _seq_read():
    """지금까지 쓴 가장 큰 번호. 읽지 못하면 0 으로 본다 (파일 안 번호로 보정된다)."""
    try:
        with open(config.NOTES_SEQ_PATH, "r", encoding="utf-8") as f:
            return int(f.read().strip() or 0)
    except (OSError, ValueError):
        return 0


def _seq_write(value):
    try:
        os.makedirs(config.STATE_DIR, exist_ok=True)
        with open(config.NOTES_SEQ_PATH, "w", encoding="utf-8") as f:
            f.write("%d\n" % value)
    except OSError:
        pass            # 표시를 못 남겨도 메모 저장 자체는 되어야 한다


def _take_id(notes):
    """새 메모에 붙일 번호를 하나 꺼낸다. 한 번 쓴 번호는 다시 쓰지 않는다.

    지운 메모의 번호를 새 메모가 물려받으면, 앞서 탐색 결과를 들고 있던 쪽이
    엉뚱한 메모를 지목하게 된다. 그런데 지운 흔적은 메모 파일에 남지 않으므로
    "여기까지 썼다" 는 표시를 state/notes_seq.txt 에 따로 둔다.
    파일 안의 가장 큰 번호와 견줘 큰 쪽을 쓰므로, 표시가 없어져도 겹치지는 않는다.
    """
    top = 0
    for note in notes:
        value = note.get("id") or ""
        if value.startswith("m") and value[1:].isdigit():
            top = max(top, int(value[1:]))
    top = max(top, _seq_read()) + 1
    _seq_write(top)              # 저장이 뒤에서 실패해 번호를 건너뛰어도 문제는 없다
    return "m%d" % top


def _load():
    path = config.notes_path()
    if not os.path.exists(path):
        raise IOError("메모 파일을 찾을 수 없습니다: %s" % path)
    with open(path, "r", encoding="utf-8") as f:
        notes = json.load(f)
    if not isinstance(notes, list):
        raise IOError("메모 파일의 형식이 올바르지 않습니다: %s" % path)
    if not all(isinstance(n, dict) for n in notes):
        # 조용히 걸러 내면 다음 쓰기에서 그 항목이 사라진다. 여기서 멈춘다.
        raise IOError("메모 파일에 메모가 아닌 항목이 있습니다: %s" % path)
    return _assign_ids(notes)


def _save(notes):
    path = config.notes_path()
    directory = os.path.dirname(path)
    if directory and not os.path.isdir(directory):
        raise IOError("저장할 폴더가 없습니다: %s" % directory)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _write(notes, previous, deleting=None):
    """메모 파일에 쓰는 유일한 통로. 도구는 모두 여기를 지난다.

    `previous` 는 바로 앞에서 파일에서 읽은 목록이다. 그 번호들이 그대로 남아 있는지
    확인하고, 하나라도 없어졌으면 쓰지 않고 거부한다.

    `deleting` 은 삭제 도구만 넘긴다. 지목한 번호 **딱 하나**가 없어진 경우에만
    통과시키므로, 삭제 도구도 한 번에 여러 건을 지우지 못한다.
    """
    kept = set(n.get("id") for n in notes)
    lost = [n.get("id") for n in previous if n.get("id") not in kept]

    if deleting is None:
        if lost:
            raise MemoDeletionBlocked(
                "이 도구는 메모를 지울 수 없습니다. 지우려면 memo_tool_3 을 씁니다. "
                "없어질 뻔한 메모: %s" % ", ".join(lost))
    elif lost != [deleting]:
        raise MemoDeletionBlocked(
            "삭제 도구는 지목한 메모 한 건만 지웁니다. 지우려던 번호 %s, "
            "없어질 뻔한 메모: %s" % (deleting, ", ".join(lost) or "없음"))

    _save(notes)


def _matches(note, text):
    """낱말 단위 일치. "회의 메모" 처럼 두 낱말이 와도 "회의" 가 든 메모가 잡힌다.

    부분 문자열 일치("회의 메모" in "주간 회의 정리")로 두면 0건이 된다.
    """
    words = (text or "").split()
    if not words:
        return True
    hay = note.get("title", "") + " " + note.get("body", "")
    return any(w in hay for w in words)


def _title_of(body):
    return body.split("\n")[0][:30]


def read_notes():
    """화면에 메모 목록을 보여주기 위한 것. AI 에게 주는 도구가 아니다."""
    try:
        return _load()
    except (IOError, ValueError):
        return []


def reset_notes():
    """seed 원본으로 되돌린다. 화면의 초기화 버튼이 부른다.

    **도구가 아니라 사람이 누르는 버튼이다.** 메모가 줄어드는 일을 코드가 허용하는
    유일한 자리라서 `_write()` 를 거치지 않는다. AI 는 이 함수를 부를 수단이 없다.
    """
    with open(config.SEED_NOTES_PATH, "r", encoding="utf-8") as f:
        seed = json.load(f)
    os.makedirs(os.path.dirname(config.NOTES_PATH), exist_ok=True)
    with open(config.NOTES_PATH, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=2)
        f.write("\n")
    if os.path.exists(config.DATA_PATH_OVERRIDE):
        os.remove(config.DATA_PATH_OVERRIDE)
    return len(seed)


# ── 도구 함수 ─────────────────────────────────────────────────────────

def note_search(text=""):
    """탐색. 번호를 함께 돌려주어야 수정·삭제가 한 건을 지목할 수 있다."""
    notes = _load()
    key = (text or "").strip()
    exact = [n for n in notes if n["id"] == key]
    found = exact if exact else [n for n in notes if _matches(n, text)]
    return {
        "찾은 메모": [{"번호": n["id"], "제목": n.get("title", ""),
                    "내용": n.get("body", ""), "날짜": n.get("date", "")} for n in found],
        "찾은 건수": len(found),
        "전체 건수": len(notes),
    }


def note_save(text=""):
    """저장. 뒤에 붙이기만 한다. 기존 메모는 손대지 않는다."""
    body = (text or "").strip()
    if not body:
        return {"오류": "저장할 내용이 비어 있습니다."}
    notes = _load()
    previous = list(notes)
    new = {"id": _take_id(notes), "title": _title_of(body), "body": body, "date": ""}
    notes.append(new)
    _write(notes, previous)
    return {"저장한 번호": new["id"], "저장한 제목": new["title"], "전체 건수": len(notes)}


def note_update(memo_id="", text=""):
    """수정. 번호로 지목한 한 건의 내용을 갈아 끼운다. 메모가 없어지지는 않는다."""
    key = (memo_id or "").strip()
    body = (text or "").strip()
    if not key:
        return {"오류": "고칠 메모의 번호가 없습니다. memo_tool_1 로 번호를 먼저 확인하세요."}
    if not body:
        # 내용을 비워 메모를 사실상 없애는 길을 막는다. 지우려면 memo_tool_3 을 쓴다.
        return {"오류": "새 내용이 비어 있습니다. 내용을 비워서 메모를 없앨 수는 없습니다."}

    notes = _load()
    previous = list(notes)
    at = next((i for i, n in enumerate(notes) if n["id"] == key), None)
    if at is None:
        return {"오류": "그런 번호의 메모가 없습니다: %s" % key,
                "쓸 수 있는 번호": [n["id"] for n in notes]}

    old = notes[at]
    notes[at] = {"id": old["id"], "title": _title_of(body), "body": body,
                 "date": old.get("date", "")}
    _write(notes, previous)
    return {"고친 번호": key, "이전 제목": old.get("title", ""),
            "새 제목": notes[at]["title"], "전체 건수": len(notes)}


def note_delete(memo_id=""):
    """삭제. 메모가 줄어드는 유일한 도구이고, 한 번에 한 건만 지운다."""
    key = (memo_id or "").strip()
    if not key:
        return {"오류": "지울 메모의 번호가 없습니다. memo_tool_1 로 번호를 먼저 확인하세요."}

    notes = _load()
    previous = list(notes)
    target = next((n for n in notes if n["id"] == key), None)
    if target is None:
        return {"오류": "그런 번호의 메모가 없습니다: %s" % key,
                "쓸 수 있는 번호": [n["id"] for n in notes]}

    kept = [n for n in notes if n["id"] != key]
    _write(kept, previous, deleting=key)
    return {"지운 번호": key, "지운 제목": target.get("title", ""), "남은 건수": len(kept)}


# ── 도구 목록 ─────────────────────────────────────────────────────────
# 내용을 받는 것은 `text`, 한 건을 지목하는 것은 `memo_id` 로 통일했다.

_TEXT_PARAM = {
    "type": "object",
    "properties": {"text": {"type": "string", "description": "입력 문자열"}},
    "required": ["text"],
}

_ID_PARAM = {
    "type": "object",
    "properties": {"memo_id": {"type": "string",
                               "description": "메모 번호. memo_tool_1 이 알려 준다"}},
    "required": ["memo_id"],
}

_ID_TEXT_PARAM = {
    "type": "object",
    "properties": {
        "memo_id": {"type": "string", "description": "고칠 메모의 번호. memo_tool_1 이 알려 준다"},
        "text": {"type": "string", "description": "메모에 새로 넣을 내용. 비울 수 없다"},
    },
    "required": ["memo_id", "text"],
}

TOOLS = [
    {
        "name": "memo_tool_1",
        "description": ("저장된 메모를 탐색한다. 키워드를 주면 그 낱말이 든 메모만, "
                        "비워 두면 전체를 보여준다. 메모마다 번호가 함께 나온다. "
                        "메모를 고치거나 지우려면 이 도구로 번호를 먼저 확인한다."),
        "parameters": _TEXT_PARAM,
        "function": note_search,
    },
    {
        "name": "memo_tool_2",
        "description": "새 메모를 저장한다. 기존 메모는 건드리지 않는다.",
        "parameters": _TEXT_PARAM,
        "function": note_save,
    },
    {
        "name": "memo_tool_3",
        "description": ("번호로 지목한 메모 한 건을 삭제한다. 되돌릴 수 없다. "
                        "메모를 지울 수 있는 도구는 이것뿐이고, 한 번에 한 건만 지운다. "
                        "번호는 memo_tool_1 로 먼저 확인한다."),
        "parameters": _ID_PARAM,
        "function": note_delete,
    },
    {
        "name": "memo_tool_4",
        "description": ("번호로 지목한 메모 한 건의 내용을 고쳐 쓴다. 메모가 없어지지는 않으며, "
                        "내용을 비울 수도 없다. 번호는 memo_tool_1 로 먼저 확인한다."),
        "parameters": _ID_TEXT_PARAM,
        "function": note_update,
    },
]
