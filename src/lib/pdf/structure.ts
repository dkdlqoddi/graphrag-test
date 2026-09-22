/**
 * Rebuilds paragraphs and chapters from extracted PDF lines.
 * Heading detection is heuristic (font size, weight, numbering); chapter
 * selection prefers an LLM pass over the heading candidates and falls back to
 * heuristics when the model is unavailable.
 */
import { isCJK } from "../util";
import type { Line, PageText, PdfExtract } from "./extract";

export interface Paragraph {
  text: string;
  page: number;
  /** 1 = chapter title, 2/3 = sub headings, undefined = body text. */
  heading?: 1 | 2 | 3;
  fontSize: number;
}

export interface Chapter {
  index: number;
  title: string;
  pages: [number, number];
  paragraphs: Paragraph[];
  chars: number;
}

export interface StructuredDoc {
  title: string;
  chapters: Chapter[];
  bodyFontSize: number;
  method: "llm" | "numbered" | "font-size" | "pages";
}

export interface HeadingCandidate {
  index: number; // paragraph index
  page: number;
  size: number;
  bold: boolean;
  numbered: "top" | "sub" | "none";
  text: string;
}

export interface StructureOptions {
  fallbackTitle: string;
  maxChapters: number;
  /** Returns selected candidate indices (paragraph indexes) with cleaned titles, or null to fall back. */
  selectChapters?: (
    candidates: HeadingCandidate[],
    docTitle: string,
  ) => Promise<{ index: number; title: string }[] | null>;
}

const TOP_NUMBER_RE = [
  /^(chapter|part|section|appendix|unit|lesson)\s+([0-9]{1,3}|[ivxlc]{1,6})\b/i,
  /^제\s*[0-9]{1,3}\s*[장절편부과강]\b/,
  /^[0-9]{1,2}\.?\s+[^\d\s.].{1,90}$/,
  /^[IVX]{1,5}\.\s+\S.{1,90}$/,
];
const SUB_NUMBER_RE = [/^[0-9]{1,2}(\.[0-9]{1,2}){1,3}\.?\s+\S/, /^[0-9]{1,2}\.[0-9]{1,2}\s/];
const SECTION_WORDS =
  /^(abstract|introduction|background|related work|methods?|methodology|results?|discussion|conclusions?|summary|references|bibliography|acknowledg(e)?ments?|appendix|preface|foreword|contents|table of contents|index|glossary|요약|초록|서론|서문|머리말|들어가며|본론|결론|맺음말|나가며|참고\s*문헌|부록|목차|감사의\s*글)$/i;
const TERMINAL_RE = /[.!?。」』"”)\]]\s*$/;

export async function structureDocument(extract: PdfExtract, opts: StructureOptions): Promise<StructuredDoc> {
  const pages = removeRunningHeaders(extract.pages);
  const bodyFontSize = estimateBodyFontSize(pages);
  const paragraphs = buildParagraphs(pages, bodyFontSize);
  const title = pickTitle(extract, pages, bodyFontSize, opts.fallbackTitle);

  const candidates = collectHeadingCandidates(paragraphs, bodyFontSize);
  let selected: { index: number; title: string }[] | null = null;
  let method: StructuredDoc["method"] = "pages";

  if (candidates.length > 0 && opts.selectChapters) {
    try {
      const llm = await opts.selectChapters(trimCandidates(candidates, 250), title);
      if (llm && llm.length > 0) {
        selected = sanitizeSelection(llm, paragraphs.length);
        method = "llm";
      }
    } catch (err) {
      console.warn("[structure] LLM chapter selection failed, falling back:", err);
    }
  }

  if (!selected || selected.length === 0) {
    const heuristic = heuristicSelection(candidates);
    if (heuristic) {
      selected = heuristic.selection;
      method = heuristic.method;
    }
  }

  let chapters: Chapter[];
  if (selected && selected.length > 0) {
    chapters = splitByHeadings(paragraphs, selected, bodyFontSize, title);
  } else {
    chapters = splitByPages(paragraphs, extract.numPages);
    method = "pages";
  }

  chapters = mergeTinyChapters(chapters, opts.maxChapters);
  chapters.forEach((c, i) => (c.index = i + 1));
  return { title, chapters, bodyFontSize, method };
}

/* ---------------- running headers / footers ---------------- */

function normalizeForRepeat(text: string): string {
  return text.replace(/[0-9]+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

function removeRunningHeaders(pages: PageText[]): PageText[] {
  if (pages.length < 3) return pages.map(stripPageNumbers);
  const counts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const l of p.lines) {
      if (!isEdgeLine(l, p)) continue;
      const key = normalizeForRepeat(l.text);
      if (key.length < 3 || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.4));
  const repeated = new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k));
  return pages
    .map((p) => ({
      ...p,
      lines: p.lines.filter((l) => !(isEdgeLine(l, p) && repeated.has(normalizeForRepeat(l.text)))),
    }))
    .map(stripPageNumbers);
}

