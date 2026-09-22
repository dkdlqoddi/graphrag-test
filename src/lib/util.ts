import crypto from "node:crypto";

/** URL/folder-safe slug that keeps Hangul so Korean titles stay readable. */
export function slugify(input: string, maxLen = 60): string {
  const base = input
    .normalize("NFC")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  if (base.length >= 2) return base;
  return "doc-" + crypto.createHash("sha1").update(input).digest("hex").slice(0, 8);
}

/** Canonical form of a keyword used as a graph key. */
export function normalizeKeyword(term: string): string {
  return term
    .normalize("NFC")
    .trim()
    .replace(/^[\s"'“”‘’`([{]+|[\s"'“”‘’`)\]}.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function chapterId(slug: string, index: number): string {
  return `${slug}__c${index}`;
}

export function parseChapterId(id: string): { slug: string; index: number } | null {
  const m = /^(.*)__c(\d+)$/.exec(id);
  if (!m) return null;
  return { slug: m[1], index: Number(m[2]) };
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onDone?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      done++;
      onDone?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Simple async mutex so only one ingestion mutates the stores at a time. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function isCJK(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
    (c >= 0x1100 && c <= 0x11ff) || // Hangul jamo
    (c >= 0x3130 && c <= 0x318f) || // Hangul compat jamo
    (c >= 0x4e00 && c <= 0x9fff) || // CJK unified
    (c >= 0x3040 && c <= 0x30ff) // Kana
  );
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Encode one Server-Sent Event frame. */
export function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** Turn an async generator of events into a streaming SSE Response. */
export function sseResponse<T>(events: AsyncGenerator<T, unknown, unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of events) {
          controller.enqueue(encoder.encode(sseFrame(ev)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(sseFrame({ type: "error", message })));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
