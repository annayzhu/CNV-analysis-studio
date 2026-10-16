# CNV分析工具 v 1.3

这是一个基于 CopyCaller 公开计算原理的浏览器端 qPCR CNV 分析器。它直接读取 QuantStudio / Applied Biosystems 导出的 `.xls`、`.xlsx`、`.csv` 或 `.txt`，在本地浏览器中完成孔级质控、ΔCt/ΔΔCt、连续拷贝数、离散判定、质量指标、图形和审计导出。

> 仅供科研使用（RUO），不用于诊断、治疗选择或个体临床决策。

## 最快使用方法

1. macOS 双击 `打开CNV分析器.command`，或用 Chrome / Edge / Safari 打开 `cnvtool.html`。
2. 拖入原始仪器导出文件；此时只读取文件，不自动计算或跳转。可继续上传板布局、选择对应板，也可跳过板布局。
3. 点击“开始分析”，再看“运行与数据质控”。`HOLD`表示可查看数据，但不应放行研究结果。
4. 检查 NTC：若实验中真实设置了 NTC、但 plate setup 漏标，可按样本名或物理孔补标；必须填写依据并确认。
5. 确认内参 assay、内参 Ct 阈值、0-copy ΔCt 阈值、最少复孔数及 duplex/triplex 是否分开。
6. 按 target / panel 独立配置校准。仪器文件中的 `Reference Sample` 不会自动继承。
7. 在“实验登记信息”中补录 Plate ID、操作人、反应体积和试剂批号；仪器信息、分析结论和校准状态会自动填写。
8. 确认质控和校准后，导出一个同时包含实验登记、Sample CN、QC、原始 Ct 和审计信息的 XLSX 工作簿。

所有数据仅在当前浏览器页面中处理，不会上传到服务器。整个应用可以直接部署到任何静态站点。

## 板布局与缺失样本名

- **开始分析前（可选）**：仪器结果与板布局的导入顺序不限。在独立的“添加板布局”区域上传 CNV 布局工作簿并选择对应板，最后统一点击“开始分析”，不用另点应用。程序按孔位更新样本名，并将可匹配的实验/试剂信息补入登记空白项；覆盖已有名称会先确认。也可不提供布局直接分析，或点击“移除板布局”撤下已选文件。
- **开始分析后**：在“样本信息”点击“更新样本信息”，选择“上传表格”或“粘贴表格”。上传布局表/已填模板，或粘贴 Excel 的 `Well` / `Sample` 两列后，选板、核对预览并应用。此入口只更新样本与孔位，不修改实验登记。
- **下载模板**：分析前可选 96/384 孔；分析后模板只列出本次导入的物理孔。Sample 列预设为文本，以保留前导零。
- 已有样本名与新布局不同时，先显示当前/导入名称，确认后覆盖，取消则不变；顶部样本数同步重算。原始 Ct、仪器样本名与已填写登记不变。全板同名只显示识别到的样本数，不标为“信息完整”。
- 覆盖样本名后重新选择校准样本；原文件 NTC 标记仍保留，手动按样本名指定的 NTC 固定到原物理孔，不随改名迁移。
- 点击“保存本次登记”可同时保存已应用的样本映射。导出的“原始Ct”包含仪器原样本名与补录来源。

支持的格式、匹配规则与验收说明见 [板布局补录与精简审查](docs/plate-layout-import.md)。

## 核心防错逻辑

