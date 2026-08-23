"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");
const { runScenario } = require("./support/cnv-analysis-scenario.js");

test("known calibrator reproduces the public delta-delta-Ct formula", () => {
  const scenario = runScenario({
    samples: [
      { name: "Cal", startWell: 1, targetCts: [25, 25, 25, 25], referenceCts: [25, 25, 25, 25] },
      { name: "Test", startWell: 5, targetCts: [26, 26, 26, 26], referenceCts: [25, 25, 25, 25] },
    ],
    settings: {
      splitPanels: false,
      calibrations: { TARGET: { mode: "sample", sampleName: "Cal", copyNumber: 2, independentlyConfirmed: true } },
    },
  });
  const assay = scenario.assay();
  assert.equal(assay.calibration.ok, true);
  const testResult = scenario.result("Test");
  assert.equal(testResult.meanDeltaCt, 1);
  assert.equal(testResult.deltaDeltaCt, 1);
  assert.equal(testResult.rq, 0.5);
  assert.equal(testResult.calculatedCopyNumber, 1);
  assert.equal(testResult.predictedCopyNumber, 1);
});

test("integrated export puts Sample CN first and preserves registration plus raw Ct audit", () => {
  const scenario = runScenario({
    samples: [
      { name: "Cal", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "Test", startWell: 3, targetCts: [26, 26], referenceCts: [25, 25] },
    ],
    metadata: { "Experiment Name": "RUN-001", "Instrument Type": "QuantStudio 5", "Instrument Serial Number": "QS5-01" },
    settings: {
      splitPanels: false,
      calibrations: { TARGET: { mode: "sample", sampleName: "Cal", copyNumber: 2, independentlyConfirmed: true, confirmationEvidence: "WGS-2026-001", selectionNote: "Primary calibrator" } },
    },
  });
  const workbook = scenario.workbook({
    fileName: "RUN-001.xls",
    sheetName: "Results",
    registration: {
      runId: "RUN-001",
      plateId: "PLATE-A",
      analysisId: "CNV-RUN-001-01",
      experimentDate: "2026-07-13",
      operator: "Operator A",
      reactionVolume: "10 µL",
      protocolVersion: "CNV-SOP v1.0",
      recordStatus: "已记录",
      masterMixBrand: "ABI",
      masterMixCatalog: "4371353",
      masterMixLot: "LOT-01",
      masterMixExpiry: "2027-03-31",
      assays: [
        { target: "TARGET", reporter: "FAM", brand: "Vendor", assayId: "A-1", lot: "L-1", concentration: "20X", quencher: "MGB" },
        { target: "RNaseP", reporter: "VIC", brand: "Vendor", assayId: "R-1", lot: "L-2", concentration: "20X", quencher: "MGB" }
      ],
      finalDecision: "待复核"
    }
  });
  const integrated = workbook.integrated;
  assert.deepEqual(integrated.sheets.map((sheet) => sheet.name), [
    "样本CN汇总", "运行登记", "批次质控", "CN计算明细", "复孔质控", "原始Ct", "NTC审计", "校准记录", "分析参数", "仪器元数据", "方法说明"
  ]);
  const sampleSheet = integrated.sheets[0];
  assert.deepEqual(sampleSheet.headers.slice(0, 4), ["Sample ID", "Sample CN 概要", "样本自动结论", "批次状态"]);
  assert.equal(sampleSheet.rows.length, 2);
  const testRow = sampleSheet.rows.find((row) => row["Sample ID"] === "Test");
  assert.equal(testRow["TARGET · CN判定"], 1);
  assert.equal(testRow["TARGET · 连续CN"], 1);
  assert.equal(testRow["Plate ID"], "PLATE-A");
  const registrationSheet = workbook.sheet("运行登记");
  assert.match(registrationSheet.rows.find((row) => row["字段"] === "Run ID / Plate ID / Analysis ID")["本次记录"], /RUN-001 \/ PLATE-A \/ CNV-RUN-001-01/);
  assert.equal(workbook.sheet("原始Ct").rows.length, scenario.analysis.records.length);
  assert.ok(workbook.sheet("原始Ct").rows.some((row) => row.Target === "RNaseP"));
  assert.equal(workbook.sheet("复孔质控").rows.length, 2);
  assert.equal(workbook.sheet("CN计算明细").rows.length, 2);
  assert.equal(workbook.sheet("NTC审计").rows.length, 0);
  assert.equal(workbook.sheet("校准记录").rows[0]["确认依据/记录编号"], "WGS-2026-001");
});

