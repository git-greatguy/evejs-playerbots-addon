"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const activity = require("../integration/server/server/src/services/playerbots/playerBotActivityState");
const { createDashboardCommands } = require("../integration/server/server/src/services/playerbots/playerBotDashboardCommands");
const corpCommands = require("../integration/server/server/src/services/playerbots/playerBotCorpCommands");

const NOW = Date.parse("2026-11-23T05:00:00Z");
const bot = (overrides = {}) => ({ characterID: 1, characterName: "Pilot One", corporationID: 98000001, specialty: "industry", status: "idle", ...overrides });

test("active work is working, travelling or holding by stage and status", () => {
  const working = activity.classifyBotActivity({ bot: bot(), connected: true, activeWork: { kind: "pi-collect", status: "active", stage: "collect", lastAction: "Collected 3 links" }, now: NOW });
  assert.equal(working.state, "working");
  assert.equal(working.doing, "Collecting PI exports: collecting");
  assert.equal(working.reason, "Collected 3 links");

  const travelling = activity.classifyBotActivity({ bot: bot(), activeWork: { kind: "mine", status: "active", stage: "to-market" }, now: NOW });
  assert.equal(travelling.state, "travelling");
  assert.equal(travelling.doing, "Mining: flying to market");

  const holding = activity.classifyBotActivity({ bot: bot(), activeWork: { kind: "industry", status: "review", stage: "" }, now: NOW });
  assert.equal(holding.state, "holding");
  assert.equal(holding.reasonCode, "holding-review");
});

test("active work outranks a pause, and a corporation hold names itself", () => {
  const paused = bot({ status: "paused", autonomyPaused: true });
  assert.equal(activity.classifyBotActivity({ bot: paused, activeWork: { kind: "relocate", status: "active", stage: "travel" } }).state, "travelling");
  assert.equal(activity.classifyBotActivity({ bot: paused, corpHold: true }).reasonCode, "corp-hold");
  assert.equal(activity.classifyBotActivity({ bot: paused }).reasonCode, "operator-pause");
});

test("autowork off while seeding is its own reason with progress", () => {
  const result = activity.classifyBotActivity({
    bot: bot(), connected: true, assignment: { cooldownUntil: NOW + 60_000, lastMessage: "x" },
    autowork: { enabled: false, seeding: { active: true, rosterCount: 2547, target: 5000 } }, now: NOW,
  });
  assert.equal(result.state, "paused");
  assert.equal(result.reasonCode, "seeding");
  assert.match(result.reason, /2,547 of 5,000/);
  const off = activity.classifyBotActivity({ bot: bot(), connected: true, autowork: { enabled: false, seeding: { active: false } }, now: NOW });
  assert.equal(off.reasonCode, "autowork-off");
});

test("queued PI, tasks, offline, cooldown and idle", () => {
  assert.equal(activity.classifyBotActivity({ bot: bot(), queuedWork: { reason: "Waiting for a slot", queuedAt: NOW } }).reasonCode, "pi-slot");
  assert.equal(activity.classifyBotActivity({ bot: bot(), connected: true, tasks: [{ kind: "playerbot.planetary.autoexport", status: "leased" }] }).state, "queued");
  assert.equal(activity.classifyBotActivity({ bot: bot(), connected: false }).state, "offline");
  const cooling = activity.classifyBotActivity({ bot: bot(), connected: true, assignment: { cooldownUntil: NOW + 120_000, lastAssignment: "combat", lastMessage: "No suitable local patrol site in 30002505." }, now: NOW });
  assert.equal(cooling.state, "cooling");
  assert.equal(cooling.reasonGroup, "No suitable local patrol site in #.");
  assert.equal(cooling.retryAt, new Date(NOW + 120_000).toISOString());
  const idle = activity.classifyBotActivity({ bot: bot(), connected: true, assignment: { cooldownUntil: NOW - 1 }, now: NOW });
  assert.equal(idle.state, "idle");
  assert.equal(idle.reasonCode, "unassigned");
});

test("unknown kinds and stages fall back to words", () => {
  assert.equal(activity.describeWork("brand-new-job", "some-stage"), "Brand new job: some stage");
  assert.equal(activity.describeWork("upgrade", "done"), "Upgrading ship");
});

