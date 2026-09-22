import { ingestPdf } from "@/lib/ingest";
import type { IngestEvent } from "@/lib/types";
import { sseResponse } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** POST multipart/form-data with a `file` field; streams IngestEvents as SSE. */
export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "multipart/form-data 요청이 필요합니다." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "`file` 필드에 PDF를 첨부해 주세요." }, { status: 400 });
  }
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    return Response.json({ error: "PDF 파일만 등록할 수 있습니다." }, { status: 400 });
  }
  const buffer = new Uint8Array(await file.arrayBuffer());

  async function* run(): AsyncGenerator<IngestEvent> {
    try {
      const gen = ingestPdf({ buffer, filename: file instanceof File ? file.name : "upload.pdf" });
      for (;;) {
        const { value, done } = await gen.next();
        if (done) return;
        yield value;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[upload] ingestion failed:", err);
      yield { type: "progress", stage: "error", message };
    }
  }
  return sseResponse(run());
}
