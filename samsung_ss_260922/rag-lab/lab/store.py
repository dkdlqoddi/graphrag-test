# -*- coding: utf-8 -*-
"""벡터 저장소 (ChromaDB).

저장 1건 = 청크 원문 + 벡터 + 부가 정보(문서명 · 청크 번호 · 페이지 · 전략).
부가 정보는 검색 결과에 출처를 표시하는 데 쓴다.

저장 1건에는 **어디서 왔는지**(`source`)가 함께 붙는다.

  document   PDF 에서 뽑아 자른 조각. 원문이다.
  generated  모델이 쓴 답변을 근거로 다시 넣은 것. 원문이 아니다.

둘을 구분하지 않으면 모델이 제 답을 문서 근거로 삼아 다시 답하게 되고, 화면은 그것을
원문처럼 보여 준다 — 이 앱이 보여 주려는 것이 무너진다. `source` 는 지울 수 없는
표시이며, 검색에서 빼는 스위치(`include_generated`)와 생성분만 비우는
`clear_generated()` 가 함께 있어야 한다. 옛 기록에는 이 키가 없으므로
**없으면 document 로 읽는다**(기존 저장소를 그대로 쓸 수 있게).

임베딩은 우리가 직접 계산해 넣는다. Chroma 의 기본 임베딩 함수를 쓰지 않으므로
모델을 내려받지 않는다.
"""

import os
import shutil
import time

import chromadb

from . import config


def _client():
    os.makedirs(config.STORE_DIR, exist_ok=True)
    return chromadb.PersistentClient(path=config.STORE_DIR)


def _collection(client=None):
    client = client or _client()
    return client.get_or_create_collection(
        name=config.COLLECTION,
        metadata={"hnsw:space": "cosine"},
    )


def reset():
    """저장소를 비운다. 다시 적재할 때마다 처음부터 쌓는다."""
    try:
        _client().delete_collection(config.COLLECTION)
    except Exception:                          # noqa: BLE001 — 없으면 그만
        pass


def wipe_files():
    """파일까지 지운다. 앱을 초기 상태로 되돌릴 때만 쓴다."""
    shutil.rmtree(config.STORE_DIR, ignore_errors=True)


def add(doc_name, chunks, vectors):
    col = _collection()
    col.add(
        ids=["%s#%d" % (doc_name, c["index"]) for c in chunks],
        documents=[c["text"] for c in chunks],
        embeddings=vectors,
        metadatas=[{
            "document": doc_name,
            "chunk_index": c["index"],
            "page": c["page"],
            "strategy": c["strategy"],
            "n_chars": c["n_chars"],
            "source": "document",
        } for c in chunks],
    )


def add_generated(text, vector, question, engine, based_on):
    """모델이 쓴 답변을 근거로 저장한다. → 저장한 id

    문서 조각과 같은 컬렉션에 들어가지만 표시가 다르다(`source="generated"`).
    어떤 질문에서 나왔고 어느 조각을 근거로 삼았는지(`based_on`)를 함께 남긴다 —
    나중에 이 기록이 검색에 걸렸을 때 출처를 거슬러 갈 수 있어야 한다.

    id 는 시간으로 만든다. 문서 조각의 "{문서명}#{번호}" 와 겹치지 않고, 같은 질문을
    다시 물어도 앞의 기록을 덮어쓰지 않는다.
    """
    col = _collection()
    rid = "gen#%d" % time.time_ns()
    col.add(
        ids=[rid],
        documents=[text],
        embeddings=[vector],
        metadatas=[{
            "document": config.GENERATED_DOC,
            "chunk_index": col.count(),
            "page": 0,                         # 원문 쪽수가 없다 — 화면은 "—" 로 적는다
            "strategy": "generated",
            "n_chars": len(text),
            "source": "generated",
            "question": question[:300],
            "engine": engine,
            "based_on": based_on[:500],
            "created": time.strftime("%Y-%m-%d %H:%M"),
        }],
    )
    return rid


def clear_generated():
    """생성된 근거만 지운다. 문서에서 온 조각은 그대로 둔다. → 지운 건수

    실험하다 보면 저장소가 모델의 말로 물든다. 전부 비우고 PDF 부터 다시 적재하지
    않고도 되돌릴 수 있어야 한다.
    """
    try:
        col = _collection()
    except Exception:                          # noqa: BLE001
        return 0
    got = col.get(where={"source": "generated"}, include=[])
    ids = got.get("ids") or []
    if ids:
        col.delete(ids=ids)
    return len(ids)


