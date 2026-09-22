# GraphRAG Library

PDF를 챕터/문단 단위 Markdown으로 변환하고, OpenAI로 키워드를 추출해 문서들을 지식 그래프로 연결한 뒤,
Three.js 3D 도서관과 3D Knowledge Map에서 검색할 수 있는 Next.js 앱입니다.

## 실행

```bash
npm install
# .env 에 OPENAI_API_KEY 를 넣습니다 (.env.example 참고)
npm run dev
```

- `/` 3D 도서관: 검색어/프롬프트를 입력하면 사서가 분류 서가로 가서 책을 찾아 데스크에서 펼쳐 보여줍니다.
- `/map` 3D Knowledge Map: 문서·챕터·키워드 노드와 연결 관계.
- `/upload` PDF 등록: 파싱 → md 저장 → 키워드 추출 → 그래프 연결 → 임베딩까지 자동 진행.
- `/docs/<slug>/<n>` 챕터 뷰어.

## CLI

```bash
npm run ingest -- path/to/file.pdf      # 웹 없이 PDF 등록
npm run search -- "질문" llm            # 검색 테스트 (keyword | llm)
```

## 데이터

- `raw_data/<문서 slug>/index.md`, `NN-<chapter>.md` — 챕터별 Markdown (frontmatter에 키워드/요약/분류)
- `data/graph.json` — 문서/챕터/키워드 노드와 contains / mentions / cooccurs / shares 엣지
- `data/embeddings.json` — 청크 임베딩 (gitignore)
- `data/uploads/` — 원본 PDF (gitignore)

## 모델 설정 (.env)

```
OPENAI_EXTRACT_MODEL=gpt-5.4-mini   # 챕터 판별, 키워드 추출, 요약, 키워드 연결
OPENAI_ANSWER_MODEL=gpt-5.5         # AI 검색 답변
OPENAI_EMBED_MODEL=text-embedding-3-small
OPENAI_ANSWER_REASONING=low         # none|low|medium|high|xhigh
```
