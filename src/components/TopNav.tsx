"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "도서관" },
  { href: "/map", label: "지식 지도" },
  { href: "/upload", label: "PDF 등록" },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="fixed inset-x-0 top-0 z-40 pointer-events-none">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <Link href="/" className="pointer-events-auto flex items-center gap-2.5 text-ink">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-terracotta text-paper shadow-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
              <path d="M4 20.5V5.5M8 7h8M8 11h6" />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-tight">GraphRAG Library</span>
        </Link>
        <nav className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-paper/80 p-1 shadow-sm backdrop-blur">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                  active ? "bg-ink text-paper shadow-sm" : "text-ink-2 hover:bg-cream-2 hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
