# agent-lab

AI 에게 도구를 쥐여 주고 일을 맡기는 로컬 웹앱입니다. 화면에서 세 가지를 다룹니다.

- **도구** — 메모 도구 네 개(탐색·저장·삭제·수정)를 AI 가 골라 씁니다. 설명문과 역할 문구를
  화면에서 바로 고칠 수 있습니다. **메모를 지울 수 있는 도구는 `memo_tool_3` 하나뿐이고,
  그 밖의 어떤 길로도 메모는 사라지지 않습니다.**
- **MCP** — 외부 도구 서버를 붙입니다. 내 PC 에서 도는 서버와 원격 HTTP 서버를
  같은 조작으로 연결하고, 통합 목록에 도구마다 소속이 표시됩니다.
  목록에 없는 서버는 **주소를 넣고 [등록]** 하면 됩니다. 먼저 그 서버에 붙어 도구
  목록을 받아 보고, 성공한 것만 목록에 넣고 바로 연결합니다.
- **에이전트** (`run6.bat` 로 켜면 열립니다) — 연구책임자가 연구원 둘에게 일을 맡깁니다.
  세 프로세스가 각각 뜨고, 누가 무엇을 맡기고 무엇을 돌려받는지가 로그에 남습니다.
  연구가 도는 동안에는 위쪽 그래프가 지금 누가 일하는 중이고 무엇이 건너가는지를
  실시간으로 그리고, [중지] 로 다음 위임부터 멈출 수 있습니다. 연구 자료 파일
  (`data/research/`)은 화면에서 올리고 지울 수 있습니다.

파이썬 표준 라이브러리만 씁니다. `pip install` 이 없습니다.

## 실행

```
copy .env.example .env      ← OPENAI_API_KEY 를 넣는다
run.bat                     ← 도구 · MCP 탭
run6.bat                    ← [에이전트] 탭까지 연다
```

브라우저가 `http://127.0.0.1:8770/` 을 엽니다. 에이전트 탭을 켜면 연구원 프로세스가
8771 · 8772 포트에 뜹니다. 창을 닫으면 자식 프로세스까지 정리됩니다.
지난 실행이 남아 있으면 시작할 때 먼저 정리합니다.

## 폴더

```
app.py                      HTTP 서버 · /api/* · 화면 상태
run.bat / run6.bat          run6 은 AGENT_LAB_MULTI=1 을 켠다
mcp_catalog.json            연결할 수 있는 MCP 서버 목록 (화면에서 고른다).
                            열쇠가 필요한 서버는 ${VAR} 자리표시자로 적는다
mcp_config.json             지금 붙어 있는 서버. 처음에는 비어 있다
state/mcp_custom.json       화면에서 주소를 넣어 등록한 서버 (지우면 기본 목록만 남는다)

lab/config.py               모델 · 포트 · 실행 통제 값
lab/llm.py                  OpenAI Responses API 호출 (function calling · 내장 웹 검색)
lab/tools.py                내장 도구 memo_tool_1/2/3/4 (탐색·저장·삭제·수정).
                            메모 파일에 쓰는 통로가 _write 하나뿐이고 거기서 삭제를 막는다
lab/registry.py             내장 도구 + MCP 도구를 한 목록으로. 설명문 덮어쓰기
lab/mcp_client.py           MCP 클라이언트 — stdio 와 Streamable HTTP
lab/runner.py               도구를 쓰는 대화 루프. 결정은 LLM, 실행은 이 파일
lab/roles.py                세 역할의 지시문과 도구 배분
lab/orchestrator.py         자식 프로세스 기동·종료, delegate_* 도구, 위임 로그, 후속 질의 세션
lab/sandbox.py              run_python — 20초 제한, 허용 모듈만, 오류를 그대로 돌려줌
lab/sandbox_guard.py        run_python 자식의 입구. 감사 훅으로 메모 파일 쓰기·삭제를 막는다
lab/datafile.py             read_data_file — data/research 안의 파일만 읽기 전용.
                            화면의 파일 올리기·지우기도 이 폴더 안에서만 동작

agents/_serve.py            연구원 한 명을 HTTP 서버로 띄우는 공통 코드
agents/research_agent.py    자료조사 연구원 (:8771) — MCP 도구 + 웹 검색
agents/experiment_agent.py  실험수행 연구원 (:8772) — run_python + read_data_file

mcp-servers/doc-search/     로컬 stdio 서버. docs/ 의 md 를 doc_list · doc_search 로 찾아 준다
data/notes.json             메모 데이터. 화면의 초기화 버튼이 seed/notes.json 으로 되돌린다
data/research/line_transition.csv   연구 자료 (신규 공정 라인 전환의 사업 가정, 가상)
state/                      화면에서 고친 설명문·역할 문구·데이터 경로, 메모 번호 표시
                            (실행 중 생김)
static/                     index.html · app.js · style.css
```

