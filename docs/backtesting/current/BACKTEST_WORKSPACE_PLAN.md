# Quant Tools 回测工作区一比一复刻与功能完备实施计划（最终复核版）

> 最新对齐批次（2026-10-07）：H-09共享Tab滚动196/196、S-11 Simulation挂载生命周期216/216、D-10实际小值轴28标签、ENG-10脚本错误双引擎64项、STG-03/06恢复和LC-07/NR-05故障隔离198项通过；根653/653、类型、构建、生产主E2E及工程门禁通过。K线空最新页缓存保护/连续性定向31项通过。证据为本地忽略目录 `audit-evidence/2026-10-07-tab-parity-closure/`及各专项目录。当前剩余项以[需求状态表](BACKTEST_REQUIREMENTS_STATUS.md)为准；本文G0～G9历史勾选不代替现行状态。

> 2026-10-07 桌面非文字可辨识续验：已修复 Calendar 焦点框、Settings 默认控件边界及 Simulation 置信区间低对比度/区间键盘不可达。实际两浏览器控件20项取色、16项键盘通过；区间轮廓及中位线最低4.41:1，原始68点可读，Simulation四场景144/144通过，计算值未改。最新根639/639、类型、重建/生产主E2E、紧凑桌面4场景228项及6项清理、包体/仓库/dist检查通过。实体桌面 VoiceOver 按 SCOPE-08 不纳入本阶段；其余桌面可访问性合同已通过。证据仅在忽略目录 `audit-evidence/2026-10-07-essential-control-contrast/after/` 和 `audit-evidence/2026-10-07-simulation-band-contrast/`。

> 2026-10-07 桌面续验终态：根639/639、类型/构建、dev/prod主E2E及工程门禁通过；Dock 393/393、桌面 Dock 632项、Summary/Dock键盘176项及桌面32场景/1,792项、Analysis164、Log/Calendar858、H-06图例收藏/</>与L-11定位164项、Settings和strict visual四图diff=0通过。Simulation最后Preserve scoped CSS补丁另验84/84，Settings刷新竞态、box-sizing、空态Ghost、H-06与L-11已在后续批次通过。证据与源码时点见 `audit-evidence/2026-10-07-dock-keyboard-closure/README.md`（本地忽略）；手机专项默认deferred/full可选，实体桌面 VoiceOver按 SCOPE-08 暂不做；GitHub CI 按用户决定暂缓，不作为当前 Gate。

> 当前有效的需求、优先级和状态以 [BACKTEST_REQUIREMENTS_STATUS.md](BACKTEST_REQUIREMENTS_STATUS.md) 为准；本文下方的独立审计和历史轮次仅用于追溯。

> 2026-10-07 用户修正 UI 标准：功能、交互、图标和组件风格对标参考，整体布局适配本项目；没有 AI 对话区和顶部登录 banner，也不为它们留白。§3.3～3.4、§10 和 §14.2 已改用此标准；整页 1px / 0.5% / 1% 旧阈值不再有效。已有 PASS/PARTIAL 仍须按实际证据判定，不随标准文字自动关闭。

> 最新范围调整：手机端适配先暂缓，见需求表 SCOPE-07；实体桌面 VoiceOver 按 SCOPE-08 暂不做。手机布局、横竖屏、safe-area、手机触摸及手机实机专项不再阻塞本阶段；保留已有实现与证据。当前桌面全模块对标、窗口缩放、键盘和通用功能正确性已完成，后续仅做非回归。

> PERF-01 已取得独立生产终态：固定 Chromium DPR1 的 10k/100k 冷 selector p95 为 52.2/399.9ms，分页 41.4/42.2ms，列明的跨浏览器功能/资源检查通过；Firefox 超出 Chromium 对照值及 factory/API 限制如实记录于需求表，不声称所有设备同预算。启动预算、包体预算和生产两小时分别保留，不相互替代。此前 UI 批次根 627/627、类型/构建、开发/生产主 E2E、32 状态生产检查保留其时点；当前桌面632批次及最后CSS补丁的验证边界见顶部，剩余工作以需求表为准。参考信息已提供，无需用户重复补充。

> 2026-10-07 较早对话/证据复核批次：原 6/7/8/9/10+14/15 映射见需求表。DATA-11/REL-01 明确合同、ENGINE-03 三项有限验收与 STARTUP-01 资源预算已关闭：跨订单/实时风险浏览器 14/14、完整归档重放 496 字段、空图/SMA 首屏 JS gzip 分别减少44.05%/17.50%；该批次根 616/616、桥接 310/310、引擎 offline 1773 + 1 skipped、类型/构建和开发/生产 E2E 通过。原有历史精度 8/8、风险/entry 16/16 保持各自范围；当时 Settings 生产 32 状态/34 交互及九组参考几何通过。独立冻结生产构建的完整 Workspace 两小时长测已通过（7,200.505 秒，资源预算和卸载清理通过；采样期间的短暂 DOM/listener 峰值在卸载后归零）；工作区图标的有限合同随后已由 UI-09 关闭，完整 UI/交互及真实辅助技术/设备仍开放。Safari、线上部署、Replay 暂缓；长期持久化仅待讨论，其它 golden 不重入队，完整 TV 外部逐 Fill 按 SCOPE-05 不作为当前关闭条件。

> **2026-10-01 R-08～R-11 修复后独立复查（历史指针）**：R-08、R-10、R-11 结论保留于 `报告`（本地忽略证据，公开仓库不携带）；R-09 的历史状态见 `R-09 首次复查`（本地忽略证据，公开仓库不携带），当前状态以本文件下一条最新指针为准。整体仍为 **PARTIAL**。

> **2026-10-01 最新独立复查（历史指针）**：`R-09 第三次复查`（本地忽略证据，公开仓库不携带）、`R-09 新证据`（本地忽略证据，公开仓库不携带）。R-09 当前 Workbench pointer-open 契约在 Chromium、Firefox、WebKit 均回 Settings 触发按钮；Tab/Shift+Tab、Escape、busy、destroy、主 E2E 及构建门禁均通过。该历史轮次的完整 reference golden、复杂撮合和长时 Provider结论已由后续 2026-10-06 状态更新；VoiceOver/真实设备仍未验收；SCOPE-03 仅暂缓 Safari 专项。下方旧报告只作历史索引。

> **2026-10-01 修复者过程记录（历史）**：见 `账本与视觉修复记录`（本地忽略证据，公开仓库不携带）。真实 Binance.US 首次 SMA 的 ledger/KPI、单 tick 停止、工厂晚挂载、12,000 根后台补历史及无事件深度请求失效已通过新验证；移动 KPI、关闭/设置图标、SVG ID、本地资产标识与 Settings modal 已修。根测试 394/394、组件测试 283/283、开发/生产 E2E 通过。完整逐笔 golden、整体像素对账、复杂撮合和发布门禁仍开放。下方此前“当前状态”是各轮历史快照；整体仍 **PARTIAL**。

> **2026-09-30 修复前独立参考对账（历史快照）**：见 `BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带）。用户 SMA 9/21 在同一份 LuxAlgo 5,000-bar 响应上与本地 PineEngine 的固定窗口算术 parity 已 PASS；默认 Binance.US 500-bar 应用链路的 ledger/readiness、open-row 计数和 provider/partial policy 仍开放。

> **2026-10-01 D-01 修复跟踪（历史记录，当前已关闭）**：当时独立动态 probe 发现首个 `status=ready` / `history.complete=false` 边界；后续已补充 partial/pending 门控、ledgerRevision 和新策略首轮门控，并由两种引擎的立即挂载、晚挂载、hide/show、市场切换回归关闭。原始修复记录（本地忽略证据，公开仓库不携带）仅作追溯，当前状态以 `BACKTEST_REQUIREMENTS_STATUS.md` 的 REL-02 为准。

> **2026-09-30 动态深审（历史快照）**：综合结论见 `BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带），独立证据见 `audit-evidence/2026-09-30-dynamic-deep/README.md`（本地忽略证据，公开仓库不携带）。当时 R-05/R-06/R-07 probe 全部通过，并发现 D-01；D-01 已在后续版本关闭。整体计划仍以最新需求状态表为准。

> **参考站动态深审**：用户 workspace 的独立黑盒结果见 `BACKTEST_REFERENCE_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带） 和 `audit-evidence/2026-09-30-reference-deep/README.md`（本地忽略证据，公开仓库不携带）。参考站四 Tab、Settings、Simulation、市场搜索、Panels 和移动边界已采集；固定 SMA 9/21 对账已单独 PASS，15m 普通切换/Calendar 内容和默认 Provider/UI 端到端 parity 仍需补证。

> **2026-09-30 第四轮独立复查（历史快照）**：见 `BACKTEST_AUDIT_RECHECK_4_2026-09-30.md`（本地忽略证据，公开仓库不携带）。其开放边界已在当前工作区重新 probe；当前状态以本文件顶部最新独立复查为准。

> 第四轮后续修复记录（历史过程材料）：R-06/R-07 的修复声明见 `BACKTEST_RECHECK_4_REMEDIATION_2026-09-30.md`（本地忽略证据，公开仓库不携带）；当前是否通过以最新独立 probe 为准。

> **历史记录（第三轮独立复查，2026-09-30）**：S-01～S-03、U-01 及空行情首次加载/回切已用全新输入和真实两引擎浏览器复测通过；新增发现 R-05 dev E2E legacy snapshot 合同失败、R-07 空行情 hide/show 重新接纳旧账本，R-06 为受控混合 envelope 兼容边界。详见 `BACKTEST_AUDIT_RECHECK_3_2026-09-30.md`（本地忽略证据，公开仓库不携带）。整体 Final Gate 仍未关闭。

> 第三轮后续修复记录：R-05、R-06、R-07 的目标场景曾通过独立回归，详见 `BACKTEST_RECHECK_3_REMEDIATION_2026-09-30.md`（本地忽略证据，公开仓库不携带）。第四轮已重新审查适配器边界；原报告保留为历史证据，整体 Final Gate 仍未关闭。

> 2026-09-30 后续修复：S-01～S-03、U-01 已修复并重新执行原审计探针及新增边界验证，详见 `第二轮修复记录`（本地忽略证据，公开仓库不携带）。下方第二轮审计结论保留为修复前状态；整体 Final Gate 仍未关闭。

> 版本：1.6
>
> 日期：2026-09-27（历史计划版本；当前状态见顶部需求表及最新批次）
>
> 文档状态：当前需求表纳入本阶段的本地功能已完成；G4b.2/G4b.3 和后续阶段过程保留作历史基线，当前状态只以顶部需求表为准。G8.1（`reportSchemaVersion=4`）下的有限引擎合同、固定 `BTCUSDT · 15m · SMA` 数值窗口、K 线合并、代表网络、STARTUP-01、PERF-01 和 REL-06 均已验；实体桌面 VoiceOver、手机、Safari、GitHub CI、线上部署和 Replay 按范围暂缓。长期持久化只待讨论；完整 TV 外部逐 Fill 不作为条件。
>
> 实施目标：功能完备、前端 UI 与交互一比一对标、运行时完全独立于参考网站
>
> “功能完备”包含持续实现当前需求表中明确标记为 `PARTIAL`、`NOT STARTED` 或“未实现”的范围内能力，不能只把缺口留在 TODO。底层引擎/Provider、应用桥接、UI、错误与降级语义及回归须一致；受数据源限制时保留明确 unavailable/fallback 和证据边界。order/fill ledger、raw audit、重算、风险、部分平仓/parent relation、forming/覆盖率与完整输入归档的本期合同已由 ENGINE-03 列明证据关闭。完整 TV 外部逐 Fill 不作为条件，也不新增盘口流动性 partial fill 或 raw 展示入口；后续实际缺陷按反例处理，不无限追加排列。
>
> 使用场景：当前阶段仅本地自用，许可证不作为本计划的设计、实施或验收阻塞项

> 范围调整（2026-09-30）：Replay → 选择 K 线 → Backtest 状态链暂不纳入本阶段回测工作区建设、验收或发布阻塞项。保留参考证据用于未来规划，但当前验收从普通策略回测入口和 Backtest Viewer 开始。

> 第二轮独立复核（2026-09-30，历史快照；当前状态见顶部最新独立复查）：`feature/backtest-workspace-build`、HEAD
> `53ab05795f45e5440eba1c1513b3bb63a659b9ae` 加最新未提交业务修复。详见 `BACKTEST_AUDIT_RECHECK_2_2026-09-30.md`（本地忽略证据，公开仓库不携带）。
> 上轮 R-01～R-04、O-01～O-03 原场景已用全新输入复核通过；仍有 S-01 重叠市场切换 history
> 丢失、S-02 tick 版本下限、S-03 bootstrap 读取归属/身份缺口，以及 U-01 设置错误文案截断。
> 用户禁止以旧测试/fixture/修复者结论代替独立验收；全部旧数字仅保留为过程记录。参考站/TradingView
> 对账、真实 Provider 长链、跨设备/生命周期和 rollback 仍按计划开放。

## 0. 执行结论

> 2026-09-30 修复跟踪：独立审计 F-01～F-10 的实现和新验收证据单独记录于
> `BACKTEST_AUDIT_REMEDIATION_2026-09-30.md`（本地忽略证据，公开仓库不携带）。
> 修复过程记录不是最新验收结论；以本轮独立 recheck 为准，局部通过不关闭剩余门禁。

本项目能够在现有 Vela Workspace 与 PineTS 基础上实现一个独立运行、功能完整、前端 UI 与交互一比一对标 LuxAlgo Quant 回测工作区的版本。

最终结果必须同时满足四条硬性标准：

1. **功能完备**：策略自动回测、摘要 Dock、完整查看器、Performance、Trades Analysis、Trades Log、Simulation、参数重算、图表定位、多图多策略、空态和错误态全部可用。
2. **UI/交互对标与布局适配**：功能、颜色、字体、图标、组件风格、滚动、拖拽、悬停、Tab 和状态切换按 §10 对标；整体布局及响应式适配本项目可用区域，不复制 AI 侧栏/登录 banner 或要求整页绝对坐标与像素重合。
3. **独立运行**：生产代码和构建产物不请求 `app.luxalgo.com`、LuxAlgo 私有接口、远程页面资源或其 Next.js chunk；市场数据只使用项目明确注册的 Binance/Hyperliquid Provider。
4. **现有功能零非预期回归且有可重复验证证据**：回测功能的新增、重算、失败、销毁和刷新路径不得改变现有工具栏、指标管理/收藏、Pine 编辑器、个人脚本持久化、模板、布局恢复、Provider、截图和生命周期行为；必须在原有测试、构建、开发/生产 E2E、Provider smoke、故障注入和基线差分中得到证据，任一既有回归测试或行为基线失败时不得合并。

G4b.2 已将回测结果契约从“摘要+交易账本”推进到带 `runId/snapshotRevision` 的逐 K 精确曲线：PineTS 输出 close mark-to-market equity、close underwater、累计 intrabar max drawdown，并从首次真实 fill 锚定 benchmark；Vela-PineTS 只在显式选择时复制完整历史，live tick 仅传输 0–1 个尾点，Adapter 在身份、点数与单调性校验通过后才开启 exact capability。该阶段两个 Fork 的历史本地 patch revision 为 `quant-tools-g4b.2`，`reportSchemaVersion=2`。

G4b.3 已在不改变成交语义的前提下接通 `account_currency`、`max_contracts_held_all/long/short` 和逐笔 `entry_bar_index/exit_bar_index`，应用层分别映射为账户币种、All/Long/Short 最大持仓以及 UI report 的 `entryBar/exitBar`；该阶段身份 `quant-tools-g4b.3` / `reportSchemaVersion=3` 保留为历史。当前 G8.1 两个 Fork 身份为 `quant-tools-g8.1`、`reportSchemaVersion=4`；`reportSeries/reportTail` wire envelope 仍独立使用 `schemaVersion=1`。逐笔 bar index capability 只在当前 revision 的 ledger 已 ready 且所有 index 完整、合法并不晚于当前执行 bar 时开启；新 live revision 不得沿用旧 ledger 的 exact capability。`BACKTEST_LEDGER_AUDIT.md` 已确认 PineTS 内部 reversal/FIFO/partial/pyramiding 撮合语义存在，但上游 Vela 的普通公共快照仍无 raw order/fill 历史、partial-fill event 或精确 reversal/parent relation；因此在本地 Vela-PineTS 的 `auditLedger` 未通过 `runId/revision/bar` 身份校验时，`rawOrders/rawFills` 必须保持 false，不能从 marker、pending queue 或 round-trip trade 行推断。当前 audit bridge 只公开已校验的 append-only 事件和有限关系字段，尚未补齐单一原子 order/fill/curve 报告包、完整 TradingView 低周期/逐 Fill 语义和全部 Performance UI 参考口径；G8.1 第一版只在校验通过的 lower-timeframe envelope 下提供四点回放并显式回退，任何阶段都不得用近似值冒充参考站正式指标。

底层源码采用“两个必需、一个条件式”策略，决策记录见 [`VELA_FORK_DECISION.md`](../../architecture/VELA_FORK_DECISION.md)：PineTS 与 Vela-PineTS 源码保存在本仓库并作为本地 workspace 依赖；Vela 主包仍锁定 registry 版本。当前历史容错使用内部缓存边界，窄屏视口通过显式版本/SHA 校验补丁修改安装后的 ESM 产物，详见 [Vela viewport 补丁](../../forks/vela-viewport.md)。补丁脚本纳入 Git 和构建指纹，`node_modules` 本身不入 Git；不能再将当前集成概括为完全不修改上游产物。

分阶段交付只是降低实施风险，**中间阶段不等于最终范围缩减**。只有所有 Final Gate 通过，才能宣称“功能完备、一比一复刻”。

本条非回归要求是每个阶段的硬 Gate，不是 G9 才补做的收尾检查。回测模块必须可独立降级：结果适配、报表渲染、Simulation 或 Worker 出错时，Vela 图表和现有功能仍可继续使用；不得为了让回测显示成功而修改既有功能的语义、存储格式或第三方运行时对象。

验证目标必须和功能目标一起交付：每个阶段都要先运行回测接入前的原有回归集，再运行新增回测测试，并将两组结果与 `BACKTEST_REGRESSION_BASELINE.md` 对账。命令通过只能证明代码级回归集通过；工具栏、指标、编辑器、脚本、模板、布局、截图、Provider、Storage 和生命周期的行为差异还必须有可审计的 DOM/事件/请求/快照或故障注入证据。没有证据的项目保持未完成，不得以人工“看起来正常”替代。

为避免各阶段只记录局部绿灯，G0–G8 共用同一份阶段 Gate 清单（G9 在此基础上执行最终扩大版）：

1. **先旧后新**：在同一 commit、同一 Node/npm、同一浏览器配置下，先执行 `npm run test:regression:existing`，再执行包含回测测试的 `npm test` 及本阶段新增/定向测试；顺序颠倒或复用旧结果均不算本阶段证据。
2. **固定命令和环境**：记录 commit、工作树状态、Node/npm、OS、浏览器版本、viewport/DPR、时区/locale、fixture/seed、命令完整输出和开始/结束时间。网络依赖失败必须区分“失败”“外部阻塞”和“跳过”，不能记为通过。
3. **行为证据**：受影响阶段至少保存 DOM/ARIA 快照、截图或 diff、事件/请求/Storage/监听器/Worker/图表实例计数；新增回测故障路径还要保存降级后的旧 Workspace smoke 结果。
4. **账本格式**：每条记录写入 `BACKTEST_REGRESSION_BASELINE.md` 或阶段证据目录，包含 `status`（pass/fail/blocked）、命令、环境、artifact 路径、基线差异、已知偏差和复核人。任何未解释差异自动阻断阶段合并。

## 1. 对标证据与可信边界

本计划来自三类证据交叉验证。

### 1.1 动态浏览器实测

已登录参考站并实际执行一次回测，覆盖：

- 添加内置 Strategy 并自动运行。
- 图表交易标记、持仓区间和 Strategy 徽章。
- Inputs / Properties 设置。
- 底部摘要的展开、折叠、拖拽和打开完整查看器。
- Performance、Trades Analysis、Trades Log、Simulation 四个页面。
- Trades Log 列表、日历和 Entry/Exit 图表定位。
- Simulation 的 Resample、Shuffle 和即时重绘。
- 删除策略并确认摘要和查看器入口消失。
- 相关运行请求和四个结果页的数据复用关系。

动态测试完成后已移除临时策略并关闭测试页面，没有保存、分享、下单或修改账户配置。

### 1.2 静态页面审计

上传的 `backtest.html` 是运行态 DOM 快照，不是源码或可独立运行页面。它可作为以下项目的证据：

- Performance 页面的 DOM 层级、字段、样式和响应式结构。
- 默认 Dock 高度约 280px；当前实际参考组件折叠后为 45px，保留策略名、日期、净利和打开 Viewer 入口。此前 28px 只留控制行的判断已由 2026-10-07 原生组件实测纠正；104px 是展开态拖拽下限。
- `Performance / Trades Analysis / Trades Log / Simulation` 标签结构。
- Highcharts 13.0.0 图表形态和 Lucide 风格图标。
- 正收益 `#089981`、负收益 `#f23645` 等视觉 token。
- Net Profit、Trades、Win Rate、Max Drawdown、Profit Factor 摘要。
- Cumulative P&L、Net Daily PNL、Weekday Performance 和 All/Long/Short 表格。

