"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const missions = require("../integration/server/server/src/services/playerbots/playerBotAgentMissionRuntime");

const courier = {
  objectiveMode: "transport", missionKind: "courier", runtimeStatus: "offered",
  pickupLocation: {locationID: 10}, dropoffLocation: {locationID: 20},
  missionSystemID: 100, missionSequence: 51, missionTitle: "Station delivery",
  cargo: {typeID: 60, quantity: 25},
};

test("agent mission support is limited to authored objectives the bot can verify", () => {
  const site = { objectiveMode: "dungeon", dungeonID: 5, missionSystemID: 100 };
  assert.equal(missions.supportsMission(courier, "transport"), true);
  assert.equal(missions.supportsMission({ ...site, missionKind: "encounter" }, "security"), true);
  assert.equal(missions.supportsMission({ ...site, missionKind: "encounter", cargo: courier.cargo }, "security"), false);
  assert.equal(missions.supportsMission({ ...site, missionKind: "mining", cargo: courier.cargo,
    dropoffLocation: courier.dropoffLocation }, "mining"), true);
  for (const flag of ["placeholder", "importantMission", "epicArcID"]) {
    assert.equal(missions.supportsMission({ ...courier, [flag]: true }, "transport"), false);
  }
  assert.equal(missions.supportsMission({ ...courier, pickupLocation: null }, "transport"), false);
});

function fixture(characterID, { free = 50, owned = true } = {}) {
  const visits = [], messages = [], journal = [];
  const payouts = [], actions = [];
  let record = null, count = 0, dock = 0, successful = false;
  const agent = { agentID: 3, level: 1, stationID: 10, missionKind: "courier" };
  const operation = { characterID, agentID: 3, missionKind: "transport", stage: "agent" };
  const bot = { characterID };
  const native = {
    AGENT_DIALOGUE_BUTTON_REQUEST_MISSION: 1, AGENT_DIALOGUE_BUTTON_ACCEPT: 2, AGENT_DIALOGUE_BUTTON_COMPLETE: 3,
    canUseAgent: () => true,
    getMissionRecord: () => record,
    doAgentAction(_id, _agent, action) {
      actions.push(action);
      record = action === 1 ? { ...courier } : { ...courier, runtimeStatus: "accepted" };
    },
    getMissionTurnIn: () => dock === 20 && count === 25 ? { kind: "complete", agentID: 3, missionSequence: 51 } : null,
    async completeMission(_id, _agent, options) {
      assert.equal(options.share, false);
      assert.equal(dock, 20);
      journal.push({ transactionID: 100, referenceID: 3, entryTypeID: 33, amount: 12.25 });
      journal.push({ transactionID: 101, referenceID: 3, entryTypeID: 34, amount: 4 });
      journal.push({ transactionID: 102, referenceID: 8, entryTypeID: 33, amount: 40 });
      journal.push({ transactionID: 103, referenceID: 3, entryTypeID: 2, amount: 50 });
      record = null;
      successful = true;
      return { success: true };
    },
  };
  const kit = {
    native,
    agents: {getAgentByID: () => agent},
    missionState: { getCharacterStateSnapshot: () => ({
      history: successful ? [{ agentID: 3, missionSequence: 51, runtimeStatus: "completed" }] : [],
    }) },
    settlements: { getPendingMissionRewardSettlement: () => null },
    wallet: { getCharacterWalletJournal: () => journal },
    world: { getStationByID: () => ({solarSystemID: 100}) },
    inventory: {
      getUnitVolume: () => 1,
      getCargoBayFree: () => free,
      countCargo: () => count,
      listHangar: () => [{itemID: 5}],
      loadToCargo(_bot, itemID, quantity) {
        assert.equal(dock, 10);
        assert.equal(itemID, 5);
        count += quantity;
        return { success: true, moved: quantity };
      },
    },
    space: {
      getActorSession: () => ({stationid: dock}),
      previewSystemRoute: () => ({success: true, hops: 3, risk: {}}),
    },
    ownsSession: () => owned,
    async travelToStation(_operation, _bot, target) { dock = target; visits.push(target); return null; },
    record(_operation, message) { messages.push(message); },
    save() {},
    block(_operation, status, message) { messages.push(message); return { done: true, status }; },
    finish(_operation, message) { messages.push(message); return { done: true }; },
    async payCorpShare(_bot, profit, _reason, key) { payouts.push({ profit, key }); return 3; },
  };
  return { operation, kit, actions, visits, messages, payouts, journal,
    run: () => missions.advance(operation, bot, kit),
  };
}

test("courier carries the native item and recovers a single exact journal payout after restart", async () => {
  const pilot = fixture(101);
  assert.equal((await pilot.run()).delayMs, 1_000); // accept
  await pilot.run(); // load
  await pilot.run(); // ready
  await pilot.run(); // settle
  assert.deepEqual(pilot.actions, [1, 2]);
  assert.deepEqual(pilot.visits, [10, 10, 20]);
  assert.equal(pilot.operation.proceeds, 16.25);
  assert.equal(pilot.operation.stage, "share");
  // Simulate a restart between the durable native payout and the stage write.
  pilot.operation.stage = "turn-in";
  delete pilot.operation.proceeds;
  await pilot.run();
  assert.equal((await pilot.run()).done, true);
  assert.deepEqual(pilot.payouts, [{profit: 16.25, key: "agent-mission:3:51"}]);
});

test("oversized courier offers remain unaccepted and another character session cannot act for a bot", async () => {
  const small = fixture(102, {free: 10});
  assert.equal((await small.run()).status, "failed");
  assert.deepEqual(small.actions, [1]);
  const human = fixture(103, {owned: false});
  assert.equal((await human.run()).delayMs, 12_000);
  assert.deepEqual(human.actions, []);
  assert.deepEqual(human.visits, []);
});

test("mining turn-in unloads the specialized hold before asking the agent to settle", async () => {
  const pilot = fixture(104);
  let onboard = 25;
  let hangar = 0;
  Object.assign(pilot.operation, {missionKind: "mining", stage: "turn-in", sequence: 51, dropoffID: 20, missionTitle: "Ore"});
  pilot.kit.agents.getAgentByID = () => ({ agentID: 3, level: 1, stationID: 20, missionKind: "mining" });
  pilot.kit.native.getMissionRecord = () => ({...courier, runtimeStatus: "accepted", missionKind: "mining"});
  pilot.kit.inventory.countCargo = () => onboard;
  pilot.kit.inventory.countHangar = () => hangar;
  pilot.kit.inventory.unloadCargo = () => {
    hangar += onboard;
    onboard = 0;
    return { success: true, unloaded: {60: hangar} };
  };
  pilot.kit.native.getMissionTurnIn = () => {
    assert.equal(hangar, 25);
    assert.equal(onboard, 0);
    return {kind: "complete", agentID: 3, missionSequence: 51};
  };
  await pilot.run();
  assert.equal(pilot.operation.stage, "share");
  assert.equal(pilot.operation.deliveredOre, 25);
});
