// Pilot drawer: everything about one pilot plus the orders the operator can
// give it.

import { getJSON, botCommand, corpCommand } from "./api.js";
import { $, esc, num, isk, portrait, stateTag, when, toast, corpLogo } from "./ui.js";

let current = { characterID: 0, onChange: null, pilot: null };

export function closeDrawer() {
  $("drawer-root").innerHTML = "";
  current = { characterID: 0, onChange: null, pilot: null };
  document.removeEventListener("keydown", onKey);
}

function onKey(event) {
  if (event.key === "Escape" && !$("dialog").open) closeDrawer();
}

export async function openPilot(characterID, onChange = null) {
  current = { characterID, onChange, pilot: null };
  document.addEventListener("keydown", onKey);
  $("drawer-root").innerHTML = `<div class="drawer-backdrop" data-close></div><aside class="drawer" role="dialog" aria-label="Pilot details"><div class="drawer-head"><strong>Loading pilot…</strong><button class="close" type="button" data-close aria-label="Close">×</button></div></aside>`;
  bind();
  await reload();
}

async function reload() {
  const id = current.characterID;
  if (!id) return;
  let pilot;
  try {
    pilot = await getJSON(`/api/bot?characterID=${id}`);
  } catch (error) {
    if (current.characterID !== id) return;
    $("drawer-root").querySelector(".drawer").innerHTML = `<div class="drawer-head"><strong>Could not load this pilot</strong><button class="close" type="button" data-close>×</button></div><section><div class="notice error">${esc(error.message)}</div></section>`;
    return;
  }
  if (current.characterID !== id) return;
  current.pilot = pilot;
  $("drawer-root").querySelector(".drawer").innerHTML = drawerHtml(pilot);
}

