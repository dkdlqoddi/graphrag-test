/**
 * Markdown (with a small YAML-compatible frontmatter) reader/writer for the
 * chapter files stored under raw_data/.
 */
import type { Chapter } from "./pdf/structure";
import type { ChapterNode, DocumentNode } from "./types";
import { slugify } from "./util";

export type Frontmatter = Record<string, unknown>;

/** Values are JSON-encoded, which is also valid YAML flow syntax. */
export function stringifyFrontmatter(fm: Frontmatter): string {
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

export function parseMarkdown(content: string): { frontmatter: Frontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { frontmatter: {}, body: content };
  const frontmatter: Frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    try {
      frontmatter[key] = JSON.parse(raw);
    } catch {
      frontmatter[key] = raw;
    }
  }
  return { frontmatter, body: content.slice(m[0].length) };
}

export function chapterFileName(index: number, title: string): string {
  return `${String(index).padStart(2, "0")}-${slugify(title, 40)}.md`;
}

export interface ChapterMeta {
  doc: string;
  docTitle: string;
  category?: string;
  summary?: string;
  keywords?: { term: string; weight: number }[];
}

export function renderChapterMarkdown(chapter: Chapter, meta: ChapterMeta): string {
  const fm: Frontmatter = {
    doc: meta.doc,
    docTitle: meta.docTitle,
    chapter: chapter.index,
    title: chapter.title,
    pages: chapter.pages,
    category: meta.category,
    summary: meta.summary,
    keywords: meta.keywords?.map((k) => k.term),
  };
  const body = chapter.paragraphs
    .map((p) => {
      if (p.heading === 1) return `# ${p.text}`;
      if (p.heading === 2) return `## ${p.text}`;
      if (p.heading === 3) return `### ${p.text}`;
      return p.text;
    })
    .join("\n\n");
  return `${stringifyFrontmatter(fm)}\n# ${chapter.title}\n\n${body}\n`;
}

export function renderDocumentIndex(doc: DocumentNode, chapters: ChapterNode[]): string {
  const fm: Frontmatter = {
    doc: doc.slug,
    title: doc.title,
    source: doc.sourceFile,
    pages: doc.pages,
    chapters: chapters.length,
    category: doc.category,
    keywords: doc.keywords,
    createdAt: doc.createdAt,
  };
  const list = chapters
    .map((c) => {
      const file = c.path.split("/").pop();
      return `${c.index}. [${c.title}](${file}) — p.${c.pages[0]}-${c.pages[1]}`;
    })
    .join("\n");
  return `${stringifyFrontmatter(fm)}\n# ${doc.title}\n\n${doc.summary}\n\n## 챕터\n\n${list}\n`;
}

/** Plain text of a chapter body: headings without markers, paragraphs separated by blank lines. */
export function bodyToPlainText(body: string): string {
  return body
    .split(/\r?\n/)
    .map((l) => l.replace(/^#{1,6}\s+/, ""))
    .join("\n")
    .trim();
}
