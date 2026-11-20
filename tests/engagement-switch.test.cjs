"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntime } = require(
  "../integration/server/server/src/services/playerbots/playerBotEngagementRuntime",
)._testing;

function fixture(env = {}) {
  let now = 1_000_000;
  function unused() {}
  const dependencies = {
    space: {
      getActorSpace: unused, getSpaceState: unused, approach: unused,
      warp: unused, lockTarget: unused,
    },
    combat: { getControlledDrones: unused, launchDrones: unused, estimateEffectiveHitPoints: unused },
    drone: { commandEngage: unused, commandReturnBay: unused },
    telemetry: { recordWork: unused },
    logger: { info: unused, debug: unused, warn: unused },
  };
  const runtime = createRuntime({ dependencies, now: () => now, env });
  const bot = { characterID: 12 };
  const operations = { A: { kind: "combat" }, B: { kind: "fleet-attack" } };
  const input = {
    bot,
    attached: {
      entity: { itemID: 1 }, session: {},
      scene: { getEntityByID() { throw new Error("scene lookup failed"); } },
    },
    target: { itemID: 2 }, state: { distanceTo: () => 20 }, fit: {},
    drones: [{ itemID: 3, targetID: 0 }], rangePolicy: "control", stance: "committed",
    cadence: { closingMs: 10_000, engagedMs: 10_000 },
  };
  return {
    runtime,
    handles: (seam) => runtime.handles(seam, operations[seam], bot),
    fail(seam) {
      const step = { ...input, operation: operations[seam], lock: seam === "B" };
      return seam === "A" ? runtime.runSeamA(step) : runtime.runSeamB(step);
    },
    advance(ms) { now += ms; },
  };
}

test("1. The master switch disables both seams", () => {
  const s = fixture({ EVEJS_PLAYER_BOTS_ENGAGEMENT: "0" });
  assert.equal(s.handles("A"), false);
  assert.equal(s.handles("B"), false);
  assert.equal(s.runtime.status().enabled, false);
});

test("2. Unexpected exceptions yield to the host and count once per invocation", () => {
  const s = fixture();
  assert.equal(s.handles("A"), true);
  assert.equal(s.handles("B"), true);
  assert.equal(s.fail("A"), null);
  assert.equal(s.runtime.status().errors, 1);
  assert.equal(s.fail("B"), null);
  assert.equal(s.runtime.status().errors, 2);
  assert.equal(s.runtime.status().tripped, false);
});

test("3. Twenty errors across both seams in ten minutes trip the process breaker", () => {
  const s = fixture();
  assert.equal(s.fail("A"), null);
  s.advance(600_001);
  for (let i = 0; i < 19; i += 1) {
    assert.equal(s.fail(i % 2 === 0 ? "A" : "B"), null);
  }
  assert.equal(s.handles("A"), true);
  assert.equal(s.fail("B"), null);
  assert.equal(s.runtime.status().tripped, true);
  assert.equal(s.handles("A"), false);
  assert.equal(s.handles("B"), false);
  s.advance(600_001);
  assert.equal(s.handles("A"), false);
});
