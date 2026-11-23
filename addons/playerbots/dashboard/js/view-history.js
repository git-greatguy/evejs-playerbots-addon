// History: the operation archive, newest first, with filters and details.

import { getJSON } from "./api.js";
import { $, esc, num, isk, when, emptyRow, pager, showDialog, coalesce, replaceKeepingFocus } from "./ui.js";
import { openPilot } from "./drawer.js";

const state = { page: 0, pageSize: 50, status: "", kind: "", search: "", data: null };

function statusClass(status) {
  const s = String(status).toLowerCase();
  if (["active", "running"].includes(s)) return "working";
  if (["holding", "review", "blocked"].includes(s)) return "holding";
  if (["failed", "error"].includes(s)) return "bad";
  if (["completed", "done", "finished"].includes(s)) return "good";
  return "idle";
}

const draw = coalesce(async () => {
  {
    const query = new URLSearchParams({ offset: String(state.page * state.pageSize), limit: String(state.pageSize) });
    if (state.status) query.set("status", state.status);
    if (state.kind) query.set("kind", state.kind);
    if (state.search) query.set("search", state.search);
    const data = await getJSON(`/api/operations?${query}`);
    if (!$("hist-table")) return;
    state.data = data;
    const statuses = Object.entries(data.counts || {}).sort();
    const kinds = Object.entries(data.kindCounts || {}).sort();
    const kindLabels = data.kindLabels || {};
    replaceKeepingFocus($("hist-filters"), `
      <input class="field" type="search" data-h="search" placeholder="Pilot, operation ID or action" value="${esc(state.search)}" style="min-width:260px">
      <select class="field" data-h="status"><option value="">All statuses</option>${statuses.map(([value, count]) => `<option value="${esc(value)}"${value === state.status ? " selected" : ""}>${esc(value)} (${num(count)})</option>`).join("")}</select>
      <select class="field" data-h="kind"><option value="">All operation types</option>${kinds.map(([value, count]) => `<option value="${esc(value)}"${value === state.kind ? " selected" : ""}>${esc(kindLabels[value] || value)} (${num(count)})</option>`).join("")}</select>`);
    const rows = data.rows || [];
    $("hist-table").innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Updated</th><th>Pilot</th><th>Operation</th><th>Status</th><th>Where</th><th>Last step</th><th class="num">ISK</th><th></th></tr></thead>
      <tbody>${rows.map((op) => {
        const spent = Number(op.spent) || 0;
        const proceeds = Number(op.proceeds) || 0;
        return `<tr>
        <td class="nowrap">${when(op.updatedAt) || "—"}</td>
        <td><a href="#" data-pilot="${op.characterID}"><strong>${esc(op.characterName || `Pilot ${op.characterID}`)}</strong></a><span class="sub">${op.corporationTicker ? `[${esc(op.corporationTicker)}] ` : ""}${esc(op.corporationName || "")}</span></td>
        <td><strong>${esc(op.kindLabel || op.kind)}</strong>${op.stageLabel ? `<span class="sub">${esc(op.stageLabel)}</span>` : ""}</td>
        <td><span class="state ${statusClass(op.status)}">${esc(op.status)}</span></td>
        <td>${esc(op.systemName || (op.systemID ? `System ${op.systemID}` : "—"))}${op.shipName ? `<span class="sub">${esc(op.shipName)}</span>` : ""}</td>
        <td><span class="sub" style="color:var(--soft);max-width:340px" title="${esc(op.lastAction || op.lastError || "")}">${esc(op.lastAction || op.lastError || "—")}</span></td>
        <td class="num nowrap">${spent ? `<span style="color:#ffaab1">−${esc(isk(spent))}</span>` : ""}${spent && proceeds ? "<br>" : ""}${proceeds ? `<span style="color:#8ce7c2">+${esc(isk(proceeds))}</span>` : ""}${!spent && !proceeds ? "—" : ""}</td>
        <td><button class="btn small" type="button" data-op="${esc(op.operationID)}">Details</button></td></tr>`;
      }).join("") || emptyRow(8, "No operations match these filters.")}</tbody></table></div>
      ${pager(state.page, state.pageSize, Number(data.total) || 0, "hist")}`;
  }
});

async function showOperation(operationID) {
  try {
    const data = await getJSON(`/api/operation?operationID=${encodeURIComponent(operationID)}`);
    const op = data.operation || {};
    const fields = Object.keys(op).filter((key) => key !== "history" && !key.startsWith("_") && op[key] !== undefined);
    const value = (v) => v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
    const history = Array.isArray(op.history) ? op.history : [];
    showDialog(`${op.kind || "Operation"} · ${op.operationID || operationID}`, `
      <div class="detail-grid">${fields.map((key) => `<div class="detail-row"><span>${esc(key.replace(/([A-Z])/g, " $1"))}</span><strong>${esc(value(op[key]))}</strong></div>`).join("")}</div>
      <h3 style="margin:16px 0 8px">Steps (${num(history.length)})</h3>
      <ol class="timeline">${history.slice().reverse().map((h) => `<li><time>${esc(h.at ? new Date(h.at).toLocaleString() : "")}</time> <strong>${esc(h.stage || "")}</strong><div>${esc(h.message || "")}</div></li>`).join("") || "<li class='muted'>No steps recorded.</li>"}</ol>`);
  } catch (error) {
    showDialog("Operation", `<div class="notice error">${esc(error.message)}</div>`);
  }
}

export async function render(ctx) {
  if (ctx.fresh || !$("hist-table")) {
    $("view").innerHTML = `<div class="page-head"><div><h1>History</h1><p>Every operation, live and archived, newest first.</p></div></div>
      <div class="panel"><div class="panel-body" style="padding-top:14px"><div class="toolbar" id="hist-filters"></div></div><div id="hist-table"><div class="empty">Loading…</div></div></div>`;
    let timer = null;
    $("hist-filters").addEventListener("input", (event) => {
      if (event.target.dataset.h !== "search") return;
      clearTimeout(timer);
      timer = setTimeout(() => { state.search = event.target.value.trim(); state.page = 0; void draw(); }, 400);
    });
    $("hist-filters").addEventListener("change", (event) => {
      const key = event.target.dataset.h;
      if (key === "status" || key === "kind") { state[key] = event.target.value; state.page = 0; void draw(); }
    });
    $("hist-table").addEventListener("click", (event) => {
      const op = event.target.closest("[data-op]");
      if (op) return void showOperation(op.dataset.op);
      const pilot = event.target.closest("[data-pilot]");
      if (pilot) { event.preventDefault(); return openPilot(Number(pilot.dataset.pilot)); }
      const page = event.target.closest("[data-page]");
      if (page) { state.page = Math.max(0, state.page + (page.dataset.page.endsWith("next") ? 1 : -1)); void draw(); }
    });
  }
  // The archive is large; refresh it on its own every minute at most.
  if (!ctx.fresh && state.loadedAt && Date.now() - state.loadedAt < 60_000) return;
  state.loadedAt = Date.now();
  await draw();
}
