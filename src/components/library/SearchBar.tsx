"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SearchMode } from "@/lib/types";
import { useLibraryStore } from "./store";

const EXAMPLES = ["트랜스포머에서 positional encoding은 왜 필요한가?", "multi-head attention", "self-attention의 장점은?"];

function ModeButton({ id, label, active, onSelect }: { id: SearchMode; label: string; active: boolean; onSelect: (m: SearchMode) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${active ? "bg-ink text-paper shadow-sm" : "text-ink-2 hover:bg-cream-2"}`}
    >
      {label}
    </button>
  );
}

export function SearchBar() {
  const mode = useLibraryStore((s) => s.mode);
  const setMode = useLibraryStore((s) => s.setMode);
  const startSearch = useLibraryStore((s) => s.startSearch);
  const status = useLibraryStore((s) => s.status);
  const [value, setValue] = useState("");
  const [stats, setStats] = useState<{ documents: number; chapters: number; keywords: number } | null>(null);

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) => setStats(d.stats))
      .catch(() => {});
  }, [status]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    void startSearch(value, mode);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 px-4 pb-6">
      {status === "idle" && (
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 fade-up">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setValue(ex);
                void startSearch(ex, mode);
              }}
              className="chip hover:bg-paper hover:text-ink transition"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={submit}
        className="pointer-events-auto paper-card flex w-full max-w-2xl items-center gap-2 rounded-full py-1.5 pl-2 pr-2"
      >
        <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-cream-2/70 p-0.5">
          <ModeButton id="keyword" label="키워드" active={mode === "keyword"} onSelect={setMode} />
          <ModeButton id="llm" label="AI 검색" active={mode === "llm"} onSelect={setMode} />
        </div>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === "llm" ? "질문이나 프롬프트를 입력하세요…" : "검색할 키워드를 입력하세요…"}
          className="min-w-0 flex-1 bg-transparent px-2 text-[15px] text-ink outline-none placeholder:text-muted"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-terracotta text-paper shadow-sm transition hover:bg-terracotta-2 disabled:opacity-40"
          aria-label="검색"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      <div className="text-[12px] text-ink-2/80">
        {stats ? `등록된 문서 ${stats.documents}권 · 챕터 ${stats.chapters}개 · 키워드 ${stats.keywords}개` : " "}
      </div>
    </div>
  );
}
