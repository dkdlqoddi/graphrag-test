/**
 * All prompts used by the pipeline and the search API live here.
 */
import { z } from "zod";
import { CATEGORIES, CATEGORY_IDS, coerceCategory, type CategoryId } from "./categories";
import { config } from "./config";
import { getOpenAI, isReasoningModel, jsonCompletion, normalizeReasoning } from "./openai";
import type { HeadingCandidate } from "./pdf/structure";
import type { SearchSource } from "./types";
import { truncate } from "./util";

const categoryList = CATEGORIES.map((c) => `- ${c.id}: ${c.label} (${c.labelEn}) — ${c.description}`).join("\n");

/* ---------------- chapter selection ---------------- */

const chapterSelectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer", description: "The candidate index" },
          title: { type: "string", description: "Cleaned heading text" },
        },
        required: ["index", "title"],
      },
    },
  },
  required: ["chapters"],
};

const ChapterSelection = z.object({
  chapters: z.array(z.object({ index: z.number().int(), title: z.string() })),
});

export async function selectChaptersWithLLM(
  candidates: HeadingCandidate[],
  docTitle: string,
): Promise<{ index: number; title: string }[] | null> {
  const lines = candidates.map((c) =>
    JSON.stringify({
      index: c.index,
      page: c.page,
      size: c.size,
      bold: c.bold,
      numbered: c.numbered,
      text: truncate(c.text, 120),
    }),
  );
  const result = await jsonCompletion({
    schemaName: "chapter_selection",
    schema: chapterSelectionSchema,
    reasoning: "low",
    system: `You are a document-structure analyst. You receive heading candidates extracted from a PDF, in document order, with page numbers, font sizes and whether they look numbered ("top" = top-level like "3 Results", "Chapter 2", "제2장"; "sub" = like "3.1").
Select the candidates that form the document's TOP-LEVEL chapter/section structure so that the text between consecutive selections is a coherent chapter.
Rules:
- Pick between 2 and 40 headings when possible, in document order.
- Prefer top-level numbered headings. Never pick sub-sections (e.g. "2.1") when their parent exists.
- Exclude: the document title, author names/affiliations, running heads, figure/table captions, bibliography entries, footnotes, page numbers, table cells.
- For academic papers, sections like Abstract, Introduction, Method, Results, Conclusion, References ARE chapters.
- Keep the original language of the titles. Remove trailing dots, page numbers and leader lines from titles.
- If there is only one plausible chapter heading, return it alone. If none qualify, return an empty list.`,
    user: `Document title: ${docTitle}\n\nCandidates (one JSON object per line):\n${lines.join("\n")}`,
    validate: (raw) => ChapterSelection.parse(raw),
  });
  return result.chapters;
}

/* ---------------- chapter keywords ---------------- */

const chapterKeywordsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    category: { type: "string", enum: [...CATEGORY_IDS] },
    keywords: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          term: { type: "string" },
          weight: { type: "number" },
          kind: { type: "string", enum: ["concept", "entity", "method", "topic", "other"] },
        },
        required: ["term", "weight", "kind"],
      },
    },
  },
  required: ["summary", "category", "keywords"],
};

const ChapterKeywords = z.object({
  summary: z.string(),
  category: z.string(),
  keywords: z.array(z.object({ term: z.string(), weight: z.number(), kind: z.string() })),
});

export interface ChapterKeywordResult {
  summary: string;
  category: CategoryId;
  keywords: { term: string; weight: number; kind: string }[];
}

export async function extractChapterKeywords(input: {
  docTitle: string;
  chapterTitle: string;
  text: string;
}): Promise<ChapterKeywordResult> {
  const text = truncate(input.text, config.ingest.maxChapterChars);
  const result = await jsonCompletion({
    schemaName: "chapter_keywords",
    schema: chapterKeywordsSchema,
    reasoning: "minimal",
    system: `You are a librarian building a knowledge graph from book chapters.
From the chapter text, extract the 5-12 most important keywords: key concepts, named entities, methods and topics.
Guidelines:
- Each keyword is 1-4 words, written as it would appear in an index. Keep technical terms, proper nouns and acronyms as written in the text.
- Keywords MUST stay in the language of the chapter text. NEVER translate them: English text -> English keywords ("multi-head attention", not a Korean rendering); Korean text -> Korean keywords (keep English acronyms such as "GPU" or "RAG" as-is).
- Avoid generic words ("introduction", "chapter", "figure") and bibliography noise (author lists, journal names, years).
- weight is 0..1 importance within the chapter; the single most central concept gets 1.0.
- summary: 1-2 sentences written in Korean (한국어), regardless of the text language.
- category: exactly one of the ids below, describing the chapter's subject.
${categoryList}`,
    user: `Document: ${input.docTitle}\nChapter: ${input.chapterTitle}\n\n${text}`,
    validate: (raw) => ChapterKeywords.parse(raw),
  });
  return {
    summary: result.summary.trim(),
    category: coerceCategory(result.category),
    keywords: result.keywords
      .map((k) => ({ term: k.term.trim(), weight: clamp01(k.weight), kind: k.kind }))
      .filter((k) => k.term.length >= 1 && k.term.length <= 60),
  };
}

