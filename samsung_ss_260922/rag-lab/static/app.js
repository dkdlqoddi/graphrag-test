"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const el = (t, c, txt) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (txt !== undefined) n.textContent = txt;
  return n;
};
const nf = (n) => (n ?? 0).toLocaleString("ko-KR");

let PAGE = 1, NPAGES = 1;
let STRATEGY_LABELS = {};
const HAVE = { doc: false, chunks: 0, store: 0 };

// 청크 카드를 한 번에 다 그리면 브라우저가 버벅인다. 문서가 크면 천 장이 넘는다.
// 미리보기는 앞에서부터 이만큼만 그리고, 더 필요하면 눌러서 이어 붙인다.
const PREVIEW_STEP = 40;
let ALL_CHUNKS = [], SHOWN = 0;

// ── 탭 ──────────────────────────────────────────────────────────
function show(pane) {
  $$(".pane").forEach((p) => p.classList.toggle("on", p.id === pane));
  $$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.pane === pane));
  gate();
}
$$(".tab").forEach((t) => { t.onclick = () => show(t.dataset.pane); });

/** 앞 단계가 안 끝났으면 무엇을 먼저 해야 하는지 알려 준다. 막지는 않는다. */
function gate() {
  $("#p2-need").classList.toggle("hidden", HAVE.doc);
  $("#p3-need").classList.toggle("hidden", HAVE.chunks > 0);
  $("#p4-need").classList.toggle("hidden", HAVE.store > 0);
  $$(".tab").forEach((t) => {
    const done = (t.dataset.pane === "p1" && HAVE.doc)
      || (t.dataset.pane === "p2" && HAVE.chunks > 0)
      || (t.dataset.pane === "p3" && HAVE.store > 0);
    t.classList.toggle("done", !!done);
  });
}

// ── 상단 현황 ───────────────────────────────────────────────────
function setStatus(part) {
  if (part.doc !== undefined) {
    const d = part.doc;
    HAVE.doc = !!(d && d.loaded);
    $("#st-doc").textContent = HAVE.doc
      ? (d.name.length > 26 ? d.name.slice(0, 26) + "…" : d.name) : "—";
    $("#st-size").textContent = HAVE.doc
      ? nf(d.n_pages) + "쪽 · " + nf(d.n_chars) + "자" : "—";
  }
  if (part.chunks !== undefined) {
    HAVE.chunks = part.chunks.count || 0;
    $("#st-chunks").textContent = HAVE.chunks
      ? nf(HAVE.chunks) + "개 · " + (part.chunks.label || "") : "—";
  }
  if (part.store !== undefined) {
    const s = part.store;
    HAVE.store = s.total || 0;
    $("#st-store").textContent = nf(HAVE.store);
    $("#st-model").textContent = s.model ? s.model + " · " + nf(s.dim) + "차원" : "—";
  }
  gate();
}

function msg(id, text, kind) {
  const n = $(id);
  n.textContent = text || "";
  n.className = "msg" + (kind ? " " + kind : "");
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: "응답을 읽지 못했습니다" }));
  if (!res.ok || data.error) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

function cards(target, items) {
  const box = $(target);
  box.innerHTML = "";
  box.classList.remove("hidden");
  items.forEach(([k, v, warn]) => {
    const c = el("div", "card" + (warn ? " warn" : ""));
    c.appendChild(el("span", "k", k));
    c.appendChild(el("span", "v", v));
    box.appendChild(c);
  });
}

// ── ① PDF 업로드 ────────────────────────────────────────────────
function showDoc(d) {
  if (!d.loaded) return;
  const thin = (d.thin_pages || []).length;
  cards("#doc-summary", [
    ["쪽", nf(d.n_pages)],
    ["뽑아낸 글자", nf(d.n_chars)],
    ["글자가 거의 없는 쪽", nf(thin), thin > 0],
  ]);
  NPAGES = d.n_pages; PAGE = 1;
  $("#doc-view").classList.remove("hidden");
  drawBars(d.pages || []);
  loadPage();
  setStatus({ doc: d });
}

function drawBars(pages) {
  const box = $("#page-bars");
  box.innerHTML = "";
  const max = Math.max(1, ...pages.map((p) => p.n_chars));
  pages.forEach((p) => {
    const b = el("i");
    b.style.height = Math.max(3, Math.round((p.n_chars / max) * 42)) + "px";
    if (p.thin) b.classList.add("thin");
    b.title = p.page + "쪽 · " + nf(p.n_chars) + "자";
    b.onclick = () => { PAGE = p.page; loadPage(); };
    box.appendChild(b);
  });
}

async function loadPage() {
  const d = await api("/api/document?page=" + PAGE);
  if (!d.loaded) return;
  PAGE = d.page; NPAGES = d.n_pages;
  $("#page-label").textContent = PAGE + " / " + NPAGES;
  $("#page-chars").textContent = nf(d.n_chars) + "자"
    + (d.thin ? " — 글자가 거의 없습니다. 원본 PDF 의 이 쪽을 열어 보세요." : "");
  $("#page-chars").className = "hint" + (d.thin ? " warn-text" : "");
  $("#doc-text").textContent = d.text || "(뽑아낸 글자가 없습니다)";
  const bars = $("#page-bars").children;
  for (let i = 0; i < bars.length; i++) bars[i].classList.toggle("cur", i === PAGE - 1);
}

$("#btn-upload").onclick = async () => {
  const f = $("#file").files[0];
  if (!f) return msg("#upload-msg", "PDF 를 골라 주세요", "err");
  msg("#upload-msg", "파싱 중…");
  const fd = new FormData();
  fd.append("file", f);
  try {
    const d = await api("/api/upload", { method: "POST", body: fd });
    showDoc(d);
    setStatus({ chunks: { count: 0 } });     // 문서가 바뀌면 청크는 무효
    $("#chunk-list").innerHTML = "";
    $("#chunk-summary").classList.add("hidden");
    msg("#upload-msg", "파싱 완료 — ② 청킹으로 넘어가세요", "ok");
  } catch (e) { msg("#upload-msg", e.message, "err"); }
};