def status():
    """적재 현황. 문서별 청크 수와 적용된 전략."""
    try:
        col = _collection()
        n = col.count()
    except Exception:                          # noqa: BLE001
        return {"total": 0, "documents": []}
    if n == 0:
        return {"total": 0, "documents": []}

    got = col.get(include=["metadatas"])
    by_doc, generated = {}, 0
    for m in got.get("metadatas") or []:
        source = (m or {}).get("source") or "document"
        if source == "generated":
            generated += 1
        d = by_doc.setdefault(m.get("document", "?"),
                              {"document": m.get("document", "?"), "chunks": 0,
                               "strategy": m.get("strategy", "?"), "source": source})
        d["chunks"] += 1
    return {
        "total": n,
        "generated": generated,                # 그중 모델이 쓴 것
        "documents": sorted(by_doc.values(), key=lambda x: x["document"]),
        "model": config.EMBED_MODEL,
        "dim": config.EMBED_DIM,
    }


def _row(meta):
    """metadata → 화면·검색이 쓰는 공통 꼴. source 가 없으면 문서로 본다(옛 기록)."""
    m = meta or {}
    row = {k: m.get(k) for k in
           ("document", "chunk_index", "page", "strategy", "n_chars")}
    row["source"] = m.get("source") or "document"
    if row["source"] == "generated":
        row["question"] = m.get("question")
        row["based_on"] = m.get("based_on")
        row["created"] = m.get("created")
        row["engine"] = m.get("engine")
    return row


def all_chunks():
    """적재된 조각 전부 — 낱말 검색(BM25)이 쓸 말뭉치.

    벡터는 가져오지 않는다. BM25 에게 필요한 것은 원문과 출처뿐이고, 벡터까지 끌어오면
    조각 수천 개에서 쓸데없이 무겁다. 의미 검색과 **같은 저장소를 읽는 것**이 중요하다 —
    말뭉치가 다르면 둘을 나란히 놓고 비교하는 뜻이 없어진다.
    """
    try:
        col = _collection()
        if col.count() == 0:
            return []
    except Exception:                          # noqa: BLE001
        return []
    got = col.get(include=["documents", "metadatas"])
    out = []
    for text, meta in zip(got.get("documents") or [], got.get("metadatas") or []):
        out.append({"text": text, **_row(meta)})
    return out


def query(vector, k, include_generated=True):
    """가까운 순 k개. include_generated 가 꺼지면 생성된 근거를 뺀다.

    거르는 일은 Chroma 의 where 가 아니라 파이썬에서 한다. 옛 기록에는 source 키가
    아예 없어 where 로 거르면 원문 조각까지 통째로 사라진다. 대신 넉넉히 받아 와
    걸러 낸 뒤 k 개를 취한다.
    """
    col = _collection()
    n = col.count()
    if n == 0:
        return []
    want = min(n, k if include_generated else k * 3 + 10)
    res = col.query(
        query_embeddings=[vector],
        n_results=want,
        include=["documents", "metadatas", "distances"],
    )
    out = []
    docs = (res.get("documents") or [[]])[0]
    metas = (res.get("metadatas") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]
    for text, meta, dist in zip(docs, metas, dists):
        row = _row(meta)
        if not include_generated and row["source"] == "generated":
            continue
        out.append({
            "rank": 0,                              # 거른 뒤에 다시 매긴다
            "score": round(1.0 - float(dist), 4),   # cosine 거리 → 유사도
            "distance": round(float(dist), 4),
            "text": text,
            **row,
        })
    out = out[:k]
    for rank, row in enumerate(out, 1):
        row["rank"] = rank
    return out


def peek_vector(doc_name, chunk_index, head=10):
    """청크 하나의 벡터 앞부분. 문장이 실제로 숫자가 된 모습을 보여 준다."""
    col = _collection()
    got = col.get(ids=["%s#%d" % (doc_name, chunk_index)], include=["embeddings"])
    vecs = got.get("embeddings")
    if vecs is None or len(vecs) == 0:
        return None
    v = list(vecs[0])
    return {"dim": len(v), "head": [round(float(x), 4) for x in v[:head]]}
