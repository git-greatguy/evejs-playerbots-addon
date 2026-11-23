// Dashboard shell: hash router, shared summary refresh, connection status.

import { getJSON } from "./api.js";
import { $, esc, rel } from "./ui.js";
import { closeDrawer } from "./drawer.js";
import * as activity from "./view-activity.js";
import * as corporations from "./view-corporations.js";
import * as history from "./view-history.js";
import * as world from "./view-world.js";
import * as performance from "./view-performance.js";
import * as settings from "./view-settings.js";

const REFRESH_MS = 15_000;
const VIEWS = { activity, corporations, history, world, performance, settings };
const TITLES = { activity: "Activity", corporations: "Corporations", history: "History", world: "World", performance: "Performance", settings: "Settings" };
// Old hashes from the previous dashboard keep working.
const ALIASES = { overview: "activity", pilots: "activity", operations: "history", priorities: "corporations", systems: "world", territory: "world/territory", killboard: "world/killboard" };

export const store = { summary: null, summaryAt: 0, route: { view: "activity", param: "" } };

function parseHash() {
  let hash = decodeURIComponent(location.hash.replace(/^#/, "")) || "activity";
  const [head] = hash.split("/");
  if (ALIASES[head]) hash = ALIASES[head] + hash.slice(head.length);
  const [view, ...rest] = hash.split("/");
  return VIEWS[view] ? { view, param: rest.join("/") } : { view: "activity", param: "" };
}

export function setCrumbs(parts) {
  $("crumbs").innerHTML = parts.map((part, index) => index === parts.length - 1
    ? `<strong>${esc(part.label)}</strong>`
    : `<a href="${esc(part.href)}">${esc(part.label)}</a><span class="muted">/</span>`).join("");
}

export async function loadSummary(force = false) {
  if (!force && store.summary && Date.now() - store.summaryAt < REFRESH_MS - 500) return store.summary;
  try {
    store.summary = await getJSON("/api/summary");
    store.summaryAt = Date.now();
    $("connection-dot").classList.remove("down");
    $("connection-state").textContent = "Connected to EveJS";
    const uptime = Number(store.summary.process?.uptimeSeconds) || 0;
    $("uptime").textContent = `Server up ${uptime >= 3600 ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : `${Math.floor(uptime / 60)}m`}`;
    $("updated-at").textContent = `Updated ${new Date(store.summary.generatedAt).toLocaleTimeString()}`;
  } catch (error) {
    $("connection-dot").classList.add("down");
    $("connection-state").textContent = "EveJS unreachable";
    $("updated-at").textContent = `Last try failed: ${error.message}`;
    if (!store.summary) throw error;
  }
  return store.summary;
}

async function show(force = false) {
  const route = parseHash();
  const changed = route.view !== store.route.view || route.param !== store.route.param;
  store.route = route;
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === route.view));
  if (changed || force) setCrumbs([{ label: TITLES[route.view] }]);
  const view = VIEWS[route.view];
  const fresh = changed || force;
  try {
    await view.render({ param: route.param, fresh, store, loadSummary, setCrumbs });
    if (!fresh) $("view").querySelector(".refresh-failed")?.remove();
  } catch (error) {
    // A missing pilot, corporation or operation will not appear by retrying.
    if (error.status === 404) {
      $("view").querySelector(".refresh-failed")?.remove();
      const back = route.param ? ` <a href="#${esc(route.view)}">Back to ${esc(TITLES[route.view])}</a>` : "";
      $("view").innerHTML = `<div class="notice error load-failed">${esc(error.message)}${back}</div>`;
      return;
    }
    const message = `${error.message || String(error)} Retrying every ${REFRESH_MS / 1000} seconds.`;
    // A failed background refresh keeps the page the operator is looking at.
    if (!fresh && $("view").children.length && !$("view").querySelector(".load-failed")) {
      let banner = $("view").querySelector(".refresh-failed");
      if (!banner) {
        banner = document.createElement("div");
        banner.className = "notice error refresh-failed";
        $("view").prepend(banner);
      }
      banner.textContent = `Could not refresh: ${message}`;
      return;
    }
    $("view").innerHTML = `<div class="notice error load-failed">${esc(message)}</div>`;
  }
}

window.addEventListener("hashchange", () => { closeDrawer(); void show(true); });
$("refresh").addEventListener("click", async () => {
  store.summaryAt = 0;
  await show(true);
});

// Views re-render on the timer unless the operator is typing in a form.
setInterval(() => {
  const active = document.activeElement;
  const editing = active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName) && $("view").contains(active);
  if (editing || $("dialog").open) return;
  const view = VIEWS[store.route.view];
  if (view.autoRefresh === false) return;
  void show(false);
}, REFRESH_MS);
setInterval(() => {
  if (store.summary) $("updated-at").title = `Generated ${rel(store.summary.generatedAt)}`;
}, 5_000);

void show(true);