$("#page-prev").onclick = () => { if (PAGE > 1) { PAGE--; loadPage(); } };
$("#page-next").onclick = () => { if (PAGE < NPAGES) { PAGE++; loadPage(); } };

// ── 청크 카드 (② 미리보기 · ④ 검색 결과가 함께 쓴다) ───────────────
/** 근거 구간을 원문 위에 칠한다. 구간은 청크 텍스트 안의 (start, end) 위치다.
 *  원문은 textContent 로만 넣는다 — 문서에서 나온 글자가 태그로 해석되면 안 된다. */
function bodyNode(c) {
  const box = el("div", "body");
  const marks = (c.segments || []).filter((s) => s.level)
    .slice().sort((a, b) => a.start - b.start);
  if (!marks.length) { box.textContent = c.text; return box; }

  let at = 0;
  marks.forEach((s) => {
    if (s.end <= at) return;                     // 겹치면 앞의 표시를 남긴다
    const from = Math.max(at, s.start);
    if (from > at) box.appendChild(document.createTextNode(c.text.slice(at, from)));
    const m = el("mark", "hl" + (s.level === "top" ? " top" : ""), c.text.slice(from, s.end));
    m.title = s.distance !== undefined
      ? "질문과의 거리 " + s.distance + " · 유사도 " + s.score
      : "질문에 든 낱말";
    box.appendChild(m);
    at = s.end;
  });
  if (at < c.text.length) box.appendChild(document.createTextNode(c.text.slice(at)));
  return box;
}

/** 왜 이 조각이 뽑혔는지. 계산 결과를 그대로 보여 준다 — 생성 모델의 설명이 아니다.
 *  두 검색이 각자의 말로 답한다: 의미 검색은 문장별 거리로, BM25 는 맞은 낱말로. */
function whyNode(c) {
  const w = c.why;
  const box = el("div", "why");
  const terms = w.terms;

  const head = el("div", "head");
  head.appendChild(el("b", null, "왜 이 조각인가"));
  if (terms) {
    head.appendChild(el("span", null,
      "질문 낱말 " + w.n_query_terms + "개 중 " + w.n_terms + "개가 맞음"));
    head.appendChild(el("span", null, "낱말 기여의 합"));
  } else {
    head.appendChild(el("span", null, "문장 " + w.n_segments + "개 중 " + w.n_marked + "개 표시"));
    head.appendChild(el("span", null, "질문 ↔ 청크 거리 " + w.base_distance));
  }
  box.appendChild(head);
  box.appendChild(el("p", "line", w.line));

  const list = el("ul", "seg");
  if (terms) {
    // 막대는 가장 크게 보탠 낱말 대비 몫이다. BM25 점수는 0~1 이 아니라 상한이 없어
    // 절댓값을 길이로 쓰면 아무 뜻도 없다.
    const top = terms[0] ? terms[0].score : 1;
    terms.slice(0, 4).forEach((t, i) => {
      const li = el("li", i === 0 ? "on" : null);
      li.appendChild(el("span", "n", (i + 1) + "."));
      const bar = el("i", "bar");
      const fill = el("i", "fill" + (i === 0 ? " top" : ""));
      fill.style.width = Math.max(2, Math.min(100, (t.score / (top || 1)) * 100)) + "%";
      bar.appendChild(fill);
      li.appendChild(bar);
      li.appendChild(el("span", "d", "기여 " + t.score));
      li.appendChild(el("span", "t", t.term + " — " + t.tf + "회 · idf " + t.idf));
      list.appendChild(li);
    });
  } else {
    // 질문에 가까운 순으로 세 문장. 막대는 유사도(0~1) 그대로의 길이다.
    (c.segments || []).slice().sort((a, b) => a.rank - b.rank).slice(0, 3).forEach((s) => {
      const li = el("li", s.level ? "on" : null);
      li.appendChild(el("span", "n", s.rank + "."));
      const bar = el("i", "bar");
      const fill = el("i", "fill" + (s.level === "top" ? " top" : ""));
      fill.style.width = Math.max(2, Math.min(100, s.score * 100)) + "%";
      bar.appendChild(fill);
      li.appendChild(bar);
      li.appendChild(el("span", "d", "거리 " + s.distance));
      li.appendChild(el("span", "t", s.text));
      list.appendChild(li);
    });
  }
  box.appendChild(list);
  return box;
}

/** 확률 한 개를 읽을 수 있게 적는다.
 *  1 에 바짝 붙은 값이 "1.0000" 으로 뭉개지면 왜 이 순서인지가 화면에서 사라진다. */
function pp(x) {
  if (x === null || x === undefined) return "—";
  const v = Number(x);
  if (v > 0.9999 && v < 1) return v.toFixed(6);
  if (v > 0 && v < 0.0001) return v.toExponential(2);
  return v.toFixed(4);
}

/** 재정렬로 자리가 얼마나 움직였는지. 바뀐 순위만 보이면 무엇이 바뀐 줄 모른다. */
function moveNode(rr) {
  const d = rr.moved || 0;
  const cls = d > 0 ? "move up" : d < 0 ? "move down" : "move same";
  const text = d > 0 ? "← 검색 " + rr.rank_before + "위 ▲" + d
    : d < 0 ? "← 검색 " + rr.rank_before + "위 ▼" + (-d)
    : "검색도 " + rr.rank_before + "위";
  return el("span", cls, text);
}

/** 이 조각의 판정 내역. 모델이 적은 한 줄과 로그확률을 나란히 둔다 —
 *  둘이 어긋나는 것이 이 화면에서 보여 주려는 것이므로 하나만 적지 않는다. */
