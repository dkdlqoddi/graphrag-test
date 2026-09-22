import { CATEGORIES } from "@/lib/categories";
import { buildGraphView, loadGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/graph?chapters=1&minCount=1&maxKeywords=400 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const includeChapters = url.searchParams.get("chapters") !== "0";
  const minKeywordCount = Math.max(1, Number(url.searchParams.get("minCount") ?? 1) || 1);
  const maxKeywords = Math.min(2000, Math.max(10, Number(url.searchParams.get("maxKeywords") ?? 400) || 400));
  const store = await loadGraph();
  const view = buildGraphView(store, { includeChapters, minKeywordCount, maxKeywords });
  return Response.json({ ...view, categories: CATEGORIES, updatedAt: store.updatedAt });
}
