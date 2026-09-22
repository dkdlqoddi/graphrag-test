# -*- coding: utf-8 -*-
"""앱 전역 설정과 경로.

.env 에서 OPENAI_API_KEY 를 읽는다. 키 값은 화면·로그·오류 메시지 어디에도 쓰지 않는다.
"""

import os

# ── 경로 ──────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(ROOT, "data")
NOTES_PATH = os.path.join(DATA_DIR, "notes.json")
SEED_NOTES_PATH = os.path.join(DATA_DIR, "seed", "notes.json")

# 연구 자료. 메모 파일과 폴더를 나눈다 —
# 한 폴더에 두면 실험 담당이 notes.json 까지 열어 보느라 로그가 지저분해진다.
RESEARCH_DIR = os.path.join(DATA_DIR, "research")

STATE_DIR = os.path.join(ROOT, "state")
TOOL_OVERRIDES_PATH = os.path.join(STATE_DIR, "tool_overrides.json")
# 메모 번호를 어디까지 썼는지. 지운 번호를 새 메모가 물려받지 않게 하는 데 쓴다
NOTES_SEQ_PATH = os.path.join(STATE_DIR, "notes_seq.txt")
SYSTEM_PROMPT_PATH = os.path.join(STATE_DIR, "system_prompt.txt")
DATA_PATH_OVERRIDE = os.path.join(STATE_DIR, "data_path.txt")
# 화면에서 주소를 넣어 등록한 MCP 서버. mcp_catalog.json 은 손대지 않고 여기에만 쌓는다
MCP_CUSTOM_PATH = os.path.join(STATE_DIR, "mcp_custom.json")


def notes_path():
    """메모 파일 경로. 화면에서 바꿀 수 있다.

    경로가 잘못되어도 앱이 죽지 않고 도구만 오류를 돌려주어야 한다.
    """
    if os.path.exists(DATA_PATH_OVERRIDE):
        try:
            with open(DATA_PATH_OVERRIDE, "r", encoding="utf-8") as f:
                value = f.read().strip()
            if value:
                return value
        except OSError:
            pass
    return NOTES_PATH

MCP_CONFIG_PATH = os.path.join(ROOT, "mcp_config.json")
AGENTS_DIR = os.path.join(ROOT, "agents")

# ── OpenAI ────────────────────────────────────────────────────────────
GEN_MODEL = "gpt-5.6-luna"
REASONING_EFFORT = "none"                # 추론 토큰을 쓰지 않는다. 빠르고 temperature 를 받는다
TEMPERATURE = 0.0
MAX_TOOL_STEPS = 6                       # 한 요청에서 도구 호출을 반복할 최대 횟수
ORCH_MAX_STEPS = 10                      # 연구책임자는 여러 번 위임하므로 더 준다
AGENT_MAX_STEPS = 10                     # 연구원은 자료를 읽고 코드를 고쳐 가며 쓴다.
                                         # 6 이면 파일 읽기 몇 번에 소진된다

# ── 서버 ──────────────────────────────────────────────────────────────
HOST = "127.0.0.1"
PORT = 8770                              # rag-lab(8765) · tool-lab(8766) 과 겹치지 않게
RESEARCH_PORT = 8771
EXPERIMENT_PORT = 8772

# ── run_python 실행 통제 ──────────────────────────────────────────────
PY_TIMEOUT = 20                          # 초. 무한 루프를 끊는다. 10초로는 시행 수가 큰 코드가 자주 끊겼다
PY_MAX_OUTPUT = 4000                     # 표준 출력 길이 상한
PY_RETRIES = 2                           # 실패 시 에이전트가 고쳐 다시 시도할 횟수
PY_ALLOWED_IMPORTS = (
    "math", "random", "statistics", "csv", "json",
    "itertools", "collections", "datetime", "re",
    "time", "heapq", "functools", "bisect", "fractions", "decimal",
    # 모델이 파일을 읽을 때 pathlib 를 먼저 쓰는 일이 잦다. 막으면 한 번씩 헛돈다 (open 은 어차피 열려 있다).
    "pathlib",
)


def multi_enabled():
    """[에이전트] 탭 노출 여부. run6.bat 이 환경 변수로 켠다 (기본 꺼짐)."""
    return os.environ.get("AGENT_LAB_MULTI", "").strip() in ("1", "on", "ON", "true", "TRUE")


def load_env():
    """앱 폴더의 .env 를 읽어 os.environ 에 넣는다 (이미 있는 값은 유지)."""
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def api_key():
    """OPENAI_API_KEY 를 반환한다. 없으면 예외. 값은 절대 밖으로 내보내지 않는다."""
    load_env()
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("NO_API_KEY")
    return key