function isEdgeLine(l: Line, p: PageText): boolean {
  return l.y > p.height * 0.9 || l.y < p.height * 0.09;
}

function stripPageNumbers(p: PageText): PageText {
  return {
    ...p,
    lines: p.lines.filter((l) => {
      if (!isEdgeLine(l, p)) return true;
      const t = l.text.trim();
      return !(
        /^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(t) ||
        /^(page|p\.|pg\.?)\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(t) ||
        /^\d+\s*\/\s*\d+$/.test(t) ||
        /^[ivxlc]{1,6}$/i.test(t)
      );
    }),
  };
}

/* ---------------- font statistics ---------------- */

function estimateBodyFontSize(pages: PageText[]): number {
  const weights = new Map<number, number>();
  for (const p of pages) {
    for (const l of p.lines) {
      const key = Math.round(l.fontSize * 2) / 2;
      weights.set(key, (weights.get(key) ?? 0) + l.text.length);
    }
  }
  let best = 10;
  let bestW = -1;
  for (const [size, w] of weights) {
    if (w > bestW) {
      best = size;
      bestW = w;
    }
  }
  return best;
}

/* ---------------- paragraphs ---------------- */

function numberedKind(text: string): "top" | "sub" | "none" {
  if (SUB_NUMBER_RE.some((re) => re.test(text))) return "sub";
  if (TOP_NUMBER_RE.some((re) => re.test(text))) return "top";
  return "none";
}

