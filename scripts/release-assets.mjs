export const OFFLINE_ENTRY_COMMENT =
  "<!-- 本地离线入口：请与 styles.css、diagnostics.js、app.js、core.js 和 vendor 文件夹一起使用。 -->\n";

export const DESCRIPTION_META =
  '  <meta name="description" content="基于 CopyCaller 公开原理的 qPCR CNV 分析工具">\n';

export const SITE_METADATA = [
  '  <meta property="og:title" content="CNV分析工具 / CNV Analysis Tool">',
  '  <meta property="og:description" content="从孔级 Ct 到样本级拷贝数，支持 qPCR CNV 计算、质控、校准与实验记录导出。">',
  '  <meta property="og:type" content="website">',
  '  <meta property="og:image" content="/og.png">',
  '  <meta name="twitter:card" content="summary_large_image">',
  '  <meta name="twitter:image" content="/og.png">',
].join("\n") + "\n";

export const BROWSER_ASSETS = Object.freeze([
  Object.freeze({ source: "styles.css", siteTarget: "sites-app/public/styles.css" }),
  Object.freeze({ source: "diagnostics.js", siteTarget: "sites-app/public/diagnostics.js" }),
  Object.freeze({ source: "core.js", siteTarget: "sites-app/public/core.js" }),
  Object.freeze({ source: "app.js", siteTarget: "sites-app/public/app.js" }),
  Object.freeze({ source: "vendor/xlsx.full.min.js", siteTarget: "sites-app/public/vendor/xlsx.full.min.js" }),
]);

export const OFFLINE_PACKAGE_ASSETS = Object.freeze([
  "cnvtool.html",
  ...BROWSER_ASSETS.map((asset) => asset.source),
  "README.md",
  "THIRD_PARTY_NOTICES.md",
]);

export function renderSiteHtml(offlineHtml) {
  if (!offlineHtml.includes(OFFLINE_ENTRY_COMMENT)) {
    throw new Error("cnvtool.html is missing the expected offline-entry comment");
  }
  if (!offlineHtml.includes(DESCRIPTION_META)) {
    throw new Error("cnvtool.html is missing the expected description metadata");
  }

  return offlineHtml
    .replace(OFFLINE_ENTRY_COMMENT, "")
    .replace(DESCRIPTION_META, DESCRIPTION_META + SITE_METADATA);
}
