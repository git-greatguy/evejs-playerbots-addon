"use strict";

// Corporation logos uploaded from the dashboard: stored as square PNGs in the
// runtime image folder and served back to the dashboard through the add-on API.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  LOGO_SIZES,
  createCorporationLogoStore,
  pngSize,
} = require("../integration/server/server/src/services/playerbots/playerBotCorporationLogoStore");

// A valid one-colour RGBA PNG of the given size.
function png(size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((size * 4 + 1) * size, 0x80);
  for (let y = 0; y < size; y++) rows[y * (size * 4 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const IMAGES = Object.fromEntries(LOGO_SIZES.map((size) => [String(size), png(size).toString("base64")]));
const CORPORATIONS = { 98000002: { corporationName: "Tyrell Corporation" } };

function makeStore(t, options = {}) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "playerbots-logos-")), "Corporation");
  t.after(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));
  const store = createCorporationLogoStore({
    getRoot: () => root,
    publish: (filePath, bytes) => fs.writeFileSync(filePath, bytes),
    findCorporation: (id) => CORPORATIONS[id] || null,
    clientPatchInstalled: () => options.inGame === true,
    now: () => 0,
  });
  return { store, root };
}

test("a logo is stored at every size and listed with a version", (t) => {
  const { store, root } = makeStore(t);
  const result = store.store(98000002, IMAGES);
  assert.equal(result.success, true);
  assert.deepEqual(result.sizes, LOGO_SIZES);
  assert.match(result.message, /Tyrell Corporation.*needs the corporation-logo add-on/);
  for (const size of LOGO_SIZES) {
    assert.deepEqual(pngSize(fs.readFileSync(path.join(root, `98000002_${size}.png`))), { width: size, height: size });
  }
  const listed = store.list();
  assert.deepEqual(listed.sizes, LOGO_SIZES);
  assert.equal(listed.inGame, false);
  assert.ok(listed.logos[98000002] > 0);
});

test("the nearest stored size is served, preferring a larger one", (t) => {
  const { store, root } = makeStore(t);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "98000002_128.png"), png(128));
  fs.writeFileSync(path.join(root, "98000002_512.png"), png(512));
  assert.deepEqual(pngSize(store.read(98000002, 64)), { width: 128, height: 128 });
  assert.deepEqual(pngSize(store.read(98000002, 256)), { width: 512, height: 512 });
  assert.deepEqual(pngSize(store.read(98000002, 1024)), { width: 512, height: 512 });
  assert.equal(store.read(98000005, 64), null);
});

test("uploads are checked before anything is written", (t) => {
  const { store, root } = makeStore(t);
  assert.equal(store.store(1000125, IMAGES).error, "CORPORATION_LOGO_INVALID_CORPORATION");
  assert.equal(store.store(98000099, IMAGES).statusCode, 404);
  assert.match(store.store(98000002, { ...IMAGES, 256: undefined }).message, /256×256 image is missing/);
  assert.match(store.store(98000002, { ...IMAGES, 64: Buffer.from("not a png").toString("base64") }).message, /not a PNG/);
  assert.match(store.store(98000002, { ...IMAGES, 64: png(65).toString("base64") }).message, /is 65×65/);
  assert.equal(fs.existsSync(root), false);
});

test("removing a logo deletes every size and says when there was none", (t) => {
  const { store, root } = makeStore(t, { inGame: true });
  assert.match(store.store(98000002, IMAGES).message, /after they next log in/);
  const removed = store.remove(98000002);
  assert.deepEqual(removed.removed, LOGO_SIZES);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.deepEqual(store.list().logos, {});
  assert.match(store.remove(98000002).message, /had no logo/);
});

test("the dashboard uploads, shows and removes a logo through the add-on API", async (t) => {
  const { createPlayerBotAddonApiRuntime } = require("../integration/server/server/src/services/playerbots/playerBotAddonApiRuntime");
  const { createDashboardServer } = require("../addons/playerbots/dashboard-server");
  const { store } = makeStore(t, { inGame: true });
  const token = "corporation-logo-test-token-".repeat(2);
  const api = createPlayerBotAddonApiRuntime({
    host: "127.0.0.1", port: 0, token, corporationLogos: store,
    playerBots: {}, autonomy: {}, dashboard: {}, configuration: { getSettings: () => ({}) }, director: {},
    logger: { info() {}, warn() {} }, telemetry: { start() {}, stop() {} },
  });
  t.after(() => api.shutdown());
  await api.start();
  const apiURL = `http://127.0.0.1:${api.getDiagnostics().port}`;
  const dashboard = createDashboardServer({ host: "127.0.0.1", port: 0, token, apiURL });
  await dashboard.start();
  t.after(() => dashboard.shutdown());
  const url = `http://127.0.0.1:${dashboard.getDiagnostics().port}`;
  const post = (body, origin = url) => fetch(`${url}/api/corporation-logo`, {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  });

  assert.equal((await fetch(`${apiURL}/v1/dashboard/corporation-logos`)).status, 401);
  assert.equal((await post({ corporationID: 98000002, images: IMAGES }, "http://another-server.invalid")).status, 403);
  assert.equal((await fetch(`${url}/api/corporation-logo?corporationID=98000002&size=128`)).status, 404);

  const saved = await post({ corporationID: 98000002, images: IMAGES });
  assert.equal(saved.status, 200);
  assert.match((await saved.json()).message, /Logo saved for Tyrell Corporation/);

  const listed = await (await fetch(`${url}/api/corporation-logos`)).json();
  assert.equal(listed.inGame, true);
  assert.ok(listed.logos[98000002] > 0);

  const image = await fetch(`${url}/api/corporation-logo?corporationID=98000002&size=128&v=${listed.logos[98000002]}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(pngSize(Buffer.from(await image.arrayBuffer())), { width: 128, height: 128 });
  assert.equal((await fetch(`${url}/api/corporation-logo?corporationID=98000002&size=100`)).status, 400);

  const bad = await post({ corporationID: 98000002, images: { ...IMAGES, 32: png(64).toString("base64") } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /32×32 image is 64×64/);

  const removed = await post({ corporationID: 98000002, remove: true });
  assert.equal(removed.status, 200);
  assert.match((await removed.json()).message, /Logo removed/);
  assert.equal((await fetch(`${url}/api/corporation-logo?corporationID=98000002&size=128`)).status, 404);
});

test("pages show a logo only for corporations that have one", async () => {
  const ui = await import("../addons/playerbots/dashboard/js/ui.js");
  ui.setCorporationLogos({ sizes: LOGO_SIZES, inGame: false, logos: { 98000002: 1700000000000 } });
  assert.match(ui.corpLogo(98000002, 32), /\/api\/corporation-logo\?corporationID=98000002&amp;size=64&amp;v=1700000000000/);
  assert.equal(ui.corpLogo(98000005, 32), "");
  assert.match(ui.pilotCell({ characterID: 1, characterName: "A", corporationID: 98000002, corporationName: "Tyrell Corporation" }), /corp-logo inline/);
  assert.doesNotMatch(ui.pilotCell({ characterID: 1, characterName: "A", corporationID: 98000005, corporationName: "OCP" }), /corp-logo/);
});

test("the Guide explains picture logos and links the in-game add-on", async () => {
  const guide = await import("../addons/playerbots/dashboard/js/guide-content.js");
  const topic = guide.TOPICS.find((entry) => entry.id === "corp-identity");
  const body = topic.body();
  assert.match(body, /<h3>Picture logos<\/h3>/);
  assert.match(body, /href='https:\/\/github\.com\/ubermidas\/evejs-corporation-logos'/);
});
