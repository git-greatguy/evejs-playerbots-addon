"use strict";

// Keep PI as a background activity instead of letting it dominate autonomous
// work: one in eight pilots collects launches and one in twenty sets up colonies.
const PI_COLLECTION_COHORT_SIZE = 8;
const PI_SETUP_COHORT_SIZE = 20;

function isPiWorkCohort(bot, cohortSize) {
  const characterID = Math.trunc(Number(bot && bot.characterID) || 0);
  const size = Math.trunc(Number(cohortSize) || 0);
  return characterID > 0 && size > 0 && characterID % size === 0;
}

function chooseHeadquartersAssignment({
  hasOwnedStructure,
  structurePackage,
  canCarryPackage,
  purchasePlan,
  logisticsUpgrade,
  marketStationID,
}) {
  if (hasOwnedStructure) return null;
  if (structurePackage && canCarryPackage) {
    return { kind: "structure-deployment", itemID: Number(structurePackage.itemID), headquarters: true };
  }
  if (structurePackage && logisticsUpgrade && Number(marketStationID) > 0) {
    return {
      kind: "upgrade",
      role: "logistics",
      marketStationID: Number(marketStationID),
      headquartersStructureUpgrade: true,
    };
  }
  if (!structurePackage && purchasePlan) {
    return {
      kind: "structure-procurement",
      plan: { ...purchasePlan, headquarters: true },
      headquarters: true,
    };
  }
  return null;
}

function canStartHeadquartersAssignment({ humanControlled, hasManagerAuthority, hasStructurePackage, hasPurchasePlan }) {
  if (humanControlled || !hasManagerAuthority) return false;
  return Boolean(hasStructurePackage || hasPurchasePlan);
}

function headquartersWorkTakesPriority({ hasOwnedStructure, hasManagerAuthority, escortNeeded }) {
  return hasManagerAuthority && !escortNeeded;
}

function headquartersStructureDevFlags(existingFlags, corporationID) {
  const id = Math.trunc(Number(corporationID) || 0);
  return id > 0
    ? { ...(existingFlags && typeof existingFlags === "object" ? existingFlags : {}),
      playerBotCorporationHeadquarters: true,
      playerBotHeadquartersCorporationID: id }
    : { ...(existingFlags && typeof existingFlags === "object" ? existingFlags : {}) };
}

module.exports = {
  PI_COLLECTION_COHORT_SIZE,
  PI_SETUP_COHORT_SIZE,
  isPiWorkCohort,
  chooseHeadquartersAssignment,
  canStartHeadquartersAssignment,
  headquartersWorkTakesPriority,
  headquartersStructureDevFlags,
};