静态文件不包含 React 组件源码、事件处理器、原始图表数据、公式、API 响应和另外三个页面的运行内容。因此只提炼结构和视觉证据，不将该 HTML 或参考站 bundle 复制进仓库。

### 1.3 当前项目能力审计

当前项目已经具备：

- `PineWorkerEngine` 策略执行入口。
- G4b.2 的 PineTS 逐 K 报告点：equity、realized/open P&L、close underwater、累计 intrabar max drawdown 和首次真实 fill 锚定的 benchmark。
- Vela-PineTS 的显式 `reportSeries`/`reportTail` selector、`runId + snapshotRevision` 身份以及 in-process/Worker 同构传输。
- BacktestResultsAdapter 对曲线身份、点数、bar/time 严格单调性和 benchmark 完整性的校验；校验成功后才宣告 exact equity/drawdown/benchmark capability。
- G4b.3（历史）的账户币种与 All/Long/Short 最大持仓桥接：PineTS snake_case 字段经 Vela-PineTS 转为 camelCase，再进入领域账户和 UI report。
- G4b.3（历史）的逐笔 Entry/Exit bar index 桥接；只有当前 revision 的 ready ledger 通过完整性、safe integer、顺序和执行边界校验后，才宣告精确 bar-index capability。
- G8.1 当前新增 lower-timeframe precision envelope：请求/实际应用模式、子周期、父子覆盖率和 fallback reason 经 in-process/Worker 同构透传，并仅在结构校验通过时执行四点路径回放。
- Workspace 级 `script:run` 事件。
- `run.kind`、`run.complete`、`run.forming`、`run.strategy`。
- 异步 `run.trades()` 交易账本。
- IndicatorHandle 的 Inputs、Properties、可见性、源码更新和删除控制。
- Vela 已绘制的策略订单标记和持仓区域。
- Binance、Hyperliquid OHLCV Provider。
- 已完成的模块化 Composition Root 和统一生命周期清理。

当前 [`workspace-events.ts`](../../../src/integrations/vela/workspace-events.ts) 仅将 `script:run` 写入编辑器日志；[`workspace-port.ts`](../../../src/domain/ports/workspace-port.ts) 没有回测结果接口。这正适合新增独立 Backtesting Feature，而不是继续扩大通用 WorkspacePort 或把逻辑放回 `main.ts`。

### 1.4 动态网络观察与本项目替代边界

参考站实测观察到：

- Workspace/偏好：`/api/quant/workspaces`、indicator templates、chart preferences、watchlists、indicator favorites。
- 行情：区域化数据域的 `/v1/{source}/{symbol}/info` 与 `/candles`。
- 策略挂载或重算：`POST /api/quant/backtest-run`。
- 四个结果页和 Simulation：主要复用同一份结果，切 Tab 和调整 Simulation 未出现逐页回测请求。

这些请求只用于理解触发时机，不作为实现依赖。本项目对应关系为：

| 参考站边界 | 本项目实现 |
| --- | --- |
| Workspace/偏好 API | 现有 Workspace state 与本地 Repository |
| 参考行情 `/info`、`/candles` | Vela Binance/Hyperliquid Provider |
| `backtest-run` | 本地 `PineWorkerEngine` + BacktestResultsAdapter |
| 四页结果数据 | 同一 `BacktestReport` 与 selector |
| Simulation | 本地 Simulation Worker |

不能仅凭一次网络观察断言参考站的策略计算完全发生在浏览器；但本项目的实现必须明确全部在自身 Vela/PineTS 链路内完成。

### 1.5 统一测试交易品基线

所有对标、公式、截图、E2E 和性能回归统一使用项目现有数据源能够稳定支持的市场：

- Provider：`binance`。
- Ticker：`BTCUSDT`。
- 默认图表周期：`1h`。
- 数据类型：Binance OHLCV Kline。
- 内部测试标识：`provider=binance + ticker=BTCUSDT + timeframe=1h`。
- UI 的 venue/display symbol 由 Vela 实际解析结果和 G0 参考截图冻结，不在业务代码中硬编码 `BINANCE.US` 或 `BTCUSD`。

不使用 XAUUSD、黄金或其他当前项目没有 Provider 支持的交易品作为 fixture。确定性测试需将指定时间范围内的 BTCUSDT candles 固化到本地 fixture，避免 Binance 后续新增 K 线导致期望值漂移；Provider smoke test 仍使用实时 Binance 接口验证连接能力。

对标基线分成两套，避免把“视觉相同”和“数值相同”混为一项：

- **视觉/交互基线**：使用参考站可稳定加载的 Strategy，冻结页面状态、viewport、DPR、字体、locale、timezone 和截图。
- **数值/引擎基线**：使用一组可在参考站与本项目运行的、源码受控的可移植 Pine 策略，选择已经收盘的固定历史区间，并保存 candles 校验和、策略源码校验和、参数、逐笔交易和汇总结果。

若参考站不能注入本地 candles，则必须选取已经结束且不会再变化的 Binance BTCUSDT 历史区间，并先核对双方 OHLCV 校验和；数据本身不同的样本不得用于判断撮合公式是否一致。

## 2. 范围定义

### 2.1 本计划完整范围

- 策略添加后自动回测，无额外 Run 按钮。
- 首次完成提示、Strategy 徽章及 Show backtest 入口。
- 策略图例的 Hide、Settings、Move pane、Favorite、Edit code、Remove 联动。
- Inputs 和 Properties 的草稿、校验、Cancel、Reset、Ok 与单次重跑。
- 桌面底部 Backtest Dock。
- 完整 Backtest Viewer。
- Performance 全部字段、图表和 All/Long/Short 对比。
- Trades Analysis 全部图表和统计。
- Trades Log 列表、排序、日历和图表定位；CSV 导出只有在 G0 复测确认参考站存在对应入口后才纳入，不作为当前已确认的硬性范围。
- Simulation 的 Resample、Shuffle、风险指标、图表和控制项。
- 多 Cell、多策略、活动策略切换和生命周期隔离。
- 历史加载、实时形成 K 线、重算、取消、乱序响应和 stale 状态。
- 无交易、仅未平仓、全胜、全负、全平手和错误状态。
- 桌面工作区、紧凑窗口、鼠标与键盘交互；手机布局、safe-area、触摸及手机实机专项按 SCOPE-07 暂缓。
- 确定性结果、视觉差分、性能、可访问性和独立运行验收。
- 现有 PineTS 高精度历史回测/Bar Magnifier TODO 与结果工作区的最终整合。

### 2.2 不属于本回测工作区的范围

- LuxAlgo 账户、订阅、聊天、AI、云工作区、分享和发布服务。
- 真实券商下单和实盘交易。
- 交易所订单簿、排队位置、市场冲击和真实逐笔 Tick 撮合。
- 将参考站私有 API 作为本项目运行依赖。

这些内容不是参考回测工作区自身的必需组成，不影响本计划的“回测功能完备”定义。

### 2.3 非回归目标与不变性合同

新增回测代码必须满足以下不变性；它们与页面功能和数值对账同等重要：

- `main.ts` 仍只负责组合根；回测 Controller/Store/Viewer 不得接管或重写现有 Feature 的状态。
- 现有顶部工具栏按钮、绘图工具、指标搜索/分类/收藏、On chart 列表、个人脚本新建/编辑/删除、Pine 编辑器运行/保存、模板保存/恢复、截图和 Provider 注册的 DOM 语义、事件次数和可见行为保持不变。
- 不修改既有 `localStorage` key、Workspace state schema 或已保存脚本/收藏/模板的迁移语义；回测偏好使用独立、版本化 key，计算结果不写入持久化。
- 回测订阅、Worker、ResizeObserver、MutationObserver、Highcharts 实例和 Chart 导航监听必须在 remove、cell destroy、HMR、刷新和 `app.destroy()` 时释放，不得造成重复运行、重复 Toast、重复保存或内存泄漏。
- 回测 Tab、排序、Calendar、Simulation、Viewer 打开/关闭和 Dock 拖动不得触发策略重跑、Provider 重订阅或现有指标重建；只有明确的策略/市场/参数变化才允许新增一次回测运行。
- 回测故障只能降级回测区域并提供可见错误/重试；不得阻断图表初始化、现有指标渲染、编辑器打开或模板恢复。
- 新增 JS/CSS 与初始化开销必须在既定 bundle、首屏和交互性能预算内；超过预算必须在变更记录中说明并单独批准。

每次阶段合并都必须同时提供“回测新增功能证据”和“既有功能非回归证据”。只通过新回测测试、但既有功能行为发生变化，视为未完成。

## 3. 已确认的参考行为合同

### 3.1 入口与生命周期

1. 无 Strategy 时不渲染空 Dock，也不显示无意义的 Viewer。
2. `Indicators → 搜索 → 点击 Strategy 行` 后自动添加并运行。
3. 搜索期间显示 `Searching…`。
4. 首次成功显示一次性 `First backtest complete!` 提示。
5. 图表同步显示订单标记、持仓背景和 Strategy 徽章。
6. Strategy 徽章提供说明和 `Show backtest`。
7. 删除策略后，其图层、结果、Dock、Viewer 入口和在途任务全部清理。
8. Symbol、provider、timeframe、Inputs、Properties 和源码变化触发重算。
9. Tab、排序、日历翻页、Viewer 开关和 Simulation 控件不得重新运行策略。

### 3.2 Settings 合同

参考策略实测的 Properties 包含：

- Initial capital。
- Default qty value/type。
- Pyramiding。
- Commission value/type。
- Slippage。
- Margin long/short。

默认值基线为：初始资金 1,000,000、fixed qty 1、pyramiding 0、commission 0%、slippage 0、long/short margin 100%。不同脚本的 Inputs 由其 schema 决定。

2026-10-07 当前参考完整源码确认：字段控件提交即触发 `onChange`；Cancel 逐字段恢复打开时的值，Reset 逐字段应用默认值，Ok 仅关闭。关闭按钮、backdrop 和 Escape 也只关闭，不撤销已经提交的值；有菜单时 Escape 先关闭菜单。没有网络请求不代表没有本地/Worker 重算，因此旧请求计数不能证明参考使用草稿事务。

本地保留以下已验证的草稿和批量提交合同，与参考即时编辑明确不同：

- 输入修改先进入 draft state。
- Cancel、关闭和 Esc 不提交、不重跑。
- Reset defaults 只重置当前 dialog 的 draft，不提交、不重跑；由本地 Settings 单元、真实双引擎和浏览器验证该合同。
- Ok 经 `batchPineSettings` 合并 Inputs/Properties，一次引擎 update/重算，不能逐字段触发多次完整回测。
- 非法数值、空日期、越界、精度和单位按 schema 校验。
- 日期与时间使用图表时区解释，显示格式遵守已冻结的 locale 规则。

### 3.3 底部 Dock

- 是 Vela Workspace 的应用层兄弟节点，不是右侧 SidePanel。
- 默认高度约 280px，折叠为 45px；Header、五 KPI 和图表纵向排列。展开态范围为 104px 至本地宿主高度的 75%；拖拽结束低于 190px 收到 104px，低于 190px 隐藏图表、低于 230px 隐藏坐标轴。方向键步长 16px，Shift 为 48px，Home 到上限、End 到下限；折叠保留名称/日期/净利与 Viewer 入口。实际参考组件及本地两浏览器证据见 `audit-evidence/2026-10-07-dock-components/`，数值用于组件交互，不要求参考整页坐标一致。
- 顶部包含策略名、结果日期范围、折叠和打开完整 Viewer。
- 展示 Net Profit、Trades、Win Rate、Max Drawdown、Profit Factor。
- 展示累计 P&L/Equity 图形。
- 支持 Pointer 拖拽、Pointer Capture、窗口变化后的高度 clamp 和键盘调整。
- 拖动时图表必须连续 reflow，不能出现空白、遮挡或坐标错位。

### 3.4 完整 Viewer

- Viewer 使用本项目的图表/回测宿主区域，不跳转路由，也不是浏览器全屏 Modal。
- 保留本项目既有图表工具栏及其功能，按实际可用宽高布局。不创建参考站左侧 AI 对话区或顶部登录 banner，也不保留它们的占位；参考宿主元素不属于复刻范围。
- 返回图表时恢复原 chart、viewport、面板高度和回测摘要。
- Header 保留策略收藏星标；收藏状态必须与现有 FavoriteService 和指标列表同步，不能形成第二份状态。
- 每次重新打开默认进入 Performance。
- Tab 栏 sticky，内容区独立滚动。
- 同一次打开期间共用内容区当前 scroll position；切换 Tab 时按新内容实际高度夹紧，不分别记忆各 Tab 位置。再次打开进入 Performance/top0；同 Tab 的临时加载保留位置，导航、终态和报告身份变化清理待恢复位置（H-09）。
- Viewer 和 Dock 共享同一份结果快照，不各自重新计算。

### 3.5 Performance

必须复刻：

- 顶部 Summary 与累计 P&L 图。
- Net Daily PNL 图。
- Weekday Performance 图。
- All / Long / Short 对比表。
- Net Profit。
- CAGR。
- Gross Profit / Gross Loss。
- Profit Factor。
- Average P&L per Day / Week。
- Drawdown。
- Calmar / Sharpe / Sortino。
- Buy and Hold PnL / % Gain。
- Strategy Outperformance。
- `Strategy Outperformance` 的领域单位固定为账户币种金额，公式为 `Net Profit - Buy and Hold PnL`；百分比超额收益若参考证据要求，必须使用独立字段名，禁止与金额字段复用。静态样本目前为 `—`，可见单位后缀和精度仍由 G0 动态样本冻结。
- Performance 表的 `Drawdown` 为单一复合行（金额与百分比在同一单元格呈现），并保留 `Risk-Adjusted Performance`、`Benchmark` 两个分组标题；不得未经证据拆成两个可见 Drawdown 行。
- Tooltip、legend、hover、空数据和 benchmark 不可用状态。

参考图表使用 Highcharts 13.0.0。为最大化视觉与交互一致性，默认实施方案使用本地打包的同版本 Highcharts，并按需加载；不使用 CDN。

### 3.6 Trades Analysis

动态实测确认需覆盖：

- 顶部两列 `P&L Distribution (CUR)` 与 `Winrate`；前者包含 Avg Winning、Avg Losing、
  Avg Trade 三条参考线，后者是 winner/loser/可选 breakeven donut，不存在 `Current` slice。
- 第一张 All / Long / Short 表严格包含 Closed/Winning/Losing/Breakeven Trades、Win Rate、
  Avg P&L、Avg Winning/Losing Trade、Largest Winning/Losing Trade 十行。
- 全宽 `Duration vs P&L (CUR)` 散点图、Profit/Loss 外部图例和不进入图例的 OLS trend。
- 第二张 All / Long / Short 表严格包含平均交易/胜/负 duration、Avg Trades per Day/Week、
  Longest/Shortest Trade、Longest Winning/Losing Streak 九行；streak 单位为累计 duration bars。
- 当前未平仓行与真正 breakeven 在领域数据中保持可区分；仅 Analysis presentation selector
  兼容参考站将 current/open `delta=0` 行显示为 Closed/Breakeven 的口径，不能污染 Calendar、
  Simulation、真实 closed population 或策略账本。
- Trades Analysis 不展示 `Trade Frequency`、`Duration`、`Streaks & Recovery` 卡片；
  Recovery 只属于 Simulation。零交易时整页显示 `No trades available`。

所有字段、tooltip、坐标、排序和空态在 G0 形成逐字段 Parity Matrix；未有参考证据的字段不得自行添加。

### 3.7 Trades Log

- 默认按 Trade # 降序展示（动态样本为 `13 → 0`）；Trade # 规则、其它排序字段和稳定 tie-breaker 均需按参考冻结，不得用 Entry 时间升序替代默认顺序。
- 当前动态样本的可见列为 Trade #、Entry、Exit、Size、Net P&L、MFE、MAE、Cumulative P&L；其它列（包括独立 Direction 列）只有在 G0 复测确认后才可增加。
- Long/Short 的方向标签/颜色按参考呈现，不应未经证据新增独立表格列。
- Entry/Exit 单元格悬停或聚焦后出现 `Show entry/exit on chart`。
- 点击后关闭 Viewer、恢复图表、将目标 bar 放在确定位置并显示 crosshair/高亮。
- 定位不改变回测结果、策略参数或图表市场。
- List / Calendar 两种 View Mode 使用同一交易源。
- Calendar 按月分页，显示每日 P&L、交易数、胜率和月汇总。
- Calendar 以 exit timestamp 归属日期；未平仓交易不进入已实现日历。
- CSV 导出：当前动态样本未观察到可见入口，因此暂不强制实现或增加新的可见按钮；若 G0 复测确认参考站存在该能力，再冻结字段、顺序、时区和数值精度并纳入对应 Gate。

反手交易必须区分“交易 size”和“订单 marker quantity”：从 -1 反转到 +1 时，交易行 size 可为 1，图表成交标记可能是 +2。

动态样本中未平仓兼容行出现过 Trade #0、epoch 日期和 `N/A` 的组合。G0 必须冻结其最终可见文案；领域层不得把 `0`、`1970-01-01` 或 `N/A` 当成真实 exit，Adapter 统一规范为 `exitTime: null`。即使为视觉一比一保留参考显示，排序、Calendar、duration、closed-trade 统计和 Simulation 也只能按 `null/open` 语义处理。

