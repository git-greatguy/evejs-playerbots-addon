"use strict";

// Corporation priorities, chosen per corporation in the dashboard. A
// corporation with priorities set has its pilots considered by the director in
// that order, lowest completed count first; completed tasks and operations
// that match a priority advance its count. Corporations without priorities
// keep the director's normal order. Contributed by Luna.

const { createTableRepository } = require("../../gameStore/tableRepository");

const TABLE = "playerBots";
const PATH = "/_corporationPriorities";
const PRIORITIES = Object.freeze({
  stations: {
    label: "Build and maintain stations",
    matches: /structure|station|core-install|infrastructure/i,
  },
  wars: {
    label: "War declarations and mobilization",
    matches: /war|combat|sovereignty|patrol/i,
  },
  patrols: {
    label: "System patrols and defense",
    matches: /combat|patrol|defen[cs]e|sovereignty/i,
  },
  economy: {
    label: "Economic expansion",
    matches: /mine|industry|trade|market|planetary|manufactur|deliver|sell|buy|fulfill|haul/i,
  },
  sovereignty: {
    label: "Sovereignty expansion",
    matches: /sovereignty|territory|structure|patrol/i,
  },
  logistics: {
    label: "Trade and logistics",
    matches: /trade|market|deliver|sell|buy|fulfill|haul|route|supply/i,
  },
  planetary: {
    label: "Planetary development",
    matches: /planetary|colony|extractor/i,
  },
  security: {
    label: "Security and threat response",
    matches: /combat|patrol|defen[cs]e|war/i,
  },
  ships: {
    label: "Ship upgrades and fitting",
    matches: /upgrade|fit|ship/i,
  },
});
// Hulls a pilot under the ship-upgrade priority should leave first.
const STARTER_HULL_TYPE_IDS = new Set([601, 670]); // Ibis, Capsule
const SPECIALTY_PRIORITY_IDS = Object.freeze({
  stations: new Set(["industry", "logistics", "trade", "structure"]),
  wars: new Set(["security", "sovereignty", "piracy"]),
  patrols: new Set(["security", "sovereignty", "piracy"]),
  economy: new Set(["industry", "trade", "mining", "planetary"]),
  sovereignty: new Set(["sovereignty", "security"]),
  logistics: new Set(["trade", "logistics", "industry"]),
  planetary: new Set(["planetary", "industry"]),
  security: new Set(["security", "piracy", "sovereignty"]),
  ships: new Set(["security", "piracy", "sovereignty", "industry", "trade", "mining", "planetary", "logistics"]),
});

let repo = null;
// The director asks for a rank for every candidate pilot, so the stored
// priorities are read once and kept; every write goes through saveState.
let cachedState = null;

function getRepo() {
  if (!repo) repo = createTableRepository("service:playerbots", { strict: true });
  return repo;
}

function readState() {
  if (cachedState) return cachedState;
  const store = getRepo();
  store.ensureTable(TABLE);
  const result = store.read(TABLE, PATH);
  cachedState = result.success && result.data && typeof result.data === "object" ? result.data : {};
  return cachedState;
}

function saveState(state) {
  const store = getRepo();
  store.ensureTable(TABLE);
  const result = store.write(TABLE, PATH, state);
  if (!result.success) throw new Error(result.errorMsg || "PLAYERBOT_CORPORATION_PRIORITIES_WRITE_FAILED");
  cachedState = state;
}

function configuredEntry(corporationID) {
  const entry = readState()[String(Math.trunc(Number(corporationID) || 0))];
  return entry && Array.isArray(entry.priorityIDs) && entry.priorityIDs.length ? entry : null;
}

function validPriorityIDs(values) {
  if (!Array.isArray(values)) return null;
  return [...new Set(values.map((value) => String(value || "").trim()).filter((id) => Object.hasOwn(PRIORITIES, id)))].slice(0, 8);
}

function getCorporationPriorities(corporationID) {
  const entry = configuredEntry(corporationID);
  const selected = entry ? entry.priorityIDs : [];
  return {
    priorityIDs: selected.filter((priorityID) => Object.hasOwn(PRIORITIES, priorityID)),
    priorities: selected.filter((priorityID) => Object.hasOwn(PRIORITIES, priorityID)).map((priorityID) => ({
      id: priorityID,
      label: PRIORITIES[priorityID].label,
      completedTasks: Math.max(0, Math.trunc(Number(entry && entry.completedTasks && entry.completedTasks[priorityID]) || 0)),
    })),
    updatedAt: String(entry && entry.updatedAt || ""),
  };
}

function setCorporationPriorities(corporationID, values) {
  const id = Math.trunc(Number(corporationID) || 0);
  const priorityIDs = validPriorityIDs(values);
  if (!Number.isSafeInteger(id) || id <= 0) return { success: false, statusCode: 400, message: "A valid corporation ID is required." };
  if (!priorityIDs) return { success: false, statusCode: 400, message: "priorityIDs must be a list of available priorities." };
  const state = { ...readState() };
  const old = state[String(id)] || {};
  const oldIDs = new Set(Array.isArray(old.priorityIDs) ? old.priorityIDs : []);
  const completedTasks = Object.fromEntries(priorityIDs.map((priorityID) => [
    priorityID,
    oldIDs.has(priorityID) ? Math.max(0, Math.trunc(Number(old.completedTasks && old.completedTasks[priorityID]) || 0)) : 0,
  ]));
  // An empty list clears the corporation's priorities.
  if (priorityIDs.length) state[String(id)] = { priorityIDs, completedTasks, updatedAt: new Date().toISOString() };
  else delete state[String(id)];
  saveState(state);
  return { success: true, corporationID: id, ...getCorporationPriorities(id) };
}