function isHeadingLine(l: Line, body: number): boolean {
  const t = l.text.trim();
  if (t.length < 2 || t.length > 140) return false;
  if (/https?:\/\//i.test(t)) return false;
  const words = t.split(/\s+/).length;
  const big = l.fontSize >= body * 1.15;
  const slightlyBig = l.fontSize >= body * 1.05;
  const endsLikeSentence = /[.,;:]$/.test(t) && !/\d\.$/.test(t);
  if (big && words <= 24 && !(endsLikeSentence && words > 8)) return true;
  if (l.bold && words <= 16 && !endsLikeSentence && l.fontSize >= body * 0.95) return true;
  const kind = numberedKind(t);
  if (kind !== "none" && words <= 18 && !endsLikeSentence && (slightlyBig || l.bold || l.fontSize >= body * 0.98)) {
    return true;
  }
  if (SECTION_WORDS.test(t) && (slightlyBig || l.bold || words <= 2)) return true;
  return false;
}

function joinLines(prev: string, next: string): string {
  const a = prev.trimEnd();
  const b = next.trimStart();
  if (!a) return b;
  if (!b) return a;
  const last = a[a.length - 1];
  const first = b[0];
  if (last === "-" && /[a-z가-힣]/.test(first)) return a.slice(0, -1) + b;
  if (isCJK(last) && isCJK(first)) return a + b;
  return a + " " + b;
}

function buildParagraphs(pages: PageText[], body: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let current: { lines: Line[]; heading?: 1 | 2 | 3 } | null = null;

  const flush = () => {
    if (!current || current.lines.length === 0) return;
    const text = current.lines.map((l) => l.text).reduce((acc, t) => joinLines(acc, t), "");
    const first = current.lines[0];
    const size = current.lines.reduce((s, l) => s + l.fontSize, 0) / current.lines.length;
    if (text.trim().length > 0) {
      paragraphs.push({
        text: text.trim(),
        page: first.page,
        heading: current.heading,
        fontSize: Math.round(size * 10) / 10,
      });
    }
    current = null;
  };

  for (const page of pages) {
    const spacing = estimateLineSpacing(page);
    const rightEdges = columnRightEdges(page);
    let prev: Line | null = null;

    for (const line of page.lines) {
      const heading = isHeadingLine(line, body);

      if (heading) {
        // Merge multi-line headings with matching size that sit right below each other.
        if (
          current?.heading &&
          prev &&
          prev.page === line.page &&
          Math.abs(prev.fontSize - line.fontSize) < 0.6 &&
          prev.y - line.y < spacing * 1.8 &&
          numberedKind(line.text) === "none"
        ) {
          current.lines.push(line);
        } else {
          flush();
          current = { lines: [line], heading: 1 };
        }
        prev = line;
        continue;
      }

      let newPara = !current || !!current.heading;
      if (!newPara && prev) {
        const sizeChanged = Math.abs(prev.fontSize - line.fontSize) > 1.0;
        const samePage = prev.page === line.page;
        const sameColumn = prev.column === line.column && prev.full === line.full;
        const gap = samePage ? prev.y - line.y : Infinity;
        const bigGap = samePage && sameColumn && gap > spacing * 1.65;
        const paraLeft = current ? Math.min(...current.lines.map((l) => l.x)) : line.x;
        const indented = samePage && sameColumn && line.x - paraLeft > line.fontSize * 0.9 && current!.lines.length >= 1;
        const rightEdge = rightEdges[line.column] ?? page.width;
        const prevShort = prev.right < rightEdge - prev.fontSize * 2.2;
        const prevTerminal = TERMINAL_RE.test(prev.text);
        const endedShort = prevTerminal && prevShort;
        const crossedBoundary = !samePage || !sameColumn;
        newPara = sizeChanged || bigGap || indented || endedShort || (crossedBoundary && prevTerminal);
      }

      if (newPara) {
        flush();
        current = { lines: [line] };
      } else {
        current!.lines.push(line);
      }
      prev = line;
    }
  }
  flush();

  return paragraphs.filter((p) => p.text.length >= 2 && !/^[\d\s.,;:-]+$/.test(p.text));
}

function estimateLineSpacing(page: PageText): number {
  const gaps: number[] = [];
  const byColumn = new Map<number, Line[]>();
  for (const l of page.lines) {
    const key = l.full ? 2 : l.column;
    (byColumn.get(key) ?? byColumn.set(key, []).get(key)!).push(l);
  }
  for (const lines of byColumn.values()) {
    const sorted = [...lines].sort((a, b) => b.y - a.y);
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i - 1].y - sorted[i].y;
      if (g > 0.5 && g < 60) gaps.push(g);
    }
  }
  if (gaps.length === 0) return 12;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function columnRightEdges(page: PageText): Record<number, number> {
  const groups: Record<number, number[]> = { 0: [], 1: [] };
  for (const l of page.lines) {
    if (l.full) continue;
    groups[l.column].push(l.right);
  }
  const result: Record<number, number> = {};
  for (const col of [0, 1]) {
    const arr = groups[col].sort((a, b) => a - b);
    if (arr.length === 0) continue;
    result[col] = arr[Math.floor(arr.length * 0.9)];
  }
  if (result[0] === undefined) result[0] = page.width * 0.9;
  return result;
}

/* ---------------- title ---------------- */

