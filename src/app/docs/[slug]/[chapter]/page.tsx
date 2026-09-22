import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_MAP } from "@/lib/categories";
import { getDocument, readChapter } from "@/lib/documents";
import { loadGraph } from "@/lib/graph";
import { chapterId } from "@/lib/util";
import { ChapterBody } from "@/components/docs/ChapterBody";

export const dynamic = "force-dynamic";

export default async function ChapterPage({ params }: PageProps<"/docs/[slug]/[chapter]">) {
  const { slug: rawSlug, chapter } = await params;
  const slug = decodeURIComponent(rawSlug);
  const index = Number(chapter);
  if (!Number.isInteger(index)) notFound();
  const store = await loadGraph();
  const found = await getDocument(slug, store);
  if (!found) notFound();
  const content = await readChapter(chapterId(slug, index), store);
  if (!content) notFound();
  const { doc, chapters } = found;
  const node = content.node;
  const cat = CATEGORY_MAP[node.category];
  const prev = chapters.find((c) => c.index === index - 1);
  const next = chapters.find((c) => c.index === index + 1);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-24">
      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Link href={`/docs/${encodeURIComponent(doc.slug)}`} className="block text-[13px] font-semibold text-ink hover:text-terracotta-2">
            ← {doc.title}
          </Link>
          <ol className="mt-3 flex flex-col gap-0.5 text-[13px]">
            {chapters.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/docs/${encodeURIComponent(doc.slug)}/${c.index}`}
                  className={`block truncate rounded-lg px-2 py-1.5 ${c.index === index ? "bg-ink text-paper" : "text-ink-2 hover:bg-cream-2"}`}
                >
                  {String(c.index).padStart(2, "0")} {c.title}
                </Link>
              </li>
            ))}
          </ol>
        </aside>

        <article className="paper-card rounded-2xl p-8 md:p-10">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="chip">
              <span className="chip-dot" style={{ background: cat.color }} />
              {cat.label}
            </span>
            <span>
              p.{node.pages[0]}-{node.pages[1]}
            </span>
            <span>· raw_data/{node.path}</span>
          </div>
          {node.summary && <p className="mt-4 rounded-xl bg-cream-2/70 p-4 text-[13.5px] leading-relaxed text-ink-2">{node.summary}</p>}
          {node.keywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {node.keywords.map((k) => (
                <Link key={k.term} href={`/?q=${encodeURIComponent(store.keywords[k.term]?.label ?? k.term)}&mode=keyword`} className="chip transition hover:bg-paper hover:text-ink">
                  {store.keywords[k.term]?.label ?? k.term}
                  <span className="text-muted">{k.weight.toFixed(2)}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="prose-doc mt-8 text-[15px] text-ink">
            <ChapterBody body={content.body} />
          </div>
          <nav className="mt-10 flex justify-between gap-3 border-t border-line pt-5 text-[13px]">
            {prev ? (
              <Link href={`/docs/${encodeURIComponent(doc.slug)}/${prev.index}`} className="text-ink-2 hover:text-ink">
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/docs/${encodeURIComponent(doc.slug)}/${next.index}`} className="text-right text-ink-2 hover:text-ink">
                {next.title} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </article>
      </div>
    </main>
  );
}
