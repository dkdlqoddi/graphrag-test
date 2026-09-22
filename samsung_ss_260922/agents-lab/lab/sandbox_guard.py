# -*- coding: utf-8 -*-
"""run_python 자식 프로세스의 입구.

`lab/sandbox.py` 는 모델이 만든 임시 파일을 직접 실행하지 않고 이 파일을 거쳐
실행한다. 이 파일은 먼저 **메모 파일을 쓰거나 지우는 길을 막고**, 그다음 사용자
코드를 돌린다.

왜 필요한가 — 자식 안에서는 `open()` 이 그대로 열려 있고, `__import__("os")` 로
`lab/sandbox.py` 의 import 검사를 비껴갈 수도 있다. 그러면 `data/notes.json` 을
통째로 덮어써서 메모를 없앨 수 있다. 메모를 지우는 길은 memo_tool_3 하나여야 하므로
여기서 막는다.

어떻게 막는가 — `sys.addaudithook` 은 파이썬이 파일을 열기 **직전**에 걸린다.
`open` 이든 `os.open` 이든 `pathlib` 이든 결국 이 지점을 지나므로 우회로가 없고,
한 번 건 훅은 떼어 낼 수 없다.

읽기는 막지 않는다. 쓰기·삭제·이름 바꾸기만 거부한다. 보호할 파일은
`AGENT_LAB_PROTECTED` 에 `os.pathsep` 으로 이어서 받는다.

사용자 코드는 `runpy` 로 돌린다. 오류의 파일 이름과 줄 번호가 그대로 남아야
에이전트가 코드를 고쳐 다시 시도할 수 있다.
"""

import os
import runpy
import sys

MESSAGE = ("메모 파일은 run_python 으로 바꿀 수 없습니다. "
           "메모를 고치거나 지우는 일은 메모 도구로만 합니다.")
NO_SPAWN = "run_python 안에서는 다른 프로그램을 실행할 수 없습니다."
NO_CTYPES = "ctypes 는 쓸 수 없습니다."

WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
REMOVE_EVENTS = ("os.remove", "os.unlink", "os.rmdir", "os.truncate")
MOVE_EVENTS = ("os.rename", "os.replace", "os.link", "os.symlink",
               "shutil.copyfile", "shutil.copymode", "shutil.move")
# 다른 프로그램을 띄우면 파일 보호를 우회할 수 있다 (예: del data\notes.json).
SPAWN_EVENTS = ("os.system", "os.exec", "os.spawn", "os.startfile", "subprocess.Popen")
# ctypes 는 파이썬을 거치지 않고 C 함수를 부를 수 있어 훅이 걸리지 않는다.
DENIED_IMPORTS = ("ctypes", "_ctypes")


def _text(path):
    """감사 훅에 오는 경로는 str · bytes · PathLike · 파일 번호(int) 중 하나다."""
    if isinstance(path, str):
        return path
    if isinstance(path, bytes):
        try:
            return os.fsdecode(path)
        except (UnicodeDecodeError, ValueError):
            return None
    if hasattr(path, "__fspath__"):
        try:
            return _text(path.__fspath__())
        except (TypeError, ValueError, OSError):
            return None
    return None


def _key(path):
    """견줄 수 있는 한 가지 모양으로 만든다. 대소문자·바로가기·상대경로를 흡수한다."""
    text = _text(path)
    if text is None:
        return None
    try:
        return os.path.normcase(os.path.realpath(text))
    except (OSError, ValueError):
        return None


def _collect():
    keys, names = set(), set()
    for item in os.environ.get("AGENT_LAB_PROTECTED", "").split(os.pathsep):
        item = item.strip()
        if not item:
            continue
        key = _key(item)
        if key:
            keys.add(key)
            names.add(os.path.basename(key))
    return keys, names


GUARDED, NAMES = _collect()


def _guarded(path):
    text = _text(path)
    if text is None:
        # 이름을 읽지 못했다면 (파일 번호 등) 막지 않는다. 쓰기용 파일 번호를 얻으려면
        # 먼저 쓰기로 열어야 하는데, 그 길은 이미 이 훅이 막고 있다.
        return False
    # realpath 는 파일마다 디스크를 건드린다. 이름부터 보고 아니면 거기서 끝낸다.
    if os.path.normcase(os.path.basename(text)) not in NAMES:
        return False
    key = _key(text)
    return key is not None and key in GUARDED


def _writes(mode, flags):
    if isinstance(mode, str):
        return any(c in mode for c in "wax+")
    if isinstance(flags, int) and flags:
        return bool(flags & WRITE_FLAGS)
    return True                     # 무엇인지 모르면 막는 쪽으로 둔다


def hook(event, args):
    if event == "open":
        path = args[0] if args else None
        mode = args[1] if len(args) > 1 else None
        flags = args[2] if len(args) > 2 else 0
        if _writes(mode, flags) and _guarded(path):
            raise PermissionError(MESSAGE)
    elif event in REMOVE_EVENTS:
        if args and _guarded(args[0]):
            raise PermissionError(MESSAGE)
    elif event in MOVE_EVENTS:
        for path in args[:2]:
            if _guarded(path):
                raise PermissionError(MESSAGE)
    elif event in SPAWN_EVENTS:
        raise PermissionError(NO_SPAWN)
    elif event == "import":
        name = args[0] if args else ""
        if isinstance(name, str) and name.split(".")[0] in DENIED_IMPORTS:
            raise PermissionError(NO_CTYPES)


def main():
    sys.addaudithook(hook)          # 사용자 코드보다 먼저. 한 번 걸면 못 뗀다
    if len(sys.argv) < 2:
        raise SystemExit("실행할 파일이 없습니다.")
    target = sys.argv[1]
    # 사용자 코드가 보기에 자기가 직접 실행된 것과 같아야 한다.
    sys.argv = [target]
    sys.path[0] = os.path.dirname(os.path.abspath(target))
    runpy.run_path(target, run_name="__main__")


if __name__ == "__main__":
    main()
