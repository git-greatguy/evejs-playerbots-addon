"use strict";

const WAIT = 4_000;
const RETRY = 12_000;
const SEARCH_COOLDOWN = 3 * 60_000;
const FAILURE_COOLDOWN = 30 * 60_000;
const MAX_TRAVEL_JUMPS = 10;
const MAX_STALLED_MS = 4 * 60_000;
const MAX_MISSION_MS = 45 * 60_000;
const MISSION_REWARD_ENTRY_TYPES = new Set([33, 34]);
const SECURITY_KINDS = new Set(["kill", "killmission", "combat", "security", "encounter"]);
const recentAttempts = new Map();
const rejectedAgents = new Map();
const nearbyAgents = new Map();

function kindOfAgent(agent) {
  if (!agent?.stationID || Number(agent.level) !== 1 || agent.importantMission ||
      /storyline|career|epic|research/i.test(String(agent.missionTypeLabel || ""))) return null;
  const kind = String(agent.missionKind || "").toLowerCase();
  if (kind === "mining") return "mining";
  if (kind === "courier" || kind === "distribution") return "transport";
  return require("../agent/missionAuthority").isOrdinarySecurityAgent(agent) ? "security" : null;
}

function setBounded(map, key, value, limit = 16_384) {
  if (!map.has(key) && map.size >= limit) map.delete(map.keys().next().value);
  map.set(key, value);
}

function getAgentsNear(systemID) {
  if (nearbyAgents.has(systemID)) return nearbyAgents.get(systemID);
  const agents = require("../agent/agentAuthority");
  const world = require("../../space/worldData");
  const seen = new Set([systemID]);
  const queue = [[systemID, 0]];
  const result = [];
  for (let i = 0; i < queue.length && i < 48; i++) {
    const [id, hops] = queue[i];
    if (!(Number(world.getSolarSystemByID(id)?.security) >= 0.45)) continue;
    for (const agent of agents.listAgentsBySolarSystemID(id)) {
      const kind = kindOfAgent(agent);
      if (kind) result.push({ agent, kind });
    }
    if (hops < 5) {
      for (const gate of world.getStargatesForSystem(id)) {
        const next = Number(gate.destinationSolarSystemID ||
          world.getStargateByID(gate.destinationID || gate.destinationGateID)?.solarSystemID);
        if (!next || seen.has(next)) continue;
        seen.add(next);
        queue.push([next, hops + 1]);
      }
    }
  }
  setBounded(nearbyAgents, systemID, result, 256);
  return result;
}

function supportsMission(record, kind) {
  if (!record || record.placeholder || record.importantMission || record.epicArcID) return false;
  const cargo = Number(record.cargo?.quantity) > 0 && Number(record.cargo?.typeID) > 0;
  if (kind === "transport") {
    return record.objectiveMode === "transport" && cargo &&
      Number(record.pickupLocation?.locationID) > 0 && Number(record.dropoffLocation?.locationID) > 0;
  }
  if (record.objectiveMode !== "dungeon" || !Number(record.dungeonID) || !Number(record.missionSystemID)) return false;
  const missionKind = String(record.missionKind || "").toLowerCase();
  return kind === "mining" ? missionKind === "mining" && cargo && Number(record.dropoffLocation?.locationID) > 0
    : kind === "security" && SECURITY_KINDS.has(missionKind) && !record.cargo;
}