function drawerHtml(p) {
  const op = p.currentOperation;
  const ticker = p.corporationTicker ? `[${esc(p.corporationTicker)}] ` : "";
  const working = ["working", "travelling", "holding"].includes(p.state);
  return `
  <div class="drawer-head">${portrait(p.characterID, 128)}
    <div><h2>${esc(p.characterName)}</h2><div class="muted">${corpLogo(p.corporationID, 16, "corp-logo inline")}${ticker}${esc(p.corporationName || "No corporation")} · ${esc(p.specialty)}</div><div style="margin-top:4px">${stateTag(p.state, p.stateLabel)}</div></div>
    <button class="close" type="button" data-close aria-label="Close">×</button></div>
  <section><h3>Now</h3>
    <p style="margin:0 0 4px"><strong>${esc(p.doing)}</strong></p>
    ${p.reason ? `<p class="muted" style="margin:0">${esc(p.reason)}</p>` : ""}
    ${p.retryAt ? `<p class="muted" style="margin:4px 0 0">Director retries ${when(p.retryAt)}.</p>` : ""}
  </section>
  <section><h3>Pilot</h3><dl class="kv">
    <dt>Where</dt><dd>${esc(p.where)}${p.security !== null && p.security !== undefined ? ` <span class="muted">(${Number(p.security).toFixed(1)})</span>` : ""}</dd>
    <dt>Ship</dt><dd>${esc(p.shipName || (p.shipTypeID ? `Type ${p.shipTypeID}` : "None"))}</dd>
    <dt>Online</dt><dd>${p.connected ? (p.inSpace ? "Yes, in space" : "Yes, docked") : "No"}</dd>
    <dt>Paused</dt><dd>${p.paused ? "Yes" : "No"}</dd>
    <dt>Character ID</dt><dd class="mono">${esc(p.characterID)}</dd>
    ${p.createdAt ? `<dt>Created</dt><dd>${when(p.createdAt)}</dd>` : ""}
  </dl></section>
  ${op ? `<section><h3>Current operation · ${esc(op.kindLabel)}</h3>
    <dl class="kv"><dt>Status</dt><dd>${esc(op.status)}${op.stage ? ` · ${esc(op.stage)}` : ""}</dd><dt>Started</dt><dd>${when(op.startedAt) || "—"}</dd><dt>Updated</dt><dd>${when(op.updatedAt) || "—"}</dd><dt>ID</dt><dd class="mono">${esc(op.operationID)}</dd></dl>
    ${op.history.length ? `<ol class="timeline" style="margin-top:10px">${op.history.slice().reverse().map((h) => `<li><time>${when(h.at)}</time> <strong>${esc(h.stageLabel || h.stage)}</strong><div>${esc(h.message)}</div></li>`).join("")}</ol>` : ""}
  </section>` : ""}
  ${p.tasks && p.tasks.length ? `<section><h3>Queued tasks</h3>${p.tasks.map((t) => `<div>${esc(t.kind)} · ${esc(t.status)}${t.stage ? ` · ${esc(t.stage)}` : ""} <span class="mono muted">${esc(t.taskID)}</span></div>`).join("")}</section>` : ""}
  ${p.director && (p.director.lastMessage || p.director.lastAssignment) ? `<section><h3>Director's last note</h3><p style="margin:0">${esc(p.director.lastAssignment ? `${p.director.lastAssignment}: ` : "")}${esc(p.director.lastMessage || "—")}</p>${p.director.cooldownUntil ? `<p class="muted" style="margin:4px 0 0">Cooling down until ${esc(new Date(p.director.cooldownUntil).toLocaleTimeString())}.</p>` : ""}</section>` : ""}
  <section><h3>Recent operations</h3>${(p.recentOperations || []).map((o) => `<div style="margin-bottom:6px"><strong>${esc(o.kindLabel || o.kind)}</strong> · ${esc(o.status)} · ${when(o.updatedAt)}${Number(o.spent) || Number(o.proceeds) ? ` · <span class="muted">${Number(o.spent) ? `−${esc(isk(o.spent))}` : ""}${Number(o.spent) && Number(o.proceeds) ? " / " : ""}${Number(o.proceeds) ? `+${esc(isk(o.proceeds))}` : ""}</span>` : ""}<div class="muted" style="font-size:12px">${esc(o.lastAction || "")}</div></div>`).join("") || `<p class="muted" style="margin:0">None recorded.</p>`}</section>
  <section><h3>Orders</h3>
    <div class="actions">
      ${p.paused ? `<button class="btn" type="button" data-act="resume">Resume</button>` : `<button class="btn" type="button" data-act="pause">Pause</button>`}
      ${working ? `<button class="btn" type="button" data-act="stop">Stop operation</button>` : ""}
      ${p.operation && ["stopped", "holding", "failed"].includes(p.operation.status) ? `<button class="btn" type="button" data-act="resume-op">Resume operation</button>` : ""}
      ${p.corporationID ? `<button class="btn" type="button" data-act="recall">Recall to corp HQ</button>` : ""}
    </div>
    <div class="action-form"><button class="btn" type="button" data-act="mine">Mine</button><label class="muted">trips <input class="field" style="width:60px" type="number" min="1" max="20" value="1" data-arg="trips"></label><label class="muted">station ID <input class="field" style="width:120px" type="number" min="1" placeholder="nearest" data-arg="station"></label></div>
    <div class="action-form"><button class="btn" type="button" data-act="colony">Set up PI colony</button></div>
    <div class="action-form"><button class="btn" type="button" data-act="combat">Combat patrol</button><select class="field" data-arg="mode"><option value="">By specialty</option><option value="security">Security</option><option value="war">War</option><option value="piracy">Piracy</option><option value="nullsec-conflict">Null-sec conflict</option></select></div>
    <div class="action-form"><button class="btn" type="button" data-act="upgrade">Upgrade ship</button><select class="field" data-arg="role"><option value="">By specialty</option><option value="mining">Mining</option><option value="logistics">Logistics</option><option value="security">Security</option><option value="piracy">Piracy</option><option value="sovereignty">Sovereignty</option></select><label class="muted check"><input type="checkbox" data-arg="force"> force</label></div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">${p.paused ? "This pilot is paused. Starting a job resumes it, and the director takes over again once the job ends." : "When a job you start here ends, the director takes over again."}</p>
  </section>`;
}

function bind() {
  const root = $("drawer-root");
  root.onclick = async (event) => {
    if (event.target.closest("[data-close]")) return closeDrawer();
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const drawer = root.querySelector(".drawer");
    const arg = (name) => drawer.querySelector(`[data-arg="${name}"]`);
    const action = button.dataset.act;
    const id = current.characterID;
    button.disabled = true;
    try {
      let result;
      if (action === "recall") {
        const pilot = current.pilot || await getJSON(`/api/bot?characterID=${id}`);
        result = await corpCommand(pilot.corporationID, "recall", { characterIDs: [id] }).then((data) => ({ ok: 1, message: data.message })).catch((error) => ({ ok: 0, message: error.message }));
      } else {
        const args = {};
        if (action === "mine") { args.trips = Number(arg("trips").value) || 1; if (Number(arg("station").value)) args.station = Number(arg("station").value); }
        if (action === "combat" && arg("mode").value) args.mode = arg("mode").value;
        if (action === "upgrade") { if (arg("role").value) args.role = arg("role").value; args.force = arg("force").checked; }
        result = await botCommand([id], action, args);
      }
      toast(result.message, result.ok ? "good" : "bad");
      await reload();
      if (current.onChange) current.onChange();
    } catch (error) {
      toast(error.message, "bad");
    } finally {
      button.disabled = false;
    }
  };
}

export function pilotCountLabel(count) {
  return `${num(count)} pilot${Number(count) === 1 ? "" : "s"}`;
}
