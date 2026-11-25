// Shared formatting and rendering helpers. Every value placed in HTML goes
// through esc() unless it is markup built here.

export const $ = (id) => document.getElementById(id);

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

export const num = (value) => Number(value || 0).toLocaleString("en-US");

export function isk(value) {
  const amount = Number(value) || 0;
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${(amount / 1e9).toFixed(2)}B ISK`;
  if (abs >= 1e6) return `${(amount / 1e6).toFixed(1)}M ISK`;
  if (abs >= 1e3) return `${(amount / 1e3).toFixed(0)}k ISK`;
  return `${amount.toFixed(0)} ISK`;
}

export function ms(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(n >= 10 ? 0 : 1)} ms`;
}

export function duration(value) {
  const total = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

// "4 min ago", "in 3 min"; absolute time goes in the title attribute.
export function rel(value) {
  const t = typeof value === "number" ? value : Date.parse(value || "");
  if (!Number.isFinite(t) || t <= 0) return "";
  const diff = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(diff);
  const unit = abs < 60 ? [abs, "s"] : abs < 3600 ? [Math.round(abs / 60), "min"] : abs < 86400 ? [Math.round(abs / 3600), "h"] : [Math.round(abs / 86400), "d"];
  if (abs < 5) return "just now";
  return diff >= 0 ? `${unit[0]} ${unit[1]} ago` : `in ${unit[0]} ${unit[1]}`;
}

export function when(value) {
  const t = Date.parse(value || "");
  if (!Number.isFinite(t)) return "";
  return `<span title="${esc(new Date(t).toLocaleString())}">${esc(rel(t))}</span>`;
}

export function portrait(characterID, size = 64) {
  const id = Math.trunc(Number(characterID) || 0);
  if (id <= 0) return `<span class="ph">?</span>`;
  // v=2: portraits were repaired in 0.2.152.9; skip blank images browsers cached before.
  return `<img src="/api/character-portrait?characterID=${id}&amp;size=${size}&amp;v=2" alt="" loading="lazy">`;
}

// Corporation logos uploaded on the Corporations page. The shell loads the
// list (corporationID -> file time) with each summary refresh.
export const corporationLogos = { logos: {}, inGame: false, sizes: [] };

export function setCorporationLogos(data) {
  corporationLogos.logos = data && data.logos && typeof data.logos === "object" ? data.logos : {};
  corporationLogos.inGame = Boolean(data && data.inGame);
  corporationLogos.sizes = Array.isArray(data && data.sizes) ? data.sizes : [];
}

export function hasCorporationLogo(corporationID) {
  return Boolean(corporationLogos.logos[Math.trunc(Number(corporationID) || 0)]);
}

// A small logo for a corporation that has one; "" for the rest.
export function corpLogo(corporationID, size = 32, cls = "corp-logo") {
  const id = Math.trunc(Number(corporationID) || 0);
  const version = corporationLogos.logos[id];
  if (id <= 0 || !version) return "";
  const source = size <= 32 ? 64 : size <= 64 ? 128 : 256;
  return `<img class="${esc(cls)}" src="/api/corporation-logo?corporationID=${id}&amp;size=${source}&amp;v=${esc(version)}" alt="" width="${size}" height="${size}" loading="lazy">`;
}

export function pilotCell(row) {
  const corp = row.corporationTicker ? `[${esc(row.corporationTicker)}] ` : "";
  return `<div class="pilot">${portrait(row.characterID)}<span><strong>${esc(row.characterName)}</strong><span class="sub">${corpLogo(row.corporationID, 14, "corp-logo inline")}${corp}${esc(row.corporationName || "")}</span></span></div>`;
}

export const STATE_ORDER = ["working", "travelling", "holding", "queued", "cooling", "paused", "standby", "idle", "offline"];
export const STATE_LABELS = { working: "Working", travelling: "Travelling", holding: "Holding", queued: "Queued", cooling: "Cooling down", paused: "Paused", standby: "Standing by", idle: "Idle", offline: "Offline" };

export function stateTag(state, label) {
  return `<span class="state ${esc(state)}">${esc(label || STATE_LABELS[state] || state)}</span>`;
}

// Clickable stacked bar of state counts. counts: [{id,label,count}]
export function stateBar(states, { selected = [], small = false } = {}) {
  const total = states.reduce((sum, s) => sum + (Number(s.count) || 0), 0) || 1;
  const visible = states.filter((s) => Number(s.count) > 0);
  if (small) {
    return `<div class="statebar small" title="${esc(visible.map((s) => `${s.label || STATE_LABELS[s.id]} ${num(s.count)}`).join(" · "))}">${visible.map((s) => `<span class="bg-${esc(s.id)}" style="width:${(s.count * 100 / total).toFixed(2)}%"></span>`).join("")}</div>`;
  }
  return `<div class="statebar">${visible.map((s) => `<button type="button" data-state="${esc(s.id)}" class="bg-${esc(s.id)}${selected.includes(s.id) ? " on" : ""}" style="flex:${s.count} 0 0" title="${esc(s.label)}: ${num(s.count)}"></button>`).join("")}</div>
    <div class="legend">${states.map((s) => `<button type="button" data-state="${esc(s.id)}" class="${selected.includes(s.id) ? "on" : ""}"><span class="swatch bg-${esc(s.id)}"></span>${esc(s.label)} <b>${num(s.count)}</b></button>`).join("")}</div>`;
}

export function stat(label, value, detail = "", accent = "") {
  return `<div class="stat${accent ? ` accent-${accent}` : ""}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${detail ? `<div class="detail">${esc(detail)}</div>` : ""}</div>`;
}

export function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`;
}

export function pager(page, pageSize, total, prefix) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="pager"><span>${num(total)} total · page ${num(page + 1)} of ${num(pages)}</span>
    <button class="btn small" type="button" data-page="${prefix}:prev" ${page <= 0 ? "disabled" : ""}>← Previous</button>
    <button class="btn small" type="button" data-page="${prefix}:next" ${page + 1 >= pages ? "disabled" : ""}>Next →</button></div>`;
}