/* ---------------- document summary ---------------- */

const documentSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    category: { type: "string", enum: [...CATEGORY_IDS] },
    keywords: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "category", "keywords"],
};

const DocumentSummary = z.object({
  summary: z.string(),
  category: z.string(),
  keywords: z.array(z.string()),
});

export async function summarizeDocument(input: {
  title: string;
  chapters: { title: string; summary: string; keywords: string[] }[];
}): Promise<{ summary: string; category: CategoryId; keywords: string[] }> {
  const outline = input.chapters
    .map((c, i) => `${i + 1}. ${c.title}\n   요약: ${c.summary}\n   키워드: ${c.keywords.join(", ")}`)
    .join("\n");
  const result = await jsonCompletion({
    schemaName: "document_summary",
    schema: documentSummarySchema,
    reasoning: "minimal",
    system: `You are a librarian cataloguing a document from its chapter outline.
Return: a 2-3 sentence summary of the whole document written in Korean (한국어), the single best category id from the list, and the 5-8 most representative keywords chosen ONLY from the chapter keywords provided (copy them exactly, do not translate).
${categoryList}`,
    user: `Title: ${input.title}\n\n${truncate(outline, 20000)}`,
    validate: (raw) => DocumentSummary.parse(raw),
  });
  return {
    summary: result.summary.trim(),
    category: coerceCategory(result.category),
    keywords: result.keywords.map((k) => k.trim()).filter(Boolean),
  };
}

/* ---------------- keyword linking ---------------- */

const keywordLinkSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    merges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
      },
    },
  },
  required: ["merges"],
};

const KeywordLinks = z.object({ merges: z.array(z.object({ from: z.string(), to: z.string() })) });

/**
 * Ask the model which new keywords are the same concept as an existing
 * keyword so documents get connected through shared nodes instead of
 * near-duplicate terms.
 */
export async function linkKeywords(
  newTerms: { term: string; label: string }[],
  existing: { term: string; label: string; count: number }[],
): Promise<{ from: string; to: string }[]> {
  if (newTerms.length === 0 || existing.length === 0) return [];
  const result = await jsonCompletion({
    schemaName: "keyword_links",
    schema: keywordLinkSchema,
    reasoning: "minimal",
    system: `You maintain the keyword index of a knowledge graph. You get NEW keyword terms and EXISTING canonical terms.
List merges where a NEW term refers to the same concept as an EXISTING term: synonyms, singular/plural, abbreviation vs. full form, Korean vs. English name of the same concept, spelling variants.
Only merge when the meaning is clearly identical; do NOT merge merely related concepts (e.g. "neural network" vs "deep learning").
"from" must be copied exactly from the NEW list and "to" exactly from the EXISTING list.`,
    user: `NEW terms:\n${newTerms.map((t) => t.term).join("\n")}\n\nEXISTING terms:\n${existing.map((t) => t.term).join("\n")}`,
    validate: (raw) => KeywordLinks.parse(raw),
  });
  const newSet = new Set(newTerms.map((t) => t.term));
  const existingSet = new Set(existing.map((t) => t.term));
  return result.merges.filter((m) => newSet.has(m.from) && existingSet.has(m.to) && m.from !== m.to);
}

/* ---------------- answer generation ---------------- */

export async function* streamAnswer(input: {
  query: string;
  sources: SearchSource[];
  contexts: { n: number; text: string }[];
  keywords: string[];
}): AsyncGenerator<string> {
  const openai = getOpenAI();
  const model = config.models.answer;

  const sourceBlock = input.contexts
    .map((c) => {
      const s = input.sources[c.n - 1];
      const head = s ? `[${c.n}] ${s.docTitle} › ${s.chapterTitle} (p.${s.pages[0]}-${s.pages[1]})` : `[${c.n}]`;
      return `${head}\n${c.text}`;
    })
    .join("\n\n");

  const stream = await openai.chat.completions.create({
    model,
    stream: true,
    max_completion_tokens: 1800,
    ...(isReasoningModel(model)
      ? { reasoning_effort: normalizeReasoning(model, config.models.answerReasoning), verbosity: "medium" as const }
      : { temperature: 0.3 }),
    messages: [
      {
        role: "system",
        content: `You are the librarian of a private knowledge library. Answer the visitor's question using ONLY the numbered sources below.
- Answer in the language of the question (Korean question -> Korean answer).
- Cite sources inline like [1] or [2][3] right after the sentence they support.
- Start with a direct 1-3 sentence answer, then the key points as a short list, then one line recommending which document/chapter to read.
- If the sources do not contain the answer, say so plainly and suggest what the library does contain that is closest.
- Do not invent facts beyond the sources. Keep it under 300 words.

Related keywords in the graph: ${input.keywords.join(", ") || "(none)"}

SOURCES:
${sourceBlock || "(no sources found)"}`,
      },
      { role: "user", content: input.query },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
