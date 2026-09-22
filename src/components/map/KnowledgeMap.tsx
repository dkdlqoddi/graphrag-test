"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CATEGORIES, CATEGORY_MAP, type CategoryId } from "@/lib/categories";
import type { GraphView, ViewLink, ViewNode } from "@/lib/types";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

type GraphNode = ViewNode & { x?: number; y?: number; z?: number };
type GraphLink = ViewLink & { source: string | GraphNode; target: string | GraphNode };
type ForceGraphInstance = {
  cameraPosition: (pos: Partial<{ x: number; y: number; z: number }>, lookAt?: { x: number; y: number; z: number }, ms?: number) => void;
  d3Force: (name: string) => { distance?: (fn: (l: GraphLink) => number) => void; strength?: (v: number) => void } | undefined;
};

interface ApiGraph extends GraphView {
  categories: typeof CATEGORIES;
  updatedAt: string;
  /** Client-side request key so "loading" can be derived without extra state. */
  key?: string;
}

const KIND_LABEL: Record<ViewNode["kind"], string> = { document: "문서", chapter: "챕터", keyword: "키워드" };

function nodeColor(n: ViewNode): string {
  if (n.kind === "document") return "#fbf7ef";
  if (n.kind === "chapter") return "#d9c3a5";
  return CATEGORY_MAP[n.category]?.color ?? "#81b29a";
}

function linkColor(l: ViewLink): string {
  switch (l.type) {
    case "contains":
      return "rgba(251,247,239,0.35)";
    case "mentions":
      return "rgba(217,195,165,0.28)";
    case "cooccurs":
      return "rgba(129,178,154,0.35)";
    case "shares":
      return "rgba(230,85,63,0.55)";
  }
}