function getPlan(bot, character, operations, requestedKind = null) {
  if (!bot || !character?.shipID || Number(character.shipTypeID) === 670) return null;
  const now = Date.now();
  const id = Number(bot.characterID);
  if ((recentAttempts.get(id) || 0) > now) return null;
  const choices = bot.specialty === "security" ? ["security"] :
    bot.specialty === "trade" ? (id % 2 ? ["transport", "mining"] : ["mining", "transport"]) :
    bot.specialty === "industry" ? ["mining", "transport"] : [];
  const kinds = requestedKind ? [requestedKind] : choices;
  if (!kinds.length || (!requestedKind && process.env.EVEJS_PLAYER_BOTS_AGENT_MISSIONS_ENABLED === "0")) return null;
  setBounded(recentAttempts, id, now + SEARCH_COOLDOWN + id % 10_000);
  const systemID = Number(character.solarSystemID);
  if (!systemID) return null;
  const candidates = getAgentsNear(systemID);
  if (!candidates.length) return null;
  const native = require("../agent/agentMissionRuntime");
  const missionState = require("../agent/missionRuntimeState");
  const saved = missionState.getCharacterStateSnapshot(id)?.missionsByAgentID || {};
  for (const kind of kinds) {
    if (kind !== "transport" && !operations.hasRoleShipFit(bot, kind === "mining" ? "mining" : "security")) continue;
    let best;
    let bestScore = -1;
    for (const entry of candidates) {
      const { agent } = entry;
      if (entry.kind !== kind || (rejectedAgents.get(`${id}:${agent.agentID}`) || 0) > now) continue;
      const previous = saved[agent.agentID];
      if (previous && !supportsMission(previous, kind)) continue;
      const score = (previous?.runtimeStatus === "accepted" ? 4 : 0) +
        (Number(agent.stationID) === Number(character.stationID) ? 2 : 0) +
        (Number(agent.solarSystemID) === systemID ? 1 : 0);
      if (score <= bestScore || !native.canUseAgent(id, agent)) continue;
      best = { kind, agentID: Number(agent.agentID), stationID: Number(agent.stationID) };
      bestScore = score;
    }
    if (best) return best;
  }
  return null;
}

function currentContext(attached, instanceID, characterID) {
  const { scene, session, entity } = attached;
  const visibility = require("../../space/destiny/identity/interactionScope");
  const scope = visibility.resolveEntityInteractionScope(entity);
  if (!scope?.valid || scope.hasAirScope || scope.hasAbyssalScope ||
      (scope.hasDungeonScope && Number(scope.dungeonInstanceID) !== instanceID)) return { refused: true };
  const tracked = require("../dungeon/dungeonTrackingRuntime").resolveCurrentDungeonForSession(scene, session);
  if (!tracked) return {};
  if (Number(tracked.instance?.instanceID) !== instanceID ||
      Number(tracked.instance?.ownership?.characterID) !== characterID) return { refused: true };
  const gridID = scene.getGridBubbleIDForEntity(entity);
  if (!gridID) return {};
  return { tracked, visibility, local: scene.getEntitiesInGridBubble(gridID) };
}

function safeRoute(space, bot, systemID) {
  const route = space.previewSystemRoute(bot, systemID);
  return route?.success && route.hops <= MAX_TRAVEL_JUMPS &&
    !route.risk?.lowsecSystemIDs?.length && !route.risk?.nullsecSystemIDs?.length;
}

function findRoomTarget(context, ship, operation, distanceTo) {
  let target = null;
  let distance = Infinity;
  for (const entity of context.local) {
    if (!entity?.dungeonEncounterKey || Number(entity.dungeonSiteInstanceID) !== operation.instanceID ||
        entity.destroyed || entity.exploding || entity.cloaked || entity.isCloaked ||
        entity.mode === "WARP" || entity.pendingWarp) continue;
    const hostile = entity.kind === "ship" && entity.nativeNpc === true &&
      entity.isFriendly !== true && entity.airNpeFriendly !== true;
    const structure = entity.dungeonMaterializedKillableStructure === true && entity.runtimeKind === "missionCombatStructure";
    if ((!hostile && !structure) || !context.visibility.canEntitiesInteractLocally(ship, entity)) continue;
    const next = distanceTo(entity.itemID);
    if (!Number.isFinite(next)) continue;
    if (Number(entity.itemID) === operation.targetID) return { target: entity, distance: next };
    if (next >= distance) continue;
    target = entity;
    distance = next;
  }
  return { target, distance };
}

