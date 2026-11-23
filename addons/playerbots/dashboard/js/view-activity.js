// Activity: what every pilot is doing right now and why the rest are not
// working.

import { getJSON } from "./api.js";
import { $, esc, num, rel, duration, stateBar } from "./ui.js";
import { createRoster, loadRoster, rosterHtml, bindRoster } from "./roster.js";

const roster = createRoster();
let activity = null;
let mounted = false;
let busy = false;
let ctxRef = null;

function headerHtml(summary) {
  const autowork = activity.autowork || {};
  const seeding = autowork.seeding || {};
  const pill = autowork.enabled === false
    ? `<span class="pill warn">Autonomous work off${seeding.active ? ` · seeding ${num(seeding.rosterCount)} / ${num(seeding.target)}` : ""}</span>`
    : `<span class="pill good">Autonomous work on</span>`;
  return `<div class="page-head"><div><h1>Activity</h1><p>${num(activity.total)} pilots · ${num(summary.roster?.online)} online · ${num(summary.roster?.inSpace)} in space · ${num(summary.roster?.connectedHumans)} human pilots online</p></div>${pill}</div>`;
}

function noticesHtml(summary) {
  const notes = [];
  const autowork = activity.autowork || {};
  const seeding = autowork.seeding || {};
  if (autowork.enabled === false) {
    notes.push(`<div class="notice"><strong>Autonomous work is off.</strong> ${seeding.active
      ? `The roster is seeding (${num(seeding.rosterCount)} of ${num(seeding.target)}), so pilots stand by. Turn work on in <a href="#settings"><u>Settings</u></a> when seeding finishes.`
      : `Pilots only run orders you give them. Turn it on in <a href="#settings"><u>Settings</u></a>.`} Operations already running still finish.</div>`);
  }
  const limit = Number(summary.systemCapacity?.autonomousBotsPerSystem) || 0;
  const crowded = (summary.systems || []).filter((s) => s.overAutonomousLimit);
  if (limit && crowded.length) {
    const extra = crowded.reduce((sum, s) => sum + Math.max(0, s.botCount - limit), 0);
    notes.push(`<div class="notice info"><strong>${num(crowded.length)} systems hold more pilots than the per-system limit of ${num(limit)}</strong> (${num(extra)} over). New pilots are created in their race's starter system without checking the limit; the limit only stops pilots entering space there and makes the director move residents out when it assigns work. Expect the director to relocate about ${num(extra)} pilots, a batch at a time, once work starts. <a href="#world"><u>See systems</u></a>.</div>`);
  }
  if (activity.directorError) notes.push(`<div class="notice error"><strong>Director error:</strong> ${esc(activity.directorError)}</div>`);
  return notes.join("");
}

function breakdownHtml() {
  const activities = activity.activities || [];
  const reasons = activity.reasons || [];
  const cooldowns = activity.cooldownReasons || [];
  return `<div class="grid-2">
    <div class="panel"><div class="panel-head"><div><h2>Working on</h2><p>Pilots working, travelling or holding, by job</p></div></div>
      <div class="panel-body breakdown">${activities.map((a) => `<button type="button" data-activity="${esc(a.id)}" class="${roster.activity === a.id ? "on" : ""}"><span>${esc(a.label)}</span><b>${num(a.count)}</b></button>`).join("") || `<div class="empty">No pilot is working right now.</div>`}</div></div>
    <div class="panel"><div class="panel-head"><div><h2>Why not working</h2><p>Everyone else, by reason</p></div></div>
      <div class="panel-body breakdown">${reasons.map((r) => `<button type="button" data-reason="${esc(r.id)}" class="${roster.reason === r.id ? "on" : ""}"><span>${esc(r.label)}</span><b>${num(r.count)}</b>${r.id === "cooldown" && cooldowns.length ? `<span class="sub">${cooldowns.slice(0, 4).map((c) => `${num(c.count)} × ${esc(c.label)}`).join("<br>")}</span>` : ""}</button>`).join("") || `<div class="empty">Every pilot is busy.</div>`}</div></div>
  </div>`;
}