### 3.8 Simulation

必须复刻：

- Resample：从已平仓交易中有放回抽样。
- Shuffle：对同一组已平仓交易做无放回重排；每条路径最终收益相同。
- 默认 1,000 runs、P&L variation 0%、Preserve win/loss 关闭。
- 1.5×、2×、3×和自定义 drawdown threshold。
- USD / % 单位。
- Histogram / Cumulative 切换。
- Probability of profit、Median outcome、P95–P99 drawdown、Risk of ruin、阈值突破概率、P95 losing streak、Actual open max drawdown。
- Simulated paths 与分位带。
- Outcome、Drawdown、Streaks & Recovery 图表/表格和说明文案。

线上生产 chunk 与动态样本已经确认 `P&L variation` 使用 Laplace variation，MAE 按同一绝对因子缩放，`Preserve win/loss` 在 variation 后恢复来源交易的盈亏符号。参考生产实现固定使用 seed `12648430`；本项目生产和测试均保持同一 deterministic seed，不再使用运行时随机 seed。公式、PRNG 序列和 seed 必须由领域单测与浏览器 fixture 共同锁定，参考版本变化时先更新证据再改实现。

## 4. 数据人口与公式合同

### 4.1 单一原始报告，多组显式 selector

Dock、Viewer 和四个 Tab 必须读取同一份 `BacktestReport`。参考站不同页面存在人口差异，因此不强行用一个分母，而是在同一原始数据上建立命名明确的 selector：

- `closedTrades`：真正已平仓交易。
- `openTrades`：当前未平仓交易。
- `realizedNet`：已平仓净收益。
- `unrealizedNet`：当前浮动收益。
- `markToMarketNet`：realized + unrealized。
- `analysisRows`：参考 Trades Analysis 实际展示人口。
- `simulationPopulation`：Simulation 实际抽样人口。

这样既防止页面各自私算，又能有意复刻参考站已确认的不同口径。

所有上游未平仓 sentinel（`exitTime=0`、epoch 或文本 `N/A`）在 Adapter 边界转换为 `null`；可选 raw 值只能用于诊断/兼容显示，禁止进入日期 bucket、平仓排序或已实现统计。

### 4.2 已观察到的兼容口径

一次动态样本中观察到：

- Summary：Trades 13、8 胜 5 负、61.54%。
- Simulation：使用 13 个 closed trades。
- Shuffle 的固定最终 realized 结果为 11,304.43 USD。
- Summary Net Profit 为 10,943.62 USD，包含约 -360.81 USD 当前浮亏。
- Trades Analysis 显示 14 rows、8 winner、5 loser、1 个仅在该页面投影为 breakeven 的
  current/open 兼容行，胜率 57.14%；可见图表中没有独立 `Current` 类别。
- 静态快照还出现过 Dock 33.74% 与 Viewer 33.33% 的不一致；该差异目前只作为待复验样本，不直接复制为产品规则。

因此当前兼容目标是：

- Summary trade count / win rate 使用已平仓非零结果人口。
- Summary Net Profit 使用 mark-to-market。
- Simulation 只使用 eligible closed trades。
- Trades Analysis 按参考行为显示 current/open 兼容行并使用自己的分母。

G0 将固定 candles、脚本、参数和时间范围重新验证上述推断。若产品决定修正参考站自身的不一致，必须写成明确的有意偏离，不能悄悄统一后仍声称一比一。

### 4.3 公式必须显式定义

至少冻结以下公式：

- `grossProfit = Σ(max(tradeNetPnl, 0))`。
- `grossLoss = abs(Σ(min(tradeNetPnl, 0)))`。
- `realizedNet = Σ(closed trade netPnl)`。
- `markToMarketNet = realizedNet + openPnl`。
- `profitFactor = grossProfit / grossLoss`。
- Win rate 的交易人口、breakeven epsilon 和费用前/后分类。
- Avg trade、Avg winner、Avg loser 的分母。
- Cumulative P&L 按 exit 时间正序累计，列表可倒序展示。
- MFE/MAE 的方向调整、手续费、滑点和 intrabar high/low 口径。
- Portfolio drawdown 与单笔 MAE 分开。
- Drawdown 金额和百分比的权益峰值分母。
- CAGR 的起止日期与年化方式。
- Sharpe/Sortino 的采样周期、无风险利率和样本不足规则。
- Calmar 的收益和 drawdown 分母。
- Daily/weekly/weekday 的 timezone、bucket 和未交易日期规则。
- Duration 的时间和 bar 计数方式。
- Profit Factor 在 grossLoss=0、无交易和全平手时显示 `∞`、`—` 或其他参考值。
- `NaN`、`Infinity`、负零、超大数、小币种精度和单位格式化。

### 4.4 数据来源与可用性

每项指标携带来源与可用原因：

```ts
interface BacktestMetric {
  value: number | null;
  unit: 'currency' | 'percent' | 'ratio' | 'count' | 'contracts' | 'duration';
  source: 'engine' | 'trade-ledger' | 'derived';
  unavailableReason?:
    | 'not-exposed'
    | 'not-applicable'
    | 'insufficient-data'
    | 'partial-history'
    | 'partial-ledger'
    | 'division-by-zero';
}
```

不支持或数据不足时显示参考样式的 `—`，不得显示伪造的 0。最终版本不允许保留 `approximation` 名义下的近似正式指标。

## 5. 目标架构

### 5.1 数据流

```text
Binance / Hyperliquid OHLCV
             ↓
Vela Workspace + PineWorkerEngine
             ↓
script:run / handle.context() / trades()
             ↓
VelaBacktestResultsAdapter
  - bootstrap
  - cell/indicator lifecycle
  - revision / stale guard
  - capability / provenance
             ↓
BacktestStore ─────→ BacktestMetrics / Simulation Worker
      │
      ├────────→ BacktestDock
      ├────────→ BacktestViewer（4 Tabs）
      └────────→ BacktestChartNavigator
```

### 5.2 模块落点

```text
src/domain/
  backtesting.ts
  backtest-metrics.ts
  ports/
    backtest-results-port.ts
    backtest-control-port.ts
    backtest-chart-port.ts

src/integrations/vela/
  backtest-results-adapter.ts
  backtest-control-adapter.ts
  backtest-chart-adapter.ts

src/integrations/storage/
  backtest-preferences-repository.ts

src/features/backtesting/
  backtest-store.ts
  backtest-controller.ts
  backtest-workbench.ts
  backtest-viewer.ts
  backtest-formatters.ts
  simulation-worker.ts
  views/
    summary-view.ts
    performance-view.ts
    trades-analysis-view.ts
    trades-log-view.ts
    simulation-view.ts
  charts/
    chart-factory.ts
    chart-options.ts
  backtest.css
  backtest-responsive.css
```

目录表示职责边界，不要求为几行逻辑制造空文件。不得将回测逻辑重新堆入 `main.ts`、Indicator Manager 或通用 `WorkspacePort`。

### 5.3 职责边界

- `domain/backtesting.ts`：领域模型、状态、能力和人口定义，不导入 Vela 或 DOM。
- `backtest-results-adapter`：唯一读取 ScriptRun、Handle、Chart、Workspace 的结果适配器。
- `backtest-control-adapter`：Inputs/Properties schema、draft 提交和批量更新。
- `backtest-chart-adapter`：精确定位时间/bar，隔离 Vela 导航 API。
- `backtest-store`：状态机、active cell、active strategy、revision、last-good result 和 lazy ledger。
- `backtest-metrics`：纯函数聚合和 selector，不接触 DOM。
- `simulation-worker`：随机模拟、取消、进度和固定 seed 测试。
- `backtest-workbench`：布局、splitter、折叠和 Viewer 容器。
- 各 View：只消费 Store selector，不直接访问 Vela。
- Preferences Repository：只保存确认需要持久化的 UI 偏好，不保存回测结果。
- Backtesting Feature 只能通过新增回测端口和应用层挂载点接入，不得反向修改 Indicator、Editor、Template、Favorite Service 的内部实现；结果适配或 UI 故障必须被捕获并隔离，不能阻断 Workspace 初始化。
- 回测监听和资源必须由同一 `destroy()` 生命周期管理，且重复挂载/卸载后订阅数、Worker 数和图表实例数回到基线。

### 5.4 宿主布局

应用层改为：

```text
#app.quant-workspace-shell
├── #workspace                  VelaHost，min-height: 0
├── #backtest-workbench         桌面 Dock，shrink: 0
└── #backtest-viewer            覆盖 chart 工作区的 Viewer
```

要求：

- 不向 Vela 私有 DOM 内部注入节点。
- Vela 保持挂载，Viewer 打开时不销毁并重建 chart。
- Dock resize、折叠、Viewer 开关后触发受控 reflow。
- 全局仅挂载一套可见 report DOM，不复制静态快照中隐藏的多套 SVG。
- 回测 Controller 必须先于 Workspace 销毁，所有图表、Worker、Observer、监听和 Promise generation 都被释放。

## 6. 领域数据契约

### 6.1 标识、状态和终态

```ts
interface BacktestKey {
  cellId: string;
  indicatorId: string;
}

type BacktestStatus =
  | 'waiting-data'
  | 'compiling'
  | 'computing'
  | 'updating'
  | 'ready'
  | 'suspended'
  | 'no-data'
  | 'no-trades'
  | 'open-only'
  | 'partial'
  | 'error';

type BacktestFinality =
  | 'historical-final'
  | 'live-provisional'
  | 'partial-history'
  | 'unknown';
```

每个结果的稳定 key 为 `cellId + indicatorId`。不得只按策略标题、symbol 或 indicatorId 全局索引。

### 6.2 BacktestReport

完整报告至少包含：

- key、revision、snapshot/runId。
- title、source identity、report schema version，以及 engine/bridge/host 的版本与构建 SHA。
- provider、symbol、display symbol、timeframe、timezone、currency、price precision。
- requested range、actual data range、effective strategy range。
- cause、status、finality、forming、history complete/reason/progress。
- Inputs schema/value 和 Properties schema/value。
- Account state：position、avg price、equity、initial capital、realized/unrealized P&L、gross、drawdown/run-up。
- Closed trades、open trades、analysis rows。
- Raw orders、fills 和 reversal relation。
- Equity、drawdown、benchmark series。
- 汇总、All/Long/Short、daily、weekly、weekday、duration 和 streak selector。
- Simulation input/result/status。
- warnings、error、capabilities、provenance、availability。

`currency`、range、timezone 等不应塞入 WorkspacePort；新增最小只读 `BacktestContext` 按 cell 提供。

### 6.3 能力声明

```ts
interface BacktestCapabilities {
  tradeLedger: boolean;
  exactEquityCurve: boolean;
  exactDrawdownCurve: boolean;
  riskRatios: boolean;
  benchmark: boolean;
  rawOrders: boolean;
  rawFills: boolean;
  barIndices: boolean;
  individualOpenPnl: boolean;
  executionPrecision: 'chart-ohlc' | 'lower-timeframe' | 'tick';
}
```

UI 根据 capability 决定展示正式值、禁用控制或显示 `—`。仅解析到 `use_bar_magnifier=true` 不代表高精度撮合已经生效。

标量能力与 series 能力必须分开：settled run 暴露 CAGR/Sharpe/Sortino、drawdown 百分比或 Buy & Hold 标量，只能证明该标量可显示，不能把 `exactEquityCurve`、`exactDrawdownCurve` 或完整 benchmark series 自动切为 true。所有百分比 UI 字段统一存储显示百分点（例如 `12.5` 表示 `12.5%`）；领域纯函数内部若使用比率（`0.125`），只能在 Adapter/UI 边界转换一次。`Strategy Outperformance` 是账户币种金额，不参与该百分比换算。

## 7. 事件、并发与状态机

### 7.1 状态转换

```text
ABSENT
  └─ add strategy → WAITING_DATA / COMPILING
       └─ run start → COMPUTING
            ├─ complete + trades → READY
            ├─ complete + 0 closed + open → OPEN_ONLY
            ├─ complete + no position → NO_TRADES
            ├─ incomplete/aborted → PARTIAL
            └─ failure → ERROR

READY / NO_TRADES / OPEN_ONLY
  ├─ inputs/code/market change → UPDATING（保留 last-good + 明确遮罩）
  ├─ hide → SUSPENDED
  ├─ live tick → READY（finality = LIVE_PROVISIONAL）
  └─ remove/cell destroy → ABSENT
```

重算失败时保留 last-good 还是清空，按参考实测冻结；默认建议保留并明确标识 error/stale，避免旧结果被误认为新结果。

### 7.2 必须处理的 Vela 事件

| 事件 | 行为 |
| --- | --- |
| `script:run` strategy | 更新轻量概要、revision 和 finality；按策略拉账本 |
| `script:run` indicator | 同 ID 从 strategy 改为 indicator 时删除旧回测结果 |
| `indicator:added` | 绑定 ready/error 并执行 bootstrap |
| `indicator:removed` | 清理结果、选择和在途任务 |
| `indicator:visibility` | hidden 标记 suspended；show 标记 computing |
| `indicator:inputs` | 使当前结果进入 updating，等待一次 inputs run |
| `indicator:error` | 保留 last-good 并附错误；失败的 updateCode 不误删旧结果 |
| `load:start` | 隔离旧市场结果，进入 waiting-data |
| `load:end` | bars=0 时标记 no-data；如已有明确异常则同时附 error |
| `market:changed` | 更新 committed symbol/timeframe |
| `history:progress` | 更新深历史进度 |
| `history:complete` | 记录 depth/genesis/aborted；aborted 必须 partial |
| `cell:active` | 切换当前 Dock/Viewer 上下文 |
| `cell:created` | 绑定 Chart 并 bootstrap |
| `cell:destroyed` | 注销并删除该 Cell 结果 |

### 7.3 初始化补采

Workspace 可能在事件绑定前已经恢复并运行策略，因此首次订阅后必须：

1. 先绑定 Workspace 与每个 Chart 事件。
2. 枚举已有 cells 和 indicator handles。
3. 对已有 Handle 调用 `handle.context(['meta', 'strategy', 'trades', 'warnings'])`。
4. context 为空时等待 ready 后重试。
5. 等待 `chart.historyComplete()`；如果已错过 completion reason，标记 unknown，不伪造成 depth/genesis。
6. 生成与后续 `script:run` 相同的领域事件。

### 7.4 异步账本一致性

`run.trades()` 是异步读取，不能假设 Promise 返回时仍对应事件产生时的同一执行上下文。必须实现：

- 每个 BacktestKey 独立 revision。
- 每个策略最多一个账本请求在途，后续请求合并为 desiredRevision。
- Promise 返回前后检查 key、revision、application epoch 和策略是否仍存在。
- 旧结果直接丢弃并记录 stale-drop，不更新 UI。
- 如果期间出现新 revision，立即为最新 revision 补拉一次。
- `complete=false` 不拉完整 ledger。
- tick 更新轻量概要，不在每个 tick 传输完整账本。
- bar 或交易指纹变化时刷新账本。
- 面板关闭时只维护必要概要。
- remove、cell destroy、market change、app destroy 都使在途结果失效。

G4b.2 已为概要和精确曲线增加同一 `runId/snapshotRevision`：历史 settled run 按需拉取完整 `reportSeries`，实时形成 K 线仅合并 `reportTail`，不在每个 tick 复制全历史。任何身份、revision、point count 或单调性不一致的快照都不得发布 exact capability，应保留 last-good 或明确降级为 provisional。交易账本与 raw order/fill 尚未全部共享该原子包络，因此强一致承诺仍只限于已校验的 summary + report series。

G4b.3 将 trade bar-index capability 进一步绑定到账本 revision：只有 `ledgerState === 'ready'`、`ledgerRevision` 等于当前 revision，且每笔必需 index 均为非负 safe integer 时才可用；closed trade 必须有 exit index，`exit >= entry`，所有 index 都不得超过当前 execution bar。形成新 live revision 时先撤销旧 ledger 的 exact capability，等待新 revision 账本 ready 后重新校验，不能把旧交易定位误标为当前精确结果。

持仓 bar 数遵循 TradingView/Pine 的包含端点口径：`exitBarIndex - entryBarIndex + 1`，因此同一根 K 线内进出记为 `1`。该 duration 只在 exact `barIndices` capability 可用时计算；否则保持 unavailable，不使用时间差或其他近似值补齐。

## 8. Vela/PineTS 能力改造

### 8.1 当前可直接使用

- StrategyState 的仓位、均价、equity、open/net/gross P&L、胜负平、最大回撤/Run-up、初始资金、账户币种以及 All/Long/Short 最大持仓。
- StrategyTrade 的方向、数量、Entry/Exit 时间价格与 bar index、订单 ID、备注、P&L、手续费、MAE/MFE 和 open 状态；bar index 仍受当前 revision 账本校验约束。
- Vela 图表上的成交标记。
- Inputs / Properties schema 和批量更新。
- complete、forming、warnings 和错误。

### 8.2 扩展 Vela-PineTS 桥接

已落地：

- CAGR、Sharpe、Sortino、Buy & Hold PnL/%、Strategy Outperformance 与 Drawdown/Run-up 百分比的有限值透传。
- `reportSeries` 与 `reportTail` 两个 opt-in selector；普通 summary 不携带历史数组，保持 O(1) payload。
- `runId + snapshotRevision + barIndex + points` 曲线 envelope；in-process 与 Worker 使用同一字段合同。
- 只有在曲线与 Strategy summary 的 run identity、snapshot revision、point count 和 bar index 一致时，应用 Adapter 才接受该快照。
- 同步 snapshot/list 读取命中 full-series pending 时保留 last-good；full+tail 交错与连续 live-run restart 会重绑新 run expectation，并已有三项竞态回归用例。
- `account_currency` → `accountCurrency` → `AccountState.currency` → UI report `currency`；`max_contracts_held_all/long/short` → `maxContractsHeldAll/Long/Short`。
- `entry_bar_index/exit_bar_index` → `entryBarIndex/exitBarIndex` → UI `entryBar/exitBar`，并按 ready/current-revision ledger、safe integer、closed-trade 完整性、先后顺序和 execution bar 上界开启 capability。
- G4b.3 的 `quant-tools-g4b.3` / `reportSchemaVersion=3` 与 G4b.2 的 `quant-tools-g4b.2` / schema 2 均为历史已验证身份；当前两层 Fork 身份为 `quant-tools-g8.1` / `reportSchemaVersion=4`。曲线传输 envelope 自身仍为 `schemaVersion=1`，不得与 report schema 混为同一版本字段。

当前合同：

- 未平仓快照及带身份的 raw order/fill、partial progress、parent/reversal relation 已实现；三项有限组合已由当前需求表 ENGINE-03 关闭，后续修改保留回归。
- summary/trades/series/audit 由同一次联合 context 读取并验证 run/revision 与能力；不另建平行 DTO。双真实引擎实时风险回滚已验证当前分支的账本/audit/完整曲线与静态结果一致。

上述新增字段属于数据合同补齐。参考 UI 没有独立 Currency、Max contracts 或 Bar index KPI/列，因此在取得相反对标证据前不新增这些独立可见项；Entry/Exit bar index 只服务现有定位交互。

