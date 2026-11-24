"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { Worker } = require("node:worker_threads");
const schema = require("./settings.json");
const root = path.resolve(__dirname, "../..");
const dashboardFields = [
  "rosterTarget", "rosterCeiling", "maxOnline", "maxPerSystem", "rosterSeedEnabled",
  "rosterSeedBatchSize", "rosterSeedMaxProcessCpuPercent", "autoworkEnabled",
  "addonConcurrency", "addonCycleIntervalMs", "addonBotDelayMs",
];

let options;

function readOptions(installRoot) {
  const file = path.join(installRoot, "config", "playerbots-native.json");
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Playerbots options must be a JSON object.");
  }
  const effective = {};
  const overrides = {};
  for (const [key, rule] of Object.entries(schema)) {
    const saved = Object.hasOwn(raw, key);
    const value = saved ? raw[key] : rule.default;
    let valid;
    switch (rule.type) {
      case "boolean":
        valid = typeof value === "boolean";
        break;
      case "string":
        valid = typeof value === "string" && value.length <= rule.maxLength && !/[\u0000-\u001f\u007f]/.test(value);
        break;
      case "integer":
        valid = Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum;
        break;
    }
    if (!valid) throw new Error(`Invalid Playerbots setting ${key}. Correct it in Mods > Configure.`);
    effective[key] = rule.type === "string" ? value.trim() : value;
    if (saved && dashboardFields.includes(key)) overrides[key] = value;
  }
  if (effective.apiPort === effective.dashboardPort) {
    throw new Error("The Playerbots dashboard and private API require different ports.");
  }
  if (effective.rosterTarget > effective.rosterCeiling) {
    throw new Error("Playerbots roster target must be at or below its ceiling.");
  }
  return { effective, overrides };
}

function configure() {
  const stateFile = path.join(root, "_local", "playerbots-native", "overlay-state.json");
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null;
  if (state?.schema !== 1 || state.status !== "active") {
    throw new Error("Playerbots source integration is incomplete. Retry Enable or Disable in EVEJS Launcher with Game stopped.");
  }
  options = readOptions(root);
  for (const [key, rule] of Object.entries(schema)) {
    // Keep the existing environment default when the launcher has no saved threshold.
    if (key === "rosterSeedMaxProcessCpuPercent" && !Object.hasOwn(options.overrides, key)) continue;
    const value = options.effective[key];
    process.env[`EVEJS_PLAYER_BOTS_${rule.env}`] = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  }
  Object.assign(process.env, {
    EVEJS_PLAYER_BOTS_ADDON_MODE: "auto",
    EVEJS_PLAYER_BOTS_ADDON_TOKEN: randomBytes(32).toString("hex"),
    EVEJS_PLAYER_BOTS_ADDON_API_HOST: "127.0.0.1",
    EVEJS_PLAYER_BOTS_ADDON_URL: `http://127.0.0.1:${options.effective.apiPort}`,
    EVEJS_PLAYER_BOTS_DASHBOARD_HOST: "127.0.0.1",
    EVEJS_PLAYER_BOTS_STARTUP_SEED_BATCH_SIZE: "0",
  });
}

function launcherOverrides() {
  options ??= readOptions(root);
  return options.overrides;
}

function startDriver(imageServerUrl) {
  const worker = new Worker(path.join(__dirname, "index.js"), {
    env: { ...process.env, EVEJS_PLAYER_BOTS_IMAGE_SERVER_URL: imageServerUrl || "http://127.0.0.1:26001/" },
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 384 },
  });
  worker.unref();
  let exited = false;
  let stopping = false;
  const completion = new Promise((resolve) => {
    worker.on("error", (error) => console.error("[PlayerBots] Driver error:", error.message));
    worker.once("exit", (code) => {
      exited = true;
      if (!stopping) console.error(`[PlayerBots] Driver exited (${code}). Restart Game to relaunch it.`);
      resolve();
    });
  });
  return {
    async shutdown() {
      if (exited || stopping) return completion;
      stopping = true;
      worker.postMessage("stop");
      const timer = setTimeout(() => { void worker.terminate(); }, 5_000);
      try {
        await completion;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { configure, launcherOverrides, readOptions, startDriver };
