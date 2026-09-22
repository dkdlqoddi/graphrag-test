import { search } from "@/lib/search";
import type { SearchEvent } from "@/lib/types";
import { sseResponse } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/search?q=...&mode=keyword|llm — streams SearchEvents as SSE. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const mode = url.searchParams.get("mode") === "llm" ? "llm" : "keyword";
  if (!q) return Response.json({ error: "q 파라미터가 필요합니다." }, { status: 400 });

  async function* run(): AsyncGenerator<SearchEvent> {
    try {
      yield* search(q.slice(0, 500), mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[search] failed:", err);
      yield { type: "error", message };
    }
  }
  return sseResponse(run());
}
