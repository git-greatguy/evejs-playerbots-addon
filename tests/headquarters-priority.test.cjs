"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PI_COLLECTION_COHORT_SIZE,
  PI_SETUP_COHORT_SIZE,
  isPiWorkCohort,
  chooseHeadquartersAssignment,
  canStartHeadquartersAssignment,
  headquartersWorkTakesPriority,
  headquartersStructureDevFlags,
} = require("../integration/server/server/src/services/playerbots/playerBotPiWorkPolicy");
const { generateHeadquartersName, FICTIONAL_CITIES, STATION_NAMES } = require("../integration/server/server/src/services/playerbots/playerBotHeadquartersNameRuntime");
const { shouldPrioritizeStructureBaseWork, isOperationalHeadquarters } = require("../integration/server/server/src/services/playerbots/playerBotStructureWorkPolicy");
const { getCorporationHeadquartersStructure, getHQHaulDepot, prepareCorporationDeposit } = require("../integration/server/server/src/services/playerbots/playerBotStructurePriorityRuntime");

test("PI cohorts are stable and cover only the configured fraction", () => {
  const bots = Array.from({ length: 1_000 }, (_, index) => ({ characterID: index + 1 }));
  const collectionBots = bots.filter((bot) => isPiWorkCohort(bot, PI_COLLECTION_COHORT_SIZE));
  const setupBots = bots.filter((bot) => isPiWorkCohort(bot, PI_SETUP_COHORT_SIZE));

  assert.equal(collectionBots.length, 1_000 / PI_COLLECTION_COHORT_SIZE);
  assert.equal(setupBots.length, 1_000 / PI_SETUP_COHORT_SIZE);
  assert.ok(collectionBots.every((bot) => bot.characterID % PI_COLLECTION_COHORT_SIZE === 0));
  assert.ok(setupBots.every((bot) => bot.characterID % PI_SETUP_COHORT_SIZE === 0));
  assert.equal(isPiWorkCohort({ characterID: 8 }, PI_COLLECTION_COHORT_SIZE), true);
  assert.equal(isPiWorkCohort({ characterID: 0 }, 0), false);
  assert.equal(isPiWorkCohort({ characterID: 9 }, PI_COLLECTION_COHORT_SIZE), false);
});

test("PI cohorts reject missing, invalid, and nonpositive character IDs", () => {
  for (const bot of [null, {}, { characterID: 0 }, { characterID: -8 }, { characterID: "nope" }]) {
    assert.equal(isPiWorkCohort(bot, PI_COLLECTION_COHORT_SIZE), false);
  }
});

test("headquarters assignment prioritizes deployment and procurement when a corp has no structure", () => {
  assert.deepEqual(chooseHeadquartersAssignment({
    hasOwnedStructure: false,
    structurePackage: { itemID: 123 },
    canCarryPackage: true,
  }), { kind: "structure-deployment", itemID: 123, headquarters: true });
  assert.deepEqual(chooseHeadquartersAssignment({
    hasOwnedStructure: false,
    purchasePlan: { typeID: 35832 },
  }), {
    kind: "structure-procurement",
    plan: { typeID: 35832, headquarters: true },
    headquarters: true,
  });
  assert.equal(chooseHeadquartersAssignment({
    hasOwnedStructure: true,
    purchasePlan: { typeID: 35832 },
  }), null);
});

test("headquarters work respects human control, structure authority, and escort priority", () => {
  assert.equal(canStartHeadquartersAssignment({
    humanControlled: false,
    hasManagerAuthority: true,
    hasPurchasePlan: true,
  }), true);
  assert.equal(canStartHeadquartersAssignment({
    humanControlled: true,
    hasManagerAuthority: true,
    hasPurchasePlan: true,
  }), false);
  assert.equal(canStartHeadquartersAssignment({
    humanControlled: false,
    hasManagerAuthority: false,
    hasPurchasePlan: true,
  }), false);
  assert.equal(headquartersWorkTakesPriority({
    hasOwnedStructure: false,
    hasManagerAuthority: true,
    escortNeeded: false,
  }), true);
  assert.equal(headquartersWorkTakesPriority({
    hasOwnedStructure: false,
    hasManagerAuthority: true,
    escortNeeded: true,
  }), false);
  assert.equal(headquartersWorkTakesPriority({
    hasOwnedStructure: true,
    hasManagerAuthority: true,
    escortNeeded: false,
  }), true);
});

