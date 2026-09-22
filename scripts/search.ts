/**
 * CLI: run a search against the local stores.
 *   npm run search -- "query" [keyword|llm]
 */
import path from "node:path";

try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* optional */
}

async function main() {
  const [query, mode = "keyword"] = process.argv.slice(2);
  if (!query) {
    console.error('usage: npm run search -- "query" [keyword|llm]');
    process.exit(1);
  }
  const { search } = await import("../src/lib/search");
  const started = Date.now();
  for await (const ev of search(query, mode === "llm" ? "llm" : "keyword")) {
    if (ev.type === "delta") {
      process.stdout.write(ev.text);
      continue;
    }
    if (ev.type === "sources") {
      console.log(`[sources] ${ev.sources.length}`);
      for (const s of ev.sources) console.log(`   ${s.score.toFixed(3)} ${s.docTitle} › ${s.chapterTitle} (${s.matchedKeywords.join(", ")})`);
      continue;
    }
    if (ev.type === "keywords") {
      console.log(`[keywords] ${ev.keywords.map((k) => k.label).join(", ")}`);
      console.log(`[related] ${ev.related.map((k) => k.label).join(", ")}`);
      continue;
    }
    if (ev.type === "done") {
      console.log(`\n[done] ${ev.mode} ${((Date.now() - started) / 1000).toFixed(1)}s`);
      if (ev.mode === "keyword") console.log(ev.answer);
      continue;
    }
    console.log(`[${ev.type}]`, JSON.stringify(ev));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
