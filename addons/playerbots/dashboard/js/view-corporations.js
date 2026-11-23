// Corporations: list of bot corporations and a detail page per corporation
// with its HQ, orders, priorities, roster and command log.

import { getJSON, postJSON, corpCommand, botCommand } from "./api.js";
import { $, esc, num, stateBar, stateTag, when, toast, confirmDialog, emptyRow, STATE_ORDER, STATE_LABELS } from "./ui.js";
import { createRoster, loadRoster, rosterHtml, bindRoster } from "./roster.js";

let ctxRef = null;
let listSort = "size";
let detail = null;
let roster = null;
let busy = false;
let priorityDraft = null;

function statesFor(counts = {}) {
  return STATE_ORDER.map((id) => ({ id, label: STATE_LABELS[id], count: Number(counts[id]) || 0 }));
}

// ------------------------------------------------------------------ list

async function renderList(fresh) {
  const summary = await ctxRef.loadSummary(false);
  if (fresh) ctxRef.setCrumbs([{ label: "Corporations" }]);
  const corps = [...(summary.corporations || [])].filter((c) => c.botCount > 0);
  const idle = (c) => { const s = c.stateCounts || {}; const total = Object.values(s).reduce((a, b) => a + b, 0) || 1; return ((s.idle || 0) + (s.paused || 0) + (s.cooling || 0)) / total; };
  corps.sort(listSort === "name" ? (a, b) => a.corporationName.localeCompare(b.corporationName)
    : listSort === "idle" ? (a, b) => idle(b) - idle(a) || b.botCount - a.botCount
      : (a, b) => b.botCount - a.botCount || a.corporationName.localeCompare(b.corporationName));
  $("view").innerHTML = `
  <div class="page-head"><div><h1>Corporations</h1><p>${num(corps.length)} bot corporations · ${num(corps.reduce((sum, c) => sum + c.botCount, 0))} pilots. Open one to see its pilots and give orders.</p></div>
    <label class="stack">Sort by<select class="field" id="corp-sort"><option value="size"${listSort === "size" ? " selected" : ""}>Most pilots</option><option value="idle"${listSort === "idle" ? " selected" : ""}>Most not working</option><option value="name"${listSort === "name" ? " selected" : ""}>Name</option></select></label></div>
  <div class="panel"><div class="table-wrap"><table>
    <thead><tr><th>Corporation</th><th class="num">Pilots</th><th style="min-width:200px">What they are doing</th><th>Top job</th><th>Priorities</th><th>Orders</th></tr></thead>
    <tbody>${corps.map((c) => `<tr class="clickable" data-corp="${c.corporationID}">
      <td><strong>${esc(c.corporationName)}</strong> <span class="muted">[${esc(c.ticker)}]</span><span class="sub">${esc(c.allianceName || "No alliance")} · ${esc((c.specialties || []).join(", "))}</span></td>
      <td class="num">${num(c.botCount)}<span class="sub">${num(c.memberCount)} / ${c.memberLimit ? num(c.memberLimit) : "∞"} members</span></td>
      <td>${stateBar(statesFor(c.stateCounts), { small: true })}<span class="sub">${STATE_ORDER.filter((s) => (c.stateCounts || {})[s]).map((s) => `${STATE_LABELS[s]} ${num(c.stateCounts[s])}`).join(" · ")}</span></td>
      <td>${c.topActivity ? `${esc(c.topActivity.label)} <span class="muted">${num(c.topActivity.count)}</span>` : `<span class="muted">—</span>`}</td>
      <td><div class="chips">${(c.priorities || []).map((p) => `<span class="chip">${esc(p.label)}</span>`).join("") || `<span class="muted">Default order</span>`}</div></td>
      <td>${c.held ? `<span class="state warn">Recalled to HQ</span>` : `<span class="muted">—</span>`}</td>
    </tr>`).join("") || emptyRow(6, "No bot corporations yet.")}</tbody></table></div></div>`;
  $("corp-sort").addEventListener("change", (event) => { listSort = event.target.value; void renderList(false); });
  $("view").querySelector("tbody").addEventListener("click", (event) => {
    const row = event.target.closest("[data-corp]");
    if (row) location.hash = `#corporations/${row.dataset.corp}`;
  });
}

