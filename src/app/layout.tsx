import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";

export const metadata: Metadata = {
  title: "GraphRAG Library",
  description: "PDF를 챕터 단위 지식 그래프로 바꾸고 3D 도서관에서 검색하는 GraphRAG",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