## 동작 방식

- 메모 도구의 파라미터는 내용을 받는 `text` 와 한 건을 지목하는 `memo_id` 둘뿐입니다.
  설명문은 화면에서 고치면 바로 반영되고 `state/` 에 남습니다. 초기화 버튼이 기본값으로
  되돌립니다.
- 메모마다 번호가 붙습니다. `memo_tool_1` 로 번호를 확인하고 그 번호로 한 건을 지목해
  고치거나(`memo_tool_4`) 지웁니다(`memo_tool_3`). 한 번 쓴 번호는 다시 쓰지 않습니다 —
  지운 번호를 새 메모가 물려받으면 앞서 본 번호가 엉뚱한 메모를 가리키게 됩니다.
- **메모는 `memo_tool_3` 이외의 길로는 지워지지 않습니다.** 규칙이 아니라 코드입니다.
  메모 파일에 쓰는 통로는 `_write()` 하나이고, 거기서 "없어진 메모가 있는가" 를 매번
  확인해 삭제 도구가 아닌 쓰기는 거부합니다. 수정 도구는 내용을 비울 수도 없고,
  삭제 도구조차 한 번에 두 건은 지우지 못합니다. `run_python` 으로 메모 파일을
  덮어쓰거나 지우는 길은 `lab/sandbox_guard.py` 가 막습니다.
  화면의 [초기화] 버튼만은 예외입니다 — 사람이 누르는 버튼이고 AI 는 부를 수 없습니다.
- 메모 데이터 경로도 화면에서 바꿀 수 있습니다. 경로가 잘못되면 도구만 오류를 돌려주고
  앱은 살아 있습니다.
- MCP 열쇠 — 열쇠가 필요한 서버는 설정에 `${TAVILY_API_KEY}` 처럼 이름만 적습니다.
  값은 연결하는 순간 `.env` 에서 읽어 메모리에서만 채우므로 `mcp_catalog.json` 에도
  `mcp_config.json` 에도 열쇠가 남지 않습니다. 값이 없으면 그 서버만 오류를 돌려주고
  나머지는 그대로 씁니다.
- 에이전트 탭 — 역할의 경계는 지시문으로, 도구의 경계는 코드로 나뉩니다. 조사 담당은
  실행 도구를 볼 수 없고 실행 담당은 조사 도구를 볼 수 없습니다. 연구원끼리는 서로를
  부를 수단이 없습니다. 위임은 function call 이라 지시문 원문과 반환값이 로그에 그대로
  찍힙니다. 1차 질문 뒤 후속 질의는 같은 세션에서 이어집니다.
- 진행 그래프 — `/api/research` 는 연구가 끝날 때까지 응답을 쥐고 있으므로, 화면은
  락을 잡지 않는 `/api/research/progress` 를 따로 물어 진행 중인 위임 로그를 그립니다.
  [중지] 도 같은 이유로 락 밖(`/api/research/stop`)에서 받습니다 — 이미 맡겨 둔 일을
  끊지는 못하고, 다음 차례를 시작하지 않는 방식입니다.

## 실행 통제 (`run_python`)

별도 프로세스 · 20초 제한 · 출력 4000자 · 재시도 2회. 메모 파일은 읽기만 됩니다 —
`lab/sandbox_guard.py` 가 `sys.addaudithook` 으로 쓰기·삭제·이름 바꾸기를 거부하고,
다른 프로그램 실행(`os.system` 등)과 `ctypes` 도 함께 막습니다. 허용 모듈은 `lab/config.py` 의
`PY_ALLOWED_IMPORTS` 에 있습니다 (math, random, statistics, csv, json, itertools, collections,
datetime, re, time, heapq, functools, bisect, fractions, decimal, pathlib).

## 모델

생성 `gpt-5.6-luna`, `reasoning.effort = none`, temperature 0. 서버에 대화를 남기지 않습니다(`store: false`).
내장 웹 검색은 `tools` 에 `{"type": "web_search"}` 를 넣어 켭니다. 직접 만든 함수와 같은 요청에 넣을 수 있습니다.
