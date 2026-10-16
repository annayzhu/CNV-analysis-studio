// Optional browser acceptance check. Supply PLAYWRIGHT_MODULE when it is not installed locally.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const XLSX = require("../vendor/xlsx.full.min.js");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), "cnv-layout-qa-"));
function workbook(sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}
const wells = ["A1", "B1", "A2", "B2"];
const instrument = workbook({ Results: [["Well", "Sample", "Target", "Reporter", "CT"], ...wells.flatMap((well, i) => [
  [well, "", "GSTM1", "FAM", i < 2 ? 25 : 26], [well, "", "RNaseP", "VIC", 25],
])] });
const planner = workbook({
  "Well Details P01": [["Well", "Sample"], ...wells.map((well, i) => [well, i < 2 ? "Cal" : "00123"])],
  "Well Details P02": [["Well", "Sample"], ["A1", "Wrong plate"]],
  "Run Summary": [["每孔总体积 / Total per well (µL)", 10], ["板号", "P01"], ["实验日期", "2026/10/14"], ["操作人", "Planner technician"], ["Protocol / SOP 版本", "SOP-001"], ["Master Mix 品牌", "Mix vendor"], ["Master Mix 货号", "000123"], ["Master Mix 批号", "000456"], ["Master Mix 有效期", new Date("2027-03-31T00:00:00Z")], ["复核人", "Reviewer"], ["复核日期", "2026/10/15"], ["复核说明", "Check controls"], ["实验备注", "Planner note"]],
  "Assay & Dyes": [["Assay name", "Assay ID", "Reporter", "Brand", "Lot", "Concentration", "Quencher"], ["GSTM1", "Assay-001", "FAM", "Assay vendor", "000789", "20X", "NFQ-MGB"]],
  "Reaction Setup": [["TaqMan mix", 5, 22, "master-mix"]],
});
async function upload(page, selector, buffer, name) {
  if (selector === "#layout-file") await page.locator('[data-layout-source="file"]').click();
  await page.locator(selector).setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
}
async function beginAnalysis(page) {
  await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
  assert.equal(await page.locator("#workspace").isHidden(), true);
  await page.locator("#start-analysis").click();
}
async function confirmReplacement(page, accept, selector = "#layout-apply") {
  const prompt = page.waitForEvent("dialog");
  const click = page.locator(selector).click();
  const dialog = await prompt;
  assert.match(dialog.message(), /覆盖.*现有样本名/);
  await (accept ? dialog.accept() : dialog.dismiss());
  await click;
}
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "cnvtool.html")).href);
    assert.equal(await page.locator("#layout-import-section").isVisible(), true);
    assert.equal(await page.locator("#layout-file").isVisible(), true);
    assert.equal(await page.locator("#layout-paste").isHidden(), true);
    assert.equal(await page.evaluate(() => {
      const instrument = document.querySelector("#data-section");
      const layout = document.querySelector("#layout-import-section");
      return instrument.parentElement === layout.parentElement &&
        getComputedStyle(instrument.querySelector("h2")).fontSize === getComputedStyle(layout.querySelector("h2")).fontSize;
    }), true, "optional layout import has the same hierarchy as instrument import");
    const format = await page.locator("#layout-template-format").boundingBox();
    const downloadButton = await page.locator("#layout-template").boundingBox();
    const uploadButton = await page.locator(".layout-file-label").boundingBox();
    assert.ok(Math.abs(format.y + format.height - downloadButton.y - downloadButton.height) < 1, "template controls share a baseline");
    assert.equal(downloadButton.height, format.height);
    if (!mobile) assert.ok(Math.abs(uploadButton.y + uploadButton.height - format.y - format.height) < 1, "upload and template controls share a baseline");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.argv.includes("--screenshots")) await page.locator("#layout-import-section").screenshot({ path: path.join(output, mobile ? "layout-entry-390.png" : "layout-entry-1440.png") });
    assert.equal(await page.locator("#start-analysis").isDisabled(), true);
    assert.equal(await page.locator("#drop-zone").isVisible(), true);
    assert.equal(await page.locator("#uploaded-file").isHidden(), true);
    await page.evaluate(() => {
      const analyze = window.CopyNumberCore.analyze;
      window.analysisCalls = 0;
      window.CopyNumberCore.analyze = (...args) => { window.analysisCalls += 1; return analyze(...args); };
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await upload(page, "#file-input", instrument, "unnamed.xlsx");
    await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
    assert.equal(await page.evaluate(() => window.analysisCalls), 0, "file import must not calculate");
    assert.equal(await page.evaluate(() => window.scrollY), 0, "file import must not scroll");
    assert.equal(await page.locator("#layout-import-section").isVisible(), true);
    assert.equal(await page.locator("#workspace").isHidden(), true);
    assert.equal(await page.locator("#drop-zone").isHidden(), true);
    assert.equal(await page.locator("#uploaded-file-name").innerText(), "unnamed.xlsx");
    assert.match(await page.locator("#uploaded-file-details").innerText(), /已导入.*Results/);
    if (!mobile) assert.ok((await page.locator("#uploaded-file").boundingBox()).height < 64, "uploaded file is a compact row");

    const replacementName = "2026-10-12_cnv01cnv02(1)_GSTM1_GSTT1_384well_results.xlsx";
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#replace-file").click();
    await (await chooser).setFiles({ name: replacementName, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: instrument });
    await page.waitForFunction(name => document.querySelector("#uploaded-file-name").textContent === name, replacementName);
    assert.equal(await page.evaluate(() => window.analysisCalls), 0, "reselection must not calculate");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "long filenames must fit narrow screens");
    if (process.argv.includes("--screenshots")) await page.locator("#data-section").screenshot({ path: path.join(output, mobile ? "uploaded-file-390.png" : "uploaded-file-1440.png") });
    await upload(page, "#file-input", workbook({ Empty: [["not an instrument result"]] }), "invalid.xlsx");
    await page.waitForFunction(() => document.querySelector("#file-status .status-dot--error"));
    assert.equal(await page.locator("#uploaded-file-name").innerText(), replacementName, "failed replacements preserve the previous file");
    assert.equal(await page.locator("#start-analysis").isEnabled(), true);
    await page.locator("#remove-file").click();
    assert.equal(await page.locator("#uploaded-file").isHidden(), true);
    assert.equal(await page.locator("#drop-zone").isVisible(), true);
    assert.equal(await page.locator("#start-analysis").isDisabled(), true);
    const initialChooser = page.waitForEvent("filechooser");
    await page.locator("#drop-zone").press("Enter");
    await (await initialChooser).setFiles({ name: "unnamed.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: instrument });
    await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
    if (process.argv.includes("--screenshots")) await page.locator(".shell").screenshot({ path: path.join(output, mobile ? "before-analysis-390.png" : "before-analysis-1440.png") });
    await beginAnalysis(page);
    assert.equal(await page.evaluate(() => window.analysisCalls), 1);
    await page.waitForFunction(() => document.querySelector("#sample-status").textContent.includes("4 个孔缺少"));
    assert.equal(await page.locator("#layout-import-section").isHidden(), true);
    assert.equal(await page.locator("#layout-panel").getAttribute("open"), null);
    assert.equal(await page.locator(".ntc-status").innerText(), "无 NTC（允许）");
    assert.equal(await page.locator("#ntc-manual-fields").isHidden(), true);
    assert.equal(await page.locator("#ntc-auto-panel").count(), 0, "remove the redundant automatic NTC callout");
    assert.equal(await page.locator("#setting-min-reps").locator("..").locator("small").innerText(), "推荐 4 复孔。");
    assert.equal(await page.locator("#ntc-mode-help").isHidden(), true);
    if (!mobile) assert.equal(await page.evaluate(() => {
      const select = document.querySelector("#setting-ntc-mode").getBoundingClientRect();
      const button = document.querySelector("#apply-ntc").getBoundingClientRect();
      const qc = document.querySelector("#qc-list").getBoundingClientRect();
      const ntc = document.querySelector("#ntc-setup").getBoundingClientRect();
      return Math.abs(select.bottom - button.bottom) < 1 && Math.abs(qc.left - ntc.left) < 1 && Math.abs(qc.right - ntc.right) < 1;
    }), true, "automatic NTC controls and card edges align");
    if (process.argv.includes("--screenshots")) await page.locator("#ntc-setup").screenshot({ path: path.join(output, `ntc-auto-${mobile ? 390 : 1440}.png`) });
    await page.locator("#setting-ntc-mode").selectOption("manual_wells");
    assert.equal(await page.locator("#ntc-well-panel").isVisible(), true);
    assert.equal(await page.locator("#ntc-manual-fields").isVisible(), true);
    if (!mobile) assert.equal(await page.evaluate(() => Math.abs(document.querySelector("#setting-ntc-mode").getBoundingClientRect().top - document.querySelector("#ntc-well-panel .ntc-candidates").getBoundingClientRect().top) < 1), true, "manual NTC control tops align");
    if (process.argv.includes("--screenshots")) await page.locator("#ntc-setup").screenshot({ path: path.join(output, `ntc-manual-${mobile ? 390 : 1440}.png`) });
    await page.locator("#setting-ntc-mode").selectOption("auto");
    assert.equal(await page.locator("#ntc-message").innerText(), "");
    assert.equal(await page.locator("#ntc-choice-panel").isHidden(), true);
    await page.locator("#supplement-layout").click();
    await page.locator('[data-layout-source="paste"]').click();
    assert.equal(await page.locator("#layout-file-controls").isHidden(), true);
    await page.locator("#layout-paste").fill("Well\tSample\nA1\tCal\nB1\tCal\nA2\t00123\nB2\t00123");
    await page.locator("#layout-read-paste").click();
    if (process.argv.includes("--screenshots")) await page.locator("#sample-section").screenshot({ path: path.join(output, mobile ? "paste-390.png" : "paste-1440.png") });
    await page.locator("#layout-apply").click();
    assert.match(await page.locator("#sample-status").innerText(), /已更新 2 个样本/);
    assert.equal(await page.locator("#layout-message").innerText(), "");
    assert.equal(await page.locator("#record-volume").inputValue(), "");
    assert.equal(await page.locator("#stat-samples").innerText(), "2");
    await page.locator("#record-volume").fill("12 µL");
    await page.locator("#supplement-layout").click();
    await upload(page, "#layout-file", planner, "planner.xlsx");
    await page.waitForFunction(() => document.querySelector("#layout-plate").options.length === 3);
    assert.equal(await page.locator("#layout-apply").isDisabled(), true);
    await page.locator("#layout-plate").selectOption("0");
    await page.locator("#layout-apply").click();
    assert.equal(await page.locator("#record-volume").inputValue(), "12 µL");
    await page.locator(".cal-mode").selectOption("sample");
    await page.locator(".cal-sample").selectOption("Cal");
    await page.locator(".cal-confirmed").check();
    assert.equal(await page.locator(".cal-evidence").inputValue(), "");
    assert.equal(await page.locator(".cal-selection-note").inputValue(), "");
    assert.match(await page.locator(".cal-evidence").locator("..").innerText(), /选填/);
    await page.locator("#apply-calibration").click();
    const resultRow = page.locator("#results-table tbody tr").filter({ hasText: "00123" });
    assert.equal(await resultRow.locator("td").nth(11).innerText(), "1");
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    assert.ok(await page.locator('[data-panel="copyplot"] svg').count(), "printing includes result panels not yet opened");
    const registrationFields = { "record-plate-id": "P01", "record-date": "2026-10-14", "record-operator": "Technician", "record-protocol": "SOP-1", "record-mix-brand": "Vendor", "record-mix-catalog": "Cat-1", "record-mix-lot": "Lot-1", "record-mix-expiry": "2027-10-14", "record-reviewer": "Reviewer", "record-review-date": "2026-10-14" };
    for (const [id, value] of Object.entries(registrationFields)) await page.locator("#" + id).fill(value);
    for (const field of ["brand", "id", "lot", "concentration"]) {
      for (const input of await page.locator(".record-assay-" + field).all()) await input.fill("Recorded");
    }
    await page.locator("#record-final-decision").selectOption("同意放行");
    assert.equal(await page.locator("#record-final-decision").inputValue(), "同意放行");
    await page.locator("#record-operator").fill("Updated technician");
    assert.equal(await page.locator("#record-final-decision").inputValue(), "待复核");
    for (const tab of ["copyplot", "dctplot", "plate", "wells", "method", "summary"]) {
      await page.locator(`[data-tab="${tab}"]`).click();
      assert.ok(await page.locator(`[data-panel="${tab}"]`).innerHTML());
    }
    await page.locator("#save-registration").click();
    await page.reload();
    await upload(page, "#file-input", instrument, "unnamed.xlsx");
    await beginAnalysis(page);
    await page.waitForFunction(() => document.querySelector("#sample-status").textContent.includes("已更新 2 个样本"));
    assert.equal(await page.locator("#record-volume").inputValue(), "12 µL");
    await page.locator("#supplement-layout").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#layout-template").click();
    const download = await downloadPromise;
    const template = XLSX.read(await readFile(await download.path()), { type: "buffer" });
    const styled = XLSX.read(await readFile(await download.path()), { type: "buffer", cellNF: true });
    assert.equal(styled.Sheets.Samples.B2.z, "@");
    assert.equal(XLSX.utils.sheet_to_json(template.Sheets.Samples, { header: 1 }).length, 5);
    assert.deepEqual(template.SheetNames, ["Samples", "Run Summary", "Assay & Dyes", "填写说明"]);
    assert.equal(styled.Sheets["Run Summary"].B2.z, "@");
    assert.equal(styled.Sheets["Assay & Dyes"].E2.z, "@");
    assert.equal(styled.Sheets["Assay & Dyes"].A2.v, "GSTM1");
    assert.equal(styled.Sheets["Assay & Dyes"].B2.v, "FAM");
    if (process.argv.includes("--screenshots")) await page.locator("#sample-section").screenshot({ path: path.join(output, mobile ? "mobile.png" : "desktop.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator("#remove-file").click();
    assert.equal(await page.locator("#workspace").isHidden(), true);
    assert.equal(await page.locator("#layout-import-section").isVisible(), true);
    assert.equal(await page.locator("#layout-preview").isHidden(), true);
    assert.equal(await page.locator("#start-analysis").isDisabled(), true);
    await upload(page, "#file-input", instrument, "unnamed.xlsx");
    await beginAnalysis(page);
    assert.match(await page.locator("#sample-status").innerText(), /已更新 2 个样本/, "removal does not delete saved registration");
    await context.close();
  }
  for (const order of ["instrument-first", "layout-first"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "cnvtool.html")).href);
    if (order === "instrument-first") {
      await upload(page, "#file-input", instrument, "unnamed.xlsx");
      await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
    }
    await upload(page, "#layout-file", planner, "planner.xlsx");
    await page.waitForFunction(() => document.querySelector("#layout-plate").options.length === 3);
    assert.equal(await page.locator("#start-analysis").isDisabled(), true);
    assert.equal(await page.locator("#layout-apply").isHidden(), true);
    await page.locator("#layout-plate").selectOption("0");
    if (order === "layout-first") await upload(page, "#file-input", instrument, "unnamed.xlsx");
    await beginAnalysis(page);
    await page.waitForFunction(() => document.querySelector("#sample-status").textContent.includes("已更新 2 个样本"));
    assert.equal(await page.locator("#record-volume").inputValue(), "10 µL");
    assert.equal(await page.locator("#record-mix-name").inputValue(), "TaqMan mix");
    assert.equal(await page.locator(".record-assay-id").first().inputValue(), "Assay-001");
    const expectedRegistration = { "record-plate-id": "P01", "record-date": "2026-10-14", "record-operator": "Planner technician", "record-protocol": "SOP-001", "record-mix-brand": "Mix vendor", "record-mix-catalog": "000123", "record-mix-lot": "000456", "record-mix-expiry": "2027-03-31", "record-reviewer": "Reviewer", "record-review-date": "2026-10-15", "record-review-note": "Check controls", "record-notes": "Planner note" };
    for (const [id, value] of Object.entries(expectedRegistration)) assert.equal(await page.locator("#" + id).inputValue(), value, id);
    for (const [field, value] of Object.entries({ brand: "Assay vendor", lot: "000789", concentration: "20X", quencher: "NFQ-MGB" })) assert.equal(await page.locator(".record-assay-" + field).first().inputValue(), value, field);
    assert.equal(await page.locator("#record-status").inputValue(), "草稿");
    assert.notEqual(await page.locator("#record-final-decision").inputValue(), "同意放行");
    if (process.argv.includes("--screenshots") && order === "instrument-first") await page.locator("#record-section").screenshot({ path: path.join(output, "registration-import.png") });
    const exportPromise = page.waitForEvent("download");
    await page.locator("#export-xlsx").click();
    const exported = XLSX.read(await readFile(await (await exportPromise).path()), { type: "buffer" });
    const raw = XLSX.utils.sheet_to_json(exported.Sheets["原始Ct"]);
    assert.equal(raw.length, 8);
    assert.equal(raw[0]["仪器样本名"], "");
    assert.equal(raw[0]["样本名来源"], "planner.xlsx / P01");
    assert.equal(raw[0].Ct, 25);
    // A replacement instrument file returns to preparation, without reusing a previous run's layout.
    // A different filename alone is still the same saved file (content fingerprint).
    const secondInstrument = workbook({ Results: [["Experiment Name", "Second run"], ["Well", "Sample", "Target", "Reporter", "CT"], ...wells.flatMap((well, i) => [
      [well, "", "GSTM1", "FAM", i < 2 ? 25 : 26], [well, "", "RNaseP", "VIC", 25],
    ])] });
    await upload(page, "#file-input", secondInstrument, "second-run.xlsx");
    await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
    assert.equal(await page.locator("#layout-preview").isHidden(), true);
    await beginAnalysis(page);
    assert.match(await page.locator("#sample-status").innerText(), /4 个孔缺少样本名/);
    assert.equal(await page.locator("#stat-samples").innerText(), "0");
    await context.close();
  }
  const fullWells = Array.from({ length: 384 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 24)) + (i % 24 + 1));
  const placeholderInstrument = workbook({ Results: [["Well", "Sample", "Target", "CT", "THOLDFAIL"], ...fullWells.flatMap((well, i) => [
    [well, "Sample 1", "GSTM1", i < 24 ? 25 : 26, "Y"], [well, "Sample 1", "RNaseP", 25, "Y"],
  ])] });
  const correctedPlate = workbook({ "Paste_QS_P01": [["Well", "Sample"], ...fullWells.map((well, i) => [well, "Sample_" + String(Math.floor(i / 24) + 1).padStart(3, "0")])] });
  for (const width of [1440, 760, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "cnvtool.html")).href);
    await upload(page, "#file-input", placeholderInstrument, "placeholder-384.xlsx");
    await beginAnalysis(page);
    await page.waitForFunction(() => document.querySelector("#stat-wells").textContent === "384");
    assert.equal(await page.locator("#stat-samples").innerText(), "1");
    assert.doesNotMatch(await page.locator("#sample-status").innerText(), /信息完整/);
    assert.equal(await page.locator("#qc-list").innerText().then(text => text.includes("NO_NTC")), false);
    assert.match(await page.locator("#qc-list").innerText(), /阈值识别失败（THOLDFAIL）768/);
    await page.locator("#supplement-layout").click();
    await upload(page, "#layout-file", correctedPlate, "corrected-384.xlsx");
    await page.waitForFunction(() => document.querySelector("#layout-preview-count").textContent.includes("覆盖 384 孔"));
    assert.ok((await page.locator("#layout-preview-table").boundingBox()).height <= 137);
    assert.equal(await page.locator("#layout-paste").isHidden(), true);
    if (width >= 760) {
      // Read both controls in one frame: import scrolls smoothly, so separate reads can have different viewport offsets.
      const [plate, apply] = await page.evaluate(() => ["#layout-plate", "#layout-apply"].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { y: rect.y, height: rect.height };
      }));
      assert.ok(Math.abs(plate.y + plate.height / 2 - apply.y - apply.height / 2) <= 1, "plate and apply controls share one row");
      assert.ok((await page.locator("#sample-section").boundingBox()).height < 420, "uploaded layout preview stays compact");
    }
    if (process.argv.includes("--screenshots")) {
      await page.locator(".summary-strip").screenshot({ path: path.join(output, `summary-${width}.png`) });
      await page.locator("#sample-section").screenshot({ path: path.join(output, `replace-preview-${width}.png`) });
    }
    await confirmReplacement(page, false);
    assert.equal(await page.locator("#stat-samples").innerText(), "1");
    await confirmReplacement(page, true);
    assert.equal(await page.locator("#stat-samples").innerText(), "16");
    assert.match(await page.locator("#sample-status").innerText(), /已更新 16 个样本/);
    assert.equal(await page.locator("#layout-message").innerText(), "");
    assert.equal(await page.locator("#layout-panel").getAttribute("open"), null);
    await page.locator("#save-registration").click();
    await page.reload();
    await upload(page, "#file-input", placeholderInstrument, "placeholder-384.xlsx");
    await beginAnalysis(page);
    await page.waitForFunction(() => document.querySelector("#stat-samples").textContent === "16");
    const download = page.waitForEvent("download");
    await page.locator("#export-xlsx").click();
    const book = XLSX.read(await readFile(await (await download).path()), { type: "buffer" });
    const measurements = XLSX.utils.sheet_to_json(book.Sheets["原始Ct"]);
    assert.equal(measurements.length, 768);
    assert.ok(measurements.every(row => row["仪器样本名"] === "Sample 1"));
    assert.equal(measurements[0]["Sample ID"], "Sample_001");
    assert.equal(measurements[0].Ct, 25);
    assert.equal(measurements[0]["样本名来源"], "corrected-384.xlsx / P01");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.argv.includes("--screenshots")) await page.locator("#sample-section").screenshot({ path: path.join(output, `updated-${width}.png`) });
    if (width === 760) {
      await page.locator("#setting-ntc-mode").selectOption("manual_sample");
      await page.locator('.ntc-sample-choice[value="Sample_001"]').check();
      await page.locator("#setting-ntc-note").fill("Synthetic control assignment for rename regression");
      await page.locator("#setting-ntc-confirmed").check();
      await page.locator("#apply-ntc").click();
      assert.equal(await page.locator("#stat-samples").innerText(), "15");
      await page.locator("#supplement-layout").click();
      await page.locator('[data-layout-source="paste"]').click();
      await page.locator("#layout-paste").fill("Well\tSample\nA1\tRenamed control");
      await page.locator("#layout-read-paste").click();
      await confirmReplacement(page, true);
      assert.equal(await page.locator(".ntc-status").innerText(), "已识别 24 孔");
      assert.equal(await page.locator("#stat-samples").innerText(), "15");
    }
    await context.close();
  }
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "cnvtool.html")).href);
    await upload(page, "#file-input", placeholderInstrument, "placeholder-384.xlsx");
    await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
    await upload(page, "#layout-file", planner, "multi-plate.xlsx");
    await page.waitForFunction(() => document.querySelector("#layout-plate").options.length === 3);
    assert.equal(await page.locator("#start-analysis").isDisabled(), true);
    await page.locator("#remove-file").click();
    assert.equal(await page.locator("#layout-preview").isVisible(), true, "removing an instrument before analysis preserves the optional layout");
    await upload(page, "#file-input", placeholderInstrument, "placeholder-384.xlsx");
    await page.waitForFunction(() => !document.querySelector("#uploaded-file").hidden);
    await page.locator("#layout-clear").click();
    assert.equal(await page.locator("#start-analysis").isEnabled(), true, "layout remains optional after removing a draft");
    await upload(page, "#layout-file", correctedPlate, "corrected-384.xlsx");
    await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
    await confirmReplacement(page, false, "#start-analysis");
    assert.equal(await page.locator("#workspace").isHidden(), true);
    assert.equal(await page.locator("#layout-preview").isVisible(), true);
    await confirmReplacement(page, true, "#start-analysis");
    assert.equal(await page.locator("#stat-samples").innerText(), "16");
    await page.locator(".cal-mode").selectOption("population");
    await page.locator(".cal-mode-cn").fill("1");
    await page.locator("#apply-calibration").click();
    assert.match(await page.locator("#toast").innerText(), /校准已锁定.*众数 CN=1/);
    assert.equal(await page.locator(".guard-message--error").count(), 0);
    assert.doesNotMatch(await page.locator("#calibration-section").innerText(), /不保证|校准已锁定/);
    await page.waitForFunction(() => !document.querySelector("#toast").textContent);
    if (process.argv.includes("--screenshots")) await page.locator("#calibration-section").screenshot({ path: path.join(output, "population-confirmed.png") });
    await context.close();
  }
  // Two assay cards reproduce the real calibration UI using synthetic, non-identifying measurements.
  const dualInstrument = workbook({ Results: [["Well", "Sample", "Target", "Reporter", "CT"], ...wells.flatMap((well, i) => [
    [well, i < 2 ? "Cal" : "Sample_002", "GSTM1", "FAM", i < 2 ? 25 : 26],
    [well, i < 2 ? "Cal" : "Sample_002", "GSTT1", "CY5", i < 2 ? 25 : 26],
    [well, i < 2 ? "Cal" : "Sample_002", "RNaseP", "VIC", 25],
  ])] });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "cnvtool.html")).href);
    await upload(page, "#file-input", dualInstrument, "synthetic-dual-assay.xlsx");
    await beginAnalysis(page);
    await page.waitForFunction(() => document.querySelectorAll(".calibration-card").length === 2);
    for (const card of await page.locator(".calibration-card").all()) {
      await card.locator(".cal-mode").selectOption("sample");
      await card.locator(".cal-sample").selectOption("Cal");
      await card.locator(".cal-confirmed").check();
    }
    await page.locator("#apply-calibration").click();
    assert.equal(await page.locator(".guard-message--ok").count(), 0);
    assert.match(await page.locator("#toast").innerText(), /校准已锁定/);
    await page.waitForFunction(() => !document.querySelector("#toast").classList.contains("is-visible"));
    assert.equal(await page.locator("#toast").innerText(), "");
    assert.doesNotMatch(await page.locator("#calibration-section").innerText(), /校准已锁定/);
    assert.equal(await page.locator("#calibration-section h2").innerText(), "按 assay 校准");
    await page.locator("#apply-settings").click();
    assert.match(await page.locator("#toast").innerText(), /参数已应用/);
    await page.waitForFunction(() => !document.querySelector("#toast").textContent);
    assert.equal(await page.locator(".cal-evidence").first().inputValue(), "");
    assert.equal(await page.locator(".cal-selection-note").first().inputValue(), "");
    assert.doesNotMatch(await page.locator("#record-section").innerText(), /校准依据.*未填写/);
    if (process.argv.includes("--screenshots")) await page.locator("#calibration-section").screenshot({ path: path.join(output, `optional-calibration-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", screenshots: process.argv.includes("--screenshots") ? output : null, cases: ["late paste", "late workbook only fills samples", "multi-plate selection", "CN=1", "approval and re-review", "registration restore", "template download", "early registration import", "XLSX audit roundtrip", "desktop/mobile", "print all panels", "384-well replacement confirmation/cancel", "sample count 1 to 16", "saved replacements restored", "original-name audit"] }, null, 2));
} finally { await browser.close(); }