function walkGate(operation, bot, attached, context, state, kit) {
  const { tracked } = context;
  const rawRoom = tracked.roomKey || "room:entry";
  const current = (rawRoom === "room:entry" &&
    require("../dungeon/dungeonAuthority").getTemplateByIDReadOnly(tracked.instance.templateID)?.entryRoomKey) || rawRoom;
  if (operation.currentRoom !== current) {
    operation.currentRoom = current;
    operation.visitedRooms = [...new Set([...(operation.visitedRooms || []), current])].slice(-24);
    operation.roomQuietSince = Date.now();
    operation.lastProgressAt = Date.now();
    kit.save(operation);
    return { delayMs: WAIT };
  }
  if (Date.now() - Number(operation.roomQuietSince) < 7_000) return { delayMs: WAIT };
  let gate;
  for (const candidate of context.local) {
    if (!candidate?.dungeonMaterializedGate || Number(candidate.dungeonSiteInstanceID) !== operation.instanceID) continue;
    const route = tracked.instance.gateStatesByKey?.[candidate.dungeonGateKey];
    const source = candidate.dungeonGateSourceRoomKey || "room:entry";
    const dest = candidate.dungeonGateDestinationRoomKey || route?.destinationRoomKey;
    if (!route || route.state === "locked" || candidate.dungeonGateRequiredItems?.length ||
        Number(candidate.dungeonGateRequiredItemTypeID) > 0 || Number(candidate.dungeonGateKeyLock) > 0 ||
        !dest || source === dest || operation.visitedRooms.includes(dest) ||
        (source !== current && current !== "room:entry")) continue;
    if (gate) return { delayMs: RETRY };
    gate = candidate;
  }
  if (!gate) return { delayMs: WAIT };
  const active = kit.combat.getControlledDrones(attached.scene, attached.entity.itemID);
  if (active.length) {
    kit.drone.commandReturnBay(attached.session, active.map(drone => drone.itemID));
    return { delayMs: WAIT };
  }
  const gap = state.distanceTo(gate.itemID);
  const range = Math.max(500, (Number(gate.gateActivationRange || gate.dungeonGateActivationRangeMeters) || 2_500) - 500);
  if (gap === null) return { delayMs: WAIT };
  if (gap > range) {
    kit.space.approach(bot, gate.itemID, range);
    return { delayMs: WAIT };
  }
  try {
    new (require("../dungeon/keeperService"))().Handle_ActivateAccelerationGate([Number(gate.itemID)], attached.session);
    return { delayMs: RETRY };
  } catch (_) {
    // The gate authority can require a wave, a key or a restricted hull.
    return { delayMs: RETRY };
  }
}

function advanceCombat(operation, bot, attached, context, state, kit) {
  const { target, distance } = findRoomTarget(context, attached.entity, operation, state.distanceTo);
  if (!target) return walkGate(operation, bot, attached, context, state, kit);
  const targetID = Number(target.itemID);
  if (operation.targetID !== targetID) {
    operation.targetID = targetID;
    operation.lastProgressAt = Date.now();
    operation.roomQuietSince = Date.now();
    kit.save(operation);
  }
  const drones = kit.combat.getControlledDrones(attached.scene, attached.entity.itemID);
  const range = Math.max(2_000, Math.min(30_000, operation.controlRange || 20_000) - 1_500);
  if (distance > range) {
    kit.space.approach(bot, targetID, range);
    return { delayMs: WAIT };
  }
  if (drones.some(drone => Number(drone.targetID) === targetID)) return { delayMs: WAIT * 2 };
  const lock = kit.space.lockTarget(bot, targetID);
  if (!lock?.success || lock.data?.pending) {
    if (lock?.errorMsg === "TARGET_OUT_OF_RANGE") kit.space.approach(bot, targetID, 2_500);
    return { delayMs: WAIT };
  }
  const flight = drones.length ? drones : kit.combat.launchDrones(bot, attached.session, attached.scene, attached.entity.itemID).drones;
  if (flight?.length) kit.drone.commandEngage(attached.session, flight.map(drone => drone.itemID), targetID);
  return { delayMs: WAIT };
}