function findBot(characterID) {
  const playerBots = require("./playerBotRuntime");
  return typeof playerBots.getBotByCharacterID === "function"
    ? playerBots.getBotByCharacterID(characterID)
    : playerBots.listBots().find((entry) => Number(entry.characterID) === characterID);
}

function recordCompletedTask(task) {
  const characterID = Math.trunc(Number(task && (task.resourceOwnerCharacterID || task.targetCharacterID || task.providerCharacterID)) || 0);
  if (!characterID) return;
  const bot = findBot(characterID);
  const corporationID = Math.trunc(Number(bot && bot.corporationID) || 0);
  if (!corporationID) return;
  const configured = configuredEntry(corporationID);
  if (!configured) return;
  const state = { ...readState() };
  const entry = { ...configured, completedTasks: { ...(configured.completedTasks || {}) } };
  const text = `${String(task.kind || "")} ${String(task.capability || "")}`;
  let changed = false;
  for (const priorityID of entry.priorityIDs) {
    const priority = PRIORITIES[priorityID];
    if (!priority || !priority.matches.test(text)) continue;
    entry.completedTasks = entry.completedTasks && typeof entry.completedTasks === "object" ? entry.completedTasks : {};
    entry.completedTasks[priorityID] = Math.max(0, Math.trunc(Number(entry.completedTasks[priorityID]) || 0)) + 1;
    changed = true;
  }
  if (!changed) return;
  state[String(corporationID)] = entry;
  entry.updatedAt = new Date().toISOString();
  saveState(state);
}

function recordCompletedOperation(operation) {
  const characterID = Math.trunc(Number(operation && operation.characterID) || 0);
  const operationID = String(operation && operation.operationID || "").trim().slice(0, 120);
  if (!characterID || !operationID) return false;
  const bot = findBot(characterID);
  const corporationID = Math.trunc(Number(bot && bot.corporationID) || Number(operation.corporationID) || 0);
  if (!corporationID) return false;
  const configured = configuredEntry(corporationID);
  if (!configured) return false;
  const state = { ...readState() };
  const entry = { ...configured, completedTasks: { ...(configured.completedTasks || {}) } };
  const completedOperations = Array.isArray(entry.completedOperationIDs) ? entry.completedOperationIDs : [];
  if (completedOperations.includes(operationID)) return false;
  const text = `${String(operation.kind || "")} ${String(operation.lastAction || "")}`;
  let changed = false;
  for (const priorityID of entry.priorityIDs) {
    const priority = PRIORITIES[priorityID];
    if (!priority || !priority.matches.test(text)) continue;
    entry.completedTasks = entry.completedTasks && typeof entry.completedTasks === "object" ? entry.completedTasks : {};
    entry.completedTasks[priorityID] = Math.max(0, Math.trunc(Number(entry.completedTasks[priorityID]) || 0)) + 1;
    changed = true;
  }
  if (!changed) return false;
  entry.completedOperationIDs = [...completedOperations.slice(-499), operationID];
  entry.updatedAt = new Date().toISOString();
  state[String(corporationID)] = entry;
  saveState(state);
  return true;
}

// Lower ranks are considered first. Corporations without priorities rank
// every pilot 0, which leaves the director's normal order unchanged. The ship
// type is asked for only when the ship-upgrade priority decides the rank.
function getDirectorSpecialtyRank(corporationID, specialty, getShipTypeID = () => 0) {
  if (!configuredEntry(corporationID)) return 0;
  const priorities = getCorporationPriorities(corporationID);
  const ordered = priorities.priorities
    .map((entry, index) => ({ id: entry.id, index, completedTasks: entry.completedTasks }))
    .sort((left, right) => left.completedTasks - right.completedTasks || left.index - right.index);
  const normalizedSpecialty = String(specialty || "").trim().toLowerCase();
  const matchIndex = ordered.findIndex((entry) => SPECIALTY_PRIORITY_IDS[entry.id]?.has(normalizedSpecialty));
  if (matchIndex < 0) return (ordered.length + 1) * 2;
  if (ordered[matchIndex].id !== "ships") return matchIndex * 2;
  const shipTypeID = Number(typeof getShipTypeID === "function" ? getShipTypeID() : getShipTypeID) || 0;
  return matchIndex * 2 + (STARTER_HULL_TYPE_IDS.has(shipTypeID) ? 0 : 1);
}

function listPriorityOptions() {
  return Object.entries(PRIORITIES).map(([id, priority]) => ({ id, label: priority.label }));
}

module.exports = {
  _testing: { reset: () => { cachedState = null; repo = null; }, setRepo: (value) => { repo = value; cachedState = null; } },
  getCorporationPriorities, getDirectorSpecialtyRank, listPriorityOptions, recordCompletedOperation, recordCompletedTask, setCorporationPriorities };