export function toast(message, kind = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  $("toasts").appendChild(node);
  setTimeout(() => node.remove(), kind === "bad" ? 9000 : 5000);
}

// Promise<boolean> confirm dialog.
export function confirmDialog(title, body, confirmLabel = "Confirm", danger = false) {
  const dialog = $("dialog");
  dialog.className = "narrow";
  dialog.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2></div><p>${esc(body)}</p>
    <div class="dialog-actions"><button type="button" class="btn ghost" data-answer="no">Cancel</button><button type="button" class="btn ${danger ? "danger" : "primary"}" data-answer="yes">${esc(confirmLabel)}</button></div>`;
  return new Promise((resolve) => {
    const done = (answer) => { dialog.close(); resolve(answer); };
    dialog.onclick = (event) => {
      const button = event.target.closest("[data-answer]");
      if (button) done(button.dataset.answer === "yes");
    };
    dialog.oncancel = () => resolve(false);
    dialog.showModal();
  });
}

export function showDialog(title, html) {
  const dialog = $("dialog");
  dialog.className = "";
  dialog.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2><button type="button" aria-label="Close" data-close>×</button></div>${html}`;
  dialog.onclick = (event) => { if (event.target.closest("[data-close]")) dialog.close(); };
  dialog.oncancel = null;
  dialog.showModal();
}

export function security(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  const color = n >= 0.45 ? "#8ce7c2" : n > 0 ? "#f6d08f" : "#ffaab1";
  return `<span class="mono" style="color:${color}">${n.toFixed(1)}</span>`;
}

// Runs fn one call at a time. A call made while one is running is not
// dropped: it runs once more afterwards, with `true` if any caller asked
// for a full reload.
export function coalesce(fn) {
  let running = null;
  let again = false;
  let againArg = false;
  const run = async (arg = false) => {
    if (running) {
      again = true;
      againArg = againArg || Boolean(arg);
      return running;
    }
    running = (async () => {
      try { await fn(arg); } finally { running = null; }
      if (again) {
        const next = againArg;
        again = false;
        againArg = false;
        await run(next);
      }
    })();
    return running;
  };
  return run;
}

// Replaces an element's HTML without losing the operator's place in a text
// field inside it (search boxes re-render while being typed in).
export function replaceKeepingFocus(element, html) {
  if (!element) return;
  const active = document.activeElement;
  let key = "";
  if (active && element.contains(active) && active.matches("input, select, textarea")) {
    const attr = [...active.attributes].find((entry) => entry.name.startsWith("data-"));
    key = attr ? `[${attr.name}="${CSS.escape(attr.value)}"]` : active.id ? `#${CSS.escape(active.id)}` : "";
  }
  const selection = key && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
  element.innerHTML = html;
  if (!key) return;
  const next = element.querySelector(key);
  if (!next) return;
  next.focus();
  if (selection && typeof next.setSelectionRange === "function") {
    try { next.setSelectionRange(selection[0], selection[1]); } catch { /* not a text field */ }
  }
}