function setStage(operation, kit, stage, message) {
  operation.stage = stage;
  if (message) kit.record(operation, message);
  kit.save(operation);
  return { delayMs: 1_000 };
}

function defer(operation, kit, reason) {
  const until = Date.now() + FAILURE_COOLDOWN;
  setBounded(recentAttempts, operation.characterID, until);
  setBounded(rejectedAgents, `${operation.characterID}:${operation.agentID}`, until);
  operation.retryAfterAtMs = until;
  return kit.block(operation, "failed", reason);
}

function rewardFromJournal(journal, operation) {
  return Math.round(journal.reduce((total, row) =>
    Number(row.transactionID) > Number(operation.journalBefore) && Number(row.referenceID) === operation.agentID &&
    MISSION_REWARD_ENTRY_TYPES.has(Number(row.entryTypeID))
      ? total + (Number(row.amount) || 0) : total, 0) * 100) / 100;
}

async function advance(operation, bot, kit) {
  const { native, agents, world, inventory, space, missionState, wallet } = kit;
  const id = Number(bot.characterID);
  const agent = agents.getAgentByID(operation.agentID);
  if (!agent || kindOfAgent(agent) !== operation.missionKind) return defer(operation, kit, "The mission agent is unavailable.");
  const session = space.getActorSession(bot);
  if (kit.ownsSession && !kit.ownsSession(id, session)) {
    if (!operation.disconnectedAt) {
      operation.disconnectedAt = Date.now();
      kit.save(operation);
    }
    return { delayMs: RETRY };
  }
  if (operation.disconnectedAt) {
    const elapsed = Math.max(0, Date.now() - operation.disconnectedAt);
    if (operation.startedMissionAt) operation.startedMissionAt += elapsed;
    if (operation.lastProgressAt) operation.lastProgressAt += elapsed;
    delete operation.disconnectedAt;
    kit.save(operation);
  }

  if (operation.stage === "share") {
    const share = await kit.payCorpShare(bot, operation.proceeds, `Agent mission ${operation.missionTitle}`,
      `agent-mission:${operation.agentID}:${operation.sequence}`);
    operation.corpShare = share;
    return kit.finish(operation, `${operation.missionTitle} turned in. Native net wallet reward ${operation.proceeds.toFixed(2)} ISK; corporation contribution ${Number(share || 0).toFixed(2)} ISK.`);
  }

  let record = native.getMissionRecord(id, operation.agentID);
  if (operation.stage === "agent") {
    const travel = await kit.travelToStation(operation, bot, Number(agent.stationID));
    if (travel) return travel;
    if (!native.canUseAgent(id, agent)) return defer(operation, kit, "The pilot no longer has access to this agent.");
    if (!record) {
      native.doAgentAction(id, operation.agentID, native.AGENT_DIALOGUE_BUTTON_REQUEST_MISSION, { session });
      record = native.getMissionRecord(id, operation.agentID);
    }
    if (!supportsMission(record, operation.missionKind)) return defer(operation, kit, "The agent has no supported offer for this pilot.");
    const stationID = Number(record.dropoffLocation?.locationID || agent.stationID);
    const station = world.getStationByID(stationID);
    const systemID = Number(record.missionSystemID || station?.solarSystemID);
    const transport = operation.missionKind === "transport";
    const pickup = Number(record.pickupLocation?.locationID);
    const pickupStation = transport && world.getStationByID(pickup);
    if (!station || !safeRoute(space, bot, Number(station.solarSystemID)) || !safeRoute(space, bot, systemID) ||
        (transport && (!pickupStation || !safeRoute(space, bot, Number(pickupStation.solarSystemID))))) {
      return defer(operation, kit, "A station or site is outside the supported high-security mission route.");
    }
    if (transport && record.runtimeStatus === "offered" &&
        inventory.getUnitVolume({ typeID: record.cargo.typeID }) * Number(record.cargo.quantity) > inventory.getCargoBayFree(bot) + 1e-6) {
      return defer(operation, kit, "The courier package does not fit the current ship's cargo bay.");
    }
    if (record.runtimeStatus === "offered") {
      native.doAgentAction(id, operation.agentID, native.AGENT_DIALOGUE_BUTTON_ACCEPT, { session });
      record = native.getMissionRecord(id, operation.agentID);
    }
    if (record?.runtimeStatus !== "accepted" || (!transport && !Number(record.dungeonInstanceID))) {
      return defer(operation, kit, "The native agent could not accept or create the mission.");
    }
    operation.sequence = Number(record.missionSequence);
    operation.instanceID = Number(record.dungeonInstanceID) || 0;
    operation.missionTitle = String(record.missionTitle || "Agent mission").slice(0, 120);
    operation.dropoffID = stationID;
    operation.missionSystemID = systemID;
    if (operation.missionKind === "mining") {
      operation.deliveredOre = inventory.countHangar(bot, stationID, Number(record.cargo.typeID));
    }
    operation.startedMissionAt = Date.now();
    operation.lastProgressAt = Date.now();
    return setStage(operation, kit, transport ? "pickup" : "site", `Accepted ${operation.missionTitle} from agent ${operation.agentID}.`);
  }

  if (operation.stage === "turn-in" && (!record || Number(record.missionSequence) !== operation.sequence)) {
    const history = missionState.getCharacterStateSnapshot(id)?.history || [];
    const finished = history.some(row => Number(row.agentID) === operation.agentID &&
      Number(row.missionSequence) === operation.sequence && row.runtimeStatus === "completed");
    if (finished && Number.isSafeInteger(operation.journalBefore)) {
      const settlementID = `${id}:${operation.sequence}`;
      if (kit.settlements.getPendingMissionRewardSettlement(settlementID)) {
        const recovered = await kit.settlements.settleMissionRewardSettlement(settlementID,
          { finalizeMission: native.finalizeMissionCompletion });
        if (!recovered?.success || recovered.rejected) return { delayMs: RETRY };
      }
      operation.proceeds = Math.max(0, rewardFromJournal(wallet.getCharacterWalletJournal(id), operation));
      return setStage(operation, kit, "share", "Recovered the native completed mission and wallet credits.");
    }
    return defer(operation, kit, "The original mission expired or changed before turn-in.");
  }
  if (!record || Number(record.missionSequence) !== operation.sequence || record.runtimeStatus !== "accepted") {
    return defer(operation, kit, "The original accepted mission is no longer available.");
  }

  if (operation.stage === "withdraw") {
    space.stopMining(bot);
    if (recallDrones(operation, bot, kit)) return { delayMs: WAIT };
    const travel = await kit.travelToStation(operation, bot, Number(agent.stationID));
    return travel || defer(operation, kit, operation.withdrawReason || "The pilot withdrew; the accepted mission remains in its journal.");
  }
  if (operation.stage !== "turn-in" && Date.now() - operation.startedMissionAt >= MAX_MISSION_MS) {
    operation.withdrawReason = "Mission timed out. The accepted mission remains available for later recovery.";
    return setStage(operation, kit, "withdraw", operation.withdrawReason);
  }

  if (operation.stage === "pickup") {
    const typeID = Number(record.cargo.typeID), quantity = Number(record.cargo.quantity);
    if (inventory.countCargo(bot, typeID) >= quantity) return setStage(operation, kit, "turn-in", "The courier cargo is aboard.");
    const pickup = Number(record.pickupLocation.locationID);
    const travel = await kit.travelToStation(operation, bot, pickup);
    if (travel) return travel;
    const remaining = quantity - inventory.countCargo(bot, typeID);
    if (remaining <= 0) return setStage(operation, kit, "turn-in", "The courier cargo is aboard.");
    const item = inventory.listHangar(bot, pickup, typeID)[0];
    if (!item) return defer(operation, kit, "The native courier cargo is missing from the pickup station.");
    const loaded = inventory.loadToCargo(bot, item.itemID, remaining);
    return loaded?.success ? { delayMs: 1_000 } : defer(operation, kit, loaded?.message || "The native cargo transfer was refused.");
  }
  if (operation.stage === "turn-in") {
    if (recallDrones(operation, bot, kit)) return { delayMs: WAIT };
    const travel = await kit.travelToStation(operation, bot, operation.dropoffID);
    if (travel) return travel;
    const settlementID = `${id}:${operation.sequence}`;
    const pending = Number.isSafeInteger(operation.journalBefore) &&
      kit.settlements.getPendingMissionRewardSettlement(settlementID);
    if (operation.missionKind === "mining" && !pending) {
      const typeID = Number(record.cargo.typeID);
      const onboard = inventory.countCargo(bot, typeID);
      // The native turn-in accepts station-hangar stacks and general cargo.
      // A mining hull puts its ore in the specialized hold during extraction.
      if (onboard > 0) {
        const unloaded = inventory.unloadCargo(bot, typeID);
        if (!(Number(unloaded?.unloaded?.[typeID]) > 0)) {
          return defer(operation, kit, "The native inventory service could not unload the mission ore.");
        }
      }
      operation.deliveredOre = inventory.countHangar(bot, operation.dropoffID, typeID);
      if (operation.deliveredOre < Number(record.cargo.quantity)) {
        return setStage(operation, kit, "site", "Stored mined mission ore at the destination before the next trip.");
      }
    }
    const action = native.AGENT_DIALOGUE_BUTTON_COMPLETE;
    const turnIn = native.getMissionTurnIn(id, operation.agentID, action);
    const valid = turnIn?.kind === "complete" && Number(turnIn.missionSequence) === operation.sequence &&
      Number(turnIn.agentID) === operation.agentID;
    if (!valid && !pending && operation.missionKind === "mining" && !operation.miningObjectiveConfirmed) {
      return setStage(operation, kit, "site", "Ore is at the station. Returning to let the mining site verify its objective.");
    }
    if (!valid && !pending) {
      return defer(operation, kit, "The agent would not accept the objective at the destination.");
    }
    if (!Number.isSafeInteger(operation.journalBefore)) {
      operation.journalBefore = wallet.getCharacterWalletJournal(id)
        .reduce((max, row) => Math.max(max, Number(row.transactionID) || 0), 0);
      kit.save(operation);
    }
    const result = await native.completeMission(id, agent, { session, share: false });
    if (!result?.success) return { delayMs: RETRY };
    operation.proceeds = Math.max(0, rewardFromJournal(wallet.getCharacterWalletJournal(id), operation));
    return setStage(operation, kit, "share", "The agent settled the mission through the native reward authority.");
  }

  const travel = await kit.travelToSystem(operation, bot, operation.missionSystemID);
  if (travel) return travel;
  const state = space.getSpaceState(bot);
  if (state.docked) {
    const undock = space.undock(bot, { allowOverCapacityDeparture: true });
    return undock.success ? { delayMs: WAIT } : undock.capacityQueued
      ? { delayMs: RETRY, capacityQueued: true, capacityReason: undock.message }
      : defer(operation, kit, undock.message);
  }
  const attached = space.getActorSpace(bot);
  if (state.busy || attached.entity.pendingWarp) return { delayMs: WAIT };
  if (state.isCapsule || (state.shield < 0.2 && state.armorDamage > 0.35) || state.hullDamage > 0.15) {
    operation.withdrawReason = "The pilot withdrew after losing its ship or reaching its damage safety limit.";
    return setStage(operation, kit, "withdraw", operation.withdrawReason);
  }
  if (operation.missionKind === "security" && native.evaluateMissionProgress(id, record)?.objectiveCompleted) {
    return setStage(operation, kit, "turn-in", "The objective is ready for the agent's hand-in check.");
  }
  const context = currentContext(attached, operation.instanceID, id);
  if (context.refused) return defer(operation, kit, "The ship is outside the authorized mission instance.");
  if (!context.tracked) {
    const result = kit.warpMission(attached.session, operation.agentID);
    if (!result?.success && result?.errorMsg !== "WARP_DISTANCE_TOO_CLOSE" &&
        Date.now() - operation.lastProgressAt > MAX_STALLED_MS) {
      operation.withdrawReason = "The mission site could not be reached.";
      return setStage(operation, kit, "withdraw", operation.withdrawReason);
    }
    return { delayMs: RETRY };
  }
  if (operation.stage === "site") {
    operation.lastProgressAt = Date.now();
    operation.currentRoom = null;
    operation.visitedRooms = [];
    return setStage(operation, kit, "objective", "Arrived in the authorized mission site.");
  }
  if (Date.now() - operation.lastProgressAt > MAX_STALLED_MS) {
    operation.withdrawReason = "The mission made no progress. The pilot is returning to its agent.";
    return setStage(operation, kit, "withdraw", operation.withdrawReason);
  }
  if (operation.missionKind === "security") return advanceCombat(operation, bot, attached, context, state, kit);
  const cargo = Number(record.cargo.typeID);
  const quantity = inventory.countCargo(bot, cargo);
  const instance = context.tracked.instance;
  const confirmed = instance.lifecycleState === "completed" || instance.objectiveState?.state === "completed" ||
    Number(instance.objectiveSatisfiedAtMs) > 0 || Number(instance.objectiveState?.completedAtMs) > 0;
  const hasQuota = quantity + (Number(operation.deliveredOre) || 0) >= Number(record.cargo.quantity);
  if (hasQuota) {
    const ready = confirmed || require("../dungeon/dungeonUniverseSiteService")
      .reconcileMissionMiningObjective(attached.scene, operation.instanceID, id);
    if (ready) {
      operation.miningObjectiveConfirmed = true;
      space.stopMining(bot);
      return setStage(operation, kit, "turn-in", "The mission ore is mined. Returning to the hand-in station.");
    }
  }
  if (quantity !== operation.minedInHold) {
    operation.minedInHold = quantity;
    operation.lastProgressAt = Date.now();
    kit.save(operation);
  }
  if (quantity > 0 && inventory.getCargoCapacity(bot).free < inventory.getUnitVolume({ typeID: cargo })) {
    space.stopMining(bot);
    return setStage(operation, kit, "turn-in", "The hold is full. Returning to deliver the mission ore.");
  }
  const result = await space.mineNearestAsteroid(bot, kit.getMiningModules(bot), 9_000, 0, {
    missionInstanceID: operation.instanceID, yieldTypeID: cargo,
  });
  return result?.noOre ? walkGate(operation, bot, attached, context, state, kit) : { delayMs: WAIT * 2 };
}