function rrNode(c) {
  const rr = c.rerank;
  const box = el("div", "rr");

  const head = el("div", "head");
  head.appendChild(el("b", null, "재정렬 판정"));
  head.appendChild(el("span", null, rr.ok ? "줄 세운 기준: " + (rr.source === "logprob"
    ? "첫 토큰의 로그확률" : rr.source === "said" ? "모델이 적은 확률" : "Y/N 판정만")
    : "판정 실패 — 검색 순서 그대로"));
  head.appendChild(el("span", null, rr.latency + "초"));
  box.appendChild(head);

  const rows = el("div", "rows");
  const row = (k, v, cls) => {
    const r = el("div", "r");
    r.appendChild(el("span", "k", k));
    r.appendChild(el("span", "v" + (cls ? " " + cls : ""), v));
    rows.appendChild(r);
  };
  if (rr.raw) row("모델이 적은 한 줄", rr.raw, "mono");
  row("Y/N 판정", (rr.verdict || "?") + (rr.verdict === "Y" ? " — 쓸모 있음"
    : rr.verdict === "N" ? " — 쓸모 없음" : " — 읽지 못함"));
  row("모델이 적은 확률", rr.said === null || rr.said === undefined ? "—" : rr.said.toFixed(2), "mono");

  const lp = rr.logprobs;
  if (lp) {
    row("첫 토큰", JSON.stringify(lp.token) + "  logprob " + lp.logprob
      + "  →  확률 " + pp(lp.prob), "mono");
    if (lp.alts && lp.alts.length) {
      row("그 자리의 후보", lp.alts.map((a) => JSON.stringify(a.token) + " " + pp(a.prob)).join("  ·  ")
        + (lp.missing ? "  (" + lp.missing + " 은 후보에 없었습니다)" : ""), "mono");
    }
    // 후보 목록이 잘려서 온다는 사실을 감추면 P(Y) 가 왜 1 이 아닌지 설명되지 않는다.
    row("잘려 나간 몫 r", pp(lp.rest) + (lp.missing
      ? " — 남은 몫을 전부 N 쪽으로 보아 보수적으로 셉니다" : ""), "mono");
    row("P(Y) = p(Y)/(p(Y)+p(N)+r)", pp(lp.p_raw) + " / (" + pp(lp.p_raw) + " + "
      + pp(lp.n_raw) + " + " + pp(lp.rest) + ")  =  " + pp(rr.score), "mono");
  } else if (rr.ok) {
    row("로그확률", "돌아오지 않아 쓰지 못했습니다", "warn");
  }
  if (rr.rank_after !== undefined) {
    row("순위", "검색 " + rr.rank_before + "위 → 재정렬 " + rr.rank_after + "위"
      + (rr.moved > 0 ? " (▲" + rr.moved + ")" : rr.moved < 0 ? " (▼" + (-rr.moved) + ")" : " (그대로)"));
  }
  box.appendChild(rows);
  if (rr.note) box.appendChild(el("p", "note", rr.note));
  return box;
}

function chunkNode(c, extra) {
  const n = el("div", "chunk");
  const meta = el("div", "meta");
  if (extra && extra.rank !== undefined) meta.appendChild(el("span", "no", extra.rank + "위"));
  // 재정렬을 켰으면 지금 순위만으로는 부족하다 — 검색이 준 자리와 판정을 함께 적는다.
  if (c.rerank && c.rerank.rank_after !== undefined) meta.appendChild(moveNode(c.rerank));
  if (c.rerank && c.rerank.verdict) {
    meta.appendChild(el("span", "verdict " + (c.rerank.verdict === "Y" ? "y" : "n"), c.rerank.verdict));
  }
  if (c.rerank && c.rerank.score !== null && c.rerank.score !== undefined) {
    meta.appendChild(el("span", "pyes", "P(Y) " + pp(c.rerank.score)));
  }
  // 모델이 쓴 글이 원문 조각인 척하면 안 된다. 배지·카드 색·아래 출처 줄 셋으로 알린다.
  if (c.source === "generated") {
    n.classList.add("generated");
    meta.appendChild(el("span", "gen", "생성"));
  }
  meta.appendChild(el("span", "no", "#" + (c.chunk_index ?? c.index)));
  if (extra && extra.score !== undefined)
    meta.appendChild(el("span", "score", (extra.scoreLabel || "유사도") + " " + extra.score));
  if (extra && extra.distance !== undefined)
    meta.appendChild(el("span", "dist", "거리 " + extra.distance));
  meta.appendChild(el("span", null, (c.n_chars ?? c.text.length) + "자"));
  if (c.page) meta.appendChild(el("span", null, c.page + "쪽"));
  if (c.document) meta.appendChild(el("span", null, c.document));
  n.appendChild(meta);
  n.appendChild(bodyNode(c));
  if (c.why) n.appendChild(whyNode(c));
  if (c.rerank) n.appendChild(rrNode(c));
  if (c.source === "generated") n.appendChild(provNode(c));
  n.onclick = () => n.classList.toggle("open");
  return n;
}

/** 생성된 근거의 출처. 어떤 질문에서 나왔고 무엇을 근거로 삼았는지 거슬러 갈 수 있어야 한다. */
function provNode(c) {
  const p = el("div", "prov");
  p.appendChild(el("span", null, "모델이 쓴 답변입니다 — 문서 원문이 아닙니다"));
  if (c.question) p.appendChild(el("span", "src", "그때의 질문: " + c.question));
  if (c.based_on) p.appendChild(el("span", "src", "그때의 근거: " + c.based_on));
  const when = [c.engine, c.created].filter(Boolean).join(" · ");
  if (when) p.appendChild(el("span", "src", when));
  return p;
}

function renderMoreChunks() {
  const list = $("#chunk-list");
  const old = $("#chunk-more");
  if (old) old.remove();

  const next = ALL_CHUNKS.slice(SHOWN, SHOWN + PREVIEW_STEP);
  next.forEach((c) => list.appendChild(chunkNode({ ...c, chunk_index: c.index })));
  SHOWN += next.length;

  if (SHOWN < ALL_CHUNKS.length) {
    const bar = el("div", "more");
    bar.id = "chunk-more";
    bar.appendChild(el("span", "hint",
      ALL_CHUNKS.length + "개 중 " + SHOWN + "개를 보고 있습니다"));
    const b = el("button", null, "더 보기");
    b.onclick = renderMoreChunks;
    bar.appendChild(b);
    list.appendChild(bar);
  }
}


