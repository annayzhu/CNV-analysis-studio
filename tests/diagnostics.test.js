"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const diagnostics = require("../diagnostics.js");

test("diagnostics expose stable codes and params independently of Chinese copy", () => {
  const item = diagnostics.create("QUALITY_GROUP_SIZE_INSUFFICIENT", "info", {
    minimum: 7,
    largestGroup: 6,
  });

  assert.deepEqual(item, {
    code: "QUALITY_GROUP_SIZE_INSUFFICIENT",
    severity: "info",
    params: { minimum: 7, largestGroup: 6 },
  });
  assert.equal(diagnostics.format(item), "至少需要 7 个相同拷贝数的样本；当前最大类别仅 6 个。");
});

test("unknown diagnostic codes remain auditable", () => {
  const item = diagnostics.create("FUTURE_DIAGNOSTIC", "warning", { value: 1 });
  assert.equal(diagnostics.format(item), "FUTURE_DIAGNOSTIC");
  assert.equal(diagnostics.formatMany([item]), "FUTURE_DIAGNOSTIC");
});

test("diagnostic presentation metadata has one stable source", () => {
  assert.equal(diagnostics.title("NO_NTC"), "未识别到 NTC");
  assert.equal(diagnostics.qualityLabel("ZERO_COPY_CONFIRMED"), "0 copy");
  assert.equal(diagnostics.qualityClass("ZERO_COPY_CONFIRMED"), "zero");
  assert.equal(diagnostics.qualityLabel("FUTURE_STATUS"), "FUTURE_STATUS");
  assert.equal(diagnostics.qualityClass("FUTURE_STATUS"), "neutral");
});
