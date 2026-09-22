# rag-lab

PDF 문서를 넣고 물어보는 naive RAG 앱입니다. PDF 에서 글자를 뽑아 조각(청크)으로
자르고, 벡터로 바꿔 저장한 뒤, 질문과 가까운 조각을 꺼내 그 조각만 근거로 답을
만듭니다. 각 단계가 화면에 그대로 보이도록 만들었습니다.

## 실행

```
copy .env.example .env      ← OPENAI_API_KEY 를 넣는다
pip install -r requirements.txt
run.bat                     ← 또는 python app.py
```

브라우저가 `http://127.0.0.1:8765/` 를 엽니다. 시작할 때 `chromadb` · `pypdf` · 키 세 가지를
확인하고, 빠진 것이 있으면 무엇을 설치할지 알려 준 뒤 멈춥니다.

## 화면

네 구획이 왼쪽에서 오른쪽으로 이어지고, 각 구획은 앞 구획의 산출물을 받습니다.

1. **문서** — PDF 를 올리면 페이지별로 뽑아낸 글자 수가 막대로 보입니다. 막대를 누르면
   그 페이지의 원문을 펼쳐 볼 수 있습니다.
2. **청킹** — 자르는 기준 네 가지(고정 길이 · 구조 경계 · 문단 · 의미 경계)와 조각 크기를 고르면
   조각이 카드로 나옵니다. **의미 경계**는 문장을 하나씩 벡터로 바꿔 이웃 문장 사이의 거리를 재고,
   거리가 **상위 N%**(화면에서 조절, 기본 10%) 인 자리에서 자릅니다. 경계마다 막대 하나로 거리를
   그려 주고 점선이 임계 거리라, 상위 %를 바꾸면 자르는 자리가 어떻게 움직이는지 보입니다.
   문장 임베딩은 문서마다 한 번만 부르고 그 뒤로는 다시 쓰므로 %만 바꿔 다시 자르는 것은 즉시입니다.
3. **임베딩·적재** — 조각을 `text-embedding-3-small`(1536차원) 으로 벡터화해 ChromaDB 에 넣습니다.
   검색 결과에 출처를 표시할 수 있도록 조각마다 문서명 · 청크 번호 · 페이지 · 전략을 함께 저장합니다.
4. **검색** — 같은 질문을 **두 방식으로 돌려 좌우로 나란히** 보여 줍니다.
   [HyDE] 를 켜면 검색 **전에** 모델이 "문서에 이렇게 쓰여 있었을 것"이라는 가상 답변을 쓰고,
   질문 대신 **그 글을 임베딩해** 찾습니다(왼쪽 열만). 가상 답변은 화면에 추측이라고 밝혀
   보여 주고, 답변의 근거로 쓰거나 저장하지 않습니다.
   [답변을 근거로 저장] 을 켜면 만든 답변을 임베딩해 저장소에 넣어 다음 검색부터 근거로 씁니다.
   저장된 글은 결과에서 [생성] 으로 표시되고, [생성 근거 포함] 으로 빼거나 ③ 탭의
   [생성 근거만 비우기] 로 되돌릴 수 있습니다.
   [질의 재작성] 을 켜면 검색 **전에** `gpt-5.6-luna` 가 질문을 검색용 한 줄로 다듬습니다
   (필요하면 영문 용어를 병기하고, 없는 조건·수치·답은 넣지 않습니다). **검색에는 바뀐 질의를,
   답변에는 원래 질문을 씁니다.** 원래 질문·실제 검색 질의·적용 여부를 화면에 적고,
   실패하거나 규칙을 어기면 그 사실을 알린 뒤 원문으로 검색합니다.
   [LLM 재정렬] 을 켜면 검색 **뒤에** 꺼낸 조각을 모델에게 **한 장씩** 보여 주고 `Y 0.92` 한 줄로
   판정받아 다시 줄을 세웁니다(두 열 각각). 이때 검색은 K 개가 아니라 **후보를 넉넉히** 꺼내 오고
   판정이 그중 K 개를 고르므로, 원래 순위로는 화면에 못 오던 조각이 올라오고 밀려난 조각은 표에
   회색 줄로 남습니다. 순서를 정하는 값은 첫 글자(Y/N)가 나온 자리의 **로그확률**입니다 —
   `P(Y) = p(Y) / (p(Y) + p(N) + r)`. 모델이 적은 확률은 0.9·0.95 몇 값에 뭉쳐 줄을 세우기
   어렵지만 로그확률은 촘촘합니다. 화면에는 **모델이 적은 한 줄 · Y/N 판정 · 첫 토큰의 로그확률과
   후보 · P(Y) 셈 · 재정렬 전후 순위**를 모두 적습니다.
   - **왼쪽 · 의미 검색** — 질문을 같은 모델로 임베딩해 가까운 순으로 K 개를 꺼냅니다.
     조각마다 거리와 유사도를 적고, [근거 하이라이트] 를 켜면 조각을 문장으로 다시 쪼개
     질문과 가까운 문장을 칠합니다(임베딩만 씁니다).
   - **오른쪽 · BM25** — 같은 저장소를 낱말로 훑습니다. 외부 호출이 없고, 어느 낱말이 몇 번
     나와 점수에 얼마나 보탰는지와 본문에서 맞은 낱말을 함께 보여 줍니다.

   둘을 섞지 않습니다. 같은 질문에도 순위가 뒤집히고, 한쪽만 찾아내는 조각이 생기는 것이
   이 화면에서 보려는 것입니다. [답변 생성] 을 켜면 **양쪽 근거로 각각 한 번씩** 답을 만들어
   나란히 놓습니다(생성 2회).

