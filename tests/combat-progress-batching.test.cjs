"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const file = require.resolve("../integration/server/server/src/services/playerbots/playerBotCombatProgressRuntime");

test("combat progression is visible in memory and saves one snapshot per minute", () => {
  const module = { exports: {} };
  const writes = [];
  let store = {}, timer, shutdown;
  const repo = {
    ensureTable() {},
    read() { return { success: true, data: store }; },
    write(_table, _path, value) {
      writes.push(value);
      store = value;
      return { success: true };
    },
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    module,
    require(name) {
      if (name.endsWith("tableRepository")) return { createTableRepository: () => repo };
      assert.equal(name, "../../gameStore");
      return { registerShutdownHook(_name, callback) { shutdown = callback; } };
    },
    setTimeout(callback, delay) { assert.equal(delay, 60_000); timer = callback; return { unref() {} }; },
    clearTimeout() {},
  });
  const bot = module.exports;
  bot.recordSiteClear(10, 111, 1);
  bot.recordSiteClear(10, 222, 2);
  assert.equal(bot.recordSiteClear(10, 222, 2).duplicate, true);
  assert.equal(bot.getNextSiteDifficulty(10, 10), 3);
  assert.equal(writes.length, 0);
  timer();
  assert.equal(writes.length, 1);
  assert.equal(store["10"].completedSiteCount, 2);
  bot.recordSiteClear(20, 333, 1);
  shutdown();
  assert.equal(writes.length, 2);
  assert.equal(store["20"].completedSiteCount, 1);
});