function makeLabelSprite(text: string, color: string, scale: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `600 40px "Pretendard Variable", Pretendard, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  canvas.width = w;
  canvas.height = 64;
  ctx.font = font;
  ctx.fillStyle = "rgba(20,26,32,0.7)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 64, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set((w / 64) * scale, scale, 1);
  sprite.position.set(0, scale * 0.9, 0);
  return sprite;
}

function MapInner() {
  const params = useSearchParams();
  const focus = params.get("focus");
  const fgRef = useRef<ForceGraphInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [data, setData] = useState<ApiGraph | null>(null);
  const [showChapters, setShowChapters] = useState(true);
  const [minCount, setMinCount] = useState(1);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ width: Math.max(320, r.width), height: Math.max(320, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const requestKey = `${showChapters ? 1 : 0}-${minCount}`;
  const loading = !data || data.key !== requestKey;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graph?chapters=${showChapters ? 1 : 0}&minCount=${minCount}`)
      .then((r) => r.json())
      .then((d: ApiGraph) => {
        if (!cancelled) setData({ ...d, key: requestKey });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showChapters, minCount, requestKey]);

  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    const nodes = data.nodes.map((n) => ({ ...n })) as GraphNode[];
    const links = data.links.map((l) => ({ ...l })) as GraphLink[];
    return { nodes, links };
  }, [data]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of graphData.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
      const t = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
      (map.get(s) ?? map.set(s, new Set()).get(s)!).add(t);
      (map.get(t) ?? map.set(t, new Set()).get(t)!).add(s);
    }
    return map;
  }, [graphData]);

  const filterLower = filter.trim().toLowerCase();
  const highlight = useMemo(() => {
    const set = new Set<string>();
    if (selected) {
      set.add(selected.id);
      for (const n of neighbors.get(selected.id) ?? []) set.add(n);
    }
    return set;
  }, [selected, neighbors]);

  const focusNode = useCallback(
    (node: GraphNode) => {
      const fg = fgRef.current;
      if (!fg || node.x === undefined || node.y === undefined || node.z === undefined) return;
      const dist = 90;
      const r = Math.hypot(node.x, node.y, node.z) || 1;
      const ratio = 1 + dist / r;
      fg.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, { x: node.x, y: node.y, z: node.z }, 900);
    },
    [],
  );

  // Focus a node passed through ?focus= once the layout has settled a bit.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!focus || focusedOnce.current || graphData.nodes.length === 0) return;
    const node = graphData.nodes.find((n) => n.id === focus || n.label.toLowerCase() === focus.toLowerCase());
    if (!node) return;
    focusedOnce.current = true;
    const timer = setTimeout(() => {
      setSelected(node);
      focusNode(node);
    }, 1500);
    return () => clearTimeout(timer);
  }, [focus, graphData, focusNode]);

  const nodeVisibility = useCallback(
    (n: GraphNode) => {
      if (!filterLower) return true;
      if (n.label.toLowerCase().includes(filterLower)) return true;
      return n.kind === "document";
    },
    [filterLower],
  );

  const nodeThreeObject = useCallback(
    (n: GraphNode) => {
      const showLabel = n.kind === "document" || (n.kind === "keyword" && ((n.count ?? 0) >= 2 || highlight.has(n.id))) || highlight.has(n.id);
      if (!showLabel) return new THREE.Object3D();
      const scale = n.kind === "document" ? 7 : 4.5;
      return makeLabelSprite(n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label, nodeColor(n), scale);
    },
    [highlight],
  );

  const selectedNeighbors = useMemo(() => {
    if (!selected) return [] as GraphNode[];
    const ids = neighbors.get(selected.id) ?? new Set<string>();
    return graphData.nodes.filter((n) => ids.has(n.id)).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 24);
  }, [selected, neighbors, graphData]);

  return (
    <div className="fixed inset-0 bg-[#1b2430]">
      <div ref={containerRef} className="absolute inset-0">
        <ForceGraph3D
          ref={fgRef as never}
          width={size.width}
          height={size.height}
          backgroundColor="#1b2430"
          graphData={graphData}
          nodeId="id"
          nodeLabel={(n) => `${KIND_LABEL[(n as GraphNode).kind]} · ${(n as GraphNode).label}`}
          nodeVal={(n) => (n as GraphNode).size}
          nodeRelSize={1.6}
          nodeColor={(n) => {
            const node = n as GraphNode;
            if (highlight.size && !highlight.has(node.id)) return "rgba(120,130,140,0.35)";
            return nodeColor(node);
          }}
          nodeOpacity={0.95}
          nodeVisibility={(n) => nodeVisibility(n as GraphNode)}
          nodeThreeObject={(n) => nodeThreeObject(n as GraphNode)}
          nodeThreeObjectExtend
          linkColor={(l) => linkColor(l as GraphLink)}
          linkWidth={(l) => {
            const link = l as GraphLink;
            if (link.type === "shares") return 1 + Math.min(4, link.weight * 0.6);
            if (link.type === "contains") return 0.8;
            return 0.3 + Math.min(1.5, link.weight * 0.4);
          }}
          linkOpacity={0.5}
          linkDirectionalParticles={(l) => ((l as GraphLink).type === "shares" ? 3 : 0)}
          linkDirectionalParticleWidth={1.2}
          linkDirectionalParticleColor={() => "#e6553f"}
          onNodeClick={(n) => {
            const node = n as GraphNode;
            setSelected(node);
            focusNode(node);
          }}
          onNodeHover={(n) => setHovered((n as GraphNode) ?? null)}
          onBackgroundClick={() => setSelected(null)}
          warmupTicks={40}
          cooldownTicks={200}
          showNavInfo={false}
        />
      </div>

      {/* controls */}
      <div className="pointer-events-none absolute inset-x-0 top-20 flex flex-col items-start gap-3 px-5 md:flex-row md:items-center md:justify-between">
        <div className="pointer-events-auto paper-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5 text-[13px]">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="노드 필터…"
            className="w-40 rounded-full border border-line bg-white/70 px-3 py-1 text-[13px] outline-none placeholder:text-muted"
          />
          <label className="flex items-center gap-1.5 text-ink-2">
            <input type="checkbox" checked={showChapters} onChange={(e) => setShowChapters(e.target.checked)} />
            챕터 노드
          </label>
          <label className="flex items-center gap-1.5 text-ink-2">
            키워드 최소 등장
            <input type="range" min={1} max={6} value={minCount} onChange={(e) => setMinCount(Number(e.target.value))} />
            <span className="w-4 text-ink">{minCount}</span>
          </label>
          {data && (
            <span className="text-muted">
              문서 {data.stats.documents} · 챕터 {data.stats.chapters} · 키워드 {data.stats.keywords}
            </span>
          )}
          {loading && <span className="text-terracotta">불러오는 중…</span>}
        </div>
        <div className="pointer-events-auto paper-card flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
          {CATEGORIES.map((c) => (
            <span key={c.id} className="chip">
              <span className="chip-dot" style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
          <span className="chip">
            <span className="chip-dot" style={{ background: "#fbf7ef", border: "1px solid #999" }} />
            문서
          </span>
          <span className="chip">
            <span className="chip-dot" style={{ background: "#d9c3a5" }} />
            챕터
          </span>
        </div>
      </div>

      {hovered && !selected && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-paper/90 px-4 py-1.5 text-[13px] text-ink shadow">
          {KIND_LABEL[hovered.kind]} · {hovered.label}
        </div>
      )}

      {/* detail panel */}
      {selected && (
        <aside className="paper-card fade-up scrollbar-thin absolute bottom-6 right-5 top-20 z-30 w-[min(92vw,360px)] overflow-y-auto rounded-2xl p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{KIND_LABEL[selected.kind]}</div>
              <h2 className="mt-1 text-[17px] font-bold leading-snug text-ink">{selected.label}</h2>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-ink-2 hover:bg-cream-2" aria-label="닫기">
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="chip">
              <span className="chip-dot" style={{ background: CATEGORY_MAP[selected.category as CategoryId]?.color }} />
              {CATEGORY_MAP[selected.category as CategoryId]?.label}
            </span>
            {selected.kind === "keyword" && <span className="chip">{selected.count}개 챕터에 등장</span>}
            {selected.kind === "document" && <span className="chip">{selected.count}개 챕터</span>}
          </div>
          {selected.summary && <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{selected.summary}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            {selected.kind === "keyword" && (
              <>
                <Link href={`/?q=${encodeURIComponent(selected.label)}&mode=keyword`} className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-slate">
                  도서관에서 검색
                </Link>
                <Link href={`/?q=${encodeURIComponent(selected.label)}&mode=llm`} className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-cream-2">
                  AI에게 묻기
                </Link>
              </>
            )}
            {selected.kind === "document" && (
              <Link href={`/docs/${encodeURIComponent(selected.id)}`} className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-slate">
                문서 열기
              </Link>
            )}
            {selected.kind === "chapter" && selected.doc && (
              <Link href={`/docs/${encodeURIComponent(selected.doc)}/${selected.id.split("__c")[1]}`} className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-slate">
                챕터 읽기
              </Link>
            )}
          </div>

          {selectedNeighbors.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-[12px] font-semibold text-ink-2">연결된 노드</div>
              <ul className="flex flex-col gap-1">
                {selectedNeighbors.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(n);
                        focusNode(n);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-cream-2"
                    >
                      <span className="chip-dot shrink-0" style={{ background: nodeColor(n), border: n.kind === "document" ? "1px solid #999" : undefined }} />
                      <span className="truncate text-ink">{n.label}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted">{KIND_LABEL[n.kind]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}

      {data && data.stats.documents === 0 && !loading && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="paper-card rounded-2xl px-6 py-5 text-center text-[14px] text-ink">
            아직 등록된 문서가 없습니다.
            <div className="mt-3">
              <Link href="/upload" className="rounded-full bg-terracotta px-4 py-1.5 text-[13px] font-semibold text-paper hover:bg-terracotta-2">
                PDF 등록하기
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function KnowledgeMap() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#1b2430]" />}>
      <MapInner />
    </Suspense>
  );
}
