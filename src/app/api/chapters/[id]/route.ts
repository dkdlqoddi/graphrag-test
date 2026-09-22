import { readChapter } from "@/lib/documents";
import { loadGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/chapters/[id]">): Promise<Response> {
  const { id } = await ctx.params;
  const store = await loadGraph();
  const chapter = await readChapter(decodeURIComponent(id), store);
  if (!chapter) return Response.json({ error: "챕터를 찾을 수 없습니다." }, { status: 404 });
  const doc = store.documents[chapter.node.doc];
  return Response.json({
    chapter: chapter.node,
    docTitle: doc?.title ?? chapter.node.doc,
    body: chapter.body,
    keywords: chapter.node.keywords.map((k) => ({ ...k, label: store.keywords[k.term]?.label ?? k.term })),
  });
}
