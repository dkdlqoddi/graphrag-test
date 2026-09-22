import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_MAP } from "@/lib/categories";
import { getDocument } from "@/lib/documents";
import { loadGraph } from "@/lib/graph";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const store = await loadGraph();
  const found = await getDocument(decodeURIComponent(slug), store);
  if (!found) notFound();
  const { doc, chapters } = found;
  const cat = CATEGORY_MAP[doc.category];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 pb-16 pt-24">
      <div className="text-[12px] text-muted">
        <Link href="/upload" className="hover:text-ink">
          등록된 문서
        </Link>{" "}
        / {doc.title}
      </div>
      <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight text-ink">{doc.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span className="chip">
          <span className="chip-dot" style={{ background: cat.color }} />
          {cat.label}
        </span>
        <span>{doc.pages}쪽</span>
        <span>· 챕터 {chapters.length}개</span>
        <span>· raw_data/{doc.slug}/</span>
      </div>
      {doc.summary && <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{doc.summary}</p>}
      {doc.keywords.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {doc.keywords.map((t) => (
            <Link key={t} href={`/?q=${encodeURIComponent(store.keywords[t]?.label ?? t)}&mode=keyword`} className="chip transition hover:bg-paper hover:text-ink">
              {store.keywords[t]?.label ?? t}
            </Link>
          ))}
        </div>
      )}

      <h2 className="mt-8 text-[16px] font-bold text-ink">챕터</h2>
      <ol className="mt-3 flex flex-col gap-2">
        {chapters.map((c) => (
          <li key={c.id}>
            <Link href={`/docs/${encodeURIComponent(doc.slug)}/${c.index}`} className="paper-card block rounded-2xl p-4 transition hover:bg-white">
              <div className="flex items-baseline gap-3">
                <span className="text-[12px] font-bold text-terracotta-2">{String(c.index).padStart(2, "0")}</span>
                <span className="text-[15px] font-semibold text-ink">{c.title}</span>
                <span className="ml-auto shrink-0 text-[12px] text-muted">
                  p.{c.pages[0]}-{c.pages[1]}
                </span>
              </div>
              {c.summary && <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{c.summary}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {c.keywords.slice(0, 8).map((k) => (
                  <span key={k.term} className="chip">
                    {store.keywords[k.term]?.label ?? k.term}
                  </span>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