test("zero-copy candidates stay textual in the Sample summary and do not export numeric zero", () => {
  const scenario = runScenario({
    samples: [{ name: "Zero", startWell: 1, targetCts: [null, null], referenceCts: [25, 25] }],
    settings: { splitPanels: false },
  });
  const workbook = scenario.workbook({ registration: { runId: "RUN-Z", analysisId: "A-Z", assays: [] } });
  const summary = workbook.sheet("样本CN汇总").rows[0];
  const detail = workbook.sheet("CN计算明细").rows[0];
  assert.equal(summary["TARGET · CN判定"], "0-copy 候选");
  assert.equal(summary["TARGET · 连续CN"], null);
  assert.equal(detail["CN 判定"], "0-copy 候选");
  assert.equal(detail["连续 CN"], null);
  assert.equal(detail["CN 区间"], "");
});

test("consistent target non-detection with valid reference and calibration is reported as CN 0", () => {
  const scenario = runScenario({
    samples: [
      { name: "Cal", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "Zero", startWell: 3, targetCts: [null, null], referenceCts: [25, 25] },
    ],
    settings: { splitPanels: false, calibrations: { TARGET: { mode: "sample", sampleName: "Cal", copyNumber: 2, independentlyConfirmed: true, confirmationEvidence: "WGS-1" } } },
  });
  const zero = scenario.result("Zero");
  assert.equal(zero.qualityStatus, "ZERO_COPY_CONFIRMED");
  assert.equal(zero.predictedCopyNumber, 0);
  assert.equal(zero.calculatedCopyNumber, null);
  assert.equal(zero.confidenceLike, null);
  assert.equal(zero.absoluteZScore, null);
  const workbook = scenario.workbook({ registration: { runId: "RUN-Z", analysisId: "A-Z", assays: [] } });
  const summary = workbook.sheet("样本CN汇总").rows.find((row) => row["Sample ID"] === "Zero");
  const detail = workbook.sheet("CN计算明细").rows.find((row) => row["Sample ID"] === "Zero");
  assert.equal(summary["TARGET · CN判定"], 0);
  assert.equal(summary["TARGET · 连续CN"], null);
  assert.equal(detail["CN 判定"], 0);
  assert.equal(detail["连续 CN"], null);
  assert.match(detail["0-copy 依据"], /Target Ct 未检出/);
});

test("automatic Ct threshold is accepted and threshold values may differ from 0.2", () => {
  const samples = [{ name: "S1", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] }];
  const automatic = runScenario({
    samples,
    settings: { splitPanels: false },
    recordOverrides: [{ where: {}, values: { ctThreshold: 0.04, automaticCtThreshold: true } }],
  });
  assert.equal(automatic.hasIssue("AUTO_CT_THRESHOLD"), false);
  assert.equal(automatic.hasIssue("CT_THRESHOLD_DEVIATION"), false);
  assert.equal(automatic.hasIssue("CT_THRESHOLD_INCONSISTENT"), false);

  const inconsistent = runScenario({
    samples,
    settings: { splitPanels: false },
    recordOverrides: [
      { where: {}, values: { automaticCtThreshold: false } },
      { where: { targetName: "TARGET", wellPosition: "A1" }, values: { ctThreshold: 0.05 } },
    ],
  });
  assert.equal(inconsistent.hasIssue("CT_THRESHOLD_INCONSISTENT"), true);
});

