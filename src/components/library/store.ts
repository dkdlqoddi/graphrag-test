import { create } from "zustand";
import type { CategoryId } from "@/lib/categories";
import { readSSE } from "@/lib/client/sse";
import type { SearchEvent, SearchKeyword, SearchMode, SearchSource } from "@/lib/types";

export type LibrarianPhase = "idle" | "thinking" | "toShelf" | "browsing" | "toDesk" | "present";
export type LibraryStatus = "idle" | "searching" | "presenting";

export interface LibraryState {
  query: string;
  mode: SearchMode;
  status: LibraryStatus;
  phase: LibrarianPhase;
  runId: number;

  category: CategoryId | null;
  categoryLabel: string;
  keywords: SearchKeyword[];
  related: SearchKeyword[];
  sources: SearchSource[];
  answer: string;
  done: boolean;
  error: string | null;
  /** True once sources (or a terminal event) arrived: the librarian may return to the desk. */
  resultsReady: boolean;
  skipRequested: boolean;

  setQuery: (q: string) => void;
  setMode: (m: SearchMode) => void;
  setPhase: (p: LibrarianPhase) => void;
  setStatus: (s: LibraryStatus) => void;
  requestSkip: () => void;
  startSearch: (query: string, mode?: SearchMode) => Promise<void>;
  close: () => void;
}

let controller: AbortController | null = null;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  query: "",
  mode: "llm",
  status: "idle",
  phase: "idle",
  runId: 0,
  category: null,
  categoryLabel: "",
  keywords: [],
  related: [],
  sources: [],
  answer: "",
  done: false,
  error: null,
  resultsReady: false,
  skipRequested: false,

  setQuery: (query) => set({ query }),
  setMode: (mode) => set({ mode }),
  setPhase: (phase) => set({ phase }),
  setStatus: (status) => set({ status }),
  requestSkip: () => set({ skipRequested: true }),

  close: () => {
    controller?.abort();
    controller = null;
    set({
      status: "idle",
      phase: "idle",
      category: null,
      categoryLabel: "",
      keywords: [],
      related: [],
      sources: [],
      answer: "",
      done: false,
      error: null,
      resultsReady: false,
      skipRequested: false,
    });
  },

  startSearch: async (rawQuery, modeOverride) => {
    const query = rawQuery.trim();
    if (!query) return;
    controller?.abort();
    controller = new AbortController();
    const runId = get().runId + 1;
    const mode = modeOverride ?? get().mode;
    set({
      runId,
      query,
      mode,
      status: "searching",
      phase: "thinking",
      category: null,
      categoryLabel: "",
      keywords: [],
      related: [],
      sources: [],
      answer: "",
      done: false,
      error: null,
      resultsReady: false,
      skipRequested: false,
    });

    const isCurrent = () => get().runId === runId;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&mode=${mode}`, {
        signal: controller.signal,
      });
      for await (const ev of readSSE<SearchEvent>(res)) {
        if (!isCurrent()) return;
        switch (ev.type) {
          case "category":
            set({ category: ev.category, categoryLabel: ev.label });
            break;
          case "keywords":
            set({ keywords: ev.keywords, related: ev.related });
            break;
          case "sources":
            set({ sources: ev.sources, resultsReady: true });
            break;
          case "delta":
            set((s) => ({ answer: s.answer + ev.text }));
            break;
          case "done":
            set((s) => ({ done: true, resultsReady: true, answer: s.answer || ev.answer }));
            break;
          case "error":
            set({ error: ev.message, done: true, resultsReady: true });
            break;
        }
      }
      if (isCurrent()) set({ done: true, resultsReady: true });
    } catch (err) {
      if ((err as Error).name === "AbortError" || !isCurrent()) return;
      set({ error: err instanceof Error ? err.message : String(err), done: true, resultsReady: true });
    }
  },
}));
