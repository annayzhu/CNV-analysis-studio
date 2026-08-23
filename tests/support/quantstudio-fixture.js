"use strict";

const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("../../vendor/xlsx.full.min.js");
const core = require("../../core.js");

const portableFixturePath = path.resolve(__dirname, "../fixtures/quantstudio-32well-deidentified.xlsx");

function resolveFixturePath() {
  return process.env.CNV_TEMPLATE_XLS || portableFixturePath;
}

function ingestQuantStudioFixture(settings) {
  const fixturePath = resolveFixturePath();
  if (!fs.existsSync(fixturePath)) throw new Error(`QuantStudio fixture not found: ${fixturePath}`);
  const workbook = XLSX.read(fs.readFileSync(fixturePath), { type: "buffer", raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`QuantStudio fixture has no worksheets: ${fixturePath}`);
  const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  const parsed = core.parseAoA(aoa);
  return {
    fixturePath,
    sheetName,
    parsed,
    analysis: core.analyze(parsed.records, parsed.metadata, settings || {}),
  };
}

module.exports = { ingestQuantStudioFixture, portableFixturePath, resolveFixturePath };

