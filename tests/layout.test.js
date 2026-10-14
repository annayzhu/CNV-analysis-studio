"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

test("unnamed measurements remain auditable and are not combined into an anonymous sample", () => {
  for (const withSampleColumn of [true, false]) {
    const rows = [
      ["Well", "Sample", "Target", "CT"],
      ["A1", "", "TARGET", 26], ["A1", "", "RNaseP", 25],
      ["A2", "", "TARGET", "Undetermined"], ["A2", "", "RNaseP", 25],
    ].map(row => withSampleColumn ? row : row.filter((_, index) => index !== 1));
    const parsed = core.parseAoA(rows);
    const analysis = core.analyze(parsed.records, parsed.metadata);
    assert.equal(analysis.records.length, 4);
    assert.deepEqual(analysis.records.map(r => r.wellPosition), ["A1", "A1", "A2", "A2"]);
    assert.equal(analysis.records[2].ctRaw, "Undetermined");
    assert.equal(analysis.sampleCount, 0);
    assert.deepEqual(core.flattenResults(analysis), []);
    assert.ok(analysis.runIssues.some(issue => issue.code === "MISSING_SAMPLE_NAMES"));
  }
});

test("a selected planner plate fills only missing sample names and reproduces named-input CN", () => {
  const layout = require("../layout.js");
  const document = layout.parseSheets([
    { name: "Well Details P01", rows: [["Well", "Sample", "Target(s)"], ["A1", "Cal", "ignored"], ["A2", "Cal"], ["A3", "00123"], ["A4", "00123"]] },
    { name: "Paste_QS_P01", rows: [["Well", "Sample"], ["A1", "Cal"], ["A5", ""]] },
    { name: "Well Details P02", rows: [["Well", "Sample"], ["A1", "Other plate"]] },
  ]);
  assert.deepEqual(document.plates.map(p => p.id), ["P01", "P02"]);
  const unrelated = layout.parseSheets([
    { name: "RunA_P01", rows: [["Well", "Sample"], ["A1", "One"]] },
    { name: "RunB_P01", rows: [["Well", "Sample"], ["A2", "Two"]] },
  ]);
  assert.deepEqual(unrelated.plates.map(p => p.id), ["RunA_P01", "RunB_P01"]);
  const named = core.parseAoA([
    ["Well", "Sample", "Target", "CT"],
    ...["A1", "A2", "A3", "A4"].flatMap((well, index) => [
      [well, index < 2 ? "Cal" : "00123", "TARGET", index < 2 ? 25 : 26],
      [well, index < 2 ? "Cal" : "00123", "RNaseP", 25],
    ]),
  ]);
  const unnamed = named.records.map(r => ({ ...r, sampleName: "" }));
  const supplemented = layout.applySamples(unnamed, document.plates[0], "layout.xlsx");
  assert.equal(supplemented.filledWells.length, 4);
  assert.ok(unnamed.every(r => r.sampleName === ""));
  assert.deepEqual(supplemented.records.map(r => r.ctRaw), named.records.map(r => r.ctRaw));
  const settings = { splitPanels: false, calibrations: { TARGET: { mode: "sample", sampleName: "Cal", copyNumber: 2, independentlyConfirmed: true } } };
  const actual = core.analyze(supplemented.records, {}, settings);
  assert.deepEqual(core.flattenResults(actual), core.flattenResults(core.analyze(named.records, {}, settings)));
  assert.equal(core.flattenResults(actual).find(r => r.sample === "00123").copy_number_calculated, 1);
  const exported = core.buildIntegratedExport(actual, { registration: { masterMixName: "TaqMan mix", layoutImport: { source: "layout.xlsx / P01", fields: ["reactionVolume"] } } });
  const raw = exported.sheets.find(s => s.name === "原始Ct");
  assert.equal(raw.rows[0]["仪器样本名"], "");
  assert.equal(raw.rows[0]["样本名来源"], "layout.xlsx / P01");
  assert.equal(raw.rows[0]["Ct"], 25);
  const registration = exported.sheets.find(s => s.name === "运行登记");
  assert.equal(registration.rows.find(r => r["字段"] === "Master Mix 名称")["本次记录"], "TaqMan mix");
  assert.match(registration.rows.find(r => r["字段"] === "板布局登记补入记录")["本次记录"], /layout.xlsx \/ P01/);
  const preserved = layout.applySamples(named.records, document.plates[1], "wrong-plate.xlsx");
  assert.deepEqual(preserved.records, named.records);
  assert.deepEqual(preserved.conflicts, ["A1"]);
});

test("Excel, pasted tables and a filled template preserve textual IDs and reject ambiguous wells", () => {
  const layout = require("../layout.js");
  const XLSX = require("../vendor/xlsx.full.min.js");
  const template = layout.templateRows(["A1", "B1", "P24"]);
  assert.deepEqual(template, [["Well", "Sample"], ["A1", ""], ["B1", ""], ["P24", ""]]);
  template[1][1] = "00123"; template[2][1] = "00123"; template[3][1] = "NTC";
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(template), "Samples");
  const binary = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const excel = XLSX.read(binary, { type: "buffer" });
  const clipboard = XLSX.read("Well\tSample\nA1\t00123\nB1\t00123\nP24\tNTC", { type: "string", raw: true });
  const from = w => layout.parseSheets([{ name: "Samples", rows: XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]], { header: 1, raw: false, defval: "" }) }]);
  assert.deepEqual(from(excel), from(clipboard));
  assert.equal(from(excel).plates[0].samples.A1, "00123");
  assert.throws(() => layout.parseSheets([{ name: "Samples", rows: [["Well", "Sample"], ["A1", "One"], ["a01", "Two"]] }]), /多个样本/);
  assert.throws(() => layout.parseSheets([{ name: "Samples", rows: [["Well", "Sample"], ["A25", "One"]] }]), /孔位无效/);
});

