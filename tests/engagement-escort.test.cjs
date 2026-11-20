"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../integration/server/server/src/services/playerbots");

function loadRuntime(name, services) {
  const filename = path.join(root, name + ".js");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, Map, Set, Date, performance, process: { env: {} },
    require(id) {
      assert.ok(Object.hasOwn(services, id), "Unexpected dependency: " + id);
      return services[id];
    },
  }, { filename });
  return module.exports;
}

function escortEncounter(mode = "security", initialTargetID = 99) {
  const events = [];
  const rows = new Map();
  const repository = {
    ensureTable() {},
    read(table, key) { return { success: true, data: rows.get(key) }; },
    write(table, key, value) {
      rows.set(key, structuredClone(value));
      if (value.playerBotOperationRecord) events.push(value.playerBotOperationRecord.pendingCombatAction ? "save-pending" : "save");
      return { success: true };
    },
    flushTableSync() { return { success: true }; },
  };
  const bot = { characterID: 12, specialty: mode };
  const ship = { kind: "ship", itemID: 100, position: { x: 0, y: 0, z: 0 } };
  const target = {
    kind: "ship", itemID: 200, itemName: "Angel Raider", npcEntityType: "npc",
    warFactionID: 500011, position: { x: 2_000, y: 0, z: 0 },
  };
  const drones = [301, 302].map((itemID) => ({ kind: "drone", itemID, controllerID: ship.itemID, targetID: null }));
  const dynamicEntities = new Map([ship, target, ...drones].map((entity) => [entity.itemID, entity]));
  const scene = {
    systemID: 1, dynamicEntities, getEntityByID: (id) => dynamicEntities.get(id),
    getVisibleEntitiesForSession: () => [target],
  };
  const session = { characterID: bot.characterID, shipID: ship.itemID, droneSettings: { 1275: true } };
  ship.session = session;
  const beltID = 500;
  const mining = {
    characterID: 13, escortCharacterID: bot.characterID, beltID, miningEscortSystemID: scene.systemID,
    miningEscortGroupKey: scene.systemID + ":" + beltID, escortRequiredTier: 1,
  };
  const world = { acceptFirst: true, sameScope: true };
  const space = {
    getActorSpace: () => ({ entity: ship, scene, session }),
    getSpaceState: () => ({ inSpace: true, systemID: scene.systemID, shield: 1, distanceTo(id) {
      return id === beltID ? 500 : id === target.itemID ? target.position.x : null;
    } }),
    approach(pilot, targetID, followRange) {
      assert.equal(pilot, bot);
      assert.equal(targetID, target.itemID);
      events.push("follow");
      Object.assign(ship, { mode: "FOLLOW", targetEntityID: targetID, followRange });
      return { success: true };
    },
    warp() { assert.fail("unexpected warp"); },
    lockTarget() { assert.fail("unexpected lock"); },
  };
  const services = {
    "../../gameStore/tableRepository": { createTableRepository: () => repository },
    "../../space/worldData": { getSolarSystemByID: () => ({ security: 0.9 }) },
    "../../space/destiny/identity/interactionScope": { canEntitiesInteractLocally: () => world.sameScope },
    "../../space/npc/pirateFactionPolicy": {
      PIRATE_FACTION_BY_FACTION_ID: { 500011: "angel" }, resolvePirateFactionForSystem: () => ({}),
    },
    "../../utils/logger": { info() {}, debug() {}, warn() {} },
    "../character/characterState": { getCharacterRecord: () => ({ shipTypeID: 626 }) },
    "../corporation/corporationState": { getCorporationRecord: () => ({}) },
    "../corporation/warRuntimeState": {},
    "../fleets/fleetRuntime": { getFleetForCharacter: () => null },
    "../inventory/itemStore": { ITEM_FLAGS: { CARGO_HOLD: 5 } },
    "../inventory/itemTypeRegistry": {},
    "../security/crimewatchState": { isCharacterCriminal: () => false, isCharacterSuspect: () => false },
    "../drone/droneRuntime": {
      commandEngage(actor, ids, id) {
        assert.equal(actor, session);
        assert.deepEqual(Array.from(ids), drones.map((drone) => drone.itemID));
        assert.equal(id, target.itemID);
        events.push("engage");
        if (world.acceptFirst) drones[0].targetID = id;
        const rejected = drones.filter((drone) => drone.targetID !== id);
        return { type: "dict", entries: rejected.map((drone) => [drone.itemID, ["CustomNotify", {}]]) };
      },
      commandReturnBay() { events.push("recall"); },
    },
    "./playerBotAutonomyRuntime": { wakeIndustryCycleStep: async () => {} },
    "./playerBotCombatDecisionRuntime": require(path.join(root, "playerBotCombatDecisionRuntime")),
    "./playerBotCombatFitRuntime": { buildCombatFitSnapshot: () => ({
      success: true, fit: { ready: true, droneControlRange: 25_000, droneAttackRange: 5_600 },
    }) },
    "./playerBotDefenseAssessment": { enabled: () => false },
    "./playerBotEconomyRuntime": { BOT_HUB_STATION_ID: 60001001 },
    "./playerBotInventoryRuntime": {},
    "./playerBotLocalDefenseAdapter": { hasLease: () => false },
    "./playerBotPerformanceTelemetry": { getTelemetry: () => ({ recordWork() {} }) },
    "./playerBotRuntime": { listBots: () => [bot] },
    "./playerBotSpaceRuntime": space,
    "./playerBotTaskRuntime": { hasBlockingLease: () => false },
    "./playerBotWildfireRuntime": { isRevengePilot: () => true, sayBurn: () => events.push("say") },
  };
  for (const name of ["playerBotInterruptRuntime", "playerBotOperationRuntime", "playerBotCombatPolicy",
    "playerBotEngagementRuntime", "playerBotCombatRuntime", "playerBotMiningEscortRuntime"]) {
    services["./" + name] = loadRuntime(name, services);
  }
  const operations = services["./playerBotOperationRuntime"];
  // Snapshot a healthy fitted guard without loading fittings, skills or the game database.
  operations.hasRoleShipFit = () => true;
  operations._testing.saveOperation({
    operationID: "guard", characterID: bot.characterID, kind: "combat", mode, status: "active", stage: "engage",
    miningEscortGroupKey: mining.miningEscortGroupKey, miningEscortBeltID: beltID, miningEscortFitTier: 1,
    miningEscortForCharacterID: mining.characterID, targetID: initialTargetID, targetLabel: "Previous target",
  });
  events.length = 0;
  function alert() {
    assert.equal(operations.setDefensiveCombatTarget(bot.characterID, target.itemID), true);
    events.length = 0;
  }
  const saved = () => operations.getOperation(bot.characterID);
  const state = () => services["./playerBotMiningEscortRuntime"].getEscortState(mining);
  const advance = () => operations.advanceOperation(bot.characterID);
  return { alert, advance, state, saved, events, drones, target, ship, scene, world };
}