Worker 内联 PineTS，因此升级项目根部 `pinets` 依赖不会自动更新实际引擎；应重新构建和锁定自己的 Vela-PineTS Worker 版本。

### 8.3 新增历史结果模型

为完整 Performance 和精确联动的历史结果模型：

- [x] 不可变 `runId/snapshotRevision` 身份与应用层 `snapshotToken`。
- [x] 逐 K close mark-to-market equity series。
- [x] 逐 K close drawdown/underwater series，并保留与累计 intrabar max drawdown 的语义区分。
- [x] 首次真实 fill 锚定的 benchmark/buy-and-hold series；无 fill 时保持 null，不伪造曲线。
- [x] 具备 `runId/revision/bar` 身份校验的 audit order ledger；仅在本地 Vela-PineTS
  `auditLedger` 选择器成功校验后公开，不能由图表 marker 或普通 trade 行反推。
- [x] 具备 `runId/revision/bar` 身份校验的 audit fill ledger；partial progress、取消与
  fill lifecycle 保持为 append-only 审计事件，而不是宣称交易所逐笔成交。
- [x] Entry/Exit bar index，以及与 ledger revision、execution bar 边界绑定的精确 capability。
- [x] audit ledger 中的有限 parent/reversal relation（仅限引擎已明确发出的 DTO）。
- [x] 同一 context 的联合读取及 run/revision 门控，含账本、order/fill 与曲线。已有 partial progress、parent/reversal；
  跨订单价格段顺序、实时风险回滚与归档重放已按 ENGINE-03 有限合同验收，不重复设计报告包。
- [x] 数据覆盖、执行起止、requested/applied precision 和 fallback reason（G8.1 第一版；完整逐 Fill/复合订单语义仍待）。

完整历史通过异步 selector 按需拉取，不塞入每个 tick 的 `script:run`；live tick 只传输并合并尾点。在大数据曲线的 downsample/虚拟化与内存预算完成前，该实现只表示契约已接通，不表示性能 Gate 已通过。

### 8.4 图表定位公开接口

Vela 内部存在 bar focus 行为，但当前不是稳定公开 Host API。为实现一比一 `Show entry/exit on chart`，增加窄语义接口：

```ts
interface BacktestChartPort {
  focusExecution(input: {
    cellId: string;
    indicatorId: string;
    barIndex?: number;
    time: number;
    side: 'entry' | 'exit';
  }): void;
}
```

接口负责：

- 激活正确 Cell。
- 关闭 Viewer 但保留 Dock。
- 以冻结的 bar 数量和左右留白设置 visible range。
- 将 crosshair 聚焦到精确 bar。
- 高亮对应 marker/持仓区间。
- 恢复键盘焦点和读屏通知。

不得调用 Vela 私有字段或依赖不稳定 DOM 坐标。

### 8.5 高精度撮合

按现有 [`TODO.md`](../../../TODO.md) 的 Bar detalization 方案实施：

- 默认父周期 OHLC/OLHC 四点路径。
- 按映射加载低周期 K 线并按时间回放。
- 市价、限价、止损、止盈、移动止损、反转、部分平仓和保证金事件。
- `calc_on_order_fills`、`calc_on_every_tick`（首版重算边界已实现，完整实时/逐 Fill 语义仍待）、`process_orders_on_close`、`backtest_fill_limits_assumption`。
- 缺低周期数据时显式回退并展示原因。
- 结果记录 requested/applied precision、低周期和覆盖率。

这属于最终功能完备 Gate；不会为了提前展示 UI 而假装已支持。

### 8.6 能力归属与改造边界

| 能力 | 首要落点 | 是否需要底层 Fork |
| --- | --- | --- |
| Dock、Viewer、四个结果页、Simulation、状态管理和样式 | Quant Tools `src/features/backtesting` | 否 |
| 读取当前公开的概要、交易账本、Inputs/Properties | Quant Tools Vela Adapter | 否 |
| 透传 PineTS 已有但桥接裁掉的风险/交易字段 | Vela-PineTS | 是，必需 |
| Account currency、All/Long/Short 最大持仓和逐笔 Entry/Exit bar index | Vela-PineTS + Quant Tools Adapter | 是，G4b.3 已接通并按 ledger revision 校验（当前 Fork 身份 G8.1/schema 4） |
| 原子 runId、逐 K 权益/回撤/benchmark | PineTS + Vela-PineTS | 是，G4b.2 已落地契约，完整验收待 Gate |
| 原始订单/Fill 历史、精确 reversal relation | PineTS + Vela-PineTS | 是，尚待实现 |
| Bar Magnifier、低周期价格路径与成交顺序 | PineTS + Vela-PineTS Worker | 是；第一版已接入，最终版仍需完整语义与逐 Fill 对账 |
| Entry/Exit viewport、crosshair 和 marker 精确高亮 | Quant Tools Adapter 优先；Vela 公共 API 不足时进入 Vela | 条件式 |
| Binance/Hyperliquid OHLCV 获取和实时订阅 | 现有 Vela Provider | 否 |

执行原则是先在应用适配层证明公共 API 的能力边界，再引入最小源码改动。页面、报表公式和 Simulation 不得下沉到基础包；PineTS 不重复实现应用层可以由不可变原始数据纯计算得到的指标；Vela 不承担策略撮合。这样后续某项上游能力补齐时，可以删除对应本地补丁，而不需要重写整个回测工作区。

## 9. Fork 与本地源码依赖策略

### 9.1 Fork 决策矩阵

最终依赖形态统一为“**两个必需 Fork + 一个条件式 Fork**”，不得再默认三个基础包都长期本地化：

| 组件 | 当前基线 | 引入时点 | 最终处理 | 改造边界 |
| --- | --- | --- | --- | --- |
| Quant Tools 应用层 | 当前仓库 | G1 起 | 不 Fork | Dock、Viewer、四个 Tab、Simulation、状态和样式均在 `src/features/backtesting` |
| `@luxalgo/vela-pinets` | `0.2.13` | G4a | 必须维护本地 Fork | 扩展 PineTS→Vela 映射、Worker 消息、不可变结果和内联本地 PineTS |
| `pinets` | `0.9.34` | G4a | 最终版必须维护本地 Fork | G4b 增加可观测结果，G8 第一版实现校验后的 Bar Magnifier/低周期回放；完整语义仍待 |
| `@luxalgo/vela` | `0.7.7` | G2 Spike 后决定，最迟 G4a | 条件式最小 Fork | 仅补公共 run selector 或精确 bar focus/marker highlight；公共 API 达标则继续使用官方精确版本 |
| Binance/Hyperliquid Provider | 随 Vela | 现有 | 不单独 Fork | 继续负责 OHLCV、symbol info、实时订阅和低周期序列 |
| Highcharts | 未安装 | G5 | 精确锁定 `13.0.0` 普通依赖，不 Fork | 报告图表，本地打包、按需加载，不修改其源码 |

边界解释：

- 回测页面本身绝不进入 Vela、Vela-PineTS 或 PineTS。
- PineTS 已有 CAGR、Sharpe、Sortino、Buy & Hold、currency、最大持仓和 trade bar index 等字段；G4b.3 已通过 Vela-PineTS 与应用 Adapter 接通 currency、最大持仓和 trade bar index，没有重复改写 PineTS 计算。
- PineTS 上游基线没有满足本计划要求的不可变逐 K 报告、完整历史订单/Fill ledger 和低周期撮合；本地 G4b.2 已补逐 K 报告，G8 第一版已补 provider-backed lower-timeframe 四点回放与显式 fallback，订单/Fill 历史和完整 TradingView 低周期语义仍需继续修改其源码。G4b 只增加可观测性，不改变成交语义。
- G2 必须用公开 API 实现定位 Spike，并生成 `docs/forks/VELA_FORK_DECISION.md`：记录可用 API、缺口、截图/像素证据、是否需要 Fork 和可删除补丁的条件。Spike 不得访问私有 renderer、内部字段或依赖 DOM 坐标。
- 若公开 Vela 已能满足稳定 run selector 与精确定位，则不创建 `packages/vela`，根依赖锁定官方 `0.7.7`；只有决策记录证明缺口不可由应用 Adapter 解决时，才导入 Vela 源码。
- 最终仓库应有两个本地源码包，或在 Vela Fork 被证明确有必要时有三个；目录、`package.json`、lockfile、构建脚本和决策记录必须完全一致。

### 9.2 管理方案

采用两层组合：

```text
Git subtree --squash
  └─ 保存官方完整源码、固定上游 SHA、支持后续同步

npm workspaces + file: dependencies
  └─ 本地解析、构建、测试和锁文件复现
```

不采用以下方式作为正式方案：

- 不修改或保存 `node_modules` 中的构建产物。
- 不把 npm 安装包中的 `dist` 当成 Fork 源码；当前安装包并不包含完整上游开发源码。
- 不用 `patch-package` 承担引擎级改造。
- 不用 Git branch/tag URL 作为依赖，避免安装时漂移、联网和无法可靠生成 `dist`。
- 当前不使用 submodule，避免 clone、CI 和部署遗漏初始化。
- 当前不建立私有 npm registry；出现第二个消费项目后再评估。

每个源码包按两次独立提交接入：第一笔只导入并验证未修改的上游源码，第二笔才增加 Quant Tools 补丁。不得把上游导入、格式化和功能改造混在同一提交，否则后续无法可靠区分 upstream delta。导入前还必须核对 npm 包版本、仓库 tag/commit、`package.json`、公开 exports 和固定 fixture 行为；若 npm 发布物没有可追溯到等价源码的 tag/SHA，则暂停该包的源码改造并先形成来源差异记录，不能随意选取相近分支冒充基线。

### 9.3 目标目录

```text
quant-tools/
├── src/
├── packages/
│   ├── vela/                  # 仅 VELA_FORK_DECISION 判定需要时存在
│   ├── vela-pinets/           # 完整上游源码，桥接与 Worker
│   └── pinets/                # 完整上游源码，策略执行与撮合
├── docs/
│   └── forks/
│       ├── VELA_FORK_DECISION.md
│       ├── vela.md             # 仅实际 Fork Vela 时存在
│       ├── vela-pinets.md
│       └── pinets.md
├── package.json
└── package-lock.json          # 根工作区唯一安装基线
```

每份 `docs/forks/*.md` 必须记录：

- 官方仓库 URL。
- 初始 tag、version 和完整 commit SHA。
- 本地版本号和导入日期。
- 修改目的、文件和公共 API。
- 上游源码导入提交与本地补丁提交。
- 对应单测/契约测试。
- 每次 subtree 同步、冲突处理和结果。
- 上游已提供等价能力时的补丁退场条件。

subtree 目录不包含嵌套 `.git`。各 subtree 自带的 lockfile 可保留用于来源审计和包内上游测试，但应用安装与发布只认根 `package-lock.json`。`node_modules`、缓存和临时构建目录不提交。默认不把可重建的 Fork `dist` 当作源码提交；根构建必须先生成依赖包 `dist` 再构建应用。

### 9.4 本地包解析

保留上游 package name，避免更改现有 import 和 peer dependency。默认的“两包本地化”配置为：

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  "dependencies": {
    "@luxalgo/vela": "0.7.7",
    "@luxalgo/vela-pinets": "file:./packages/vela-pinets",
    "pinets": "file:./packages/pinets"
  }
}
```

只有 `VELA_FORK_DECISION.md` 判定必须修改 Vela 时，才将第一项切换为 `"file:./packages/vela"` 并加入该源码目录。本地版本建议使用 build metadata，保持原 semver 基线和 peer range 兼容：

```text
@luxalgo/vela-pinets  0.2.13+quant.1
pinets                 0.9.34+quant.1
@luxalgo/vela          0.7.7+quant.1    # 仅条件式 Fork 启用时
```

规则：

- `file:` 是解析本地源码的硬约束；不能仅依赖同名 workspace 的隐式匹配。
- 根 `package-lock.json` 是应用 CI/本地构建的唯一依赖锁，必须提交。
- `npm ls @luxalgo/vela @luxalgo/vela-pinets pinets` 必须只有一份有效实例；PineTS、Vela-PineTS 必须解析到 workspace link，Vela 必须与决策记录一致地解析到精确 registry 版本或 workspace link。
- 应用只能从 package `exports` 导入，不允许深度导入 `packages/**/src`。
- 未进入 Fork 阶段前，上游包从 `^` 范围改为精确版本，禁止安装时静默升级。
- 根 package.json 记录已验证的 `engines.node` 和 `packageManager`；当前环境基线为 Node `24.15.0`、npm `11.13.0`、lockfile v3，正式写入前由 fresh build 再确认。
- Build metadata 只用于人读版本，不作为 Worker 身份证明。每个本地包必须生成机器可读 `fork-build-info`，至少包含 package name/version、upstream SHA、local patch revision 和 report schema version；Vela-PineTS 另外记录 bridge SHA 与 embedded PineTS SHA。
- in-process Engine 与 Worker 都必须把 build fingerprint 写入 `BacktestReport.provenance`；加入一个只有本地 PineTS 构建才会返回的无业务副作用 sentinel 契约，防止 Worker 意外内联 registry 版本或旧 `dist`。

### 9.5 构建和开发顺序

```text
packages/pinets → packages/vela-pinets ──────────┐
                                                  ├─→ Quant Tools App
@luxalgo/vela@0.7.7（默认）───────────────────────┘

