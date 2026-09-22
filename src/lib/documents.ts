/**
 * Read helpers over raw_data/ and the graph store used by API routes and pages.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { loadEmbeddings, removeDocEmbeddings, saveEmbeddings } from "./embeddings";
import { graphMutex, loadGraph, removeDocumentFromStore, saveGraph } from "./graph";
import { bodyToPlainText, parseMarkdown } from "./markdown";
import type { ChapterNode, DocumentNode, GraphStore } from "./types";

export interface ChapterContent {
  node: ChapterNode;
  frontmatter: Record<string, unknown>;
  body: string;
  plain: string;
}

export async function listDocuments(store?: GraphStore): Promise<DocumentNode[]> {
  const s = store ?? (await loadGraph());
  return Object.values(s.documents).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getDocument(slug: string, store?: GraphStore): Promise<{ doc: DocumentNode; chapters: ChapterNode[] } | null> {
  const s = store ?? (await loadGraph());
  const doc = s.documents[slug];
  if (!doc) return null;
  const chapters = doc.chapters.map((id) => s.chapters[id]).filter(Boolean);
  return { doc, chapters };
}

export function chapterFilePath(node: ChapterNode): string {
  const abs = path.resolve(config.rawDataDir, node.path);
  if (!abs.startsWith(path.resolve(config.rawDataDir))) throw new Error("invalid chapter path");
  return abs;
}

export async function readChapter(id: string, store?: GraphStore): Promise<ChapterContent | null> {
  const s = store ?? (await loadGraph());
  const node = s.chapters[id];
  if (!node) return null;
  let content: string;
  try {
    content = await fs.readFile(chapterFilePath(node), "utf8");
  } catch {
    return { node, frontmatter: {}, body: "", plain: "" };
  }
  const { frontmatter, body } = parseMarkdown(content);
  return { node, frontmatter, body, plain: bodyToPlainText(body) };
}

/** Plain text of many chapters at once (used by keyword search). */
export async function readChapterTexts(store: GraphStore, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      const c = await readChapter(id, store);
      if (c) out.set(id, c.plain);
    }),
  );
  return out;
}

export async function deleteDocument(slug: string): Promise<boolean> {
  return graphMutex.run(async () => {
    const store = await loadGraph();
    const removed = removeDocumentFromStore(store, slug);
    if (!removed) return false;
    await saveGraph(store);
    const emb = await loadEmbeddings();
    removeDocEmbeddings(emb, slug);
    await saveEmbeddings(emb);
    await fs.rm(path.join(config.rawDataDir, slug), { recursive: true, force: true });
    await fs.rm(path.join(config.uploadsDir, `${slug}.pdf`), { force: true });
    return true;
  });
}