// ── ② 청킹 ──────────────────────────────────────────────────────
// 의미 경계만 [거리 상위 %] 를 쓰고 나머지는 [길이] 를 쓴다. 의미 경계에서 길이는
// 백분위가 정하므로 길이 칸을 숨긴다 — 안 듣는 손잡이를 남겨 두지 않는다.
let LAST_SEM = null;
const PLOT_H = 56, PLOT_PAD = 8;

function strategyOf() {
  return document.querySelector("input[name=strategy]:checked").value;
}

function syncStrategy() {
  const sem = strategyOf() === "semantic";
  $("#size-wrap").classList.toggle("hidden", sem);
  $("#pct-wrap").classList.toggle("hidden", !sem);
  $("#sem-hint").classList.toggle("hidden", !sem);
  if (!sem) $("#sem-view").classList.add("hidden");
}
$$("input[name=strategy]").forEach((r) => { r.onchange = syncStrategy; });

/** 문장 사이 거리를 막대로 그린다. 임계선 위로 솟은 막대가 자르는 지점이다. */
function drawDistances(sem) {
  const box = $("#dist-bars");
  box.innerHTML = "";
  const ds = sem.distances || [];
  if (!ds.length) { $("#sem-view").classList.add("hidden"); return; }

  const max = Math.max(Math.max.apply(null, ds), sem.threshold, 0.0001);
  const snips = sem.snippets || [];
  ds.forEach((d, i) => {
    const b = el("i");
    // 반올림하지 않는다 — 막대 높이와 임계선이 같은 식에서 나와야 "선 위 = 자름" 이
    // 눈으로도 맞는다. 1px 반올림만으로 색과 위치가 어긋나 보인다.
    b.style.height = Math.max(2, (d / max) * PLOT_H) + "px";
    const cut = d >= sem.threshold;
    if (cut) b.classList.add("cut");
    const s = snips[i] || ["", ""];
    b.title = "경계 " + (i + 1) + " · 거리 " + d.toFixed(4) + (cut ? " · 자름" : "")
      + "\n…" + s[0] + "  ▶│◀  " + s[1] + "…";
    box.appendChild(b);
  });

  $("#dist-thr").style.bottom = (PLOT_PAD + (sem.threshold / max) * PLOT_H) + "px";
  $("#dist-max").textContent = "가장 먼 경계 " + max.toFixed(4);
  $("#lg-cuts").textContent = nf(sem.cuts);
  $("#lg-thr").textContent = sem.threshold.toFixed(4);
  $("#lg-pct").textContent = sem.percentile;
  $("#sem-view").classList.remove("hidden");
}

$("#btn-chunk").onclick = async () => {
  const strategy = strategyOf();
  const size = Number($("#size").value) || 500;
  const percentile = Number($("#pct").value) || 10;
  const sem = strategy === "semantic";
  msg("#chunk-msg", sem && !LAST_SEM ? "문장을 임베딩하는 중… 처음 한 번만 걸립니다" : "자르는 중…");
  $("#btn-chunk").disabled = true;
  try {
    const d = await api("/api/chunk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy, size, percentile }),
    });

    const items = [
      ["전략", d.strategy_label],
      ["청크", nf(d.summary.count)],
      ["가장 긴 조각", nf(d.summary.max) + "자"],
      ["가장 짧은 조각", nf(d.summary.min) + "자"],
      ["평균", nf(d.summary.avg) + "자"],
    ];
    if (d.semantic) {
      items.push(["문장", nf(d.semantic.sentences)]);
      items.push(["임계 거리", d.semantic.threshold.toFixed(4)]);
      items.push(["자른 곳", nf(d.semantic.cuts) + " / " + nf(d.semantic.boundaries)]);
      items.push(["문장 임베딩", d.semantic.cached ? "재사용" : "새로 계산"]);
    }
    cards("#chunk-summary", items);

    if (d.semantic) drawDistances(d.semantic);
    else $("#sem-view").classList.add("hidden");

    ALL_CHUNKS = d.chunks;
    SHOWN = 0;
    $("#chunk-list").innerHTML = "";
    renderMoreChunks();
    setStatus({ chunks: { count: d.summary.count, label: d.strategy_label } });

    // 백분위를 바꿨을 때 무엇이 달라졌는지 바로 읽히도록 직전 결과를 함께 적는다
    let note = "청크 " + nf(d.summary.count) + "개";
    if (d.semantic) {
      note += " · 상위 " + d.semantic.percentile + "% 에서 " + nf(d.semantic.cuts) + "곳 자름";
      if (LAST_SEM && LAST_SEM.percentile !== d.semantic.percentile) {
        note += " (직전 상위 " + LAST_SEM.percentile + "% · " + nf(LAST_SEM.count) + "개)";
      }
      note += d.semantic.cached ? " · 임베딩 재사용" : " · 임베딩 새로 계산";
      LAST_SEM = { percentile: d.semantic.percentile, count: d.summary.count };
    }
    msg("#chunk-msg", note + " — ③ 임베딩으로 넘어가세요", "ok");
  } catch (e) { msg("#chunk-msg", e.message, "err"); }
  finally { $("#btn-chunk").disabled = false; }
};