test("corporation headquarters marker preserves existing structure metadata", () => {
  assert.deepEqual(headquartersStructureDevFlags({ existing: "value" }, 42), {
    existing: "value",
    playerBotCorporationHeadquarters: true,
    playerBotHeadquartersCorporationID: 42,
  });
  assert.deepEqual(headquartersStructureDevFlags({ existing: "value" }, 0), { existing: "value" });
});

test("headquarters names are randomized, recognizable, unique, and corporation-specific", () => {
  let value = 0;
  const random = () => ((value += 0.271) % 1);
  const names = new Set(Array.from({ length: 20 }, () => generateHeadquartersName({
    corporationName: "Orion Syndicate",
    random,
  })));
  assert.ok(names.size > 1);
  for (const name of names) {
    assert.match(name, /Orion Syndicate$/);
    assert.ok(FICTIONAL_CITIES.some((city) => name.startsWith(city)));
    assert.ok(STATION_NAMES.some((station) => name.includes(station)));
  }
  let attempts = 0;
  const unique = generateHeadquartersName({
    random: () => 0,
    isAvailable: () => (++attempts) >= 3,
  });
  assert.ok(unique.length > 0);
  assert.equal(attempts, 3);
});

test("the structure caretaker stays prioritized after HQ construction", () => {
  assert.equal(shouldPrioritizeStructureBaseWork({ isCaretaker: true }), true);
  assert.equal(shouldPrioritizeStructureBaseWork({ isCaretaker: false }), false);
  assert.equal(shouldPrioritizeStructureBaseWork({ isCaretaker: true, humanControlled: true }), false);
  assert.equal(isOperationalHeadquarters({
    ownerCorpID: 42,
    devFlags: { playerBotCorporationHeadquarters: true, playerBotHeadquartersCorporationID: 42 },
  }, 42), true);
  assert.equal(isOperationalHeadquarters({
    ownerCorpID: 42,
    destroyedAt: "gone",
    devFlags: { playerBotCorporationHeadquarters: true, playerBotHeadquartersCorporationID: 42 },
  }, 42), false);
});

test("marked Upwell HQ is selected and used as the hauling depot", () => {
  const structure = {
    structureID: 1001,
    ownerCorpID: 42,
    solarSystemID: 30000142,
    devFlags: { playerBotCorporationHeadquarters: true, playerBotHeadquartersCorporationID: 42 },
  };
  assert.equal(getCorporationHeadquartersStructure(42, [structure], null), structure);
  assert.equal(getCorporationHeadquartersStructure(7, [structure], null), null);
  assert.equal(getHQHaulDepot(42, structure, () => 9001), 1001);
  assert.equal(getHQHaulDepot(42, null, () => ({ stationID: 9001 })), 9001);
  const miner = prepareCorporationDeposit({ kind: "mine", sell: true }, { characterID: 7, corporationID: 42 }, 1001);
  assert.equal(miner.sell, false);
  assert.equal(miner.depositToCorporation, true);
  assert.equal(miner.depositStationID, 1001);
  assert.equal(miner.corporationID, 42);
  const extractor = prepareCorporationDeposit({ kind: "pi-collect" }, { characterID: 7, corporationID: 42 }, 1001);
  assert.equal(extractor.homeStationID, 1001);
  assert.equal(extractor.marketStationID, 1001);
  assert.equal(extractor.depositOnly, true);
});

test("structure upkeep is assigned before the caretaker's HQ mining loop", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve(
    "../integration/server/server/src/services/playerbots/playerBotDirectorRuntime.js"), "utf8");
  const start = source.indexOf("let assignment = escortAssignment || (coreInstallPlan");
  const chain = source.slice(start, source.indexOf(";", start));
  assert.ok(start > 0);
  assert.ok(chain.indexOf("structureMaintenanceAssignment") < chain.indexOf("localHQMiningAssignment"));
  assert.ok(chain.indexOf("structureMaintenanceAssignment") < chain.indexOf("prioritizeHeadquarters"));
});

test("structure maintenance keeps every owned structure and only ranks the HQ first", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve(
    "../integration/server/server/src/services/playerbots/playerBotStructureRuntime.js"), "utf8");
  assert.ok(!source.includes(".filter((structure) => isCorporationHeadquartersStructure(structure, corporationID))"));
  assert.ok(source.includes("const headquartersFirst = Number(right.headquarters) - Number(left.headquarters);"));
});