function pickTitle(extract: PdfExtract, pages: PageText[], body: number, fallback: string): string {
  const meta = extract.metaTitle?.trim();
  if (meta && meta.length >= 3 && meta.length <= 200 && !/^(untitled|microsoft word|document|title)\b/i.test(meta)) {
    if (!/\.(docx?|pdf|tex|pptx?)$/i.test(meta)) return meta;
  }
  const first = pages[0];
  if (first) {
    const candidates = first.lines
      .filter((l) => l.text.length >= 3 && l.text.length <= 160 && l.fontSize >= body * 1.2)
      .sort((a, b) => b.fontSize - a.fontSize || b.y - a.y);
    if (candidates.length) {
      const top = candidates[0];
      const siblings = first.lines
        .filter((l) => Math.abs(l.fontSize - top.fontSize) < 0.6 && Math.abs(l.y - top.y) < top.fontSize * 4)
        .sort((a, b) => b.y - a.y);
      const text = siblings.map((l) => l.text).join(" ").trim();
      if (text.length >= 3 && text.length <= 200) return text;
      return top.text;
    }
  }
  return fallback;
}

/* ---------------- chapter selection ---------------- */

function collectHeadingCandidates(paragraphs: Paragraph[], body: number): HeadingCandidate[] {
  const out: HeadingCandidate[] = [];
  paragraphs.forEach((p, i) => {
    if (!p.heading) return;
    if (p.text.length > 140) return;
    out.push({
      index: i,
      page: p.page,
      size: Math.round(p.fontSize * 10) / 10,
      bold: p.fontSize >= body * 1.15,
      numbered: numberedKind(p.text),
      text: p.text,
    });
  });
  return out;
}

function trimCandidates(cands: HeadingCandidate[], max: number): HeadingCandidate[] {
  if (cands.length <= max) return cands;
  const ranked = [...cands].sort((a, b) => {
    const na = a.numbered === "top" ? 1 : 0;
    const nb = b.numbered === "top" ? 1 : 0;
    return nb - na || b.size - a.size;
  });
  return ranked.slice(0, max).sort((a, b) => a.index - b.index);
}

function sanitizeSelection(sel: { index: number; title: string }[], total: number) {
  const seen = new Set<number>();
  return sel
    .filter((s) => Number.isInteger(s.index) && s.index >= 0 && s.index < total && !seen.has(s.index) && seen.add(s.index))
    .sort((a, b) => a.index - b.index)
    .map((s) => ({ index: s.index, title: s.title.trim() }));
}

function heuristicSelection(
  cands: HeadingCandidate[],
): { selection: { index: number; title: string }[]; method: StructuredDoc["method"] } | null {
  const numbered = cands.filter((c) => c.numbered === "top");
  if (numbered.length >= 2 && numbered.length <= 80) {
    return { selection: numbered.map((c) => ({ index: c.index, title: c.text })), method: "numbered" };
  }
  const bySize = new Map<number, HeadingCandidate[]>();
  for (const c of cands) {
    const key = Math.round(c.size);
    (bySize.get(key) ?? bySize.set(key, []).get(key)!).push(c);
  }
  const sizes = [...bySize.keys()].sort((a, b) => b - a);
  for (const size of sizes) {
    const group = bySize.get(size)!;
    if (group.length >= 2 && group.length <= 80) {
      return { selection: group.map((c) => ({ index: c.index, title: c.text })), method: "font-size" };
    }
  }
  return null;
}

/* ---------------- chapter assembly ---------------- */

