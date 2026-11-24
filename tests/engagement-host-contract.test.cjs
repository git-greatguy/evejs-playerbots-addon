"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function checkMethods(object, source, names) {
  for (const name of names) {
    assert.equal(typeof object?.[name], "function", source + "." + name);
  }
}

// Needs a full EveJS checkout with the add-on installed; skipped without one.
test("the supported combined checkout exposes the engagement host contract", {
  skip: process.env.EVEJS_SOURCE_ROOT ? false
    : "set EVEJS_SOURCE_ROOT to a combined EveJS/Playerbots checkout to run this",
}, () => {
  const root = process.env.EVEJS_SOURCE_ROOT;
  const src = path.resolve(root, "server/src");
  const load = (relative) => require(path.join(src, relative));
  const space = load("services/playerbots/playerBotSpaceRuntime");
  const combat = load("services/playerbots/playerBotCombatRuntime");
  const drones = load("services/drone/droneRuntime");
  checkMethods(space, "playerBotSpaceRuntime", ["getActorSpace", "getSpaceState", "approach", "warp", "lockTarget"]);
  checkMethods(combat, "playerBotCombatRuntime", ["getControlledDrones", "launchDrones", "estimateEffectiveHitPoints"]);
  checkMethods(drones, "droneRuntime", ["commandEngage", "commandReturnBay"]);

  const telemetry = load("services/playerbots/playerBotPerformanceTelemetry");
  checkMethods(telemetry, "playerBotPerformanceTelemetry", ["getTelemetry"]);
  checkMethods(telemetry.getTelemetry(), "getTelemetry()", ["recordWork"]);
  checkMethods(load("utils/logger"), "logger", ["info", "warn", "debug"]);

  // Keep the upgrade inventory complete. These capabilities exist in the supported host;
  // the runtime does not use orbit or depend on the optional load/scene policies in stage 1.
  const shipService = load("services/ship/beyonceService");
  checkMethods(shipService.prototype, "BeyonceService.prototype", ["Handle_CmdOrbit"]);
  const loadController = load("services/playerbots/playerBotLoadController");
  checkMethods(loadController, "playerBotLoadController", ["getPlayerBotLoadController"]);
  checkMethods(loadController.getPlayerBotLoadController(), "getPlayerBotLoadController()", ["shouldPauseLowPriorityWork"]);
  const scenePolicy = load("services/playerbots/playerBotUnobservedScenePolicy");
  checkMethods(scenePolicy, "playerBotUnobservedScenePolicy", ["sceneHasHumanPilot"]);
});