test("an incomplete or unreviewed record cannot be exported as approved for release", () => {
  const scenario = runScenario({
    samples: [
      { name: "Cal", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "Test", startWell: 3, targetCts: [26, 26], referenceCts: [25, 25] },
    ],
    settings: { splitPanels: false, calibrations: { TARGET: { mode: "sample", sampleName: "Cal", copyNumber: 2, independentlyConfirmed: true, confirmationEvidence: "WGS-1" } } },
  });
  const registration = {
    runId: "RUN-1", plateId: "P-1", analysisId: "A-1", experimentDate: "2026-07-13", operator: "OP",
    reactionVolume: "10 µL", protocolVersion: "SOP-1", recordStatus: "已记录",
    masterMixBrand: "ABI", masterMixCatalog: "CAT", masterMixLot: "LOT", masterMixExpiry: "2027-01-01",
    assays: [
      { target: "TARGET", brand: "Vendor", assayId: "T-1", lot: "TLOT", concentration: "20X" },
      { target: "RNaseP", brand: "Vendor", assayId: "R-1", lot: "RLOT", concentration: "20X" }
    ],
    reviewer: "Reviewer", reviewDate: "2026-07-13", finalDecision: "同意放行"
  };
  let workbook = scenario.workbook({ registration });
  let decision = workbook.sheet("运行登记").rows.find((row) => row["字段"] === "人工复核结论")["本次记录"];
  assert.match(decision, /放行条件未满足/);
  registration.recordStatus = "已复核";
  workbook = scenario.workbook({ registration });
  decision = workbook.sheet("运行登记").rows.find((row) => row["字段"] === "人工复核结论")["本次记录"];
  assert.equal(decision, "同意放行");
  registration.approvalInvalidated = true;
  workbook = scenario.workbook({ registration });
  decision = workbook.sheet("运行登记").rows.find((row) => row["字段"] === "人工复核结论")["本次记录"];
  assert.match(decision, /分析或登记变更后尚未重新复核/);
});

test("integrated registration marks missing manual fields instead of inventing them", () => {
  const scenario = runScenario({
    samples: [{ name: "S1", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] }],
    metadata: { "Experiment Name": "RUN-MISSING" },
    settings: { splitPanels: false },
  });
  const workbook = scenario.workbook({ fileName: "RUN-MISSING.xls", sheetName: "Results", registration: { runId: "RUN-MISSING", analysisId: "A-1", assays: [] } });
  const registrationRows = workbook.sheet("运行登记").rows;
  assert.match(registrationRows.find((row) => row["字段"] === "Run ID / Plate ID / Analysis ID")["本次记录"], /待填写/);
  assert.match(registrationRows.find((row) => row["字段"] === "Master Mix：品牌 \/ Cat\. \/ 批号 \/ 有效期")["本次记录"], /品牌待填写/);
});

test("missing NTC is a warning and does not by itself block release", () => {
  const scenario = runScenario({
    samples: [
      { name: "Cal", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "Test", startWell: 3, targetCts: [26, 26], referenceCts: [25, 25] },
    ],
    settings: { splitPanels: false, calibrations: { TARGET: { mode: "sample", sampleName: "Cal", copyNumber: 2, independentlyConfirmed: true } } },
  });
  const issue = scenario.issue("NO_NTC");
  assert.equal(issue.severity, "warning");
  assert.equal(scenario.assay().calibration.ok, true);
  assert.equal(scenario.analysis.releaseStatus, "READY_FOR_REVIEW");
});

test("an ineligible recorded reference can be replaced only by a confirmed eligible backup", () => {
  const scenario = runScenario({
    samples: [
      { name: "Primary failed", startWell: 1, targetCts: [null, null], referenceCts: [25, 25] },
      { name: "Backup", startWell: 3, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "Test", startWell: 5, targetCts: [26, 26], referenceCts: [25, 25] },
    ],
    metadata: { "Reference Sample": "Primary failed" },
    settings: { splitPanels: false, calibrations: { TARGET: { mode: "sample", sampleName: "Backup", copyNumber: 2, independentlyConfirmed: true } } },
  });
  const assay = scenario.assay();
  assert.equal(assay.calibration.ok, true);
  assert.equal(assay.calibration.config.sampleName, "Backup");
  assert.match(assay.calibration.warnings.join(" "), /禁止自动继承/);
  assert.match(assay.calibration.warnings.join(" "), /备用校准品/);
  assert.equal(scenario.analysis.releaseStatus, "READY_FOR_REVIEW");
});

