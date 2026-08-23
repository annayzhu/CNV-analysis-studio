"use strict";

const core = require("../../core.js");

function wellPositionFromNumber(wellNumber, plateFormat) {
  const columns = plateFormat === 384 ? 24 : 12;
  const zeroBased = wellNumber - 1;
  return String.fromCharCode(65 + Math.floor(zeroBased / columns)) + ((zeroBased % columns) + 1);
}

function measurement({ wellNumber, wellPosition, sampleName, targetName, ct, reporter, task }) {
  return {
    sourceRow: wellNumber,
    wellNumber,
    wellPosition,
    omit: false,
    sampleName,
    targetName,
    task: task || "UNKNOWN",
    reporter,
    ctRaw: ct === null ? "Undetermined" : ct,
    ct,
    automaticCtThreshold: false,
    ctThreshold: 0.2,
    automaticBaseline: true,
    ampStatus: ct === null ? "No Amp" : "Amp",
    flags: { THOLDFAIL: false, CQCONF: false, NOAMP: ct === null, EXPFAIL: false },
  };
}

function matchesOverride(record, where) {
  return Object.entries(where || {}).every(([key, value]) => record[key] === value);
}

function compileRecords(spec) {
  const referenceName = spec.referenceName || "RNaseP";
  const targetName = spec.targetName || "TARGET";
  const extraTargetName = spec.extraTargetName || "EXTRA";
  const plateFormat = spec.plateFormat || 96;
  const records = [];

  for (const sample of spec.samples || []) {
    const targetCts = sample.targetCts || [];
    const referenceCts = sample.referenceCts || [];
    if (targetCts.length !== referenceCts.length) {
      throw new Error(`Scenario sample ${sample.name} has mismatched target/reference replicate counts`);
    }
    if (sample.extraCts && sample.extraCts.length !== targetCts.length) {
      throw new Error(`Scenario sample ${sample.name} has mismatched extra-target replicate counts`);
    }

    targetCts.forEach((targetCt, index) => {
      const wellNumber = sample.wellNumbers?.[index] ?? ((sample.startWell || 1) + index);
      const wellPosition = sample.wellPositions?.[index] || wellPositionFromNumber(wellNumber, plateFormat);
      records.push(measurement({
        wellNumber,
        wellPosition,
        sampleName: sample.name,
        targetName: sample.targetName || targetName,
        ct: targetCt,
        reporter: sample.targetReporter || "FAM",
        task: sample.targetTasks?.[index] || sample.task,
      }));
      if (sample.extraCts) {
        records.push(measurement({
          wellNumber,
          wellPosition,
          sampleName: sample.name,
          targetName: sample.extraTargetName || extraTargetName,
          ct: sample.extraCts[index],
          reporter: sample.extraReporter || "CY5",
          task: sample.extraTasks?.[index] || sample.task,
        }));
      }
      records.push(measurement({
        wellNumber,
        wellPosition,
        sampleName: sample.name,
        targetName: referenceName,
        ct: referenceCts[index],
        reporter: sample.referenceReporter || "VIC",
        task: sample.referenceTasks?.[index] || sample.task,
      }));
    });
  }

  for (const override of spec.recordOverrides || []) {
    const matched = records.filter((record) => matchesOverride(record, override.where));
    if (!matched.length) throw new Error(`Scenario record override matched no rows: ${JSON.stringify(override.where)}`);
    matched.forEach((record) => Object.assign(record, override.values));
  }
  return records;
}

function findAssay(analysis, targetName, panelSignature) {
  const matches = analysis.assays.filter((assay) =>
    assay.targetName === targetName &&
    (panelSignature === undefined || assay.panelSignature === panelSignature));
  if (matches.length !== 1) {
    throw new Error(`Expected one assay for ${targetName}; found ${matches.length}`);
  }
  return matches[0];
}

function runScenario(spec) {
  const records = compileRecords(spec);
  const referenceName = spec.referenceName || "RNaseP";
  const metadata = { "Endogenous Control": referenceName, ...(spec.metadata || {}) };
  const analysis = core.analyze(records, metadata, spec.settings || {});

  return {
    analysis,
    assay(targetName = spec.targetName || "TARGET", panelSignature) {
      return findAssay(analysis, targetName, panelSignature);
    },
    result(sampleName, targetName = spec.targetName || "TARGET", panelSignature) {
      const result = findAssay(analysis, targetName, panelSignature).results.find((item) => item.sampleName === sampleName);
      if (!result) throw new Error(`No result for sample ${sampleName} in assay ${targetName}`);
      return result;
    },
    issue(code) {
      return analysis.runIssues.find((item) => item.code === code);
    },
    hasIssue(code, severity) {
      return analysis.runIssues.some((item) => item.code === code && (severity === undefined || item.severity === severity));
    },
    workbook(context) {
      const integrated = core.buildIntegratedExport(analysis, context || {});
      return {
        integrated,
        sheet(name) {
          const sheet = integrated.sheets.find((item) => item.name === name);
          if (!sheet) throw new Error(`No exported sheet named ${name}`);
          return sheet;
        },
      };
    },
  };
}

module.exports = { runScenario };

