"use client";

import { useCallback, useRef } from "react";
import { DocumentList, type DocumentListHandle } from "./DocumentList";
import { UploadPanel } from "./UploadPanel";

export function UploadPageClient() {
  const listRef = useRef<DocumentListHandle>(null);
  const onIngested = useCallback(() => listRef.current?.refresh(), []);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">PDF 등록</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          등록한 PDF는 <code className="rounded bg-cream-2 px-1">raw_data/&lt;문서&gt;/</code>에 챕터별 md로 저장되고, 키워드 그래프(
          <code className="rounded bg-cream-2 px-1">data/graph.json</code>)에 연결됩니다.
        </p>
        <div className="mt-5">
          <UploadPanel onIngested={onIngested} />
        </div>
      </section>
      <section>
        <h2 className="text-[18px] font-bold tracking-tight text-ink">등록된 문서</h2>
        <div className="mt-5">
          <DocumentList ref={listRef} />
        </div>
      </section>
    </div>
  );
}