- **Reference assay ≠ Reference sample**：RNase P 等内参 assay 用于孔内归一化；已知 CN 的 calibrator 用于板内相对定量。
- **不继承仪器中的 Reference Sample**：只显示原运行设置，每个 target / panel 重新审查。
- **校准品资格硬限制**：内参必须有效，target 必须稳定非零扩增，有效复孔数必须足够，ΔCt SD 不能超过校准品限值。
- **已知 CN 需人工签认**：未勾选“已由独立依据确认”时，程序不计算连续 CN。
- **校准依据与备注选填**：不填写文字依据、记录编号或替换备注，不影响 CN 计算、登记完整度或人工放行；填写的内容仍保存并导出。校准资格、已知 CN 与上述人工确认仍需满足。
- **内参失败优先**：内参无效的样本是 `Invalid`，不会因 target 也是 Undetermined 而被误判为 0 copy。
- **0-copy 独立路径**：全部可分析复孔内参有效、target 均为 Undetermined/仅背景、复孔数达标且同 assay/panel 阳性校准有效时，输出正式 `CN=0`；缺少阳性校准或证据复孔不足时保留 `0-copy 候选`，部分复孔扩增、部分不扩增时输出 `No call`。
- **不静默删数据**：源 flags、自动离群、手工 Omit 与排除理由都保留到孔级审计表。
- **反应组合防混合**：同一 target 在 duplex 与 triplex 中默认分开；只有桥接验证通过后才建议合并。
- **物理孔与 assay 行分层**：不把 multiplex 导出行数当作孔数。同一孔的多个 target 在内部共享孔位和样本，但保留独立测量。
- **人工 NTC 双重确认**：补标 NTC 时必须选择现有样本或物理孔、填写实验依据并确认“实际未加入模板”；原样本名不会被覆盖。
- **NTC 不参与 CN 计算**：已确认 NTC 从样本数、样本结果、校准候选和群体模型中排除，但完整保留在孔级审计中。
- **NTC 扩增硬拦截**：NTC 的 target 或内参任一通道出现数值 Ct 都会产生 blocker，提示污染、非特异扩增或误标风险。
- **允许没有 NTC**：未识别 NTC，或某个 duplex/triplex 反应组合没有对应 NTC 时，只保留 warning 与审计记录，不单独阻止分析、导出或人工放行，也不要求额外填写 NTC 依据。其他质控、校准及登记条件仍需满足；没有 NTC 不能据此排除污染。
- **不能补造实验对照**：如果实验中没有实际设置 NTC，软件不能事后把普通孔解释成 NTC。

