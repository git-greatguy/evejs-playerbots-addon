"use strict";

// Where the playerbot economy trades. Jita holds the only seeded market:
// bots buy there only when the accessible regional market has no non-Jita
// stock, and never sell there.
// Their own market forms at the bot hub, one jump away, from what they mine,
// build and list. Player buy orders anywhere are read from the market
// database (read-only) so bots can fill them by courier or manufacture.

const { marketDaemonClient } = require("../market/marketDaemonClient");

const JITA_SYSTEM_ID = 30000142;
// Jita IV - Moon 4: canonical seed station and fallback if its offer is out.
const JITA_BUY_STATION_ID = 60003760;
// New Caldari II - Kaalakiota Corporation Factory: factory, belts in system,
// 0.95 security, one jump from Jita.
const BOT_HUB_STATION_ID = 60014935;
// Each pilot sells, buys and builds from the hub of its own empire, so the
// roster does not converge on one station. Bots never trade in Jita.
const REGIONAL_HUB_STATION_IDS = Object.freeze({
  1: 60014935, // Caldari: New Caldari II - Kaalakiota Corporation Factory
  2: 60005686, // Minmatar: Hek VIII - Moon 12 - Boundless Creation Factory
  4: 60008494, // Amarr: Amarr VIII (Oris) - Emperor Family Academy
  8: 60011866, // Gallente: Dodixie IX - Moon 20 - Federation Navy Assembly Plant
});

function hubStationForRace(raceID) {
  return REGIONAL_HUB_STATION_IDS[Number(raceID)] || BOT_HUB_STATION_ID;
}

// A bot's own hub; pilots created before hubs existed keep New Caldari.
function getHubStationIDForBot(botOrCharacterID) {
  let bot = botOrCharacterID && typeof botOrCharacterID === "object" ? botOrCharacterID : null;
  if (!bot || !Number(bot.hubStationID)) {
    const characterID = Number(bot ? bot.characterID : botOrCharacterID) || 0;
    if (characterID) {
      try {
        const runtime = require("./playerBotRuntime");
        const record = typeof runtime.getBotByCharacterID === "function" ? runtime.getBotByCharacterID(characterID) : null;
        if (record) bot = record;
      } catch (_) {
        // Fall through to the shared hub.
      }
    }
  }
  const hubStationID = Number(bot && bot.hubStationID) || 0;
  return Object.values(REGIONAL_HUB_STATION_IDS).includes(hubStationID) ? hubStationID : BOT_HUB_STATION_ID;
}

const MARKET_SUPPLY_CACHE_MS = 30_000;
const MARKET_SUPPLY_CACHE_MAX_ENTRIES = 256;
const marketSupplyCache = new Map();

function readMarketSupplyCache(cache, typeID, now = Date.now()) {
  const entry = cache.get(typeID);
  if (!entry) return null;
  if (now - entry.readAt >= MARKET_SUPPLY_CACHE_MS) {
    cache.delete(typeID);
    return null;
  }
  // Map insertion order is the LRU order: most recently used is last.
  cache.delete(typeID);
  cache.set(typeID, entry);
  return entry.offers;
}

