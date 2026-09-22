"use client";

import { useLibraryStore } from "./store";

export function StatusLine() {
  const status = useLibraryStore((s) => s.status);
  const phase = useLibraryStore((s) => s.phase);
  const label = useLibraryStore((s) => s.categoryLabel);
  const resultsReady = useLibraryStore((s) => s.resultsReady);
  const requestSkip = useLibraryStore((s) => s.requestSkip);
  const skipRequested = useLibraryStore((s) => s.skipRequested);

  if (status !== "searching") return null;

  let text = "사서가 질문을 살펴보는 중";
  if (phase === "toShelf") text = `사서가 ‘${label}’ 서가로 가는 중`;
  else if (phase === "browsing") text = `‘${label}’ 서가에서 책을 찾는 중`;
  else if (phase === "toDesk") text = "책을 가지고 데스크로 돌아오는 중";
  else if (phase === "present") text = "책을 펼치는 중";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-30 flex justify-center px-4">
      <div className="pointer-events-auto paper-card fade-up flex items-center gap-3 rounded-full px-4 py-2 text-[13px] text-ink">
        <span className="h-2 w-2 rounded-full bg-terracotta" />
        <span>
          {text}
          <span className="dots ml-0.5">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
        {resultsReady && !skipRequested && phase !== "present" && (
          <button type="button" onClick={requestSkip} className="rounded-full bg-cream-2 px-2.5 py-0.5 text-[12px] font-medium text-ink-2 hover:bg-cream">
            바로 보기
          </button>
        )}
      </div>
    </div>
  );
}
