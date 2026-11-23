"use strict";

const { chooseStructureBaseAssignment } = require("./playerBotStructureWorkPolicy");

function getCorporationHeadquartersStructure(corporationID, structures, headquarters) {
  const id = Math.trunc(Number(corporationID) || 0);
  for (const structure of Array.isArray(structures) ? structures : []) {
    const marked = structure && structure.devFlags &&
      structure.devFlags.playerBotCorporationHeadquarters === true &&
      Number(structure.devFlags.playerBotHeadquartersCorporationID) === id;
    const selected = headquarters && !headquarters.error && headquarters.kind === "structure" &&
      Number(headquarters.stationID) === Number(structure && (structure.structureID || structure.itemID));
    if ((marked || selected) && Number(structure && (structure.ownerCorpID || structure.ownerID)) === id &&
        !structure.destroyedAt && !structure.unanchoring) return structure;
  }
  return null;
}

function chooseBaseAssignment({ bot, structureRuntime, hasActiveOperation, hasStructurePackage, canCarryPackage, headquartersStructure }) {
  if (hasActiveOperation) return null;
  if (hasStructurePackage && canCarryPackage) return { kind: "structure-deployment", headquarters: false };
  const base = require("./playerBotTerritoryRuntime").findTerritorialMiningBase(bot);
  return chooseStructureBaseAssignment({
    operationActive: false,
    hasStructurePackage,
    canCarryPackage,
    territoryBase: base || headquartersStructure && {
      stationID: Number(headquartersStructure.structureID || headquartersStructure.itemID),
      systemID: Number(headquartersStructure.solarSystemID),
      structureID: Number(headquartersStructure.structureID || headquartersStructure.itemID),
      baseKind: "corporation-structure",
    },
  });
}

function getHQHaulDepot(corporationID, headquartersStructure, savedHeadquarters) {
  const id = Math.trunc(Number(corporationID) || 0);
  if (id <= 0) return 0;
  if (headquartersStructure) return Number(headquartersStructure.structureID || headquartersStructure.itemID) || 0;
  const resolved = savedHeadquarters && savedHeadquarters(id);
  return resolved && !resolved.error ? Number(resolved.stationID) || 0 : 0;
}

function prepareCorporationDeposit(operation, bot, depotStationID, corporationID) {
  const depot = Math.trunc(Number(depotStationID) || 0);
  if (!operation || !bot || !depot || !["mine", "pi-collect"].includes(operation.kind)) return operation;
  const id = Math.trunc(Number(corporationID || bot.corporationID) || 0);
  if (!id) return operation;
  operation.corporationID = id;
  operation.depositToCorporation = true;
  operation.depositStationID = depot;
  if (operation.kind === "mine") operation.sell = false;
  else {
    operation.marketStationID = depot;
    operation.homeStationID = depot;
    operation.optimizeMarketDestination = false;
    operation.depositOnly = true;
  }
  return operation;
}

module.exports = {
  getCorporationHeadquartersStructure,
  chooseBaseAssignment,
  getHQHaulDepot,
  prepareCorporationDeposit,
};
