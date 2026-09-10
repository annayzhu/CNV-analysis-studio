#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(projectRoot, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "server"), { recursive: true });
await mkdir(path.join(dist, ".openai"), { recursive: true });
await cp(path.join(projectRoot, "public"), path.join(dist, "client"), { recursive: true });
await cp(path.join(projectRoot, ".openai", "hosting.json"), path.join(dist, ".openai", "hosting.json"));

const worker = await readFile(path.join(projectRoot, "worker", "index.js"), "utf8");
await writeFile(path.join(dist, "server", "index.js"), worker);

console.log("Built static Sites artifact: dist/server + dist/client");
