"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { readSSE } from "@/lib/client/sse";
import type { IngestEvent, IngestStage } from "@/lib/types";

const STAGE_LABEL: Record<IngestStage, string> = {
  parse: "PDF 파싱",
  structure: "챕터 구조",
  write: "md 저장",
  keywords: "키워드 추출",
  link: "그래프 연결",
  embed: "임베딩",
  graph: "그래프 저장",
  done: "완료",
  error: "오류",
};
const STAGE_ORDER: IngestStage[] = ["parse", "structure", "write", "keywords", "link", "embed", "graph", "done"];

interface Job {
  name: string;
  size: number;
  events: IngestEvent[];
  status: "queued" | "running" | "done" | "error";
}

export function UploadPanel({ onIngested }: { onIngested?: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);
  const queueRef = useRef<File[]>([]);

  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    while (queueRef.current.length) {
      const file = queueRef.current.shift()!;
      setJobs((js) => js.map((j) => (j.name === file.name && j.status === "queued" ? { ...j, status: "running" } : j)));
      const push = (ev: IngestEvent) =>
        setJobs((js) =>
          js.map((j) => {
            if (j.name !== file.name || j.status !== "running") return j;
            const events = [...j.events];
            const last = events[events.length - 1];
            if (last && last.stage === ev.stage && ev.total !== undefined) events[events.length - 1] = ev;
            else events.push(ev);
            return { ...j, events };
          }),
        );
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        let failed = false;
        for await (const ev of readSSE<IngestEvent>(res)) {
          push(ev);
          if (ev.stage === "error") failed = true;
        }
        setJobs((js) => js.map((j) => (j.name === file.name && j.status === "running" ? { ...j, status: failed ? "error" : "done" } : j)));
      } catch (err) {
        push({ type: "progress", stage: "error", message: err instanceof Error ? err.message : String(err) });
        setJobs((js) => js.map((j) => (j.name === file.name && j.status === "running" ? { ...j, status: "error" } : j)));
      }
      onIngested?.();
    }
    runningRef.current = false;
  }, [onIngested]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
      if (pdfs.length === 0) return;
      setJobs((js) => [...pdfs.map((f) => ({ name: f.name, size: f.size, events: [], status: "queued" as const })), ...js]);
      queueRef.current.push(...pdfs);
      void runQueue();
    },
    [runQueue],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`paper-card cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragging ? "border-terracotta bg-terracotta/5" : "border-line hover:border-terracotta/60"
        }`}
      >
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-terracotta/10 text-terracotta">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
          </svg>
        </div>
        <div className="mt-3 text-[15px] font-semibold text-ink">PDF를 여기에 끌어다 놓거나 클릭해서 선택하세요</div>
        <div className="mt-1 text-[13px] text-muted">파싱 → 챕터 md 저장 → 키워드 추출 → 그래프 연결 → 임베딩까지 자동으로 진행됩니다.</div>
      </div>

      {jobs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <JobCard key={`${job.name}-${job.size}`} job={job} />
          ))}
        </ul>
      )}
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const last = job.events[job.events.length - 1];
  const stageIdx = last ? STAGE_ORDER.indexOf(last.stage) : -1;
  const pct = job.status === "done" ? 100 : job.status === "error" ? 100 : Math.max(4, Math.round(((stageIdx + 0.5) / STAGE_ORDER.length) * 100));
  const result = job.events.find((e) => e.result)?.result;
  return (
    <li className="paper-card rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-ink">{job.name}</div>
          <div className="text-[12px] text-muted">{(job.size / 1024 / 1024).toFixed(2)} MB</div>
        </div>
        <span
          className={`chip ${job.status === "done" ? "!bg-sage/15 !text-sage" : job.status === "error" ? "!bg-terracotta/10 !text-terracotta-2" : ""}`}
        >
          {job.status === "queued" ? "대기 중" : job.status === "running" ? "처리 중" : job.status === "done" ? "완료" : "실패"}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${job.status === "error" ? "bg-terracotta" : "bg-sage"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="mt-3 flex flex-col gap-1 text-[12.5px]">
        {job.events.map((ev, i) => (
          <li key={i} className={`flex gap-2 ${ev.stage === "error" ? "text-terracotta-2" : "text-ink-2"}`}>
            <span className="w-16 shrink-0 font-semibold text-ink">{STAGE_LABEL[ev.stage]}</span>
            <span className="min-w-0 break-words">
              {ev.message}
              {ev.total !== undefined && ev.stage !== "done" && (
                <span className="text-muted">
                  {" "}
                  ({ev.done}/{ev.total})
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {result && (
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <a href={`/docs/${encodeURIComponent(result.slug)}`} className="rounded-full bg-ink px-3 py-1 font-semibold text-paper hover:bg-slate">
            문서 열기
          </a>
          <a href={`/map?focus=${encodeURIComponent(result.slug)}`} className="rounded-full border border-line px-3 py-1 font-semibold text-ink hover:bg-cream-2">
            지식 지도에서 보기
          </a>
        </div>
      )}
    </li>
  );
}
