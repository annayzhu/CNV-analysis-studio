// Browser acceptance: registration recovery and reusable reagent batches.
// PLAYWRIGHT_MODULE points to an existing Playwright install; no runtime dependency is added.
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
const output = await mkdtemp(path.join(tmpdir(), "cnv-registration-qa-"));
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ["Well", "Sample", "Target", "Reporter", "CT"],
  ...Array.from({ length: 8 }, (_, i) => [
    [`A${i + 1}`, i < 4 ? "Cal" : "Sample", "GSTM1", "FAM", i < 4 ? 25 : 26],
    [`A${i + 1}`, i < 4 ? "Cal" : "Sample", "RNaseP", "VIC", 25],
  ]).flat(),
]), "Results");
const instrument = Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));

async function importRun(page) {
  await page.locator("#file-input").setInputFiles({ name: "2020-01-01-results.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: instrument });
  await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
  await page.locator("#start-analysis").click();
}

async function exportedAnalysis(page) {
  const downloaded = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const payload = JSON.parse(await readFile(await (await downloaded).path(), "utf8"));
  const { generatedAt, ...analysis } = payload.analysis;
  return analysis;
}

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Shanghai", acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  // UTC is still October 15; the experiment date must use the user's October 16.
  await page.clock.setFixedTime(new Date("2026-10-15T16:30:00Z"));
  await page.goto(pathToFileURL(path.join(root, "cnvtool.html")).href);
  await importRun(page);
  assert.equal(await page.locator("#record-date").inputValue(), "2026-10-16", "new registration defaults to today, not the instrument filename date");
  await page.locator(".cal-mode").selectOption("sample");
  await page.locator(".cal-sample").selectOption("Cal");
  await page.locator(".cal-confirmed").check();
  await page.locator("#apply-calibration").click();
  assert.equal(await page.locator("#results-table tbody tr").filter({ hasText: "Sample" }).locator("td").nth(11).innerText(), "1");
  const originalAnalysis = await exportedAnalysis(page);
  await page.locator("#record-date").fill("2026-10-12");
  await page.locator("#record-plate-id").fill("P-RECOVERY");
  await page.locator("#record-mix-lot").fill("MIX-001");
  await page.locator("#record-reviewer").fill("Reviewer");
  await page.locator("#record-notes").fill("Unsaved button edits survive refresh");
  // Refresh immediately: pending automatic saves must be flushed on leaving the page.
  await page.reload();
  assert.equal(await page.locator("#workspace").isVisible(), true, "refresh restores the previous analysis without another file import");
  assert.equal(await page.locator("#record-date").inputValue(), "2026-10-12", "restored records keep their actual experiment date");
  assert.equal(await page.locator("#record-plate-id").inputValue(), "P-RECOVERY");
  assert.equal(await page.locator("#record-mix-lot").inputValue(), "MIX-001");
  assert.equal(await page.locator("#record-notes").inputValue(), "Unsaved button edits survive refresh");
  assert.equal(await page.locator("#uploaded-file-name").innerText(), "2020-01-01-results.xlsx");
  assert.match(await page.locator("#record-save-status").innerText(), /已保存/);
  assert.deepEqual(await exportedAnalysis(page), originalAnalysis, "recovery leaves calculations, QC and measurements unchanged");
  await page.locator("#remove-file").click();
  await page.reload();
  assert.equal(await page.locator("#workspace").isHidden(), true, "removing a file also clears automatic session recovery");
  await importRun(page);
  assert.equal(await page.locator("#record-plate-id").inputValue(), "P-RECOVERY", "removal keeps the saved registration available for reimport");

  const mixBatches = page.locator('[data-batch-scope="mix"]');
  assert.equal(await mixBatches.count(), 1, "Master Mix has its own reusable batch controls");
  await page.locator("#record-mix-name").fill("TaqMan Mix");
  await page.locator("#record-mix-brand").fill("Mix vendor");
  await page.locator("#record-mix-expiry").fill("2027-01-01");
  await mixBatches.getByRole("button", { name: "保存批次", exact: true }).click();
  await mixBatches.locator("select").selectOption("");
  await page.locator("#record-mix-lot").fill("MIX-002");
  await mixBatches.getByRole("button", { name: "保存批次", exact: true }).click();
  await mixBatches.locator("select").selectOption({ label: "MIX-001 · TaqMan Mix" });
  assert.equal(await page.locator("#record-mix-lot").inputValue(), "MIX-001");
  await page.locator("#record-mix-expiry").fill("2028-02-02");
  await mixBatches.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.reload();
  await mixBatches.locator("select").selectOption({ label: "MIX-001 · TaqMan Mix" });
  assert.equal(await page.locator("#record-mix-expiry").inputValue(), "2028-02-02", "edited batches persist across refresh");
  page.once("dialog", dialog => dialog.accept());
  await mixBatches.getByRole("button", { name: "删除", exact: true }).click();
  assert.equal(await mixBatches.locator("option").filter({ hasText: "MIX-001" }).count(), 0);
  assert.equal(await mixBatches.locator("option").filter({ hasText: "MIX-002" }).count(), 1, "deletion removes only the selected batch");
  assert.equal(await page.locator("#record-mix-lot").inputValue(), "MIX-001", "deletion does not erase the experiment's recorded batch");

  const assay = page.locator('.registration-assay-row[data-assay-key="GSTM1|FAM"]');
  await assay.locator(".record-assay-lot").fill("ASSAY-001");
  await assay.locator(".record-assay-id").fill("Hs-test-cn");
  await assay.getByRole("button", { name: "保存批次", exact: true }).click();
  assert.equal(await page.locator('[data-batch-scope="RNaseP|VIC"] option').filter({ hasText: "ASSAY-001" }).count(), 0, "batches are scoped to the matching assay");
  assert.deepEqual(await exportedAnalysis(page), originalAnalysis, "batch management does not alter exported analysis results");
  assert.equal(await page.evaluate(() => {
    const section = document.querySelector("#record-section");
    const size = selector => parseFloat(getComputedStyle(section.querySelector(selector)).fontSize);
    return size("h2") > size("h3") && size("h3") > size("input") && size("input") > size(".record-grid label > span");
  }), true, "titles, subsection headings, input text and labels have a consistent hierarchy");
  assert.equal(await page.locator(".record-subsection").first().evaluate(el => getComputedStyle(el).borderLeftWidth), "0px", "registration subsections do not add nested cards");
  await page.waitForFunction(() => !document.querySelector("#toast").textContent && document.querySelector("#record-save-status").textContent.includes("已保存"));
  for (const width of [1440, 760, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal page overflow at ${width}px`);
    if (process.argv.includes("--screenshots")) {
      for (const [section, name] of [["#record-section", "registration"], ["#calibration-section", "calibration"]]) {
        // Fit each section in the capture without a sticky navigation bar covering its title.
        const height = Math.ceil((await page.locator(section).boundingBox()).height) + 100;
        await page.setViewportSize({ width, height });
        await page.locator(section).evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "instant" }));
        await page.locator(section).screenshot({ path: path.join(output, `${name}-${width}.png`) });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A genuinely different result file starts a new record, not the saved previous run.
  XLSX.utils.sheet_add_aoa(book.Sheets.Results, [["A1", "Cal", "GSTM1", "FAM", 25.1]], { origin: "A2" });
  await page.locator("#file-input").setInputFiles({ name: "second-run.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })) });
  await page.waitForFunction(() => !document.querySelector("#start-analysis").disabled);
  assert.equal(await page.locator("#workspace").isHidden(), true, "new imports still require clicking Start analysis");
  await page.locator("#start-analysis").click();
  assert.equal(await page.locator("#record-date").inputValue(), "2026-10-16");
  assert.equal(await page.locator("#record-mix-lot").inputValue(), "", "new runs do not automatically inherit a reagent lot");
  await mixBatches.locator("select").selectOption({ label: "MIX-002 · TaqMan Mix" });
  assert.equal(await page.locator("#record-mix-name").inputValue(), "TaqMan Mix");
  assert.equal(await page.locator("#record-reviewer").inputValue(), "", "batch reuse never carries over review information");
  assert.equal(await page.locator("#record-review-date").inputValue(), "");
  assert.equal(await page.locator("#record-final-decision").inputValue(), "待复核");
  await assay.locator("select").selectOption({ label: "ASSAY-001 · Hs-test-cn" });
  assert.equal(await assay.locator(".record-assay-id").inputValue(), "Hs-test-cn");
  await context.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots: output }));
} finally {
  await browser.close();
}
