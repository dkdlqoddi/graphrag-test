/**
 * End-to-end ingestion: PDF -> chapters -> markdown -> keywords -> links ->
 * embeddings -> graph. Yields progress events so the API can stream them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { majorityCategory, type CategoryId } from "./categories";
import { config } from "./config";
import { chunkParagraphs, embedTexts, loadEmbeddings, removeDocEmbeddings, saveEmbeddings } from "./embeddings";
import { addDocumentToStore, graphMutex, loadGraph, saveGraph } from "./graph";
import { extractChapterKeywords, linkKeywords, selectChaptersWithLLM, summarizeDocument } from "./llm";
import { chapterFileName, renderChapterMarkdown, renderDocumentIndex } from "./markdown";
import { hasOpenAI } from "./openai";
import { extractPdf } from "./pdf/extract";
import { structureDocument, type Chapter } from "./pdf/structure";
import type { ChapterNode, DocumentNode, EmbeddingItem, IngestEvent, IngestResult, KeywordRef } from "./types";
import { chapterId, mapLimit, normalizeKeyword, slugify } from "./util";

export interface IngestInput {
  buffer: Uint8Array;
  filename: string;
}

interface ChapterWork {
  chapter: Chapter;
  id: string;
  file: string;
  text: string;
  summary: string;
  category: CategoryId;
  keywords: KeywordRef[];
}

function progress(stage: IngestEvent["stage"], message: string, extra: Partial<IngestEvent> = {}): IngestEvent {
  return { type: "progress", stage, message, ...extra };
}

export async function* ingestPdf(input: IngestInput): AsyncGenerator<IngestEvent, IngestResult> {
  const useLLM = hasOpenAI();
  const baseName = path.basename(input.filename);

  /* 1. parse */
  yield progress("parse", `PDF 텍스트를 추출하는 중… (${baseName})`);
  const extract = await extractPdf(input.buffer);
  yield progress("parse", `${extract.numPages}쪽에서 텍스트를 추출했습니다.`, { done: extract.numPages, total: extract.numPages });

  /* 2. structure */
  yield progress("structure", useLLM ? "제목 후보를 찾고 챕터 구조를 판별하는 중… (LLM)" : "제목 후보로 챕터 구조를 판별하는 중…");
  const structured = await structureDocument(extract, {
    fallbackTitle: baseName.replace(/\.pdf$/i, ""),
    maxChapters: config.ingest.maxChapters,
    selectChapters: useLLM ? selectChaptersWithLLM : undefined,
  });
  const slug = slugify(structured.title);
  yield progress(
    "structure",
    `"${structured.title}" → ${structured.chapters.length}개 챕터 (${structured.method})`,
    { done: structured.chapters.length, total: structured.chapters.length },
  );

  /* 3. write markdown */
  const docDir = path.join(config.rawDataDir, slug);
  const existing = await loadGraph();
  const replaced = Boolean(existing.documents[slug]);
  yield progress("write", replaced ? `기존 문서를 교체합니다: raw_data/${slug}/` : `raw_data/${slug}/ 에 md 파일을 저장하는 중…`);
  await fs.rm(docDir, { recursive: true, force: true });
  await fs.mkdir(docDir, { recursive: true });
  await fs.mkdir(config.uploadsDir, { recursive: true });
  await fs.writeFile(path.join(config.uploadsDir, `${slug}.pdf`), input.buffer);

  const works: ChapterWork[] = structured.chapters.map((chapter) => ({
    chapter,
    id: chapterId(slug, chapter.index),
    file: chapterFileName(chapter.index, chapter.title),
    text: chapter.paragraphs.map((p) => (p.heading ? `[${p.text}]` : p.text)).join("\n\n"),
    summary: "",
    category: "misc",
    keywords: [],
  }));
  for (const w of works) {
    await fs.writeFile(
      path.join(docDir, w.file),
      renderChapterMarkdown(w.chapter, { doc: slug, docTitle: structured.title }),
      "utf8",
    );
  }
  yield progress("write", `${works.length}개 챕터 md 파일을 저장했습니다.`, { done: works.length, total: works.length });

  /* 4. keywords per chapter */
  const labels = new Map<string, string>();
  if (useLLM) {
    yield progress("keywords", `OpenAI(${config.models.extract})로 챕터별 키워드를 추출하는 중…`, { done: 0, total: works.length });
    const queue: IngestEvent[] = [];
    const running = mapLimit(
      works,
      config.ingest.concurrency,
      async (w) => {
        try {
          const r = await extractChapterKeywords({ docTitle: structured.title, chapterTitle: w.chapter.title, text: w.text });
          w.summary = r.summary;
          w.category = r.category;
          w.keywords = dedupeRefs(
            r.keywords.map((k) => {
              const term = normalizeKeyword(k.term);
              if (term && !labels.has(term)) labels.set(term, k.term.trim());
              return { term, weight: k.weight };
            }),
          );
        } catch (err) {
          console.warn(`[ingest] keyword extraction failed for ${w.id}:`, err);
          w.keywords = fallbackKeywords(w, labels);
          w.summary = w.summary || w.chapter.paragraphs.find((p) => !p.heading)?.text.slice(0, 200) || "";
        }
      },
      (done, total) => queue.push(progress("keywords", `키워드 추출 ${done}/${total}`, { done, total })),
    );
    // Drain progress while the extraction runs.
    let finished = false;
    running.then(() => (finished = true));
    while (!finished) {
      await new Promise((r) => setTimeout(r, 250));
      while (queue.length) yield queue.shift()!;
    }
    await running;
    while (queue.length) yield queue.shift()!;
  } else {
    yield progress("keywords", "OPENAI_API_KEY가 없어 제목 기반 키워드로 대체합니다.");
    for (const w of works) {
      w.keywords = fallbackKeywords(w, labels);
      w.summary = w.chapter.paragraphs.find((p) => !p.heading)?.text.slice(0, 200) ?? "";
    }
  }

  /* 5. link keywords with the existing graph (and consolidate within the document) */
  const graphTerms = Object.values(existing.keywords)
    .filter((k) => k.docs.some((d) => d !== slug))
    .sort((a, b) => b.count - a.count)
    .slice(0, 300)
    .map((k) => ({ term: k.term, label: k.label, count: k.count }));
  const docCounts = new Map<string, number>();
  for (const w of works) for (const k of w.keywords) docCounts.set(k.term, (docCounts.get(k.term) ?? 0) + 1);
  const canonicalSet = new Set(graphTerms.map((t) => t.term));
  const existingTerms = [
    ...graphTerms,
    ...[...docCounts]
      .filter(([term, n]) => n >= 2 && !canonicalSet.has(term))
      .map(([term, n]) => ({ term, label: labels.get(term) ?? term, count: n })),
  ];
  for (const t of existingTerms) canonicalSet.add(t.term);
  const newTerms = [...labels.entries()].filter(([term]) => !canonicalSet.has(term)).map(([term, label]) => ({ term, label }));
  let merges: { from: string; to: string }[] = [];
  if (useLLM && newTerms.length > 0 && existingTerms.length > 0) {
    yield progress("link", `기존 ${graphTerms.length}개 키워드와 새 키워드 ${newTerms.length}개를 연결하는 중…`);
    try {
      merges = await linkKeywords(newTerms, existingTerms);
    } catch (err) {
      console.warn("[ingest] keyword linking failed:", err);
    }
  }
  if (merges.length) {
    const map = new Map(merges.map((m) => [m.from, m.to]));
    const resolve = (term: string): string => {
      let cur = term;
      for (let i = 0; i < 5 && map.has(cur); i++) cur = map.get(cur)!;
      return cur;
    };
    for (const w of works) w.keywords = dedupeRefs(w.keywords.map((k) => ({ term: resolve(k.term), weight: k.weight })));
    for (const m of merges) labels.delete(m.from);
    for (const t of existingTerms) if (!labels.has(t.term)) labels.set(t.term, t.label);
  }
  const uniqueTerms = new Set(works.flatMap((w) => w.keywords.map((k) => k.term)));
  yield progress("link", merges.length ? `${merges.length}개 키워드를 기존 노드에 병합했습니다.` : `새 키워드 ${uniqueTerms.size}개를 그래프에 추가합니다.`);

  /* 6. document summary */
  let docSummary = "";
  let docCategory: CategoryId = majorityCategory(works.map((w) => w.category));
  let docKeywords: string[] = topTerms(works, 8);
  if (useLLM) {
    try {
      const s = await summarizeDocument({
        title: structured.title,
        chapters: works.map((w) => ({ title: w.chapter.title, summary: w.summary, keywords: w.keywords.map((k) => labels.get(k.term) ?? k.term) })),
      });
      docSummary = s.summary;
      docCategory = s.category;
      const byLabel = new Map<string, string>();
      for (const [term, label] of labels) byLabel.set(label.toLowerCase(), term);
      const picked = s.keywords.map((k) => byLabel.get(k.toLowerCase()) ?? normalizeKeyword(k)).filter((t) => uniqueTerms.has(t));
      if (picked.length) docKeywords = [...new Set([...picked, ...docKeywords])].slice(0, 8);
    } catch (err) {
      console.warn("[ingest] document summary failed:", err);
    }
  }
  if (!docSummary) docSummary = works[0]?.summary ?? "";

  /* 7. embeddings */
  const items: EmbeddingItem[] = [];
  if (useLLM) {
    const chunkPlan = works.flatMap((w) =>
      chunkParagraphs(w.chapter.paragraphs, `${structured.title} › ${w.chapter.title}`).map((text, n) => ({ w, n, text })),
    );
    yield progress("embed", `${chunkPlan.length}개 청크를 임베딩하는 중… (${config.models.embed})`, { done: 0, total: chunkPlan.length });
    try {
      const vectors = await embedTexts(chunkPlan.map((c) => c.text));
      chunkPlan.forEach((c, i) => items.push({ id: `${c.w.id}:${c.n}`, chapter: c.w.id, doc: slug, text: c.text, vector: vectors[i] }));
      yield progress("embed", `임베딩 완료 (${items.length}개)`, { done: items.length, total: items.length });
    } catch (err) {
      console.warn("[ingest] embedding failed:", err);
      yield progress("embed", "임베딩에 실패해 의미 검색 없이 진행합니다.");
    }
  }

  /* 8. persist graph + final markdown */
  yield progress("graph", "graph.json을 갱신하는 중…");
  const createdAt = new Date().toISOString();
  const chapterNodes: ChapterNode[] = works.map((w) => ({
    id: w.id,
    doc: slug,
    index: w.chapter.index,
    title: w.chapter.title,
    path: `${slug}/${w.file}`,
    pages: w.chapter.pages,
    chars: w.chapter.chars,
    summary: w.summary,
    category: w.category,
    keywords: w.keywords,
  }));
  const docNode: DocumentNode = {
    slug,
    title: structured.title,
    sourceFile: baseName,
    pages: extract.numPages,
    category: docCategory,
    summary: docSummary,
    keywords: docKeywords,
    chapters: chapterNodes.map((c) => c.id),
    createdAt,
  };

  await graphMutex.run(async () => {
    const store = await loadGraph();
    addDocumentToStore(store, docNode, chapterNodes, labels);
    await saveGraph(store);
    if (items.length) {
      const emb = await loadEmbeddings();
      removeDocEmbeddings(emb, slug);
      emb.model = config.models.embed;
      emb.items.push(...items);
      await saveEmbeddings(emb);
    }
  });

  for (const w of works) {
    await fs.writeFile(
      path.join(docDir, w.file),
      renderChapterMarkdown(w.chapter, {
        doc: slug,
        docTitle: structured.title,
        category: w.category,
        summary: w.summary,
        keywords: w.keywords.map((k) => ({ term: labels.get(k.term) ?? k.term, weight: k.weight })),
      }),
      "utf8",
    );
  }
  await fs.writeFile(path.join(docDir, "index.md"), renderDocumentIndex(docNode, chapterNodes), "utf8");

  const result: IngestResult = {
    slug,
    title: structured.title,
    category: docCategory,
    chapters: chapterNodes.length,
    keywords: uniqueTerms.size,
    pages: extract.numPages,
    replaced,
  };
  yield progress("done", `완료: ${structured.title} (${chapterNodes.length}개 챕터, ${uniqueTerms.size}개 키워드)`, { result });
  return result;
}

