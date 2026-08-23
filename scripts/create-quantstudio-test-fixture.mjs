#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("../vendor/xlsx.full.min.js");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = process.argv[2];
const outputPath = process.argv[3] || path.join(projectRoot, "tests/fixtures/quantstudio-32well-deidentified.xlsx");

if (!sourcePath) {
  throw new Error("Usage: node scripts/create-quantstudio-test-fixture.mjs <source.xls[x]> [output.xlsx]");
}

const workbook = XLSX.read(await readFile(sourcePath), { type: "buffer", raw: true });
const sourceSheetName = workbook.SheetNames[0];
if (!sourceSheetName) throw new Error("Source workbook has no worksheets");
const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sourceSheetName], {
  header: 1,
  raw: true,
  defval: null,
  blankrows: true,
});

const replacements = new Map([
  ["Date Created", "2026-01-01 09:00:00"],
  ["Experiment File Name", "C:\\CNV_TEST_FIXTURE\\quantstudio-32well-deidentified.eds"],
  ["Experiment Name", "CNV_DEIDENTIFIED_32WELL"],
  ["Experiment Run End Time", "2026-01-01 10:00:00"],
  ["Instrument Name", "DEIDENTIFIED_QS5"],
  ["Instrument Serial Number", "DEIDENTIFIED"],
  ["User Name", "DEIDENTIFIED"],
]);

for (const row of aoa) {
  if (replacements.has(row?.[0])) row[1] = replacements.get(row[0]);
}

const sanitized = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(sanitized, XLSX.utils.aoa_to_sheet(aoa), "Results");
await mkdir(path.dirname(outputPath), { recursive: true });
const output = XLSX.write(sanitized, { type: "buffer", bookType: "xlsx", compression: true });
await writeFile(outputPath, output);
console.log(`Created de-identified QuantStudio fixture: ${outputPath}`);
