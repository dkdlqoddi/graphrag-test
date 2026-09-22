"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { ResultPanel } from "./ResultPanel";
import { SearchBar } from "./SearchBar";
import { StatusLine } from "./StatusLine";
import { useLibraryStore } from "./store";

const LibraryScene = dynamic(() => import("./LibraryScene"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-[13px] text-muted">
      <span>
        3D 도서관을 준비하는 중
        <span className="dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
    </div>
  ),
});

/** Runs a search when the page is opened with ?q=...&mode=... */
function QueryParamRunner() {
  const params = useSearchParams();
  const startSearch = useLibraryStore((s) => s.startSearch);
  const setMode = useLibraryStore((s) => s.setMode);
  const ran = useRef<string | null>(null);
  useEffect(() => {
    const q = params.get("q");
    const mode = params.get("mode") === "keyword" ? "keyword" : "llm";
    if (!q || ran.current === q) return;
    ran.current = q;
    setMode(mode);
    void startSearch(q, mode);
  }, [params, startSearch, setMode]);
  return null;
}

export function LibraryApp() {
  return (
    <div className="fixed inset-0 bg-[#e9dfd0]">
      <LibraryScene />
      <Suspense fallback={null}>
        <QueryParamRunner />
      </Suspense>
      <StatusLine />
      <SearchBar />
      <ResultPanel />
    </div>
  );
}
