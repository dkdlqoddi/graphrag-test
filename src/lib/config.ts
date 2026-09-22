import path from "node:path";

/** Runtime configuration shared by the ingestion pipeline and the search API. */
export const config = {
  rootDir: process.cwd(),
  rawDataDir: path.join(process.cwd(), "raw_data"),
  dataDir: path.join(process.cwd(), "data"),
  uploadsDir: path.join(process.cwd(), "data", "uploads"),
  graphFile: path.join(process.cwd(), "data", "graph.json"),
  embeddingsFile: path.join(process.cwd(), "data", "embeddings.json"),

  models: {
    extract: process.env.OPENAI_EXTRACT_MODEL || "gpt-5.4-mini",
    answer: process.env.OPENAI_ANSWER_MODEL || "gpt-5.5",
    embed: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small",
    answerReasoning: (process.env.OPENAI_ANSWER_REASONING || "low") as
      | "none"
      | "minimal"
      | "low"
      | "medium"
      | "high"
      | "xhigh",
  },

  ingest: {
    /** Parallel OpenAI calls while extracting keywords. */
    concurrency: 4,
    /** Characters of chapter text sent to the keyword extractor. */
    maxChapterChars: 14000,
    /** Target characters per embedding chunk. */
    chunkChars: 1500,
    /** Upper bound on chapters per document (longer docs get merged). */
    maxChapters: 60,
  },

  search: {
    topChunks: 10,
    maxContextSources: 8,
    maxContextCharsPerSource: 2200,
  },
} as const;
