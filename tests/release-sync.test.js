const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

test("the release manifest covers every local browser dependency", async () => {
  const { BROWSER_ASSETS, OFFLINE_PACKAGE_ASSETS } = await import(path.join(projectRoot, "scripts", "release-assets.mjs"));
  const html = fs.readFileSync(path.join(projectRoot, "cnvtool.html"), "utf8");
  const localReferences = Array.from(html.matchAll(/(?:src|href)="((?!https?:|\/|#)[^"]+)"/g), (match) => match[1]);
  const browserSources = BROWSER_ASSETS.map((asset) => asset.source);

  assert.deepEqual(browserSources, ["styles.css", "diagnostics.js", "core.js", "app.js", "vendor/xlsx.full.min.js"]);
  assert.deepEqual(localReferences.sort(), browserSources.slice().sort());
  assert.ok(OFFLINE_PACKAGE_ASSETS.includes("cnvtool.html"));
  assert.ok(browserSources.every((source) => OFFLINE_PACKAGE_ASSETS.includes(source)));
});

test("website release files match the canonical root sources", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "sync-release-assets.mjs"), "--check"],
    { cwd: projectRoot, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
});
