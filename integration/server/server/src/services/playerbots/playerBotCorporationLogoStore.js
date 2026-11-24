"use strict";

// Corporation logo PNGs for the Playerbots dashboard.
//
// Logos live where EveJS keeps its other runtime images:
//   <runtime images>/Corporation/<corporationID>_<size>.png
// one file per size, like alliance logos. The dashboard uploads them already
// resized and square; this module only checks and stores them. Showing a logo
// in the game client needs the separate corporation-logo add-on; the
// dashboard works without it.

const fs = require("node:fs");
const path = require("node:path");

const LOGO_SIZES = Object.freeze([32, 64, 128, 256, 512, 1024]);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LIST_CACHE_MS = 10_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LOGO_FILE = /^(\d+)_(\d+)\.png$/i;
const FIRST_PLAYER_CORPORATION_ID = 2_000_000;

function fail(code, message, statusCode = 400) {
  return { success: false, error: code, message, statusCode };
}

function defaultRoot() {
  const { resolveRuntimeImagesDir } = require("../../gameStore/storeRoot");
  return path.join(resolveRuntimeImagesDir(), "Corporation");
}

function defaultPublish(filePath, bytes) {
  const { publishFileAtomicSync } = require("../_shared/atomicFilePublication");
  return publishFileAtomicSync(filePath, bytes);
}

function defaultFindCorporation(corporationID) {
  return require("../corporation/corporationState").getCorporationRecord(corporationID) || null;
}

function defaultClientPatchInstalled() {
  return fs.existsSync(path.join(__dirname, "../corporation/corporationLogoClientDelivery.js"));
}

function toCorporationID(value) {
  const id = Math.trunc(Number(value));
  return Number.isSafeInteger(id) && id >= FIRST_PLAYER_CORPORATION_ID ? id : 0;
}

// Width and height from the PNG header; null when it is not a PNG.
function pngSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function createCorporationLogoStore(options = {}) {
  const getRoot = options.getRoot || defaultRoot;
  const publish = options.publish || defaultPublish;
  const findCorporation = options.findCorporation || defaultFindCorporation;
  const clientPatchInstalled = options.clientPatchInstalled || defaultClientPatchInstalled;
  const now = options.now || Date.now;
  let cache = null;

  function filePath(corporationID, size) {
    return path.join(getRoot(), `${corporationID}_${size}.png`);
  }

  // { corporationID: version } for every corporation with at least one logo file.
  function list() {
    if (cache && now() - cache.at < LIST_CACHE_MS) return cache.value;
    const logos = {};
    let names = [];
    try {
      names = fs.readdirSync(getRoot());
    } catch {
      names = [];
    }
    for (const name of names) {
      const match = LOGO_FILE.exec(name);
      if (!match) continue;
      const id = toCorporationID(match[1]);
      if (!id || !LOGO_SIZES.includes(Number(match[2]))) continue;
      let version = 0;
      try {
        version = Math.trunc(fs.statSync(path.join(getRoot(), name)).mtimeMs);
      } catch {
        continue;
      }
      logos[id] = Math.max(logos[id] || 0, version);
    }
    const value = {
      sizes: [...LOGO_SIZES],
      inGame: Boolean(clientPatchInstalled()),
      logos,
    };
    cache = { at: now(), value };
    return value;
  }

  // The stored PNG closest to the requested size, or null.
  function read(corporationIDValue, sizeValue) {
    const corporationID = toCorporationID(corporationIDValue);
    if (!corporationID) return null;
    const size = Math.trunc(Number(sizeValue)) || 64;
    const order = [...LOGO_SIZES].sort((a, b) => {
      const da = a >= size ? a - size : (size - a) * 4;
      const db = b >= size ? b - size : (size - b) * 4;
      return da - db;
    });
    for (const candidate of order) {
      try {
        const bytes = fs.readFileSync(filePath(corporationID, candidate));
        if (pngSize(bytes) && bytes.length <= MAX_LOGO_BYTES) return bytes;
      } catch {
        // Try the next size.
      }
    }
    return null;
  }

  // images: { "32": base64, ..., "1024": base64 }, each a square PNG of that size.
  function store(corporationIDValue, images) {
    const corporationID = toCorporationID(corporationIDValue);
    if (!corporationID) return fail("CORPORATION_LOGO_INVALID_CORPORATION", "Choose a player or bot corporation; NPC corporations keep their game logos.");
    const corporation = findCorporation(corporationID);
    if (!corporation) return fail("CORPORATION_LOGO_UNKNOWN_CORPORATION", `No corporation has ID ${corporationID}.`, 404);
    if (!images || typeof images !== "object" || Array.isArray(images)) {
      return fail("CORPORATION_LOGO_INVALID_IMAGE", "No images were sent.");
    }
    const decoded = [];
    for (const size of LOGO_SIZES) {
      const text = images[String(size)];
      if (typeof text !== "string" || !text) {
        return fail("CORPORATION_LOGO_INVALID_IMAGE", `The ${size}×${size} image is missing.`);
      }
      const bytes = Buffer.from(text, "base64");
      if (bytes.length > MAX_LOGO_BYTES) {
        return fail("CORPORATION_LOGO_TOO_LARGE", `The ${size}×${size} image is larger than 2 MB.`, 413);
      }
      const dimensions = pngSize(bytes);
      if (!dimensions) return fail("CORPORATION_LOGO_INVALID_IMAGE", `The ${size}×${size} image is not a PNG.`);
      if (dimensions.width !== size || dimensions.height !== size) {
        return fail("CORPORATION_LOGO_INVALID_IMAGE", `The ${size}×${size} image is ${dimensions.width}×${dimensions.height}.`);
      }
      decoded.push({ size, bytes });
    }
    fs.mkdirSync(getRoot(), { recursive: true });
    for (const { size, bytes } of decoded) publish(filePath(corporationID, size), bytes);
    cache = null;
    const name = corporation.corporationName || `Corporation ${corporationID}`;
    const inGame = Boolean(clientPatchInstalled());
    return {
      success: true,
      corporationID,
      sizes: decoded.map((entry) => entry.size),
      inGame,
      message: inGame
        ? `Logo saved for ${name}. Players see it in game after they next log in.`
        : `Logo saved for ${name}. It shows on the dashboard; showing it in game needs the corporation-logo add-on.`,
    };
  }

  function remove(corporationIDValue) {
    const corporationID = toCorporationID(corporationIDValue);
    if (!corporationID) return fail("CORPORATION_LOGO_INVALID_CORPORATION", "Choose a player or bot corporation.");
    const removed = [];
    for (const size of LOGO_SIZES) {
      try {
        fs.unlinkSync(filePath(corporationID, size));
        removed.push(size);
      } catch (error) {
        if (error && error.code !== "ENOENT") throw error;
      }
    }
    cache = null;
    return {
      success: true,
      corporationID,
      removed,
      message: removed.length
        ? "Logo removed. The corporation shows its emblem again after players next log in."
        : "This corporation had no logo.",
    };
  }

  return Object.freeze({ list, read, store, remove });
}

let shared = null;
function getCorporationLogoStore() {
  if (!shared) shared = createCorporationLogoStore();
  return shared;
}

module.exports = {
  LOGO_SIZES,
  MAX_LOGO_BYTES,
  createCorporationLogoStore,
  getCorporationLogoStore,
  pngSize,
};