test("pilot commands call the runtime and log per corporation", () => {
  const calls = [];
  const logged = [];
  const bots = [bot(), bot({ characterID: 2, characterName: "Pilot Two" })];
  const commands = createDashboardCommands({
    playerBots: { getBotByCharacterID: (id) => bots.find((entry) => entry.characterID === id) || null },
    tasks: { pauseBot: (b) => { calls.push(["pause", b.characterID]); return { success: true }; }, resumeBot: () => ({ success: true }) },
    operations: {
      startMining: (name, trips, options) => { calls.push(["mine", name, trips, options.stationID]); return { success: name === "Pilot One", message: name === "Pilot One" ? "Mining started." : "No belt." }; },
      stopOperation: () => ({ success: true, message: "stopped" }),
    },
    autonomy: { ensureIndustryCycleStep: async () => {} },
    corpCommands: { appendCommandLog: (corporationID, entry) => logged.push([corporationID, entry]) },
    logger: { warn() {} },
  });
  const mined = commands.runBotCommand([1, 2, 3], "mine", { trips: 3, station: 60003760 });
  assert.equal(mined.success, true);
  assert.deepEqual(mined.results.map((row) => row.success), [true, false, false]);
  assert.deepEqual(calls[0], ["mine", "Pilot One", 3, 60003760]);
  assert.equal(logged.length, 1);
  assert.match(logged[0][1].message, /1 accepted, 1 refused/);
  assert.equal(commands.runBotCommand(Array.from({ length: 51 }, (_, i) => i + 1), "pause").success, false);
  assert.equal(commands.runBotCommand([1], "explode").success, false);
});

function memoryStore(initial = {}) {
  let value = initial;
  return () => ({ read: () => ({ ...value }), write: (next) => { value = { ...next }; } });
}

test("corporation recall persists as a standing order and is restored after a restart", () => {
  const corporationID = 98000001;
  const roster = [bot({ characterID: 11, characterName: "A" }), bot({ characterID: 12, characterName: "B" })];
  const standing = memoryStore();
  const log = memoryStore();
  const deps = {
    playerBots: () => ({ listBots: () => roster }),
    worldData: () => ({ getStationByID: (id) => (id === 60003760 ? { solarSystemID: 30000142 } : null), getSolarSystemByID: () => ({}), getAsteroidBeltsForSystem: () => [] }),
    structures: () => ({ getStructureByID: () => null, listOwnedStructures: () => [] }),
    corporations: () => ({ getCorporationRecord: () => ({ stationID: 60003760, ceoID: 1 }) }),
    characters: () => ({ getCharacterRecord: () => ({}) }),
    operations: () => ({ getOperation: () => null, startRelocation: () => ({ success: true }), stopOperation: () => ({ success: true }) }),
    tasks: () => ({ pauseBot: () => ({ success: true }), resumeBot: () => ({ success: true }), resumeBotsInCorporation: () => ({ success: true, affected: 2 }) }),
    hqStore: memoryStore(),
    standingOrderStore: standing,
    commandLogStore: log,
    log: () => ({ warn() {} }),
    replies: () => ({ emitChatFeedback() {} }),
    now: () => NOW,
  };
  corpCommands.configure(deps);
  try {
    const result = corpCommands.runCorporationCommand(corporationID, "recall", {});
    assert.equal(result.success, true, result.message);
    assert.deepEqual(corpCommands.listStandingRecallCorporationIDs(), [corporationID]);
    assert.equal(corpCommands.describeOrders(corporationID)[0].kind, "recall");
    assert.equal(corpCommands.getCommandLog(corporationID)[0].source, "dashboard");

    // Simulate a restart: in-memory orders gone, the store keeps the record.
    corpCommands._testing.state.orders.clear();
    corpCommands.configure(deps);
    assert.deepEqual(corpCommands.restoreStandingOrders(), [corporationID]);
    assert.equal(corpCommands._testing.state.orders.size, 1);

    const work = corpCommands.runCorporationCommand(corporationID, "work", { mode: "director" });
    assert.equal(work.success, true, work.message);
    assert.deepEqual(corpCommands.listStandingRecallCorporationIDs(), []);
    assert.equal(corpCommands.runCorporationCommand(corporationID, "bogus").success, false);
  } finally {
    corpCommands.reset();
  }
});
