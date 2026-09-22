import type { CategoryId } from "./categories";

/* ---------- Graph store (persisted in data/graph.json) ---------- */

export interface KeywordRef {
  term: string; // normalized key into GraphStore.keywords
  weight: number; // 0..1 relevance within the chapter
}

export interface DocumentNode {
  slug: string;
  title: string;
  sourceFile: string;
  pages: number;
  category: CategoryId;
  summary: string;
  keywords: string[]; // top document-level keyword terms
  chapters: string[]; // chapter ids in order
  createdAt: string;
}

export interface ChapterNode {
  id: string; // `${slug}__c${index}`
  doc: string;
  index: number; // 1-based
  title: string;
  path: string; // relative to raw_data/
  pages: [number, number];
  chars: number;
  summary: string;
  category: CategoryId;
  keywords: KeywordRef[];
}

export interface KeywordNode {
  term: string; // normalized
  label: string; // display form
  category: CategoryId;
  chapters: string[];
  docs: string[];
  count: number; // number of chapters mentioning it
}

export type EdgeType = "contains" | "mentions" | "cooccurs" | "shares";

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
}

export interface GraphStore {
  version: 1;
  updatedAt: string;
  documents: Record<string, DocumentNode>;
  chapters: Record<string, ChapterNode>;
  keywords: Record<string, KeywordNode>;
  edges: GraphEdge[];
}

/* ---------- Force-graph view (served by /api/graph) ---------- */

export interface ViewNode {
  id: string;
  kind: "document" | "chapter" | "keyword";
  label: string;
  category: CategoryId;
  size: number;
  doc?: string;
  summary?: string;
  count?: number;
}

export interface ViewLink {
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
}

export interface GraphView {
  nodes: ViewNode[];
  links: ViewLink[];
  stats: { documents: number; chapters: number; keywords: number };
}

/* ---------- Embeddings (persisted in data/embeddings.json) ---------- */

export interface EmbeddingItem {
  id: string; // `${chapterId}:${n}`
  chapter: string;
  doc: string;
  text: string;
  vector: number[];
}

export interface EmbeddingStore {
  model: string;
  items: EmbeddingItem[];
}

/* ---------- Search ---------- */

export type SearchMode = "keyword" | "llm";

export interface SearchSource {
  chapterId: string;
  doc: string;
  docTitle: string;
  chapterTitle: string;
  chapterIndex: number;
  path: string;
  pages: [number, number];
  score: number;
  snippet: string;
  matchedKeywords: string[];
  category: CategoryId;
}

export interface SearchKeyword {
  term: string;
  label: string;
  category: CategoryId;
  count: number;
  score: number;
}

export type SearchEvent =
  | { type: "category"; category: CategoryId; label: string }
  | { type: "keywords"; keywords: SearchKeyword[]; related: SearchKeyword[] }
  | { type: "sources"; sources: SearchSource[] }
  | { type: "delta"; text: string }
  | { type: "done"; mode: SearchMode; answer: string; query: string }
  | { type: "error"; message: string };

/* ---------- Ingestion ---------- */

export type IngestStage =
  | "parse"
  | "structure"
  | "write"
  | "keywords"
  | "link"
  | "embed"
  | "graph"
  | "done"
  | "error";

export interface IngestEvent {
  type: "progress";
  stage: IngestStage;
  message: string;
  done?: number;
  total?: number;
  result?: IngestResult;
}

export interface IngestResult {
  slug: string;
  title: string;
  category: CategoryId;
  chapters: number;
  keywords: number;
  pages: number;
  replaced: boolean;
}
