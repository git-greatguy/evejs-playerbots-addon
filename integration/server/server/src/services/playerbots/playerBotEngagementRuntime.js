"use strict";

// Called only at the ENGAGEMENT-SEAM markers. Set EVEJS_PLAYER_BOTS_ENGAGEMENT=0
// to use the original host paths, including the independent surface-distance fix.
const REQUIRED = {
  space: ["getActorSpace", "getSpaceState", "approach", "warp", "lockTarget"],
  combat: ["getControlledDrones", "launchDrones", "estimateEffectiveHitPoints"],
  drone: ["commandEngage", "commandReturnBay"],
  telemetry: ["recordWork"],
  logger: ["info", "debug", "warn"],
};

function hostDependencies(logger) {
  return {
    space: require("./playerBotSpaceRuntime"),
    combat: require("./playerBotCombatRuntime"),
    drone: require("../drone/droneRuntime"),
    telemetry: require("./playerBotPerformanceTelemetry").getTelemetry(),
    logger,
  };
}

function rangesFor(fit, entity, rangePolicy, lock) {
  let engageRange, approachTo;
  if (rangePolicy === "legacy") {
    const effective = Math.max(1_000, Math.min(15_000,
      Number(fit.droneAttackRange) || 15_000, Number(fit.droneControlRange) || 15_000));
    engageRange = effective * 0.8;
    approachTo = Math.min(15_000, effective * 0.7);
  } else {
    engageRange = (Number(fit.droneControlRange) || 20_000) * 0.8;
    approachTo = Math.max(1_000, Math.min(15_000, engageRange * 0.7));
  }
  let lockCap = Infinity;
  if (lock) {
    lockCap = (Number(entity.maxTargetRange) || engageRange) * 0.8;
    engageRange = Math.min(engageRange, lockCap);
    approachTo = Math.min(approachTo, engageRange * 0.9);
  }
  if (!(approachTo < engageRange)) approachTo = engageRange * 0.7;
  const commandRange = Math.max(1_000, Math.trunc(approachTo));
  const feasible = commandRange < lockCap;
  const floorAdjusted = feasible && commandRange >= engageRange;
  if (floorAdjusted) engageRange = Math.min(commandRange + 250, lockCap);
  return { engageRange, approachTo, commandRange, lockCap, feasible, floorAdjusted };
}

function readDrones(input, deps) {
  return input.fleetDrones ? input.fleetDrones.read()
    : deps.combat.getControlledDrones(input.attached.scene, input.attached.entity.itemID);
}

function report(status, delayMs, reason = null, detail = null) {
  return { status, reason, justEngaged: false, delayMs, detail };
}

function assignedDroneCount(drones, targetID) {
  return drones.filter((drone) => Number(drone.targetID) === targetID).length;
}

function confirmedEngagement(input, drones) {
  const droneCount = assignedDroneCount(drones, Number(input.target.itemID));
  if (!droneCount) return null;
  return { ...report("engaging", input.cadence.engagedMs), justEngaged: true, droneCount };
}

function engageWithDrones(input, deps, step) {
  const { bot, attached, target, fit, cadence } = input;
  const { scene, entity, session } = attached;
  const targetID = Number(target && target.itemID);
  if (!targetID || !scene.getEntityByID(targetID)) return report("target-lost", cadence.closingMs);
  let drones = input.drones;
  function launch() {
    step.command = "launch";
    const result = input.fleetDrones ? input.fleetDrones.launch()
      : deps.combat.launchDrones(bot, session, scene, entity.itemID, input.operation.combatDroneTypeID);
    if (!result.success) return report("no-weapon", cadence.closingMs, null, result.message);
    drones = result.drones;
    return null;
  }
  if (!input.lock && !drones.length) {
    const failure = launch();
    if (failure) return failure;
  }

  const range = rangesFor(fit, entity, input.rangePolicy, input.lock);
  if (!range.feasible) return report("refused", cadence.closingMs, "lock-range-infeasible",
    `commandRange ${range.commandRange} >= lockCap ${Math.trunc(range.lockCap)}`);
  if (range.floorAdjusted) step.noteFloor();
  const distance = input.distance === undefined ? input.state.distanceTo(targetID) : input.distance;
  if (!Number.isFinite(distance)) return report("target-lost", cadence.closingMs);
  const space = input.space || deps.space;
  if (distance > range.engageRange) {
    const following = entity.mode === "FOLLOW" && Number(entity.targetEntityID) === targetID &&
      Math.abs((Number(entity.followRange) || 0) - range.commandRange) <= 1;
    if (!following) {
      step.command = "approach";
      const moved = space.approach(bot, targetID, range.commandRange);
      if (!moved.success && moved.message !== "ThrottleGeneric") {
        return report("refused", cadence.closingMs, "approach-failed", moved.message);
      }
    }
    const closing = report("closing", cadence.closingMs);
    const controlRange = Number(fit.droneControlRange);
    if (!input.lock && Number.isFinite(controlRange) && distance <= controlRange) {
      // Native retaliation can precede the hull reaching its own firing threshold.
      closing.droneCount = assignedDroneCount(drones, targetID);
    }
    return closing;
  }

  if (input.lock) {
    const locked = typeof scene.getTargetsForEntity === "function" &&
      scene.getTargetsForEntity(entity).some((id) => Number(id) === targetID);
    if (!locked) {
      step.command = "lock";
      const result = space.lockTarget(bot, targetID);
      return result.success ? report("closing", cadence.closingMs, "lock-pending")
        : report("closing", cadence.closingMs, "lock-refused", result.errorMsg || result.message);
    }
    if (!drones.length) {
      const failure = launch();
      if (failure) return failure;
    }
  }
  if (drones.some((drone) => Number(drone.targetID) === targetID)) return report("engaging", cadence.engagedMs);
  const droneIDs = drones.map((drone) => Number(drone.itemID));
  if (input.beforeEngage) {
    try { input.beforeEngage(); }
    catch (error) { step.noteHook(error); }
  }
  step.command = "engage";
  const response = (input.drone || deps.drone).commandEngage(session, droneIDs, targetID);
  const confirmed = confirmedEngagement(input, readDrones(input, deps));
  if (confirmed) return confirmed;
  const entries = JSON.stringify(response && response.entries || [], (_, value) =>
    typeof value === "bigint" ? String(value) : value);
  return report("refused", cadence.engagedMs, "engage-refused", entries.slice(0, 180));
}