// ── ③ 임베딩 ────────────────────────────────────────────────────
function showStore(s) {
  const gen = s.generated || 0;
  cards("#store-summary", [
    ["적재된 청크", nf(s.total)],
    ["그중 생성된 근거", nf(gen), gen > 0],
    ["임베딩 모델", s.model || "-"],
    ["차원", s.dim ? nf(s.dim) : "-"],
  ]);
  const wrap = $("#store-docs");
  wrap.innerHTML = "";
  if (s.documents && s.documents.length) {
    const t = el("table");
    const hr = el("tr");
    ["문서", "청크", "청킹 전략"].forEach((h) => hr.appendChild(el("th", null, h)));
    const thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
    const tb = el("tbody");
    s.documents.forEach((d) => {
      const tr = el("tr", d.source === "generated" ? "gen-row" : null);
      tr.appendChild(el("td", null, d.document));
      tr.appendChild(el("td", null, nf(d.chunks)));
      tr.appendChild(el("td", null, d.source === "generated"
        ? "모델이 쓴 답변 (원문 아님)" : (STRATEGY_LABELS[d.strategy] || d.strategy)));
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t);
  }
  setStatus({ store: s });
}

$("#btn-embed").onclick = async () => {
  msg("#embed-msg", "임베딩 중… 창을 닫지 마세요");
  $("#btn-embed").disabled = true;
  try {
    const d = await api("/api/embed", { method: "POST" });
    showStore(d.status);
    msg("#embed-msg", d.added + "건 적재 완료 — ④ 검색으로 넘어가세요", "ok");
  } catch (e) { msg("#embed-msg", e.message, "err"); }
  finally { $("#btn-embed").disabled = false; }
};

$("#btn-clear-gen").onclick = async () => {
  const d = await api("/api/clear-generated", { method: "POST" });
  showStore(d.status);
  msg("#embed-msg", d.removed
    ? "생성된 근거 " + nf(d.removed) + "건을 지웠습니다. 문서에서 온 조각은 그대로입니다."
    : "지울 생성 근거가 없습니다", "ok");
};

$("#btn-reset").onclick = async () => {
  const d = await api("/api/reset", { method: "POST" });
  showStore(d.status);
  msg("#embed-msg", "저장소를 비웠습니다", "ok");
};

$("#btn-peek").onclick = async () => {
  const idx = Number($("#peek-idx").value) || 0;
  const st = await api("/api/status");
  const docs = st.store.documents || [];
  if (!docs.length) return msg("#peek-msg", "적재된 문서가 없습니다", "err");
  try {
    const d = await api("/api/vector", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: docs[0].document, chunk_index: idx }),
    });
    const out = $("#peek-out");
    out.classList.remove("hidden");
    out.textContent = "#" + idx + " → " + d.dim + "차원 중 앞 10개  ["
      + d.head.join(", ") + ", …]";
    msg("#peek-msg", "", "ok");
  } catch (e) { msg("#peek-msg", e.message, "err"); }
};

// ── ④ 검색 ──────────────────────────────────────────────────────
// 같은 질문을 두 방식으로 돌려 나란히 그린다. 두 열은 서로 다른 것을 재므로
// 점수를 직접 견주지 않는다 — 왼쪽은 거리(0 에 가까울수록 가까움), 오른쪽은
// 같은 질문 안에서만 뜻이 있는 BM25 점수다.

/** HyDE 초안. 답이 아니라 검색용 추측이라는 것이 먼저 읽혀야 한다. */
function renderHyde(d, wantHyde) {
  const box = $("#hyde-box");
  box.innerHTML = "";
  const hy = d.hyde;
  if (!wantHyde || !hy) { box.className = "hyde hidden"; return; }
  box.className = "hyde";

  const head = el("div", "head");
  head.appendChild(el("b", null, "HyDE 가상 답변"));
  head.appendChild(el("span", null, hy.ok ? "이 글로 검색했습니다" : "쓰지 못해 질의 그대로 검색했습니다"));
  head.appendChild(el("span", null, hy.model));
  head.appendChild(el("span", null, hy.latency + "초"));
  box.appendChild(head);

  box.appendChild(el("p", "warn-line",
    "아래 글은 모델이 지어낸 검색용 추측입니다. 사실 확인을 하지 않았고, "
    + "답변의 근거로 쓰이지 않으며 저장소에도 들어가지 않습니다."));
  if (hy.ok) box.appendChild(el("div", "draft", hy.text));
  if (hy.note) box.appendChild(el("p", "foot", hy.note));
  box.appendChild(el("p", "foot", hy.ok
    ? "왼쪽(의미 검색)은 이 글의 벡터로 찾았습니다. 오른쪽(BM25)은 질의의 낱말로 찾았습니다 — HyDE 는 임베딩을 바꾸는 방법이라 낱말 검색에는 쓰지 않습니다."
    : "두 검색 모두 원래 질의를 그대로 썼습니다."));
}

/** 저장소에 모델의 글이 들어갔다는 사실을 알린다. 조용히 넣지 않는다. */
function renderSaved(d) {
  const box = $("#saved-box");
  box.innerHTML = "";
  const sv = d.saved;
  if (!sv || (!sv.saved.length && !sv.skipped.length)) { box.className = "saved hidden"; return; }
  box.className = "saved";

  const head = el("div", "head");
  head.appendChild(el("b", null, "답변을 근거로 저장"));
  head.appendChild(el("span", null, sv.saved.length + "건 저장 · " + sv.skipped.length + "건 건너뜀"));
  head.appendChild(el("span", null, "저장소의 생성 근거 " + nf(sv.status.generated) + "건"));
  box.appendChild(head);

  if (sv.saved.length) {
    box.appendChild(el("p", "warn-line",
      "이제부터 이 글이 검색에 걸립니다. 문서에서 온 원문이 아니라 모델이 쓴 글이며, "
      + "결과에서 [생성] 으로 표시됩니다. ③ 임베딩 탭의 [생성 근거만 비우기] 로 되돌릴 수 있습니다."));
  }
  const ul = el("ul");
  sv.saved.forEach((x) => {
    const li = el("li", null, x.label + " 답변 " + nf(x.n_chars) + "자 — 근거 " + x.based_on);
    ul.appendChild(li);
  });
  sv.skipped.forEach((x) => {
    ul.appendChild(el("li", "skip", x.engine + " 건너뜀 — " + x.why));
  });
  box.appendChild(ul);
}

