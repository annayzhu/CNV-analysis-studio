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
    await page.locator("#supplement-layout").click();
    await page.locator("#layout-paste").fill("Well\tSample\nA1\tCal\nB1\tCal\nA2\t00123\nB2\t00123");
    await page.locator("#layout-read-paste").click();
    await page.locator("#layout-apply").click();
    assert.match(await page.locator("#sample-status").innerText(), /样本信息完整/);
    assert.equal(await page.locator("#record-volume").inputValue(), "");
    assert.equal(await page.locator("#stat-samples").innerText(), "2");
    await page.locator("#record-volume").fill("12 µL");
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
    await page.waitForFunction(() => document.querySelector("#sample-status").textContent.includes("样本信息完整"));
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
  await page.waitForFunction(() => document.querySelector("#sample-status").textContent.includes("样本信息完整"));
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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", screenshots: process.argv.includes("--screenshots") ? output : null, cases: ["late paste", "late workbook only fills samples", "multi-plate selection", "CN=1", "approval and re-review", "registration restore", "template download", "early registration import", "XLSX audit roundtrip", "desktop/mobile", "print all panels"] }, null, 2));
} finally { await browser.close(); }
