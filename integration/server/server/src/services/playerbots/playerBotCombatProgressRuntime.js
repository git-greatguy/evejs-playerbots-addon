"use strict";

// Keep anomaly difficulty progression separate from the character's seeded
// wallet. A clear is earned only when Dungeon authority marks that exact site
// instance completed; every bot begins at tier 1 and advances one tier at a
// time after a verified clear.

const { createTableRepository } = require("../../gameStore/tableRepository");

const TABLE = "playerBots";
const PROGRESS_PATH = "/_combatProgress";
const MAX_RECORDED_SITES = 256;
const repo = createTableRepository("service:playerbots", { strict: true });
const pending = new Map();
let saveTimer;
let shutdownRegistered = false;

function readProgressMap() {
  repo.ensureTable(TABLE);
  const result = repo.read(TABLE, PROGRESS_PATH);
  return result.success && result.data && typeof result.data === "object" ? result.data : {};
}

function getProgress(characterID) {
  const id = Math.trunc(Number(characterID) || 0);
  return id > 0 ? pending.get(id) || readProgressMap()[String(id)] || { highestClearedTier: 0, clearedSites: [] } :
    { highestClearedTier: 0, clearedSites: [] };
}

function saveProgress() {
  clearTimeout(saveTimer); saveTimer = undefined;
  if (!pending.size) return;
  const merged = { ...readProgressMap(), ...Object.fromEntries(pending) };
  const result = repo.write(TABLE, PROGRESS_PATH, merged);
  if (result?.success !== true) throw Error(result?.errorMsg || "PLAYERBOT_COMBAT_PROGRESS_WRITE_FAILED");
  pending.clear();
}

function scheduleProgressSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    try { saveProgress(); }
    catch (error) {
      require("../../utils/logger").warn(`[PlayerBots] Cannot save combat progress yet: ${error.message}`);
      scheduleProgressSave();
    }
  }, 60_000);
  saveTimer.unref?.();
}

function getNextSiteDifficulty(characterID, maxSiteDifficulty) {
  const maximum = Math.max(1, Math.trunc(Number(maxSiteDifficulty) || 1));
  const progress = getProgress(characterID);
  return Math.max(1, Math.min(maximum, Math.trunc(Number(progress.highestClearedTier) || 0) + 1));
}

function recordSiteClear(characterID, siteInstanceID, difficulty) {
  const id = Math.trunc(Number(characterID) || 0);
  const instanceID = Math.trunc(Number(siteInstanceID) || 0);
  const tier = Math.max(1, Math.trunc(Number(difficulty) || 1));
  if (!id || !instanceID) return { success: false, reason: "invalid-site-clear" };

  const previous = getProgress(id);
  const clearedSites = Array.isArray(previous.clearedSites) ? previous.clearedSites : [];
  if (clearedSites.some((entry) => Number(entry && entry.siteInstanceID) === instanceID)) {
    return { success: true, duplicate: true, progress: previous };
  }
  const next = {
    highestClearedTier: Math.max(Math.trunc(Number(previous.highestClearedTier) || 0), tier),
    completedSiteCount: Math.max(0, Math.trunc(Number(previous.completedSiteCount) || 0)) + 1,
    clearedSites: [...clearedSites, {
      siteInstanceID: instanceID,
      difficulty: tier,
      completedAt: new Date().toISOString(),
    }].slice(-MAX_RECORDED_SITES),
  };
  if (!shutdownRegistered) {
    require("../../gameStore").registerShutdownHook("playerbots-combat-progress", saveProgress);
    shutdownRegistered = true;
  }
  pending.set(id, next);
  scheduleProgressSave();
  return { success: true, duplicate: false, progress: next };
}

module.exports = { getProgress, getNextSiteDifficulty, recordSiteClear };
