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
  "Run Summary": [["每孔总体积 / Total per well (µL)", 10]],
  "Assay & Dyes": [["Assay name", "Assay ID", "Reporter"], ["GSTM1", "Assay-001", "FAM"]],
  "Reaction Setup": [["TaqMan mix", 5, 22, "master-mix"]],
});
const upload = (page, selector, buffer, name) => page.locator(selector).setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
async function confirmReplacement(page, accept) {
  const prompt = page.waitForEvent("dialog");
  const click = page.locator("#layout-apply").click();
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
    await upload(page, "#file-input", instrument, "unnamed.xlsx");
    await page.waitForFunction(() => document.querySelector("#sample-status").textContent.includes("4 个孔缺少"));
    assert.equal(await page.locator(".ntc-status").innerText(), "无 NTC（允许）");
    assert.equal(await page.locator("#ntc-manual-fields").isHidden(), true);
    await page.locator("#supplement-layout").click();
    await page.locator("#layout-paste").fill("Well\tSample\nA1\tCal\nB1\tCal\nA2\t00123\nB2\t00123");
    await page.locator("#layout-read-paste").click();
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
    await page.locator(".cal-evidence").fill("Verified calibrator record");
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
    if (process.argv.includes("--screenshots")) await page.locator("#sample-section").screenshot({ path: path.join(output, mobile ? "mobile.png" : "desktop.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root, "cnvtool.html")).href);
  await page.locator("#layout-summary").click();
  await upload(page, "#layout-file", planner, "planner.xlsx");
  await page.waitForFunction(() => document.querySelector("#layout-plate").options.length === 3);
  await page.locator("#layout-plate").selectOption("0");
  await page.locator("#layout-apply").click();
  await upload(page, "#file-input", instrument, "unnamed.xlsx");
  await page.waitForFunction(() => document.querySelector("#sample-status").textContent.includes("已更新 2 个样本"));
  assert.equal(await page.locator("#record-volume").inputValue(), "10 µL");
  assert.equal(await page.locator("#record-mix-name").inputValue(), "TaqMan mix");
  assert.equal(await page.locator(".record-assay-id").first().inputValue(), "Assay-001");
  const exportPromise = page.waitForEvent("download");
  await page.locator("#export-xlsx").click();
  const exported = XLSX.read(await readFile(await (await exportPromise).path()), { type: "buffer" });
  const raw = XLSX.utils.sheet_to_json(exported.Sheets["原始Ct"]);
  assert.equal(raw.length, 8);
  assert.equal(raw[0]["仪器样本名"], "");
  assert.equal(raw[0]["样本名来源"], "planner.xlsx / P01");
  assert.equal(raw[0].Ct, 25);
  await context.close();
  const fullWells = Array.from({ length: 384 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 24)) + (i % 24 + 1));
  const placeholderInstrument = workbook({ Results: [["Well", "Sample", "Target", "CT", "THOLDFAIL"], ...fullWells.flatMap((well, i) => [
    [well, "Sample 1", "GSTM1", i < 24 ? 25 : 26, "Y"], [well, "Sample 1", "RNaseP", 25, "Y"],
  ])] });
  const correctedPlate = workbook({ "Paste_QS_P01": [["Well", "Sample"], ...fullWells.map((well, i) => [well, "Sample_" + String(Math.floor(i / 24) + 1).padStart(3, "0")])] });
  for (const width of [760, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "cnvtool.html")).href);
    await upload(page, "#file-input", placeholderInstrument, "placeholder-384.xlsx");
    await page.waitForFunction(() => document.querySelector("#stat-wells").textContent === "384");
    assert.equal(await page.locator("#stat-samples").innerText(), "1");
    assert.doesNotMatch(await page.locator("#sample-status").innerText(), /信息完整/);
    assert.equal(await page.locator("#qc-list").innerText().then(text => text.includes("NO_NTC")), false);
    assert.match(await page.locator("#qc-list").innerText(), /阈值识别失败（THOLDFAIL）768/);
    await page.locator("#supplement-layout").click();
    await upload(page, "#layout-file", correctedPlate, "corrected-384.xlsx");
    await page.waitForFunction(() => document.querySelector("#layout-preview-count").textContent.includes("覆盖 384 孔"));
    assert.ok((await page.locator("#layout-preview-table").boundingBox()).height <= 137);
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
      await page.locator("#layout-paste").fill("Well\tSample\nA1\tRenamed control");
      await page.locator("#layout-read-paste").click();
      await confirmReplacement(page, true);
      assert.equal(await page.locator(".ntc-status").innerText(), "已识别 24 孔");
      assert.equal(await page.locator("#stat-samples").innerText(), "15");
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", screenshots: process.argv.includes("--screenshots") ? output : null, cases: ["late paste", "late workbook only fills samples", "multi-plate selection", "CN=1", "approval and re-review", "registration restore", "template download", "early registration import", "XLSX audit roundtrip", "desktop/mobile", "print all panels", "384-well replacement confirmation/cancel", "sample count 1 to 16", "saved replacements restored", "original-name audit"] }, null, 2));
} finally { await browser.close(); }