## MCP

같은 기능을 **MCP(Model Context Protocol) 서버**로도 엽니다. 브라우저 대신 AI 클라이언트
(Claude Code 등)가 도구를 직접 부릅니다. 화면과 같은 `lab/*` 모듈을 쓰고, 검색은 같은
`lab/pipeline.py` 를 지납니다 — 창구가 둘일 뿐 하는 일은 하나입니다.

```
python mcp_server.py            http://127.0.0.1:8000/mcp 로 연다 (기본)
python mcp_server.py --stdio    stdin/stdout 으로 연다
run_mcp.bat                     위의 기본과 같다
```

### 전송 두 가지

| | HTTP (기본) | stdio |
|---|---|---|
| 주소 | `http://127.0.0.1:8000/mcp` | 없음 |
| 누가 띄우나 | **사람이 먼저 띄운다** | 클라이언트가 프로세스를 띄운다 |
| 서버 로그 | 이 창에 요청이 한 줄씩 찍힌다 | 클라이언트의 서버 로그로 간다 |
| 여러 클라이언트 | 같은 서버에 함께 붙는다 | 클라이언트마다 프로세스 하나 |

실습에서는 **무엇이 오갔는지가 창에 보이는** HTTP 쪽이 낫습니다. 그래서 기본으로 두었습니다.
말(JSON-RPC)은 두 전송이 똑같이 `lab/mcp_proto.py` 의 `dispatch()` 를 지나므로 어느 쪽으로
붙어도 같은 답이 나옵니다.

Claude Code 라면 이렇게 등록합니다(`.mcp.json` 이 그 결과입니다):

```
claude mcp add --transport http rag-lab http://127.0.0.1:8000/mcp -s project
```

손으로 확인하려면:

```
curl -H "Content-Type: application/json" -H "Accept: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://127.0.0.1:8000/mcp

echo {"jsonrpc":"2.0","id":1,"method":"tools/list"} | python mcp_server.py --stdio
```

### HTTP 에서 여는 것 / 열지 않는 것

`POST /mcp` 하나로 말을 주고받습니다. 응답은 `application/json` 한 덩이로 돌려주고,
답할 것이 없으면(알림뿐이면) `202 Accepted` 에 빈 본문입니다.

- `GET /mcp` → **405**. 서버가 먼저 말을 거는 SSE 통로는 열지 않습니다. 진행 상황은 서버
  창(stderr)에 적히는 편이 실습에서 낫고, 오래 걸리는 도구도 클라이언트가 기다리면 됩니다.
- `DELETE /mcp` → **405**. 세션(`Mcp-Session-Id`)을 만들지 않으므로 끊을 것도 없습니다.
  STATE 가 모듈 전역이라 접속마다 따로 들고 있을 것이 없기 때문입니다 — 세션 id 만 나눠 주고
  상태는 공유하면 나뉜 척하는 거짓말이 됩니다.
- 브라우저가 붙인 `Origin` 이 localhost 가 아니면 **403**. 로컬에 열린 서버는 아무 웹페이지나
  브라우저를 시켜 두드릴 수 있습니다(DNS 리바인딩). `Origin` 이 없는 요청은 그대로 받습니다.

### 도구 12개

| 단계 | 도구 | 하는 일 |
|---|---|---|
| ① | `list_pdfs` | `data/` 의 PDF 와 이미 적재된 문서 |
| ① | `parse_pdf` | PDF → 글자. 글자가 거의 없는 페이지를 짚어 준다 |
| ① | `read_page` | 한 페이지 원문 |
| ② | `chunk` | `fixed` · `structure` · `paragraph` · `semantic` 으로 자른다 |
| ② | `show_chunks` | 잘라 둔 조각의 전문 |
| ③ | `embed_and_store` | 임베딩해 Chroma 에 적재 |
| ③ | `store_status` | 적재 현황과 생성분 건수 |
| ③ | `peek_vector` | 청크 하나의 벡터 앞부분 |
| ③ | `clear_generated` | 모델이 쓴 근거만 삭제 |
| ③ | `reset_store` | 저장소 비우기 (`confirm=true` 필요) |
| ④ | `search` | 의미 검색과 BM25 를 나란히. 스위치 7개 |
| — | `show_config` | 모델·차원·한계값과 지금 상태 |

