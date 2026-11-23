"use strict";

function shouldPrioritizeStructureBaseWork({ isCaretaker, humanControlled, emergencyEscort, protectedOperation }) {
  return isCaretaker === true && humanControlled !== true && emergencyEscort !== true && protectedOperation !== true;
}

function shouldPauseForHeadquartersWork({
  hasStructurePackage,
  hasPurchasePlan,
  headquartersWorkCanStart,
  protectedOperation,
}) {
  return headquartersWorkCanStart === true && protectedOperation !== true &&
    (hasStructurePackage === true || hasPurchasePlan === true);
}

function isOperationalHeadquarters(structure, corporationID) {
  const id = Math.trunc(Number(corporationID) || 0);
  return Boolean(structure && id > 0 &&
    structure.devFlags && structure.devFlags.playerBotCorporationHeadquarters === true &&
    Number(structure.devFlags.playerBotHeadquartersCorporationID) === id &&
    Number(structure.ownerCorpID || structure.ownerID) === id &&
    !structure.destroyedAt && !structure.unanchoring);
}

function chooseStructureBaseAssignment({
  operationActive,
  hasStructurePackage,
  canCarryPackage,
  territoryBase,
}) {
  if (operationActive) return null;
  if (hasStructurePackage && canCarryPackage) return { kind: "structure-deployment" };
  if (territoryBase) return { kind: "mine", territorialBase: territoryBase };
  return null;
}

module.exports = {
  isOperationalHeadquarters,
  shouldPrioritizeStructureBaseWork,
  chooseStructureBaseAssignment,
  shouldPauseForHeadquartersWork,
};
