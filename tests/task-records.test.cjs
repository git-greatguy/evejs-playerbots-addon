"use strict";

// Luna 0.2.152.15 stores each bot task in its own GameStore row
// (/_taskRecords/<taskID>) instead of rewriting one large /_tasks record.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const file = path.join(__dirname, "../integration/server/server/src/services/playerbots/playerBotTaskRuntime.js");
const source = fs.readFileSync(file, "utf8");

function load(initial) {
  const table = JSON.parse(JSON.stringify(initial));
  const writes = [];
  const parts = (key) => key.split("/").filter(Boolean);
  const repo = {
    ensureTable() {},
    read(_table, key) {
      let node = table;
      for (const part of parts(key)) {
        if (!node || typeof node !== "object" || !(part in node)) return { success: false, errorMsg: "ENTRY_NOT_FOUND" };
        node = node[part];
      }
      return { success: true, data: node };
    },
    write(_table, key, value) {
      writes.push(key);
      const keys = parts(key);
      let node = table;
      for (const part of keys.slice(0, -1)) node = node[part] ||= {};
      node[keys.at(-1)] = JSON.parse(JSON.stringify(value));
      return { success: true };
    },
    remove(_table, key) {
      writes.push(`-${key}`);
      const keys = parts(key);
      let node = table;
      for (const part of keys.slice(0, -1)) node = node && node[part];
      if (!node || !(keys.at(-1) in node)) return { success: false, errorMsg: "ENTRY_NOT_FOUND" };
      delete node[keys.at(-1)];
      return { success: true };
    },
    flushTableSync() { return { success: true }; },
  };
  const fakeRequire = (name) => name.includes("tableRepository")
    ? { createTableRepository: () => repo }
    : require(name);
  const context = { module: { exports: {} }, require: fakeRequire, process, console };
  vm.runInNewContext(source, context, { filename: file });
  return { api: context.module.exports, table, writes };
}

const legacyTask = {
  taskID: "PB00000001", kind: "haul", capability: "hauling", status: "completed",
  priority: 0, createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z",
};

test("the first task change migrates the legacy queue into per-task rows", () => {
  const { api, table, writes } = load({ _tasks: { nextSequence: 2, tasks: { PB00000001: legacyTask } } });
  const [result] = api.enqueueTasks([{ kind: "haul", capability: "hauling", requestedBy: "system" }]);
  assert.equal(result.created, true);
  assert.equal(result.task.taskID, "PB00000002");
  assert.deepEqual(Object.keys(table._taskRecords).sort(), ["PB00000001", "PB00000002"]);
  assert.deepEqual(table._tasks, { nextSequence: 3 });
  assert.deepEqual(writes, ["/_taskRecords", "/_tasks"]);
  assert.equal(api.getTask("PB00000001").status, "completed");
});

test("after migration a new task writes only its own row and the sequence", () => {
  const { api, table, writes } = load({
    _tasks: { nextSequence: 3 },
    _taskRecords: { PB00000001: legacyTask, PB00000002: { ...legacyTask, taskID: "PB00000002" } },
  });
  api.enqueueTasks([{ kind: "haul", capability: "hauling", requestedBy: "system" }]);
  assert.deepEqual(writes, ["/_taskRecords/PB00000003", "/_tasks"]);
  assert.equal(table._taskRecords.PB00000001.status, "completed");
  assert.equal(table._tasks.nextSequence, 4);
  assert.equal(api.getTask("PB00000003").status, "queued");
});
