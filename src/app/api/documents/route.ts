import { listDocuments } from "@/lib/documents";
import { loadGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const store = await loadGraph();
  const documents = await listDocuments(store);
  return Response.json({
    documents: documents.map((d) => ({
      ...d,
      keywordLabels: d.keywords.map((t) => store.keywords[t]?.label ?? t),
    })),
    stats: {
      documents: Object.keys(store.documents).length,
      chapters: Object.keys(store.chapters).length,
      keywords: Object.keys(store.keywords).length,
    },
    updatedAt: store.updatedAt,
  });
}
