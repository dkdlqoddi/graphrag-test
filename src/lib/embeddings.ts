/**
 * Chunk-level embeddings persisted in data/embeddings.json and brute-force
 * cosine retrieval (fine for hundreds of documents).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { getOpenAI } from "./openai";
import type { Paragraph } from "./pdf/structure";
import type { EmbeddingItem, EmbeddingStore } from "./types";
import { cosine } from "./util";

export async function loadEmbeddings(): Promise<EmbeddingStore> {
  try {
    const raw = await fs.readFile(config.embeddingsFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<EmbeddingStore>;
    return { model: parsed.model ?? config.models.embed, items: parsed.items ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { model: config.models.embed, items: [] };
    throw err;
  }
}

export async function saveEmbeddings(store: EmbeddingStore): Promise<void> {
  await fs.mkdir(path.dirname(config.embeddingsFile), { recursive: true });
  const tmp = `${config.embeddingsFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store), "utf8");
  await fs.rename(tmp, config.embeddingsFile);
}

export function removeDocEmbeddings(store: EmbeddingStore, slug: string): void {
  store.items = store.items.filter((i) => i.doc !== slug);
}

/** Group paragraphs into chunks of roughly `config.ingest.chunkChars` characters. */
export function chunkParagraphs(
  paragraphs: Paragraph[],
  header: string,
  target = config.ingest.chunkChars,
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    if (current.length) chunks.push(`${header}\n\n${current.join("\n\n")}`);
    current = [];
    size = 0;
  };
  for (const p of paragraphs) {
    const text = p.heading ? `[${p.text}]` : p.text;
    if (size + text.length > target && current.length > 0) flush();
    if (text.length > target * 2) {
      // very long paragraph: split on sentence boundaries
      const parts = text.match(/[^.!?。]+[.!?。]?\s*/g) ?? [text];
      let buf = "";
      for (const part of parts) {
        if (buf.length + part.length > target && buf) {
          current.push(buf.trim());
          flush();
          buf = "";
        }
        buf += part;
      }
      if (buf.trim()) current.push(buf.trim());
      size += buf.length;
      continue;
    }
    current.push(text);
    size += text.length;
  }
  flush();
  return chunks;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = getOpenAI();
  const out: number[][] = [];
  const batch = 64;
  for (let i = 0; i < texts.length; i += batch) {
    const slice = texts.slice(i, i + batch).map((t) => t.slice(0, 8000));
    const res = await openai.embeddings.create({ model: config.models.embed, input: slice });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const d of sorted) out.push(d.embedding.map((v) => Math.round(v * 1e5) / 1e5));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v;
}

export function topKSimilar(
  store: EmbeddingStore,
  vector: number[],
  k: number,
): { item: EmbeddingItem; score: number }[] {
  const scored = store.items.map((item) => ({ item, score: cosine(vector, item.vector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
