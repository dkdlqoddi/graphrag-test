import { UploadPageClient } from "@/components/upload/UploadPage";

export const metadata = { title: "PDF 등록 · GraphRAG Library" };

export default function UploadPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-24">
      <UploadPageClient />
    </main>
  );
}
