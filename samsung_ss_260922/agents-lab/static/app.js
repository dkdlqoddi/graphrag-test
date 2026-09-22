"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let STATE = null;

async function get(path) {
  const r = await fetch(path);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

/* ── 탭 ─────────────────────────────────────────────── */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("on"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on"));
    btn.classList.add("on");
    document.querySelector(`.panel[data-panel="${btn.dataset.tab}"]`).classList.add("on");
  });
});

/* ── 그리기 ─────────────────────────────────────────── */
function drawTools() {
  const box = $("toolList");
  box.innerHTML = "";
  STATE.tools.filter((t) => t.source === "내장").forEach((t) => {
    const el = document.createElement("div");
    el.className = "tool";
    const changed = t.description !== t.default;
    el.innerHTML = `
      <div class="tool-head">
        <span class="tool-name">${esc(t.name)}</span>
        <span class="tool-meta">인자 ${esc(t.params.join(", ") || "없음")}</span>
        ${changed ? '<span class="edited">고침</span>' : ""}
      </div>
      <textarea rows="2"></textarea>
      <button class="apply">적용</button>`;
    const ta = el.querySelector("textarea");
    ta.value = t.description;
    el.querySelector("button").addEventListener("click", async () => {
      await post("/api/tool/description", { name: t.name, description: ta.value });
      refresh();
    });
    box.appendChild(el);
  });
}

function drawNotes() {
  const box = $("notes");
  const notes = STATE.notes || [];
  if (!notes.length) {
    box.innerHTML = '<div class="empty">메모가 없습니다.</div>';
  } else {
    box.innerHTML = notes.map((n) =>
      `<div class="note"><b>${esc(n.title)}</b><span>${esc(n.body)}</span></div>`).join("");
  }
  $("chipNotes").textContent = `메모 ${notes.length}`;
}

function drawMcp() {
  const list = $("mcpList");
  const book = (STATE.mcp && STATE.mcp.catalog) || [];
  list.innerHTML = "";
  book.forEach((srv) => {
    const el = document.createElement("div");
    el.className = "server";
    el.innerHTML = `
      <div class="body">
        <b>${esc(srv.label)}${srv.custom ? '<span class="mine">직접 등록</span>' : ""}</b>
        <span>${esc(srv.detail)}</span>
        ${srv.on ? `<span class="tools">이 서버가 내준 도구 ${srv.tools}개</span>` : ""}
      </div>
      <button class="toggle ${srv.on ? "ghost" : "primary"}">${srv.on ? "연결 끊기" : "연결"}</button>
      ${srv.custom ? '<button class="del" title="목록에서 지우기">✕</button>' : ""}`;
    el.querySelector(".toggle").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = srv.on ? "끊는 중…" : "연결 중…";
      await post("/api/mcp/toggle", { name: srv.name, on: !srv.on });
      refresh();
    });
    const del = el.querySelector(".del");
    if (del) {
      del.addEventListener("click", async () => {
        if (!confirm(`${srv.label} 을(를) 목록에서 지웁니다. 주소를 다시 넣으면 또 등록할 수 있습니다.`)) return;
        del.disabled = true;
        await post("/api/mcp/remove", { name: srv.name });
        refresh();
      });
    }
    list.appendChild(el);
  });

  $("mergedTools").innerHTML = STATE.tools.map((t) =>
    `<div><code>${esc(t.name)}</code><span class="tool-meta">${esc(t.source)}</span>
     <span>${esc(t.description)}</span></div>`).join("");
}

/* 주소를 받아 서버에 붙어 보고, 그 서버가 내준 도구를 목록에 넣는다.
   붙는 데 시간이 걸릴 수 있으므로 무엇을 하는 중인지 계속 알려 준다. */