packages/vela（条件式启用后替代官方 Vela）────────┘
```

要求：

1. `npm ci` 安装根 workspace 和全部构建依赖。
2. PineTS 先完成 build/typecheck/test；Vela 仅在本地 Fork 启用时执行同样步骤。
3. Vela-PineTS 使用本地 PineTS 和当前决策选定的 Vela 重新生成内联 Worker。
4. 运行 Vela-PineTS build/typecheck/test。
5. 再执行 Quant Tools 的 typecheck、build、单测和 E2E。

任何 PineTS 修改后都必须重建 Vela-PineTS；只重建根应用不能更新 Worker 中的 PineTS。根脚本新增：

- `build:forks`：按依赖顺序构建实际启用的本地包。
- `test:forks`：运行实际启用本地包的类型检查和测试。
- `predev`：至少保证 forks 已构建。
- `prebuild`：执行 `build:forks`。

频繁开发底层时使用各包 watch 或统一编排；Vite 仍消费包的公开 `dist/exports`，不能绕过包构建直接读取源码。

### 9.6 上游同步流程

每次升级必须作为独立变更执行：

1. 冻结当前 BTCUSDT fixture、数值、API 和视觉基线。
2. Fetch 官方 tags/commits，先确认目标 tag 与已发布 npm 包的来源对应，再在升级分支执行对应 `git subtree pull --squash`。
3. 解决本地差异冲突，不顺带重写不相关模块。
4. 更新 `docs/forks/*.md`、本地版本和根 lockfile。
5. 运行每个 Fork 的上游测试、本地新增测试和 typecheck。
6. 重新构建 Vela-PineTS Worker，核对实际内联的是目标 PineTS 版本。
7. 运行 Adapter 契约、BTCUSDT 数值对账、dev/prod E2E、Provider 和视觉测试。
8. 检查公共 API、bundle 和性能差异。
9. subtree 同步及完成合并所必需的机械冲突处理作为一笔提交；行为性本地适配、文档和 lockfile 另行提交；两者共同组成一个可回滚的升级变更集。

若未来需要把单个 subtree 发布为独立 Fork，可用 `git subtree split` 推送到专用仓库；本地单项目阶段不增加该维护成本。

### 9.7 可重复构建 Gate

Fork 接入后必须验证：

- Fresh clone，不依赖全局工具和旧 `dist`。
- 删除本地 Fork `dist`、根 `node_modules` 和 npm cache 后，`npm ci && npm run build` 能完整成功。
- `npm ci` 对 lockfile 不一致直接失败。
- lockfile 中实际启用的本地包条目为 workspace/file link，没有 registry 同名包重复实例；Vela 的解析方式与决策记录一致。
- 构建完成后 `git status` 干净，代码生成没有留下未提交文件。
- dev、production preview 和 E2E 实际加载本地版本及正确 Worker。
- 源码和产物不存在对 `node_modules` 的补丁依赖。
- 本地未改源码包接入后的固定 BTCUSDT 结果与原 registry 包逐笔一致，先证明依赖迁移为零行为变更。
- `BacktestReport.provenance`、Worker fingerprint、in-process fingerprint 和 `docs/forks` 中的 SHA 完全一致。
- Worker sentinel 契约通过，且故意替换成旧 Worker fixture 时测试能可靠失败。

“一次 clone 可构建”不等于完全离线；普通第三方依赖仍从 npm registry 安装。若以后要求断网安装，应独立建设 npm cache/mirror，不把整个 `node_modules` 提交进仓库。

### 9.8 Fork 引入与退场 Gate

每个条件式或新增补丁都必须满足相同治理规则：

1. 先用失败的能力/契约测试证明现有公开 API 确实不能满足需求。
2. 在 `docs/forks` 记录缺口、最小修改面、公开 API、测试、上游基线和负责人边界。
3. 只修改拥有该能力的最下层包；应用层问题不得通过修改 PineTS 或 Vela 掩盖。
4. 上游升级时先验证是否已经提供等价能力；若提供，则删除本地补丁并通过同一契约测试。
5. 某个包不再包含必要本地差异时，从 `packages/`、workspaces、`file:` 依赖和构建脚本一并移除，切回经过验证的精确 registry 版本，不长期保留无修改 Fork。

## 10. UI 对标与本项目布局适配规范

### 10.1 视觉基线

G0 在记录 viewport、DPR、字体、timezone、locale 和固定数据的前提下，分别记录参考站与本项目有效工作区的宽高；保存以下状态：

- Dock 展开、折叠、默认高度、最大可用高度。
- Viewer Header 和四个 Tab。
- 每个 Tab 的默认、hover、tooltip、选中和滚动状态。
- Settings Inputs/Properties。
- List、Calendar、Simulation 控件。
- loading、no-trades、open-only、partial、error。
- 当前验收桌面；手机 portrait/landscape 按 SCOPE-07 暂缓，既有采集保留。

所有测量写入 `BACKTEST_PARITY_MATRIX.md`，包含尺寸、间距、字体、weight、line-height、颜色、border、radius、shadow、z-index、动画时长和 easing。可在相同组件宽度下隔离比较局部样式，但诊断页面中的参考宿主偏移不得带入产品。最终必须验证本项目真实宿主下的布局与操作可用性。

### 10.2 对标评价标准（2026-10-07 用户修正）

- 功能、入口、交互流程、结果和状态按已冻结合同对标；四 Tab、Dock/Header、Calendar、Settings/Simulation 弹窗和图表联动均在范围内。
- 组件内部的信息层级、图标形状、字体、颜色、按钮/字段/卡片/图表风格及 hover/focus/selected 状态对标参考；文案、正负号、单位和格式须正确。已明确的数据/可访问性修正保留，不为追求外观复制参考缺陷。
- 整体布局适配本项目实际工作区。容器伸展、列宽、换行、分列和滚动可随可用宽高变化，保持模块层级、操作顺序和内容可读性；不为参考站 AI 侧栏、登录 banner 留白。
- 宿主差异带来的绝对位置/宽高、合理的亚像素取整和字体栅格化差异不单独判为失败。不再要求所有边界误差 ≤1px，或整页截图误差 ≤0.5%/1%。
- 遮挡、裁切、跨格不可读重叠、非预期页面横滚、图标错误、交互缺失和不可达入口仍须修复；不能以“布局适配”掩盖这些问题。
- 所有交互与异常状态必须实际操作并保留结构化断言；截图、DOM 和局部几何差分用于发现问题，不能只凭截图或放宽测试宣称通过。

对照证据保存 reference、candidate、输入/状态及两站各自有效工作区、viewport/DPR 元数据；必要时保存局部 diff 和测量结果解释差异，不将全页 diff 百分比作为硬门槛。在矩阵中区分“符合参考”“本项目布局适配”“明确保留的正确性/可访问性修正”和“未解决问题”，每项状态仍需要对应证据。

本地 screenshot baseline 继续用于发现项目自身回归。此次修正参考对标标准不授权无条件更新基线、弱化功能断言或将所有 PARTIAL 自动改为 PASS；历史像素测量只保留为局部设计/诊断证据。

### 10.3 响应式

本阶段验收桌面容器、紧凑窗口、DPR 和缩放。手机布局、触摸入口及 safe-area 按 SCOPE-07 暂缓；既有实现和证据保留，不作为本期退出条件。具体区分如下：

- 桌面 Dock、Viewer 和表格保留参考的信息层级与操作，按本项目容器伸展。
- 桌面紧凑窗口提供可达的 Backtest 入口、Viewer、弹窗与返回路径。参考站受 AI 侧栏/banner 影响的整页断点或仅 `Chart` 占位不作为本地产品要求，也不为模仿该占位隐藏本地功能。
- 验证桌面断点前后 1px、200% zoom、窄高和宽矮窗口；桌面窗口变窄不等于手机专项，不取消这些检查。
- Tab 可横向滚动且不触发页面拖拽。
- 表格和 KPI 横向滚动不锁死纵向页面；Calendar 保持七列和月份语义，但不得照抄参考窄屏金额跨格重叠。必要缩略提供点击/键盘可达的完整信息。
- 参考 Dock 重挂载后恢复展开 280px，当前原始组件没有高度/折叠持久化；本地继续使用版本化、校验并按 viewport clamp 的独立偏好增强。该差异已记录在 D-13，不再等待不存在的参考服务器持久化证据。

暂缓项：手机端策略完成后的打开/返回和再次入口、手机 portrait/landscape、safe-area，以及 touch/hover:none 的等价触摸入口与实机验收。手机代码、测试脚本和历史结果保留；可选执行不代表重新纳入本期必过门禁。

### 10.4 可访问性与视觉兼容

一比一复刻视觉和行为，但不复制静态参考中重复 ID、空 aria-label、无 tab 语义、背景可聚焦等不可见缺陷：

- Tab 使用 tablist/tab/tabpanel，并支持 Left/Right/Home/End。
- Splitter 提供 separator、valuemin/max/now、controls 和键盘箭头/Home/End。
- Collapse 提供 expanded/controls。
- Viewer 打开时管理焦点，Esc/Return 关闭并还焦。
- Viewer 打开时保持 Vela 图表挂载，但对被覆盖的图表、Dock 和菜单区域设置 `inert` 与合适的 `aria-hidden`；关闭时原子恢复，防止隐藏控件仍进入 Tab 顺序或读屏树。
- 图表提供可读描述或同数据表，不只靠红绿区分。
- 表格使用 caption、scope 和排序状态。
- Loading/result/error 使用克制的 live region。
- 支持 reduced-motion。
- 保持外观不变的前提下扩大透明触控 hit area。
- 策略标题只通过 `textContent` 渲染，避免脚本标题注入。

可执行验收门槛：本阶段以桌面 WCAG 2.2 AA 的浏览器自动化可验证部分为目标；axe 或等价自动检查不得有 critical/serious 违规，moderate 违规必须逐项记录并有豁免；键盘必须能完成所有 Viewer/Dock/Tab/表格排序/设置/关闭操作且无焦点丢失。上述桌面浏览器合同已通过；实体 VoiceOver 按 SCOPE-08、Safari 按 SCOPE-03、手机按 SCOPE-07 暂不做。视觉对标不能覆盖这些已明确的范围决定。

## 11. 性能、持久化与故障隔离

### 11.1 性能

- 聚合复杂度保持 O(trades + buckets)，每个 revision 只计算一次并 memoize。
- 1k/10k/100k trade fixtures 建立预算。
- Trades Log 使用虚拟列表或分页，不一次插入上万 DOM 行。
- 大曲线按像素宽度 downsample，同时保留 tooltip 原始数据访问。
- Simulation 超过阈值进入独立 Worker，支持 cancel 和 progress。
- Highcharts 懒加载、实例复用并显式 destroy。
- ResizeObserver 和 reflow 防抖，拖拽过程保持流畅。
- 面板隐藏时不重复渲染；重新显示后执行一次确定性 reflow。
- 为新增 JS/CSS 建立 bundle budget，避免无界增长。

运行期性能 Gate 的可执行阈值（以固定 Chromium、1440×900、DPR 1 的基线机记录；基线建立后可收紧，不得无证据放宽）：10k 笔首次聚合 p95 ≤ 100ms，100k 笔首次聚合 p95 ≤ 500ms；已有浏览器分页门禁也分别采用 100/500ms，不能拿分页时间代替 selector 聚合时间。Dock 拖拽/resize 的长任务 p95 ≤ 50ms 且采样帧率 ≥ 50 FPS；10 次 Viewer/Dock open→close 后 JS heap 相对基线回落至 ≤ 20MB 增量、销毁后 Highcharts/Observer 实例为零；单次交互不得重复完整 ledger 请求。同一 immutable report 的缓存命中与新报告首次计算分别记录，Firefox/其它 DPR 的兼容和性能结果不冒充固定基线预算通过。

生产包体使用当前 BUILD-02 / 矩阵 PF-07 / `scripts/check-bundle-size.mjs` 已建立的 main、Worker、Highcharts 分组 raw/gzip 预算；旧首轮草案的“新增 ≤100KB gzip”仅作历史目标，不能与当前已执行预算并列成两套现行门禁。本次复核未放宽运行期时间、帧率或内存阈值。每项需保存原始 trace、heap snapshot、bundle 报告和设备信息；后续更改阈值仍须在矩阵中明确记录依据。

### 11.2 持久化

不持久化计算结果。刷新后由已恢复的 Workspace 策略重新计算。

只允许持久化经 G0 确认的 UI 偏好，例如：

- Dock 高度。
- Dock collapse 状态。
- 可能的 View Mode。
- 首次完成提示是否已展示。

当前实现的 Dock 偏好采用独立版本化 key `quant-tools:backtest-dock:v1`，只包含
`{version,height,collapsed}`。读取失败、版本不匹配或非有限高度均回退到 Workbench
默认值；恢复高度还会按当前 viewport 和 min/max 约束 clamp。该 key 不包含回测报告、交易
账本、策略参数或 `quant-tools:workspace:v2`，Dock/Viewer/Simulation 生命周期也不会写入它。
2026-10-07 已读取当前原始 `w6` 组件及父调用：高度/折叠是组件内部 `useState(false/280)`，没有持久化 props、storage 或回调；重新挂载回到展开 280 并按宿主 clamp。本地保留版本化 Dock 偏好是明确的本地增强，不能宣称严格一比一，也不再等待服务器高度保存证据。

Viewer 每次重新打开默认 Performance 是已观察行为，不能被“记住最后 Tab”的常见做法破坏。策略 Inputs/Properties 继续由 Vela Workspace state 负责。

### 11.3 错误隔离与本地诊断

- 回测 UI 错误只降级 Backtesting Feature，不能使 Vela Workspace 崩溃。
- 用户可见 retry/close 和明确错误状态。
- 记录 run start/success/error/cancel/stale-drop、aggregation/render duration、trade count、cause、complete/finality。
- 诊断带 cell/strategy/revision correlation。
- 不记录 Pine 源码、完整交易明细、账户凭据或用户内容。
- 默认诊断为本地 no-op/console adapter，不引入外部运行依赖。
- 回测是可选应用层：构建/运行时 `VITE_ENABLE_BACKTESTING=false` 作为 kill
  switch 时，不创建 backtest host、Workbench、Controller、Provider/Worker 订阅，
  也不读取或改写 Workspace/脚本/收藏/模板 Storage；旧 Workspace 工具栏仍必须可用。
  默认未设置该变量时保持启用。该开关只在 composition root 生效，不散落到领域/引擎层。

### 11.4 非回归防火墙与验证证据

在 G1 之前建立 `BACKTEST_REGRESSION_BASELINE.md`，记录当前基线提交、Node/npm、浏览器、viewport、关键截图、localStorage 快照、Provider 请求形状、事件计数和以下命令结果：

- `npm test`
- `npm run test:regression:existing`（只跑回测接入前的原有回归集，当前基线为 22/22）
- `npm run build`
- `npm run test:e2e`
- `npm run test:e2e:prod`
- `npm run test:providers`（网络不可用时记录明确的环境原因，不得把跳过当作通过）

每个回测阶段至少重跑原有回归集、回测纯单测、构建、现有 E2E 和受影响的 Provider/存储测试；G9 必须在 fresh browser、生产 Preview、禁用参考域名和刷新/销毁场景下全部重跑。回归验证需包含：

- 顶部工具栏每个按钮的点击次数、弹层/面板开关和原有视觉快照。
- 指标 On chart、Favorites、Personal、Built-ins 的分类、星标、添加/删除和搜索结果。
- Pine 编辑器打开、运行、保存、删除和错误定位。
- Workspace 模板保存/加载、布局恢复、截图下载和 localStorage key/value 不变。
- Binance/Hyperliquid Provider 的历史 OHLCV 与实时订阅请求形状。
- `app.destroy()`、HMR 重挂载、cell/indicator 删除后的监听器、Worker、Observer 和 DOM 节点计数。

任何现有测试失败、基线截图出现未解释差异、事件/请求次数增加或旧 localStorage 无法恢复，均阻止该阶段合并；差异只有在明确记录为回测新增行为且不改变旧功能语义后才能通过。

### 11.5 本轮执行记录

截至 2026-09-26，G4b.2 revision 的历史增量命令证据为：原有回归集 `18/18`、根 `npm test` `103/103`、adapter/controller/domain 定向 `61/61`、PineTS strategy 子集 `11 files / 50 tests`、Vela-PineTS `22 files / 214 tests`，根 TypeScript 与 Vela-PineTS typecheck/lint 通过。新增契约覆盖真实逐 K equity/underwater/benchmark、forming-tail 回滚、in-process/Worker 映射、run-restart、同步 full-series pending 和 full+tail 竞态；真实浏览器 E2E 也已加入可见曲线来源必须为 `exact-equity` 的断言。PineTS 全仓测试因 `api.binance.com` connect timeout 未全绿，不得把策略子集 PASS 冒充为全仓 PASS。

G4b.2 的构建、指纹、开发/生产浏览器和 Provider 基础非回归已不再沿用 G4b.1 证据，而是在 G4b.2 revision 上完成重跑。仍未完成的是 PineTS 全仓联网套件、全量 DOM/事件/请求/Storage/生命周期计数、其余故障注入、视觉/性能 Gate，以及固定 BTCUSDT fixture 的 registry/零修改 workspace 逐笔对账。因此可以将“G4b.2 精确曲线与核心集成”标记为历史已验证，但不能将项目最终非回归 Gate 标记为完成。

G4b.3 增量（历史）已通过：`npm test` `191/191`、`npm run test:regression:existing` `18/18`、adapter/controller/domain 定向、Vela-PineTS 全量 `26 files / 227 tests`、G4b.3 定向、Pine strategy `15 files / 67 tests`、Vela-PineTS typecheck/lint、根 `npx tsc --noEmit`、`npm run check:dependencies`、fresh `npm run build`、dev/prod E2E 与 Provider smoke；其身份为 `quant-tools-g4b.3` / `reportSchemaVersion=3`，series envelope 独立为 `schemaVersion=1`。PineTS 全仓联网套件当时未记 PASS，不得把 strategy 子集冒充为全仓。

当前 G8.1 增量已通过：根原有回归 `22/22`、根全量 `219/219`、Pine strategy 定向 `21 files / 121 tests`、Vela-PineTS 全量 `27 files / 261 tests`、Provider network/history 离线 contract 各 `8/8`、固定 BTCUSDT fixture `2/2`、`npm run build`、`npm run test:e2e:performance -- --strict`、`npm run test:visual:a11y`、`npm run check:dist:independence` 和 `npm run check:dependencies`。当前 fingerprint 为 `quant-tools-g8.1` / `reportSchemaVersion=4`，series envelope 仍为 `schemaVersion=1`；最近一次带 `QUANT_PERF_ARTIFACT=1` 的性能运行记录在 `artifacts/backtest-performance-latest.json`：10k/100k 分页 p95 `38.4/40.6ms`、Dock FPS `59.87/59.91`、long-task p95 `0ms`、Simulation 10k `129ms`，均在预算内。该 JSON 是固定 Chromium 单机证据，不代表跨浏览器性能；未设置 `QUANT_PERF_ARTIFACT=1` 的性能命令只做门禁、不刷新 artifact。PineTS 全仓联网套件仍因 Binance ConnectTimeout 外部阻塞，不得记为 PASS；完整 TradingView 逐 Fill/复杂订单和项目 Final Gate 继续开放。

### 11.6 验证账本与项目 Final Gate

#### G4b.2 历史验证账本

前八项记录 G4b.2 精确曲线增量的历史验证结果；未通过的 PineTS 全仓联网套件必须保留明确阻断说明，但不妨碍保存本地阶段性 checkpoint。末两项属于 G4/G9 项目 Final Gate，在完成前不得宣称 G4b 或整个回测工作区最终完成、合入主分支或发布：

- [x] `npm run test:regression:existing` 为 `18/18`，确认架构、Storage、收藏、模板和旧快照恢复基线未改变。
- [x] `npm test` 为 `103/103`；G4b adapter/controller/domain 定向集为 `61/61`，覆盖 malformed/stale identity、run restart、sync pending、full+tail 和能力降级。
- [x] Vela-PineTS typecheck/lint 及 `22 files / 214 tests`通过；PineTS strategy 子集 `11 files / 50 tests`通过。
- [ ] 重跑 PineTS 全仓测试；当前 `api.binance.com` connect timeout 只是明确的外部环境阻塞，不计 PASS。应使用可联网环境重跑，或将必须的上游联网 fixture 改为可审计的本地固定数据后重跑，不得简单跳过。
- [x] 已执行 fresh `npm run build` 与 `npm run check:dependencies`；产物中 PineTS/Vela-PineTS、内联 Worker、in-process 与机器可读 metadata 已对账 `quant-tools-g4b.2` / `reportSchemaVersion=2` / 预期 SHA 和 sentinel。
- [x] `npm run test:e2e` 与 `npm run test:e2e:prod` 已通过；除旧工具栏/指标/脚本/模板/截图组合 smoke 外，真实浏览器 Performance 曲线来源已确认为 `exact-equity`，而非 `realized-ledger` fallback。
- [x] E2E 保持 `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer 非 workspace Storage 变更为 0，当前 dev lifecycle mounts/destroys/no-op destroys 为 `7/7/1`。更细的 listener/Worker/Observer/Highcharts/DOM 长时内存计数仍属项目 Final Gate。
- [x] `npm run test:providers` 已通过；Binance/Hyperliquid 均为 `historyBars=5/live=true`，G4b.2 没有引入可见 Provider 回归。
- [ ] 用固定 BTCUSDT/1h candles 对比 G4a/registry 与 G4b.2，逐笔 Entry、Exit、Size、Price、P&L 必须相同，只允许新增可观测报告字段。
- [ ] 完成视觉差分、键盘/a11y、性能、HMR/destroy/remount 与故障注入；任何未解释的 DOM、事件、请求、Storage、Provider 或生命周期差异都阻止合并。

#### G4b.3 历史增量验证账本

- [x] `npm run test:regression:existing` 为 `18/18`；根 `npm test` 为 `191/191`；adapter/controller/domain 定向集通过。
- [x] Vela-PineTS 全量为 `26 files / 228 tests`；G4b.3 字段桥接定向集通过；Vela-PineTS typecheck/lint 与根 `npx tsc --noEmit` 通过。
- [x] Pine strategy 子集为 `15 files / 67 tests`（含 `marketData/aggregation.test.ts` 的 strategy+aggregation 批次为 `16 files / 103 tests`）；该结果不等于 PineTS 全仓联网套件通过。
- [x] `npm run check:dependencies` 通过；该阶段 fingerprint 对账 PineTS/Vela-PineTS `quant-tools-g4b.3`、`reportSchemaVersion=3`，series envelope 独立保持 `schemaVersion=1`。
- [x] 在 G4b.3 revision 上执行 fresh `npm run build` 并通过；G4b.2 构建尺寸继续作为历史记录，不冒充当前尺寸证据。
- [x] 在 G4b.3 revision 上重跑 `npm run test:e2e`、`npm run test:e2e:prod` 与 `npm run test:providers` 并通过。
- [ ] 重跑 PineTS 全仓联网套件；尚未执行不等同于沿用此前外网 timeout，也不计 PASS。
- [x] 用固定 BTCUSDT/1h candles 对比 G4a/registry 与 G4b.3，确认新增桥接字段未改变 Entry、Exit、Size、Price、P&L 或成交语义；`test:fixture:btcusdt` 已完成 2/2 对账。

#### G8.1 当前验证账本（2026-09-27）

- [x] 当前 Fork 身份升级为 `quant-tools-g8.1` / `reportSchemaVersion=4`；`reportSeries/reportTail` wire envelope 独立保持 `schemaVersion=1`，依赖 contract 与 Worker sentinel 对账通过。
- [x] PineTS strategy 定向集 `21 files / 121 tests`；覆盖低周期四点回放、gap/duplicate/partial/overlap/out-of-range fallback、stop-limit、margin、trailing、delayed exit、declaration reuse、provider bare-minute alias 和未对齐聚合起点拒绝。
- [x] Vela-PineTS 全量 `27 files / 261 tests`；runtime request resolution、inclusive closeTime、session-scoped Worker fetchSeries、生命周期竞态和 in-process/Worker precision parity 通过。
- [x] Provider network/history 离线 contract 各 `8/8`；覆盖 Binance mirror/timeout、Hyperliquid timeout/retry、range/point retry、OHLCV 归一和 icon resolver 边界。
- [x] 根 `npm run test:regression:existing` `22/22`、`npm test` `219/219`、固定 BTCUSDT fixture `2/2`、fresh `npm run build`、`npm run check:dependencies` 和独立产物扫描通过。
- [x] 固定 Chromium 性能 gate 通过：10k/100k DOM 各 200 行、曲线 raw→render `10,000/100,000→2,000`、分页 p95 `38.4/40.6ms`、Dock FPS `59.87/59.91`、long-task p95 `0ms`、Simulation 10k `129ms`；artifact 为带 `QUANT_PERF_ARTIFACT=1` 生成的 `artifacts/backtest-performance-latest.json`。
- [x] `npm run test:visual:a11y` 四 viewport geometry/PNG/键盘/ARIA 通过；Performance 活动态对比度 `3.692:1` 作为已知提示保留。
- [ ] `npm --workspace packages/pinets run test -- --run` 全仓联网套件仍受 `api.binance.com`/`fapi.binance.com` ConnectTimeout 外部阻塞；不得把该阻塞或定向 strategy 结果冒充全仓 PASS。
- [ ] 完整 TradingView 逐 Fill/复合订单语义、父子 fixture 与参考逐笔对账、跨浏览器/生产生命周期及最终视觉/a11y/rollback Gate 仍待。

#### G6 Trades Log 列表增量验证账本

- [x] 列表默认按 Trade # 降序；所有可见列可排序，新列首次点击为降序，重复点击切换升/降序；fallback Trade # 与源顺序稳定绑定。
- [x] Size 和 MFE/MAE 按参考数据条件显示；Size 使用绝对值，MAE 只在显示时转为 `-abs`、排序保持 raw 值。
- [x] Trade # 由 `Summary 非零已平仓人口 - exit rank` 生成，不暴露或复用 PineTS 内部 ID；方向 badge、UTC/browser-locale Entry/Exit、`en-US` 分层价格精度、Trades Log 专用自适应数值格式、账户币种、MFE/MAE tooltip（含 focus/读屏标签）、中性 excursion/cumulative 颜色和 Crosshair hover/focus 入口已按当前 chunk 证据接通。
- [x] open exit 只在 presentation 层显示 epoch/`N/A CUR`，不提供 Exit locator；领域、Calendar、duration、closed population 和 Simulation 继续保持 `null/open` 语义。
- [x] 根全量 `219/219`、原有回归 `22/22`、Pine strategy `21 files / 121 tests`、Vela-PineTS `27 files / 261 tests`、TypeScript、dependency contract、完整 fresh build、dev/prod E2E 与 Provider smoke 全部通过。
- [x] dev/prod E2E 保持 `blockedExternalRequests=0`、`luxalgoRequests=0` 和 Viewer storage mutation=`0`；本轮开发 lifecycle 为 `7/7/1`。
- [x] Calendar 已按当前线上 chunk 和动态 DOM 拆分为纯聚合与独立渲染模块：浏览器当前月初始化/跳转、前后月、完整日期格、逐 Exit 日 P&L/交易数/整数胜率、空月、Best/Worst、按活跃交易日计算 Avg Trades per Day、报告时区分桶和 open/epoch/unknown-P&L 排除均已接通；日期桶与 formatter 统一复用，月导航复用当次报告聚合缓存，同一 run 的 live revision 保留用户所选月份与焦点，新 `runId` 回到当前月，真正替换 ledger 时缓存失效。
- [x] Calendar 增量回归已通过：当前根全量 `219/219`、原有回归 `22/22`、TypeScript、dependency contract、fresh production build、Provider smoke、开发/生产 E2E；E2E 已固定当月时钟并覆盖 `1025/1024/901/900/768/767/700/641/640px` 响应式边界，外部请求、LuxAlgo 请求和 Viewer Storage mutation 守卫继续为零。
- [x] Trades Analysis 增量回归已通过：独立 selector/View、10+9 行表、三个本地 Highcharts、
  histogram 精确轴/区间/三条 aggregate 参考线、donut、单 scatter+OLS、open-only 与真实
  breakeven 空态边界均有单测/合同/E2E；根全量、原有回归、TypeScript、dependency contract、
  fresh build、Provider smoke 与 dev/prod E2E 全部通过，参考域名/未声明外部请求和 Viewer
  Storage mutation 继续为零。完整 golden、受控极端样本浏览器矩阵和键盘图表行为仍归 G9。
- [ ] 完成参考站逐笔数值/最终截图差分、虚拟列表与大数据性能、精确 marker 高亮和 reversal/partial-close/pyramiding fixture；本地 BTCUSDT registry 对账已通过，这些剩余项继续阻止 G6/Final Gate 整体完成。

#### 当前批次执行记录（2026-09-27）

以下是当前工作树上回测工作区增量的最新代码级证据，不能覆盖尚未完成的视觉、性能、参考站逐笔对账、全量生命周期和故障注入 Gate（本地 BTCUSDT/registry 对账已通过）：

- [x] `npm run test:regression:existing`：`22/22`。
- [x] `npm test`：`219/219`。
- [x] `npx tsc --noEmit --pretty false`、`npm run build`、`npm run check:dependencies`：通过。
- [x] `npm run test:e2e`：通过；本轮开发审计为 `blockedExternalRequests=0`、`luxalgoRequests=0`、`marketRequests=157`，Viewer Storage 的 `writes/removes/clears` 均为 `0`，生命周期 `mounts/destroys/noopDestroys=7/7/1`。
- [x] `npm run test:e2e:prod`：通过；生产审计为 `blockedExternalRequests=0`、`luxalgoRequests=0`、`marketRequests=66`，Viewer Storage 的 `writes/removes/clears` 均为 `0`。该模式输出的 `lifecycle=null` 表示 production build 未暴露开发态生命周期 debug instrumentation，不能据此宣称生产生命周期已经验证；相关 destroy/remount/HMR 资源计数仍属于未完成 Gate。
- [x] `npm run test:providers`：Binance/Hyperliquid 均为 `historyBars=5`、`live=true`。
- [x] `npm run test:fixture:btcusdt`：离线固定 Binance `BTCUSDT · 1h` fixture 2/2；24 根 OHLCV（canonical fixture SHA256 `29b1d15777827e46b47a7386aa368f0389252b16565f58b3b19805c363e39cd1`），连续本地 PineEngine 运行逐笔 Entry/Exit/Size/P&L、账户 summary 和 reportSeries 稳定（report SHA256 `5fb737328cc2efe83c5e4c9f2a036c4beb40e0f5a18f29e9658be15068c5aeae`），并与一次性离线保存的 `pinets@0.9.34` registry baseline 深比较；Vela-PineTS package 全包为 23 files/216 tests，typecheck/lint 通过。
- [x] `tests/fixtures/backtest-btcusdt.html` 应用层浏览器 fixture：dev E2E 在浏览器内执行本地 PineEngine 的 24 根 BTCUSDT/1h K 线，经 BacktestController/Workbench 验证 Header、Dock、Performance exact-equity、Analysis 10+9 行/三图、Trades Log 3 笔和 Simulation；fixture 页面自身 `blockedExternalRequests=0`、`luxalgoRequests=0`、Storage `0/0/0`，销毁后 host 清空。production preview 不加载该测试页，避免把 workspace source/test asset 误当生产依赖。
- [x] G8.1 当前 Fork 复核补充：`npm --workspace packages/pinets run test -- --run tests/namespaces/strategy` 为 `21 files / 121 tests`，`npm --workspace packages/vela-pinets run test -- --run` 为 `27 files / 261 tests`；Provider network/history 离线 contract 各 `8/8`；G4b.3 的 15/67 仅保留为历史 fixture 记录，不作为当前计数。
- [x] 浏览器手动回归 Performance ↔ Trades Analysis ↔ Performance：无重复图表/空图；关闭 Viewer 后回到空态且无控制台错误；当前可见 Summary/Daily/Weekday Highcharts 各 1 个，隐藏 Dock 图表为 0×0，属于预期隐藏态。
- [x] Viewer Header 的实时精确序列日期范围、Dock/Viewer 共用 UTC 格式、缺失 provider 不展示 `unknown`、大序列范围线性扫描已有定向测试/审查证据；Viewer contract 当前为 `22/22`。
- [x] 本轮验证曾出现两类 runner 编排问题并已保留解释：并行启动 dev E2E/Provider smoke 会争用 Vite 启动资源并超时，规范 Gate 已改回串行；Trades Log 排序期间 live revision 替换表头，使 E2E 用旧 header 文本决定稍后的可选 MFE 断言，现已改为对当前 `thead` 做单次原子 DOM 快照后断言，串行复验通过。这两类失败均不折算为首次 PASS。
- [x] `BACKTEST_PARITY_MATRIX.md` 已建立（0.1 审计草案）；逐项标记 PASS/PARTIAL/BLOCKED/NOT STARTED，未以局部绿灯冒充最终完成。
- [x] E2E 冷启动流程已收敛：`tests/e2e_app.py --preview` 在启动 Vite 前检查 `dist/index.html` 与源码/最新 commit 时间；缺失或过期时自动执行 `npm run build`，避免直接调用复用旧 dist。`python3 tests/e2e_app.py --preview` 已在未预先手工构建的路径通过，且新增静态合同测试；dev runner 保留 90 秒可配置启动窗口。
- [ ] Performance 小于 1 的货币精度仍待冻结：静态参考样本的 Short `Average P&L per Day` 显示 `-0.9705556 USD`，当前统一两位小数会显示 `-0.97 USD`；在取得各指标统一精度规则前不凭单一样本扩散格式改动。Daily/Weekly 平均值当前按有交易桶计算，是否包含无交易自然日/周仍需受控样本确认。
- [ ] PineTS 全仓联网套件、完整视觉/a11y/性能、destroy/remount/HMR 长时资源计数和故障注入仍未完成；固定 BTCUSDT/1h 的离线 registry/本地逐笔对账及 dev 应用层浏览器四页闭环已通过，production preview 继续使用正式应用 smoke（测试页不作为生产运行时资产），最终截图/数值 golden 仍待 G9。

## 12. 分阶段实施 Gate

### 12.0 每阶段共用 Gate Checklist 与证据模板

除非某项明确标为“不适用”，G0–G8 每次退出评审都按以下固定顺序执行并留档：

```text
1. git rev-parse HEAD && git status --short
2. node --version && npm --version
3. npm run test:regression:existing       # 必须先跑，当前原有 21 项回归（历史阶段曾为 18）
4. npm test                               # 再跑，含回测新增测试
5. 本阶段定向测试/浏览器 smoke
6. npx tsc --noEmit --pretty false
7. npm run check:dependencies
8. npm run build
9. 受影响的 E2E / Provider / Storage / lifecycle / visual / a11y / performance
```

每条证据记录使用以下字段：`gate`、`commit`、`status`、`startedAt`、`finishedAt`、`environment`、`commands`、`baseline`、`artifacts`、`diff`、`blockers`、`reviewer`。若阶段涉及 Fork，则另外执行 `npm run build:forks` 和 `npm run test:forks`；`packages/pinets` 当前没有独立 `typecheck` 或 `lint` script，不能记录不存在的命令为通过（其 `build:prod:all` 会执行 declaration emit，可另行使用 `npx tsc --noEmit -p packages/pinets/tsconfig.json`，若该 tsconfig 不适用则记录实际可复现的项目级类型检查）；`packages/vela-pinets` 才执行其现有 `npm run typecheck` 与 `npm run lint`。

阶段证据必须把“原有回归先跑、新增测试后跑”写入命令时间序列；仅在表格中把两行列出来、但没有时间/commit/输出，不能证明顺序。任何命令失败、外部网络阻塞、启动 workaround 或人工跳过都必须写入 `status` 和 `blockers`，不可折算成 PASS。

以下G0～G9保留最初阶段分解及当时勾选状态，属于历史实施清单，不是当前剩余任务队列。旧`[ ]`不得单独触发重新实施或推翻后续直接证据；执行前须映射到[当前需求状态表](BACKTEST_REQUIREMENTS_STATUS.md)的具体条目和现行范围。例如固定BTCUSDT/15m/SMA对账、有限撮合、Dock/Settings组件及本地HMR/生产长测已有各自证据，不能因旧阶段未勾选而重新列未完成。现有证据只覆盖其源码时点和场景，后续改动仍按BUILD-01回归；手机、Safari、Replay及线上部署/rollback依对应SCOPE暂缓，未执行项不伪记通过。

### G0：冻结动态、静态和公式对标合同

任务：

- [x] 固定本地数值基线为 Binance BTCUSDT / 1h、24 根 OHLCV、受控 Pine 策略、参数、UTC/en-US 及 canonical fixture/strategy hash；参考站视觉基线仍待最终截图冻结。
- [ ] 将视觉/交互基线与数值/引擎基线完全分开；本地 registry/engine 数值基线已建立，双方参考站可运行策略的逐笔对账仍待完成。
- [ ] 保存四个 Tab、Dock、Settings、List、Calendar、Simulation 的基准截图和结构化结果。
- [ ] 补测多 Strategy、多 Cell、0 trade、open-only、compile/runtime error、行情失败和重算失败。
- [ ] 按当前需求表核对桌面 Dock 高度持久化、Reset defaults、Viewer scroll 恢复；mobile 打开/返回按 SCOPE-07 暂缓，不计入本阶段退出条件。
- [ ] 黑盒确认 P&L variation、Preserve win/loss 和风险指标公式。
- [ ] 用 benchmark 非空样本确认 Strategy Outperformance 的参考可见单位；本项目引擎合同暂按账户币种金额 `netprofit - buy_and_hold_pnl`，禁止与百分比差值混用。
- [ ] 冻结未平仓兼容行的 Trade #、epoch/`N/A` 显示规则，同时确认其不进入 closed/Calendar/Simulation 人口。
- [ ] 冻结 Viewer symbol 显示规则；不盲目复制一次样本中的 BTCUSD/BTCUSDT 差异。
- [x] 建立字段级、状态级、网络级和视觉级 `BACKTEST_PARITY_MATRIX.md` 审计草案；完整截图差分仍未通过。
- [x] 建立并持续追加 `BACKTEST_REGRESSION_BASELINE.md`：命令结果、关键 DOM/请求/Storage/lifecycle 证据和已知 bundle/性能基线已记录；全量截图、资源计数仍待补。
- [x] 为现有工具栏、指标管理/收藏、Pine 编辑器、个人脚本、模板、布局恢复、截图和 Provider 建立最小可重复 smoke 流程，作为每个 Gate 的必跑回归集。
- [x] 固定原有回归集命令 `npm run test:regression:existing`，当前批次先跑 `22/22` 再跑根全量 `219/219`。

退出条件：每个页面字段都有参考证据、人口、公式、单位、时区、来源和空值规则；不存在“开发时再猜”；既有功能基线可在干净浏览器中重复执行。

### G1：领域合同、fixtures 和纯函数

任务：

- [ ] 新建 BacktestKey、Report、Metric、Capabilities、Context、Trade/Order/Fill 模型。
- [ ] 实现 formatter、population selector 和全部指标纯函数。
- [x] 建立固定 Binance BTCUSDT/1h OHLCV、策略、账本和 simulation seed fixtures；fixture canonical/strategy/report hash 已锁定，应用层 dev fixture 复用同一数据。
- [ ] 为 observed 13/14 人口差异建立显式兼容 fixture。
- [ ] 为不可用数据建立 `—` 与原因合同。

退出条件：公式和格式单测全通过；UI 不需要导入 Vela 类型即可渲染完整 fixture；现有单测、构建和基线 smoke 全通过。

### G2：Vela 结果/控制/导航适配器

任务：

- [ ] 实现 bootstrap、完整事件表和销毁。
- [ ] 实现 revision、single-flight ledger、stale discard 和 epoch cancellation。
- [ ] 实现 active cell、多策略选择和 market 隔离。
- [ ] 实现 Inputs/Properties draft 与批量提交。
- [ ] 用 Vela 公开 API 实现当前可达的 chart navigation Adapter，不读取私有字段或 DOM 坐标。
- [ ] 完成精确 bar focus、crosshair、marker highlight 和不可变 run selector 的能力 Spike，形成 `docs/forks/VELA_FORK_DECISION.md`。
- [ ] 处理 partial history、aborted、forming 和 last-good。

退出条件：多 Cell、多策略、连续参数变化、隐藏、删除、源码改为 indicator、市场切换均不串数据；destroy/remount 无重复监听；Vela 是否 Fork 已有证据化结论，Adapter 不依赖私有实现；现有工具栏、指标管理和编辑器 smoke 与基线一致。

### G3：Dock / Viewer 壳和响应式交互

任务：

- [ ] 改造 App Shell，增加应用层 Dock 和 Viewer。
- [ ] 实现拖拽、折叠、键盘 resize、reflow 和 z-index 协调。
- [ ] 实现 Header、Tab、返回图表、focus management 和 scroll container。
- [ ] 验证桌面和紧凑窗口布局；手机布局、safe-area 及手机触摸专项按 SCOPE-07 暂缓。
- [ ] 加入 Settings、Favorite、Strategy badge 和 Show backtest 联动。

退出条件：壳层组件风格符合 §10、本地可用区域布局合理；本期桌面键盘、鼠标及窗口缩放交互通过；现有工具栏、指标管理、收藏、编辑器、模板和布局恢复无回归；回测壳失败时 Workspace 仍可启动。手机子项暂缓不算通过，也不阻塞当前退出。

### G4a：本地源码依赖零行为变更接入

任务：

- [x] 将根依赖的浮动范围先锁定为官方精确 `0.7.7 / 0.2.13 / 0.9.34`，保存 registry 行为基线。
- [x] 核对 npm 发布物与官方 tag/SHA/exports/fixture 的来源一致性。
- [x] 通过 subtree 导入 `pinets`、`vela-pinets` 完整源码；仅当 G2 决策要求时导入 Vela 完整源码。
- [x] 建立 npm workspaces、`file:` 依赖、本地版本号和 `docs/forks/*.md`。
- [x] 建立 `build:forks`、`test:forks`、predev/prebuild 和依赖构建顺序。
- [x] 更新 `tests/architecture.test.mjs` 中硬编码的 `^` 版本断言，使其验证实际 `file:`/精确 Vela 决策、基线 SHA 和单实例解析。
- [x] 加入机器可读 build fingerprint、Worker embedded PineTS SHA 和 sentinel 契约；fresh build、in-process/Worker 一致性及旧 Worker/PreparedScript 反向失败测试已通过。
- [x] 在当前功能补丁验收中，用固定 BTCUSDT fixture 对本地 PineEngine 与一次性离线保存的 `pinets@0.9.34` registry baseline 做逐笔交易、汇总和 reportSeries 对账；后续复杂成交/错误样本仍需扩展。

退出条件：至少两个必需包解析到本地 workspace；Vela 按决策记录解析到精确 registry 版本或本地 workspace；fresh clone 可从源码构建；零改动本地包未改变任何回测行为；依赖迁移与后续能力改造可分别回滚。

### G4b：引擎桥接与不可变结果模型

任务：

- [x] 对 Vela-PineTS 扩展公开回测结果映射、Worker 消息、显式 `reportSeries/reportTail` selector 和 run identity 验证。
- [ ] 仅在决策要求时对 Vela 做公共回测契约、runId selector 和精确定位所需的最小改动。
- [ ] 输出其余完整风险指标。
- [x] 接通账户币种与 All/Long/Short 最大持仓，并传入领域账户和 UI report 数据合同。
- [x] 接通逐笔 Entry/Exit bar index，并将 exact capability 绑定到 ready/current-revision ledger 与完整边界校验。
- [x] 增加曲线的 `runId/snapshotRevision`、应用层 `snapshotToken`、forming-tail 原子替换和 stale full-response 拒绝。
- [ ] 将交易账本与曲线纳入同一可按 run identity 拉取的原子报告包。
- [x] 增加逐 K equity/close-underwater/cumulative intrabar max-drawdown/benchmark series，benchmark 从首次真实 fill 锚定。
- [ ] 增加 raw orders/fills、精确 reversal relation 和执行覆盖范围。
- [x] 对齐 in-process 与 Worker 的曲线字段、身份和按需拷贝语义。
- [x] 只在完整曲线通过 identity/point-count/单调性校验后开启 exact equity/drawdown/benchmark capability，并补全正反契约测试。
- [x] 将 PineTS 与 Vela-PineTS 历史身份记录为 `quant-tools-g4b.3` / `reportSchemaVersion=3`，保留 series envelope `schemaVersion=1` 的独立版本语义；G4b.2/schema 2 保留为历史验证身份；当前 G8.1 身份为 `quant-tools-g8.1` / `reportSchemaVersion=4`。
- [x] 当前 G4b.3 fixture 验证限定为结果可观测性改造；与 G4a/registry baseline 的 Entry、Exit、Size、Price、P&L 对账未发现撮合语义变化，复杂撮合变化继续延后到 G8。

G4b.2 历史实证：原有回归 `18/18`、根全量 `103/103`、G4b adapter/controller/domain 定向 `61/61`、PineTS strategy 子集 `11 files / 50 tests`、Vela-PineTS `22 files / 214 tests`，以及根 TypeScript、Vela-PineTS typecheck/lint 通过。fresh `npm run build` 和 dependency contract 已对账 `quant-tools-g4b.2` / `reportSchemaVersion=2`；dev/prod E2E 均通过，真实浏览器 Performance 曲线来源为 `exact-equity`，`blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer Storage 变更为 0，dev lifecycle mounts/destroys/no-op destroys 为 `6/6/1`；Binance/Hyperliquid Provider smoke 均为 `historyBars=5/live=true`。Adapter 同时新增 run-restart、同步 pending、full+tail 三项竞态回归。PineTS 全仓测试仍被 `api.binance.com` connect timeout 阻断，只能记为“策略子集通过、外部联网套件未全绿”，不得写成全仓 PASS。

G4b.3 历史增量实证：原有回归 `18/18`、根全量 `191/191`、adapter/controller/domain 定向测试、Vela-PineTS 全量（当时 batch `26 files / 227 tests`）、固定 fixture 定向 `2/2`、Pine strategy 子集 `15 files / 67 tests`（含 `marketData/aggregation.test.ts` 的 strategy+aggregation 批次为 `16 files / 103 tests`），以及根 TypeScript、Vela-PineTS typecheck/lint、dependency contract、fresh build、dev/prod E2E 和 Provider smoke 通过；当时身份为 `quant-tools-g4b.3` / `reportSchemaVersion=3`。固定 BTCUSDT/1h 本地/registry 逐笔与应用层 dev fixture 已通过，PineTS 全仓联网套件、reference/local 数值差异、完整视觉/a11y/性能和项目 Final Gate 仍不能写成 PASS。

退出条件：Performance 和 Trades 所需结果均来自同一不可变 run identity；除高精度撮合外，四个页面不再因桥接缺失而降级；交易结果与 G4a 基线完全相同；Report、Worker、in-process 和文档中的 build fingerprint 一致；本阶段的完整非回归 Gate 全部通过。

### G5：Performance 完整闭环

任务：

- [x] 实现 Dock 五个 KPI 和主曲线；固定 BTCUSDT fixture 已通过应用层浏览器 smoke。
- [x] 以精确 `13.0.0` 引入 Highcharts，生成可按需加载的本地 chunk，不请求 CDN。
- [x] 实现 Performance 三组图表和 All/Long/Short 表；缺失 benchmark 的格式合同已冻结。
- [x] 接入 Highcharts tooltip、legend、resize、empty 和 a11y 描述；保留 SVG fallback 与本地 chunk。
- [x] 接入同一 runId 的 authoritative equity、drawdown、benchmark 和风险指标。
- [x] 验证 Summary 与 Performance 各自人口和 mark-to-market 规则；逐字段 reference 数值/截图最终对账仍归 G9。

退出条件：Performance 所有参考字段、图表、tooltip、数值和状态均通过固定基准 fixture 与
reference/candidate 视觉差分；无近似正式指标。当前实现与本地 fixture gate 已通过，但参考
非空 benchmark 数值、完整 tooltip/golden 和跨 viewport 差分仍保持 PARTIAL。

### G6：Trades Analysis、Trades Log 与图表联动

任务：

- [x] 以独立纯 selector 实现 Analysis 的 10 行主表、9 行 duration 表、精确 histogram、
  donut、scatter/OLS trend，以及 open→breakeven 的 presentation-only 兼容人口；不得复用
  Summary 的 epsilon/人口或在 Viewer 内私算。
- [x] 为 Analysis 使用专用强类型领域 DTO 与专用 View，移除旧三卡片和硬编码 USD；扩展
  Highcharts 时保留现有 line/column 行为、异步 generation guard、destroy、ResizeObserver、
  SVG fallback、a11y 与本地 chunk/零 CDN 合同。
- [x] 覆盖严格正/负/零、真正 breakeven+open、全赢/全亏、缺 duration/exit、同值 histogram、
  UTC 日/周、Sunday week、方向人口、streak bars、回归线和零交易空态；固定样本逐字段反算。
- [ ] 将 UI transport 中仍为可选字段集合的 `BacktestAnalysis/BacktestPoint` 进一步收紧为专用
  readonly Analysis DTO；当前领域 selector 与 View 已强类型隔离，此项是后续维护性收敛，不改变
  已冻结的页面行为。
- [x] 实现 Log 列表、稳定排序和 200 行分页（超过页大小不一次插入上万 DOM）；CSV 仅在 G0 复测确认参考站入口后按决策纳入，不凭空增加导出入口。
- [x] 完成 Log 当前可见列、条件列、全列排序、Trade #/方向 badge、Entry/Exit 双行内容、MFE/MAE 与 Crosshair 入口的证据约束对标；分页排序缓存、边界页、caption 与键盘焦点已补，固定 Chromium 10k/100k DOM/交互 trace 已归档（`tests/backtest_performance.py`），参考站视觉差分和跨浏览器仍归 G9。
- [x] 实现 Calendar 当前月/前后月导航、每日/月度聚合、活跃日均值、空月、Best/Worst、时区和 open 排除合同；最终跨 viewport 视觉 Gate 仍归 G9。
- [ ] 按 G2 决策通过应用 Adapter 或最小 Vela Fork 实现 Entry/Exit 精确 bar 定位和 marker 高亮。
- [x] reversal、partial close、pyramiding 和关联审计事件已有实现及独立预期；同价格段跨订单次序单列 ENGINE-03，不能据此称全部排列已验。

退出条件：逐笔字段、累计值、日历值和图表 marker 与固定参考逐行一致；定位结果在预定像素/bar 范围内。

### G7：Simulation 完整闭环

任务：

- [x] 实现 Resample、Shuffle、Laplace variation、preserve win/loss，并保持 trade 与 MAE 成对抽样/重排。
- [x] 实现 MAE-aware drawdown、风险指标、threshold、USD/%、Histogram/Cumulative、路径分位带、Streaks & Recovery 和固定上限的 band points。
- [x] 以参考固定 seed `12648430` 实现 deterministic 结果；默认 1,000 runs 同步计算，`>= 2,000` 使用本地模块 Worker，并具备进度、取消、supersede、错误回退、structured-clone 后深层冻结和按人口隔离的有界 LRU 缓存。
- [x] 实现参考可见的 KPI、路径图、Outcome/Drawdown 分布、说明文案、tooltip、无已平仓交易/初始资金无效空态、错误与 Retry；Highcharts 只从本地 chunk 加载并保留同步 SVG fallback。
- [x] 实现桌面设置 Modal、移动 Drawer、键盘焦点陷阱、重绘后焦点恢复、modal 背景隔离和断点切换后的可见焦点回退。
- [x] 建立 Simulation 操作副作用守卫：Tab、图表投影和设置变化不得触发 Pine 重跑、Provider 重订阅、WebSocket 或 Storage 写入；失败/pending 保留上一份成功结果。

本阶段只修改 Quant Tools 应用层、应用 Worker、展示层和测试，没有修改 `packages/pinets` 或 `packages/vela-pinets`；Simulation 是 settled ledger 的本地投影，不改变策略撮合语义。

退出条件：固定 seed 下 percentile、概率、曲线点、直方图 bucket 和表格在冻结 fixture 中逐值一致；1k/10k 性能与内存有界；Worker 取消/乱序/失败、空态、桌面交互和焦点合同通过；手机交互和 Drawer 专项按 SCOPE-07 暂缓，已有实现与验证保留。Simulation 操作不触发策略重跑、Provider 重订阅、WebSocket 或 Storage 写入。G7 的应用层闭环完成不代表项目 Final Gate 完成，参考站最终数值/组件对照及本项目布局适配按 §10、跨功能长时性能按 G9 验收。

### G8：高精度撮合补齐

任务：

- 每次 Bar Magnifier/撮合增量都必须先执行 §12.0 固定顺序和 §13.8 现有功能非回归集；
  任一工具栏、指标、编辑器、模板、Provider、Storage 或生命周期差异未解释时，
  即使引擎定向测试全绿也不得合并。
- [x] 在 `packages/pinets` 完成 Bar Magnifier 的默认四点路径和经过校验的低周期回放第一版；当前证据仅覆盖本地 Fork 的 provider-backed OHLCV。
- [x] 完成本期有限合同的限价、止损、止盈、移动止损、反转、部分平仓和保证金事件顺序：默认/高精度、风险/entry、跨订单及形成中回滚均有独立预期和双引擎证据；不把未穷举的排列写成全部语义已关闭。
- [x] 补齐显式 `strategy.oca.cancel` / `strategy.oca.reduce` 订单组：首个实际成交后分别取消
  兄弟挂单或按实际成交数量缩减兄弟数量；无 `oca_name` 时不推断隐式分组，并写入取消审计事件。
- [x] 修复 `cash_per_order` 在一次 close order 消费多个 FIFO lots 时的重复收费：按一次
  broker close order 计算固定手续费，再按实际关闭数量分摊到 closed-trade rows；其它
  commission 类型仍沿用数量线性语义。
- [x] 完成本期有限合同的 Pine 重算和成交配置语义，并纳入固定回归：收盘成交、生效顺序、`calc_on_order_fills`/`calc_on_every_tick` 边界、费用、风险及形成中回滚均已覆盖；超出本期有限合同的排列按 ENGINE-03 新反例处理。
- [x] 在策略 Properties 增加 Default/High precision 选择器，直接映射 Pine 的 mutable `use_bar_magnifier` 属性；Cancel/Reset 不提交，precision-only 的 Ok 通过既有 `setProps` 批量链路只触发一次 update，且 UI 不维护平行状态。
- [x] 展示 requested/applied precision、低周期、覆盖率和回退原因；不支持父周期会显式报告 `lower-timeframe-undetermined`，缺少 fallback reason 的未应用 envelope 被 Adapter 拒绝。
- 成对父/子 OHLC 的独立成交预期和双真实引擎验证按 ENGINE-03 验收；完整 TV 外部逐 Fill 按 SCOPE-05 不作为本期关闭条件。
- [x] 覆盖低周期缺失、重复、越界、仅部分覆盖、断档以及显式回退场景；仍在形成的 live 请求按不支持回退。
- [x] 重建 `packages/vela-pinets` 内联 Worker，并通过 parity 测试对齐 in-process 和 Worker 的 precision envelope/结果边界。

G8.1 当前 checkpoint 已通过上述本期有限合同的定向证据；其 `quant-tools-g8.1` / schema 4
身份、性能 artifact 和外部联网阻塞详见 §11.5/§11.6。该 checkpoint 仍是 PARTIAL：不可将
四点 OHLCV 回放描述为 TradingView 完整逐 Fill broker emulator；完整外部逐 Fill 对账按
SCOPE-05 不作为本期关闭条件。

退出条件：精度模式真实可验证；UI 不会仅因脚本参数存在就声称高精度已启用；固定样本下逐模拟点、逐 Fill、订单顺序和结果通过基准对账；in-process/Worker 的 fingerprint 与执行结果一致。

### G9：完整性、性能和独立运行验收

任务：

- [ ] 完成状态、错误、离线、超时、取消、重试和 stale 矩阵。
- [ ] 完成大数据、内存、拖拽、Tab 和 Simulation 性能测试。
- [ ] 完成 Chromium、WebKit 和支持范围内 Firefox 测试。
- [ ] 完成视觉回归、keyboard-only 和自动 a11y 测试。
- [ ] 在 fresh browser、dev、production preview、冷启动和刷新下验收。
- [ ] 主动阻断 LuxAlgo 域名并断言零请求。
- [ ] 验证构建产物无参考 HTML、Next chunk、远程字体或图标。
- [ ] 验证 Highcharts 精确锁定 `13.0.0`、从本地动态 chunk 加载且无 CDN 请求。
- [ ] 验证 `npm ls` 只有一份 Vela/Vela-PineTS/PineTS；两个必需包为本地 workspace，Vela 与 Fork 决策一致，lockfile 无重复或 invalid peer。
- [ ] 删除 Fork `dist` 和本地安装缓存后完成 fresh build，构建后 Git 工作区干净。
- [ ] 验证应用、Worker、in-process 报告的完整 build fingerprint 与 `docs/forks` 基线一致，并通过 sentinel 反向失败测试。
- [ ] 验证不存在未声明的`node_modules`手改、任意补丁或应用层深度源码导入。允许[已登记的Vela 0.7.7 viewport兼容补丁](../../forks/vela-viewport.md)：仅由构建锁下的脚本执行，校验精确版本及完整输入/输出SHA并纳入指纹；隔离安装须可复现，未知版本/内容必须拒绝。该例外不授权其它依赖手改。
- [ ] 按 12.0 的顺序运行 `npm run test:regression:existing` → `npm test` → `npx tsc --noEmit --pretty false` → `npm run check:dependencies` → `npm run build` → `npm run test:e2e` → `npm run test:e2e:prod` → `npm run test:providers`，确保零回归；若验证 Fork，追加 `npm run build:forks`、`npm run test:forks`，并执行 `npm --workspace packages/vela-pinets run typecheck`、`npm --workspace packages/vela-pinets run lint`。`packages/pinets` 没有 `typecheck`/`lint` script，必须使用其实际存在的 build/test 或显式 `tsc -p` 命令并在账本中写明，不得虚构脚本。
- [ ] 对照 `BACKTEST_REGRESSION_BASELINE.md` 重跑既有工具栏、指标、收藏、编辑器、脚本、模板、布局、截图和 Provider smoke；检查事件/请求/监听器/Worker/DOM 计数没有未解释增加。
- [ ] 注入回测 Adapter、报表、Simulation 和 Worker 的失败，确认图表、工具栏、指标、编辑器和模板功能仍可使用，且错误只显示在回测区域。
- [ ] 发布回滚演练（SCOPE-01：DEFERRED，不阻塞本阶段）：目标部署环境具备且恢复该任务后，记录上一份已验证的线上commit/制品hash、切回过程、CDN/browser cache恢复及回滚后的Storage/schema检查，重跑既有回归/E2E/Provider smoke并留档。当前本地kill switch已有下述证据；日常Workspace/脚本/收藏/模板兼容回归仍执行，不因线上演练暂缓而豁免。

当前本地kill switch的有限合同已通过；真实线上部署/rollback/CDN恢复因缺少目标环境按SCOPE-01暂缓，不进入本阶段阻塞队列，也不记为通过：
`npm run test:e2e:kill-switch` 使用 `VITE_ENABLE_BACKTESTING=false` 构建并在
production preview 中确认 backtest workbench 子树/动态 host 为 0、旧工具栏/Indicators/Pine
editor/Templates 仍可用，blocked/LuxAlgo 请求为 `0/0`，market mock 请求仍正常，且
`quant-tools:workspace:v2` 字节不变。该证据不等同于上一线上制品回滚；fresh clone独立安装/构建另按BASE-08/I-05保留其直接证据，不能将已完成的本地构建与暂缓的线上回滚混成一个未完成项。

E2E 的“冷启动”必须区分两种证据：当前 runner 的 `predev`/Fork 构建可能超过 20 秒等待窗口；在 runner 支持可配置等待或复用已启动服务前，预先启动 Vite 再运行浏览器回归只能标记为 workaround，不能冒充 `npm run test:e2e` 冷启动直接通过。生产 preview 仍必须在 `npm run build` 后独立启动并记录产物版本。

退出条件：第 14 节 Definition of Done 全部满足。

## 13. 测试矩阵

### 13.1 公式与领域单测

- 0 trade、open-only、1 win、1 loss、all win、all loss、all even。
- 手续费使毛盈利变净亏损。
- grossLoss=0、initialCapital=0、NaN、Infinity、-0。
- Long/Short、reversal、pyramiding、partial entry/exit。
- MFE/MAE、duration、streak、daily/weekly/weekday。
- timezone、DST、周末、缺失 bar、重复 bar。
- Summary/Analysis/Simulation 不同人口。
- 同一 fixture 明确断言 Dock/Summary 的 13 closed、61.54%，Analysis 的 14 rows、57.14%，Simulation 的 13 closed；差异必须来自命名 selector，不能由各页面私算。
- Simulation 固定 seed 和统计恒等式。

### 13.2 Adapter 契约测试

- `complete=false → true`。
- `history:complete(aborted)`。
- `run.trades()` reject、延迟、旧 revision 晚返回。
- 首次事件错过后的 bootstrap。
- 相同 indicatorId 在不同 Cell。
- strategy 更新为 indicator。
- updateCode 编译失败保留旧运行。
- visibility suspend/resume。
- cell create/destroy/restore。
- market load start/end/changed。
- app destroy 时仍有 Promise 在途。
- 未平仓 `exitTime=0`、epoch 和 `N/A` 在 Adapter 后均为 `null`，且不会进入 Calendar、closed 排序或 Simulation。

### 13.3 DOM 和交互测试

- Dock collapse/expand/resize/double reset。
- Viewer open/return/focus restore/Esc。
- Viewer 打开时后台 Vela/Dock/menu 为 inert 且不进入读屏树，关闭后完整恢复。
- Tab 键盘操作和 scroll position。
- Settings Cancel/Reset/Ok 请求计数。
- Favorite 在 Viewer、图例和指标列表之间同步。
- 表格排序、List/Calendar；CSV 仅在 G0 已确认参考入口时测试，未确认时应断言没有新增可见导出入口。
- Entry/Exit 定位。
- Simulation 控件、取消和重启。
- 唯一 ID、table semantics、aria state、live region。
- destroy 幂等和 HMR 重挂载。

### 13.4 E2E

- 固定 Binance BTCUSDT OHLCV + 固定策略的精确结果。
- strategy attach、inputs、properties、code、symbol、timeframe 重跑。
- 2 cells × 2 strategies 隔离。
- remove、hide/show、error、reload、workspace restore。
- dev 与 production preview。
- 请求计数：只有实际策略变化触发 run；Tab/排序/模拟不触发。
- 页面无未捕获异常、console error、HTTP 失败和 listener 泄漏。

### 13.5 Viewport 与视觉

- 按 §10.2 在本项目真实宿主布局下验收；记录各自有效工作区，不要求与参考站整页坐标重合。
- 1920×1080、1440×900、1280×800。
- 断点前后 1px。
- 当前桌面覆盖 1024 及紧凑窗口；390×844、360×640、mobile landscape 和手机 safe-area 暂缓。
- 当前桌面 DPR 1/2、200% zoom；手机 touch/hover:none 专项按 SCOPE-07 暂缓。
- Dock min/default/expanded。
- 四个 Tab、Settings、List、Calendar、Simulation。
- loading、partial、no-trades、open-only、error、positive、negative。
- 固定 clock、timezone、locale、font、DPR 和 seed。

### 13.6 性能预算测试

- 1k、10k、100k trades 聚合。
- 大账本有界分页、焦点与交易定位；当前采用每页最多 200 行，不额外要求虚拟滚动。
- 大曲线 downsample 与 tooltip。
- 1k/10k Simulation runs。
- 高频 tick 下不重复拉完整 ledger。
- Dock 拖拽和窗口 resize 无明显掉帧。
- 多次 open/close/remove 后内存回落、图表实例释放。

### 13.7 Fork 与可重复构建测试

- 官方 tag/SHA 与实际启用的本地目录基线一致；Vela 的目录/依赖形态与决策记录一致。
- registry 包与未修改本地源码包在固定 fixture 下逐笔、汇总和错误行为一致。
- `npm ls`、lockfile link 和 peer dependency 无重复或 invalid；现有架构测试不再硬编码旧的 `^` 范围。
- PineTS/Vela-PineTS 的 upstream SHA、local revision、bridge SHA、embedded PineTS SHA 和 schema version 能从 Worker 与 in-process 结果中读取并核对。
- Worker sentinel 正向通过，注入旧 Worker 的反向用例可靠失败。
- 删除所有 Fork `dist` 后能通过根构建重新生成。
- Fork build 不改写已跟踪源码或生成未提交文件。
- 上游同步模拟分支可以完整执行 build、typecheck、package tests 和 app contract tests。
- 应用打包不深度引用 `packages/**/src`，不依赖未版本化的 `node_modules` 手改；已批准的 Vela 安装补丁必须有版本/SHA 校验、可重现脚本和独立回归。
- Highcharts 在 lockfile 中精确为 `13.0.0`，运行时只加载本地 chunk。

### 13.8 现有功能非回归测试

- 运行基线中所有现有单元、构建、开发/生产 E2E 和 Provider/Storage 测试，并与 G0 结果逐项比较。
- 先运行原有回归集 `npm run test:regression:existing`，再运行包含回测测试的 `npm test`；两者均通过才算代码级非回归通过。
- 工具栏按钮逐个点击：动作只执行一次，原有面板、弹层、绘图和截图行为与基线一致。
- 指标管理/收藏：四类标签、On chart、添加/删除、星标同步、个人脚本 CRUD、搜索和恢复行为与基线一致。
- Pine 编辑器：打开、编辑、运行、保存、删除、错误显示和返回图表不受回测 Dock/Viewer 影响。
- 模板/布局/持久化：旧快照可恢复；既有 key/value、字段和写入次数不变；回测 key 独立且结果不落盘。
- Provider：Binance/Hyperliquid 请求 URL、参数、OHLCV 映射和实时订阅数量与基线一致。
- 生命周期：重复 create/destroy/HMR、删除 cell/indicator、Viewer open/close 后，事件监听、Worker、Observer、Highcharts 和 DOM 节点无泄漏或重复。
- 故障注入：结果解析异常、Simulation Worker 崩溃、图表定位失败、存储不可写和行情超时均只降级回测功能，不阻断既有 Workspace。
- 挂载故障隔离：故意让 Backtest host/Workbench/Adapter 构造或订阅抛错时，`createApp` 仍完成既有 Workspace 启动；半成品 host、监听和订阅全部清理。
- 多 Cell 选择隔离：后台 Cell 的 snapshot/error/remove/late promise 不得抢占当前活动 Cell 的 Dock；活动 Cell 最后一个策略移除后不跳到其它 Cell。
- 回测交互隔离：Tab/排序/Calendar/Simulation/Viewer/Dock 操作不会产生额外策略 run、Provider 重订阅或已有指标重建。

### 13.9 2026-09-28 继续实施增量（当前工作树）

本批次把此前仅写在 TODO/审计中的几个可落地缺口继续实现，并保留不能安全冒充完成的边界：

- Provider 历史边界：Binance/Hyperliquid 实例在 Quant integration 边界增加 range 校验、点范围
  重试、OHLCV 排序/去重/边界过滤和 limit 归一；不改上游原型或实时订阅。默认关闭可选远程
  symbol-icon CDN，图标缺失由本地 initials fallback 承担；显式 `remoteSymbolIcons: true`
  才恢复该依赖。
- Raw lifecycle bridge：PineTS/Vela-PineTS 新增显式 `auditLedger` extension。in-process 与
  Worker 共享 schema/validator，Adapter 按 run/revision/bar identity 严格验收后才动态开启
  `rawOrders/rawFills`，并将真实 kind、partial progress、parent/reversal relation 映射到 domain
  `Order`/`Fill`。上游未扩展 Vela 的基线 capability 仍为 false；缺失、stale、malformed 或越界
  envelope 显式降级，不从 marker/round-trip 猜测。
- 多 Cell 非回归：新增真实 BacktestController/Store/Workbench 2×2 浏览器 fixture，覆盖每个
  Cell 最新策略选择、后台 snapshot/error/迟到响应隔离、stale revision/epoch、同 Cell 删除回退、
  最后策略删除空 Dock，以及 destroy 后 Chart/Observer/DOM/Provider/Storage 不增长。
- 精度设置与 Dock 偏好仍直接绑定真实 Properties/独立版本化 UI key；没有新增平行状态或把回测
  结果写入旧 Workspace storage。

当前可复现证据：原有回归 `22/22`、根 `npm test` `219/219`、Provider network/history
离线 contract 各 `8/8`（合计 `16/16`）、raw adapter/domain/controller 定向 `63/63`、
Vela-PineTS 定向 `47/47`、`npx tsc --noEmit`、`npm run check:dependencies`、`npm run build`、
`npm run test:e2e:multicell` 和 multicell contract `1/1` 均通过。PineTS 全仓联网套件仍因外部
Binance connect timeout 受阻；TradingView 逐 Fill/复杂订单和参考站逐笔 Gate 继续保持 PARTIAL。
Safari 专项和线上 rollback 按 SCOPE-03/SCOPE-01 暂缓；VoiceOver、真实设备仍未验收。

### 13.10 2026-09-28 Trades Log 性能续跑

- [x] 单页 Trades Log 使用有界 HTML fragment 与单一 delegated listener，保留原有字段、ARIA、定位和
  开仓行语义；Provider/策略异常文本在插入前统一 escape。
- [x] 更新性能/Viewer 合同测试并通过根 `npm test` `238/238`、真实 Chromium 10k/100k、四 viewport
  visual/a11y、Chromium/Firefox/WebKit 和 production E2E。
- [ ] 该优化只改善本地单页 DOM 成本，不等同于参考站最终视觉/数值 parity；逐 Fill、复杂订单、参考
  截图和真实 rollback 仍按 G8/G9 开放项执行。

## 14. 最终 Definition of Done

只有以下项目全部满足，任务才算完成。

### 14.1 功能完备

- [ ] 自动触发、设置、Dock、Viewer、四 Tab、Simulation、图表定位全部实现。
- [ ] 所有参考字段和控制均有功能，不存在有入口无实现。
- [ ] 多 Cell、多策略、实时、深历史和全状态矩阵正确。
- [ ] 无近似值冒充正式指标，无 unsupported 显示为 0。
- [ ] Bar Magnifier 显示的 applied precision 与实际撮合一致。

### 14.2 UI、交互对标与布局适配

- [ ] 结构化交互 Parity Matrix 本期适用的桌面行/子项通过；暂缓、范围外和明确保留的本地正确性差异单列，不计作未实现。
- [ ] 桌面组件风格和交互符合 §10.2，本项目布局无非预期遮挡、裁切或不可达内容；手机子项按 SCOPE-07 暂缓。
- [ ] Tooltip、hover、focus、scroll、drag、calendar、chart animation 均对齐。
- [ ] 文案、单位、locale、符号、精度和颜色对齐。
- [ ] 不复制不可见的语义缺陷，桌面键盘与鼠标操作均可达；手机触摸等价能力按 SCOPE-07 暂缓。

### 14.3 数值与引擎一致性

- [ ] 固定 candles、脚本、参数下，逐笔 Entry/Exit/Size/P&L/MFE/MAE 对齐。
- [ ] Summary、Performance、Analysis、Simulation 各自人口和公式对齐。
- [ ] 展示值误差不超过最小显示单位的一半。
- [ ] 精确曲线点、订单和账本属于同一 runId。
- [ ] 固定 seed 下 Simulation 逐值可复现。

### 14.4 稳定性与独立性

- [ ] 所有单测、契约测试、E2E、视觉、a11y、性能测试通过。
- [ ] 现有工具栏、指标、编辑器、收藏、模板和 Provider 测试零回归。
- [ ] destroy/remount、HMR、刷新和 Workspace 恢复无重复监听或状态复活。
- [ ] Fresh checkout 可完成 install、build、preview 和确定性 E2E。
- [ ] 阻断参考站全部域名后功能仍可运行，构建和运行请求为零。
- [ ] 两个必需 Fork 以及任何被决策启用的 Vela Fork，其完整源码、基线 SHA、本地差异和测试记录均在仓库内。
- [ ] Fork 决策记录与实际目录、依赖、lockfile 和构建脚本一致；不存在无必要却长期 vendored 的 Vela。
- [ ] 应用和 Worker 对必需 Fork 只解析本地 workspace 版本，不存在同名 registry 重复包；Vela 的来源与决策记录一致。
- [ ] PineTS 修改后必经 Vela-PineTS Worker 重建，实际运行版本可验证。
- [ ] 每个 BacktestReport 携带完整 build fingerprint，Worker、in-process、构建文档和运行结果中的 SHA 一致。
- [ ] 构建不依赖修改后的 `node_modules`，Fresh clone 后无需人工补丁。

### 14.5 现有功能非回归

- [ ] `BACKTEST_REGRESSION_BASELINE.md` 中的所有既有测试、smoke、截图、Storage、Provider、事件和性能断言通过。
- [ ] 回测新增路径和故障路径均不会改变现有工具栏、指标管理/收藏、Pine 编辑器、脚本、模板、布局、截图、Provider 或持久化语义。
- [ ] 没有重复 listener、Worker、Observer、Chart/Highcharts 实例、策略 run、Provider 订阅、Toast、Storage 写入或 DOM 节点泄漏。
- [ ] 回测模块可被独立禁用/销毁；禁用或故障时原有 Workspace 仍能启动和正常使用。
- [ ] Backtest host/Workbench/Adapter 的同步挂载失败经过故障注入后，既有 Workspace 仍可启动，且无半成品 DOM/监听/订阅残留。
- [ ] 多 Cell 的后台结果、错误和迟到响应不会改变当前活动 Cell 的 Dock 选择；删除活动 Cell 最后策略后 Dock 进入空态而非切换到其它 Cell。
- [ ] 所有与基线的差异都有可审计原因、测试覆盖和明确的回测新增范围，未解释差异一律视为失败。

## 15. 完备性复核后已直接纳入的优化

本计划在初稿基础上经过动态交互、静态页面、架构/API、QA 四个角度复核，已补入以下容易遗漏但会影响最终质量的事项：

1. 初始化阶段通过 `handle.context()` 补采已经运行的恢复策略。
2. `cellId + indicatorId + revision + epoch` 防止跨 Cell 和过期账本覆盖。
3. `run.trades()` single-flight、合并刷新和 tick lazy load。
4. `history:complete(aborted)`、partial、forming 和 provisional 的真实状态。
5. 单一 BacktestReport 加页面 selector，兼容 13/14 交易人口差异。
6. 每项指标的 capability、provenance 和 unavailable reason。
7. Engine summary、trade-derived、逐 K mark-to-market 三种口径严格分离。
8. App Shell 级 Bottom Dock，而不是误用 Vela SidePanel 或私有 DOM。
9. 为精确 Entry/Exit 定位新增稳定 Chart Port，不调用 Vela 私有方法。
10. 多策略、多 Cell、源码从 strategy 变 indicator、失败 updateCode 等生命周期。
11. Simulation 的确定性 seed、Worker、取消和大数据性能。
12. 当前验收桌面响应式断点、紧凑窗口和 200% zoom；手机布局、safe-area、touch/hover:none 及手机实机专项按 SCOPE-07 暂缓。
13. Visual parity 与不可见 a11y 缺陷分离，保持外观一致但补齐语义。
14. Highcharts 生命周期、虚拟列表、downsample 和 bundle/performance gate。
15. 阻断参考域名的独立运行 E2E，而不是只靠代码审查判断独立性。
16. 明确页面、桥接、引擎、图表宿主和 Provider 的能力归属，避免用底层 Fork 解决应用层问题。
17. 统一为 PineTS、Vela-PineTS 两个必需 Fork，加经公开 API Spike 决定的 Vela 条件式 Fork。
18. Git subtree 与 npm workspaces 组合，保证一次 clone、可同步上游和本地源码解析。
19. 将 G4 拆成零行为变更的源码接入与结果能力改造，避免依赖迁移回归和引擎回归混在一起。
20. PineTS → Vela-PineTS Worker 的强制重建链、机器可读 fingerprint 和 sentinel，避免实际 Worker 仍运行旧引擎。
21. G4b 只增加结果可观测性；G8 第一版已接入校验后的低周期四点回放和显式 fallback，完整撮合语义仍留在 G8 后续 Gate，并使用父/低周期成对 fixture 验证。
22. 精确版本、根 lockfile、单实例解析、Highcharts 本地 chunk 和 fresh build Gate，禁止隐式漂移或 CDN 依赖；`44ade5c` 已在清缓存临时 clone 复核 install/build/test/clean，后续仍需断网发布与 rollback 演练。
23. Fork 基线 SHA、本地公共 API、补丁退场条件、测试与升级记录，确保未来同步上游可审计、可回滚。
24. 将视觉/交互对标与数值/引擎对账拆成两套基线，数据或策略不同时不误判撮合差异。
25. 在 Adapter 边界把未平仓 epoch/`N/A` sentinel 规范为 `null`，将兼容显示与统计语义解耦。
26. Viewer 覆盖图表时使用 inert/aria-hidden 隔离后台交互，同时保持 Vela 实例挂载。
27. 对 Dock、Analysis、Simulation 的 13/14 人口差异建立跨页面一致性断言，禁止页面私算。
28. 将“现有功能零非预期回归”提升为硬性目标：每个 Gate 先跑当前原有 21 项回归集，再跑新增测试，并对照 DOM、事件、请求、Storage、生命周期和故障注入证据；历史阶段的 18 项记录仅作历史基线，命令通过但证据缺失不得宣称完成。

经本轮复核后，计划已经覆盖从策略运行、数据一致性、四页功能、视觉交互、引擎补齐、本地 Fork 生命周期，到性能、错误恢复和独立运行的完整闭环。后续实施过程中若 G0 发现新的参考行为，只能先更新 Parity Matrix 和本计划对应合同，再进入代码实现，避免凭主观设计偏离一比一目标；若底层能力可由新版上游公开 API 满足，则优先收缩本地差异，而不是永久保留不必要的 Fork。

## 2026-09-28 原始 goal 续跑检查点

本轮继续处理实际运行中会造成“旧结果闪现、交易数不一致或重复成交”的边界，而不是只更新
计划状态：

- `history:progress` 保留 head ledger 仅作竞态/身份保护；公开 adapter 状态为 `partial`，
  Controller 通过 finality gate 屏蔽交易、账户标量、曲线和 Simulation。
- `history:complete` 会按 `needsHistoryRefresh` 去重；完整 head run 或恢复 context 会重新拉取
  context/ledger，刷新接受前公开为 `computing/unknown`；`aborted` 始终为 `partial-history`。
- `strategy.entry/order` 的未成交同 ID 请求现在替换旧 pending 物理订单并写入 cancelled/created
  lifecycle；同 bar 重复 market ID 会排除被替换订单，不再重复计入 reversal qty。
- Controller 的 `ledgerAvailable`、risk/benchmark/exact curve capability、Summary P&L 和
  `simulationEligible` 统一只接受 `historical-final` / `live-provisional`，第三方或迟到的
  `unknown`/`partial-history` projection 不能绕过门控。

本轮代码与验证证据：根测试 `244/244`、既有回归 `22/22`、adapter/controller/precision 定向
`75/75`、PineTS strategy `24 files / 129 tests`、Vela-PineTS `27 files / 277 tests`、根
TypeScript、fresh build、dependency/dist independence、Provider smoke、production E2E 及
Chromium/Firefox/WebKit 均通过。PineTS 全仓联网 suite 仍因 Binance 动态 fixture/网络超时存在
`19 failed / 1962 passed / 5 skipped`，按计划继续标记为外部/上游阻断，不将其折算为 PASS。

该增量关闭了本地状态泄漏和同 ID 重复成交的明确缺口，但不关闭参考站最终截图/逐笔对账、完整
TradingView broker parity、复杂复合订单、完整应用 HMR/故障注入、VoiceOver 和真实 rollback
等 Final Gate。

## 2026-09-29 当前工作树复核

- 当前分支工作树干净；本轮回测实现验证基线为 `1d72d6f`，根原有回归 `22/22`、根全量测试 `256/256`、
  TypeScript、依赖契约、生产构建和产物独立性扫描通过。
- 固定 Binance `BTCUSDT · 1h` fixture `2/2`，Vela-PineTS 本地全量 `27 files / 277 tests`，
  Binance/Hyperliquid Provider smoke 均为 `historyBars=5/live=true`；三浏览器 fixture、生命周期
  故障隔离和性能门禁均通过。
- 性能复核结果：10k/100k Trades Log 分页 p95 `42.0/33.5ms`、Dock FPS `60.06/59.90`、
  long-task p95 `0ms`、Simulation 10k `118.9ms`；生产预览
  `http://127.0.0.1:4188/?chart=maximized` 返回 HTTP 200。
