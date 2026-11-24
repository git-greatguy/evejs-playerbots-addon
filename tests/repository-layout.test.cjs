"use strict";

// The repository root doubles as an unpacked release, so a git checkout
// installs the same way as the ZIP. Its installer files must stay identical
// to the sources in addons/playerbots/ that the package builder uses.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..");

test("root installer files match their addons/playerbots sources", () => {
  for (const name of ["install.py", "rollback.py", "verify.py", "compose.override.yaml"]) {
    assert.ok(fs.readFileSync(path.join(repo, name)).equals(fs.readFileSync(path.join(repo, "addons/playerbots", name))),
      `${name} differs; copy addons/playerbots/${name} to the repository root`);
  }
});

test("every document the README links to exists", () => {
  const readme = fs.readFileSync(path.join(repo, "README.md"), "utf8");
  for (const [, target] of readme.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
    assert.ok(fs.existsSync(path.join(repo, target)), target);
  }
});