// ---------------------------------------------------------------- detail

function ordersHtml() {
  const orders = detail.orders || [];
  const c = detail.corporation;
  return `<div class="panel-head"><div><h2>Orders</h2><p>Whole-corporation orders. Recall and work orders are saved and re-issued after a server restart.</p></div></div>
  <div class="panel-body">
    <div class="actions">
      <button class="btn primary" type="button" data-corp-act="recall">Recall all to HQ</button>
      <span class="action-form" style="margin:0"><button class="btn primary" type="button" data-corp-act="work">Send to work</button>
        <select class="field" data-corp-arg="mode"><option value="auto">Auto (by specialty)</option><option value="mine">Mine</option><option value="pi">PI setup</option><option value="director">Hand back to director</option></select>
        <label class="muted">trips <input class="field" style="width:56px" type="number" min="1" max="20" value="1" data-corp-arg="trips"></label></span>
      <button class="btn" type="button" data-corp-act="pause">Pause all</button>
      <button class="btn" type="button" data-corp-act="resume">Resume all</button>
      ${orders.length ? `<button class="btn ghost" type="button" data-corp-act="cancel">Cancel orders</button>` : ""}
    </div>
    <div style="margin-top:12px">${orders.map((o) => `<div class="strip" style="padding:8px 0">
      ${stateTag(o.status === "running" ? "travelling" : o.status === "holding" ? "paused" : "idle", o.kind === "recall" ? (o.status === "holding" ? "Holding at HQ" : o.status === "running" ? "Recalling" : `Recall ${o.status}`) : o.status === "running" ? `Work: ${o.mode}` : `Work ${o.status}`)}
      ${o.total ? `<span><b>${num(o.done)}</b> of <b>${num(o.total)}</b> done</span>` : ""}
      ${o.held ? `<span><b>${num(o.held)}</b> held</span>` : ""}
      ${o.pending ? `<span><b>${num(o.pending)}</b> pending</span>` : ""}
      ${o.failed ? `<span><b>${num(o.failed)}</b> failed${o.failures ? ` (${esc(o.failures)})` : ""}</span>` : ""}
      ${o.destination ? `<span>to ${esc(o.destination)}</span>` : ""}
      ${o.startedAt ? `<span>started ${when(o.startedAt)}</span>` : ""}
    </div>`).join("") || `<p class="muted" style="margin:0">No orders in force. The director decides what these pilots do${detail.autowork && detail.autowork.enabled === false ? " (autonomous work is off server-wide)" : ""}.</p>`}</div>
  </div>`;
}

