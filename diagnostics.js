(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CopyNumberDiagnostics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(code, severity, params) {
    if (!code) throw new Error("Diagnostic code is required.");
    return Object.freeze({
      code: String(code),
      severity: severity || "info",
      params: Object.freeze(Object.assign({}, params || {}))
    });
  }

  function list(value) {
    return Array.isArray(value) ? value.join("、") : "";
  }

  function format(diagnostic) {
    if (!diagnostic) return "";
    if (typeof diagnostic === "string") return diagnostic;
    var p = diagnostic.params || {};
    var templates = {
      NTC_ASSIGNMENT_UNCONFIRMED: function () { return "已选择人工 NTC，但尚未确认这些孔在实验中确实未加入模板；本次选择未生效。"; },
      NTC_ASSIGNMENT_NOTE_MISSING: function () { return "人工 NTC 缺少可追溯说明；请填写加样记录或实验依据。"; },
      NTC_SELECTOR_NOT_FOUND: function () { return "人工 NTC 中存在导入文件未找到的选择：" + [p.missingSamples && p.missingSamples.length ? "样本 " + p.missingSamples.join("/") : "", p.missingWells && p.missingWells.length ? "孔位 " + p.missingWells.join("/") : ""].filter(Boolean).join("；") + "。"; },
      MANUAL_NTC_ASSIGNMENT: function () { return "已人工确认 " + p.wellCount + " 个物理孔为 NTC（" + list(p.wells) + "）；原样本名保留，这些孔不参与 CN 计算或校准。"; },
      PARTIAL_SAMPLE_AS_NTC: function () { return "样本名“" + p.sampleName + "”仅有 " + p.selectedCount + "/" + p.totalCount + " 个物理孔被指定为 NTC；同名其他孔仍作为分析样本。"; },
      NTC_WELL_SAMPLE_CONFLICT: function () { return p.well + " 孔存在多个样本名，人工 NTC 不能用于掩盖孔位冲突。"; },
      NTC_CALIBRATOR_CONFLICT: function () { return "NTC 与已配置校准样本重叠：" + list(p.sampleNames) + "。请重新确认 NTC 后再锁定校准。"; },
      NO_ANALYTICAL_SAMPLES: function () { return "所有记录都被标记为 NTC，没有可进行 CN 分析的样本。"; },
      WELL_SAMPLE_CONFLICT: function () { return p.well + " 同一物理孔出现多个样本名：" + list(p.sampleNames); },
      DUPLICATE_WELL_TARGET: function () { return p.well + " 的同一 target 出现 " + p.count + " 条记录，无法确定唯一测量。"; },
      EXPIRED_DYE_CALIBRATION: function () { return p.reporter + " 纯染料校准已过期，该批数据只能查看，不建议放行。"; },
      EXPIRED_INSTRUMENT_CALIBRATION: function () { return p.calibrationName + " 校准已过期。"; },
      CT_THRESHOLD_INCONSISTENT: function () { return p.target + " 在本次运行中使用了多个 Ct threshold：" + (p.values || []).join("/") + "。请确认同一 assay 的阈值设置是否一致且可追溯。"; },
      AUTO_BASELINE_OFF: function () { return p.recordCount + " 条记录没有启用自动基线。"; },
      NO_NTC: function () { return "未识别或确认 NTC；本次可继续人工复核，但无法据此排除污染或非特异扩增。若实验中确有 NTC 但 plate setup 漏标，可在下方补标；如本次未设置 NTC，软件不能补造。"; },
      NTC_RECOGNIZED: function () { return "已识别 " + p.wellCount + " 个 NTC 物理孔：" + list(p.wells) + "。"; },
      NTC_PANEL_MISSING: function () { return "以下反应组合没有对应 NTC：" + (p.panels || []).join("；") + "。本次可继续人工复核，但不能据此排除这些 panel 的污染或非特异扩增。"; },
      WELL_OUTSIDE_PLATE: function () { return p.well + " 超出 " + p.plateFormat + " 孔板范围。"; },
      WELL_NUMBER_MISMATCH: function () { return p.well + " 应对应 Well=" + p.expectedWellNumber + "，但文件记录为 " + p.actualWellNumber + "。"; },
      REPORTER_MAPPING_CONFLICT: function () { return p.target + " 在同一文件中对应多个 reporter：" + (p.reporters || []).join("/") + "。"; },
      NTC_AMPLIFICATION: function () { return "NTC 的 target 或内参通道出现数值 Ct：" + (p.details || []).join("；") + (p.additionalCount ? "；另有 " + p.additionalCount + " 条" : "") + "。需排查污染、非特异扩增或 NTC 误标。"; },
      SOURCE_FLAGS_PRESENT: function () { return "仪器原始 flags：" + Object.keys(p.counts || {}).map(function (flag) { return flag + "=" + p.counts[flag]; }).join("；") + "。本工具保留全部 flags，不会仅凭单一 flag 静默删孔。"; },
      NO_REFERENCE_ASSAY: function () { return "无法确定内参 assay。"; },
      TARGET_IN_MULTIPLE_PANELS: function () { return p.target + " 出现在 " + p.panelCount + " 种反应组合中：" + (p.panels || []).join("；") + (p.splitPanels ? "。已按反应组合分开分析。" : "。当前已合并，需确认桥接验证。"); },
      RECORDED_REFERENCE_NOT_IN_ASSAY: function () { return "导出文件记录的 Reference Sample“" + p.referenceSample + "”不在该 assay 中。请改选本板通过资格检查且已独立确认 CN 的备用校准品或校准组。"; },
      RECORDED_REFERENCE_INELIGIBLE: function () { return "原运行设置中的 Reference Sample“" + p.referenceSample + "”不符合 " + p.target + " 校准资格，已禁止自动继承。请改选本板通过检查且已独立确认 CN 的备用校准品或校准组；不会从普通样本中自动替换。"; },
      RECORDED_REFERENCE_HISTORY_ONLY: function () { return "原运行 Reference Sample“" + p.referenceSample + "”仅作历史记录；未经独立拷贝数确认前不会自动启用。"; },
      CALIBRATION_MODE_MISSING: function () { return "未配置校准方式。"; },
      CALIBRATOR_SAMPLE_NOT_FOUND: function () { return "所选校准样本不存在。"; },
      CALIBRATOR_SAMPLE_INELIGIBLE: function () { return "所选校准样本未通过资格检查（目标未扩增、内参无效、复孔不足或 SD 超限）。"; },
      CALIBRATOR_COPY_NUMBER_INVALID: function () { return "校准样本拷贝数必须 >0。"; },
      CALIBRATOR_CONFIRMATION_REQUIRED: function () { return "必须确认该校准样本的拷贝数已由独立依据确认。"; },
      CALIBRATOR_GROUP_TOO_SMALL: function () { return "已知校准组至少需要 " + p.minimum + " 个样本；当前仅 " + p.actual + " 个。"; },
      CALIBRATOR_GROUP_INELIGIBLE: function () { return "校准组中存在未通过资格检查的样本。"; },
      CALIBRATOR_GROUP_COPY_NUMBER_INVALID: function () { return "校准组拷贝数必须 >0。"; },
      CALIBRATOR_GROUP_CONFIRMATION_REQUIRED: function () { return "必须确认该组样本的拷贝数已由独立依据确认。"; },
      POPULATION_SAMPLE_COUNT_INSUFFICIENT: function () { return "群体校准至少需要 " + p.minimum + " 个非零拷贝可用样本；当前仅 " + p.actual + " 个。"; },
      POPULATION_EXPECTED_MODE_INVALID: function () { return "预期众数拷贝数必须为正整数；0-copy 不参与对数模型拟合。"; },
      POPULATION_NO_NONZERO_SAMPLES: function () { return "没有可用的非零拷贝样本。"; },
      POPULATION_MODEL_FIT_FAILED: function () { return "无法在给定的众数拷贝数下拟合群体模型。"; },
      POPULATION_APPROXIMATION: function () { return "该结果为公开原理的透明近似，不保证与 CopyCaller 官方软件逐值一致。"; },
      CALIBRATION_MODE_UNSUPPORTED: function () { return "不支持的校准方式：" + p.mode; },
      QUALITY_GROUP_SIZE_INSUFFICIENT: function () { return "至少需要 " + p.minimum + " 个相同拷贝数的样本；当前最大类别仅 " + p.largestGroup + " 个。"; },
      QUALITY_MODEL_TRANSPARENT_APPROXIMATION: function () { return "透明高斯后验估计，未实施 CopyCaller 的 bootstrap 5% 下限。"; },
      CALIBRATION_CANDIDATE_ELIGIBLE: function () { return "可选，仍需独立确认已知拷贝数"; },
      CALIBRATION_CANDIDATE_NONZERO_REQUIRED: function () { return "目标非稳定非零扩增"; },
      CALIBRATION_CANDIDATE_REPLICATES_INSUFFICIENT: function () { return "有效复孔不足"; },
      CALIBRATION_CANDIDATE_SD_EXCEEDED: function () { return "复孔 SD 超过校准品限值"; }
    };
    return templates[diagnostic.code] ? templates[diagnostic.code]() : diagnostic.code;
  }

  function formatMany(diagnostics, separator) {
    return (diagnostics || []).map(format).join(separator === undefined ? "; " : separator);
  }

  return { create: create, format: format, formatMany: formatMany };
});