function createRuntime({ dependencies, now = Date.now, env = process.env } = {}) {
  let deps, logger, unavailable = false, tripped = false, errors = 0, floorLogged = false;
  let errorTimes = [];
  const seamsTaken = { A: 0, B: 0 };
  const recentLogs = new Map();

  function log(level, message) {
    try { (logger || console)[level](`[PB-ENGAGE] ${message}`); }
    catch (_) { /* Logging must not change a combat order. */ }
  }
  function warnOnce(message, key = message) {
    const time = now();
    for (const [loggedKey, expires] of recentLogs) if (expires <= time) recentLogs.delete(loggedKey);
    if (recentLogs.has(key)) return;
    recentLogs.set(key, time + 60_000);
    log("warn", message);
  }
  function noteError(seam, error) {
    const time = now();
    errors++;
    errorTimes = errorTimes.filter((prior) => prior > time - 600_000);
    errorTimes.push(time);
    const message = String(error?.message ?? error);
    warnOnce(`seam ${seam}: ${message}`, `module: ${message}`);
    if (!tripped && errorTimes.length >= 20) {
      tripped = true;
      log("info", "Circuit opened after 20 errors in ten minutes; disabled until restart.");
    }
  }
  function enabled() {
    if (env.EVEJS_PLAYER_BOTS_ENGAGEMENT === "0" || unavailable || tripped) return false;
    if (deps) return true;
    try {
      logger = dependencies ? dependencies.logger : require("../../utils/logger");
      const candidate = dependencies || hostDependencies(logger);
      for (const [group, names] of Object.entries(REQUIRED)) {
        for (const name of names) {
          if (typeof candidate[group]?.[name] !== "function") throw new Error(`${group}.${name} missing`);
        }
      }
      deps = candidate;
      return true;
    } catch (error) {
      unavailable = true;
      if (typeof logger?.info !== "function") logger = console;
      log("info", `Host dependency unavailable; using host paths. ${error?.message ?? error}`);
      return false;
    }
  }
  function handles(seam, operation) {
    const applicable = seam === "A" ? operation?.kind === "combat" && !operation.siteInstanceID
      : seam === "B" && operation?.kind === "fleet-attack";
    return applicable && enabled();
  }
  function noteFloor() {
    if (floorLogged) return;
    floorLogged = true;
    log("debug", "range-floor: raised the engagement gate above the minimum follow range.");
  }
  function noteHook(error) { warnOnce(`beforeEngage: ${error?.message ?? error}`); }

  function run(seam, input) {
    if (!handles(seam, input.operation)) return null;
    const started = performance.now();
    const step = { command: null, noteFloor, noteHook };
    let result;
    try {
      result = engageWithDrones(input, deps, step);
    } catch (error) {
      noteError(seam, error);
      if (!step.command) return null;
      // A synchronous authority can throw after changing world state. Returning null here
      // would immediately replay the same order in the original host block.
      if (step.command === "engage") {
        try {
          result = confirmedEngagement(input, readDrones(input, deps));
        } catch (_) { /* The next host step revalidates the target and drones. */ }
      }
      result ||= report("closing", input.cadence.closingMs);
    } finally {
      try { deps.telemetry.recordWork(`engagement.seam${seam}`, performance.now() - started); }
      catch (error) { warnOnce(`telemetry: ${error?.message ?? error}`); }
    }
    if (++seamsTaken[seam] === 1) log("info", `First engagement at seam ${seam}.`);
    log("debug", `seam ${seam}: ${result.status}${result.reason ? " " + result.reason : ""}`);
    return result;
  }

  return {
    handles,
    runSeamA: (input) => run("A", input),
    runSeamB: (input) => run("B", input),
    status: () => ({ enabled: enabled(), tripped, errors, seamsTaken: { ...seamsTaken } }),
  };
}

module.exports = { ...createRuntime(), _testing: { createRuntime, rangesFor } };
