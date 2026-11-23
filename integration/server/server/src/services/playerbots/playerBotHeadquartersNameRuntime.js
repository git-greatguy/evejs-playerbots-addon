"use strict";

// Randomized operational base names assembled from familiar science-fiction
// cities and station terms without reusing one franchise's complete name.
const FICTIONAL_CITIES = Object.freeze([
  "Alderaan", "Andoria", "Bajor", "Cloud City", "Coruscant", "Dantooine",
  "Deep Space", "Ferenginar", "Hoth", "Kaminar", "Kashyyyk", "Lothal",
  "Mandalore", "New Alexandria", "New Berlin", "New Caprica", "New Risa",
  "Qo'noS", "Ryloth", "Sanctuary Moon", "Tatooine", "Trantor", "Vulcan",
]);
const STATION_NAMES = Object.freeze([
  "Orbital Exchange", "Starbase", "Trade Station", "Frontier Port",
  "Deep Space Dock", "Waystation", "Transit Hub", "Spacedock",
  "Gateway Station", "Outpost", "Commerce Hub", "Harbor Station",
]);
const MAX_ATTEMPTS = 64;

function generateHeadquartersName(options = {}) {
  const random = typeof options.random === "function" ? options.random : Math.random;
  const isAvailable = typeof options.isAvailable === "function" ? options.isAvailable : () => true;
  const pick = (values) => values[Math.floor(Math.abs(Number(random()) || 0) * values.length) % values.length];
  const prefix = String(options.corporationName || "").trim();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const stem = `${pick(FICTIONAL_CITIES)} ${pick(STATION_NAMES)}`;
    const candidate = `${stem} ${prefix}`.trim().slice(0, 200);
    if (isAvailable(candidate)) return candidate;
  }
  const fallback = `${pick(FICTIONAL_CITIES)} ${pick(STATION_NAMES)} ${Date.now().toString(36)} ${prefix}`.trim().slice(0, 200);
  if (isAvailable(fallback)) return fallback;
  throw new Error("PLAYERBOT_HEADQUARTERS_NAME_POOL_EXHAUSTED");
}

module.exports = { FICTIONAL_CITIES, STATION_NAMES, generateHeadquartersName };