/** [답변을 근거로 저장] 은 [답변 생성] 없이는 할 일이 없다. */
function syncSearchOpts() {
  const on = $("#gen").checked;
  const save = $("#save");
  save.disabled = !on;
  if (!on) save.checked = false;
  save.parentNode.classList.toggle("off", !on);
}
$("#gen").onchange = syncSearchOpts;

/** 무엇으로 검색했는지를 적는다. 바꾼 질의로 찾았더라도 답은 원래 질문에 한다. */
function rwRow(k, v, hint) {
  const r = el("div", "r");
  r.appendChild(el("span", "k", k));
  r.appendChild(el("span", "v", v));
  if (hint) r.appendChild(el("span", "h", hint));
  return r;
}

function renderRewrite(d, wantRw) {
  const box = $("#rewrite-box");
  box.innerHTML = "";
  const rw = d.rewrite;
  if (!wantRw || !rw) { box.className = "rewrite hidden"; return; }
  box.className = "rewrite" + (rw.applied ? " on" : "");

  const head = el("div", "head");
  head.appendChild(el("b", null, "질의 재작성"));
  head.appendChild(el("span", "state",
    rw.applied ? "적용됨" : "적용 안 됨 — 원문으로 검색했습니다"));
  head.appendChild(el("span", null, rw.model));
  head.appendChild(el("span", null, rw.latency + "초"));
  box.appendChild(head);

  const rows = el("div", "rows");
  rows.appendChild(rwRow("원래 질문", rw.original, "답변은 이 문장으로 만듭니다"));
  rows.appendChild(rwRow("실제 검색 질의", d.search_query, rw.applied
    ? "두 검색 모두 이 문장으로 찾았습니다"
    : "원래 질문을 그대로 썼습니다"));
  box.appendChild(rows);

  if (rw.note) box.appendChild(el("p", "note", rw.note));
  if (rw.rejected) box.appendChild(el("p", "note", "버린 질의 — " + rw.rejected));
}

const RR_SOURCE = { logprob: "첫 토큰의 로그확률", said: "모델이 적은 확률", verdict: "Y/N 판정만" };

/** 재정렬이 무엇을 기준으로 순서를 바꿨는지. 순서만 바뀌고 이유가 없으면
 *  화면이 설명되지 않는다 — 판정의 꼴과 줄 세운 값을 먼저 밝힌다. */
function renderRerank(d, wantRr) {
  const box = $("#rerank-box");
  box.innerHTML = "";
  const cols = [d.results.semantic.rerank, d.results.bm25.rerank].filter(Boolean);
  if (!wantRr || !cols.length) { box.className = "rerank hidden"; return; }
  const applied = cols.some((r) => r.applied);
  box.className = "rerank" + (applied ? " on" : "");

  const calls = cols.reduce((n, r) => n + r.calls, 0);
  const secs = Math.max(...cols.map((r) => r.latency));
  const failed = cols.reduce((n, r) => n + r.failed, 0);
  const sources = {};
  cols.forEach((r) => Object.keys(r.sources || {}).forEach((k) => {
    sources[k] = (sources[k] || 0) + r.sources[k];
  }));

  const head = el("div", "head");
  head.appendChild(el("b", null, "LLM 재정렬 (rerank)"));
  head.appendChild(el("span", "state", applied ? "적용됨" : "적용 안 됨 — 검색 순서 그대로입니다"));
  head.appendChild(el("span", null, cols[0].model));
  head.appendChild(el("span", null, "판정 " + calls + "회"));
  head.appendChild(el("span", null, secs + "초"));
  box.appendChild(head);

  const rows = el("div", "rows");
  rows.appendChild(rwRow("후보 → 남길 개수",
    "두 열 각각 " + d.pool + "개를 꺼내 판정하고 " + d.k + "개를 남겼습니다",
    "K 개만 꺼내 다시 줄 세우면 순서만 바뀝니다. 원래 순위로는 화면에 못 오던 조각을 끌어올리는 것이 재정렬입니다."));
  rows.appendChild(rwRow("판정에 쓴 질문", d.query,
    d.search_query === d.query ? "검색에 쓴 문장과 같습니다"
      : "재작성한 검색어(" + d.search_query + ")가 아니라 원래 질문으로 판정했습니다"));
  rows.appendChild(rwRow("줄 세운 값",
    Object.keys(sources).length
      ? Object.keys(sources).map((k) => (RR_SOURCE[k] || k) + " " + sources[k] + "건").join(" · ")
      : "없음",
    "판정마다 무엇으로 점수를 냈는지입니다"));
  box.appendChild(rows);

  box.appendChild(el("p", "foot",
    "모델에게 조각을 한 장씩 보여 주고 " + JSON.stringify("Y 0.92") + " 한 줄만 받습니다 — "
    + "첫 글자가 Y(쓸모 있음) 또는 N(쓸모 없음)이고, 한 칸 띄운 뒤가 모델이 스스로 매긴 확률입니다."));
  box.appendChild(el("p", "foot",
    "순서는 그 첫 토큰의 로그확률로 정합니다. P(Y) = p(Y) / (p(Y) + p(N) + r) — 모델이 그 자리에서 "
    + "Y 와 N 사이 어디로 기울었는지입니다. 모델이 적은 확률은 0.9 · 0.95 몇 값에 뭉쳐 열 조각을 "
    + "줄 세우기 어렵지만, 로그확률은 촘촘해서 같은 0.9 안에서도 갈립니다. 두 숫자를 카드마다 나란히 적어 두었습니다."));
  box.appendChild(el("p", "foot",
    "r 은 후보 목록에서 잘려 나간 몫입니다(1 − 후보들의 확률 합). API 는 확률이 큰 후보만 보내 "
    + "모델이 확신하면 고른 토큰 하나만 옵니다. 그대로 두면 p(N)=0 이라 P(Y) 가 모두 1.0 으로 뭉치므로, "
    + "남은 몫을 N 쪽에 보태 보수적으로 셉니다. 그래도 같으면 모델이 적은 확률로, 그마저 같으면 검색 순서로 가릅니다."));
  if (failed) {
    box.appendChild(el("p", "note", failed + "개를 판정하지 못했습니다. 그 조각은 점수를 지어내지 않고 "
      + "검색이 준 순서 그대로 뒤에 두었습니다."));
  }
  if (sources.said || sources.verdict) {
    box.appendChild(el("p", "note",
      "로그확률이 오지 않은 판정이 있습니다(모델이 top_logprobs 를 받지 않는 경우). "
      + "그 조각은 모델이 적은 확률로 줄을 세웠습니다."));
  }
}