仪器 flags 的计数单位是“孔 × 靶标测量记录”，不是物理孔或样本；同一条记录可以有多个标记。THOLDFAIL 表示自动阈值识别失败，CQCONF 表示 Cq 置信度低于设置值，NOAMP 表示未检出扩增，EXPFAIL 表示未识别到扩增曲线的指数期。定义见 [Thermo Fisher 官方 QC flags 说明](https://apps.thermofisher.com/apps/help/MAN0010414/GUID-3B54F97E-F149-4026-B61F-6AF6A0F07C4D.html)。

## 批量板的校准品失败策略

- `Reference assay`（例如 RNase P）是每个样本孔内归一化的内参；若它在某样本失败，该样本为 `Invalid`，不能通过更换校准品挽救。
- `Reference Sample / calibrator` 是已知 CN 的板内校准样本。批量板应为每个 target / panel 预设主校准品和至少 1 个已独立确认 CN 的备用校准品，并尽量在各板使用同一批次桥接 DNA。
- 主校准品本板不合格时，改选本板通过资格检查的备用校准品，或使用至少 2 个同 CN 已知样本构成校准组；替换原因可选填。
- 所有已知校准品都失败时，不会从普通样本中自动挑选替代品。只有在非零样本数足够且“预期众数 CN”有先验依据时，才可人工切换到群体模式；否则该 assay / 板保持 `HOLD / No call`。

## 一体化实验工作簿

XLSX 只生成一个文件，共 11 张工作表；首页用于直接登记 Sample CN，其余表用于实验记录、质控与追溯：

- `样本CN汇总`：首页一行一个 Sample，各 target / panel 的离散 CN、连续 CN 和结果状态横向排列，便于直接作为实验结果登记；正式零拷贝写为 `CN=0`，但连续 CN、confidence 和 z-score 留空；条件不足时仍显示 `0-copy 候选`。
- `运行登记`：整合 Run/Plate/Analysis ID、日期、人员、仪器、反应体积、Assay/Master Mix 批次、校准、NTC、自动结论和人工复核。
- `批次质控`：整批结论、NTC、各 assay 校准状态以及板级 blocker/warning/info。
- `CN计算明细`：保留一行一个 Sample-target-panel 的离散 CN、连续 CN、区间、校准和质量指标，供追溯首页汇总。
- `复孔质控`：Target/Reference Ct 列表、mean、SD、CV、最大 Ct 差、ΔCt 和 SD(ΔCt)。Ct CV 仅作离散度描述。
- `原始Ct`：逐条保留仪器导入记录，包括内参行、源 Ct/ΔCt/ΔΔCt/RQ、threshold、baseline、Cq confidence、flags 和 Omit。
- `NTC审计`：NTC 来源、人工指定依据、各通道 Ct 与扩增结论；无 NTC 时仍固定保留表头。
- `校准记录`：每个 target/panel 的模式、所选样本/组、已知 CN、确认依据、替换原因、K、错误和警告。
- `分析参数`、`仪器元数据`、`方法说明`：保留复算所需的阈值、来源和方法适用范围。

每个主要明细表都带有稳定的 `Run ID`、`Plate ID` 和 `Analysis ID`，便于未来汇总 96/384 孔及多板实验。自动质控为 `HOLD`、必填登记不完整，或缺少复核人和复核日期时，软件不会允许选择“同意放行”；校准文字依据和备注不属于必填项。放行后若再改变参数、NTC、校准或登记信息，原签认会自动撤销并要求重新复核。

### 自动保存与试剂批次

- 开始分析后，登记修改与已应用的分析设置自动保存。刷新或重新打开同一地址，可恢复上次分析和登记；“保存本次登记”仍可立即保存。
- 新登记的实验日期默认浏览器当地日期；已保存记录或导入板布局提供的实验日期优先，不被当天日期覆盖。
- Master Mix 和各个 target / reporter 分别保存批次。填写批号后点击“保存批次”；选择已有批次可调用信息，编辑字段后点击“保存修改”。选择“新批次”后填写另一批号，即可保留多个批次。
- “删除”只移除批次列表中的条目，不删除当前或历史实验登记。新实验不自动沿用批号、有效期及复核结论，需自行选用批次。批次只包含试剂信息，不包含复核人、日期或放行结论。
- 最近一次分析的输入快照、登记及设置只存于当前浏览器本机，不上传服务器。另按原文件 SHA-256 摘要保留最近 20 份登记（无摘要支持时用文件名、大小和修改时间），重新导入同一文件也可恢复。移除仪器文件会清除刷新恢复入口，但保留其已保存登记及试剂批次。
- 不同浏览器、网址与离线文件位置的本机存储可能不互通；清除网站数据或无痕会话结束后记录可能消失。长期归档请导出完整 XLSX；存储不可用时页面明确提示保存失败，仍可分析与导出。

## 96 / 384 孔扩展

解析器不限定导入行数；它按 `Well Position + Sample Name + Target Name` 构建孔级测量。

- 96-well：A–H、1–12，`well = (row-1)×12 + column`
- 384-well：A–P、1–24，`well = (row-1)×24 + column`

程序会审查 `Well` 数字与 `Well Position` 是否一致，并在孔板图中显示任意部分使用的板。

## 运行与依赖

运行时无需安装 Python、R 或服务器。工程内置 SheetJS Community Edition 0.20.3，用于浏览器中读写 XLS/XLSX/CSV/TXT。

根目录提供标准 Node 测试入口；无需安装第三方测试框架：

```bash
npm test
```

也可以按职责单独运行：

```bash
npm run test:core
npm run test:integration
npm run test:release
```

测试覆盖：ΔΔCt 主公式、0-copy 校准品拦截、内参失败不误判、duplex/triplex 分层、自动/人工 NTC、未确认 NTC 拦截、NTC 扩增、校准冲突、一体化工作簿字段顺序与原始 Ct 完整性、样本数不足时不伪造 Confidence/|Z|、QuantStudio 重名 Cq Conf 列解析、384 孔范围检查，以及去标识的 32 孔 QuantStudio fixture 回放。

### 测试结构

- `tests/core.test.js`：通过公开计算 interface 验证 CNV、QC、NTC、校准和导出行为。
- `tests/support/cnv-analysis-scenario.js`：深的测试场景 Module；集中把简洁样本描述编译成 QuantStudio-like 记录，并提供 assay、result、issue 和 workbook 查询。
- `tests/support/quantstudio-fixture.js`：fixture ingest Module；集中完成 workbook → AoA → parse → analyze。
- `tests/fixtures/quantstudio-32well-deidentified.xlsx`：仓库内可携带、去标识的默认回放文件。
- `tests/template.integration.test.js`：通过 fixture ingest seam 验证真实文件结构。
- `tests/diagnostics.test.js`：验证稳定的诊断 code/params interface 与中文展示 adapter。
- `tests/layout.test.js`：验证板布局/粘贴/模板映射、补空不覆盖、登记匹配、来源追溯以及补录前后计算一致性。
- `tests/release-sync.test.js`：验证单一发布资产清单、离线 HTML 依赖和 Sites 发布副本同步。

可选真实浏览器验收（需要可用的 Playwright 与 Chromium，不增加应用运行依赖）：

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/verify-layout-ui.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/verify-registration-ui.mjs
```

脚本使用合成数据检查桌面/手机端的导入、补录、保存恢复、校准、人工复核、模板下载、XLSX 回读及打印。登记脚本还覆盖刷新恢复、本地日期、试剂批次增改删、跨实验复核信息隔离与计算/导出一致性。加 `--screenshots` 保存界面截图。

默认测试不依赖个人电脑路径。需要额外回放某个真实实验导出文件时，可显式提供：

```bash
CNV_TEMPLATE_XLS=/absolute/path/to/template.xls npm run test:integration
```

不要把未去标识的实验导出文件提交到 Git。fixture 的生成和隐私说明见 `tests/fixtures/README.md`。

## 单一源码与发布

根目录中的 `cnvtool.html`、`styles.css`、`diagnostics.js`、`app.js`、`core.js`、`layout.js` 和 `vendor/xlsx.full.min.js` 是唯一可信源码。发布资产清单只在 `scripts/release-assets.mjs` 维护；不要直接修改 `sites-app/public` 中的同名发布副本。

修改主源码后，同步网页版发布文件：

```bash
node scripts/sync-release-assets.mjs
```

只检查是否同步，不修改文件：

```bash
node scripts/sync-release-assets.mjs --check
```

生成独立离线发行包：

```bash
node scripts/build-offline-release.mjs --version v1.3
```

离线 ZIP 输出到 `offline-release/`；其中包含运行所需的全部 HTML、JavaScript、CSS、SheetJS、本地说明以及 Windows/macOS 启动文件，不依赖 `sites-app`。ZIP 是生成产物，不提交进 Git，正式对外版本建议作为 GitHub Release 附件发布。

推荐发布顺序：修改根目录主源码 → 运行根目录测试 → 同步网页版 → 运行 `sites-app` 测试 → 生成离线 ZIP → 检查 ZIP 内容 → 发布。

`sites-app` 现在是零第三方依赖的静态交付 Adapter。它只要求 Node.js；无需安装 React、Next、Vinext、Drizzle 或数据库。验证方式：

```bash
npm run test:sites
```

如执行 `npm ci`，只会依据最小 lockfile 建立空的依赖目录，不会下载应用框架。

## 方法文档

- [CopyCaller 计算原理与方法说明](docs/CopyCaller_计算原理与方法说明.md)
- [当前 32 孔模板回放与防错报告](docs/当前模板回放与防错报告.md)
- [当前架构与演进原则](docs/ARCHITECTURE.md)
