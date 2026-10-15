(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CopyNumberLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) { return value == null ? "" : String(value).trim(); }
  function key(value) { return text(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, ""); }
  function wellName(value) {
    var match = /^([A-P])0*([1-9]\d?)$/i.exec(text(value));
    return match && Number(match[2]) <= 24 ? match[1].toUpperCase() + Number(match[2]) : "";
  }

  var REGISTRATION_FIELDS = {
    plateId: ["板号 / Plate ID", "Plate ID", "板号"], experimentDate: ["实验日期 / Experiment date", "Experiment date", "实验日期"],
    operator: ["操作人 / Operator", "Operator", "操作人"], reactionVolume: ["反应体积 (µL)", "Reaction volume", "反应体积", "每孔总体积", "总反应体积"],
    protocolVersion: ["Protocol / SOP 版本", "Protocol", "SOP version", "SOP 版本"],
    masterMixName: ["Master Mix 名称", "Master Mix name"], masterMixBrand: ["Master Mix 品牌", "Master Mix brand"],
    masterMixCatalog: ["Master Mix 货号", "Master Mix Cat.", "Master Mix catalog"],
    masterMixLot: ["Master Mix 批号", "Master Mix lot"], masterMixExpiry: ["Master Mix 有效期", "Master Mix expiry"],
    reviewer: ["复核人 / Reviewer", "Reviewer", "复核人"], reviewDate: ["复核日期 / Review date", "Review date", "复核日期"],
    reviewNote: ["复核说明", "Review note"], notes: ["实验备注 / Notes", "Notes", "实验备注", "实验 / 分析备注"]
  };
  var ASSAY_FIELDS = {
    target: ["Assay name / 靶标", "Assay name", "Target", "Target name", "靶标"], reporter: ["Reporter"],
    assayId: ["Assay ID"], brand: ["品牌 / Brand", "Brand", "品牌"], lot: ["批号 / Lot", "Lot", "批号"],
    concentration: ["浓度 / Concentration", "Concentration", "浓度"], quencher: ["Quencher"]
  };

  function matches(value, aliases) {
    var label = key(text(value).split("/")[0].replace(/[（(].*$/, ""));
    return aliases.some(function (alias) { return key(alias.split("/")[0].replace(/[（(].*$/, "")) === label; });
  }

  function readRegistration(sheets) {
    var registration = { assays: [] };
    sheets.forEach(function (sheet) {
      if (/^(Run Summary|Reaction Setup|Experiment Info|实验信息|实验登记|运行登记)$/i.test(sheet.name)) {
        sheet.rows.forEach(function (row) {
          Object.keys(REGISTRATION_FIELDS).forEach(function (field) {
            if (matches(row[0], REGISTRATION_FIELDS[field]) && text(row[1])) registration[field] = text(row[1]);
          });
          if (row[3] === "master-mix") registration.masterMixName = text(row[0]);
        });
      }
      if (!/^(Assay & Dyes|Assays|试剂信息)$/i.test(sheet.name)) return;
      var columns = {};
      var header = sheet.rows.findIndex(function (row) {
        Object.keys(ASSAY_FIELDS).forEach(function (field) { columns[field] = row.findIndex(function (cell) { return matches(cell, ASSAY_FIELDS[field]); }); });
        return columns.target >= 0;
      });
      if (header < 0) return;
      sheet.rows.slice(header + 1).forEach(function (row) {
        var assay = {};
        Object.keys(columns).forEach(function (field) { assay[field] = text(row[columns[field]]); });
        if (assay.target) registration.assays.push(assay);
      });
    });
    if (registration.reactionVolume && /^\d+(\.\d+)?$/.test(registration.reactionVolume)) registration.reactionVolume += " µL";
    ["experimentDate", "masterMixExpiry", "reviewDate"].forEach(function (field) {
      var match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(registration[field]);
      if (match) registration[field] = match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
      else delete registration[field];
    });
    return registration;
  }

  // File and clipboard adapters both supply named two-dimensional sheets.
  function parseSheets(sheets) {
    var plates = new Map();
    sheets.forEach(function (sheet) {
      var wellColumn, sampleColumn, plateColumn;
      var header = sheet.rows.findIndex(function (row) {
        var keys = row.map(key);
        wellColumn = keys.findIndex(function (v) { return ["well", "wellposition", "孔位", "孔位坐标"].includes(v); });
        sampleColumn = keys.findIndex(function (v) { return ["sample", "samplename", "sampleid", "样本", "样本名", "样本编号"].includes(v); });
        plateColumn = keys.findIndex(function (v) { return ["plate", "plateid", "板号"].includes(v); });
        return wellColumn >= 0 && sampleColumn >= 0;
      });
      if (header < 0) {
        if (!sheet.rows.length || !wellName(sheet.rows[0][0])) return;
        wellColumn = 0; sampleColumn = 1; plateColumn = -1;
      }
      var suffix = /^(?:Well Details |Paste_QS_|Paste_Legacy_)P(\d+)$/i.exec(sheet.name);
      var defaultId = suffix ? "P" + suffix[1].padStart(2, "0") : sheet.name;
      sheet.rows.slice(header + 1).forEach(function (row, index) {
        var sample = text(row[sampleColumn]);
        if (!sample) return;
        var well = wellName(row[wellColumn]);
        if (!well) throw new Error(sheet.name + " 第 " + (header + index + 2) + " 行孔位无效；请使用 A1–P24 格式。");
        var id = plateColumn >= 0 ? text(row[plateColumn]) : defaultId;
        if (!id) throw new Error("包含 Plate 列时，每条样本记录都需要板号。");
        if (!plates.has(id)) plates.set(id, { id: id, samples: new Map() });
        var samples = plates.get(id).samples;
        if (samples.has(well) && samples.get(well) !== sample) throw new Error(id + " / " + well + " 对应多个样本名，请核对板布局。");
        samples.set(well, sample);
      });
    });
    if (!plates.size) throw new Error("没有找到已填写的 Well / Sample 两列；请选择板布局文件，或填好模板后上传。");
    return { plates: Array.from(plates.values(), function (plate) { return { id: plate.id, samples: Object.fromEntries(plate.samples) }; }), registration: readRegistration(sheets) };
  }

  function applySamples(records, plate, source, overwriteExisting) {
    var present = new Set(records.map(function (r) { return r.wellPosition; }));
    var conflicts = new Set();
    records.forEach(function (record) {
      var planned = plate.samples[record.wellPosition];
      if (planned && record.sampleName && record.sampleName !== planned) conflicts.add(record.wellPosition);
    });
    var filled = new Set();
    var overwritten = new Set();
    var changed = new Set();
    var result = records.map(function (record) {
      var sample = plate.samples[record.wellPosition];
      if (!sample || record.sampleName === sample) return record;
      if (!overwriteExisting && (record.sampleName || conflicts.has(record.wellPosition))) return record;
      (record.sampleName ? overwritten : filled).add(record.wellPosition);
      changed.add(record.wellPosition);
      return Object.assign({}, record, {
        sampleName: sample,
        originalSampleName: record.originalSampleName === undefined ? record.sampleName : record.originalSampleName,
        sampleNameSource: source + " / " + plate.id
      });
    });
    return { records: result, filledWells: Array.from(filled), overwrittenWells: Array.from(overwritten), changedWells: Array.from(changed), conflicts: Array.from(conflicts), unmatchedWells: Object.keys(plate.samples).filter(function (well) { return !present.has(well); }) };
  }

  function templateRows(wells) {
    return [["Well", "Sample"]].concat(Array.from(new Set(wells), function (well) { return [well, ""]; }));
  }

  function templateSheets(wells, assays) {
    var assayFields = Object.keys(ASSAY_FIELDS);
    return [
      { name: "Samples", rows: templateRows(wells), widths: [12, 28] },
      { name: "Run Summary", rows: [["字段 / Field", "填写内容 / Value"]].concat(Object.keys(REGISTRATION_FIELDS).map(function (field) { return [REGISTRATION_FIELDS[field][0], ""]; })), widths: [36, 52] },
      { name: "Assay & Dyes", rows: [assayFields.map(function (field) { return ASSAY_FIELDS[field][0]; })].concat((assays && assays.length ? assays : [{}, {}, {}]).map(function (assay) {
        return assayFields.map(function (field) { return field === "target" || field === "reporter" ? text(assay[field]) : ""; });
      })), widths: [24, 16, 24, 24, 22, 22, 20] },
      { name: "填写说明", widths: [24, 100], rows: [
        ["工作表", "填写方式"],
        ["Samples", "填写 Well / Sample 两列；样本编号按文本保存，可保留前导零。未使用的孔可留空。"],
        ["Run Summary", "填写本次实验的板号、日期、操作人、反应体积、SOP、Master Mix 和复核信息；无信息可留空。日期使用 YYYY-MM-DD。"],
        ["Assay & Dyes", "每行一个靶标/Reporter 组合；名称与仪器结果一致。可填写品牌、Assay ID、批号、浓度和 Quencher。"],
        ["第一步导入", "点击“开始分析”后，样本信息按孔位应用，实验与试剂信息自动补入登记空白项。"],
        ["分析后补录", "在“样本信息”中导入本模板时，只更新样本和孔位，不修改实验登记。"],
        ["记录与复核", "Run ID、Analysis ID、仪器参数和 CN 结果由软件生成；记录状态及最终结论在分析后人工确认。"],
      ] }
    ];
  }

  function fillRegistration(current, supplied, source) {
    var result = Object.assign({}, current);
    var imported = [];
    function fill(target, incoming, fields, prefix) {
      fields.forEach(function (field) {
        if (!text(target[field]) && text(incoming[field])) {
          target[field] = incoming[field];
          imported.push((prefix || "") + field);
        }
      });
    }
    fill(result, supplied, Object.keys(REGISTRATION_FIELDS));
    result.assays = (current.assays || []).map(function (assay) {
      var copy = Object.assign({}, assay);
      var candidates = supplied.assays.filter(function (item) {
        return key(item.target) === key(assay.target) && (!item.reporter || key(item.reporter) === key(assay.reporter));
      });
      if (candidates.length === 1) fill(copy, candidates[0], ["brand", "assayId", "lot", "concentration", "quencher"], assay.target + ".");
      return copy;
    });
    if (imported.length) result.layoutImport = { source: source, fields: imported };
    return result;
  }

  return { parseSheets: parseSheets, applySamples: applySamples, templateRows: templateRows, templateSheets: templateSheets, fillRegistration: fillRegistration };
});
