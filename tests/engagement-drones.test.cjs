"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntime, rangesFor } = require(
  "../integration/server/server/src/services/playerbots/playerBotEngagementRuntime",
)._testing;

function scenario({ fleet = false, empty = false } = {}) {
  const calls = [];
  const bot = { characterID: 12 };
  const ship = { itemID: 100, mode: "STOP", maxTargetRange: 50_000 };
  const target = { itemID: 200, kind: "ship" };
  const flight = [{ itemID: 301, targetID: 0 }, { itemID: 302, targetID: 0 }];
  const world = {
    visible: true,
    distance: 1_000,
    locked: false,
    lockResponse: { success: true },
    acceptsEngage: true,
    acceptedCount: 1,
    throwAfterAssignment: false,
    deployed: empty ? [] : flight,
  };
  const session = { shipID: ship.itemID };
  const scene = {
    getEntityByID: (id) => world.visible && Number(id) === target.itemID ? target : null,
    getTargetsForEntity: () => world.locked ? [target.itemID] : [],
  };
  const state = { distanceTo: (id) => Number(id) === target.itemID ? world.distance : null };
  const attached = { scene, entity: ship, session };
  function launch(name) {
    calls.push(name);
    world.deployed = flight;
    return { success: true, drones: flight };
  }
  function read(name) {
    calls.push(name);
    return world.deployed;
  }
  const dependencies = {
    space: {
      getActorSpace() { calls.push("getActorSpace"); return attached; },
      getSpaceState() { calls.push("getSpaceState"); return state; },
      approach(pilot, id, range) {
        assert.equal(pilot, bot);
        assert.equal(Number(id), target.itemID);
        calls.push("approach");
        Object.assign(ship, { mode: "FOLLOW", targetEntityID: id, followRange: range });
        return { success: true };
      },
      warp() { calls.push("warp"); },
      lockTarget(pilot, id) {
        assert.equal(pilot, bot);
        assert.equal(Number(id), target.itemID);
        calls.push("lock");
        return world.lockResponse;
      },
    },
    combat: {
      getControlledDrones: () => read("read"),
      launchDrones: () => launch("launch"),
      estimateEffectiveHitPoints() { calls.push("estimateEffectiveHitPoints"); },
    },
    drone: {
      commandEngage(actorSession, ids, id) {
        assert.equal(actorSession, session);
        assert.deepEqual(ids, world.deployed.map((drone) => drone.itemID));
        assert.equal(Number(id), target.itemID);
        calls.push("engage");
        if (!world.acceptsEngage) return { entries: [{ error: "DRONE_AUTHORITY_REFUSED" }] };
        // A single accepted drone suffices. Readback, including partial acceptance, decides success.
        for (const drone of world.deployed.slice(0, world.acceptedCount)) drone.targetID = id;
        if (world.throwAfterAssignment) throw new Error("late drone service error");
        return { entries: [] };
      },
      commandReturnBay() { calls.push("returnBay"); },
    },
    telemetry: { recordWork() {} },
    logger: { info() {}, debug() {}, warn() {} },
  };
  const runtime = createRuntime({ dependencies, env: {}, now: () => 100_000 });
  const input = {
    bot, operation: { kind: fleet ? "fleet-attack" : "combat", mode: "security" },
    attached, state, target, drones: world.deployed,
    fit: { droneControlRange: 20_000, droneAttackRange: 5_600 },
    lock: fleet, rangePolicy: fleet ? "control" : "legacy", stance: "cautious",
    cadence: { closingMs: 13_000, engagedMs: 3_000 },
  };
  if (fleet) {
    input.fleetDrones = { launch: () => launch("fleet-launch"), read: () => read("fleet-read") };
  }
  const run = () => fleet ? runtime.runSeamB(input) : runtime.runSeamA(input);
  return { input, runtime, world, ship, flight, calls, run };
}