function dedupeRefs(refs: KeywordRef[]): KeywordRef[] {
  const map = new Map<string, number>();
  for (const r of refs) {
    if (!r.term) continue;
    map.set(r.term, Math.max(map.get(r.term) ?? 0, r.weight));
  }
  return [...map].map(([term, weight]) => ({ term, weight })).sort((a, b) => b.weight - a.weight);
}

function topTerms(works: ChapterWork[], n: number): string[] {
  const agg = new Map<string, number>();
  for (const w of works) for (const k of w.keywords) agg.set(k.term, (agg.get(k.term) ?? 0) + k.weight);
  return [...agg].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

/** Keyword fallback when the model is unavailable: title words plus frequent capitalised tokens. */
function fallbackKeywords(w: ChapterWork, labels: Map<string, string>): KeywordRef[] {
  const stop = new Set(["the", "and", "of", "in", "to", "for", "with", "on", "by", "an", "a", "is", "are", "from", "that", "this"]);
  const counts = new Map<string, { label: string; n: number }>();
  const add = (raw: string, bonus = 0) => {
    const term = normalizeKeyword(raw);
    if (term.length < 2 || stop.has(term) || /^\d+$/.test(term)) return;
    const e = counts.get(term) ?? { label: raw, n: 0 };
    e.n += 1 + bonus;
    counts.set(term, e);
  };
  for (const word of w.chapter.title.split(/[\s,:;()]+/)) add(word, 3);
  for (const m of w.text.matchAll(/\b[A-Z][a-zA-Z]{3,}\b|[가-힣]{2,}/g)) add(m[0]);
  const top = [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const max = top[0]?.[1].n ?? 1;
  for (const [term, e] of top) if (!labels.has(term)) labels.set(term, e.label);
  return top.map(([term, e]) => ({ term, weight: Math.round((e.n / max) * 100) / 100 }));
}
