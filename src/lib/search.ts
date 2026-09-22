/**
 * Keyword search (graph + text match) and LLM search (embeddings + graph
 * expansion + streamed answer). Both are async generators of SearchEvents.
 */
import { CATEGORY_MAP, majorityCategory, type CategoryId } from "./categories";
import { config } from "./config";
import { readChapterTexts } from "./documents";
import { embedQuery, loadEmbeddings, topKSimilar } from "./embeddings";
import { keywordNeighbors, loadGraph } from "./graph";
import { streamAnswer } from "./llm";
import { hasOpenAI } from "./openai";
import type { ChapterNode, GraphStore, SearchEvent, SearchKeyword, SearchMode, SearchSource } from "./types";
import { normalizeKeyword, truncate } from "./util";

interface KeywordHit {
  term: string;
  score: number;
}

function tokenize(query: string): { full: string; tokens: string[] } {
  const full = normalizeKeyword(query);
  const tokens = [...new Set(full.split(/[\s,;/|]+/).map((t) => t.trim()).filter((t) => t.length >= 2))];
  return { full, tokens };
}

function scoreKeywords(store: GraphStore, full: string, tokens: string[]): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const k of Object.values(store.keywords)) {
    const term = k.term;
    const label = k.label.toLowerCase();
    let s = 0;
    if (full && (term === full || label === full)) s += 5;
    else if (full && (term.includes(full) || label.includes(full))) s += 3;
    for (const t of tokens) {
      if (term === t || label === t) s += 2;
      else if (term.includes(t) || label.includes(t)) s += 1;
      else if (t.includes(term) && term.length >= 2) s += 0.8;
    }
    if (s > 0) hits.push({ term, score: s });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}

function toSearchKeyword(store: GraphStore, term: string, score: number): SearchKeyword | null {
  const k = store.keywords[term];
  if (!k) return null;
  return { term: k.term, label: k.label, category: k.category, count: k.count, score: Math.round(score * 100) / 100 };
}

function relatedKeywords(store: GraphStore, hits: KeywordHit[], limit = 10): SearchKeyword[] {
  const exclude = new Set(hits.map((h) => h.term));
  const agg = new Map<string, number>();
  for (const h of hits.slice(0, 4)) {
    for (const n of keywordNeighbors(store, h.term, 12)) {
      if (exclude.has(n.term)) continue;
      agg.set(n.term, (agg.get(n.term) ?? 0) + n.weight * h.score);
    }
  }
  return [...agg]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, score]) => toSearchKeyword(store, term, score))
    .filter((k): k is SearchKeyword => Boolean(k));
}