test("1. Outside the firing threshold, issue one approach", () => {
  const s = scenario();
  s.world.distance = 8_000;
  assert.equal(s.run().status, "closing");
  assert.deepEqual(s.calls, ["approach"]);
});

test("2. The next step does not renew a matching follow command", () => {
  const s = scenario();
  s.world.distance = 8_000;
  assert.equal(s.run().status, "closing");
  assert.deepEqual(s.calls, ["approach"]);
  s.calls.length = 0;
  // The scene may report the commanded range within one metre.
  s.ship.followRange += 1;
  assert.equal(s.run().status, "closing");
  assert.deepEqual(s.calls, []);
});

test("3. At the firing threshold, command and confirm the drones once", () => {
  for (const acceptedCount of [1, 2]) {
    const s = scenario();
    s.world.distance = 4_480;
    s.world.acceptedCount = acceptedCount;
    const report = s.run();
    assert.equal(report.status, "engaging");
    assert.equal(report.justEngaged, true);
    assert.equal(report.droneCount, acceptedCount);
    assert.deepEqual(s.calls, ["engage", "read"]);
  }
});

test("A late service error after one drone accepted the order reports that drone once", () => {
  const s = scenario();
  s.world.throwAfterAssignment = true;
  const report = s.run();
  assert.equal(report.status, "engaging");
  assert.equal(report.justEngaged, true);
  assert.equal(report.droneCount, 1);
  assert.equal(s.runtime.status().errors, 1);
  assert.deepEqual(s.calls, ["engage", "read"]);
});

test("4. A drone already assigned to the target needs no service call", () => {
  const s = scenario();
  s.flight[1].targetID = s.input.target.itemID;
  s.input.beforeEngage = () => s.calls.push("before");
  const report = s.run();
  assert.equal(report.status, "engaging");
  assert.equal(report.justEngaged, false);
  assert.deepEqual(s.calls, []);
});

test("5. A command whose readback has no matching drone is refused", () => {
  const s = scenario();
  s.world.acceptsEngage = false;
  const report = s.run();
  assert.equal(report.status, "refused");
  assert.equal(report.reason, "engage-refused");
  assert.match(JSON.stringify(report.detail), /DRONE_AUTHORITY_REFUSED/);
  assert.deepEqual(s.calls, ["engage", "read"]);
  assert.equal(s.runtime.status().errors, 0);
});

test("6. A missing entity or missing surface distance yields target-lost", () => {
  const s = scenario();
  s.world.visible = false;
  assert.equal(s.run().status, "target-lost");
  s.world.visible = true;
  s.world.distance = null;
  assert.equal(s.run().status, "target-lost");
  assert.deepEqual(s.calls, []);
});

test("7. Every feasible stop is inside its firing threshold, including the command floor", () => {
  for (const [fleet, weapon, control, maxTarget, expectedGate] of [
    [false, 1_000, 20_000, 50_000, 1_250],
    [false, 5_600, 20_000, 50_000, 4_480],
    [true, 5_600, 20_000, 50_000, 16_000],
    [true, 5_600, 1_000, 1_400, 1_120],
  ]) {
    const s = scenario({ fleet });
    s.input.fit = { droneAttackRange: weapon, droneControlRange: control };
    s.ship.maxTargetRange = maxTarget;
    s.world.locked = true;
    const ranges = rangesFor(s.input.fit, s.ship, s.input.rangePolicy, fleet);
    assert.equal(ranges.engageRange, expectedGate);
    assert.ok(Number.isInteger(ranges.commandRange) && ranges.commandRange >= 1_000);
    assert.ok(ranges.commandRange < ranges.engageRange);
    if (fleet) assert.ok(ranges.engageRange <= ranges.lockCap);
    s.world.distance = expectedGate + 1;
    assert.equal(s.run().status, "closing");
    assert.equal(s.ship.followRange, ranges.commandRange);
    s.world.distance = expectedGate;
    assert.equal(s.run().status, "engaging");
  }
});