/** 한 열의 재정렬 전후 순위. 밀려나 화면에서 사라진 조각까지 적어야
 *  재정렬이 무슨 일을 했는지 보인다. */
function renderRerankPanel(key, res) {
  const box = $("#rr-" + key);
  box.innerHTML = "";
  const rr = res.rerank;
  if (!rr || !rr.rows.length) { box.className = "rr-panel hidden"; return; }
  box.className = "rr-panel" + (rr.applied ? " on" : "");

  const head = el("div", "head");
  head.appendChild(el("b", null, "재정렬 전 → 후"));
  head.appendChild(el("span", null, "후보 " + rr.pool + "개 · 판정 " + rr.calls + "회 · " + rr.latency + "초"));
  if (rr.applied) head.appendChild(el("span", null, "자리가 바뀐 조각 " + rr.moved + "개"));
  box.appendChild(head);
  if (rr.note) box.appendChild(el("p", "note", rr.note));

  const t = el("table", "rr-table");
  const hr = el("tr");
  ["전 → 후", "판정", "P(Y)", "모델", "조각"].forEach((h) => hr.appendChild(el("th", null, h)));
  const thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
  const tb = el("tbody"); t.appendChild(tb);

  const best = Math.max(...rr.rows.map((r) => r.score || 0), 0.0001);
  rr.rows.forEach((r) => {
    const tr = el("tr", r.kept ? null : "out");
    const d = r.moved || 0;
    const mv = el("td");
    mv.appendChild(el("span", "n", String(r.rank_before)));
    mv.appendChild(el("span", "arr " + (d > 0 ? "up" : d < 0 ? "down" : "same"),
      d > 0 ? "▲" : d < 0 ? "▼" : "→"));
    mv.appendChild(el("span", "n", r.kept ? String(r.rank_after) : "탈락"));
    tr.appendChild(mv);

    const v = el("td");
    v.appendChild(el("span", "verdict " + (r.verdict === "Y" ? "y" : r.verdict === "N" ? "n" : ""), r.verdict));
    tr.appendChild(v);

    const sc = el("td", "num");
    const bar = el("i", "bar");
    const fill = el("i", "fill");
    fill.style.width = Math.max(2, Math.min(100, ((r.score || 0) / best) * 100)) + "%";
    bar.appendChild(fill);
    sc.appendChild(bar);
    sc.appendChild(el("span", "d", pp(r.score)));
    if (r.source && r.source !== "logprob") sc.appendChild(el("span", "why-src", RR_SOURCE[r.source]));
    tr.appendChild(sc);

    tr.appendChild(el("td", "num", r.said === null || r.said === undefined ? "—" : r.said.toFixed(2)));

    const c = el("td", "src");
    c.appendChild(el("span", "id", "#" + r.chunk_index + (r.page ? " · " + r.page + "쪽" : "")));
    c.appendChild(el("span", "head", r.head));
    if (r.note) c.appendChild(el("span", "note", r.note));
    tr.appendChild(c);
    tb.appendChild(tr);
  });

  const wrap = el("div", "table-wrap");
  wrap.appendChild(t);
  box.appendChild(wrap);
  box.appendChild(el("p", "foot",
    "P(Y) 막대는 이 열에서 가장 높은 판정 대비 몫입니다. 회색 줄은 판정에서 K 밖으로 밀려나 "
    + "아래 결과에 나오지 않는 조각입니다 — 재정렬을 끄면 그중 위쪽 " + rr.k + "개가 결과였습니다."));
}

/** 한 열을 그린다. key 는 "semantic" 또는 "bm25". */
function renderColumn(key, res, wantWhy) {
  const bm = key === "bm25";

  const stat = $("#stat-" + key);
  if (bm) {
    const s = res.stats || {};
    stat.textContent = "말뭉치 " + nf(s.corpus) + "조각 · 질문 낱말 " + nf((s.query_terms || []).length)
      + "개 [" + (s.query_terms || []).slice(0, 8).join(" ") + "]"
      + " · 낱말이 걸린 조각 " + nf(s.matched) + "개 · " + res.latency + "초 · 외부 호출 없음";
  } else {
    let t = "질문 임베딩 1회 · " + res.latency + "초";
    if (res.highlight && res.highlight.segments) {
      t += " · 근거 하이라이트: 뽑힌 조각을 문장 " + res.highlight.segments
        + "개로 쪼개 다시 임베딩 " + res.highlight.latency + "초";
    }
    stat.textContent = t;
  }
  stat.classList.remove("hidden");

  renderRerankPanel(key, res);

  const a = $("#ans-" + key);
  a.innerHTML = "";
  if (res.answer) {
    a.classList.remove("hidden");
    const head = el("div", "head");
    head.appendChild(el("span", null, "답변 · " + res.answer.model));
    head.appendChild(el("span", null, "근거 " + res.answer.used.length + "조각"));
    head.appendChild(el("span", null, "프롬프트 " + nf(res.answer.prompt_chars) + "자"));
    head.appendChild(el("span", null, res.answer.latency + "초"));
    a.appendChild(head);
    a.appendChild(el("div", "text", res.answer.text));
  } else {
    a.classList.add("hidden");
  }

  const box = $("#hits-" + key);
  box.innerHTML = "";
  if (!res.hits.length) {
    box.appendChild(el("p", "none", bm
      ? "질문의 낱말이 저장된 조각에 하나도 나오지 않아 찾지 못했습니다. "
        + "BM25 는 글자가 겹쳐야 찾습니다 — 질문을 문서에 쓰인 낱말로 바꿔 보세요. "
        + "왼쪽 의미 검색은 같은 질문으로도 찾아냅니다."
      : "저장소가 비어 있습니다. ③ 에서 먼저 적재하세요."));
    return;
  }
  res.hits.forEach((h, i) => {
    const shown = wantWhy ? h : { ...h, segments: null, why: null };
    const node = chunkNode(shown, {
      rank: h.rank,
      score: h.score,
      scoreLabel: bm ? "점수" : "유사도",
      distance: bm ? undefined : h.distance,
    });
    // 1위만 펼쳐 둔다. 접힌 미리보기 아래에 하이라이트가 숨으면 보이지 않는다.
    if (i === 0 && wantWhy && h.segments) node.classList.add("open");
    box.appendChild(node);
  });
}

