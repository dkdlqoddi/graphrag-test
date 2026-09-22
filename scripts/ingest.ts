/**
 * CLI: ingest one or more PDFs without the web UI.
 *   npm run ingest -- path/to/file.pdf [more.pdf ...]
 */
import fs from "node:fs/promises";
import path from "node:path";

try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* .env is optional for the CLI */
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: npm run ingest -- <file.pdf> [...]");
    process.exit(1);
  }
  const { ingestPdf } = await import("../src/lib/ingest");
  for (const file of files) {
    const buffer = new Uint8Array(await fs.readFile(file));
    const started = Date.now();
    const gen = ingestPdf({ buffer, filename: path.basename(file) });
    for (;;) {
      const { value, done } = await gen.next();
      if (done) {
        console.log(`\n[done] ${value.title} → raw_data/${value.slug}/ (${((Date.now() - started) / 1000).toFixed(1)}s)`);
        break;
      }
      const suffix = value.total !== undefined ? ` [${value.done}/${value.total}]` : "";
      console.log(`[${value.stage}] ${value.message}${suffix}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