test("confirmed replacement corrects placeholder names, recounts samples and retains original measurements", () => {
  const layout = require("../layout.js");
  const records = core.parseAoA([
    ["Well", "Sample", "Target", "CT", "NOAMP"],
    ...["A1", "A2", "A3", "A4"].flatMap((well, i) => [
      [well, "Sample 1", "TARGET", i < 2 ? 25 : 26, "N"],
      [well, "Sample 1", "RNaseP", 25, "N"],
    ]),
  ]).records;
  const plate = { id: "P01", samples: { A1: "Cal", A2: "Cal", A3: "00123", A4: "00123" } };
  assert.equal(core.analyze(records).sampleCount, 1);
  assert.deepEqual(layout.applySamples(records, plate, "layout.xlsx").records, records);
  const corrected = layout.applySamples(records, plate, "layout.xlsx", true);
  assert.deepEqual(corrected.overwrittenWells, ["A1", "A2", "A3", "A4"]);
  assert.deepEqual(corrected.changedWells, ["A1", "A2", "A3", "A4"]);
  assert.ok(corrected.records.every(r => r.originalSampleName === "Sample 1"));
  assert.deepEqual(corrected.records.map(r => [r.ctRaw, r.flags, r.omit]), records.map(r => [r.ctRaw, r.flags, r.omit]));
  const analysis = core.analyze(corrected.records, {}, { splitPanels: false, calibrations: { TARGET: { mode: "sample", sampleName: "Cal", copyNumber: 2, independentlyConfirmed: true } } });
  assert.equal(analysis.sampleCount, 2);
  assert.equal(core.flattenResults(analysis).find(r => r.sample === "00123").copy_number_calculated, 1);
  const second = layout.applySamples(corrected.records, { id: "P01", samples: { A3: "Corrected ID" } }, "updated.xlsx", true);
  assert.equal(second.records[4].sampleName, "Corrected ID");
  assert.equal(second.records[4].originalSampleName, "Sample 1");
  assert.equal(second.records[6].sampleName, "00123");
  assert.ok(records.every(r => r.sampleName === "Sample 1"));
});

test("renaming an instrument-labelled NTC does not erase its original control role", () => {
  const layout = require("../layout.js");
  const records = core.parseAoA([["Well", "Sample", "Target", "CT"], ["A1", "NTC", "TARGET", "Undetermined"], ["A1", "NTC", "RNaseP", "Undetermined"]]).records;
  const changed = layout.applySamples(records, { id: "P01", samples: { A1: "Blank 1" } }, "layout.xlsx", true);
  const analysis = core.analyze(changed.records);
  assert.equal(analysis.ntcSummary.physicalWellCount, 1);
  assert.equal(analysis.sampleCount, 0);
  assert.equal(analysis.records[0].originalSampleName, "NTC");
});

test("planner registration fills available blanks without guessing reagents or overwriting entries", () => {
  const layout = require("../layout.js");
  const document = layout.parseSheets([
    { name: "Paste_QS_P01", rows: [["Well", "Sample"], ["A1", "00123"]] },
    { name: "Run Summary", rows: [["每孔总体积 / Total per well (µL)", 10], ["操作人 / Operator", "Technician"], ["实验日期 / Experiment date", "2026/10/14"]] },
    { name: "Reaction Setup", rows: [["2X TaqMan Genotyping Master Mix", 5, 176, "master-mix", ""]] },
    { name: "Assay & Dyes", rows: [["Role", "Assay name", "Assay ID", "Reporter", "Per-well volume (µL)"], ["Target", "GSTM1", "Hs-test", "FAM", 0.5], ["Reference", "RNaseP", "Ref-test", "VIC", 0.5]] },
  ]);
  const original = { operator: "Recorded operator", assays: [{ target: "GSTM1", reporter: "FAM", assayId: "", brand: "" }, { target: "RNaseP", reporter: "CY5", assayId: "" }] };
  const result = layout.fillRegistration(original, document.registration, "layout.xlsx / P01");
  assert.equal(result.operator, "Recorded operator");
  assert.equal(result.reactionVolume, "10 µL");
  assert.equal(result.experimentDate, "2026-10-14");
  assert.equal(result.masterMixName, "2X TaqMan Genotyping Master Mix");
  assert.equal(result.assays[0].assayId, "Hs-test");
  assert.equal(result.assays[0].brand, "");
  assert.equal(result.assays[1].assayId, ""); // Reporter mismatch: not the same assay.
  assert.equal(original.assays[0].assayId, "");
  assert.equal(original.reactionVolume, undefined);
  const partial = layout.parseSheets([
    { name: "Samples", rows: [["Well", "Sample"], ["A1", "00123"]] },
    { name: "Assays", rows: [["Target", "Reporter", "Brand", "Lot"], ["GSTM1", "FAM", "Provided vendor", "Lot-01"]] },
  ]);
  const partialResult = layout.fillRegistration(original, partial.registration, "partial.xlsx");
  assert.equal(partialResult.assays[0].brand, "Provided vendor");
  assert.equal(partialResult.assays[0].lot, "Lot-01");
  assert.equal(partialResult.assays[0].assayId, "");
});
