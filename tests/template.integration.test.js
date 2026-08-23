"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ingestQuantStudioFixture, portableFixturePath } = require("./support/quantstudio-fixture.js");

test("the 32-well QuantStudio fixture is parsed and guarded correctly", () => {
  const { fixturePath, parsed, analysis } = ingestQuantStudioFixture();

  assert.equal(fixturePath, process.env.CNV_TEMPLATE_XLS || portableFixturePath);
  assert.equal(parsed.headerRow, 47);
  assert.equal(parsed.records.length, 80);
  assert.equal(analysis.wellsUsed, 32);
  assert.equal(analysis.sampleCount, 8);
  assert.equal(analysis.plateFormat, 96);
  assert.equal(analysis.referenceName, "RNaseP");
  assert.equal(analysis.recordedReferenceSample, "Sample 1");
  assert.equal(analysis.assays.length, 3);
  assert.equal(analysis.releaseStatus, "HOLD");
  assert.equal(analysis.runIssues.some((issue) => issue.code === "AUTO_CT_THRESHOLD"), false);

  const gstm1 = analysis.assays.find((x) => x.targetName === "GSTM1");
  assert.equal(gstm1.results.find((x) => x.sampleName === "Sample 1").classification, "ZERO");
  assert.equal(gstm1.results.find((x) => x.sampleName === "Sample 1").calibrationEligible, false);
  assert.match(gstm1.calibration.warnings.join(" "), /禁止自动继承/);
  assert.equal(gstm1.results.find((x) => x.sampleName === "Sample 8").classification, "INVALID");
});

test("merged-panel GSTT1 calculation reproduces the instrument RQ check value", () => {
  const { analysis } = ingestQuantStudioFixture({
    splitPanels: false,
    calibrations: { GSTT1: { mode: "sample", sampleName: "Sample 1", copyNumber: 2, independentlyConfirmed: true } }
  });
  const gstt1 = analysis.assays.find((x) => x.targetName === "GSTT1");
  const sample7 = gstt1.results.find((x) => x.sampleName === "Sample 7");
  assert.equal(gstt1.calibration.ok, true);
  assert.ok(Math.abs(sample7.deltaDeltaCt - 0.741162776947022) < 1e-10);
  // The QuantStudio export stores a float-rounded RQ; the transparent
  // recomputation from the exported Delta Ct values agrees within 1e-6.
  assert.ok(Math.abs(sample7.rq - 0.598257005214691) < 1e-6);
  assert.ok(Math.abs(sample7.calculatedCopyNumber - 1.196514010429382) < 1e-6);
});

test("the QuantStudio fixture can designate a confirmed NTC sample without rewriting source names", () => {
  const { analysis } = ingestQuantStudioFixture({
    ntcAssignment: {
      mode: "manual_sample",
      sampleNames: ["Sample 8"],
      wellPositions: [],
      confirmed: true,
      note: "Integration test only: treated as confirmed from a hypothetical loading record"
    }
  });

  assert.equal(analysis.sampleCount, 7);
  assert.equal(analysis.ntcSummary.physicalWellCount, 4);
  assert.equal(analysis.ntcSummary.assayRowCount, 10);
  assert.equal(analysis.runIssues.some((issue) => issue.code === "NO_NTC"), false);
  assert.equal(analysis.runIssues.some((issue) => issue.code === "NTC_AMPLIFICATION"), false);
  assert.ok(analysis.records.filter((row) => row.sampleName === "Sample 8").every((row) => row.sampleName === "Sample 8" && row.sampleRole === "NTC"));
  assert.ok(analysis.assays.every((assay) => assay.results.every((result) => result.sampleName !== "Sample 8")));
});
