/**
 * Persistent graph store (data/graph.json) plus derived views.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { majorityCategory, type CategoryId } from "./categories";
import { config } from "./config";
import type {
  ChapterNode,
  DocumentNode,
  GraphEdge,
  GraphStore,
  GraphView,
  KeywordNode,
  ViewLink,
  ViewNode,
} from "./types";
import { Mutex } from "./util";

export const graphMutex = new Mutex();

export function emptyGraph(): GraphStore {
  return { version: 1, updatedAt: new Date(0).toISOString(), documents: {}, chapters: {}, keywords: {}, edges: [] };
}

export async function loadGraph(): Promise<GraphStore> {
  try {
    const raw = await fs.readFile(config.graphFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<GraphStore>;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      documents: parsed.documents ?? {},
      chapters: parsed.chapters ?? {},
      keywords: parsed.keywords ?? {},
      edges: parsed.edges ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyGraph();
    throw err;
  }
}

export async function saveGraph(store: GraphStore): Promise<void> {
  store.updatedAt = new Date().toISOString();
  store.edges = computeEdges(store);
  await fs.mkdir(path.dirname(config.graphFile), { recursive: true });
  const tmp = `${config.graphFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, config.graphFile);
}

/* ---------------- mutations ---------------- */

export function removeDocumentFromStore(store: GraphStore, slug: string): boolean {
  const doc = store.documents[slug];
  if (!doc) return false;
  for (const cid of Object.keys(store.chapters)) {
    if (store.chapters[cid].doc === slug) delete store.chapters[cid];
  }
  delete store.documents[slug];
  rebuildKeywordIndex(store);
  return true;
}

export function addDocumentToStore(
  store: GraphStore,
  doc: DocumentNode,
  chapters: ChapterNode[],
  labels: Map<string, string>,
): void {
  removeDocumentFromStore(store, doc.slug);
  store.documents[doc.slug] = doc;
  for (const c of chapters) store.chapters[c.id] = c;
  for (const [term, label] of labels) {
    if (!store.keywords[term]) {
      store.keywords[term] = { term, label, category: "misc", chapters: [], docs: [], count: 0 };
    }
  }
  rebuildKeywordIndex(store);
}

/** Recompute keyword membership, counts and categories from chapters. */
export function rebuildKeywordIndex(store: GraphStore): void {
  const labels = new Map<string, string>();
  for (const k of Object.values(store.keywords)) labels.set(k.term, k.label);

  const fresh: Record<string, KeywordNode> = {};
  const categoriesByTerm = new Map<string, CategoryId[]>();
  for (const chapter of Object.values(store.chapters)) {
    for (const ref of chapter.keywords) {
      const node =
        fresh[ref.term] ??
        (fresh[ref.term] = {
          term: ref.term,
          label: labels.get(ref.term) ?? ref.term,
          category: "misc",
          chapters: [],
          docs: [],
          count: 0,
        });
      node.chapters.push(chapter.id);
      if (!node.docs.includes(chapter.doc)) node.docs.push(chapter.doc);
      node.count = node.chapters.length;
      (categoriesByTerm.get(ref.term) ?? categoriesByTerm.set(ref.term, []).get(ref.term)!).push(chapter.category);
    }
  }
  for (const node of Object.values(fresh)) {
    node.category = majorityCategory(categoriesByTerm.get(node.term) ?? []);
  }
  store.keywords = fresh;
}

/* ---------------- derived edges ---------------- */

export function computeEdges(store: GraphStore): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const doc of Object.values(store.documents)) {
    for (const cid of doc.chapters) {
      if (store.chapters[cid]) edges.push({ source: doc.slug, target: cid, type: "contains", weight: 1 });
    }
  }
  const pair = new Map<string, number>();
  for (const chapter of Object.values(store.chapters)) {
    const terms = chapter.keywords.map((k) => k.term).filter((t) => store.keywords[t]);
    for (const ref of chapter.keywords) {
      if (!store.keywords[ref.term]) continue;
      edges.push({ source: chapter.id, target: ref.term, type: "mentions", weight: ref.weight });
    }
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        const [a, b] = terms[i] < terms[j] ? [terms[i], terms[j]] : [terms[j], terms[i]];
        const key = `${a}\u0000${b}`;
        pair.set(key, (pair.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, weight] of pair) {
    const [a, b] = key.split("\u0000");
    edges.push({ source: a, target: b, type: "cooccurs", weight });
  }
  const docs = Object.values(store.documents);
  for (let i = 0; i < docs.length; i++) {
    const termsA = new Set(docKeywordTerms(store, docs[i].slug));
    for (let j = i + 1; j < docs.length; j++) {
      let shared = 0;
      for (const t of docKeywordTerms(store, docs[j].slug)) if (termsA.has(t)) shared++;
      if (shared > 0) edges.push({ source: docs[i].slug, target: docs[j].slug, type: "shares", weight: shared });
    }
  }
  return edges;
}

