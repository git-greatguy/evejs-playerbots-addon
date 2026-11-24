"use strict";

// Behaviour checks from @rizonx's Luna 0.2.152.13 package
// (tests/performance-overlay.test.cjs there), adapted to this repository's
// layout. The package-integrity part of that file is covered by
// windows-native-package.test.cjs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repo = path.join(__dirname, "..");
const services = path.join(repo, "integration/server/server/src/services/playerbots");
const read = (name) => fs.readFileSync(path.join(services, name), "utf8");

test("provider IDs are allocated once per autonomy chunk and empty claims skip the roster", () => {
  const autonomy = read("playerBotAutonomyRuntime.js");
  assert.equal((autonomy.match(/const providerCharacterIDSet = addonChunk/g) || []).length, 1);
  assert.equal((autonomy.match(/\{ providerCharacterIDSet \}/g) || []).length, 6);
  const tasks = read("playerBotTaskRuntime.js");
  const claim = tasks.slice(tasks.indexOf("function claimNextTask("), tasks.indexOf("function releaseProvider("));
  assert.ok(claim.indexOf("if (!tasks.length) return null") < claim.indexOf("runtime.listBots()"));
  assert.match(claim, /options\.providerCharacterIDSet instanceof Set/);
});

test("default and custom corporation bot limits use the same profile index as recruitment", () => {
  const runtime = read("playerBotRuntime.js");
  function load(limit) {
    const records = Object.fromEntries(Array.from({ length: 1002 }, (_, i) => [i + 1, { characterID: i + 1, corporationID: 41 }]));
    let fullReads = 0;
    const repository = {
      ensureTable() {},
      flushTableSync() {},
      read(_table, key) {
        if (key === "/") fullReads += 1;
        return { success: true, data: key === "/" ? records : records[key.slice(1)] };
      },
      write(_table, key, record) { records[key.slice(1)] = record; return { success: true }; },
    };
    const fakeRequire = (name) => name === "node:perf_hooks" ? require(name)
      : name.includes("tableRepository") ? { createTableRepository: () => repository }
      : name.endsWith("characterState") ? { readSharedCharacterRecord: () => null }
      : name.endsWith("corporationState") ? { getCharacterIDsInCorporation: () => Array.from({ length: 1000 }, (_, i) => i + 1) }
      : {};
    const context = {
      module: { exports: {} },
      require: fakeRequire,
      process: { env: limit ? { EVEJS_PLAYER_BOTS_PLAYER_CORPORATION_BOT_LIMIT: String(limit) } : {} },
    };
    vm.runInNewContext(runtime, context);
    return { api: context.module.exports, reads: () => fullReads };
  }
  const defaults = load();
  assert.equal(defaults.api.MAX_BOTS_PER_PLAYER_CORPORATION, 1000);
  assert.equal(defaults.api.MAX_BOTS_PER_CORPORATION, 300);
  assert.equal(defaults.api.countBotsInCorporation(41), 1000);
  defaults.api.setBotAutonomyState(500, { status: "working" });
  assert.equal(defaults.api.getBotByCharacterID(500).status, "working");
  assert.equal(defaults.api.countBotsInCorporation(41), 1000);
  assert.equal(defaults.reads(), 1, "per-bot updates must not reload the entire roster");
  assert.equal(load(77).api.MAX_BOTS_PER_PLAYER_CORPORATION, 77);
  const field = JSON.parse(fs.readFileSync(path.join(repo, "windows-native/evejs-launcher.mod.json"), "utf8"))
    .settings.fields.find((item) => item.id === "playerCorporationBotLimit");
  assert.deepEqual([field.minimum, field.default, field.maximum], [1, 1000, 15000]);
});

test("the dashboard reads director assignments once per snapshot", () => {
  assert.match(read("playerBotDirectorRuntime.js"), /function createDashboardAssignmentReader\(\)/);
  const dashboard = read("playerBotDashboardRuntime.js");
  assert.match(dashboard, /directorAssignments\.createDashboardAssignmentReader\?\.\(\)/);
});