test("a zero-copy target cannot be selected as calibrator", () => {
  const scenario = runScenario({
    samples: [
      { name: "WrongCal", startWell: 1, targetCts: [null, null], referenceCts: [25, 25] },
      { name: "Positive", startWell: 3, targetCts: [25, 25], referenceCts: [25, 25] },
    ],
    metadata: { "Reference Sample": "WrongCal" },
    settings: { splitPanels: false, calibrations: { TARGET: { mode: "sample", sampleName: "WrongCal", copyNumber: 2, independentlyConfirmed: true } } },
  });
  const assay = scenario.assay();
  const wrong = scenario.result("WrongCal");
  assert.equal(wrong.classification, "ZERO");
  assert.equal(wrong.calibrationEligible, false);
  assert.equal(assay.calibration.ok, false);
  assert.match(assay.calibration.errors.join(" "), /未通过资格检查/);
  assert.match(assay.calibration.warnings.join(" "), /禁止自动继承/);
});

test("reference failure is invalid and is never converted to zero copy", () => {
  const scenario = runScenario({
    samples: [{ name: "BadDNA", startWell: 1, targetCts: [null, null], referenceCts: [null, null] }],
    settings: { splitPanels: false },
  });
  const result = scenario.result("BadDNA");
  assert.equal(result.classification, "INVALID");
  assert.equal(result.predictedCopyNumber, null);
  assert.equal(result.qualityStatus, "INVALID_REFERENCE");
});