export function docKeywordTerms(store: GraphStore, slug: string): string[] {
  const terms = new Set<string>();
  const doc = store.documents[slug];
  if (!doc) return [];
  for (const cid of doc.chapters) {
    for (const k of store.chapters[cid]?.keywords ?? []) terms.add(k.term);
  }
  return [...terms];
}

/** Keywords that co-occur with `term`, strongest first. */
export function keywordNeighbors(store: GraphStore, term: string, limit = 10): { term: string; weight: number }[] {
  const weights = new Map<string, number>();
  const node = store.keywords[term];
  if (!node) return [];
  for (const cid of node.chapters) {
    for (const ref of store.chapters[cid]?.keywords ?? []) {
      if (ref.term === term || !store.keywords[ref.term]) continue;
      weights.set(ref.term, (weights.get(ref.term) ?? 0) + 1);
    }
  }
  return [...weights]
    .map(([t, w]) => ({ term: t, weight: w }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

/* ---------------- force-graph view ---------------- */

export interface GraphViewOptions {
  includeChapters?: boolean;
  minKeywordCount?: number;
  maxKeywords?: number;
  cooccurPerKeyword?: number;
}

export function buildGraphView(store: GraphStore, opts: GraphViewOptions = {}): GraphView {
  const includeChapters = opts.includeChapters ?? true;
  const minCount = opts.minKeywordCount ?? 1;
  const maxKeywords = opts.maxKeywords ?? 400;
  const perKeyword = opts.cooccurPerKeyword ?? 4;

  const nodes: ViewNode[] = [];
  const links: ViewLink[] = [];

  for (const doc of Object.values(store.documents)) {
    nodes.push({
      id: doc.slug,
      kind: "document",
      label: doc.title,
      category: doc.category,
      size: 8 + Math.min(12, doc.chapters.length),
      summary: doc.summary,
      count: doc.chapters.length,
    });
  }
  if (includeChapters) {
    for (const ch of Object.values(store.chapters)) {
      nodes.push({
        id: ch.id,
        kind: "chapter",
        label: ch.title,
        category: ch.category,
        size: 3,
        doc: ch.doc,
        summary: ch.summary,
      });
    }
  }
  const keywords = Object.values(store.keywords)
    .filter((k) => k.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxKeywords);
  const kept = new Set(keywords.map((k) => k.term));
  for (const k of keywords) {
    nodes.push({ id: k.term, kind: "keyword", label: k.label, category: k.category, size: 1.5 + Math.min(10, k.count), count: k.count });
  }

  const cooccur = new Map<string, { source: string; target: string; weight: number }[]>();
  for (const e of store.edges) {
    switch (e.type) {
      case "contains":
        if (includeChapters) links.push(e);
        break;
      case "mentions":
        if (!kept.has(e.target)) break;
        if (includeChapters) links.push(e);
        else {
          const ch = store.chapters[e.source];
          if (ch) links.push({ source: ch.doc, target: e.target, type: "mentions", weight: e.weight });
        }
        break;
      case "cooccurs":
        if (kept.has(e.source) && kept.has(e.target)) {
          (cooccur.get(e.source) ?? cooccur.set(e.source, []).get(e.source)!).push(e);
          (cooccur.get(e.target) ?? cooccur.set(e.target, []).get(e.target)!).push(e);
        }
        break;
      case "shares":
        links.push(e);
        break;
    }
  }
  const seen = new Set<string>();
  for (const list of cooccur.values()) {
    list.sort((a, b) => b.weight - a.weight);
    for (const e of list.slice(0, perKeyword)) {
      const key = `${e.source}|${e.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: e.source, target: e.target, type: "cooccurs", weight: e.weight });
    }
  }
  // Collapse duplicate doc->keyword links created when chapters are hidden.
  const dedup = new Map<string, ViewLink>();
  for (const l of links) {
    const key = `${l.type}|${l.source}|${l.target}`;
    const prev = dedup.get(key);
    if (prev) prev.weight = Math.max(prev.weight, l.weight);
    else dedup.set(key, { ...l });
  }

  return {
    nodes,
    links: [...dedup.values()],
    stats: {
      documents: Object.keys(store.documents).length,
      chapters: Object.keys(store.chapters).length,
      keywords: Object.keys(store.keywords).length,
    },
  };
}