function writeMarketSupplyCache(cache, typeID, offers, readAt = Date.now()) {
  cache.delete(typeID);
  while (cache.size >= MARKET_SUPPLY_CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(typeID, { readAt, offers });
}

const JITA_REGION_ID = 10000002;
const pendingBooks = new Map();
const MAX_PENDING_BOOKS = 4;

function getBotMarketRegion(bot) {
  const session = require("./playerBotSpaceRuntime").getActorSession(bot);
  if (Number(session?.regionID) > 0) return Number(session.regionID);
  const character = require("../character/characterState").getCharacterRecord(bot?.characterID);
  const world = require("../../space/worldData");
  const station = world.getStationByID(Number(character?.stationID));
  const system = world.getSolarSystemByID(Number(session?.solarSystemID || character?.solarSystemID || station?.solarSystemID));
  return Number(system?.regionID || station?.regionID) || 0;
}

async function readMarketBook(regionID, typeID) {
  if (!(Number(regionID) > 0 && Number(typeID) > 0)) throw new Error("A market region and type are required");
  const key = `${regionID}:${typeID}`;
  const cached = readMarketSupplyCache(marketSupplyCache, key);
  if (cached) return cached;
  if (pendingBooks.has(key)) return pendingBooks.get(key);
  if (pendingBooks.size >= MAX_PENDING_BOOKS) throw new Error("PlayerBot market reads busy");
  const request = marketDaemonClient.call("GetOrders", {
    region_id: Number(regionID),
    type_id: Number(typeID),
  }).then((book) => {
    if (!Array.isArray(book?.sells) || !Array.isArray(book?.buys)) throw new Error("Invalid order book");
    writeMarketSupplyCache(marketSupplyCache, key, book);
    return book;
  }).finally(() => pendingBooks.delete(key));
  pendingBooks.set(key, request);
  return request;
}

function sellOffers(book) {
  return book.sells.filter((row) => Number(row.vol_remaining) > 0 && Number(row.price) > 0)
    .map((row) => ({
      stationID: Number(row.station_id),
      solarSystemID: Number(row.solar_system_id),
      regionID: Number(row.region_id),
      typeID: Number(row.type_id),
      price: Number(row.price),
      quantity: Number(row.vol_remaining),
      source: row.source,
    }));
}

async function ownerOrders(ownerID, isCorp = false) {
  const result = await marketDaemonClient.call("GetOwnerOrders", { owner_id: Number(ownerID), is_corp: isCorp });
  if (!Array.isArray(result)) throw new Error("Invalid owner order response");
  return result.map(flattenOrder);
}

function flattenOrder(order) {
  return { ...order.row, owner_id: order.owner_id, is_corp: order.is_corp,
    state: order.state, source: order.source, last_state_change_at: order.last_state_change_at };
}

function getBotOwnerIDs() {
  const bots = require("./playerBotRuntime").listBots();
  const owners = new Set();
  for (const bot of bots) {
    const characterID = Number(bot.characterID) || 0;
    const corporationID = Number(bot.specialtyCorporationID) || 0;
    const currentCorporationID = Number(bot.corporationID) || 0;
    if (characterID > 0) owners.add(characterID);
    if (corporationID > 0) owners.add(corporationID);
    if (currentCorporationID > 0) owners.add(currentCorporationID);
  }
  return owners;
}

function isJitaStation(stationID) {
  const worldData = require("../../space/worldData");
  const station = worldData.getStationByID(Number(stationID));
  if (Number(station && station.solarSystemID) === JITA_SYSTEM_ID) return true;
  try {
    const structure = worldData.getStructureByID(Number(stationID));
    return Number(structure && structure.solarSystemID) === JITA_SYSTEM_ID;
  } catch (_) {
    return false;
  }
}

async function listPlayerBuyOrders(limit, typeID, regionID) {
  if (!typeID || !regionID) return [];
  try {
    const book = await readMarketBook(regionID, typeID);
    return book.buys.filter((order) => order.source !== "seed" &&
      Number(order.solar_system_id) !== JITA_SYSTEM_ID && Number(order.vol_remaining) > 0)
      .slice(0, limit);
  } catch (_) {
    return [];
  }
}

async function listSellOffers(typeID, regionID, options = {}) {
  if (!typeID || !regionID) return [];
  try {
    const offers = sellOffers(await readMarketBook(regionID, typeID));
    const regional = offers.filter((offer) => offer.solarSystemID !== JITA_SYSTEM_ID);
    if (regional.length || !options.jitaFallback) return regional;
    return Number(regionID) === JITA_REGION_ID
      ? offers.filter((offer) => offer.solarSystemID === JITA_SYSTEM_ID)
      : await listJitaSellOffers(typeID);
  } catch (_) {
    return [];
  }
}

function getListingReferencePrice(options = {}) {
  const targetStationID = Math.trunc(Number(options.stationID)) || 0;
  const targetRegionID = Math.trunc(Number(options.regionID)) || 0;
  const botOwners = options.botOwnerIDs instanceof Set
    ? options.botOwnerIDs
    : new Set(Array.isArray(options.botOwnerIDs) ? options.botOwnerIDs.map(Number) : []);
  const stationIsJita = typeof options.stationIsJita === "function"
    ? options.stationIsJita
    : isJitaStation;
  const eligible = (offer) => {
    const stationID = Math.trunc(Number(offer && offer.stationID)) || 0;
    const regionID = Math.trunc(Number(offer && offer.regionID)) || 0;
    const ownerID = Math.trunc(Number(offer && offer.ownerID)) || 0;
    return stationID > 0 && Number(offer && offer.price) > 0 && Number(offer && offer.quantity) > 0 &&
      !botOwners.has(ownerID) && !stationIsJita(stationID) &&
      (!targetRegionID || !regionID || regionID === targetRegionID);
  };
  const asks = (Array.isArray(options.asks) ? options.asks : []).filter(eligible);
  const bids = (Array.isArray(options.bids) ? options.bids : []).filter(eligible);
  const localAsks = asks.filter((offer) => Number(offer.stationID) === targetStationID);
  const ask = (localAsks.length ? localAsks : asks)
    .sort((left, right) => Number(left.price) - Number(right.price))[0];
  if (ask) return { price: Number(ask.price), side: "ask", stationID: Number(ask.stationID) };

  const localBids = bids.filter((offer) => Number(offer.stationID) === targetStationID);
  const bid = (localBids.length ? localBids : bids)
    .sort((left, right) => Number(right.price) - Number(left.price))[0];
  if (bid) return { price: Number(bid.price), side: "bid", stationID: Number(bid.stationID) };

  const fallbackBid = Number(options.fallbackBid) || 0;
  if (fallbackBid > 0) return { price: fallbackBid, side: "fallback-bid", stationID: targetStationID };
  const basePrice = Number(options.basePrice) || 0;
  if (basePrice > 0) return { price: basePrice, side: "base", stationID: targetStationID };
  return null;
}

function scoreSellStationsForPackage(needs, offersByType, stationIsJita = isJitaStation) {
  const normalizedNeeds = (Array.isArray(needs) ? needs : [])
    .map((need) => ({
      typeID: Math.trunc(Number(need && need.typeID)) || 0,
      quantity: Math.max(1, Math.trunc(Number(need && need.quantity)) || 1),
    }))
    .filter((need) => need.typeID > 0);
  const stations = new Map();
  for (const need of normalizedNeeds) {
    const offers = offersByType instanceof Map
      ? offersByType.get(need.typeID)
      : offersByType && offersByType[need.typeID];
    const byStation = new Map();
    for (const offer of Array.isArray(offers) ? offers : []) {
      const stationID = Number(offer && offer.stationID) || 0;
      const quantity = Number(offer && offer.quantity) || 0;
      const price = Number(offer && offer.price) || 0;
      if (!stationID || quantity <= 0 || price <= 0) continue;
      if (!byStation.has(stationID)) byStation.set(stationID, []);
      byStation.get(stationID).push({ quantity, price });
    }
    for (const [stationID, stationOffers] of byStation) {
      let remaining = need.quantity;
      let cost = 0;
      let available = 0;
      for (const offer of stationOffers.sort((left, right) => left.price - right.price)) {
        const quantity = Math.min(remaining, offer.quantity);
        if (quantity <= 0) break;
        cost += quantity * offer.price;
        remaining -= quantity;
        available += quantity;
      }
      const entry = stations.get(stationID) || {
        stationID,
        coverage: 0,
        completeTypes: 0,
        totalTypes: normalizedNeeds.length,
        estimatedCost: 0,
        isJita: Boolean(stationIsJita(stationID)),
      };
      entry.coverage += Math.min(available, need.quantity);
      entry.completeTypes += remaining <= 0 ? 1 : 0;
      entry.estimatedCost += cost;
      stations.set(stationID, entry);
    }
  }
  const totalUnits = normalizedNeeds.reduce((sum, need) => sum + need.quantity, 0);
  return [...stations.values()].map((entry) => ({
    ...entry,
    totalUnits,
    complete: entry.completeTypes === entry.totalTypes,
  })).sort((left, right) =>
    Number(right.complete) - Number(left.complete) ||
    Number(left.isJita) - Number(right.isJita) ||
    right.coverage - left.coverage ||
    left.estimatedCost - right.estimatedCost ||
    left.stationID - right.stationID);
}

async function findSellStationsForPackage(needs, regionID) {
  const typeIDs = [...new Set((needs || []).map((need) => Number(need.typeID)).filter(Boolean))];
  const offersByType = new Map();
  for (const typeID of typeIDs) {
    offersByType.set(typeID, await listSellOffers(typeID, regionID, { jitaFallback: true }));
  }
  return scoreSellStationsForPackage(needs, offersByType);
}

function selectBestJitaSeedStation(needs, offersByType, stationIsJita = isJitaStation, excludedStationIDs = []) {
  const normalizedNeeds = (Array.isArray(needs) ? needs : []).map((need) => ({
    ...need,
    // Industry plans use `quantity`; single-item runtime requests may use
    // `units`. Preserve the requested amount when ranking seeded stations.
    quantity: need && need.quantity !== undefined ? need.quantity : need && need.units,
  }));
  const excluded = new Set((Array.isArray(excludedStationIDs) ? excludedStationIDs : [])
    .map((stationID) => Math.trunc(Number(stationID)) || 0).filter(Boolean));
  const candidates = scoreSellStationsForPackage(normalizedNeeds, offersByType, stationIsJita)
    .filter((candidate) => candidate.isJita && !excluded.has(Number(candidate.stationID)));
  candidates.sort((left, right) =>
    Number(right.complete) - Number(left.complete) ||
    right.coverage - left.coverage ||
    left.estimatedCost - right.estimatedCost ||
    left.stationID - right.stationID);
  return candidates[0] || null;
}

// The supported Jita seed preset stocks all 18 NPC stations in the Jita
// system. A bot must be able to fall through to another one when its canonical
// station has been bought out, while still checking non-Jita regional supply
// first at the caller.
async function listJitaSellOffers(typeID) {
  try {
    return sellOffers(await readMarketBook(JITA_REGION_ID, typeID))
      .filter((offer) => offer.solarSystemID === JITA_SYSTEM_ID);
  } catch (_) {
    return [];
  }
}

async function findJitaSellStationsForPackage(needs) {
  const offersByType = new Map();
  for (const typeID of new Set(needs.map((need) => Number(need.typeID)).filter(Boolean))) {
    offersByType.set(typeID, await listJitaSellOffers(typeID));
  }
  return scoreSellStationsForPackage(needs, offersByType);
}

async function findBestJitaSeedStation(needs, excludedStationIDs = []) {
  const typeIDs = [...new Set((Array.isArray(needs) ? needs : [])
    .map((need) => Math.trunc(Number(need && need.typeID)) || 0).filter(Boolean))];
  const offersByType = new Map();
  for (const typeID of typeIDs) {
    offersByType.set(typeID, await listJitaSellOffers(typeID));
  }
  const candidate = selectBestJitaSeedStation(needs, offersByType, isJitaStation, excludedStationIDs);
  return candidate ? Number(candidate.stationID) : 0;
}

async function listOpenSellOrders(ownerID, stationID, typeID, isCorp = false) {
  try {
    const orders = (await ownerOrders(ownerID, isCorp)).filter((order) =>
      order.state === "open" && !order.bid && Number(order.station_id) === Number(stationID) &&
      Number(order.type_id) === Number(typeID));
    return { success: true, orders };
  } catch (error) {
    return { success: false, error: String(error.message).slice(0, 160) };
  }
}

// A bot's open buy orders, optionally at one station and of one type.
async function listOpenBuyOrders(ownerID, stationID = 0, typeID = 0) {
  try {
    const { marketDaemonClient } = require("../market/marketDaemonClient");
    const owners = await marketDaemonClient.call("GetCharOrders", { owner_id: Number(ownerID) });
    const orders = owners.filter((order) => order.state === "open" && order.row.bid &&
      order.row.vol_remaining > 0 &&
      (!Number(stationID) || Number(order.row.station_id) === Number(stationID)) &&
      (!Number(typeID) || Number(order.row.type_id) === Number(typeID)))
      .map((order) => ({ ...order.row, owner_id: order.owner_id }));
    return { success: true, orders };
  } catch (error) {
    return { success: false, orders: [], error: String(error && error.message || error).slice(0, 160) };
  }
}

// Every open order (buy and sell) of one owner.
async function listOpenOrdersForOwner(ownerID) {
  return (await ownerOrders(ownerID)).filter((order) => order.state === "open");
}

// Lowest Jita seed ask with stock: the reference traders price against.
async function getJitaReferencePrice(typeID) {
  const offers = await listJitaSellOffers(Number(typeID));
  return offers.find((order) => order.source === "seed" && order.price > 0 && order.quantity > 0)?.price || 0;
}

async function getOpenOrder(orderID) {
  try {
    return flattenOrder(await marketDaemonClient.call("GetOrder", { order_id: String(orderID) }));
  } catch (error) {
    if (/order -?\d+ not found/i.test(String(error.message))) return null;
    throw error;
  }
}

async function getPlayerBuyOrder(orderID) {
  const order = await getOpenOrder(orderID);
  return order && order.bid && order.state === "open" && Number(order.vol_remaining) > 0 &&
    Number(order.solar_system_id) !== JITA_SYSTEM_ID ? order : null;
}

module.exports = {
  listOpenOrdersForOwner,
  BOT_HUB_STATION_ID,
  REGIONAL_HUB_STATION_IDS,
  getHubStationIDForBot,
  hubStationForRace,
  JITA_BUY_STATION_ID,
  JITA_SYSTEM_ID,
  getOpenOrder,
  getPlayerBuyOrder,
  isJitaStation,
  findSellStationsForPackage,
  findBestJitaSeedStation,
  listSellOffers,
  listJitaSellOffers,
  findJitaSellStationsForPackage,
  getBotMarketRegion,
  readMarketBook,
  listOpenSellOrders,
  listOpenBuyOrders,
  getJitaReferencePrice,
  listPlayerBuyOrders,
  getBotOwnerIDs,
  getListingReferencePrice,
  _testing: {
    scoreSellStationsForPackage,
    selectBestJitaSeedStation,
    getListingReferencePrice,
    readMarketSupplyCache,
    writeMarketSupplyCache,
    MARKET_SUPPLY_CACHE_MAX_ENTRIES,
    MARKET_SUPPLY_CACHE_MS,
  },
};