test("A guard adopts a drone's existing target and the miner sees the persisted engagement", async () => {
  const s = escortEncounter();
  s.drones[1].targetID = s.target.itemID;
  s.alert();
  assert.equal(s.saved().targetID, null);
  const before = s.state();
  assert.equal(before.assigned && before.onGrid, true);
  assert.equal(before.ready, false);
  const first = await s.advance();
  const guard = s.saved();
  assert.equal(first.delayMs, 1_000, guard.lastError);
  assert.equal(guard.targetID, s.target.itemID);
  assert.equal(guard.targetLabel, s.target.itemName);
  assert.equal(guard.pendingCombatAction, null);
  assert.match(guard.lastAction, /Incoming aggression/);
  const after = s.state();
  assert.equal(after.engaging && after.ready, true);
  assert.deepEqual(s.events, ["save"]);
  assert.equal((await s.advance()).delayMs, 15_000);
  assert.deepEqual(s.events, ["save"]);
  assert.equal(s.drones[0].targetID, null);
});

test("A new revenge order speaks once, logs only confirmed drones and adopts a repeated alert silently", async () => {
  const s = escortEncounter("piracy");
  s.alert();
  assert.equal((await s.advance()).delayMs, 1_000, s.saved().lastError);
  assert.deepEqual(s.events, ["say", "save-pending", "engage", "save"]);
  assert.match(s.saved().lastAction, /with 1 drone\(s\)/);
  s.alert();
  assert.equal((await s.advance()).delayMs, 1_000);
  assert.deepEqual(s.events, ["save"]);
  assert.equal(s.state().ready, true);
});

