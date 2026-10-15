# CNV分析工具架构

## 第一性原理

工具的主链只有六步：

`原始测量 → 规范化孔记录 → CNV 计算 → 样本 CN 与诊断 → 人工复核 → 可追溯导出`

每个 Module 只有在隐藏了调用者本不需要理解的复杂度时才保留。没有第二个 Adapter 的假想 seam 不进入工程；不参与主链的数据库、认证、服务器渲染和图像处理不属于本项目。

## 当前运行结构

```text
QuantStudio/XLSX
      │
      ▼
parseAoA ──► canonical measurement records
                    │
                    ▼
                 analyze
                    │
                    ▼
        CNV analysis result + diagnostics
             │                    │
             ▼                    ▼
       browser adapter       workbook adapter

offline: cnvtool.html       Sites: static Worker → ASSETS
```

根目录浏览器文件是唯一可信源码。离线包直接运行这些经典脚本，以保持双击 `cnvtool.html` 即用；Sites 只复制同一组文件，不维护第二套应用。

## 稳定 Interface

- `CopyNumberCore.parseAoA(aoa)`：将仪器二维表转换为 canonical records 与 metadata。
- `CopyNumberCore.analyze(records, metadata, settings)`：执行 CNV、QC、NTC 与校准规则。
- `CopyNumberCore.flattenResults(analysis)`：提供样本结果投影。
- `CopyNumberCore.flattenWells(analysis)`：提供孔级审计投影。
- `CopyNumberCore.reviewRegistration(analysis, registration, requireReviewedStatus)`：统一登记完整性和人工放行条件。
- `CopyNumberCore.buildIntegratedExport(analysis, context)`：生成工作簿定义。
- `CopyNumberDiagnostics`：统一诊断标题、正文、质量标签和显示类别。
- `CopyNumberLayout.parseSheets / applySamples / fillRegistration / templateRows`：文件与粘贴共用一个板布局 Module，集中解析、补空、来源记录和模板结构；不参与 CN 数学计算。

内部数学函数、plate 推断和群体拟合实现不属于公共 interface。测试通过上述 interface 观察行为，不依赖内部调用顺序。

## 不删除的科学防错

- 内参失败不能解释为 0 copy。
- 0 copy 需要有效内参、足够复孔和同 assay/panel 的有效阳性校准。
- 校准品需要稳定非零扩增及合格复孔。
- NTC 数值 Ct 是 blocker；缺少 NTC 只提示 warning。
- duplex/triplex 默认分开分析。
- 原始 Ct、仪器 flags、Omit 和校准依据保留在审计导出中。

## 有意推迟的决策

群体拟合、Confidence-like 和自动离群是透明近似，不是已知校准品主路径。是否从正式流程移除会改变方法学能力，应在实验室确认使用场景和验证证据后单独决策；当前架构审查不静默删除这些功能。

真实浏览器 journey 已由 `scripts/verify-layout-ui.mjs` 覆盖：

`导入无名测量 → 布局补录 → 校准 → 登记/复核 → 保存恢复 → 导出 XLSX 并回读`

登记字段的读写/恢复使用同一份字段映射；“未保存”和“复核失效”是两个独立动作。结果页按当前页签绘制，打印前才生成全部图表。不引入新状态框架或会话抽象；下一次只有实际出现多个调用端需要同一状态转换时，再提取 CNV Run Session Module。
