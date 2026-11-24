"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const local = path.join(__dirname, "../integration/server/server");
const file = path.join(local, "src/services/playerbots/playerBotPortraitRuntime.js");
const source = fs.readFileSync(file, "utf8");
const { createDashboardServer } = require("../addons/playerbots/dashboard-server");

async function exerciseRepair(t, migrate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"playerbots-portraits-"));
  const current = path.join(dir, "Character");
  const legacy = path.join(dir, "legacy");
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, "103_64.jpg"), Buffer.from("custom"));
  fs.writeFileSync(path.join(legacy, "103_128.png"), Buffer.from("corrupt"));
  fs.writeFileSync(path.join(legacy, "104_64.jpg"), Buffer.from("human"));
  const module = { exports: {} };
  let highLoad = true;
  const profileIDs = new Set([101, 103, 105]);
  function find(id) {
    for (const folder of [current, legacy]) {
      for (const size of [32, 64, 128, 256, 512, 1024]) {
        const filename=path.join(folder,`${id}_${size}.jpg`);
        if (fs.existsSync(filename)) return filename;
      }
    }
    return null;
  }
  const mocks = {
    "../character/portraitImageStore": {
      findCharacterPortraitPath: find,
      getCharacterPortraitFilePath: (id, size, ext) => path.join(current, `${id}_${size}.${ext}`),
      listCharacterPortraitRoots: () => [current, legacy],
    },
    "./playerBotRuntime": { hasBotProfile: id => profileIDs.has(id) },
    "./playerBotLoadController": { getPlayerBotLoadController: () => ({ shouldPauseLowPriorityWork: () => highLoad }) },
    "../../utils/logger": { warn: message => { throw Error(message); } },
  };
  const timers = new Set();
  vm.runInNewContext(source, {
    module, __dirname: path.dirname(file), Buffer,
    process: { env: { EVEJS_PLAYER_BOTS_REFRESH_EXISTING_PORTRAITS: migrate ? "1" : "0" } },
    require: id => mocks[id] || require(id),
    setTimeout(run, delay) {
      const timer = { run, delay, unref() {} };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  });
  const runtime = module.exports;
  t.after(async () => { await runtime.stopPortraitRepair(); fs.rmSync(dir, { recursive: true, force: true }); });
  const next = () => { const [timer] = timers; timers.delete(timer); timer.run(); return timer.delay; };
  assert.equal(await runtime.ensurePortrait(105), true);
  const existing = find(105);
  const marker = new Date("2025-01-01T00:00:00Z");
  fs.utimesSync(existing, marker, marker);
  runtime.startPortraitRepair([101, 102, 103, 105].map(characterID => ({ characterID })));
  assert.equal(next(), 125);
  assert.equal(find(101), null);
  highLoad = false;
  assert.equal(next(), 1000);
  const journal = path.join(dir, "PlayerBotPortraitBackup-v1/refresh.log");
  for (let i = 0; i < 100; i++) {
    if (migrate ? fs.existsSync(journal) && fs.readFileSync(journal, "utf8").includes("done") : find(101)) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(find(101));
  await runtime.stopPortraitRepair();
  assert.deepEqual(fs.readdirSync(current), migrate ? ["101_256.jpg", "103_256.jpg", "105_256.jpg"] : ["101_256.jpg", "105_256.jpg"]);
  assert.equal(fs.statSync(existing).mtimeMs, marker.getTime());
  const bytes = fs.readFileSync(find(101));
  assert.equal(bytes.subarray(0,3).toString("hex"), "ffd8ff");
  assert.equal(bytes.subarray(-2).toString("hex"), "ffd9");
  assert.equal(fs.readFileSync(find(104),"utf8"),"human");
  if (migrate) {
    assert.equal(fs.existsSync(path.join(legacy,"103_128.png")),false);
    const backup = path.dirname(journal);
    const archived = fs.readdirSync(backup).sort();
    assert.equal(archived.length, 3);
    for (const [name, expected] of [["103_64.jpg", "custom"], ["103_128.png", "corrupt"]]) {
      assert.equal(fs.readFileSync(path.join(backup, archived.find(item => item.endsWith(name))), "utf8"), expected);
    }
    assert.match(fs.readFileSync(journal, "utf8"), /\ndone\n/);
    const replacement = path.join(current,"103_256.jpg");
    fs.writeFileSync(replacement, "new custom upload");
    runtime.startPortraitRepair([{characterID: 101}, {characterID: 103}]);
    next();
    await runtime.stopPortraitRepair();
    assert.equal(fs.readFileSync(replacement, "utf8"), "new custom upload");
    assert.deepEqual(fs.readdirSync(backup).sort(), archived);
  } else assert.equal(fs.readFileSync(find(103),"utf8"),"custom");
  assert.equal(find(102),null);
  assert.equal(await runtime.ensurePortrait(101),false);
}

test("missing-only repair covers offline bots and preserves existing uploads", t => exerciseRepair(t, false));
test("one-time refresh backs up old bot files, leaves human portraits and skips the next startup", t => exerciseRepair(t, true));

test("dashboard serves native local portraits and correctly proxies bodyless HEAD", async t => {
  const face = path.join(local, "playerbots-native/portraits/00.jpg");
  const bytes = fs.readFileSync(face);
  let upstreamRequests = 0;
  const dashboard = createDashboardServer({
    host: "127.0.0.1", port: 0,
    findLocalPortrait: id => id === 300 ? face : null,
    fetch(_url, options) {
      upstreamRequests++;
      assert.equal(options.method, "HEAD");
      return new Response(null, { headers: { "content-type": "image/jpeg", "content-length": bytes.length } });
    },
  });
  const address = await dashboard.start();
  t.after(() => dashboard.shutdown());
  const url = id => `http://127.0.0.1:${address.port}/api/character-portrait?characterID=${id}&size=64`;
  const localGet = await fetch(url(300));
  assert.equal(localGet.status, 200);
  assert.equal(localGet.headers.get("content-type"),"image/jpeg");
  assert.deepEqual(Buffer.from(await localGet.arrayBuffer()), bytes);
  const localHead = await fetch(url(300), { method: "HEAD" });
  assert.equal(localHead.headers.get("content-length"), String(bytes.length));
  assert.equal((await localHead.arrayBuffer()).byteLength, 0);
  assert.equal(upstreamRequests, 0);
  const upstream = await fetch(url(301), { method: "HEAD" });
  assert.equal(upstream.status,200);
  assert.equal(upstream.headers.get("content-length"), String(bytes.length));
  assert.equal(upstreamRequests, 1);
});

