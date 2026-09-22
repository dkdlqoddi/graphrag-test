"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CATEGORY_MAP } from "@/lib/categories";
import { renderAnswer } from "./answer";
import { useLibraryStore } from "./store";

export function ResultPanel() {
  const status = useLibraryStore((s) => s.status);
  const close = useLibraryStore((s) => s.close);
  const query = useLibraryStore((s) => s.query);
  const mode = useLibraryStore((s) => s.mode);
  const category = useLibraryStore((s) => s.category);
  const categoryLabel = useLibraryStore((s) => s.categoryLabel);
  const keywords = useLibraryStore((s) => s.keywords);
  const related = useLibraryStore((s) => s.related);
  const sources = useLibraryStore((s) => s.sources);
  const answer = useLibraryStore((s) => s.answer);
  const done = useLibraryStore((s) => s.done);
  const error = useLibraryStore((s) => s.error);
  const startSearch = useLibraryStore((s) => s.startSearch);

  useEffect(() => {
    if (status !== "presenting") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, close]);

  if (status !== "presenting") return null;
  const cat = category ? CATEGORY_MAP[category] : null;
  const topTerm = keywords[0]?.term ?? sources[0]?.doc;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 pb-24 pt-20">
      <button type="button" aria-label="닫기" onClick={close} className="absolute inset-0 bg-ink/15 backdrop-blur-[2px]" />
      <div
        className="fade-up relative grid max-h-[74vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-line shadow-[0_30px_80px_-30px_rgba(43,47,54,0.55)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        style={{ background: "linear-gradient(90deg, #f6efe2 0%, #fbf7ef 45%, #f3eadb 50%, #fbf7ef 55%, #fbf7ef 100%)" }}
      >
        {/* left page */}
        <section className="scrollbar-thin flex min-h-0 flex-col gap-4 overflow-y-auto border-b border-line p-6 md:border-b-0 md:border-r">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
              {mode === "llm" ? "AI 검색" : "키워드 검색"}
            </div>
            <h2 className="mt-1 text-[19px] font-bold leading-snug text-ink">{query}</h2>
            {cat && (
              <span className="chip mt-2">
                <span className="chip-dot" style={{ background: cat.color }} />
                {categoryLabel} 서가
              </span>
            )}
          </div>

          {keywords.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink-2">일치한 키워드</div>
              <div className="flex flex-wrap gap-1.5">
                {keywords.map((k) => (
                  <button key={k.term} type="button" onClick={() => void startSearch(k.label, "keyword")} className="chip transition hover:bg-paper hover:text-ink">
                    <span className="chip-dot" style={{ background: CATEGORY_MAP[k.category].color }} />
                    {k.label}
                    <span className="text-muted">{k.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {related.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink-2">연결된 키워드</div>
              <div className="flex flex-wrap gap-1.5">
                {related.map((k) => (
                  <button key={k.term} type="button" onClick={() => void startSearch(k.label, "keyword")} className="chip transition hover:bg-paper hover:text-ink">
                    <span className="chip-dot" style={{ background: CATEGORY_MAP[k.category].color }} />
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-ink-2">출처 챕터 {sources.length > 0 && `· ${sources.length}`}</div>
            {sources.length === 0 ? (
              <p className="text-[13px] text-muted">일치하는 챕터가 없습니다.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {sources.map((s, i) => (
                  <li key={s.chapterId}>
                    <Link
                      href={`/docs/${encodeURIComponent(s.doc)}/${s.chapterIndex}`}
                      className="block rounded-xl border border-line bg-white/50 px-3 py-2.5 transition hover:bg-white"
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-terracotta text-[11px] font-bold text-paper">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-ink">{s.chapterTitle}</div>
                          <div className="truncate text-[12px] text-muted">
                            {s.docTitle} · p.{s.pages[0]}-{s.pages[1]}
                          </div>
                          {mode === "keyword" && s.snippet && <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-2">{s.snippet}</p>}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        {/* right page */}
        <section className="scrollbar-thin relative flex min-h-0 flex-col overflow-y-auto p-6 md:p-8">
          <div className="absolute right-4 top-4 flex items-center gap-2">
            {topTerm && (
              <Link href={`/map?focus=${encodeURIComponent(topTerm)}`} className="chip transition hover:bg-paper hover:text-ink">
                지식 지도에서 보기
              </Link>
            )}
            <button type="button" onClick={close} className="grid h-8 w-8 place-items-center rounded-full border border-line bg-white/60 text-ink-2 transition hover:bg-white hover:text-ink" aria-label="닫기">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{mode === "llm" ? "사서의 답변" : "본문 발췌"}</div>

          {error ? (
            <div className="rounded-xl border border-terracotta/30 bg-terracotta/10 p-4 text-[14px] text-terracotta-2">{error}</div>
          ) : mode === "llm" ? (
            <div className="answer text-[15px] text-ink">
              {answer ? renderAnswer(answer) : null}
              {!done && (
                <span className="dots text-terracotta">
                  <span>●</span>
                  <span>●</span>
                  <span>●</span>
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {answer && <p className="text-[14px] text-ink-2">{answer}</p>}
              {sources.map((s, i) => (
                <article key={s.chapterId} className="rounded-xl border border-line bg-white/40 p-4">
                  <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
                    <span className="font-bold text-terracotta-2">[{i + 1}]</span>
                    <span className="truncate">
                      {s.docTitle} › {s.chapterTitle}
                    </span>
                  </div>
                  <p className="text-[14px] leading-relaxed text-ink">{s.snippet}</p>
                  {s.matchedKeywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.matchedKeywords.map((k) => (
                        <span key={k} className="chip">
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