async function search() {
  const query = $("#query").value.trim();
  const k = Number($("#k").value) || 5;
  const wantRw = $("#rw").checked;
  const wantHyde = $("#hyde").checked;
  const wantRr = $("#rr").checked;
  const wantWhy = $("#why").checked;
  const wantAnswer = $("#gen").checked;
  const wantSave = $("#save").checked && wantAnswer;
  const includeGen = $("#incgen").checked;
  if (!query) return msg("#search-msg", "질문을 입력하세요", "err");
  msg("#search-msg", wantHyde ? "가상 답변을 쓰고 그 글로 검색하는 중…"
    : wantRw ? "질의를 다듬고 검색하는 중…"
    : wantRr ? "검색하고 조각마다 Y/N 판정을 받는 중…"
    : wantAnswer ? "검색하고 답을 두 개 만드는 중…" : "검색 중…");
  $("#btn-search").disabled = true;
  try {
    const d = await api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query, k, rewrite: wantRw, hyde: wantHyde, rerank: wantRr, highlight: wantWhy,
        answer: wantAnswer, save_answer: wantSave, include_generated: includeGen,
      }),
    });

    renderRewrite(d, wantRw);
    renderHyde(d, wantHyde);
    renderRerank(d, wantRr);
    renderSaved(d);
    if (d.saved) showStore(d.saved.status);

    const v = $("#query-vec");
    v.innerHTML = "";
    v.classList.remove("hidden");
    v.textContent = (d.hyde && d.hyde.ok ? "가상 답변" : "검색 질의") + " 벡터 "
      + d.dim + "차원 중 앞 10개 — [" + d.query_vector_head.join(", ")
      + ", …]  ← 왼쪽 열은 이 숫자로 찾습니다";
    v.appendChild(el("div", "more-line",
      "오른쪽 열은 벡터를 쓰지 않습니다. 같은 저장소를 낱말로 훑습니다."
      + (d.include_generated ? "" : "  ·  생성 근거는 양쪽 모두에서 뺐습니다.")));
    $("#why-legend").classList.toggle("hidden", !wantWhy);

    renderColumn("semantic", d.results.semantic, wantWhy);
    renderColumn("bm25", d.results.bm25, wantWhy);

    const ns = d.results.semantic.hits.length, nb = d.results.bm25.hits.length;
    // 두 열이 같은 조각을 꺼냈는지가 이 화면에서 가장 먼저 눈에 들어와야 한다
    const idOf = (h) => h.document + "#" + h.chunk_index;
    const shared = d.results.semantic.hits.filter(
      (h) => d.results.bm25.hits.some((b) => idOf(b) === idOf(h))).length;
    let note = "의미 " + ns + "건 · BM25 " + nb + "건 · 겹친 조각 " + shared + "개";
    if (d.rewrite) note += d.rewrite.applied ? " · 재작성한 질의로 검색" : " · 원문으로 검색";
    if (d.hyde) note += d.hyde.ok ? " · HyDE 적용" : " · HyDE 미적용";
    if (d.rerank_on) {
      const rrs = [d.results.semantic.rerank, d.results.bm25.rerank].filter(Boolean);
      const calls = rrs.reduce((n, r) => n + r.calls, 0);
      const moved = rrs.reduce((n, r) => n + r.moved, 0);
      note += rrs.some((r) => r.applied)
        ? " · 재정렬 " + calls + "회 판정, 자리 바뀐 조각 " + moved + "개"
        : " · 재정렬 미적용";
    }
    if (d.saved && d.saved.saved.length) note += " · 답변 " + d.saved.saved.length + "건 저장";
    msg("#search-msg", note, d.rewrite && d.rewrite.note && !d.rewrite.applied ? "err" : "ok");
  } catch (e) { msg("#search-msg", e.message, "err"); }
  finally { $("#btn-search").disabled = false; }
}

$("#btn-search").onclick = search;
$("#query").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

// ── 시작 ────────────────────────────────────────────────────────
(async () => {
  try {
    const s = await api("/api/status");
    STRATEGY_LABELS = s.strategies || {};
    showStore(s.store);
    if (s.document && s.document.loaded) showDoc(s.document);
    // 새로고침해도 청킹까지 온 상태가 현황에 남아 있어야 한다
    const c = s.chunking || {};
    if (c.summary && c.summary.count) {
      setStatus({ chunks: { count: c.summary.count, label: c.label } });
      const r = document.querySelector('input[name=strategy][value="' + c.strategy + '"]');
      if (r) r.checked = true;
      if (c.size) $("#size").value = c.size;
      if (c.percentile) {
        $("#pct").value = c.percentile;
        LAST_SEM = { percentile: c.percentile, count: c.summary.count };
      }
    }
    if (s.defaults && s.defaults.percentile && !(c.summary && c.percentile)) {
      $("#pct").value = s.defaults.percentile;
    }
  } catch (e) { /* 서버가 막 떴을 때는 조용히 넘어간다 */ }
  syncStrategy();
  syncSearchOpts();
  gate();
})();