test("7b. A 1200 m targeting range makes a 1000 m follow infeasible", () => {
  const s = scenario({ fleet: true, empty: true });
  s.ship.maxTargetRange = 1_200;
  const report = s.run();
  assert.equal(report.status, "refused");
  assert.equal(report.reason, "lock-range-infeasible");
  assert.equal(report.delayMs, s.input.cadence.closingMs);
  assert.match(String(report.detail), /1000/);
  assert.match(String(report.detail), /960/);
  assert.deepEqual(s.calls, []);
  assert.equal(s.runtime.status().errors, 0);
});

test("8. Medium drones keep the legacy 4480 m gate and actual 3919 m follow", () => {
  const s = scenario();
  const ranges = rangesFor(s.input.fit, s.ship, "legacy", false);
  assert.equal(ranges.engageRange, 4_480);
  assert.ok(Math.abs(ranges.approachTo - 3_920) < 1e-8);
  assert.equal(ranges.commandRange, 3_919);
  s.world.distance = 4_481;
  assert.equal(s.run().status, "closing");
  assert.equal(s.ship.followRange, 3_919);
});

test("9. A lock refusal is retryable and no drones are launched", () => {
  const s = scenario({ fleet: true, empty: true });
  s.world.lockResponse = { success: false, errorMsg: "LOCK_DENIED" };
  const report = s.run();
  assert.equal(report.status, "closing");
  assert.equal(report.reason, "lock-refused");
  assert.match(String(report.detail), /LOCK_DENIED/);
  assert.deepEqual(s.calls, ["lock"]);
  assert.equal(s.runtime.status().errors, 0);
});

test("10. The lock cap bounds firing, with fitted drones launched only after lock confirmation", () => {
  const s = scenario({ fleet: true, empty: true });
  s.ship.maxTargetRange = 5_000;
  const ranges = rangesFor(s.input.fit, s.ship, "control", true);
  assert.equal(ranges.engageRange, 4_000);
  assert.ok(ranges.engageRange <= s.ship.maxTargetRange * 0.8);
  s.world.distance = 4_001;
  assert.equal(s.run().status, "closing");
  assert.deepEqual(s.calls, ["approach"]);
  s.world.distance = 4_000;
  const waiting = s.run();
  assert.equal(waiting.status, "closing");
  assert.equal(waiting.reason, "lock-pending");
  assert.deepEqual(s.calls, ["approach", "lock"]);
  s.world.locked = true;
  const engaged = s.run();
  assert.equal(engaged.status, "engaging");
  assert.equal(engaged.justEngaged, true);
  assert.equal(engaged.droneCount, 1);
  assert.deepEqual(s.calls, ["approach", "lock", "fleet-launch", "engage", "fleet-read"]);
});

test("11. beforeEngage runs once before even a refused command and cannot suppress it", () => {
  for (const outcome of ["accepted", "refused", "callback throws", "callback throws null"]) {
    const s = scenario();
    s.world.acceptsEngage = outcome !== "refused";
    s.input.beforeEngage = () => {
      s.calls.push("before");
      if (outcome === "callback throws") throw new Error("host callback failed");
      if (outcome === "callback throws null") throw null;
    };
    assert.equal(s.run().status, s.world.acceptsEngage ? "engaging" : "refused");
    assert.deepEqual(s.calls, ["before", "engage", "read"]);
    assert.equal(s.runtime.status().errors, 0);
  }
});

test("12. Each report uses the host-supplied cadence for its state", () => {
  const s = scenario();
  s.input.cadence = { closingMs: 7_321, engagedMs: 1_894 };
  s.world.distance = 9_000;
  const closing = s.run();
  assert.equal(closing.status, "closing");
  assert.equal(closing.delayMs, 7_321);
  s.world.distance = 1_000;
  const engaging = s.run();
  assert.equal(engaging.status, "engaging");
  assert.equal(engaging.delayMs, 1_894);
});
