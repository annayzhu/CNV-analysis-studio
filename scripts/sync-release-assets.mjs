#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_ASSETS, renderSiteHtml } from "./release-assets.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const checkOnly = process.argv.includes("--check");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--check");

if (unknownArgs.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
}

async function expectedOutputs() {
  const outputs = [];

  for (const asset of BROWSER_ASSETS) {
    outputs.push({ target: asset.siteTarget, content: await readFile(path.join(projectRoot, asset.source)) });
  }

  const offlineHtml = await readFile(path.join(projectRoot, "cnvtool.html"), "utf8");
  outputs.push({
    target: "sites-app/public/index.html",
    content: Buffer.from(renderSiteHtml(offlineHtml)),
  });

  return outputs;
}

let mismatchCount = 0;

for (const { target, content } of await expectedOutputs()) {
  const targetPath = path.join(projectRoot, target);

  if (checkOnly) {
    let current;
    try {
      current = await readFile(targetPath);
    } catch {
      current = null;
    }

    if (current === null || !current.equals(content)) {
      console.error(`OUT OF SYNC: ${target}`);
      mismatchCount += 1;
    }
  } else {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
    console.log(`SYNCED: ${target}`);
  }
}

if (checkOnly) {
  if (mismatchCount > 0) {
    console.error(`Release synchronization check failed: ${mismatchCount} file(s) differ.`);
    process.exitCode = 1;
  } else {
    console.log("Release synchronization check passed.");
  }
}