function recallDrones(operation, bot, kit) {
  if (operation.missionKind !== "security") return false;
  const state = kit.space.getSpaceState(bot);
  if (state.docked) return false;
  if (state.busy) return true;
  const attached = kit.space.getActorSpace(bot);
  const drones = kit.combat.getControlledDrones(attached.scene, attached.entity.itemID);
  if (!drones.length || state.hullDamage > 0.15 || state.isCapsule) return false;
  if (!operation.recallStartedAt) {
    operation.recallStartedAt = Date.now();
    kit.save(operation);
  }
  if (Date.now() - operation.recallStartedAt > 60_000) return false;
  const waiting = drones.filter(drone => drone.droneCommand !== kit.drone.DRONE_COMMAND_RETURN_BAY);
  if (waiting.length) kit.drone.commandReturnBay(attached.session, waiting.map(drone => drone.itemID));
  return true;
}

function warpMission(session, agentID) {
  const AgentMgr = require("../agent/agentMgrService");
  const prototype = AgentMgr.prototype;
  return prototype._warpToMissionLocation.call({
    _resolveBoundAgentID: () => agentID,
    _materializeMissionSiteForWarp: prototype._materializeMissionSiteForWarp,
  }, ["dungeon", 0, 0, false, 0], session);
}

module.exports = { getPlan, supportsMission, advance, warpMission, rewardFromJournal };
