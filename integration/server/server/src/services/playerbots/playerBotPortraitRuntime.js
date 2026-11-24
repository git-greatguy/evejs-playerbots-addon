"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { randomUUID } = require("node:crypto");
const {
  findCharacterPortraitPath,
  getCharacterPortraitFilePath,
  listCharacterPortraitRoots,
} = require("../character/portraitImageStore");

const SKIN = [[241, 204, 177], [224, 172, 135], [198, 134, 94], [141, 85, 58], [94, 59, 39], [233, 190, 160]];
const HAIR = [[30, 24, 20], [74, 46, 28], [140, 96, 52], [196, 160, 98], [120, 120, 125], [160, 40, 30], [20, 20, 30]];
const SUIT = [[40, 52, 70], [70, 40, 40], [36, 60, 48], [60, 60, 66], [84, 66, 36], [30, 30, 36]];
const EYES = [[60, 90, 140], [70, 110, 70], [90, 60, 30], [40, 40, 40], [110, 120, 130]];
const BACKGROUND = [[18, 26, 38], [30, 22, 30], [16, 30, 28], [34, 30, 22], [24, 24, 32]];

function seeded(characterID) {
  let state = (Number(characterID) * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

function mix(a, b, t) {
  return [0, 1, 2].map((index) => Math.round(a[index] + (b[index] - a[index]) * t));
}

function buildTraits(characterID) {
  const random = seeded(characterID);
  return {
    skin: pick(random, SKIN),
    hair: pick(random, HAIR),
    suit: pick(random, SUIT),
    eyes: pick(random, EYES),
    background: pick(random, BACKGROUND),
    accent: [Math.floor(80 + random() * 175), Math.floor(80 + random() * 175), Math.floor(80 + random() * 175)],
    hairStyle: Math.floor(random() * 3),
    faceWidth: 0.19 + random() * 0.04,
    faceHeight: 0.25 + random() * 0.03,
  };
}

// Colour of pixel (u, v) in unit coordinates, v growing downwards.
function shade(traits, u, v) {
  const cx = 0.5;
  const headY = 0.42;
  const dx = (u - cx) / traits.faceWidth;
  const dy = (v - headY) / traits.faceHeight;
  const head = dx * dx + dy * dy;
  let color = mix(traits.background, [0, 0, 0], v * 0.6);
  const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.35) * 1.6);
  color = mix(color, traits.accent, glow * 0.18);

  // Shoulders and suit with a collar accent stripe.
  const shoulderTop = 0.74 + Math.pow((u - cx) * 1.6, 2) * 0.35;
  if (v > shoulderTop) {
    color = mix(traits.suit, [0, 0, 0], Math.min(0.5, Math.abs(u - cx) * 0.8));
    if (Math.abs(u - cx) < 0.06 && v < shoulderTop + 0.2) color = mix(traits.accent, traits.suit, 0.4);
  }
  // Neck.
  if (Math.abs(u - cx) < traits.faceWidth * 0.45 && v > headY + traits.faceHeight * 0.7 && v <= shoulderTop + 0.02) {
    color = mix(traits.skin, [0, 0, 0], 0.25);
  }
  if (head <= 1) {
    color = mix(traits.skin, [0, 0, 0], Math.max(0, dx) * 0.22 + Math.max(0, dy) * 0.12);
    // Eyes, brows and mouth.
    const eyeY = headY - traits.faceHeight * 0.05;
    for (const side of [-1, 1]) {
      const ex = cx + side * traits.faceWidth * 0.38;
      const eyeDistance = Math.hypot((u - ex) / 0.035, (v - eyeY) / 0.018);
      if (eyeDistance < 1) color = eyeDistance < 0.55 ? traits.eyes : [235, 235, 230];
      if (Math.abs(v - (eyeY - 0.04)) < 0.008 && Math.abs(u - ex) < 0.04) color = traits.hair;
    }
    if (Math.abs(v - (headY + traits.faceHeight * 0.55)) < 0.008 && Math.abs(u - cx) < 0.045) {
      color = mix(traits.skin, [120, 40, 40], 0.5);
    }
    if (Math.abs(u - cx) < 0.012 && v > eyeY + 0.02 && v < headY + traits.faceHeight * 0.35) {
      color = mix(color, [0, 0, 0], 0.15);
    }
  }
  // Hair cap, with three silhouettes.
  const hairLine = headY - traits.faceHeight * (traits.hairStyle === 1 ? 0.35 : 0.5);
  const hairShape = dx * dx + Math.pow((v - headY) / (traits.faceHeight * 1.12), 2);
  if (hairShape <= 1.18 && v < hairLine) color = traits.hair;
  if (traits.hairStyle === 2 && hairShape <= 1.25 && head > 1 && v < headY + traits.faceHeight * 0.6 && v > hairLine) {
    color = traits.hair;
  }
  return color;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function renderPortraitPng(characterID, size) {
  const traits = buildTraits(characterID);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = shade(traits, (x + 0.5) / size, (y + 0.5) / size);
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const BUILTIN_DIR = path.resolve(__dirname, "../../../playerbots-native/portraits");
const BUILTIN_COUNT = 32;
const CHECK_DELAY_MS = 125;
const LOAD_DELAY_MS = 1000;
const BATCH_SIZE = 8;
const MAX_QUEUE_CHECKS_PER_BATCH = 128;
let poolPromise;
const pending = new Set();
const priority = new Set();
let existing = null;
const running = new Set();
let timer;
let inFlight;
let started = false;
let nextWarningAt = 0;
let migration = null;
let startupProfiles = null;
const PORTRAIT_FILE = /^(\d+)_(?:32|64|128|256|512|1024)\.(?:jpg|png)$/i;

function getPoolDir() {
  return path.join(path.dirname(path.dirname(getCharacterPortraitFilePath(1, 64, "jpg"))), "PlayerBotPortraitPool");
}

async function listPoolAgents() {
  try {
    const entries = await fs.promises.readdir(getPoolDir(), { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).flatMap(entry => {
      const match = /^(\d+)_256\.jpg$/.exec(entry.name);
      return match ? [Number(match[1])] : [];
    }).sort((a, b) => a - b);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

function portraitIndex(id, count) {
  const hash = Math.imul(id ^ (id >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) % count;
}

async function readPortraitIndex() {
  const ids = new Set();
  const oldFiles = new Map();
  for (const [index, root] of listCharacterPortraitRoots().entries()) {
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = PORTRAIT_FILE.exec(entry.name);
        if (!match) continue;
        const id = Number(match[1]);
        ids.add(id);
        if (migration?.pending.has(id)) {
          if (!oldFiles.has(id)) oldFiles.set(id, []);
          oldFiles.get(id).push({ root, index, name: entry.name });
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (migration) migration.oldFiles = oldFiles;
  return ids;
}

function builtinPortrait(id) {
  return path.join(BUILTIN_DIR, String(portraitIndex(id, BUILTIN_COUNT)).padStart(2, "0") + ".jpg");
}

async function openMigration(profiles) {
  if (process.env.EVEJS_PLAYER_BOTS_REFRESH_EXISTING_PORTRAITS === "0") return null;
  const backup = path.join(path.dirname(getPoolDir()), "PlayerBotPortraitBackup-v1");
  const journal = path.join(backup, "refresh.log");
  let history = "";
  try { history = await fs.promises.readFile(journal, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const complete = new Set(history.split("\n").filter(Boolean));
  if (complete.has("done") || !profiles.size) return null;
  await fs.promises.mkdir(backup, { recursive: true });
  return { backup, journal, pending: new Set([...profiles].filter(id => !complete.has(String(id)))), oldFiles: null };
}

async function refreshPortrait(id, state) {
  const source = builtinPortrait(id);
  const destination = getCharacterPortraitFilePath(id, 256, "jpg");
  const oldFiles = state.oldFiles.get(id) || [];
  if (oldFiles.length === 1 && path.join(oldFiles[0].root, oldFiles[0].name) === destination) {
    // A previous pass may have installed this exact file before saving the journal.
    try {
      const expected = await fs.promises.readFile(source);
      if ((await fs.promises.stat(destination)).size === expected.length &&
          (await fs.promises.readFile(destination)).equals(expected)) return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const temp = destination + ".refresh-" + randomUUID();
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  // Stage the replacement before moving any old image out of the serving path.
  await fs.promises.copyFile(source, temp, fs.constants.COPYFILE_EXCL);
  try {
    for (const { root, index, name } of oldFiles) {
      const old = path.join(root, name);
      const archived = path.join(state.backup, `${index}-${randomUUID()}-${name}`);
      try { await fs.promises.rename(old, archived); }
      catch (error) {
        if (error.code === "ENOENT") continue;
        if (error.code !== "EXDEV") throw error;
        await fs.promises.copyFile(old, archived, fs.constants.COPYFILE_EXCL);
        await fs.promises.unlink(old);
      }
    }
    await fs.promises.rename(temp, destination);
  } finally {
    await fs.promises.rm(temp, { force: true });
  }
}

async function copyPortrait(id, source, destination) {
  if (findCharacterPortraitPath(id, 256)) return false;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const temp = destination + ".tmp-" + randomUUID();
  try {
    await fs.promises.copyFile(source, temp, fs.constants.COPYFILE_EXCL);
    try { await fs.promises.link(temp, destination); }
    catch (error) {
      if (!["EPERM", "ENOTSUP", "EXDEV"].includes(error.code)) throw error;
      // A data root on a filesystem without hard-link support still gets
      // an exclusive copy and can never replace an uploaded JPEG.
      await fs.promises.copyFile(temp, destination, fs.constants.COPYFILE_EXCL);
    }
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    await fs.promises.rm(temp, { force: true });
  }
}

async function ensurePortrait(characterID) {
  const id = Number(characterID);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("PLAYERBOT_PORTRAIT_INVALID_CHARACTER_ID");
  const target = getCharacterPortraitFilePath(id, 256, "jpg");
  const agents = await (poolPromise ||= listPoolAgents()).catch(() => []);
  // One source file is sufficient. Stock EveJS serves it for every portrait
  // size when an exact-size file is unavailable.
  if (agents.length) {
    const agent = agents[portraitIndex(id, agents.length)];
    try { return await copyPortrait(id, path.join(getPoolDir(), agent + "_256.jpg"), target); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return copyPortrait(id, builtinPortrait(id), target);
}

function warn(error) {
  const now = Date.now();
  if (now < nextWarningAt) return;
  nextWarningAt = now + 60_000;
  require("../../utils/logger").warn("[PlayerBots] Portrait repair paused: " + error.message);
}

function schedule(delay = CHECK_DELAY_MS) {
  if (!started || timer || inFlight || (!startupProfiles && !migration && !pending.size && !priority.size)) return;
  timer = setTimeout(() => {
    timer = null;
    if (require("./playerBotLoadController").getPlayerBotLoadController().shouldPauseLowPriorityWork()) {
      schedule(LOAD_DELAY_MS);
      return;
    }
    let delayAfter = CHECK_DELAY_MS;
    inFlight = drainBatch().catch(error => {
      warn(error);
      delayAfter = LOAD_DELAY_MS;
    }).finally(() => { inFlight = null; schedule(delayAfter); });
  }, delay);
  timer.unref();
}

async function drainBatch() {
  if (startupProfiles) {
    migration = await openMigration(startupProfiles);
    startupProfiles = null;
  }
  existing ??= await readPortraitIndex();
  const state = migration;
  const ids = [];
  let checked = 0;
  for (const queue of [priority, pending]) {
    for (const id of queue) {
      if (ids.length === BATCH_SIZE || checked === MAX_QUEUE_CHECKS_PER_BATCH) break;
      checked += 1;
      queue.delete(id);
      if (state?.pending.has(id) || !existing.has(id)) ids.push(id);
    }
    if (ids.length === BATCH_SIZE || checked === MAX_QUEUE_CHECKS_PER_BATCH) break;
  }
  const bots = require("./playerBotRuntime");
  const refreshed = [];
  let failure;
  await Promise.all(ids.map(async id => {
    const refreshing = state?.pending.has(id);
    if (!bots.hasBotProfile(id)) {
      if (refreshing) refreshed.push(id);
      return;
    }
    running.add(id);
    try {
      if (refreshing) { await refreshPortrait(id, state); refreshed.push(id); }
      else await ensurePortrait(id);
      existing.add(id);
    } catch (error) {
      if (refreshing && started) pending.add(id);
      failure ||= error;
    }
    finally { running.delete(id); }
  }));
  if (state && refreshed.length) {
    try { await fs.promises.appendFile(state.journal, "\n" + refreshed.join("\n") + "\n"); }
    catch (error) {
      if (started) for (const id of refreshed) pending.add(id);
      throw error;
    }
    for (const id of refreshed) { state.pending.delete(id); state.oldFiles.delete(id); }
  }
  if (state && !state.pending.size) {
    await fs.promises.appendFile(state.journal, "\ndone\n");
    migration = null;
  }
  if (failure) throw failure;
}

function queuePortrait(characterID, urgent = false) {
  const id = Number(characterID);
  if (!Number.isSafeInteger(id) || id <= 0 || (existing?.has(id) && !migration?.pending.has(id)) || running.has(id)) return;
  if (urgent) { pending.delete(id); priority.add(id); }
  else if (!priority.has(id)) pending.add(id);
  schedule();
}

function startPortraitRepair(profiles) {
  started = true;
  startupProfiles = new Set(profiles.map(row => Number(row.characterID)).filter(id => Number.isSafeInteger(id) && id > 0));
  for (const id of startupProfiles) queuePortrait(id);
  schedule();
}

async function stopPortraitRepair() {
  started = false;
  clearTimeout(timer); timer = null;
  pending.clear(); priority.clear();
  await inFlight;
  existing = null;
  poolPromise = null;
  startupProfiles = null;
  migration = null;
}

module.exports = { ensurePortrait, getPoolDir, listPoolAgents, renderPortraitPng, queuePortrait, startPortraitRepair, stopPortraitRepair };
