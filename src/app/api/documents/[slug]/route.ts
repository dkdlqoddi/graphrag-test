import { deleteDocument, getDocument } from "@/lib/documents";
import { loadGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[slug]">): Promise<Response> {
  const { slug } = await ctx.params;
  const store = await loadGraph();
  const found = await getDocument(slug, store);
  if (!found) return Response.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
  return Response.json({
    ...found,
    chapters: found.chapters.map((c) => ({
      ...c,
      keywords: c.keywords.map((k) => ({ ...k, label: store.keywords[k.term]?.label ?? k.term })),
    })),
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/documents/[slug]">): Promise<Response> {
  const { slug } = await ctx.params;
  const removed = await deleteDocument(slug);
  if (!removed) return Response.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ ok: true, slug });
}
