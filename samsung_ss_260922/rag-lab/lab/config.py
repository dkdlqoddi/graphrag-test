# -*- coding: utf-8 -*-
"""rag-lab 설정값. 화면에서 고르는 것(청킹 전략·크기, K)을 뺀 나머지는 여기 모아 둔다."""

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 경로 ────────────────────────────────────────────────────────────
DATA_DIR = os.path.join(ROOT, "data")          # 업로드한 PDF
STORE_DIR = os.path.join(ROOT, "chroma_db")    # 벡터 저장소
STATIC_DIR = os.path.join(ROOT, "static")

# ── 서버 ────────────────────────────────────────────────────────────
HOST = "127.0.0.1"
PORT = 8765

# ── 모델 ────────────────────────────────────────────────────────────
# 질문과 문서를 같은 모델로 임베딩한다. 차원은 dimensions 로 줄일 수 있다(기본 1536).
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536
EMBED_BATCH = 100

# 답을 만드는 모델. 검색이 꺼내 온 조각을 근거로 문장을 쓴다.
GEN_MODEL = "gpt-5.6-luna"
GEN_MAX_TOKENS = 1024

# 질의 재작성은 한 줄만 받으면 된다. 답변보다 훨씬 짧게 끊는다.
REWRITE_MAX_TOKENS = 300

# HyDE 가상 답변 — 문서 한 조각만 하게. 길면 벡터가 여러 이야기로 뭉개진다.
HYDE_MAX_TOKENS = 400
HYDE_MAX_CHARS = 900

# 생성된 답변을 근거로 쌓을 때 쓰는 이름. 문서에서 온 조각과 절대 섞이면 안 되므로
# 저장소의 document 이름과 metadata 의 source 두 군데에 모두 표시를 남긴다.
GENERATED_DOC = "(생성) 이전 답변"
GENERATED_MIN_CHARS = 20

COLLECTION = "rag_lab"

# ── 청킹 ────────────────────────────────────────────────────────────
CHUNK_SIZE_DEFAULT = 500
CHUNK_SIZE_MIN = 100
CHUNK_SIZE_MAX = 2000

STRATEGIES = {
    "fixed": "고정 길이",
    "structure": "구조 경계",
    "paragraph": "문단",
    "semantic": "의미 경계",
}

# 의미 경계 전략 — 이웃 문장 사이 거리가 상위 몇 % 인 자리에서 자를 것인가.
# 절댓값 대신 백분위를 쓰는 이유는 chunking.py 에 적어 두었다.
SEMANTIC_PCT_DEFAULT = 10
SEMANTIC_PCT_MIN = 1
SEMANTIC_PCT_MAX = 50

# LLM 재정렬 — 조각 하나를 판정하는 데 필요한 것은 "Y 0.92" 한 줄뿐이다.
RERANK_MAX_TOKENS = 32

# 재정렬할 후보를 몇 개나 꺼내 올 것인가. K 개만 꺼내 다시 줄 세우면 순서만 바뀌고,
# 원래 순위로는 화면에 못 오던 조각을 끌어올릴 수 없다 — 그것이 재정렬의 값어치다.
# 다만 후보 하나가 곧 호출 하나이므로 상한을 둔다(두 열이므로 실제 호출은 2배).
RERANK_POOL_MULT = 2
RERANK_POOL_MAX = 12

# 첫 토큰의 후보를 몇 개까지 받아 볼 것인가. Y 와 N 만 있으면 되지만 대소문자·앞 공백이
# 붙은 변종과 엉뚱한 글자가 섞여 오므로 넉넉히 받아 그중에서 Y·N 만 골라 낸다.
RERANK_TOP_LOGPROBS = 10

# 판정은 서로 독립이다(조각끼리 견주지 않는다). 순서대로 부르면 K=5 두 열에서
# 스무 번을 줄 세워 기다리게 되므로 몇 개씩 동시에 보낸다.
RERANK_WORKERS = 4

# ── MCP ─────────────────────────────────────────────────────────────
# MCP 도구의 결과는 브라우저가 아니라 **모델의 문맥**으로 간다. 화면에서는 스크롤로
# 넘기던 청크 원문이 여기서는 그대로 토큰이 되므로, 본문은 잘라 싣고 전체가 필요하면
# show_chunks 로 따로 청하게 한다.
MCP_NAME = "rag-lab"
MCP_VERSION = "0.1.0"
# 우리가 말하는 MCP 규격. 클라이언트가 다른 것을 청하면 그 값을 그대로 되돌려 준다
# (규격이 협상 대상이라 서로 아는 것 중 하나로 맞춘다).
MCP_PROTOCOL = "2025-06-18"

MCP_SNIPPET_CHARS = 300        # 검색 결과 한 조각에서 실어 보낼 본문 글자 수
MCP_PREVIEW_CHUNKS = 5         # 청킹 직후 미리 보여 줄 조각 수
MCP_MAX_CHUNKS = 20            # show_chunks 한 번에 꺼낼 수 있는 조각 수
MCP_PAGE_CHARS = 4000          # read_page 가 한 번에 돌려주는 글자 수

# ── 검색 ────────────────────────────────────────────────────────────
TOP_K_DEFAULT = 5
TOP_K_MAX = 20

# BM25(낱말 검색)의 두 손잡이. 원 논문과 검색 엔진들이 쓰는 값 그대로다.
#   k1  같은 낱말이 여러 번 나올 때 점수가 오르다 멈추는 지점
#   b   조각 길이로 나누는 정도 (0 이면 길이를 무시, 1 이면 완전히 나눔)
BM25_K1 = 1.5
BM25_B = 0.75

# ── 문장 ────────────────────────────────────────────────────────────
# 글을 문장으로 쪼갤 때의 하한·상한 (chunking.split_sentences).
# 의미 경계 청킹이 자를 후보로, 근거 하이라이트가 칠할 단위로 함께 쓴다.
# 너무 짧으면 목차 한 줄이 문장 행세를 하고, 너무 길면 가리키는 뜻이 없어진다.
# 하한이 한국어 한 문장(대개 25~35자)보다 크면 멀쩡한 문장끼리 붙어 버린다.
SENT_MIN_CHARS = 25
SENT_MAX_CHARS = 220


def api_key():
    """.env 또는 환경변수에서 OpenAI API 키를 읽는다."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        return key
    path = os.path.join(ROOT, ".env")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() == "OPENAI_API_KEY":
                    return v.strip().strip("'\"")
    return ""