function splitByHeadings(
  paragraphs: Paragraph[],
  selected: { index: number; title: string }[],
  bodySize: number,
  docTitle: string,
): Chapter[] {
  const chapters: Chapter[] = [];
  const starts = selected.map((s) => s.index);
  const firstStart = starts[0];

  const makeChapter = (title: string, paras: Paragraph[]): Chapter => {
    const pagesSeen = paras.map((p) => p.page);
    const pageStart = pagesSeen.length ? Math.min(...pagesSeen) : 1;
    const pageEnd = pagesSeen.length ? Math.max(...pagesSeen) : pageStart;
    return {
      index: 0,
      title,
      pages: [pageStart, pageEnd],
      paragraphs: paras,
      chars: paras.reduce((s, p) => s + p.text.length, 0),
    };
  };

  const front = paragraphs.slice(0, firstStart).map((p) => demote(p, bodySize));
  const frontBody = front.filter((p) => !p.heading);
  if (frontBody.reduce((s, p) => s + p.text.length, 0) >= 200) {
    chapters.push(makeChapter(`서두 · ${docTitle}`.slice(0, 120), front));
  }

  for (let i = 0; i < selected.length; i++) {
    const start = selected[i].index;
    const end = i + 1 < selected.length ? selected[i + 1].index : paragraphs.length;
    const paras = paragraphs.slice(start + 1, end).map((p) => demote(p, bodySize));
    const title = selected[i].title || paragraphs[start].text;
    chapters.push(makeChapter(title, paras));
    if (chapters.length > 1 && chapters[chapters.length - 1].paragraphs.length === 0) {
      chapters[chapters.length - 1].pages = [paragraphs[start].page, paragraphs[start].page];
    }
  }
  return chapters;
}

function demote(p: Paragraph, body: number): Paragraph {
  if (!p.heading) return p;
  const level: 2 | 3 = p.fontSize >= body * 1.15 ? 2 : 3;
  return { ...p, heading: level };
}

function splitByPages(paragraphs: Paragraph[], numPages: number): Chapter[] {
  const groups = Math.min(12, Math.max(1, Math.ceil(numPages / 6)));
  const per = Math.max(1, Math.ceil(numPages / groups));
  const chapters: Chapter[] = [];
  for (let start = 1; start <= numPages; start += per) {
    const end = Math.min(numPages, start + per - 1);
    const paras = paragraphs.filter((p) => p.page >= start && p.page <= end).map((p) => (p.heading ? { ...p, heading: 2 as const } : p));
    if (paras.length === 0) continue;
    chapters.push({
      index: 0,
      title: `Part ${chapters.length + 1} (pp. ${start}–${end})`,
      pages: [start, end],
      paragraphs: paras,
      chars: paras.reduce((s, p) => s + p.text.length, 0),
    });
  }
  return chapters;
}

function mergeTinyChapters(chapters: Chapter[], maxChapters: number): Chapter[] {
  let out = [...chapters];
  const mergeInto = (target: Chapter, source: Chapter, keepTitle: "target" | "source") => {
    const titlePara: Paragraph = { text: source.title, page: source.pages[0], heading: 2, fontSize: 0 };
    if (keepTitle === "target") {
      target.paragraphs = [...target.paragraphs, titlePara, ...source.paragraphs];
    } else {
      const ownTitle: Paragraph = { text: target.title, page: target.pages[0], heading: 2, fontSize: 0 };
      target.paragraphs = [ownTitle, ...target.paragraphs, ...source.paragraphs];
      target.title = source.title;
    }
    target.pages = [Math.min(target.pages[0], source.pages[0]), Math.max(target.pages[1], source.pages[1])];
    target.chars = target.paragraphs.reduce((s, p) => s + p.text.length, 0);
  };

  // Fold chapters with almost no text into their predecessor (or successor for the first one).
  for (let i = 0; i < out.length && out.length > 1; ) {
    const c = out[i];
    if (c.chars < 300) {
      if (i > 0) {
        mergeInto(out[i - 1], c, "target");
        out.splice(i, 1);
      } else {
        mergeInto(out[1], c, "source");
        out.splice(0, 1);
      }
      continue;
    }
    i++;
  }

  // Cap the number of chapters by merging the smallest adjacent pairs.
  while (out.length > maxChapters) {
    let bestI = 0;
    let bestSum = Infinity;
    for (let i = 0; i + 1 < out.length; i++) {
      const sum = out[i].chars + out[i + 1].chars;
      if (sum < bestSum) {
        bestSum = sum;
        bestI = i;
      }
    }
    mergeInto(out[bestI], out[bestI + 1], "target");
    out.splice(bestI + 1, 1);
  }
  out = out.filter((c) => c.paragraphs.length > 0 || out.length === 1);
  return out;
}