`search` 의 스위치는 `/api/search` 와 같습니다 — `k` · `rewrite` · `hyde` · `rerank` ·
`highlight`(기본 켬) · `answer` · `save_answer` · `include_generated`. 전부 기본 꺼짐이므로
끄고 한 번, 켜고 한 번 불러 견주는 쓰임을 의도했습니다.

### 화면과 다른 점

- **결과가 JSON 이 아니라 한국어 설명문입니다.** 화면에서는 브라우저가 카드·막대·하이라이트로
  그리던 것을 여기서는 글로 적습니다 — 모델이 읽는 것이 곧 화면이기 때문입니다. 유사도 옆에
  왜 그 조각이 뽑혔는지를, BM25 가 0건이면 그것이 왜 버그가 아닌지를 함께 적습니다.
- **본문은 잘라 싣습니다**(`config.MCP_SNIPPET_CHARS`). 화면은 스크롤하면 그만이지만 여기서는
  청크 원문이 그대로 모델의 문맥을 차지합니다. 전문은 `show_chunks` 로 따로 청합니다.
- **상태를 공유하지 않습니다.** `app.py` 로 띄운 화면과 MCP 서버는 서로 다른 프로세스라
  파싱·청킹 결과가 오가지 않습니다. 함께 보는 것은 `chroma_db/` 저장소뿐입니다.
- **stdout 은 프로토콜 전용입니다.** 진행 로그는 전부 stderr 로 갑니다(클라이언트의 서버 로그).

## 폴더

```
app.py              화면 시작점. 의존성·키 확인 뒤 서버를 띄운다
mcp_server.py       MCP 시작점. 도구 12개를 HTTP(기본) 또는 stdio 로 연다
run.bat             더블클릭 실행 (UTF-8 콘솔, py/python 자동 탐색)
run_mcp.bat         MCP 서버 실행 — http://127.0.0.1:8000/mcp
.mcp.json           MCP 클라이언트 등록 정보 (HTTP 주소)
requirements.txt    chromadb, pypdf
lab/config.py       모델·포트·청킹 기본값
lab/parsing.py      PDF → 글자 (pypdf)
lab/chunking.py     fixed / structure / paragraph / semantic + 문장 쪼개기
lab/llm.py          임베딩·생성 HTTP 호출 (SDK 없음). 원문이 밖으로 나가는 유일한 지점
lab/store.py        ChromaDB 적재·검색
lab/bm25.py         낱말 검색 (표준 라이브러리만, 외부 호출 없음)
lab/evidence.py     뽑힌 조각 안에서 근거 문장 찾기 (임베딩 거리만 사용)
lab/rewrite.py      질문 → 검색용 질의 (선택, 실패해도 원문으로 계속)
lab/hyde.py         가상 답변을 써서 그 글로 검색 (선택, 저장하지 않음)
lab/rerank.py       꺼낸 조각을 LLM 이 Y/N 으로 판정해 재정렬 (선택, 로그확률로 줄 세움)
lab/answer.py       꺼낸 조각으로 답 생성
lab/pipeline.py     검색 한 번이 지나는 길. 화면과 MCP 가 함께 쓴다
lab/web.py          로컬 HTTP 서버와 /api/*
lab/mcp_proto.py    MCP 의 말 (JSON-RPC 2.0, 직접 구현) + stdio 전송
lab/mcp_http.py     MCP 의 HTTP 전송 (POST /mcp)
lab/mcp_tools.py    MCP 도구 12개와 결과를 설명하는 글
static/             index.html · app.js · style.css
data/               올린 PDF 가 놓이는 곳
chroma_db/          적재 결과 (실행 중 생김)
```

## API

`GET /api/status` · `/api/document` · `/api/chunks`
`POST /api/upload` · `/api/chunk` · `/api/embed` · `/api/search` · `/api/vector` · `/api/reset` · `/api/clear-generated`

`/api/chunk` 는 `{strategy, size, percentile}` 을 받습니다. `percentile` 은 의미 경계 전략에서만
쓰이고, 같은 문서라면 문장 임베딩을 다시 부르지 않습니다.

`POST /api/clear-generated` 는 저장된 생성 근거만 지웁니다(문서 조각은 그대로).

`/api/search` 는 `{query, k, rewrite, hyde, rerank, highlight, answer, save_answer, include_generated}` 를 받고
`{results: {semantic: {...}, bm25: {...}}}` 를 돌려줍니다 — 두 검색이 같은 모양으로 담깁니다. `highlight`(기본 켬)는 근거 문장
계산을, `answer`(기본 끔)는 답변 생성을, `rerank`(기본 끔)는 LLM 재정렬을 켭니다. 재정렬을 켜면
열마다 `rerank: {applied, pool, calls, rows, ...}` 가 함께 오고 `rows` 에 전후 순위가(밀려난 후보까지)
담깁니다. 조각 하나당 판정 호출이 한 번씩 나가므로 두 열이면 `pool × 2` 회입니다.

파싱·청킹 결과는 메모리에만 있고 서버를 끄면 사라집니다. 적재된 것만 `chroma_db/` 에 남습니다.
