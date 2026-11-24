"use strict";

// During a fight the defense assessment refreshes its hit-point observation
// every second. It must keep saving that memory, but flush the playerBots
// table to disk synchronously only when the decision itself changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const file = path.resolve(__dirname,
  "../integration/server/server/src/services/playerbots/playerBotDefenseAssessment.js");

function load() {
  const rows = new Map();
  const counts = { writes: 0, flushes: 0 };
  let clock = 1_000_000;
  let hp = 5_000;
  let action = "engage";
  const services = {
    "./playerBotDefensePolicy": {
      decide: (input, memory) => ({ action, reason: action === "engage" ? "winning" : "losing", memory: { ...memory } }),
    },
    "./playerBotLocalDefenseConfig": { get: () => ({ enabled: true, aggressive: true, systemIDs: [30000142], policy: {} }) },
    "./playerBotSpaceRuntime": {
      getActorSpace: () => ({ entity: { itemID: 7001, typeID: 587 } }),
      getSpaceState: () => ({}),
    },
    "./playerBotCombatRuntime": {
      getControlledDrones: () => [],
      estimateEffectiveHitPoints: (typeID) => (typeID === 587 ? hp : 3_000),
    },
    "./playerBotCombatFitRuntime": {
      buildCombatFitSnapshot: () => ({ success: true, fit: { modules: [{ itemID: 1, typeID: 2 }], totalDrones: 5, ready: true } }),
    },
    "./playerBotOperationRuntime": {
      hasRoleShipFit: () => true,
      getRoleShipFitProfile: () => ({ droneTypeIDs: [1, 2, 3, 4, 5] }),
    },
    "./playerBotLocalDefenseAdapter": { supportFor: () => ({}) },
    "../../gameStore/tableRepository": {
      createTableRepository: () => ({
        ensureTable() {},
        read: (table, key) => ({ success: true, data: rows.get(key) }),
        write(table, key, value) { counts.writes += 1; rows.set(key, JSON.parse(JSON.stringify(value))); return { success: true }; },
        flushTableSync() { counts.flushes += 1; return { success: true }; },
      }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    module, exports: module.exports, Math, Number, JSON, Boolean, String, Object, Array,
    Date: { now: () => clock },
    require(id) {
      assert.ok(Object.hasOwn(services, id), `Unexpected dependency: ${id}`);
      return services[id];
    },
  }, { filename: file });
  return {
    assess: () => module.exports.assess({ characterID: 9, specialty: "security" }, { itemID: 8001, typeID: 600 },
      { systemID: 30000142 }, { kind: "combat", mode: "security" }, true),
    counts,
    tick(ms, lostHP) { clock += ms; hp -= lostHP; },
    setAction(next) { action = next; },
  };
}

test("only a changed decision is flushed synchronously; combat memory is still saved", () => {
  const fight = load();
  fight.assess();
  assert.deepEqual(fight.counts, { writes: 1, flushes: 1 });
  for (let second = 0; second < 5; second += 1) {
    fight.tick(1_000, 200);
    fight.assess();
  }
  assert.equal(fight.counts.flushes, 1, "observations alone do not flush");
  assert.ok(fight.counts.writes > 1, "observations are still written to the store");
  fight.setAction("evade");
  fight.tick(1_000, 200);
  fight.assess();
  assert.equal(fight.counts.flushes, 2, "a new decision is flushed at once");
});