test("A wholly refused revenge order takes the host's return branch and leaves the miner unready", async () => {
  const s = escortEncounter("piracy");
  s.world.acceptFirst = false;
  s.alert();
  assert.equal((await s.advance()).delayMs, 15_000, s.saved().lastError);
  const guard = s.saved();
  assert.deepEqual(s.events, ["say", "save-pending", "engage", "save"]);
  assert.match(guard.lastAction, /authority refused target 200.*CustomNotify/);
  assert.equal(guard.stage, "return");
  assert.equal(guard.targetID, null);
  assert.equal(guard.pendingCombatAction, null);
  assert.equal(guard.defensiveTargetID, null);
  assert.equal(s.state().ready, false);
});

test("An existing drone assignment cannot bypass the guard's current target scope", async () => {
  const s = escortEncounter();
  s.drones[0].targetID = s.target.itemID;
  s.world.sameScope = false;
  s.alert();
  assert.equal((await s.advance()).defensiveTargetCleared, true);
  assert.equal(s.saved().targetID, null);
  assert.equal(s.saved().defensiveTargetID, null);
  assert.equal(s.state().ready, false);
  assert.ok(s.events.includes("recall"));
  assert.ok(!s.events.includes("engage"));
});

for (const [defensive, distance, followRange] of [[true, 21_000, 14_000], [false, 6_000, 3_919]]) {
  test(`A guard with a native assignment keeps its FOLLOW and saves once at ${distance} m`, async () => {
    const s = escortEncounter("security", null);
    s.target.position.x = distance;
    s.drones[1].targetID = s.target.itemID;
    s.drones[1].droneCombat = { targetID: s.target.itemID, autoAssigned: true };
    if (defensive) s.alert();
    assert.equal(s.state().ready, false);
    assert.equal((await s.advance()).delayMs, 15_000, s.saved().lastError);
    assert.equal(s.ship.targetEntityID, s.target.itemID);
    assert.equal(s.ship.followRange, followRange);
    assert.equal(s.saved().targetID, s.target.itemID);
    assert.equal(s.saved().targetLabel, s.target.itemName);
    assert.equal(s.state().ready, true);
    assert.deepEqual(s.events, ["follow", "save"]);
    assert.equal((await s.advance()).delayMs, 15_000);
    assert.deepEqual(s.events, ["follow", "save"]);
  });
}

test("Free-fire settings and another ship's drone give the miner no engagement while closing", async () => {
  const s = escortEncounter();
  s.target.position.x = 21_000;
  s.scene.dynamicEntities.set(303, { kind: "drone", itemID: 303, controllerID: 999,
    targetID: s.target.itemID, droneCombat: { targetID: s.target.itemID, autoAssigned: true } });
  s.alert();
  assert.equal((await s.advance()).delayMs, 15_000);
  assert.equal(s.state().ready, false);
  assert.equal(s.saved().targetID, null);
  assert.deepEqual(s.events, ["follow"]);
  // The same FOLLOW is still active when a real assignment arrives on the next patrol step.
  s.drones[0].targetID = s.target.itemID;
  s.drones[0].droneCombat = { targetID: s.target.itemID, autoAssigned: true };
  assert.equal((await s.advance()).delayMs, 15_000);
  assert.equal(s.state().ready, true);
  assert.deepEqual(s.events, ["follow", "save"]);
});

test("A stale out-of-control-range target can only be adopted after re-entering the fitted control radius", async () => {
  const s = escortEncounter();
  s.target.position.x = 25_001;
  s.drones[0].targetID = s.target.itemID;
  s.drones[0].droneCombat = { targetID: s.target.itemID, autoAssigned: true };
  s.alert();
  assert.equal((await s.advance()).delayMs, 15_000);
  assert.equal(s.saved().targetID, null);
  assert.equal(s.state().ready, false);
  assert.deepEqual(s.events, ["follow"]);
  s.target.position.x = 25_000;
  assert.equal((await s.advance()).delayMs, 15_000);
  assert.equal(s.state().ready, true);
  assert.deepEqual(s.events, ["follow", "save"]);
});
