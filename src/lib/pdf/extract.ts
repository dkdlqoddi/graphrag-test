/**
 * PDF text extraction built on pdf.js. Produces lines in reading order with
 * geometry and font hints so that `structure.ts` can rebuild paragraphs and
 * detect chapter headings.
 */
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface Line {
  text: string;
  page: number;
  x: number; // left edge (PDF user space, origin bottom-left)
  right: number; // right edge
  y: number; // baseline
  fontSize: number;
  bold: boolean;
  full: boolean; // spans most of the page width (title, abstract, captions)
  column: 0 | 1; // 0 = left/full, 1 = right column
}

export interface PageText {
  page: number;
  width: number;
  height: number;
  lines: Line[]; // reading order
  twoColumn: boolean;
}

export interface PdfExtract {
  numPages: number;
  pages: PageText[];
  metaTitle?: string;
}

interface Run {
  str: string;
  x: number;
  right: number;
  y: number;
  fontSize: number;
  bold: boolean;
}

interface Segment {
  runs: Run[];
  x: number;
  right: number;
  y: number;
  fontSize: number;
  bold: boolean;
}

const BOLD_RE = /bold|black|heavy|semibold|demibold|extrabold|ultrabold|\bbd\b|-b$/i;

export async function extractPdf(data: Uint8Array): Promise<PdfExtract> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js transfers the buffer to its worker (detaching it), so hand it a copy.
  const task = pdfjs.getDocument({
    data: data.slice(),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;

  let metaTitle: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: unknown } | undefined;
    if (info && typeof info.Title === "string") metaTitle = info.Title.trim();
  } catch {
    /* metadata is optional */
  }

  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const boldCache = new Map<string, boolean>();

    const runs: Run[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const t = item as TextItem;
      if (!t.str || !t.str.trim()) continue;
      const [a, b, c, d, e, f] = t.transform as number[];
      const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || t.height || 10;
      let bold = boldCache.get(t.fontName);
      if (bold === undefined) {
        bold = false;
        try {
          if (page.commonObjs.has(t.fontName)) {
            const font = page.commonObjs.get(t.fontName) as { name?: string } | null;
            bold = BOLD_RE.test(font?.name ?? "");
          }
        } catch {
          bold = false;
        }
        boldCache.set(t.fontName, bold);
      }
      runs.push({ str: t.str, x: e, right: e + t.width, y: f, fontSize, bold });
    }
    page.cleanup();

    pages.push(buildPage(p, viewport.width, viewport.height, runs));
  }
  await task.destroy();

  return { numPages: doc.numPages, pages, metaTitle };
}

function buildPage(pageNo: number, width: number, height: number, runs: Run[]): PageText {
  // 1) group runs into horizontal bands by baseline.
  runs.sort((r1, r2) => r2.y - r1.y || r1.x - r2.x);
  const bands: Run[][] = [];
  for (const run of runs) {
    const band = bands[bands.length - 1];
    if (band) {
      const ref = band[0];
      const tol = Math.max(1.5, 0.4 * Math.max(ref.fontSize, run.fontSize));
      if (Math.abs(ref.y - run.y) <= tol) {
        band.push(run);
        continue;
      }
    }
    bands.push([run]);
  }

  // 2) split each band into segments where a large horizontal gap occurs (columns).
  const segments: Segment[] = [];
  for (const band of bands) {
    band.sort((r1, r2) => r1.x - r2.x);
    let current: Run[] = [];
    const flush = () => {
      if (current.length) segments.push(toSegment(current));
      current = [];
    };
    for (const run of band) {
      const prev = current[current.length - 1];
      if (prev && run.x - prev.right > 2.5 * Math.max(prev.fontSize, run.fontSize)) flush();
      current.push(run);
    }
    flush();
  }

  // 3) column detection.
  const mid = width * 0.45;
  const isFull = (s: Segment) => s.right - s.x > 0.55 * width || (s.x < width * 0.4 && s.right > width * 0.62);
  const partial = segments.filter((s) => !isFull(s));
  const left = partial.filter((s) => s.x < mid).length;
  const right = partial.length - left;
  const twoColumn =
    partial.length >= 10 && left >= 5 && right >= 5 && left / partial.length > 0.2 && right / partial.length > 0.2;

  // 4) reading order.
  segments.sort((s1, s2) => s2.y - s1.y || s1.x - s2.x);
  const ordered: Segment[] = [];
  if (!twoColumn) {
    ordered.push(...segments);
  } else {
    let leftBand: Segment[] = [];
    let rightBand: Segment[] = [];
    const flushBand = () => {
      ordered.push(...leftBand, ...rightBand);
      leftBand = [];
      rightBand = [];
    };
    for (const s of segments) {
      if (isFull(s)) {
        flushBand();
        ordered.push(s);
      } else if (s.x < mid) leftBand.push(s);
      else rightBand.push(s);
    }
    flushBand();
  }

  const lines: Line[] = ordered.map((s) => ({
    text: s.runs.map((r) => r.str).join("").replace(/\s+/g, " ").trim(),
    page: pageNo,
    x: s.x,
    right: s.right,
    y: s.y,
    fontSize: s.fontSize,
    bold: s.bold,
    full: isFull(s),
    column: twoColumn && !isFull(s) && s.x >= mid ? 1 : 0,
  }));

  return { page: pageNo, width, height, lines: lines.filter((l) => l.text.length > 0), twoColumn };
}

function toSegment(runs: Run[]): Segment {
  // Insert spaces where glyph runs are visibly separated.
  const merged: Run[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gap = run.x - prev.right;
      const needsSpace = gap > 0.12 * run.fontSize && !/\s$/.test(prev.str) && !/^\s/.test(run.str);
      if (needsSpace) prev.str += " ";
    }
    merged.push({ ...run });
  }
  let weightedSize = 0;
  let chars = 0;
  let boldChars = 0;
  for (const r of merged) {
    const n = r.str.length;
    weightedSize += r.fontSize * n;
    chars += n;
    if (r.bold) boldChars += n;
  }
  const fontSize = chars ? weightedSize / chars : merged[0].fontSize;
  return {
    runs: merged,
    x: Math.min(...merged.map((r) => r.x)),
    right: Math.max(...merged.map((r) => r.right)),
    y: merged[0].y,
    fontSize: Math.round(fontSize * 10) / 10,
    bold: chars > 0 && boldChars / chars > 0.6,
  };
}
