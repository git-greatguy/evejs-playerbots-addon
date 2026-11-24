"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const root = "../integration/server/server/src/services/";
const economySource = fs.readFileSync(require.resolve(root + "playerbots/playerBotCorpEconomyRuntime"), "utf8");
const limitSource = fs.readFileSync(require.resolve(root + "corporation/corporationMemberLimit"), "utf8");

function economyFixture({ balance = 1000, config = {}, failFirst = false } = {}) {
  const db = {};
  const writes = [], transfers = [], journal = [];
  const balances = { 10: balance, 20: 1000 };
  const corporations = {
    1: { corporationID: 1, ceoID: 2, isNPC: false },
    3: { corporationID: 3, ceoID: 21, isNPC: false },
  };
  const members = { 2: 1, 10: 1, 20: 3, 21: 3 };
  const repo = {
    ensureTable() {},
    read(_table, path) {
      const data = path.split("/").filter(Boolean).reduce((value, key) => value?.[key], db);
      return { success: data !== undefined, data };
    },
    write(_table, path, data) {
      const keys = path.split("/").filter(Boolean);
      const last = keys.pop();
      const dest = keys.reduce((node, key) => node[key] ||= {}, db);
      dest[last] = structuredClone(data);
      writes.push(path);
      return { success: true };
    },
    flushTableSync() { writes.push("sync"); return { success: true }; },
  };
  let timer, shutdown, attempts = 0;
  const dependencies = {
    "../../gameStore/tableRepository": { createTableRepository: () => repo },
    "../../gameStore": { registerShutdownHook(_name, callback) { shutdown = callback; } },
    "../account/walletState": {
      JOURNAL_ENTRY_TYPE: { GM_CASH_TRANSFER: 1, PLAYER_DONATION: 2 },
      getCharacterWallet: id => ({ balance: balances[id] }),
      getCharacterWalletJournal: id => id === 10 ? journal : [],
    },
    "../character/characterState": { readSharedCharacterRecord: id => ({ corporationID: members[id] }) },
    "../corporation/corporationState": { getCorporationRecord: id => corporations[id] },
    "../corporation/corpWalletState": { getCorporationWalletBalance: () => 0 },
    "./playerBotRuntime": { hasBotProfile: id => [10,20,21].includes(id) },
    "./playerBotProvisioningRuntime": { getProvisioningRecord: () => ({ startingCapital: 1000, startingWalletBalance: 0 }) },
    "./playerBotSpaceRuntime": { getActorSession: bot => bot },
    "../account/accountService": class {
      async Handle_GiveCash([corp, amount], bot, options) {
        attempts++;
        if (failFirst && attempts === 1) return { success: false, errorMsg: "RETRY" };
        transfers.push({ corp, amount, key: options.idempotencyKey });
        balances[bot.characterID] -= amount;
        if (bot.characterID === 10) journal.push({
          transactionID: journal.length + 1, entryTypeID: 2, ownerID2: corp, amount: -amount, description: options.reason,
        });
        return { success: true };
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(economySource, {
    module, require(id) { assert.ok(dependencies[id], id); return dependencies[id]; }, structuredClone,
    process: { env: config }, setImmediate,
    setTimeout(callback, delay) { assert.equal(delay, 60_000); timer = callback; return { unref() {} }; },
    clearTimeout() {},
  });
  return { api: module.exports, writes, transfers, db, balances, journal,
    tick: async () => { timer(); await new Promise(setImmediate); },
    shutdown: () => shutdown() };
}

test("player-led corporations get 75% net profit with two durability checkpoints and no duplicate payments", async () => {
  const f = economyFixture({ balance: 2500 });
  f.journal.push({ transactionID: 1, entryTypeID: 1, ownerID2: 10, amount: 500, description: "Top-up" });
  const pilot = { characterID: 10, corporationID: 1 };
  assert.equal(await f.api.payCorpShare(pilot, 10, "test"), 750);
  assert.equal(await f.api.payCorpShare(pilot, 10, "test"), 0);
  assert.deepEqual(f.transfers.map(t => t.amount), [750]);
  assert.equal(f.writes.filter(path => path === "sync").length, 2);
  assert.match(f.api.formatCorpEconomy(), /75% of cumulative net profit/);
});

test("below-threshold history writes once after one minute and drains on orderly shutdown", async () => {
  const f = economyFixture({ balance: 1100, config: { EVEJS_PLAYER_BOTS_CORP_MIN_PROFIT_SHARE_ISK: "100", EVEJS_PLAYER_BOTS_PLAYER_CORP_PROFIT_SHARE_PERCENT: "60" } });
  const pilot = { characterID: 10 };
  await f.api.payCorpShare(pilot, 100, "test");
  await f.api.payCorpShare(pilot, 100, "test");
  assert.equal(f.writes.length, 0);
  await f.tick();
  assert.equal(f.writes.length, 1);
  assert.equal(f.db._corpEconomy.corporations[1].profitTracking[10].targetContribution, 60);
  f.balances[10] = 1140;
  await f.api.payCorpShare(pilot, 100, "test");
  await f.shutdown();
  assert.equal(f.writes.length, 2);
  assert.equal(f.db._corpEconomy.corporations[1].profitTracking[10].targetContribution, 84);
});

test("failed transfer reuses its recorded intent and bot-led operations use the configured rate", async () => {
  const f = economyFixture({ balance: 2000, failFirst: true, config: { EVEJS_PLAYER_BOTS_BOT_CORP_OPERATION_SHARE_PERCENT: "35" } });
  await assert.rejects(f.api.payCorpShare({ characterID: 10 }, 1000, "test"), /RETRY/);
  const intent = f.db._corpEconomy.corporations[1].profitTracking[10].pendingPayments[0];
  assert.equal(await f.api.payCorpShare({ characterID: 10 }, 1000, "test"), 750);
  assert.equal(f.transfers[0].key, intent.idempotencyKey);
  assert.equal(await f.api.payCorpShare({ characterID: 20 }, 1000, "mine", "operation1"), 350);
  assert.equal(await f.api.payCorpShare({ characterID: 20 }, 2000, "replay", "operation1"), 350);
  assert.deepEqual(f.transfers.map(t => t.amount), [750,350]);
});

test("player corporation capacity applies to player CEOs only and 0 preserves skill limits", () => {
  const module = { exports: {} };
  const env = { EVEJS_PLAYER_BOTS_PLAYER_CORPORATION_MEMBER_LIMIT: "15000" };
  vm.runInNewContext(limitSource, {
    module, require: id => id === "path" ? require(id) :
      id.includes("playerBotRuntime") ? { hasBotProfile: ceo => ceo === 99 } : {},
    __dirname: ".", process: { env },
  });
  const { effectiveCorporationMemberLimit, hasRoomForAnotherMember } = module.exports;
  const human = { isNPC: false, ceoID: 42, memberLimit: 20 };
  assert.equal(effectiveCorporationMemberLimit(human), 15000);
  assert.equal(effectiveCorporationMemberLimit({ ...human, ceoID: 99 }), 20);
  assert.equal(effectiveCorporationMemberLimit({ ...human, isNPC: true, memberLimit: -1 }), -1);
  assert.equal(hasRoomForAnotherMember(effectiveCorporationMemberLimit(human), 14999), true);
  assert.equal(hasRoomForAnotherMember(effectiveCorporationMemberLimit(human), 15000), false);
  env.EVEJS_PLAYER_BOTS_PLAYER_CORPORATION_MEMBER_LIMIT = "0";
  assert.equal(effectiveCorporationMemberLimit(human), 20);
});


