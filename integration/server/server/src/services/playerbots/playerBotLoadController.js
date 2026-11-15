"use strict";

// Gives a human login priority over playerbot work. While the first human
// client of an otherwise bot-only server is connecting, new add-on cycles and
// roster seeding wait; a connection that neither logs in nor closes is let go
// after a minute. Roster seeding also waits while the event loop stays slow.
// Contributed by Luna.

const LOGIN_CAPACITY_FACTOR = 0.5;
const PLAYER_CONNECTION_TIMEOUT_MS = 60_000;
const SEVERE_EVENT_LOOP_ENTER_MS = 1_500;
const SEVERE_EVENT_LOOP_CLEAR_MS = 750;
const SEVERE_EVENT_LOOP_SAMPLES = 3;

function boundedCount(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function createPlayerBotLoadController(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const getBaseCapacity = options.getBaseCapacity || (() =>
    require("./playerBotConnectionScheduleRuntime").getMaxConnected());
  const getHumanSessionCount = options.getHumanSessionCount || (() => {
    const sessions = require("../chat/sessionRegistry").getSessions();
    const characters = new Set();
    for (const session of sessions || []) {
      if (!session || session._playerBotActor === true) continue;
      const id = Math.trunc(Number(session.characterID || session.charID || session.charid) || 0);
      if (id > 0) characters.add(id);
    }
    return characters.size;
  });
  const connectionTimeoutMs = Math.max(1, Number(options.connectionTimeoutMs) || PLAYER_CONNECTION_TIMEOUT_MS);
  let onCapacityChange = typeof options.onCapacityChange === "function" ? options.onCapacityChange : null;
  let pendingAttempts = 0;
  let eventLoopP95Ms = 0;
  let processCpuPercent = 0;
  let currentCapacity = null;
  let severeDelaySamples = 0;
  let recoveredDelaySamples = 0;
  let severeWorkPause = false;
  let lastNotifiedCapacity = null;

  function compute() {
    const baseCapacity = Math.max(1, boundedCount(getBaseCapacity()) || 1);
    const humans = boundedCount(getHumanSessionCount());
    const connecting = pendingAttempts > 0;
    const targetCapacity = connecting
      ? Math.max(1, Math.min(baseCapacity, Math.floor(baseCapacity * LOGIN_CAPACITY_FACTOR)))
      : baseCapacity;
    const previousCapacity = currentCapacity;
    currentCapacity = targetCapacity;
    const reason = connecting ? "player-first-connect" : severeWorkPause ? "sustained-event-loop-delay" : "normal";
    return {
      mode: connecting ? "player-connecting" : severeWorkPause ? "severe-load-pause" : humans ? "human-player-online" : "normal",
      pendingPlayerConnections: pendingAttempts,
      humanPlayersOnline: humans,
      baseBotCapacity: baseCapacity,
      botCapacity: currentCapacity,
      eventLoopP95Ms: Math.round(eventLoopP95Ms * 10) / 10,
      processCpuPercent: Math.round(processCpuPercent * 10) / 10,
      pauseLowPriorityWork: connecting || severeWorkPause,
      pauseAddonCycles: connecting,
      reason,
      _capacityChanged: previousCapacity !== currentCapacity,
    };
  }

  function notifyCapacityChange(previous) {
    const status = compute();
    const capacityChanged = previous !== status.botCapacity || lastNotifiedCapacity !== status.botCapacity;
    if (capacityChanged && onCapacityChange) {
      lastNotifiedCapacity = status.botCapacity;
      const callback = onCapacityChange;
      setImmediate(() => {
        try { callback(getStatus()); } catch (error) {
          try { require("../../utils/logger").warn(`[PlayerBots] Load rebalance failed: ${error.message}`); } catch (_) {}
        }
      });
    }
    delete status._capacityChanged;
    return status;
  }

  function beginPlayerConnection() {
    // Once a real player session is already established, subsequent TCP connects
    // (health probes, reconnects, or parallel client sockets) must not shed bots.
    if (boundedCount(getHumanSessionCount()) > 0) {
      let finished = false;
      const noOp = () => { finished = true; };
      return Object.freeze({ complete: noOp, release: noOp, get finished() { return finished; } });
    }
    const before = compute().botCapacity;
    pendingAttempts += 1;
    notifyCapacityChange(before);
    let finished = false;
    let timer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      const previous = compute().botCapacity;
      pendingAttempts = Math.max(0, pendingAttempts - 1);
      notifyCapacityChange(previous);
    };
    timer = setTimeout(finish, connectionTimeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    return Object.freeze({ complete: finish, release: finish });
  }

  function updateLoad(sample = {}) {
    const previous = compute().botCapacity;
    eventLoopP95Ms = Math.max(0, Number(sample.eventLoopP95Ms) || 0);
    processCpuPercent = Math.max(0, Number(sample.processCpuPercent) || 0);
    if (eventLoopP95Ms >= SEVERE_EVENT_LOOP_ENTER_MS) {
      severeDelaySamples += 1;
      recoveredDelaySamples = 0;
      if (severeDelaySamples >= SEVERE_EVENT_LOOP_SAMPLES) severeWorkPause = true;
    } else if (eventLoopP95Ms <= SEVERE_EVENT_LOOP_CLEAR_MS) {
      recoveredDelaySamples += 1;
      severeDelaySamples = 0;
      if (recoveredDelaySamples >= SEVERE_EVENT_LOOP_SAMPLES) severeWorkPause = false;
    } else {
      severeDelaySamples = 0;
      recoveredDelaySamples = 0;
    }
    return notifyCapacityChange(previous);
  }

  function getStatus() {
    const status = compute();
    delete status._capacityChanged;
    return status;
  }

  return Object.freeze({
    beginPlayerConnection,
    getStatus,
    shouldPauseLowPriorityWork() { return getStatus().pauseLowPriorityWork; },
    shouldPauseAddonCycles() { return getStatus().pauseAddonCycles; },
    setOnCapacityChange(callback) {
      onCapacityChange = typeof callback === "function" ? callback : null;
      lastNotifiedCapacity = null;
      return getStatus();
    },
    updateLoad,
    _testing: {
      SEVERE_EVENT_LOOP_CLEAR_MS,
      SEVERE_EVENT_LOOP_ENTER_MS,
      SEVERE_EVENT_LOOP_SAMPLES,
      get severeDelaySamples() { return severeDelaySamples; },
    },
  });
}

let sharedController = null;
function getPlayerBotLoadController() {
  if (!sharedController) sharedController = createPlayerBotLoadController();
  return sharedController;
}

module.exports = {
  LOGIN_CAPACITY_FACTOR,
  PLAYER_CONNECTION_TIMEOUT_MS,
  SEVERE_EVENT_LOOP_CLEAR_MS,
  SEVERE_EVENT_LOOP_ENTER_MS,
  SEVERE_EVENT_LOOP_SAMPLES,
  createPlayerBotLoadController,
  getPlayerBotLoadController,
};