test("the same target in duplex and triplex is split by default", () => {
  const samples = [
    { name: "S1", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
    { name: "S1", startWell: 3, targetCts: [25, 25], referenceCts: [25, 25], extraCts: [27, 27] },
  ];
  const split = runScenario({ samples, settings: { splitPanels: true } }).analysis;
  const merged = runScenario({ samples, settings: { splitPanels: false } }).analysis;
  assert.equal(split.assays.filter((x) => x.targetName === "TARGET").length, 2);
  assert.equal(merged.assays.filter((x) => x.targetName === "TARGET").length, 1);
});

test("confidence-like and z-score remain unavailable below seven same-CN samples", () => {
  const samples = Array.from({ length: 6 }, (_, index) => ({
    name: `S${index + 1}`,
    startWell: index * 4 + 1,
    targetCts: [25, 25, 25, 25],
    referenceCts: [25, 25, 25, 25],
  }));
  const scenario = runScenario({
    samples,
    settings: { splitPanels: false, calibrations: { TARGET: { mode: "sample", sampleName: "S1", copyNumber: 2, independentlyConfirmed: true } } },
  });
  const assay = scenario.assay();
  assert.equal(assay.qualityModel.ok, false);
  assert.match(assay.qualityModel.reason, /最大类别仅 6/);
  assert.ok(assay.results.every((x) => x.confidenceLike === null && x.absoluteZScore === null));
  const statuses = scenario.workbook({ registration: { runId: "RUN-METRICS", analysisId: "A-METRICS", assays: [] } }).sheet("CN计算明细").rows.map((row) => row["结果状态"]);
  assert.ok(statuses.every((status) => status === "Confidence/Z-score 暂不可计算（同 CN 样本少于 7 个；不影响 CN 判定）"));
});

test("parser separates QuantStudio numeric Cq Conf from CQCONF flag", () => {
  const aoa = [
    ["Endogenous Control", "RNaseP"],
    ["Well", "Well Position", "Omit", "Sample Name", "Target Name", "Reporter", "CT", "Cq Conf", "CQCONF"],
    [1, "A1", false, "S1", "TARGET", "FAM", 25, 0.91, "N"],
    [1, "A1", false, "S1", "RNaseP", "VIC", 25, 0.98, "Y"]
  ];
  const parsed = core.parseAoA(aoa);
  assert.equal(parsed.records[0].cqConfidence, 0.91);
  assert.equal(parsed.records[0].flags.CQCONF, false);
  assert.equal(parsed.records[1].cqConfidence, 0.98);
  assert.equal(parsed.records[1].flags.CQCONF, true);
});

test("population calibration is blocked when too few nonzero samples are available", () => {
  const samples = Array.from({ length: 3 }, (_, index) => ({
    name: `S${index + 1}`,
    startWell: index * 2 + 1,
    targetCts: [25, 25],
    referenceCts: [25, 25],
  }));
  const scenario = runScenario({
    samples,
    settings: { splitPanels: false, calibrations: { TARGET: { mode: "population", expectedMostFrequentCopyNumber: 2 } } },
  });
  const assay = scenario.assay();
  assert.equal(assay.calibration.ok, false);
  assert.match(assay.calibration.errors.join(" "), /当前仅 3 个/);
});

test("an automatically labelled NTC is excluded from samples and remains auditable", () => {
  const scenario = runScenario({
    samples: [
      { name: "S1", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "NTC", startWell: 3, targetCts: [null, null], referenceCts: [null, null] },
    ],
    settings: { splitPanels: false },
  });
  const assay = scenario.assay();
  assert.equal(scenario.analysis.sampleCount, 1);
  assert.equal(scenario.analysis.ntcSummary.physicalWellCount, 2);
  assert.equal(scenario.hasIssue("NO_NTC"), false);
  assert.equal(scenario.hasIssue("NTC_RECOGNIZED"), true);
  assert.equal(assay.results.some((result) => result.sampleName === "NTC"), false);
  assert.ok(assay.wells.filter((well) => well.sampleName === "NTC").every((well) => well.analysisState === "NTC_CLEAR" && well.roleSource === "AUTO_SAMPLE_NAME"));
});

test("an automatic NTC label on one assay row propagates to the entire physical well", () => {
  const scenario = runScenario({
    samples: [
      { name: "S1", startWell: 1, targetCts: [25], referenceCts: [25] },
      { name: "Unlabelled blank", startWell: 2, targetCts: [null], referenceCts: [null], extraCts: [null], targetTasks: ["NTC"] },
    ],
    settings: { splitPanels: false },
  });
  const ntcRows = scenario.analysis.records.filter((row) => row.wellPosition === "A2");
  assert.equal(ntcRows.length, 3);
  assert.ok(ntcRows.every((row) => row.sampleRole === "NTC" && row.roleSource === "AUTO_TASK"));
  assert.equal(scenario.analysis.sampleCount, 1);
});

test("a confirmed manual sample-level NTC marks every multiplex row and excludes it from CN analysis", () => {
  const scenario = runScenario({
    samples: [
      { name: "S1", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "Sample 9", startWell: 3, targetCts: [null, null], referenceCts: [null, null], extraCts: [null, null] },
    ],
    settings: {
      splitPanels: false,
      ntcAssignment: { mode: "manual_sample", sampleNames: ["Sample 9"], wellPositions: [], confirmed: true, note: "Confirmed from the plate loading record" },
    },
  });
  assert.equal(scenario.analysis.sampleCount, 1);
  assert.equal(scenario.analysis.ntcSummary.physicalWellCount, 2);
  assert.equal(scenario.analysis.ntcSummary.assayRowCount, 6);
  assert.equal(scenario.hasIssue("MANUAL_NTC_ASSIGNMENT"), true);
  assert.equal(scenario.hasIssue("NO_NTC"), false);
  assert.ok(scenario.analysis.records.filter((row) => row.sampleName === "Sample 9").every((row) => row.sampleRole === "NTC" && /MANUAL_SAMPLE/.test(row.roleSource)));
  assert.ok(scenario.analysis.assays.every((assay) => assay.results.every((result) => result.sampleName !== "Sample 9")));
});

test("an unconfirmed manual NTC does not take effect and is blocked", () => {
  const scenario = runScenario({
    samples: [
      { name: "S1", startWell: 1, targetCts: [25], referenceCts: [25] },
      { name: "Blank", startWell: 2, targetCts: [null], referenceCts: [null] },
    ],
    settings: { splitPanels: false, ntcAssignment: { mode: "manual_sample", sampleNames: ["Blank"], confirmed: false, note: "Unconfirmed" } },
  });
  assert.equal(scenario.analysis.sampleCount, 2);
  assert.equal(scenario.analysis.ntcSummary.detected, false);
  assert.equal(scenario.hasIssue("NTC_ASSIGNMENT_UNCONFIRMED", "blocker"), true);
  assert.equal(scenario.hasIssue("NO_NTC", "warning"), true);
});

test("missing NTC coverage for one reaction panel is a warning", () => {
  const scenario = runScenario({
    samples: [
      { name: "S1", startWell: 1, targetCts: [25], referenceCts: [25], extraCts: [27] },
      { name: "NTC", startWell: 2, targetCts: [null], referenceCts: [null] },
    ],
    settings: { splitPanels: true },
  });
  const issue = scenario.issue("NTC_PANEL_MISSING");
  assert.equal(issue.severity, "warning");
  assert.match(issue.message, /EXTRA/);
});

test("manual well-level NTC applies to every row in the physical well and warns on a partial sample", () => {
  const scenario = runScenario({
    samples: [{ name: "Shared label", startWell: 1, targetCts: [25, null], referenceCts: [25, null], extraCts: [27, null] }],
    settings: {
      splitPanels: false,
      ntcAssignment: { mode: "manual_wells", sampleNames: [], wellPositions: ["A2"], confirmed: true, note: "A2 was the no-template reaction" },
    },
  });
  const selectedRows = scenario.analysis.records.filter((row) => row.wellPosition === "A2");
  assert.equal(selectedRows.length, 3);
  assert.ok(selectedRows.every((row) => row.sampleRole === "NTC" && /MANUAL_WELL/.test(row.roleSource)));
  assert.ok(scenario.analysis.records.filter((row) => row.wellPosition === "A1").every((row) => row.sampleRole === "SAMPLE"));
  assert.equal(scenario.hasIssue("PARTIAL_SAMPLE_AS_NTC"), true);
  assert.equal(scenario.analysis.sampleCount, 1);
});

test("any numeric target or reference Ct in NTC is a release blocker", () => {
  const scenario = runScenario({
    samples: [
      { name: "S1", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "Blank target", startWell: 3, targetCts: [34], referenceCts: [null] },
      { name: "Blank reference", startWell: 4, targetCts: [null], referenceCts: [31] },
    ],
    settings: {
      splitPanels: false,
      ntcAssignment: { mode: "manual_sample", sampleNames: ["Blank target", "Blank reference"], confirmed: true, note: "Confirmed blanks" },
      calibrations: { TARGET: { mode: "sample", sampleName: "S1", copyNumber: 2, independentlyConfirmed: true } },
    },
  });
  assert.equal(scenario.assay().calibration.ok, true);
  const issue = scenario.issue("NTC_AMPLIFICATION");
  assert.equal(issue.severity, "blocker");
  assert.match(issue.message, /A3\/TARGET Ct=34/);
  assert.match(issue.message, /A4\/RNaseP Ct=31/);
  assert.equal(scenario.analysis.releaseStatus, "HOLD");
});

test("unknown manual NTC selectors and NTC-calibrator overlap are blocked", () => {
  const scenario = runScenario({
    samples: [
      { name: "Cal", startWell: 1, targetCts: [25, 25], referenceCts: [25, 25] },
      { name: "S2", startWell: 3, targetCts: [26, 26], referenceCts: [25, 25] },
    ],
    settings: {
      splitPanels: false,
      ntcAssignment: { mode: "manual_sample", sampleNames: ["Cal", "Missing sample"], confirmed: true, note: "Plate record" },
      calibrations: { TARGET: { mode: "sample", sampleName: "Cal", copyNumber: 2, independentlyConfirmed: true } },
    },
  });
  assert.equal(scenario.hasIssue("NTC_SELECTOR_NOT_FOUND"), true);
  assert.equal(scenario.hasIssue("NTC_CALIBRATOR_CONFLICT"), true);
  assert.equal(scenario.analysis.releaseStatus, "HOLD");
});

test("manual NTC sample IDs are matched exactly and do not collapse case-distinct samples", () => {
  const scenario = runScenario({
    samples: [
      { name: "SampleA", startWell: 1, targetCts: [null, null], referenceCts: [null, null] },
      { name: "samplea", startWell: 3, targetCts: [25, 25], referenceCts: [25, 25] },
    ],
    settings: {
      splitPanels: false,
      ntcAssignment: { mode: "manual_sample", sampleNames: ["SampleA"], confirmed: true, note: "Exact plate ID" },
      calibrations: { TARGET: { mode: "sample", sampleName: "samplea", copyNumber: 2, independentlyConfirmed: true } },
    },
  });
  assert.ok(scenario.analysis.records.filter((row) => row.sampleName === "SampleA").every((row) => row.sampleRole === "NTC"));
  assert.ok(scenario.analysis.records.filter((row) => row.sampleName === "samplea").every((row) => row.sampleRole === "SAMPLE"));
  assert.equal(scenario.analysis.sampleCount, 1);
  assert.equal(scenario.hasIssue("NTC_CALIBRATOR_CONFLICT"), false);
  assert.equal(scenario.assay().calibration.ok, true);
});

test("manual NTC without an audit note and a plate with no analytical samples are blocked", () => {
  const scenario = runScenario({
    samples: [{ name: "Blank", startWell: 1, targetCts: [null], referenceCts: [null] }],
    settings: { splitPanels: false, ntcAssignment: { mode: "manual_sample", sampleNames: ["Blank"], confirmed: true, note: "" } },
  });
  assert.equal(scenario.hasIssue("NTC_ASSIGNMENT_NOTE_MISSING"), true);
  assert.equal(scenario.hasIssue("NO_ANALYTICAL_SAMPLES"), true);
  assert.equal(scenario.analysis.releaseStatus, "HOLD");
});

test("P24 can be designated as a manual NTC on a 384-well plate", () => {
  const scenario = runScenario({
    plateFormat: 384,
    samples: [
      { name: "S1", startWell: 1, targetCts: [25], referenceCts: [25] },
      { name: "Blank384", wellNumbers: [384], wellPositions: ["P24"], targetCts: [null], referenceCts: [null] },
    ],
    metadata: { "Block Type": "384-well" },
    settings: { splitPanels: false, ntcAssignment: { mode: "manual_wells", wellPositions: ["P24"], confirmed: true, note: "P24 was left without template" } },
  });
  assert.equal(scenario.analysis.plateFormat, 384);
  assert.equal(scenario.analysis.ntcSummary.physicalWellCount, 1);
  assert.ok(scenario.analysis.records.filter((row) => row.wellPosition === "P24").every((row) => row.sampleRole === "NTC"));
  assert.equal(scenario.analysis.sampleCount, 1);
});

test("384-well positions are inferred and parsed without a fixed row-count assumption", () => {
  const scenario = runScenario({
    plateFormat: 384,
    samples: [{ name: "S384", wellNumbers: [384], wellPositions: ["P24"], targetCts: [25], referenceCts: [25] }],
    settings: { splitPanels: false },
  });
  assert.deepEqual(core.parseWellPosition("P24"), { row: 16, column: 24, label: "P24" });
  assert.equal(scenario.analysis.plateFormat, 384);
  assert.equal(scenario.hasIssue("WELL_OUTSIDE_PLATE"), false);
});