function hqHtml() {
  const hq = detail.headquarters || {};
  const c = detail.corporation;
  const candidates = detail.headquartersCandidates || [];
  return `<div class="panel-head"><div><h2>Headquarters</h2><p>Where recalls go and work starts from</p></div></div>
  <div class="panel-body">
    ${hq.error ? `<div class="notice error">${esc(hq.error)}</div>` : `<p style="margin:0 0 4px"><strong>${esc(hq.name || `${hq.kind} ${hq.stationID}`)}</strong></p><p class="muted" style="margin:0">${esc(hq.kind === "structure" ? "Corporation structure" : "NPC station")} in ${esc(hq.systemName || `system ${hq.systemID}`)}${hq.saved ? " · set from the dashboard or chat" : " · the corporation's own HQ"}</p>`}
    <div class="action-form" style="margin-top:12px">
      ${candidates.length ? `<select class="field" data-hq="pick"><option value="">Choose a corporation structure…</option>${candidates.map((s) => `<option value="${s.structureID}"${s.dockingOnline ? "" : " disabled"}>${esc(s.name)} · ${esc(s.systemName || s.solarSystemID)}${s.dockingOnline ? "" : " (no docking)"}</option>`).join("")}</select>` : ""}
      <input class="field" type="number" min="1" placeholder="or station / structure ID" data-hq="id" style="width:200px">
      <button class="btn" type="button" data-hq="set">Set HQ</button>
      ${detail.savedHeadquartersID ? `<button class="btn ghost" type="button" data-hq="clear">Use the corporation's own HQ${c.homeStationName ? ` (${esc(c.homeStationName)})` : ""}</button>` : ""}
    </div>
    ${detail.deposit ? `<div class="action-form" style="margin-top:14px"><span class="muted">Mining and PI output:</span> <strong>${detail.deposit.enabled ? `deposited to ${esc(detail.deposit.label)}` : "sold"}</strong>${detail.deposit.explicit ? "" : ' <span class="muted">(automatic)</span>'}
      <select class="field" data-deposit="mode"><option value="">Change…</option><option value="on">Deposit at HQ</option><option value="off">Sell</option><option value="auto">Automatic</option><option value="deliveries">To Corporation Deliveries</option><option value="hangar">To a hangar division</option></select>
      <input class="field" type="number" min="1" max="7" value="${detail.deposit.division || 1}" data-deposit="division" style="width:60px" title="Hangar division 1–7"></div>` : ""}
  </div>`;
}

function prioritiesHtml(options) {
  const draft = priorityDraft;
  const labels = new Map(options.map((o) => [String(o.id), o.label]));
  const completed = new Map((detail.corporation.priorities || []).map((p) => [String(p.id), p.completedTasks]));
  const unused = options.filter((o) => !draft.includes(String(o.id)));
  const changed = JSON.stringify(draft) !== JSON.stringify((detail.corporation.priorityIDs || []).map(String));
  return `<div class="panel-head"><div><h2>Priorities</h2><p>The director serves this corporation's pilots in this order; tasks completed so far in brackets</p></div>${changed ? `<button class="btn primary small" type="button" data-prio="save">Save priorities</button>` : ""}</div>
  <div class="panel-body">
    ${draft.map((id, index) => `<div class="action-form" style="margin:0 0 6px"><span class="muted">${index + 1}.</span> <strong>${esc(labels.get(id) || id)}</strong> <span class="muted">(${num(completed.get(id) || 0)})</span>
      <button class="btn small ghost" type="button" data-prio="up" data-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
      <button class="btn small ghost" type="button" data-prio="down" data-index="${index}" ${index === draft.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
      <button class="btn small ghost" type="button" data-prio="remove" data-index="${index}" aria-label="Remove">✕</button></div>`).join("") || `<p class="muted" style="margin:0 0 8px">None set: the director uses its normal order.</p>`}
    ${unused.length ? `<select class="field" data-prio="add"><option value="">+ Add a priority…</option>${unused.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("")}</select>` : ""}
  </div>`;
}

function selectionActions() {
  return `<button class="btn small" type="button" data-sel="recall">Recall to HQ</button>
    <button class="btn small" type="button" data-sel="work">Send to work</button>
    <button class="btn small" type="button" data-sel="pause">Pause</button>
    <button class="btn small" type="button" data-sel="resume">Resume</button>
    <button class="btn small" type="button" data-sel="stop">Stop operation</button>
    <button class="btn small" type="button" data-sel="mine">Mine</button>
    <button class="btn small" type="button" data-sel="colony">PI colony</button>
    <button class="btn small" type="button" data-sel="combat">Combat patrol</button>
    <button class="btn small" type="button" data-sel="upgrade">Upgrade ship</button>`;
}

function logHtml() {
  const log = detail.log || [];
  return `<div class="panel-head"><div><h2>Command log</h2><p>Orders from the dashboard and chat, newest first</p></div></div>
  <div class="table-wrap"><table><thead><tr><th>When</th><th>From</th><th>Action</th><th>Result</th></tr></thead><tbody>
  ${log.map((row) => `<tr><td class="nowrap">${when(row.at)}</td><td>${esc(row.source)}</td><td>${esc(row.action)}</td><td>${row.success === false ? '<span class="state bad">Refused</span> ' : ""}${esc(row.message)}</td></tr>`).join("") || emptyRow(4, "No orders yet.")}
  </tbody></table></div>`;
}

async function drawDetail(reloadRoster = false) {
  if (busy) return;
  busy = true;
  try {
    const id = Number(ctxRef.param);
    const [summary, data] = await Promise.all([ctxRef.loadSummary(false), getJSON(`/api/corporation?corporationID=${id}`), reloadRoster ? loadRoster(roster) : null]);
    if (!$("corp-roster") || Number(ctxRef.param) !== id) return;
    detail = data;
    const c = data.corporation;
    if (!priorityDraft) priorityDraft = (c.priorityIDs || []).map(String);
    ctxRef.setCrumbs([{ label: "Corporations", href: "#corporations" }, { label: c.corporationName }]);
    $("corp-head").innerHTML = `<div class="page-head"><div><h1>${esc(c.corporationName)} <span class="muted">[${esc(c.ticker)}]</span></h1>
      <p>${esc(c.allianceName || "No alliance")} · ${num(c.botCount)} pilots · ${num(c.memberCount)} / ${c.memberLimit ? num(c.memberLimit) : "∞"} members · ${esc((c.specialties || []).join(", "))}</p></div>
      ${c.held ? `<span class="pill warn">Recalled to HQ</span>` : ""}</div>`;
    $("corp-status").innerHTML = `<div class="panel-head"><div><h2>What its pilots are doing</h2><p>Click a state to filter the pilot list</p></div>${c.topActivity ? `<span class="muted">Top job: <strong>${esc(c.topActivity.label)}</strong> (${num(c.topActivity.count)})</span>` : ""}</div><div class="panel-body">${stateBar(statesFor(c.stateCounts), { selected: [...roster.states] })}</div>`;
    $("corp-orders").innerHTML = ordersHtml();
    $("corp-hq").innerHTML = hqHtml();
    $("corp-prio").innerHTML = prioritiesHtml(summary.corporationPriorityOptions || []);
    $("corp-roster").innerHTML = rosterHtml(roster, { specialties: c.specialties || [], selectionActions: selectionActions() });
    $("corp-log").innerHTML = logHtml();
  } finally {
    busy = false;
  }
}

async function runCorp(action, args, confirmText) {
  if (confirmText && !(await confirmDialog("Confirm order", confirmText, "Send order"))) return;
  try {
    const result = await corpCommand(detail.corporation.corporationID, action, args);
    toast(result.message, "good");
  } catch (error) {
    toast(error.message, "bad");
  }
  ctxRef.store.summaryAt = 0;
  await drawDetail(true);
}

async function runSelection(action) {
  const ids = [...roster.selected];
  if (!ids.length) return;
  const c = detail.corporation;
  if (action === "recall" || action === "work") {
    const args = { characterIDs: ids };
    if (action === "work") args.mode = ($("corp-orders").querySelector('[data-corp-arg="mode"]') || {}).value || "auto";
    return runCorp(action, args, `${action === "recall" ? "Recall" : "Send to work"} ${num(ids.length)} selected pilot(s) of ${c.corporationName}?`);
  }
  const args = {};
  if (action === "combat") args.mode = "";
  if (action === "upgrade") args.role = "mining";
  if (ids.length > 5 && !(await confirmDialog("Confirm order", `${action[0].toUpperCase()}${action.slice(1)} for ${num(ids.length)} pilots?`, "Send order"))) return;
  const result = await botCommand(ids, action, args);
  toast(result.message, result.ok ? "good" : "bad");
  ctxRef.store.summaryAt = 0;
  await drawDetail(true);
}

async function renderDetail(fresh) {
  if (fresh || !$("corp-roster")) {
    const id = Number(ctxRef.param);
    roster = createRoster({ corporationID: id, selectable: true });
    priorityDraft = null;
    $("view").innerHTML = `<div id="corp-head"><div class="empty">Loading corporation…</div></div>
      <div class="grid-2"><div id="corp-orders" class="panel"></div><div id="corp-hq" class="panel"></div></div>
      <div id="corp-status" class="panel"></div>
      <div class="grid-2"><div id="corp-prio" class="panel"></div><div id="corp-log" class="panel" style="max-height:360px;overflow-y:auto"></div></div>
      <div id="corp-roster" class="panel"></div>`;
    bindRoster($("corp-roster"), roster, (reload) => drawDetail(reload));
    $("corp-roster").addEventListener("click", (event) => {
      const button = event.target.closest("[data-sel]");
      if (button) void runSelection(button.dataset.sel);
    });
    $("corp-status").addEventListener("click", (event) => {
      const button = event.target.closest("[data-state]");
      if (!button) return;
      const state = button.dataset.state;
      if (roster.states.size === 1 && roster.states.has(state)) roster.states.clear();
      else { roster.states.clear(); roster.states.add(state); }
      roster.page = 0;
      void drawDetail(true);
    });
    $("corp-orders").addEventListener("click", (event) => {
      const button = event.target.closest("[data-corp-act]");
      if (!button) return;
      const action = button.dataset.corpAct;
      const c = detail.corporation;
      const arg = (name) => $("corp-orders").querySelector(`[data-corp-arg="${name}"]`);
      const hq = detail.headquarters && !detail.headquarters.error ? detail.headquarters.name || "the HQ" : "the HQ";
      if (action === "recall") return void runCorp("recall", {}, `Recall all ${num(c.botCount)} ${c.corporationName} pilots to ${hq}? They stop their work, fly there, dock and stay paused until you send them to work.`);
      if (action === "work") {
        const mode = arg("mode").value;
        return void runCorp("work", { mode, trips: Number(arg("trips").value) || 1 }, `Send all ${num(c.botCount)} ${c.corporationName} pilots to work (${arg("mode").selectedOptions[0].textContent})? This releases any recall hold.`);
      }
      if (action === "pause") return void runCorp("pause", {}, `Pause all ${num(c.botCount)} ${c.corporationName} pilots? Running operations keep going; the director stops giving them new work.`);
      if (action === "resume") return void runCorp("resume", {}, null);
      if (action === "cancel") return void runCorp("cancel", {}, "Cancel this corporation's recall or work order? Pilots keep their current pause state.");
    });
    $("corp-hq").addEventListener("click", (event) => {
      const button = event.target.closest("[data-hq]");
      if (!button || button.tagName !== "BUTTON") return;
      if (button.dataset.hq === "clear") return void runCorp("hq-clear", {}, null);
      const picked = $("corp-hq").querySelector('[data-hq="pick"]');
      const typed = $("corp-hq").querySelector('[data-hq="id"]');
      const target = Number(typed.value) || Number(picked && picked.value) || 0;
      if (!target) return toast("Choose a structure or type a station or structure ID.", "bad");
      void runCorp("hq-set", { target }, null);
    });
    $("corp-hq").addEventListener("change", (event) => {
      if (event.target.dataset.deposit !== "mode" || !event.target.value) return;
      const division = Number($("corp-hq").querySelector('[data-deposit="division"]').value) || 1;
      void runCorp("deposit", { deposit: event.target.value, division }, null);
    });
    $("corp-prio").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-prio]");
      if (!button || button.tagName !== "BUTTON") return;
      const index = Number(button.dataset.index);
      const kind = button.dataset.prio;
      if (kind === "up" && index > 0) [priorityDraft[index - 1], priorityDraft[index]] = [priorityDraft[index], priorityDraft[index - 1]];
      if (kind === "down" && index < priorityDraft.length - 1) [priorityDraft[index + 1], priorityDraft[index]] = [priorityDraft[index], priorityDraft[index + 1]];
      if (kind === "remove") priorityDraft.splice(index, 1);
      if (kind === "save") {
        try {
          const data = await postJSON("/api/corporation-priorities", { corporationID: detail.corporation.corporationID, priorityIDs: priorityDraft });
          if (data.success !== true) throw new Error(data.message || "Not saved.");
          toast("Priorities saved.", "good");
          priorityDraft = null;
          ctxRef.store.summaryAt = 0;
          return void drawDetail(false);
        } catch (error) { return toast(error.message, "bad"); }
      }
      const summary = await ctxRef.loadSummary(false);
      $("corp-prio").innerHTML = prioritiesHtml(summary.corporationPriorityOptions || []);
    });
    $("corp-prio").addEventListener("change", async (event) => {
      if (event.target.dataset.prio !== "add" || !event.target.value) return;
      priorityDraft.push(event.target.value);
      const summary = await ctxRef.loadSummary(false);
      $("corp-prio").innerHTML = prioritiesHtml(summary.corporationPriorityOptions || []);
    });
  }
  await drawDetail(true);
}

export async function render(ctx) {
  ctxRef = ctx;
  if (ctx.param) return renderDetail(ctx.fresh);
  return renderList(ctx.fresh);
}