- PineTS 全仓联网套件仍受 Binance 动态联网 fixture 的 ConnectTimeout 阻断；参考站逐笔 benchmark、
  完整 TradingView 逐 Fill/复杂订单、VoiceOver、生产 HMR/rollback 和最终视觉差分继续保持
  `PARTIAL/BLOCKED`，不得以本地 fixture 绿灯替代这些证据。

## 2026-09-29 过量平仓回归修复

- 修复 PineTS Broker Emulator 在 `closePartialPosition` 中的数量边界错误：账本已经按当前实际持仓
  将超量平仓请求截断，但净持仓标量此前仍使用原始请求量更新，可能把平仓错误地变成反向仓位。
  现在 `position_size` 使用 `effectiveQtyToClose`，与实际 Fill/ledger 数量保持一致。
- 新增固定回归：持仓 2、请求平仓 10 后必须得到 `position_size=0`、一笔数量 2 的平仓，不能出现
  `-8` 的伪反转；该修复不改变正常 FIFO、reversal、pyramiding 或 commission 语义。
- 定向 PineTS strategy suite：`24 files / 130 tests` 通过；根既有回归 `22/22`、根全量
  `255/255`、TypeScript、生产构建均通过。PineTS 全仓动态联网 suite 仍因 Binance ConnectTimeout
  外部阻断，继续保持未完成，不以定向结果替代全仓证据。
