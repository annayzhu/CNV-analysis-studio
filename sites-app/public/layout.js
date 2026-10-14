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
    plateId: ["Plate ID", "板号"], experimentDate: ["Experiment date", "实验日期"],
    operator: ["Operator", "操作人"], reactionVolume: ["Reaction volume", "反应体积", "每孔总体积", "总反应体积"],
    protocolVersion: ["Protocol", "SOP version", "Protocol / SOP 版本"],
    masterMixName: ["Master Mix name", "Master Mix 名称"], masterMixBrand: ["Master Mix brand", "Master Mix 品牌"],
    masterMixCatalog: ["Master Mix Cat.", "Master Mix catalog", "Master Mix 货号"],
    masterMixLot: ["Master Mix lot", "Master Mix 批号"], masterMixExpiry: ["Master Mix expiry", "Master Mix 有效期"]
  };
  var ASSAY_FIELDS = {
    target: ["Assay name", "Target", "Target name", "靶标"], reporter: ["Reporter"],
    assayId: ["Assay ID"], brand: ["Brand", "品牌"], lot: ["Lot", "批号"],
    concentration: ["Concentration", "浓度"], quencher: ["Quencher"]
  };

  function matches(value, aliases) {
    var label = key(text(value).split("/")[0].replace(/[（(].*$/, ""));
    return aliases.some(function (alias) { return key(alias) === label; });
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
    ["experimentDate", "masterMixExpiry"].forEach(function (field) {
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

  function applySamples(records, plate, source) {
    var present = new Set(records.map(function (r) { return r.wellPosition; }));
    var conflicts = new Set();
    records.forEach(function (record) {
      var planned = plate.samples[record.wellPosition];
      if (planned && record.sampleName && record.sampleName !== planned) conflicts.add(record.wellPosition);
    });
    var filled = new Set();
    var result = records.map(function (record) {
      var sample = plate.samples[record.wellPosition];
      if (record.sampleName || !sample || conflicts.has(record.wellPosition)) return record;
      filled.add(record.wellPosition);
      return Object.assign({}, record, {
        sampleName: sample,
        originalSampleName: "",
        sampleNameSource: source + " / " + plate.id
      });
    });
    return { records: result, filledWells: Array.from(filled), conflicts: Array.from(conflicts), unmatchedWells: Object.keys(plate.samples).filter(function (well) { return !present.has(well); }) };
  }

  function templateRows(wells) {
    return [["Well", "Sample"]].concat(Array.from(new Set(wells), function (well) { return [well, ""]; }));
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

  return { parseSheets: parseSheets, applySamples: applySamples, templateRows: templateRows, fillRegistration: fillRegistration };
});