function directorHtml(summary) {
  const work = summary.work || {};
  const cycle = work.currentCycle;
  const director = activity.director || {};
  const failures = activity.addonFailures || [];
  const parts = [
    cycle ? `<span>Pilot steps this cycle <b>${num(cycle.completedBots)} / ${num(cycle.expectedBots)}</b> · ${esc(duration(cycle.elapsedMs))}</span>` : `<span>Last cycle <b>${num(work.cycleCompletedBots)} / ${num(work.cycleExpectedBots)}</b> steps${work.lastCycleAt ? ` · ${esc(rel(work.lastCycleAt))}` : ""}</span>`,
    work.nextCycleAt ? `<span>Next cycle <b>${esc(rel(work.nextCycleAt))}</b></span>` : "",
    `<span>Director last pass <b>${num(director.assigned)}</b> started · <b>${num(director.failures)}</b> failed</span>`,
    `<span>Step failures <b>${num(work.addonFailedBots)}</b></span>`,
  ].filter(Boolean);
  return `<div class="panel strip">${parts.join("")}</div>
    ${failures.length ? `<div class="panel"><div class="panel-head"><h2>Needs attention</h2></div><div class="panel-body">${failures.map((f) => `<div><a href="#" data-open-pilot="${f.characterID}"><u>${esc(f.characterName)}</u></a>: ${esc(f.message)}</div>`).join("")}</div></div>` : ""}`;
}

async function draw(reloadRoster) {
  if (busy) return;
  busy = true;
  try {
    const summary = await ctxRef.loadSummary(false);
    const [nextActivity] = await Promise.all([getJSON("/api/activity"), reloadRoster ? loadRoster(roster) : null]);
    activity = nextActivity;
    if (!mounted || !$("act-roster")) return;
    $("act-head").innerHTML = headerHtml(summary) + noticesHtml(summary);
    $("act-bar").innerHTML = `<div class="panel-head"><div><h2>State of every pilot</h2><p>Click a state to filter the list</p></div></div><div class="panel-body">${stateBar(activity.states || [], { selected: [...roster.states] })}</div>`;
    $("act-breakdown").innerHTML = breakdownHtml();
    $("act-director").innerHTML = directorHtml(summary);
    const labels = {
      activity: (activity.activities || []).find((a) => a.id === roster.activity)?.label,
      reason: (activity.reasons || []).find((r) => r.id === roster.reason)?.label,
    };
    $("act-roster").innerHTML = rosterHtml(roster, {
      corporations: summary.corporations || [],
      specialties: Object.keys(summary.roster?.bySpecialty || {}).sort(),
      labels,
    });
  } finally {
    busy = false;
  }
}

export async function render(ctx) {
  ctxRef = ctx;
  if (ctx.fresh || !$("act-roster")) {
    mounted = false;
    $("view").innerHTML = `<div id="act-head"><div class="empty">Loading activity…</div></div><div id="act-bar" class="panel"></div><div id="act-breakdown"></div><div id="act-director"></div><div id="act-roster" class="panel"></div>`;
    mounted = true;
    const rerender = (reload) => draw(reload);
    bindRoster($("act-roster"), roster, rerender);
    $("act-bar").addEventListener("click", (event) => {
      const button = event.target.closest("[data-state]");
      if (!button) return;
      const state = button.dataset.state;
      if (roster.states.size === 1 && roster.states.has(state)) roster.states.clear();
      else { roster.states.clear(); roster.states.add(state); }
      roster.page = 0;
      void draw(true).then(() => $("act-roster").scrollIntoView({ behavior: "smooth", block: "start" }));
    });
    $("act-breakdown").addEventListener("click", (event) => {
      const a = event.target.closest("[data-activity]");
      const r = event.target.closest("[data-reason]");
      if (!a && !r) return;
      roster.states.clear();
      if (a) { roster.reason = ""; roster.activity = roster.activity === a.dataset.activity ? "" : a.dataset.activity; }
      if (r) { roster.activity = ""; roster.reason = roster.reason === r.dataset.reason ? "" : r.dataset.reason; }
      roster.page = 0;
      void draw(true).then(() => $("act-roster").scrollIntoView({ behavior: "smooth", block: "start" }));
    });
    $("act-director").addEventListener("click", async (event) => {
      const link = event.target.closest("[data-open-pilot]");
      if (!link) return;
      event.preventDefault();
      const { openPilot } = await import("./drawer.js");
      openPilot(Number(link.dataset.openPilot));
    });
  }
  await draw(true);
}
