# CNV分析工具 · Sites 静态发布 Adapter

这个目录只负责把本地 CNV 分析器交付到 OpenAI Sites。实际分析界面位于 `public/`；构建脚本生成平台需要的 `dist/server/index.js` 和 `dist/client/`。它不需要 React、Next、数据库、认证或服务器渲染。

`public/index.html`、`public/styles.css`、`public/diagnostics.js`、`public/app.js`、`public/core.js` 和 `public/vendor/xlsx.full.min.js` 是由项目根目录主源码生成的发布副本，不应在这里单独修改。资产清单只在 `scripts/release-assets.mjs` 维护；更新根目录源码后，请在项目根目录运行：

```bash
node scripts/sync-release-assets.mjs
```

## 隐私与运行边界

- Excel/CSV 数据在用户浏览器内解析，分析器不上传实验文件。
- 所有计算、质控、NTC 补标和导出均由前端 JavaScript 完成。
- 工具仅供科研使用（RUO），不用于临床诊断或治疗决策。

## 验证

```bash
npm test
```

核心计算的测试仍保留在上级目录的 `tests/` 中。