async function registerMcp() {
  const url = $("mcpUrl").value.trim();
  const btn = $("mcpAdd");
  const note = $("mcpNote");
  const found = $("mcpFound");
  if (!url) {
    note.textContent = "MCP 서버 주소를 입력해 주세요.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "확인 중…";
  note.textContent = "서버에 붙어 도구 목록을 받아 오는 중…";
  found.hidden = true;
  try {
    const r = await post("/api/mcp/register", { url });
    note.textContent = r.message || (r.ok ? "등록했습니다." : "등록하지 못했습니다.");
    if (r.ok) {
      $("mcpUrl").value = "";
      const tools = r.tools || [];
      found.innerHTML = tools.map((t) =>
        `<div><code>${esc(t.name)}</code><span>${esc(t.description)}</span></div>`).join("");
      found.hidden = tools.length === 0;
      await refresh();                 // 도구 목록·서버 목록을 새 상태로 다시 그린다
    }
  } catch (e) {
    note.textContent = "서버에 연결하지 못했습니다.";
  }
  btn.disabled = false;
  btn.textContent = "등록";
}

function drawErrors() {
  const box = $("errors");
  const list = STATE.errors || [];
  box.hidden = list.length === 0;
  box.innerHTML = list.map((e) => `<div>${esc(e)}</div>`).join("");
}

/* ── 연구 자료 파일 ──────────────────────────────────── */
function sizeText(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function drawFiles(files) {
  const box = $("fileList");
  const list = files || [];
  if (!list.length) {
    box.innerHTML = '<div class="empty">올린 파일이 없습니다.</div>';
    return;
  }
  box.innerHTML = "";
  list.forEach((f) => {
    const el = document.createElement("div");
    el.className = "file";
    el.innerHTML = `<span class="nm">${esc(f.name)}</span>
      <span class="sz">${sizeText(f.bytes)}</span>
      <button class="del" title="지우기">✕</button>`;
    el.querySelector("button").addEventListener("click", async () => {
      if (!confirm(`${f.name} 을(를) 지웁니다. 되돌릴 수 없습니다.`)) return;
      const r = await post("/api/data/delete", { name: f.name });
      drawFiles(r.files);
      $("fileNote").textContent = r.ok ? `${f.name} 을(를) 지웠습니다.`
                                       : (r.message || "지우지 못했습니다.");
    });
    box.appendChild(el);
  });
}

/* 파일을 base64 로 실어 보낸다. 서버의 POST 는 전부 JSON 이라 multipart 를 쓰지 않는다. */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

async function uploadFiles(files) {
  const have = (STATE && STATE.research_files || []).map((f) => f.name);
  const done = [], failed = [];
  for (const file of files) {
    if (have.includes(file.name) &&
        !confirm(`${file.name} 이(가) 이미 있습니다. 덮어쓸까요?`)) continue;
    $("fileNote").textContent = `${file.name} 올리는 중…`;
    try {
      const r = await post("/api/data/upload",
                           { name: file.name, data: await readAsBase64(file) });
      if (r.ok) { done.push(r.name); drawFiles(r.files); }
      else failed.push(`${file.name} — ${r.message}`);
    } catch (e) { failed.push(`${file.name} — 보내지 못했습니다.`); }
  }
  $("fileNote").textContent =
    [done.length ? `${done.join(", ")} 올렸습니다.` : "", ...failed].filter(Boolean).join(" / ")
    || "올린 것이 없습니다.";
  refresh();
}

function draw() {
  $("chipTools").textContent = `도구 ${STATE.tools.length}`;
  $("prompt").value = STATE.prompt;
  $("dataPath").value = STATE.data_path;
  $("tabAgents").hidden = !STATE.multi;
  drawTools();
  drawNotes();
  drawMcp();
  drawFiles(STATE.research_files);
  drawErrors();
}

async function refresh() {
  STATE = await get("/api/state");
  draw();
}

/* ── 대화 ───────────────────────────────────────────── */
function renderCalls(calls) {
  if (!calls || !calls.length) {
    return '<div class="meta">도구를 부르지 않았습니다.</div>';
  }
  return calls.map((c) => `
    <div class="call">
      <b>${esc(c.tool)}</b><span class="badge">${esc(c.source)}</span>
      <pre>인자   ${esc(c.args)}
결과   ${esc(c.result)}</pre>
    </div>`).join("");
}

async function send() {
  const input = $("message");
  const text = input.value.trim();
  if (!text) return;
  $("send").disabled = true;
  $("answer").hidden = false;
  $("answer").textContent = "생각하는 중…";
  $("calls").innerHTML = "";
  try {
    const r = await post("/api/chat", { message: text });
    if (!r.ok) {
      $("answer").textContent = r.message || "실패했습니다.";
    } else {
      $("answer").textContent = r.answer;
      // steps 는 도구 호출 수가 아니라 AI 와 주고받은 왕복 수다. 도구를 한 번 부르면
      // "부르겠다"와 "결과를 보고 답한다"로 두 번 오간다.
      $("calls").innerHTML = renderCalls(r.calls) +
        `<div class="meta">${r.elapsed}초 · 도구 ${r.calls.length}회 ·
         AI 왕복 ${r.steps}회 · ${r.tokens}토큰</div>`;
      STATE.notes = r.notes;
      drawNotes();
    }
  } catch (e) {
    $("answer").textContent = "서버에 연결하지 못했습니다.";
  }
  $("send").disabled = false;
}

/* ── 삼각형 그래프 ───────────────────────────────────── */
/* index.html 의 원 좌표와 같아야 한다. 변은 원 테두리에서 시작해 테두리에서 끝난다. */
const GEO = {
  orchestrator: { x: 360, y: 86, color: "#1428A0", label: "연구책임자" },
  research: { x: 132, y: 318, color: "#0F7B6C", label: "자료조사 연구원" },
  experiment: { x: 588, y: 318, color: "#B26A00", label: "실험수행 연구원" },
};
const NODE_R = 48;

function edge(from, to) {
  const a = GEO[from], b = GEO[to];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return {
    d: `M ${a.x + ux * NODE_R} ${a.y + uy * NODE_R} L ${b.x - ux * NODE_R} ${b.y - uy * NODE_R}`,
    x1: a.x + ux * NODE_R, y1: a.y + uy * NODE_R,
    x2: b.x - ux * NODE_R, y2: b.y - uy * NODE_R,
  };
}

function setNode(role, cls) {
  const g = document.querySelector(`.node[data-role="${role}"]`);
  if (!g) return;
  g.classList.remove("active");
  if (cls) g.classList.add(cls);
}

function clearFlow() {
  $("flow").setAttribute("hidden", "");
  $("packet").setAttribute("hidden", "");
  $("wire").hidden = true;
}

/* 오가는 중인 변 하나를 그린다. back 이면 연구원 → 책임자 방향. */
function drawFlow(role, back, moving, fail) {
  const e = back ? edge(role, "orchestrator") : edge("orchestrator", role);
  const flow = $("flow");
  flow.setAttribute("d", e.d);
  flow.setAttribute("stroke", fail ? "#b3261e" : GEO[role].color);
  flow.classList.toggle("moving", !!moving);
  flow.removeAttribute("hidden");

  // 흐름이 멈춘 상태에서는 도착점에 점을 찍어 어디까지 갔는지 보인다.
  const packet = $("packet");
  packet.setAttribute("cx", e.x2);
  packet.setAttribute("cy", e.y2);
  packet.setAttribute("fill", fail ? "#b3261e" : GEO[role].color);
  if (moving) packet.setAttribute("hidden", "");
  else packet.removeAttribute("hidden");
}

function showWire(dir, kind, text, cls) {
  $("wireDir").textContent = dir;
  $("wireKind").textContent = kind;
  $("wireText").textContent = text || "(내용 없음)";
  $("wire").className = "wirebox" + (cls ? " " + cls : "");
  $("wire").hidden = false;
}

function setStatus(text, cls) {
  const el = $("graphStatus");
  el.textContent = text;
  el.className = "status" + (cls ? " " + cls : "");
}

/* 로그의 마지막 항목이 지금 상태를 말해 준다.
   delegate 뒤에 return 이 없으면 → 그 연구원이 일하는 중.
   return 이 마지막이면 → 보고가 돌아왔고 책임자가 다음을 정하는 중. */
/* 도는 중에는 맡기기를 잠그고 중지를 연다. 새로고침으로 들어와도 맞도록 여기서 정한다.
   이미 중지를 요청했으면 중지 버튼도 다시 잠근다. */
function setRunning(running, stopping) {
  $("startResearch").disabled = !!running;
  $("askFollow").disabled = !!running;
  $("stopResearch").disabled = !running || !!stopping;
}

function applyProgress(p) {
  const log = p.log || [];
  setRunning(p.running, p.stopping);
  ["orchestrator", "research", "experiment"].forEach((r) => setNode(r, null));

  if (!log.length) {
    clearFlow();
    if (p.running) { setNode("orchestrator", "active"); setStatus("연구책임자가 읽는 중…", "busy"); }
    else setStatus("대기 중");
    return;
  }

  const last = log[log.length - 1];

  if (last.kind === "delegate") {
    setNode(last.to, "active");
    drawFlow(last.to, false, true, false);
    showWire(`연구책임자 → ${last.label}`, "지시문", last.instruction);
    setStatus(p.stopping ? "중지하는 중 — 맡긴 일이 끝나기를 기다립니다…"
                         : `${last.label}이 일하는 중…`, "busy");
    return;
  }

  if (last.kind === "return") {
    const bad = last.ok === false;
    drawFlow(last.from, true, false, bad);
    showWire(`${last.label} → 연구책임자`, bad ? "실패" : `보고 · ${last.elapsed}초 · 도구 ${(last.calls || []).length}회`,
             last.result, bad ? "fail" : "back");
    if (p.running) {
      setNode("orchestrator", "active");
      setStatus("연구책임자가 다음을 정하는 중…", "busy");
    } else {
      setStatus(bad ? "실패" : "끝", bad ? "fail" : "done");
    }
    return;
  }

  // final
  clearFlow();
  showWire("연구책임자 결론", last.stopped ? "중지됨" : "최종 보고", last.text, "");
  const n = log.filter((e) => e.kind === "delegate").length;
  if (last.stopped) setStatus(`중지됨 · 위임 ${n}회`, "fail");
  else setStatus(`끝 · 위임 ${n}회`, "done");
}

/* 연구가 도는 동안 진행 상황을 물어본다. 이 GET 은 서버에서 락을 잡지 않으므로
   /api/research 가 응답을 안 준 채로 도는 중에도 답이 온다. */
let POLL = null;

function startPolling() {
  stopPolling();
  POLL = setInterval(async () => {
    try {
      const p = await get("/api/research/progress");
      applyProgress(p);
      if (!p.running) stopPolling();
    } catch (e) { /* 잠깐 못 받아도 다음 차례에 다시 묻는다 */ }
  }, 600);
}

function stopPolling() {
  if (POLL) { clearInterval(POLL); POLL = null; }
}

/* ── 에이전트 ────────────────────────────────────────── */
function drawAgents(list) {
  $("agentList").innerHTML = list.map((a) => {
    const tools = (a.tools || []).map((t) => t.name);
    if (a.web_search) tools.push("웹 검색(내장)");
    const button = a.role === "orchestrator" ? "" :
      `<button class="${a.up ? "ghost" : "primary"}" data-role="${a.role}"
        data-up="${a.up ? 1 : 0}">${a.up ? "종료" : "기동"}</button>`;
    return `<div class="server">
      <div class="body">
        <b>${esc(a.label)} ${a.up ? "" : '<span class="down">꺼져 있음</span>'}</b>
        <span>${a.up ? `PID ${a.pid} · 포트 ${a.port}` : `포트 ${a.port}`}</span>
        <span class="tools">도구 ${tools.length ? esc(tools.join(", ")) : "없음"}</span>
      </div>${button}</div>`;
  }).join("");

  // 그래프의 마디에도 같은 상태를 반영한다 — 떠 있으면 제 색, 꺼져 있으면 점선.
  list.forEach((a) => {
    const g = document.querySelector(`.node[data-role="${a.role}"]`);
    if (!g) return;
    g.classList.toggle("up", !!a.up);
    g.classList.toggle("off", !a.up);
    const sub = g.querySelector("[data-sub]");
    if (!sub) return;
    if (a.role === "orchestrator") {
      sub.textContent = `이 앱 · ${a.port}`;
    } else if (a.up) {
      const n = (a.tools || []).length + (a.web_search ? 1 : 0);
      sub.textContent = `PID ${a.pid} · 도구 ${n}`;
    } else {
      sub.textContent = "꺼져 있음";
    }
  });

  $("agentList").querySelectorAll("button[data-role]").forEach((b) => {
    b.addEventListener("click", async () => {
      const up = b.dataset.up === "1";
      b.disabled = true;
      b.textContent = up ? "종료 중…" : "기동 중…";
      const r = await post(up ? "/api/agents/stop" : "/api/agents/start",
                           { role: b.dataset.role });
      if (r.agents) drawAgents(r.agents);
      if (!r.ok && r.message) $("researchNote").textContent = r.message;
    });
  });
}

async function refreshAgents() {
  const r = await get("/api/agents");
  drawAgents(r.agents || []);
  // 연구가 도는 중에 새로고침해도 그래프가 이어지도록 진행 상황을 맞춰 둔다.
  try {
    const p = await get("/api/research/progress");
    applyProgress(p);
    if (p.running && !POLL) startPolling();
  } catch (e) { /* 진행 중인 것이 없으면 그냥 둔다 */ }
}

function renderLog(log) {
  return (log || []).map((e) => {
    if (e.kind === "delegate") {
      return `<div class="ev to"><b>연구책임자 → ${esc(e.label)}</b>
        <pre>${esc(e.instruction)}</pre></div>`;
    }
    if (e.kind === "return") {
      const calls = (e.calls || []).map((c) =>
        `<pre>${esc(c.tool)}  ${esc(c.args)}\n→ ${esc(c.result)}</pre>`).join("");
      const searches = (e.searches || []).length
        ? `<div class="meta">웹 검색 ${esc(e.searches.join(" / "))}</div>` : "";
      return `<div class="ev from"><b>${esc(e.label)} → 연구책임자</b>
        <div class="meta">${e.elapsed}초 · 도구 ${(e.calls || []).length}회</div>
        ${calls}${searches}<pre>${esc(e.result)}</pre></div>`;
    }
    return `<div class="ev final"><b>결론</b><pre>${esc(e.text)}</pre></div>`;
  }).join("");
}

async function runResearch(question, followUp) {
  const btn = followUp ? $("askFollow") : $("startResearch");
  btn.disabled = true;
  $("researchNote").textContent = "연구원들이 일하는 중입니다. 이십 초쯤 걸립니다…";
  if (!followUp) $("researchLog").innerHTML = "";
  applyProgress({ running: true, log: [] });
  startPolling();
  try {
    const r = await post("/api/research", { question, follow_up: !!followUp });
    stopPolling();
    applyProgress({ running: false, log: r.log || [] });
    const drawn = renderLog(r.log);
    // 후속 질의는 앞선 로그 아래에 이어 붙인다. 두 장을 나란히 보게 하기 위해서다.
    if (followUp) {
      $("researchLog").insertAdjacentHTML("beforeend",
        `<div class="round">이어서 물어봄 — ${esc(question)}</div>` + drawn);
    } else {
      $("researchLog").innerHTML = drawn;
    }
    const n = (r.log || []).filter((e) => e.kind === "delegate").length;
    $("researchNote").textContent = r.ok
      ? `${r.elapsed}초 · 위임 ${n}회 · ${r.tokens}토큰`
      : (r.message || "실패했습니다.");
    $("followCard").hidden = !r.has_session;
    if (!r.ok) setStatus(r.message || "실패했습니다.", "fail");
    if (followUp) $("followQuestion").value = "";
  } catch (e) {
    $("researchNote").textContent = "서버에 연결하지 못했습니다.";
    setStatus("서버에 연결하지 못했습니다.", "fail");
  }
  stopPolling();
  setRunning(false);
  refreshAgents();
}

$("stopResearch").addEventListener("click", async () => {
  $("stopResearch").disabled = true;
  const r = await post("/api/research/stop", {});
  $("researchNote").textContent = r.message || "";
});

$("fileInput").addEventListener("change", async (ev) => {
  const files = Array.from(ev.target.files || []);
  ev.target.value = "";              // 같은 파일을 다시 골라도 change 가 오도록 비운다
  if (files.length) await uploadFiles(files);
});

// 카드 위로 끌어다 놓아도 올라간다.
const dropCard = $("fileList").closest(".card");
["dragenter", "dragover"].forEach((t) => dropCard.addEventListener(t, (e) => {
  e.preventDefault(); dropCard.classList.add("drop");
}));
["dragleave", "drop"].forEach((t) => dropCard.addEventListener(t, (e) => {
  e.preventDefault(); dropCard.classList.remove("drop");
}));
dropCard.addEventListener("drop", async (e) => {
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
  if (files.length) await uploadFiles(files);
});

$("agentsRefresh").addEventListener("click", refreshAgents);
$("startResearch").addEventListener("click", () => {
  const q = $("question").value.trim();
  if (q) runResearch(q, false);
});
$("askFollow").addEventListener("click", () => {
  const q = $("followQuestion").value.trim();
  if (q) runResearch(q, true);
});
$("followQuestion").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("askFollow").click();
});
$("resetSession").addEventListener("click", async () => {
  await post("/api/research/reset", {});
  $("followCard").hidden = true;
  $("researchLog").innerHTML = "";
  $("researchNote").textContent = "";
});

document.querySelector('.tab[data-tab="agents"]')
  .addEventListener("click", refreshAgents);

$("mcpAdd").addEventListener("click", registerMcp);
$("mcpUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") registerMcp(); });

$("send").addEventListener("click", send);
$("message").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

$("savePrompt").addEventListener("click", async () => {
  await post("/api/prompt", { text: $("prompt").value });
  refresh();
});
$("resetPrompt").addEventListener("click", async () => {
  await post("/api/prompt/reset", {});
  refresh();
});
$("resetTools").addEventListener("click", async () => {
  await post("/api/tools/reset", {});
  refresh();
});
$("saveDataPath").addEventListener("click", async () => {
  await post("/api/data_path", { path: $("dataPath").value });
  refresh();
});
$("resetNotes").addEventListener("click", async () => {
  await post("/api/notes/reset", {});
  refresh();
});

refresh();