function makeSnippet(text: string, tokens: string[], fallback: string): string {
  const lower = text.toLowerCase();
  let best = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  if (best < 0) return truncate(fallback || text, 240);
  const start = Math.max(0, best - 110);
  const end = Math.min(text.length, best + 190);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

function toSource(store: GraphStore, ch: ChapterNode, score: number, snippet: string, matched: string[]): SearchSource {
  const doc = store.documents[ch.doc];
  return {
    chapterId: ch.id,
    doc: ch.doc,
    docTitle: doc?.title ?? ch.doc,
    chapterTitle: ch.title,
    chapterIndex: ch.index,
    path: ch.path,
    pages: ch.pages,
    score: Math.round(score * 1000) / 1000,
    snippet,
    matchedKeywords: matched,
    category: ch.category,
  };
}

function pickCategory(sources: SearchSource[], hits: KeywordHit[], store: GraphStore): CategoryId {
  if (sources.length) return majorityCategory(sources.slice(0, 3).map((s) => s.category));
  if (hits.length) return store.keywords[hits[0].term]?.category ?? "misc";
  return "misc";
}

/* ---------------- keyword search ---------------- */

async function keywordSearchCore(store: GraphStore, query: string) {
  const { full, tokens } = tokenize(query);
  const hits = scoreKeywords(store, full, tokens);
  const hitScore = new Map(hits.map((h) => [h.term, h.score]));

  const chapterScores = new Map<string, { score: number; matched: Set<string> }>();
  const bump = (id: string, s: number, term?: string) => {
    const e = chapterScores.get(id) ?? { score: 0, matched: new Set<string>() };
    e.score += s;
    if (term) e.matched.add(term);
    chapterScores.set(id, e);
  };
  for (const ch of Object.values(store.chapters)) {
    for (const ref of ch.keywords) {
      const s = hitScore.get(ref.term);
      if (s) bump(ch.id, s * (0.4 + ref.weight), ref.term);
    }
    const title = ch.title.toLowerCase();
    const summary = ch.summary.toLowerCase();
    for (const t of tokens) {
      if (title.includes(t)) bump(ch.id, 1.5);
      else if (summary.includes(t)) bump(ch.id, 0.6);
    }
  }
  // Full-text pass on the best candidates plus a sample of others so plain phrases still hit.
  const candidateIds = [...chapterScores.keys()];
  const others = Object.keys(store.chapters).filter((id) => !chapterScores.has(id));
  const textIds = [...candidateIds, ...others].slice(0, 400);
  const texts = await readChapterTexts(store, textIds);
  for (const [id, text] of texts) {
    const lower = text.toLowerCase();
    let hitsInText = 0;
    for (const t of tokens) {
      let idx = 0;
      let n = 0;
      while (n < 10 && (idx = lower.indexOf(t, idx)) >= 0) {
        n++;
        idx += t.length;
      }
      hitsInText += n;
    }
    if (full && tokens.length > 1 && lower.includes(full)) hitsInText += 6;
    if (hitsInText > 0) bump(id, Math.min(4, hitsInText * 0.3));
  }

  const ranked = [...chapterScores]
    .map(([id, e]) => ({ ch: store.chapters[id], score: e.score, matched: [...e.matched] }))
    .filter((r) => r.ch)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const sources = ranked.map((r) =>
    toSource(store, r.ch, r.score, makeSnippet(texts.get(r.ch.id) ?? "", tokens, r.ch.summary), r.matched.map((t) => store.keywords[t]?.label ?? t)),
  );
  const keywords = hits.map((h) => toSearchKeyword(store, h.term, h.score)).filter((k): k is SearchKeyword => Boolean(k));
  return { hits, tokens, sources, keywords, related: relatedKeywords(store, hits), texts };
}

export async function* keywordSearch(query: string): AsyncGenerator<SearchEvent> {
  const store = await loadGraph();
  const core = await keywordSearchCore(store, query);
  const category = pickCategory(core.sources, core.hits, store);
  yield { type: "category", category, label: CATEGORY_MAP[category].label };
  yield { type: "keywords", keywords: core.keywords, related: core.related };
  yield { type: "sources", sources: core.sources };
  const answer =
    core.sources.length === 0
      ? "일치하는 챕터를 찾지 못했습니다. 다른 키워드로 검색하거나 AI 검색을 사용해 보세요."
      : `${core.sources.length}개 챕터에서 ${core.keywords.length}개 키워드가 일치했습니다.`;
  yield { type: "done", mode: "keyword", answer, query };
}

/* ---------------- LLM search ---------------- */

export async function* llmSearch(query: string): AsyncGenerator<SearchEvent> {
  const store = await loadGraph();
  if (!hasOpenAI()) {
    yield { type: "error", message: "OPENAI_API_KEY가 설정되지 않아 AI 검색을 사용할 수 없습니다." };
    return;
  }
  if (Object.keys(store.chapters).length === 0) {
    yield { type: "category", category: "misc", label: CATEGORY_MAP.misc.label };
    yield { type: "keywords", keywords: [], related: [] };
    yield { type: "sources", sources: [] };
    yield { type: "done", mode: "llm", answer: "아직 등록된 문서가 없습니다. PDF를 먼저 등록해 주세요.", query };
    return;
  }

  const [core, emb, qvec] = await Promise.all([keywordSearchCore(store, query), loadEmbeddings(), embedQuery(query)]);
  const top = topKSimilar(emb, qvec, config.search.topChunks);

  // Merge embedding hits with keyword hits per chapter.
  const perChapter = new Map<string, { emb: number; kw: number; chunks: { text: string; score: number }[] }>();
  const entry = (id: string) => perChapter.get(id) ?? perChapter.set(id, { emb: 0, kw: 0, chunks: [] }).get(id)!;
  for (const { item, score } of top) {
    if (!store.chapters[item.chapter]) continue;
    const e = entry(item.chapter);
    e.emb = Math.max(e.emb, score);
    e.chunks.push({ text: item.text, score });
  }
  const maxKw = core.sources[0]?.score || 1;
  for (const s of core.sources) entry(s.chapterId).kw = s.score / maxKw;
  // Graph expansion: chapters sharing the strongest matched keywords.
  for (const h of core.hits.slice(0, 3)) {
    for (const cid of store.keywords[h.term]?.chapters ?? []) {
      const e = entry(cid);
      e.kw = Math.max(e.kw, 0.35);
    }
  }

  const ranked = [...perChapter]
    .map(([id, e]) => ({ id, score: 0.7 * e.emb + 0.3 * e.kw, e }))
    .filter((r) => store.chapters[r.id] && r.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.search.maxContextSources);

  const missingTexts = ranked.filter((r) => r.e.chunks.length === 0).map((r) => r.id);
  const extraTexts = missingTexts.length ? await readChapterTexts(store, missingTexts) : new Map<string, string>();

  const sources: SearchSource[] = [];
  const contexts: { n: number; text: string }[] = [];
  ranked.forEach((r, i) => {
    const ch = store.chapters[r.id];
    const kwSource = core.sources.find((s) => s.chapterId === r.id);
    const chunkText = r.e.chunks.sort((a, b) => b.score - a.score).map((c) => c.text).join("\n…\n");
    const text = chunkText || extraTexts.get(r.id) || core.texts.get(r.id) || ch.summary;
    const snippet = kwSource?.snippet || makeSnippet(text.replace(/^.*?\n\n/, ""), core.tokens, ch.summary);
    sources.push(toSource(store, ch, r.score, snippet, kwSource?.matchedKeywords ?? []));
    contexts.push({ n: i + 1, text: truncate(text, config.search.maxContextCharsPerSource) });
  });

  const category = pickCategory(sources, core.hits, store);
  yield { type: "category", category, label: CATEGORY_MAP[category].label };
  yield { type: "keywords", keywords: core.keywords, related: core.related };
  yield { type: "sources", sources };

  let answer = "";
  try {
    for await (const delta of streamAnswer({
      query,
      sources,
      contexts,
      keywords: [...core.keywords, ...core.related].slice(0, 12).map((k) => k.label),
    })) {
      answer += delta;
      yield { type: "delta", text: delta };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "error", message: `답변 생성 실패: ${message}` };
    return;
  }
  yield { type: "done", mode: "llm", answer, query };
}

export function search(query: string, mode: SearchMode): AsyncGenerator<SearchEvent> {
  return mode === "llm" ? llmSearch(query) : keywordSearch(query);
}
