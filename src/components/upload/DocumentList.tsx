"use client";

import Link from "next/link";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { CATEGORY_MAP, type CategoryId } from "@/lib/categories";
import type { DocumentNode } from "@/lib/types";

type Doc = DocumentNode & { keywordLabels: string[] };

export interface DocumentListHandle {
  refresh: () => void;
}

export const DocumentList = forwardRef<DocumentListHandle>(function DocumentList(_props, ref) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) => setDocs(d.documents))
      .catch(() => setDocs([]));
  }, []);

  useEffect(() => refresh(), [refresh]);
  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  const remove = async (slug: string, title: string) => {
    if (!window.confirm(`"${title}" 문서를 삭제할까요?\nraw_data의 md 파일과 그래프에서 제거됩니다.`)) return;
    setBusy(slug);
    try {
      await fetch(`/api/documents/${encodeURIComponent(slug)}`, { method: "DELETE" });
      refresh();
    } finally {
      setBusy(null);
    }
  };

  if (!docs) return <div className="text-[13px] text-muted">불러오는 중…</div>;
  if (docs.length === 0) return <div className="paper-card rounded-2xl p-6 text-center text-[13px] text-muted">아직 등록된 문서가 없습니다.</div>;

  return (
    <ul className="flex flex-col gap-3">
      {docs.map((d) => {
        const cat = CATEGORY_MAP[d.category as CategoryId];
        return (
          <li key={d.slug} className="paper-card rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/docs/${encodeURIComponent(d.slug)}`} className="block truncate text-[15px] font-semibold text-ink hover:text-terracotta-2">
                  {d.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <span className="chip">
                    <span className="chip-dot" style={{ background: cat?.color }} />
                    {cat?.label}
                  </span>
                  <span>{d.pages}쪽</span>
                  <span>· 챕터 {d.chapters.length}개</span>
                  <span>· {new Date(d.createdAt).toLocaleString("ko-KR")}</span>
                  <span className="truncate">· {d.sourceFile}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(d.slug, d.title)}
                disabled={busy === d.slug}
                className="shrink-0 rounded-full border border-line px-3 py-1 text-[12px] text-ink-2 hover:bg-terracotta/10 hover:text-terracotta-2 disabled:opacity-50"
              >
                {busy === d.slug ? "삭제 중…" : "삭제"}
              </button>
            </div>
            {d.summary && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{d.summary}</p>}
            {d.keywordLabels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.keywordLabels.map((k) => (
                  <Link key={k} href={`/?q=${encodeURIComponent(k)}&mode=keyword`} className="chip transition hover:bg-paper hover:text-ink">
                    {k}
                  </Link>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
});
