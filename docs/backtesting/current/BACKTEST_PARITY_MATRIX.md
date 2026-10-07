# Backtest Workspace Parity Matrix

> 最新对齐批次（2026-10-07）：H-09共享Tab滚动196/196、S-11 Simulation挂载生命周期216/216、D-10实际小值轴8个图表/28个标签、ENG-10脚本错误双引擎64项、STG-03/06恢复合同及LC-07/NR-05故障隔离198项通过；根653/653、类型、构建、生产主E2E及工程门禁通过。K线空最新页缓存保护/连续性定向31项通过。证据为本地忽略目录 `audit-evidence/2026-10-07-tab-parity-closure/`、`2026-10-07-real-script-error-final/`、`2026-10-07-storage-restoration-final/`、`2026-10-07-workspace-fault-isolation-final/`。当前范围与各批次边界见[需求状态表](BACKTEST_REQUIREMENTS_STATUS.md)，本次没有重跑全量视觉/长时/读屏。

> 2026-10-07 桌面非文字可辨识续验：已修复 Calendar 焦点框、Settings 默认控件边界及 Simulation 置信区间低对比度/区间键盘不可达。实际两浏览器控件20项取色、16项键盘通过；区间轮廓及中位线最低4.41:1，原始68点可读，Simulation四场景144/144通过，计算值未改。最新根639/639、类型、重建/生产主E2E、紧凑桌面4场景228项及6项清理、包体/仓库/dist检查通过。此前完整本地门禁保持原时点；本轮未改视觉基线，VoiceOver与参考交互差异仍开放。证据仅在忽略目录 `audit-evidence/2026-10-07-essential-control-contrast/after/` 和 `audit-evidence/2026-10-07-simulation-band-contrast/`。

> 2026-10-07 桌面续验终态：根639/639、类型/构建、dev/prod主E2E及工程门禁通过；Dock 393/393、桌面 Dock 632项、Summary/Dock键盘176项及桌面32场景/1,792项、Analysis164、Log/Calendar858、H-06图例收藏/</>与L-11定位164项、Settings和strict visual四图diff=0通过。Simulation最后Preserve scoped CSS补丁另验84/84，Settings刷新竞态、box-sizing、空态Ghost、H-06与L-11已在后续批次通过。证据与源码时点见 `audit-evidence/2026-10-07-dock-keyboard-closure/README.md`（本地忽略）；下方627及更早数字保留各自批次。手机专项默认deferred/full可选，桌面VoiceOver、共享参考差异和最终提交CI仍按需求表开放，未commit/push。

> 当前需求总表：[BACKTEST_REQUIREMENTS_STATUS.md](BACKTEST_REQUIREMENTS_STATUS.md)。本矩阵保留逐项参考对照和历史证据索引。

> **现行 UI 标准（2026-10-07 用户修正）**：对标 Backtest Workspace 内的功能、交互、图标及组件风格，整体布局适配本项目。没有参考站 AI 侧栏/顶部登录 banner，也不留占位。合理的容器伸展、换行、列宽和绝对坐标差异不再按整页 1px / 0.5% / 1% 阈值判失败；遮挡、裁切、跨格不可读、入口不可达仍须修复。参考截图/DOM 是诊断证据，本地截图基线仍用于非回归；未验条目不自动转 PASS。以下现行视觉行统一按[计划 §10](BACKTEST_WORKSPACE_PLAN.md#10-ui-对标与本项目布局适配规范)执行，旧轮次的像素描述仅保留追溯。

> **最新范围：手机端适配暂缓（SCOPE-07）**。本期 UI/响应式验收以桌面为准；手机横竖屏、safe-area、触摸及手机实机专项不再阻塞。S-07、RSP-04 的手机部分为 DEFERRED，其它混合行只继续桌面子项；已有手机 PASS 保留原证据，不把未验收改为通过。桌面紧凑窗口、DPR/缩放、键盘及 VoiceOver 要求保持。

> **桌面组件续验**：原生 Performance/Analysis 与本地同输入的 13 类状态共 1,014/1,014 项通过，693/902 表格单元、276 图点及 145 次实际 hover 留证；Entry/Exit 定位在 Chromium/Firefox 各 37/37 通过。详见下方 R-COMP / A-LOC。Settings 本期桌面控件及 Simulation 同输入/交互已有对应证据，本批统一桌面门禁与最后Preserve CSS补丁的验证边界见顶部632批次记录；不以先前627批次代替后续修改的回归，也不由此关闭共享参考差异或辅助技术验收。

> 2026-10-07 新增独立模块证据：PERF-01 的固定 Chromium 生产基准已通过，Firefox 超出对照值仍明确列出；Settings 三浏览器控件/observer 清理通过；Log/Calendar 同 DTO 24 状态及三浏览器18组/2,610断言通过；Performance 非空 Benchmark 展示经原组件受控输入与本地三浏览器逐格对照通过。上述证据不自动关闭完整 UI、真实设备或最终提交 CI，也不由启动/包体预算代替。

> **当前 Binance/Workspace 长测状态（2026-10-07）**：修复版 Binance Spot 两小时长测已通过：实际观测 7,200.111 秒、23 次恢复、3,458 callbacks，29/29 sockets 创建/关闭平衡；activeSubscriptions/activeSockets/offlineBars/late callbacks 均为 0、cleanupErrors=[]，close 等待 2,066ms。终态 5 文件 SHA-256 及 Provider 源码哈希已核对。目录：`audit-evidence/2026-10-07-binance-proxy-two-hour-rerun-fixed/`；旧 `...-rerun` 保留为失败批次。独立生产 Workspace 两小时活动/资源清理也已通过（7,200.505 秒，真实 Hyperliquid BTC 永续，Worker/Socket 卸载归零）；随后两种真实引擎的 CONNECT 45 秒静默恢复也已通过。DATA-11/REL-01/REL-06 的列明范围关闭，不扩大为所有设备、地区或线上环境。

> **2026-10-07 前一统一门禁批次**：根627/627、类型/构建、dev/prod主E2E及生产32状态通过（非法外部请求和page/window错误0，dev生命周期7/7）；Analysis8×41、图标8组988项、资产3例、长Header4例及Header后Calendar手机12组/1,752项均有终态。local visual已独立审8组旧新图及DOM A/B：8px仅为12px币种suffix让8行各增1px，无裁切；修正border0/精确ring检查且5类负控拒绝。已审基线更新后普通strict门禁8图diff=0，原0.001像素差/1px本地几何阈值未放宽、首跑失败保留。证据 `audit-evidence/2026-10-07-ui-layout-acceptance/`。616/624、桥接310/310和引擎1773+1保留各自时点；全UI、VoiceOver/真机、最终提交CI不自动关闭，Safari专项暂缓。后续桌面632批次见顶部。

> 较早 Log 卡片边框 CSS 与视觉基线批次已解释坐标轴抗锯齿、Return-to-chart 图标和填充高度差异并通过当时视觉门禁。其后还有Calendar/控件/Performance/Header改动；新本地视觉结果须单独记录，不以旧截图通过或新UI口径自动刷新基线。

> **2026-10-06 P1 continuation（历史批次）**：已修复浏览器 offline 期间 Vela 对缓存 K 线发出 `tick/history` 后被适配层误当新报告的问题，并为 Binance/Hyperliquid 的 live lease 增加立即启动的 12 秒 watchdog、代次隔离和销毁清理。watchdog 在首帧未到达或后续 candle 静默时都会重建订阅；已有 settled ledger 保持 revision/status/trades/Simulation 能力不变，联网后的新 Provider tick 才能推进报告；`tests/e2e_provider_recovery.py` 对 PineEngine 与 PineWorkerEngine 的 3 周期真实 Hyperliquid Workspace 流程 6/6 通过。watchdog 版本 90 秒真实 Hyperliquid soak 通过，随后两小时 Hyperliquid 连续运行通过（7,200.133 秒、8,617 callbacks、24 sockets 平衡清理、offline/late/cleanup error 为 0）；该证据只关闭 Hyperliquid 本机 scope，Binance 长时路由仍缺证据；Futures 的 HTTP 451 与 Spot 可达性分别记录。2026-10-06 新参考窗口的 279 closed + 1 open（280/280 行）、2,520 个字段和 13 项汇总已由 `test:reference:golden` 逐字段通过；证据在忽略目录中，不随 Git 提交，需提供同样的完整输入才能复跑。该批次根测试 554/554、Vela-PineTS 303/303、低周期专项 23/23；当前数字见本段上方。整体仍为 **PARTIAL**。线上部署、CDN/browser cache 与 rollback 按用户要求移出当前范围，不作为本矩阵阻塞项。

> **当前验收口径与新增 P1（2026-10-06，后续缺口修复）**：参考数值以 Binance Spot `BTCUSDT · 15m · SMA` 的相同 OHLC 序列、策略源码和参数为准；Hyperliquid 裸 `BTC` 是 USD 永续，只用于 Provider/live recovery 验证。默认回测精度为 `chart-ohlc`，Properties 的 `Backtest precision` 可切换 `use_bar_magnifier` 高精度低周期回放。针对任意周期切换后的分页和页内缺口，应用已安装 Vela 0.7.7 的同游标有界重试补丁；新增空最新页/旧缓存 island 保护，避免错误宣布缓存窗口完整（history-resilience 6/6）。注册的 Binance/Hyperliquid continuous routes 对 2h/4h/D/W/venue-specific month 也走其连续性规则，custom/session 的通用 intraday helper 仍按自身日历限制，不生成伪造 K 线。普通周期/品种切换统一请求新市场最新 2,000 根并将视口定位到该窗口，显式范围/深历史请求保持可分页。确定性回归及真实 Chromium 代理流程（Binance Spot `BTCUSDT` 1m/5m 两页各 2,000 根、受控中间页 503 同游标重试）均通过。Hyperliquid 月线负 epoch 也已在 Provider 边界钳制到 0。跨设备/长时网络证据仍按 Final Gate 另计。

> **2026-10-06 Provider 资源复核**：真实 PineEngine/PineWorkerEngine 各 3 个恢复周期在每周期强制 CDP GC 后，JSEventListeners（987/990）和 Nodes（1698）均不随 socket 数继续增长，与 fixed-3 基线一致；destroy 后 listeners 降至 721。长测未强制 GC 的 Performance 指标上升不能单独证明 handler 泄漏；该项暂无确认业务缺陷，但长时终态仍需记录资源与 teardown。证据位于被忽略的 `audit-evidence/2026-10-06-p1-provider-workspace-resource-recheck-watchdog12/`。

> **2026-10-01 R-08～R-11 修复后独立复查（历史指针）**：R-08、R-10、R-11 结论保留于 `报告`（本地忽略证据，公开仓库不携带）；R-09 的历史状态见 `R-09 首次复查`（本地忽略证据，公开仓库不携带），当前状态以本文件下一条最新指针为准。整体仍为 **PARTIAL**。

> **2026-10-01 最新独立复查**：`R-09 第三次复查`（本地忽略证据，公开仓库不携带）、`R-09 新证据`（本地忽略证据，公开仓库不携带）。当前工作树重新运行后，R-08、R-10、R-11 的本轮缺陷场景通过；R-09 的 Tab/Shift+Tab、Escape、busy、destroy、三浏览器 Workbench pointer-open 和主 E2E 均通过。根测试 413/413、Vela-PineTS 283/283、构建、类型、依赖和静态独立性检查均由本轮重新执行。完整 reference golden、复杂撮合、长时 Provider、全量像素、VoiceOver/跨设备、bundle threshold 和 rollback 仍未完成，整体 **PARTIAL，Final Gate 未关闭**。下方旧报告和修复记录只作历史索引，不作为当前通过依据。

> **2026-10-01 修复者过程记录（历史）**：见 `账本与视觉修复记录`（本地忽略证据，公开仓库不携带）。SMA-UI-01 真实网络首次添加及单 tick 对照已通过；D-01 正常启动、工厂晚挂载、深历史和仅增加根数请求时序通过；V-03/04/05/07/08 与 V-10 modal 部分有新证据。没有按这些局部缺陷重新计算整张矩阵的 PASS 数，整体仍 **PARTIAL**。下方审计结论按各自历史对象解读。

> **2026-09-30 最新 SMA 9/21 参考对账**：固定 LuxAlgo `BTCUSDT/15m` 5,000-bar 响应与用户脚本已由参考站执行，并以同一响应喂给本地 PineEngine；Net P&L、Gross Profit/Loss、Max DD、96/184、Profit Factor 均一致，固定窗口算术 parity 为 PASS。证据见 `BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带） 和 `audit-evidence/2026-09-30-sma-cross-parity/reference-sma-921-runtime.json`。默认本地 Binance.US 500-bar UI ledger/readiness 仍 OPEN，矩阵整体仍 PARTIAL。

> **2026-09-30 动态深审（历史快照）**：综合报告见 `BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带），本地动态证据见 `audit-evidence/2026-09-30-dynamic-deep/README.md`（本地忽略证据，公开仓库不携带），参考站深审见 `BACKTEST_REFERENCE_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带）。R-05/R-06/R-07 当前独立 probe 9/9 通过；新增 D-01 的初始历史完成后策略插入时序问题仍为开放项。矩阵整体保持 **PARTIAL**，Final Gate 未关闭。

> **此前独立复查（历史快照）**：见 `BACKTEST_AUDIT_RECHECK_4_2026-09-30.md`（本地忽略证据，公开仓库不携带）。其 R-06/R-07 边界已在当前工作树重新 probe；矩阵当前状态以顶部最新独立复查为准。

> **参考站动态补充（2026-09-30）**：用户提供的 workspace 已成功登录并采集真实四 Tab、Settings、Simulation 和 13 笔策略报告，详见 `BACKTEST_REFERENCE_LIVE_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带）。固定 SMA 9/21/5,000-bar 响应对账已完成；默认本地 500-bar UI ledger、provider/partial policy 和 open-row 计数仍未完成。

> 版本：0.1（审计草案）
>
> 采集/整理：2026-09-26（参考动态记录中包含 2026-09-27 的续验条目）
>
> 历史采集基线：`4df3c8b`。该历史轮次对象：`feature/backtest-workspace-build` 的
> `53ab05795f45e5440eba1c1513b3bb63a659b9ae` 加未提交业务修复，不是“只有文档修改”。
> 该历史轮次独立结论为 **PARTIAL**，见 `BACKTEST_AUDIT_RECHECK_4_2026-09-30.md`（本地忽略证据，公开仓库不携带）。
> 第二轮审计发现的 S-01～S-03、U-01 后续已修复并复跑，见 `修复记录`（本地忽略证据，公开仓库不携带）。局部场景通过不关闭整体 parity；原独立失败证据未改写。
> 第三轮修复记录曾将 R-05～R-07 的目标场景标为通过，见 `第三轮修复记录`（本地忽略证据，公开仓库不携带）；第四轮独立复查重新发现 R-06/R-07 的适配器边界开放项，整体 parity 仍未完成。
> 下方矩阵保留历史需求及证据索引，旧测试数字/fixture/修复记录不作为本轮通过依据，最新状态以
> recheck 的新输入、dev/production 浏览器、实际引擎及故障时序证据为准。

## 1. 使用规则

本矩阵将参考站行为、本地实现和验证证据分开记录。每一行必须同时回答四个问题：参考站实际是什么、本地现在做了什么、什么自动化证据证明了什么、还差什么。

状态含义：

- **PASS**：有明确参考证据；本地实现覆盖该条；并有与该条直接对应的自动化或可复核运行证据。仅“代码看起来有”不够。
- **PARTIAL**：实现或局部测试存在，但缺视觉/交互/边界/数值/生命周期等至少一类证据，或已知存在未解决差异。
- **BLOCKED**：验收需要的外部条件、固定 fixture、底层能力或产品决策尚未具备；不能用局部绿灯替代。
- **NOT STARTED**：当前没有可验收的实现或测试。
- **OUT OF SCOPE**：已按当前阶段范围决定移出，不进入未完成阻塞队列；未来重新纳入时另立验收标准。

除非行内明确标注，`PASS` 只表示该行的局部合同通过，不表示对应 Tab 或整个项目完成。`BACKTEST_WORKSPACE_PLAN.md` 的 G9/Final Gate 仍以所有相关行通过为准。

本次独立审计的证据边界：`A-UNIT`、`A-OLD`、`A-E2E`、`A-PROVIDER`、`A-DEP` 以及仓库历史 fixture/截图均不作为本轮通过证据。它们只保留为需求索引；当前状态以独立审计报告中的新建输入、服务探针和代码复核为准。

## 2. 证据索引

| ID | 证据 | 可证明范围 | 不能证明的范围 |
| --- | --- | --- | --- |
| R-DYN | `BACKTEST_REFERENCE_EVIDENCE.md`（本地忽略证据，公开仓库不携带） 动态矩阵、追加动态复核、Full-access 续验 | 参考站在固定浏览器中的入口、字段、请求时序、部分几何和响应式行为 | 本项目数值相等、完整截图差分、未观察到的状态 |
| R-LIVE | `BACKTEST_REFERENCE_LIVE_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带） 真实 workspace 登录采集 | 真实四 Tab、Settings、Simulation 控件、指标人口和 open-row 语义 | 同数据本地逐笔/逐字段相等、参考站未来版本和未观察状态 |
| R-SMA921 | `2026-10-06 新参考窗口（本地忽略证据）`（本地忽略证据，公开仓库不携带） | 同一完整参考/本地交易输入由 `tests/reference_golden_compare.py` 逐字段复核：280/280 trades、2,520 fields、13 项汇总与 Simulation 输入一致 | 证据文件不进入 Git；若更换行情、脚本、参数，必须重新导出并复跑；不覆盖完整组件/交互及 TradingView 复杂撮合 |
| R-COMP | `audit-evidence/2026-10-07-performance-analysis-closure/README.md`（本地忽略证据） | 当日真实参考原生组件和本地 Workbench 相同 13 类输入，含空/open-only/赢亏平/极值/DST/日周月；1,014 项、Performance 693 / Analysis 902 表格单元、276 图点、145 次命中 hover；末次 paint 另验 | 不替代引擎 golden；保留真实本金/风险/MTM/UTC/可读对比度差异，Summary逐点键盘后由A-CURVE补齐，VoiceOver独立验收 |
| A-LOC | `audit-evidence/2026-10-07-trade-location/README.md`（本地忽略证据），`tests/e2e_trade_location.py` | 新参考实际定位与本地 Chromium/Firefox 各 37 项：Entry/Exit、open、当前周期 ±60 根、蓝色原生标签/精确十字线、4 秒及跨市场/Cell/销毁清理、持久化/指标库/Undo 隔离、失败恢复 | 当前为桌面定位合同；不证明新数值 golden、全部时区/locale 或暂缓的 Safari/手机专项 |
| R-RECHECK | `BACKTEST_LEDGER_VISUAL_RECHECK_2026-10-01.md`（本地忽略证据，公开仓库不携带）、`audit-evidence/2026-10-01-recheck-ledger-visual/README.md`（本地忽略证据，公开仓库不携带） | 本輪新构建、真实网络dev/prod、双引擎正常/故障路径、三浏览器视觉、独立SMA计算 | 未覆盖的全量reference/像素/复杂撮合/WS长链/rollback不作PASS |
| R-HTML | 外部参考 artifact `backtest.html`（580,219 bytes，SHA-256 `96549a059940d5785f831c18fb52b1f6a65d0830746ff6e0af731a19e42a805b`；原文件不入库） | Performance/Dock 的静态 DOM、字段顺序、Highcharts 形态、视觉 token | 事件处理、原始数据、公式、其它三个 Tab 的运行行为；需要外部 artifact 才能复核 |
| R-CHUNK | 参考组件 chunk SHA `8928f58b281cddd772241487387406fe310898bbb7c7dc6aaa257d6e2b360146`；图表/helper chunk SHA `2691702ab96f8f21f30e064723141dea28eac666268ecc8ad4db49d76a8f0950` | Trades Analysis 的结构、公式和图表合同（见参考证据追加章节） | 当前站点未来版本、完整 hover/键盘行为 |
| L-UI | [`src/features/backtesting/backtest-workbench.ts`](../../../src/features/backtesting/backtest-workbench.ts)、[`backtest-viewer.ts`](../../../src/features/backtesting/backtest-viewer.ts)、[`backtest.css`](../../../src/features/backtesting/backtest.css) | 当前本地 DOM、状态机、样式和清理路径 | 仅源码不能证明实际组件风格、完整交互及本项目响应式均已验收；不再使用整页像素误差阈值 |
| L-DOM | [`src/features/backtesting/trade-analysis-view.ts`](../../../src/features/backtesting/trade-analysis-view.ts)、[`trade-calendar-view.ts`](../../../src/features/backtesting/trade-calendar-view.ts)、[`simulation-view.ts`](../../../src/features/backtesting/simulation-view.ts) | 三个专用 View 的结构和语义 | 参考站未冻结字段的相等性 |
| L-DOMAIN | [`src/domain/backtesting.ts`](../../../src/domain/backtesting.ts)、[`backtest-metrics.ts`](../../../src/domain/backtest-metrics.ts)、[`backtest-simulation.ts`](../../../src/domain/backtest-simulation.ts) | 纯 selector、人口、公式、不可用值和 deterministic simulation | 参考站未知公式或撮合精度 |
| L-APP | [`src/app/backtest-controller.ts`](../../../src/app/backtest-controller.ts)、[`backtest-feature.ts`](../../../src/app/backtest-feature.ts) | Adapter/Controller 生命周期、报告映射、故障隔离和多 Cell 选择 | 底层 broker 的真实成交语义 |
| A-UNIT | `npm test`当前653/653；652及更早总数为历史批次，专项目录日志另存 | 纯函数、契约、DOM源码合同和状态机的已覆盖断言 | 没有被覆盖的视觉、真实浏览器、多浏览器和大数据行为；单测不能替代专项直接证据 |
| A-OLD | `npm run test:regression:existing`（当前 `22/22`，[`tests/architecture.test.mjs`](../../../tests/architecture.test.mjs)、[`tests/storage.test.mjs`](../../../tests/storage.test.mjs)） | 原有架构、Storage 和旧快照的代码级回归 | 工具栏每个点击的完整 DOM/视觉基线 |
| A-E2E | `npm run test:e2e` / `npm run test:e2e:prod`，[`tests/e2e_app.py`](../../../tests/e2e_app.py) | 当前 fixture 的 DOM、请求、Storage、Simulation、部分响应式和组合 smoke；`npm run test:e2e:cross-browser` 另证 BTCUSDT fixture 的 Chromium/Firefox/WebKit | 完整参考截图差分、VoiceOver、长时资源计数和完整应用跨浏览器视觉行为 |
| R-DOCK | 本地忽略 `audit-evidence/2026-10-07-dock-components/README.md` | 原始参考组件/本地Chromium/Firefox同DTO两宽度，328主配对+65最终touchup=393项；computed样式、实际tooltip/折叠/拖拽/键盘 | 两阶段源码时点明确；保留tiny轴等值记法及可读主题差异，不等于全工作区通过 |
| A-DOCK | [`tests/e2e_dock_interactions.py`](../../../tests/e2e_dock_interactions.py)，本地`dock-keyboard-closure/dock-final/` | 两浏览器×四桌面/嵌入宿主，8场景632项，源码稳定、chart/observer归零 | 独立受控展示报告，不替代真实引擎或在线数据对账 |
| A-CURVE | [`tests/e2e_summary_keyboard.py`](../../../tests/e2e_summary_keyboard.py)，本地`dock-keyboard-closure/keyboard-final/` | 两浏览器各88项；12,001 raw/3 rendered、键盘、live descriptor/坐标范围/币种、真实Workbench及清理 | 非VoiceOver或实际设备验收；不会新增12,001个DOM或Tab停点 |
| A-NONTEXT | 本地忽略 `2026-10-07-essential-control-contrast/after/`、`2026-10-07-simulation-band-contrast/post-fix-final/`及`post-fix-fallback/`；`tests/e2e_simulation_components.py` | 两浏览器Calendar焦点、Settings四类控件默认/焦点实像取色20项及16键盘；区间虚实轮廓/两组low-high/68键盘点，正式Simulation4场景144项 | 本次暗色桌面、受控报告范围；不代替VoiceOver、所有主题/其它图形或参考站完整视觉一致性 |
| A-TOOLTIP | 本地忽略 `2026-10-07-pointer-tooltip-escape/`、`2026-10-07-shared-tooltip-escape/`；Simulation/Analysis永久E2E | pointer首次Escape隐藏提示、第二次退出；point Escape保精确焦点且Home继续。两浏览器Simulation164/164、共享路径66/66、Analysis三类图×DPR1/2共212/212；Calendar子浮层优先级已验，原失败保留 | 原数据与Chart/Observer清理不变；只证明列明桌面交互，不扩大为所有图表/状态/VoiceOver通过 |
| A-PROVIDER | `npm run test:providers` / [`tests/provider_smoke.py`](../../../tests/provider_smoke.py) | Binance、Hyperliquid 各自历史 5 bars + live smoke | Provider smoke 不证明参考站逐笔数值相等；本期唯一参考对账为 Binance Spot `BTCUSDT/15m/SMA`，其完整输入见 R-SMA921 |
| A-DEP | `npm run check:dependencies`、`npm run build`、Fork fingerprint/sentinel、`npm run test:e2e:offline`、`npm run release:manifest` | 本地包版本、SHA、Worker 内嵌版本、Highcharts 本地构建；fresh clone、生产断网壳和文件级 manifest 证据 | 上一制品真实 rollback、清缓存恢复和无行情缓存行为仍未完成 |
| A-UNVERIFIED | 当前需求表中的开放项及本矩阵的具体缺口；历史 `[ ]` 必须先核对现行范围和后续直接证据 | 列明待验场景，不作为失败或通过证据 | 固定golden、有限撮合/HMR/性能/资源合同已有各自闭环，不能由历史未勾项重新判未完成；实际VoiceOver、最终提交CI及正在补验的存储/错误隔离仍逐项记录 |
| A-LEDGER | `BACKTEST_LEDGER_AUDIT.md`（本地忽略证据，公开仓库不携带） 及 PineTS/Vela 定向测试 | 证明 round-trip trade ledger、reversal/FIFO/pyramiding 的内部撮合语义，以及本地 Fork `auditLedger` 的 identity-bound raw order/fill bridge | 上游 Vela 基线仍无 raw selector；本地 envelope 缺失、过期或 malformed 时 capability 必须回退 false；不能据此宣称完整 TV broker parity |
| A-FORK | [`VELA_FORK_DECISION.md`](../../architecture/VELA_FORK_DECISION.md) 与 dependency contract | 证明 PineTS/Vela-PineTS 的本地源码版本、Vela 主包的 registry 边界和触发本地化的条件；清缓存构建已在 `44ade5c` 临时 clone 复核 | 不能证明断网发布或 rollback 演练已经完成 |

## 3. Dock（底部回测摘要）

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | 无策略时不显示空 Dock | R-DYN §动态行为矩阵：无 Strategy 不渲染空 Dock | Workbench 初始 `hidden`，无报告时进入 empty state | A-E2E `verify_backtest_workspace`、fixture remove 路径 | PASS | 继续在策略删除、cell destroy 和刷新后保留该断言 |
| D-02 | 策略加入后自动出现，不增加 Run 按钮 | R-DYN Strategy 入口 | `BacktestFeature` 监听 strategy run；Dock 只有 settings/viewer/collapse 入口 | A-E2E strategy attach/complete smoke | PASS | 固定首次添加策略的参考请求计数仍需 G0 复采 |
| D-02a | 初始 history complete 后新增策略不得发布 ready 空账本 | 原失败保留为历史；本輪新真实 Binance.US 500 bars 首次加载 | 当前普通初始/晚挂载/晚加策略正确继承历史与账本 | audit-evidence/2026-10-01-recheck-ledger-visual/real-provider/summary.json，history/PineEngine.json、PineWorkerEngine.json | PASS（该目标场景） | 156 次真实采样无缺失，两引擎各 19 项正常生命周期通过；异步市场与历史故障见 D-02b/c |
| D-02b | 切市场后旧报告不得重新完成/模拟 | 本地正确性门禁，不依赖参考推断 | PineEngine/PineWorkerEngine 以 run/context/history 身份 fence 撤销旧 ready 与 Simulation | audit-evidence/2026-10-01-r08-r11-remediation/independent-r10-2、independent-r10-overlap-2；报告 §4 | PASS（本轮缺陷场景） | 本行关闭列明受控竞态；多周期/撮合本期合同见ENGINE-03，Worker生产两小时资源见REL-06各自冻结证据，不再笼统列为未验，也不由本行扩张到所有组合/设备 |
| D-02c | 历史网络失败不得伪装为源耗尽 | 计划失败/partial语义 | Provider failure 保留 error/aborted 语义；Retry 绑定原始 target、Cell、market 和代次 | audit-evidence/2026-10-01-r08-r11-remediation/independent-r11-2、independent-r11-multicell-2；报告 §5 | PASS（本轮缺陷场景） | 本行覆盖503/429/timeout/invalid JSON；两数据源两小时恢复及双引擎CONNECT静默恢复已由REL-01直接证据关闭，生产资源另见REL-06；后续相关改动继续回归，不要求全部地区/设备通过 |
| D-03 | 默认展开高度约 280px，并受本地可用区域约束 | R-DYN 1440×900 实测 `280px` | `DEFAULT_DOCK_HEIGHT=280`，CSS 高度变量 | A-E2E G3a 几何断言（约 279–280） | PASS | 此处只关闭默认高度合同；其它视口按本地宿主适配，不追加参考整页像素门槛 |
| D-04 | 折叠45px，保留策略名/日期/净利和Expand/Viewer入口 | 当前原始w6组件实际渲染，纠正旧28px推断 | collapsed45、隐藏body/separator、焦点回收；无宿主CSS reset也保持45 | R-DOCK同输入对照；A-DOCK与主E2E真实折叠/展开 | PASS（当前组件合同） | 旧28px结论失效，不复制只留控制行的旧实现 |
| D-05 | 展开态104px至宿主75%，拖拽低于190px收至104px | 当前w6真实pointer及原始handler | host clamp、Pointer Capture、snap、double-click reset；190/230图表与轴阈值 | A-DOCK两浏览器×四桌面/嵌入宿主共632项；R-DOCK动态对照 | PASS（列明边界） | 已修嵌入宿主初次错误使用window高度；性能预算仍按PF-05原生产时点，不冒称本批重新长测 |
| D-06 | 键盘调整、Home/End、ARIA separator | 当前参考Arrow步长16、Shift48、Home上限/End下限 | 对齐handler和ARIA；隐藏图表/折叠时回收焦点 | A-DOCK真实按键、clamp、持久化计数、销毁；主E2E | PASS（键盘合同） | 不因自动化通过声称实际VoiceOver已验 |
| D-07 | 展开/折叠Header的名称、日期、净利和入口 | R-DOCK同年/跨年、空/open-only/正常实际组件 | 横向identity、collapsed net、Viewer可达，空态Ghost32px | R-DOCK两宽度/两浏览器及实际点击；A-DOCK | PASS（列明Header状态） | 活动日期范围仍用closed exit；加载/错误归P-15，不重复扩大本行 |
| D-08 | 五KPI格式、正负零/空值、币种和颜色 | R-DOCK八类相同DTO含极小值、百万、PF低/等/高于1 | 可选百分小数、金额精度、分离币种；Net0/PF1中性色 | R-DOCK 393项联合对照；KPI39px、chart164px最后复测 | PASS（展示合同） | 同DTO只证明展示；原始引擎数值对账见ENGINE-04，不混为一次验证 |
| D-09 | Summary 的已实现收益与mark-to-market口径 | 新同窗口实际应用链：参考已实现1,010.32，本地加open195.76为MTM1,206.08；旧“参考含open”推断撤回 | Controller `netPnl + openPnl`，Dock/Viewer与多空分项保持可复算 | domain/controller回归；`2026-10-07-ui-actual-chain`及reference-formulas原因核实，原始账本golden另由ENG-04a关闭 | PARTIAL（明确展示口径差异） | 保留R-08修复后的本地统一口径，不重新开放固定golden；不能将同账本写成两页面净利完全一致 |
| D-10 | KPI下方全宽累计P&L图及高度适配 | R-DOCK原组件曲线、右侧数据范围轴、tooltip和高度阈值；原formatter独立30输入 | container高度、完整descriptor live更新、2,000渲染点上限与原始tooltip；低高度隐藏图/轴；小值轴按参考科学记数 | R-DOCK、A-DOCK、A-CURVE保留原时点；最新14/14定向测试、两浏览器8个实际Dock/Viewer图表28标签，见dock-axis-notation | PASS（列明图表合同） | 极小轴差异已关闭；保留浮点噪声清理、非有限值保护和可读颜色，compact轴与原曲线未改，不称所有CSS字面相同 |
| D-11 | Collapse、Viewer、Settings 不重跑策略/Provider | R-DYN tab/Viewer 未产生 `backtest-run`；计划 §3.3 | Workbench 回调只改布局/打开状态；Controller 分离 simulation | A-E2E 请求/Storage/worker 守卫 | PASS | 扩展到 Dock resize、双击 reset 和 live tick 期间计数 |
| D-12 | Viewer 打开时 Dock 隐藏但 chart 保持挂载 | R-DYN Viewer absolute overlay、返回恢复 | `backtest-feature.ts` 设置 reserved height/ARIA suppression，不销毁 Vela | A-E2E geometry、Viewer open/return；runtime-lifecycle主入口CSS HMR保留Settings、main reload与生产20次挂载销毁 | PASS（列明挂载合同） | HMR/挂载资源见LC-01/08，后台Cell隔离见REL-03，各自范围已验；未列异常统一按LC-07具体缺口处理，不重复打开整个生命周期任务 |
| D-13 | Dock高度/折叠跨刷新规则 | 当前w6完整源码及父调用：内部false/280状态，无持久化props/storage | 保留既有独立`quant-tools:backtest-dock:v1`偏好，只保存height/collapsed并clamp | preferences单元、A-DOCK及较早真实恢复证据；shared-reference-state源码 | PASS（调查与本地偏好合同） | 参考重挂默认展开280，本地恢复用户偏好，是明确本地增强；不写成严格相同，也不再等待不存在的服务器高度保存证据 |

## 4. Viewer Header、容器和通用 Tab 行为

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| H-01 | Viewer 覆盖 chart 工作区而非路由/浏览器 Modal | R-DYN Viewer 框 `absolute inset-0 z-20`，保留全局栏 | 应用层 sibling/overlay，Vela chart 不销毁 | A-E2E Viewer geometry 与 chart suppression | PASS | 补 1440/1280/1024 reference-candidate 几何快照 |
| H-02 | Header资产徽标、symbol、timeframe与按钮可读性 | 当日参考BTC/ETH及本地fallback约定 | 本地共享SVG/initials；mobile长名换行并预留Favorite/Close空间 | 图标8例988断言/100实例含DPR1/2；资产3例、多ETH SVG ID和Canvas导出；360/390长名/长token4例实际按钮通过 | PASS（列明资产/Header合同） | 无远程Logo；未知ETHFI为ET，不新增全交易所资产库。完整模块状态和真机仍归UI-08/10 |
| H-03 | provider 不可用时不显示 `unknown` 占位 | 最新本地修复与计划范围推断 | provider 过滤，symbol/timeframe 缺失时隐藏对应块 | Viewer contract 记录缺失字段断言 | PASS | 加入所有空值组合的浏览器快照 |
| H-04 | Header活动日期范围，同年省略重复年份 | 参考helper七种日期及R-DOCK跨年实际组件 | closed exit activityRange，零/仅open隐藏、单笔同日起止，UTC格式 | 双引擎8/8及R-DOCK Dec30,2023–Jan1,2024实际配对 | PASS（en-US/UTC合同） | 不新增任意locale覆盖；市场加载范围与活动范围不混用 |
| H-05 | Return to chart/minimize 图标关闭 Viewer 并恢复布局 | R-DYN `Return to chart` | Header back button，close path 恢复 Dock、ARIA 和焦点 | A-E2E click/hidden/Storage assertions | PASS | 补 Esc、浏览器 Back、异常 report 更新中的返回路径 |
| H-06 | Strategy favorite 星标与列表/图例共用状态 | 用户统一收藏要求；参考实际为账户 save-backtest | FavoriteService 单一状态，按实际 Workspace 实例解析显示名，legend 收藏/代码入口共用 | 新真实 Worker 两浏览器 legend→Viewer→Favorites 及反向、</>名称/源码通过；与 L-11 合计 164 项，见 legend-same-time-location/run5 | PASS（本地统一收藏） | 修复图例收藏名错误显示 Indicator；source-key/savedName 不变。本地没有实现参考账户保存报告，不宣称两功能相同 |
| H-07 | Settings 入口只在 Dock 提供，Viewer 不重复展示 | R-DYN/HTML Viewer header 只有 Return、market identity 和 favorite；Settings 从 chart Dock 打开 | Dock callback 进入 `StrategySettingsPanel`；Viewer header 不再注册 settings button | `tests/strategy-settings.test.mjs`、A-E2E Dock settings + Viewer absence smoke | PASS | 批量提交请求数仍需独立浏览器计数 |
| H-08 | 首次打开默认 Performance；重新打开不记住最后 Tab | R-DYN §3.4、动态 tab 复用 | `open()` 清空 scroll、选择 Performance | Viewer contract/Tab E2E | PASS | 补重载、report revision 和多个策略切换的默认态 |
| H-09 | Tab sticky、内容区滚动与跨Tab位置 | 完整jI源码及参考多轮往返：单一共享容器、无per-Tab记忆，按内容高度夹紧 | 共享当前scrollTop；同Tab不变、重开Performance/top0；同页pending保位置，导航/终态/新context清理 | 原实现新合同5项失败留证；修后两浏览器受控56、实际dev70、prod70，共196/196；源码/dist稳定，见reference-shared-scroll | PASS（列明共享滚动合同） | 已对齐；按实际高度断言，Firefox亚像素取整允许0.5 CSS px，不硬编码参考某次offset或要求整页重合 |
| H-10 | 四个 Tab 顺序和文案 | R-DYN、R-HTML 明确 `Performance / Trades Analysis / Trades Log / Simulation` | `TABS` 固定四项，tablist/tabpanel | A-E2E selected/controls；unit viewer contract | PASS | 视觉字体、间距和 active underline 仍需差分 |
| H-11 | Tab 切换只 selector/re-render，不请求回测/行情 | R-DYN 网络观察 | Viewer render + chart destroy/recreate，仅 Controller report 不重跑 | A-E2E market/backtest request guard | PASS | 加入连续快速切换和 live revision 竞态证据 |
| H-12 | Viewer关闭、destroy幂等且图表实例释放 | 参考返回入口；计划§5.4/§11 | destroyReportCharts、Viewer/feature cleanup | 主dev/prod E2E、A-DOCK/A-CURVE资源归零；生产十次/异常构造及两小时各有原时点证据 | PASS（列明生命周期） | 有限重复挂载/清理合同关闭，不等于全设备无泄漏或当前源码重新跑两小时 |
| H-13 | Replay → 选择 K 线 → Backtest → Return to chart 状态链 | 2026-09-29 登录参考站动态复核：Replay 后显示 K 线选择提示，选择后出现 Backtest，进入 Viewer 后提供 Return to chart | 本地已有普通 Backtest Viewer 和 Return to chart；Replay 状态链不在本阶段范围 | 参考站 DOM/交互证据保留于 `BACKTEST_REFERENCE_EVIDENCE.md`；不作为当前发布验收项 | OUT OF SCOPE | 暂不实现、不阻塞当前回测工作区；未来若纳入，再增加 Workspace adapter Replay seam |

## 5. Performance Tab

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 | Summary 区及累计 P&L 图 | R-CHUNK historical_net_profit 与 trades_history 同序号关联；Tooltip Trade #=index+1；2026-09-29 同层几何测量 | `renderPerformance` 改为按交易序号的 realized-ledger 曲线；exact equity 独立保留作风险数据；live snapshots 不重建未变化图表 | R-COMP：空/open-only/赢亏平及极值实际Summary曲线、点与hover对照 | PASS（列明组件合同） | 保留本地MTM/UTC及正确人口差异；Summary逐点键盘由A-CURVE通过，VoiceOver仍按UI-10，不称完整辅助技术通过 |
| P-02 | Net Daily PNL 图（250px） | R-HTML `Net Daily PNL (USD)`、Highcharts 250px | local bar chart、currency/positive/negative colors | R-COMP：真实原生/本地日桶、日期、轴、点与命中hover对照 | PASS（列明组件合同） | UTC口径及可读文字对比度保留；共享loading/error另按P-15 |
| P-03 | Weekday Performance 图（七个 Sun–Sat 桶） | R-HTML `Weekday Performance (USD)`；计划要求七桶补零 | `weekdayPerformance` selector + bar chart | R-COMP：Sun–Sat含零桶；空/open-only不画伪零图，全赢亏/跨DST/日周月输入 | PASS（列明组件合同） | 当前有限样本通过，不扩展为所有市场session或locale |
| P-04 | All/Long/Short 表头、分组和 14 个指标行 | R-HTML table 17 `<tr>`（含表头/分组），All/Long/Short；字段静态可见 | `PERFORMANCE_ROWS`、`renderMetricTable`、Risk-Adjusted/Benchmark groups | R-COMP：Performance 693表格单元、顺序/字体/分组与数值格式；原Benchmark专项另验 | PASS（列明展示合同） | 本金/风险/人口差异明确列于需求表，不因视觉对齐而撤销正确计算 |
| P-05 | All/Long/Short 独立且使用可解释的一致口径 | 参考有方向列；计划要求方向汇总 | All 使用 account mark-to-market P&L；Long/Short 仅在逐腿估值可证明时分解，否则保持 unavailable | audit-evidence/2026-10-01-r08-r11-remediation/recheck-r08/results.json、independent-real-provider-2/result.json；报告 §2 | PASS（本地口径） | 已验证 All = Long + Short 的可证明场景及对冲不可证明场景；参考站方向口径仍需完整外部 golden |
| P-06 | Gross Loss 显示正的损失幅度 | R-DYN Performance 说明 | domain `grossLoss` 归一化为正幅度，formatter 显示 | R-COMP：单亏/全亏/混合/极值真实组件对照；领域非负损失幅度回归 | PASS | 列明负样本和展示已核对；修改领域计算时仍需独立数值回归 |
| P-07 | Average P&L per Day/Week 方向维度 | 参考静态/动态字段；计划新增方向维度 | `averagePnlPerDay/Week` All/Long/Short | R-COMP：稀疏日期、跨DST、日周月输入的All/Long/Short表格逐格核对 | PASS（列明展示合同） | 使用UTC自然日/周；不泛化任意session/calendar |
| P-08 | Drawdown 为单一复合行；风险分组/Benchmark 分组 | R-DYN/计划 §3.5 | `drawdown` 单元格复合金额+百分比，分组行渲染 | R-COMP：Drawdown复合行、分组样式、极值数字与行高实际DOM留证 | PASS（列明组件合同） | 保留真实引擎权益高水位分母，与参考初始本金分母差异已记录 |
| P-09 | Benchmark 缺失值：All 为 ASCII `-`，Long/Short 真空白 | 当日加载原 StrategyPerformance/renderCell；自然桥接为 `benchmark:{}` | metric table 区分缺失 All 与空方向列 | 三浏览器各48组受控值含缺失，原组件逐格对照；证据 `2026-10-07-performance-controls` | PASS（缺失展示） | 非空展示已另由P-12验证，不将自然空桥接写成本地能力失败 |
| P-10 | Strategy Outperformance 的单位/公式 | 原组件直接展示货币值并加正号；参考桥接不提供自然非空值 | 同一可见MTM Net Profit减Buy & Hold，缺失保持unavailable；展示沿用P-12格式 | R-08真实Provider算术证据；新三浏览器原组件对照含Outperformance | PASS（本地算术与展示合同） | 原参考桥接空值不能证明外部计算公式；保留本地已定义可复算口径，不等待不存在的自然样本或冒称计算golden |
| P-11 | CAGR/Calmar/Sharpe/Sortino 来源与 unavailable 规则 | 2026-10-07实际参考模块及同输入原函数复算；六项数值一致 | 本地真实本金/引擎风险指标与capability fallback，保留可复算Calmar；显示三位小数 | `audit-evidence/2026-10-07-reference-formulas/`：参考CAGR固定10,000未传实际1M、Calmar另取时间、risk显式0；本地0.7103%本金计算独立确认 | PARTIAL（明确显示差异） | 原因已查清，不重复列未知公式；不复制固定本金/假0。方向CAGR仍缺明确本金分配合同，全视觉另验 |
| P-12 | Buy & Hold PnL/% Gain 展示及可用性 | 当日加载原StrategyPerformance/formatter/renderCell，51组受控props；自然bridge明确空对象 | 已有本地benchmark capability；修正百分比正号、精度、币种后缀和方向空白 | `audit-evidence/2026-10-07-performance-controls/`：三浏览器各48组、432单元格、135颜色与90后缀检查一致；24文件SHA已验 | PASS（展示合同） | 直接原组件受控输入不是自然非空Benchmark，也不是计算golden；保留本地独立已定义公式，不再列自然样本阻塞 |
| P-13 | Tooltip、legend、hover、axis、positive/negative colors | R-HTML Highcharts DOM、颜色 `#089981/#f23645`；动态截图哈希 | local Highcharts 13 renderer + SVG fallback/descriptions | R-COMP：六图276点/145次命中hover；最终paint重跑；本地Chromium/Firefox键盘/legend回归 | PASS（列明视觉/交互） | 颜色/tooltip深底、轴/legend已验；Summary逐点键盘由A-CURVE通过；VoiceOver仍按UI-10，低对比度不复刻 |
| P-14 | Performance 货币/百分比/小值/ratio 精度 | 原formatValue、formatRatio和formatDrawdownPercent直接执行；覆盖零、正负、小数、1e-7边界与百万 | Performance专用formatter；小值最多7位且不强制尾零、极小科学计数、百万M、ratio三位不分组，12px单位 | 新35/35格式/Viewer定向回归、tsc；原组件与三浏览器实际Workbench DOM逐格对照 | PASS（Performance表格展示） | 不更改KPI/图表全金额或领域值；负零规范化和可复制的币种文本空格有意保留，其它Tab不由本行自动通过 |
| P-15 | 空数据、no-trades、open-only、loading/error | 参考 `jR/jI` 只挂载成功且 trades resolved 的完整结果；宿主 Loading 约10.7秒，Viewer无独立 compiling/error/retry props，ledger rejection catch为空 | 显式状态、Retry和身份门控；错误页面隐藏旧图，内部last-good保留不等于将旧结果显示为当前完成 | 参考15次自然加载 + 源码调用链；本地 Chromium/Firefox 7状态+Retry各8项=16/16，见 reference-status-contract | PASS（有限状态合同） | 参考没有可逐项复制的Viewer失败页；本地错误可见/Retry是安全增强，不据此声称参考逐态字面一致 |
| P-16 | 结果曲线来自同一 runId/snapshotRevision 的 exact series | 参考复用同一结果；本地计划 G4b.2 contract | Adapter validates identity/count/monotonicity; report exact capability | Adapter/controller tests, E2E `exact-equity` assertion；ENGINE-03有限账本/曲线/审计重放 | PASS（本期身份合同） | wire层仍是分别校验的envelope，未声称单包原子传输；本期一致性由身份门控和归档重放验收，不将未来传输重构列为UI阻塞 |

## 6. Trades Analysis Tab

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| A-01 | 顶部 P&L Distribution + Winrate donut 两列/窄屏单列 | R-CHUNK/R-DYN Analysis 合同 | `renderTradeAnalysisView` overview grid, local Highcharts/SVG | R-COMP：13类输入、902表格单元，包含完整下半页；桌面实际渲染/截图 | PASS（列明组件合同） | 布局适配本地容器；手机适配暂缓，不以整页坐标判失败 |
| A-02 | Histogram bins、颜色、三条 aggregate 参考线 | R-CHUNK 明确 `ceil(sqrt(N))`、边界和线颜色 | `trade-analysis.ts` selector + renderer | R-COMP：极值/小值/全平/空输入，真实bins、颜色和三条参考线 | PASS（列明组件合同） | 新增样本或参考组件变化时重新核对；不推断所有未知极值排列 |
| A-03 | Donut 只有 Winners/Losers/可选 Breakevens，无 Current | R-CHUNK/R-DYN | donut selector/presentation projection | E2E asserts no Current + chart contracts；新同输入实际双引擎 Analysis 表格 57/57 | PASS（人口合同） | 真实 VoiceOver 仍归 UI-10/AX-08，未验不等于用户取消；本行不证明实体辅助技术通过 |
| A-04 | 第一表精确 10 行，All/Long/Short | R-CHUNK | 专用 Analysis DTO/View | R-COMP：第一表全行/表头/方向列、字号行高及number format | PASS（列明组件合同） | 缺失方向值与真实零区分；本地不可用值占位差异明确保留 |
| A-05 | Duration vs P&L 单 scatter + OLS trend，不把 trend 放 legend | R-CHUNK | 一个 colored scatter + trend series | R-COMP：真实scatter/OLS点、hover文本；Chromium/Firefox箭头/Home/End及legend回归 | PASS（列明组件合同） | 单点不添加无绘制的空Trend；完整读屏单列UI-10 |
| A-06 | 第二表精确 9 行，duration/frequency/streak bars | R-CHUNK | 专用 selector/view | R-COMP：第二表全行、日周月周期/稀疏DST/全赢亏平输入 | PASS（列明组件合同） | 仅覆盖列明有限输入；不是引擎新golden |
| A-07 | open/current 只在 Analysis 投影为 breakeven，不能污染其它人口 | R-DYN §4.2、R-CHUNK | `includeOpenInAnalysis`/presentation-only projection | R-COMP：open+closed+true breakeven混合及open-only实际组件；领域投影隔离 | PASS（人口合同） | Analysis投影不改变原始账本或Summary已定义人口 |
| A-08 | 空交易页显示 `No trades available` | R-CHUNK | Analysis empty state keyed to canonical closed population | R-COMP：empty/open-only/all-win/all-loss实际参考/本地状态截图与DOM | PASS（列明状态合同） | 无交易提示与有open人口按当前模块合同；共享history错误状态另验 |
| A-09 | Duration fallback、UTC day/Sunday week、streak semantics | R-CHUNK 公式 | selector implements finite duration/timestamp fallback | R-COMP：UTC日/周、稀疏DST及日周月输入逐格对照 | PASS（列明时间合同） | 与Summary参考浏览器本地时区的已知差异保留；不称所有时区locale通过 |
| A-10 | 不显示自创三张卡片/Current slice | R-CHUNK 明确排除 | 旧 cards removed; dedicated View | E2E selectors and source contract | PASS | 保持线上 chunk 版本变化时重新审计 |
| A-11 | Analysis图表a11y、hover、键盘与reduce motion | 当日参考鼠标及三图配置确认深色tooltip；计划§10.4 | 修复白底白字及隐藏分类仍可Tab，point键盘/tooltip与CSS reduced motion保留 | 新Chromium/Firefox×桌面/手机×DPR1/2，8×41真实hover/键盘/legend断言及独立window ErrorEvent通过，资源释放0；最新生产32状态另验 | PARTIAL（完整辅助技术） | 已列hover/隐藏分类/键盘不重列未做；完整状态、VoiceOver/真机不由DOM/axe代替，Safari专项暂缓 |

## 7. Trades Log / Calendar

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| L-01 | 默认按 Trade # 降序；新列首次降序，重复切换 | R-DYN `13 → 0`、追加线上 chunk 排序规则 | `DEFAULT_TRADE_SORT`/stable comparator | `tests/backtest-viewer-contract.test.mjs`、A-E2E sort assertions | PASS | 复杂 reversal/同 timestamp tie fixture 尚未覆盖 |
| L-02 | 可见列及条件列：Trade #、Entry、Exit、Size、Net P&L、MFE、MAE、Cumulative P&L | R-DYN/线上 chunk；CSV 未观察 | local conditional Size/Excursion columns；完整八列桌面布局按参考固定列宽，窄屏保留横向滚动 | A-E2E header/order/empty colspan assertions；Chromium 1440px 逐列几何 0 差异、390px 横向滚动复核 | PASS（列合同） | 其它 viewport/DPR 和全状态视觉差分仍归 G9/UI-08 |
| L-03 | Long/Short badge、UTC/browser-locale datetime、价格精度和币种 | R-DYN 追加复核 | `formatTradeDateTime/Price`、direction badge、专用 number formatter | Unit/viewer/E2E formatting assertions | PASS | 需要固定 locale 与多资产精度 screenshot |
| L-04 | 未平仓Exit显示Open，领域exit保持null | 新参考实际open Exit为1970；本地保留已修正的Open而不复制epoch | presentation显示Open，domain/calendar/simulation使用null，缺失已实现P&L保持破折号 | domain/viewer回归；UI-04同DTO及实际引擎Log对照 | PASS（本地Open合同） | 参考差异已明确，不再等待文案冻结；未平仓只提供Entry定位 |
| L-05 | Entry/Exit `Show … on chart`，返回并临时定位 | 新参考实际pointer与回调：当前周期±60根、蓝色label_down、精确crosshair、4秒消失；open仅Entry | `focusBacktestExecution`用公开native indicator/renderer与silent history；旧市场/Cell/报告/销毁清理，临时类型不进入指标库/持久化/Undo | A-LOC：Chromium/Firefox各37/37；参考/本地真实截图及范围/label/价格/过期/错误恢复；32/32定向单元 | PASS（列明桌面定位） | 不依赖不存在的marker-select API；保留Open而非epoch。手机/Safari专项暂缓，未知locale/全部设备不作通过声明 |
| L-06 | Calendar list/calendar icon-only tabs，使用同一交易源 | 新参考Lucide路径及同DTO24状态采集 | 图标使用参考几何；共享交易源、icon-only tabs及状态 | `2026-10-07-log-calendar-completion`：18组真实pointer/键盘/touch，模式切换/ARIA通过 | PASS（列明控件合同） | 全工作区图标矩阵另验，不由这两个模式图标替代 |
| L-07 | Calendar exit日分桶、日P&L/count/win%、月汇总及窄格可读性 | 新参考275closed+1open DTO，同输入24状态 | 七列、日/月聚合；窄容器缩写且按钮展示未缩写完整日值，不复制参考跨格溢出 | 18组/2,610联合断言，11种金额边界与280px嵌入容器；矩阵/采集起止源码SHA稳定 | PASS（列明数据与交互） | 不冒称所有locale或引擎数值golden；保留响应式布局适配与本地负零/Open修正 |
| L-08 | 当前月/前后月/Move to current month/空月/焦点恢复 | 新参考月切换、tooltip/空月及同DTO24状态 | 月份状态、参考tooltip、完整日值关闭回焦点，空月文字保留AX而不额外占位 | 三浏览器×1440/390/360×DPR1/2共18组；真实hover/Enter/Space/touch/Escape和销毁通过 | PASS（列明视口/状态） | 新截图/DOM差分为组件诊断，不据此要求整页坐标重合或宣称所有设备/横屏已验 |
| L-09 | CSV 导出入口 | R-DYN 当前样本未观察到可见按钮 | 未增加导出按钮 | A-E2E/DOM absence expectation | PASS | 若未来参考出现入口，先更新 R-DYN 和本行，不得自行添加 |
| L-10 | 上万行有界分页 | 计划性能合同；参考本次一次渲染276行 | 保留200行安全分页；复用wrapper/pager，更新表体不丢tabpanel/ARIA/焦点 | 最新501行200/200/101全遍历的18组矩阵；生产10k/100k分页及资源门禁通过 | PASS（分页合同） | 连续滚动/虚拟列表不是当前新增需求；不为追求参考无限DOM删除已验安全分页，定位视觉另归L-05 |
| L-11 | reversal、partial-close、同 timestamp 多事件定位 | ENGINE-03 有限撮合合同及原生图表定位入口 | 按实际 trade 身份与 entry/exit 时间价格定位，独立临时 marker | 新真实 Worker 生成 5 个 closed legs；两浏览器同 entry、同 exit、反转退出/进入逐笔点击，marker/crosshair/4秒清理、无重算均通过；见 legend-same-time-location/run5 | PASS（有限定位合同） | 164 项联合结果包含 H-06；不新增 raw 视图、盘口流动性或完整 TV 外部逐 Fill，不把本地输入称为参考站 golden |

## 8. Simulation Tab

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | Resample/Shuffle 方法及默认 1,000、variation 0、Preserve off | R-DYN Simulation 控件复核 | `simulation-view.ts` controls/defaults | A-E2E `verify_simulation_workspace` + domain tests | PASS | 参考 seed/公式版本变化需重新记录 |
| S-02 | 固定 seed `12648430`、Laplace variation、preserve win/loss | R-DYN 生产 chunk 复核、基线 §G7 | `backtest-simulation.ts` deterministic PRNG/variation | 参考站、本地 PineEngine 与 PineWorkerEngine 非默认 Shuffle/Resample 对账：分别 3,954/21,954 字段零差异；unit/E2E shuffle terminal invariant 及 variation→Tab→Escape 焦点链通过 | PASS（当前参数合同） | 未来参考 chunk seed/公式版本变化时需重新记录；全模块组件/交互及布局适配仍归 UI-08 |
| S-03 | Drawdown threshold 1.5x/2x/3x/custom 与 USD/% | R-DYN | selector/projection + controls | 新同输入4桌面场景148检查含threshold/unit/mode；真实histogram两项tooltip文本与参考一致 | PASS（列明参数/展示） | 其它参数数值沿用S-02明确golden；不是全部未知参考版本承诺 |
| S-04 | Outcome/Open Max DD Histogram/Cumulative 切换 | R-DYN | independent chart mode selectors | 真实同输入30桶及两条31点累计分布、ratio/percent换算；实际模式切换 | PASS（列明图表合同） | 本地可读对比度保留；Net Profit Paths另按A-NONTEXT增加虚实边界、独立图例和区间tooltip/键盘，填充/数值不改，是明确可访问性增强 |
| S-05 | KPI、paths、Outcome、Drawdown、Streaks & Recovery 内容 | R-DYN/计划 §3.8 | `renderSimulationView` full page | `2026-10-07-simulation-components`：两浏览器×两尺寸148/148，7KPI/全部表格/275路径点、tooltip及空open-only状态 | PASS（列明桌面组件） | error/pending/unavailable为本地边界注入，不冒称诱发了原站Worker故障；最终集成按BUILD-01 |
| S-06 | settings dialog：runs/variation/preserve，桌面 Modal | R-DYN | dialog, `aria-modal`, focus isolation | 原生菜单/控件取证、68/68及独立8项保留原时点；最新Simulation永久专项216/216 | PASS（桌面弹窗合同） | 自定义runs列表、两级Esc、键鼠混用、空白关闭和销毁已验；离开Simulation后恢复默认已由S-11对齐，同页更新保留设置；手机Drawer暂缓 |
| S-07 | 移动端 Drawer、safe area、settings focus restore | R-DYN/计划响应式；本地 390×844 约束 | CSS breakpoint + mobile trigger/drawer | 已有 A-E2E geometry/focus 通过记录保留 | DEFERRED（手机专项） | SCOPE-07：不追加手机复刻/safe-area验收；原通过证据不丢弃，不扩大为完整手机适配通过 |
| S-08 | Worker progress/cancel/supersede/failure fallback/cache | 计划G7；参考只观察即时重绘，不公开Worker | Controller Worker runner、bounded cache、sync fallback | 原E2E/unit race；新增真实production Worker 10k及取消/替换/销毁见PF-04/09 | PASS（已列Worker合同） | 性能、资源和冻结生产两小时分别见PF/REL-06；不把已验证范围重列未做，也不扩大为全部设备或未观察故障 |
| S-09 | 控件变化不重跑 Pine、不重订阅 Provider、不写 Storage | R-DYN 无新 backtest/candles | Controller updateSimulation isolates simulation | A-E2E rerun/websocket/market/storage guards | PASS | 扩展到刷新、多个 Cell、Worker 失败场景 |
| S-10 | Simulation no-trades/open-only/pending/error/retry | 完整jP源码：首次同步计算；参数变化保留旧结果，250ms后opacity/aria-busy；Worker error同步fallback；无closed或非法本金显示明确文案 | 本地保留progress、诊断、失败/Retry和未结算门控；empty/本金文案对应参考 | `simulation-reference-tab-state/STATE_CONTRACTS.md`为完整源码合同；本地Simulation专项验证自身状态，P-15的16项仅证明通用Viewer，不冒充Simulation内部 | PASS（调查与列明本地合同） | 未自然诱发参考Worker失败/250ms pending，不将源码分析记成动态通过；本地错误恢复为增强，未复制参考同步fallback全部时序 |
| S-11 | Simulation 同报告设置和结果隔离，跨 Tab 状态 | 原始jI条件挂载jP及真实切Tab试验：离页重建Resample/1000/0 | 离页、close/reopen、更换策略/Cell或destroy按owner取消任务并恢复默认；同Tab/同报告revision保留设置 | Controller61/61；两浏览器6场景216/216，真实Worker计算及迟到消息投递，见simulation-mount-lifecycle | PASS（列明挂载生命周期） | 旧progress/成功/错误不能覆盖新会话；报告间隔离、算法、缓存与Pine运行合同保留。本轮不重跑算法golden，不扩大为全部未知参数组合 |

## 9. Strategy Settings

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| ST-01 | Inputs/Properties 两 tab，Properties 字段和默认值 | R-DYN Settings 复核：capital/qty/pyramiding/commission/slippage/margin | `StrategySettingsPanel` schema-driven form | `tests/strategy-settings.test.mjs` + A-E2E field checks；ST-05 当前12类Inputs控件对照 | PASS（列明字段与控件） | 未来新schema按新增字段验证，不把无限脚本排序排列列为本期阻塞 |
| ST-02 | 本地草稿修改不立即提交；Cancel/close/Esc 不重跑 | 当前参考 eP.commit 立即 onChange；Cancel 逐字段还原并再次 onChange，close/Esc 仅关闭且保留已提交值 | 保留 draft state + close/cancel/Esc；菜单 Escape 优先关闭菜单 | 本地 settings unit/E2E；参考完整AST调用链见simulation-reference-tab-state | PASS（本地草稿事务合同） | 与参考live editor明确不同；网络请求为0不能证明Worker没有重算，不再以旧请求计数声称两者一致 |
| ST-03 | 本地 Reset defaults 只重置当前草稿 | 参考 resetToDefaults 逐字段应用默认值并 onChange，重开时保留最初Cancel快照 | 保留 reset draft implementation | A-E2E reset/合并Apply及ST-05控件回归；参考完整AST | PASS（本地重置合同） | 本地等待Ok才应用，参考立即应用；已验证的本地重置不称参考逐字一致 |
| ST-04 | 本地 Ok 一次批量提交 Inputs/Properties 后重跑 | 参考字段控件先行commit，Ok只close，没有统一Apply事务 | `batchPineSettings`合并两引擎；typed Inputs和Properties一并校验，一次update/重算 | `2026-10-07-settings-schema-completion`：Chromium/Firefox×两真实引擎4/4，实际12类input计算及numeric/bool/enum Properties合并；两浏览器失败/迟到/destroy回归 | PASS（本地桌面提交合同） | 保留批量Apply及draft-only Reset/Cancel安全合同；参考差异已确认，未知引擎参数组合归ENGINE-03，不新增无限脚本阻塞 |
| ST-05 | typed Inputs、min/max/step、日期、精度、单位与原生控件 | 隔离context真实12类型脚本/Run/Settings，无schema替换；原生chunk标记已溯源 | numeric options/time/timeframe override修复；当前12类型/31属性控件，时间保真；26px色块/勾号/共享列/textarea对标 | `2026-10-07-settings-schema-completion`：4/4实际引擎计算、控件CSS/位置断言及两浏览器焦点/数字/下拉/拖拽/Reset/Apply通过；68证据SHA通过 | PASS（本期桌面控件） | 保留volume/31属性/epoch与day-mask/a11y增强；手机与Safari暂缓，VoiceOver单列；不声称任意第三方DTO或全部request.security网络组合已验 |
| ST-06 | Settings 与 report revision/last-good/error 生命周期一致 | 参考 eP.commit→host.onChange→executeIndicator；error 走 indicator:error/toast，宿主无统一 error listener；script:run 仅在 trades resolved 后替换结果，失败 catch 为空 | 本地 combined Apply、last-good、stale success/error、out-of-date、禁 Simulation 与 Retry 是显式安全增强 | 参考最新 chunk 21 个 AST 节点 source contract；本地 Settings schema/controls 与 recovery E2E 已通过 | PASS（参考源合同 + 本地安全增强） | 参考无 Apply 失败弹窗或统一重试对话框；不要为追求字面一致删除本地 last-good/错误可见性 |

## 10. Provider、市场和数据边界

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| PR-01 | Provider 回归 fixture：Binance `BTCUSDT · 1h`（非本期参考 golden） | R-DYN/计划 §1.5 的历史 Provider 基线；本期参考对账改为 `BTCUSDT · 15m · SMA` | Vela Binance provider + market identity mapping；新增本地 24 根 OHLCV/UTC/固定参数 fixture | A-E2E `verify_btcusdt_fixture`（24 bars/24 points、hash 绑定、零外部请求）+ A-PROVIDER live smoke | PARTIAL | Provider/registry 逐笔回归已通过；该 1h fixture 不承担参考站数值验收，当前参考站完整数值以 ENGINE-04/ENG-04a 为准 |
| PR-02 | Binance 历史与 live 连接 | 项目 Provider contract；参考请求为 candles | existing Binance provider | A-PROVIDER `historyBars=5/live=true` | PASS | 5 bars smoke 不等于完整深历史/重连/限流验收 |
| PR-03 | Hyperliquid 历史与 live 连接 | 参考站 source discovery 仅作目录证据；本地功能范围含 Hyperliquid | existing Hyperliquid provider | A-PROVIDER `historyBars=5/live=true` | PASS | 无需把参考站其它 source 误写成本地支持 |
| PR-08 | offline 期间缓存 K 线不得推进 settled 回测报告 | Provider lease 在 offline 时撤销；Vela 仍可能发缓存 `tick/history` | Adapter offline replay fence，保留 last-good revision/ledger，联网后接受新 tick | `tests/e2e_provider_recovery.py --cycles 3`：PineEngine/PineWorkerEngine 6/6；offline revision/status/trades 稳定、恢复后新 socket/ledger 正常 | PASS（本地双引擎场景） | 两数据源两小时及代表 CONNECT 静默恢复已验；本地生产 Workspace 两小时资源长测亦已通过；不承诺所有地区/设备/线上环境 |
| PR-04 | provider/symbol/displaySymbol/timeframe 透传 Header | R-DYN Header；参考 symbol 显示规则需冻结 | `BacktestContext` → UI report fields | controller/viewer contract tests | PARTIAL | `BINANCE.US/BTCUSD` 与本地 `BTCUSDT` 的显示规则需 G0 冻结 |
| PR-05 | 只有市场/策略/参数变化触发 run；Tab/Simulation 不触发 | R-DYN network observation | event/revision guards | A-E2E request counts, simulation no-rerun guard | PASS | 多 Cell、快速切换和 websocket reconnect 计数待补 |
| PR-06 | OHLC 回测 vs tick/lower-timeframe execution | 计划§8.5、TradingView调研及当前ENGINE-03有限合同 | 本地Fork提供四点child回放、calc_on_*因果边界及明确chart-OHLC fallback；1m/5m秒级映射按Provider边界禁用 | ENGINE-03/ENG-05～06的历史精度8/8、风险/entry16/16、跨订单/实时14/14及496字段重放，各自保留原时点 | PASS（本期有限合同） | 不再重复列calc_on_*/复合订单整体未实现；秒级/live明确回退，不新增tick源或完整TV外部逐Fill要求。实际新错误另立反例，不能据本行覆盖所有排列 |
| PR-07 | 历史深度、partial forming、aborted history | 计划§7/§8、DATA-11及REL-01有限合同 | Adapter公开历史coverage和原因，partial/aborted不因ScriptRun.complete而成为完整结果；原请求深度绑定Retry | R-11深历史503/429/timeout/非法JSON及12,500根Retry；当前手势双引擎26/26、缺口6/6、代表CONNECT静默恢复，各自证据见DATA-11/REL-01 | PASS（列明故障/恢复合同） | 行情替身与网络故障注入明确区分，不冒称自然交易所故障；实时/两小时实网另有有限证据，不要求所有地区/窗口通过。脚本错误Retry最新缺陷归REL-07 |

## 11. Storage、Favorite 与现有功能隔离

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| STG-01 | 回测计算结果不持久化；刷新后重新计算 | 计划 §11.2；参考结果由 workspace/session 复用 | Backtest report held in Controller/Store，未写 storage | A-E2E Viewer 前后 snapshot + mutation audit `0/0/0` | PASS | 需补刷新/崩溃恢复确认“重新计算”而非恢复旧结果 |
| STG-02 | Viewer open/close/tab/simulation 不写旧 key | R-DYN tab controls no request；本地独立性合同 | Viewer callbacks no storage calls | A-E2E `assert_storage_unchanged`、mutation audit | PASS | 允许 workspace key 的例外需在完整快照中解释每次变化 |
| STG-03 | `quant-tools:workspace:v2`、脚本、收藏、模板 schema 不变 | 计划§2.3、`BACKTEST_REGRESSION_BASELINE.md` | 独立挂载；旧bars自动迁移500→2000；外部脚本serialize读取live handle Inputs/Properties | `tests/e2e_storage_restoration.py` Chromium/Firefox各三阶段；两次reload key diff=0，脚本/收藏/模板/Editor/Settings均保持 | PASS（当前v2恢复合同） | 仅覆盖现行v2和迁移场景；长期脚本持久化仍待讨论 |
| STG-04 | Favorite 复用既有 FavoriteService，不复制状态 | 用户既有收藏合同，参考 Save strategy 语义另记 | Viewer callback→共享 service，订阅同步后台 Cell；legend 名称与 On chart 一致 | 较早真实生产35项；新增 H-06 两浏览器真实图例/Viewer/list 和 </> 164项联合验证 | PASS（本地状态合同） | 参考账户保存报告并非本地指标收藏；图例完整链已补齐，不再列为缺少证据 |
| STG-05 | Pine editor / personal scripts / templates / screenshot 不受影响 | 计划 §2.3、回归基线 | feature composition boundary，不接管这些模块 | A-E2E existing toolbar/editor/template/screenshot smoke | PARTIAL | 仍缺逐按钮次数、完整 DOM snapshot 和视觉 diff |
| STG-06 | Settings Inputs/Properties 由 Vela workspace state 管理 | R-DYN settings；计划§11.2 | control adapter提交后通知active cell stateChanged；报告运行时态 | control adapter定向11/11；真实旧Workspace两浏览器两次刷新后Inputs/Properties与报告保持 | PASS（当前恢复合同） | storage不可用按会话内存降级；长期持久化待讨论 |

## 12. Lifecycle、并发和故障隔离

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| LC-01 | `createApp → destroy → createApp` 不重复 DOM/监听/Worker | 计划 §5.4/§11.4 | unified `destroy()`、feature cleanup、idempotent guards | 主E2E开发7/7/1；`audit-evidence/2026-10-07-runtime-lifecycle/`：真实composition root生产宿主20次挂载/销毁，Worker/Socket/Observer/RAF/blob/canvas/dialog/host资源逐次归零，553源码/探针SHA稳定 | PASS（列明生产/开发生命周期） | 市场传输为受控输入，应用/Pine Worker真实；不再用旧production debug=null断言没有资源证据。两小时真实Workspace另见REL-06冻结构建，未声明全部浏览器/设备无泄漏 |
| LC-02 | Viewer/Highcharts销毁/重入不留实例 | 计划§5.4；PERF-01有限资源合同 | 图表清理、generation guard和失败构造释放 | 新独立生产10k/100k、Chromium/Firefox×DPR1/2，10次开关/异常构造/销毁资源通过；Chromium retained heap +0.30–0.34MiB | PASS（列明生命周期） | Firefox精确heap API不可用，不记为0；冻结源批次不自动覆盖后续UI改动，REL-06另保留 |
| LC-03 | stale run/ledger/full series 不得覆盖新 revision | 计划 §7.4、G4b.2 | key/revision/runId/snapshotRevision/epoch checks | adapter/controller tests: run restart, stale full, full+tail, sync pending；ENGINE-03审计与曲线重放 | PASS（本期身份合同） | 单包原子传输尚未实现，但不属于已冻结有限合同的额外关闭条件；未来扩大capability时另立验收，不重开当前UI |
| LC-04 | `run.trades()` 延迟/reject/complete=false/旧 Cell 清理 | 计划 §7.4/§13.2 | single-flight/desiredRevision/cancellation/last-good | adapter/controller targeted tests | PASS | 需浏览器注入真实 worker/provider 延迟并记录请求计数 |
| LC-05 | 多 Cell/多策略隔离，后台结果不抢当前 Dock | 计划 §6/§7 | key=`cellId+indicatorId`，active-cell selection guard | `backtest-multicell-contract.test.mjs` + `npm run test:e2e:multicell`：2×2 fixture、后台 snapshot/error/late、stale revision/epoch、同 Cell 删除和空 Dock、destroy 资源回零 | PARTIAL | 浏览器状态/资源隔离已通过；完整应用多策略真实 Provider/Worker 长时与参考视觉差分仍待 |
| LC-06 | strategy→indicator、hide/show、remove 清理结果 | 计划事件表 | BacktestFeature event handlers and status transitions | adapter/controller tests + core E2E remove/hide smoke | PARTIAL | 缺所有事件的逐事件 trace、Provider/Worker/listener 计数 |
| LC-07 | 回测/报告/Simulation/定位失败只降级回测区域 | 计划§2.3/§11.3、G9 | guarded diagnostics、Retry/error view和应用挂载隔离；定位失败toast且保持其它工作区状态 | Chromium/Firefox × none/getter/methods/quota共8场景、198项通过；真实Worker、Settings、四Tab、TradesLog定位throw/恢复，页面错误与非法请求0 | PASS（列明故障隔离合同） | 存储故障按会话内存降级，不承诺刷新后持久化；未注入自然故障按各自Provider/Worker合同 |
| LC-08 | HMR/重复销毁/刷新后无残留 | 计划G9；当前REL-06有限合同 | destroy幂等；CSS HMR保留页面/Settings，main模块按原设计整页刷新并恢复策略 | `audit-evidence/2026-10-07-runtime-lifecycle/`：真实Vite更新3次、开发6次挂载销毁；主入口刷新关闭旧Worker且单一host/action；生产20次挂载销毁资源归零 | PASS（列明HMR/刷新合同） | 通过watcher事件触发真实Vite更新，不称操作系统文件监听已验；开发3条已处理取消日志保留。生产两小时另见REL-06，不把不同批次合成最新源码全设备长测 |
| LC-09 | live tick 只传尾点；不重复拉完整 ledger | 计划 §7.4/G4b.2 | reportTail + revision-aware ledger refresh | adapter race contracts; E2E market request guard | PARTIAL | 缺长时高频 tick、ledger request count和内存 trace |

## 13. 独立运行和本地依赖

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| I-01 | 运行时不请求 `app.luxalgo.com` 或其子域 | R-DYN URL 仅作为观察边界；计划要求替代 | 应用只用本地 Vela/PineTS +本地 Provider | A-E2E dev/prod `luxalgoRequests=0` | PASS | 保持 catch-all 守卫，禁止未来引入远程 chunk |
| I-02 | 不依赖未声明外部 HTTP(S)、CDN、远程字体/图标 | 计划§1.4/§10/§12；当前REL-04 | Highcharts本地chunk；SVG icons本地；仅登记Provider访问行情 | 开发/生产E2E非法外部请求0、`check:dist:independence`禁止项/静态外链0、`test:e2e:offline`登记Provider阻断且unexpected/LuxAlgo=0；fresh clone构建，旧6文件为历史产物计数 | PASS（列明运行独立性合同） | 证明应用不依赖参考站/未登记服务，不承诺断网且无缓存时仍能取得行情；无行情状态按数据/UI合同验证。线上rollback按SCOPE-01为DEFERRED，不再作为本行阻塞 |
| I-03 | Highcharts 精确 13.0.0、本地按需加载、无 CDN | R-HTML Highcharts 13.0.0；计划 §3.5/G9 | root dependency `13.0.0`，local renderer/chunks | `check:dependencies`、build、E2E local chart hosts | PASS | 补产物 hash 和断网加载证据 |
| I-04 | PineTS/Vela-PineTS 使用本地源码版本和 Worker fingerprint | 计划 §9；engine audit | `packages/pinets`、`packages/vela-pinets` workspace/file deps，当前 `quant-tools-g8.1` / `reportSchemaVersion=4` | A-DEP fingerprint/sentinel、Vela-PineTS tests | PASS | 当前未改源码包与 registry 固定 fixture 逐笔一致仍未证明 |
| I-05 | Fresh clone、删除 Fork dist/node_modules/cache 后可复现构建 | 计划 §9.7/G9 | build scripts/prebuild 已存在 | `44ade5c` 临时 fresh clone：空 `node_modules`/Fork `dist` 执行 `npm ci`、`npm run build`、根 `npm test`，构建后 Git clean | PASS | 继续在发布候选 commit 上重复；不替代跨浏览器/回滚演练 |
| I-06 | 不复制参考 HTML、Next chunk、Cookie、账户状态 | 计划 §1.2/用户独立运行要求 | 上传HTML/参考采集留本地忽略证据，不作为应用资产 | `check:dist:independence`禁止reference host/Next/storage-state/cookie/email，0 matches；E2E storage 0/0/0；2026-10-07新增应用/双fork源码、入口、构建配置/工具/CI及必需fixture共624文件脱敏扫描，无public目录；20处命中均为CI环境引用、许可证/元数据或检测脚本规则，运行源码无参考资产/认证材料命中；输入与归档SHA-256复核通过，详见本地忽略证据`audit-evidence/2026-10-07-source-independence-scan/README.md` | PASS（声明源码与产物范围） | 有限源码内容扫描与既有产物/运行独立性证据共同关闭本行；不把repository hygiene等同内容审计，也不外推为全依赖安全审计、视觉资产来源证明或未来代码保证。真实线上rollback按SCOPE-01为DEFERRED，与参考资产扫描分开 |
| I-07 | registry 包与本地 Fork 零行为变更对账 | 计划 G4a/G9 | 本地 Fork 已有修改；固定 fixture 内置一次性 `pinets@0.9.34` registry baseline | `npm run test:fixture:btcusdt` 2/2：3 笔交易、summary、24 点 reportSeries 与离线 baseline 对账；canonical fixture/report hash 已锁定 | PARTIAL | registry baseline 是一次性离线保存的可审计 artifact，仍需在更广错误/复杂成交样本上扩展；不能据此宣称整个 Fork 零行为变更 |
| I-08 | fork upstream SHA、local patch、schema、embedded SHA 一致 | 计划 §9.4 | build-info/fingerprint/sentinel contracts | `npm run check:dependencies` PASS（记录于基线） | PASS | 每次 Fork 改动继续把 fingerprint 写入 report 并重跑 |
| I-09 | 应用只从 package exports 导入，不深度导入 packages/src | 计划 §9.4/§13.7 | 当前 imports 走包 exports | architecture/dependency contract tests | PASS | 加静态扫描防止后续回归 |

## 14. Desktop / Tablet / Mobile 响应式

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| RSP-01 | 桌面 Dock/Viewer 本地布局及组件对标 | R-DOCK 原组件同宽对照，不包含 AI/banner | 垂直 Dock、容器图表、本地 Viewer 布局，无参考宿主占位 | R-DOCK 两宽度、A-DOCK 四宿主、主 E2E；RSP-07 Viewer 矩阵保留各自时点 | PASS（列明桌面组件） | 不要求整页坐标相等；共享交互差异逐项记录，不扩大为全 UI 状态通过 |
| RSP-02 | 1024px 完整 Dock 与 1023px 紧凑入口 | R-DYN 断点观察；本地组件合同 | Workbench 断点、保留高度与 Viewer 入口 | 主 E2E、A-DOCK 1024；较早两浏览器 DPR1/2 的 1024/1023 四 Tab/Settings | PASS（断点可达性） | 保留边界回归，参考宿主宽度不直接成为本地整页约束 |
| RSP-03 | 桌面窄窗口提供 Chart + Backtest 入口，宽屏显示 Dock | R-DYN 紧凑入口，手机专项另行暂缓 | `<=1023px` 隐藏 Dock 和高度预留，共用 Viewer 生命周期 | 主 E2E compact 入口；RSP-07 覆盖 1920 至 720 及短高窗口，A-DOCK 嵌入宿主 clamp | PASS（列明桌面入口） | 手机触摸/实机不由本行恢复为阻塞；不预留 AI/banner |
| RSP-04 | Simulation 移动 Drawer、safe-area、焦点 | 参考组件交互对标 | local 390px drawer/mobile settings controls | 已有 A-E2E mobile geometry/focus assertions 保留 | DEFERRED | SCOPE-07：手机适配和手机专项不作为本期阻塞；桌面弹窗/键盘仍按 S-06 和 AX 验收 |
| RSP-05 | Calendar窄屏七列、金额可读和完整值可达 | 新参考14/12px组件字号；用户明确不复制跨格溢出 | container query、紧凑数字/标签、单位换行；真实日期按钮显示完整日值并关闭回焦点 | 18组1440/390/360×三浏览器×DPR1/2，另含280px嵌入容器及11金额边界；2,610联合断言，源码稳定 | PASS（列明容器与交互） | 已断言数字/符号/非零含义和完整值入口；桌面缩放继续UI-10，手机真机/横屏按SCOPE-07暂缓，不将模拟结果称真机通过 |
| RSP-06 | Dock KPI/table 横向滚动和操作可达 | 原缺陷与 R-DOCK 组件结构 | 独立可聚焦 KPI strip、低高度隐藏 chart/axes、保留 Header 入口 | A-DOCK 两浏览器四宿主含 104/190/230/280 与 KPI 滚动/控制；已有 Viewer 列表响应式证据 | PASS（桌面有限合同） | 无需重复将已关闭 V-07 列为未验；手机触摸按 SCOPE-07 暂缓 |
| RSP-07 | 桌面窗口1920/1440/1280/1024/1023/900/720、短高及DPR1/2 | 当前本项目布局合同；手机矩阵按SCOPE-07暂缓 | 本地容器breakpoints，不预留AI/banner | Chromium/Firefox×8尺寸×DPR1/2，32场景/1,792项通过；页面溢出、Tabs/ARIA、内容/控件可达、target-size均验 | PASS（列明桌面布局） | 720×450/DPR2为200%等效布局，不冒称真实zoom菜单；之后仅Preserve局部CSS补丁，另经84项及生产E2E验证。手机390/360横竖屏为可选，不使用整页像素门槛 |

## 15. Accessibility 与不可见语义

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| AX-01 | Viewer tabs 使用 tablist/tab/tabpanel，支持 arrows/Home/End | 计划 §10.4；参考静态 tab 无完整 ARIA | local roles, aria-selected/controls, keyboard handler | A-E2E selected/label checks、viewer contract | PASS | 需要键盘-only 全路径录制，不只 selected 属性 |
| AX-02 | Dock separator/collapse 有 truthful ARIA | 计划 §10.4 | separator value attrs、collapse controls/expanded | A-DOCK 两浏览器 632 项含实际 separator 按键、clamp、焦点和 ARIA 检查 | PASS | 屏幕阅读器实际朗读仍归桌面 VoiceOver/AX 范围，不用 DOM 或键盘自动化替代读屏验收 |
| AX-03 | Viewer open 时 background inert/aria-hidden，关闭原子恢复 | 计划 §10.4、local feature comments | chart suppression MutationObserver、simulation modal isolation | A-E2E modal isolation/restore | PASS | 扩展到 Viewer（非 Simulation）全页面和 Vela menu/focus tree |
| AX-04 | 表格 caption/scope/aria-sort、Calendar grid semantics | 计划 §10.4 | table semantics, calendar row/gridcell, sort attrs | A-E2E table/calendar ARIA + unit contracts；strict visual/a11y desktop/laptop 四图及 axe 检查 | PASS | 自动化范围已验；实体读屏和未覆盖的动态公告仍按 AX-06/AX-08 单独验收 |
| AX-05 | 图表有可读描述/数据表，不只靠红绿 | 计划 §10.4 | SVG fallback/`desc`/aria-label/manual descriptions；Simulation区间虚实轮廓/图例及low-high可访问 | A-E2E Simulation/Analysis SVG description checks；Summary/Dock键盘176项，A-NONTEXT区间两浏览器完整68点及正式144项 | PARTIAL（完整辅助技术） | 已修已验的区间/曲线键盘不重列待做；完整读屏、其它未覆盖图形和实际VoiceOver仍独立验收，不把有限图形证据扩大为全图表通过 |
| AX-06 | Loading/result/error live region 与 focus recovery | 计划 §10.4 | Viewer transient states now use atomic `role=status`/`aria-live=polite` and `role=alert` for errors; status/error/retry and simulation focus restoration | `tests/backtest-viewer-contract.test.mjs` live-region contract + A-E2E Simulation progress/focus | PARTIAL | 仍需浏览器真实 announcement trace、production/跨浏览器状态差分；实体屏幕阅读器仍待验，SCOPE-03 仅暂缓 Safari 专项 |
| AX-07 | WCAG 2.2 AA、axe critical/serious=0 | 计划§10.4 executable threshold | 本地axe-core 4.10.3及ARIA/对比度检查；真实生产入口另有状态探针 | 本地strict visual四视口axe通过；最新生产桌面/手机32状态已验，真实Pine/Simulation Worker、page/window错误及blocked0，证据production-a11y-ui-adapt | PARTIAL（完整无障碍） | 已列生产范围不再记待验；保留axe incomplete，不将自动化或局部文字对比度通过扩大为VoiceOver/真机或全量参考差分。SCOPE-03仅暂缓Safari专项 |
| AX-08 | Chromium + macOS VoiceOver smoke | 计划 §10.4 | 语义大部分已实现 | 尚无完整实体 VoiceOver 操作证据 | BLOCKED | 需可用读屏环境；Safari 专项暂缓不能视为 VoiceOver 被取消 |
| AX-09 | reduced-motion、focus visible、桌面target-size/对比度 | 计划 §10.3/10.4 | CSS reduced-motion、focus-visible、扩大部分按钮；必要边界与装饰分隔线分开 | visual/桌面responsive与文字对比度；A-NONTEXT两浏览器实像20项：Calendar/控件focus3.692、Settings默认边界4.165；实际键盘16项 | PARTIAL（完整无障碍） | 列明的控件/焦点已修已验，未覆盖图形与桌面读屏另验；手机hit area/触摸实机按SCOPE-07暂缓，不把有限非文字验证扩大为全无障碍通过 |
| AX-10 | 不复制参考重复 ID、空 aria-label、隐藏元素可聚焦缺陷 | 计划 §10.4 | local IDs/hidden filtering/focusable helper | `npm run test:visual:a11y` 四 viewport duplicate-id/unnamed/ARIA reference scan = 0 | PARTIAL | 全 Viewer/Dock axe + hidden/focus tree 和屏幕阅读器证据 |
| AX-11 | Strategy Settings 实际Tab顺序、Escape与模态焦点 | 本地aria-modal合同 | inert/互斥已生效，Tab trap、触发按钮回收和宿主 fallback 已实现 | `audit-evidence/2026-10-01-r09-recheck-3/pointer-keyboard-workbench-rerun.json`、`settings-tab/results.json`、`gates/e2e.status.json`；三浏览器 modal/traversal 专用探针 | PASS（当前契约） | Workbench pointer-open、keyboard Enter、Cancel 回 Settings 触发按钮；报告移除回图表 Canvas。桌面VoiceOver待验；Safari专项按SCOPE-03、手机实机触摸按SCOPE-07暂缓 |

## 16. Performance、资源和可扩展性

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| PF-01 | 聚合O(trades+buckets)，每report/options memoize | 计划§11.1固定Chromium基准 | 仅factory-owned immutable图谱缓存；mutable/shallow-frozen仍重算，时区/epsilon/period隔离 | 独立生产DPR1/2、Chromium/Firefox，共8个含完整duration的冷selector场景；固定Chromium10k/100k p95=52.2/399.9ms；CPU trace和76/76定向回归 | PASS（固定预算） | Firefox100k=656/589ms超过Chromium对照值；100k factory最慢约1.14s另列，不用0–1ms缓存命中代替冷测，不声称端到端500ms |
| PF-02 | Trades Log大账本有界分页 | 计划§11.1固定Chromium基准 | 200行分页、稳定pager/tabpanel/ARIA/focus，保留sourceIndex与定位 | 同一生产矩阵固定Chromium分页p95=41.4/42.2ms；三浏览器Log交互矩阵另外覆盖501行 | PASS（固定预算及列明功能） | Firefox10k/DPR1分页124ms超过Chromium对照值；不扩大为全浏览器同预算或新增连续虚拟滚动需求 |
| PF-03 | 大曲线降采样、range极值与原始多series tooltip | 计划§11.1 | 2,000点上限，端点/极值保留，原始序列二分查找 | 生产Chromium/Firefox×DPR1/2×10k/100k，真实shared Median/5–95% tooltip、range extrema和几何更新通过；trace留档 | PASS（列明性能/功能） | 参考全状态视觉归UI-08，不将同功能证明扩大为所有数据或所有设备 |
| PF-04 | Simulation 1k/10k Worker/cancel/progress | 计划§11.1/G7 | 真实production module Worker和progress/cancel/supersede/destroy | 10k runs 371–917ms；progress至少100/10k后触发取消/替换/销毁，0–1ms内settle，替换1000结果，迟到/残留均0 | PASS（列明生命周期） | 0–1ms为浏览器计时分辨率；DPR2批次Worker非绘图页仍为普通DPR1，不伪称改变计算DPR |
| PF-05 | Dock拖拽≥50FPS、长任务p95≤50ms | 计划§11.1固定Chromium预算 | reflow/observer布局去重 | 独立生产Chromium DPR1/2拖拽60.2–60.3FPS、观测长任务0；Firefox58.4–60.2FPS | PASS（固定预算） | Firefox无相同long-task API，不记成0；未声明真机/所有窗口性能SLA，截图组件差分归UI-08 |
| PF-06 | 十次开关heap增量≤20MiB、销毁Chart/Observer=0 | 计划§11.1固定Chromium预算 | destroy/generation guards和资源计数 | 独立生产大账本矩阵Chromium retained heap +0.30–0.34MiB；CPU/heap snapshot，最终Chart/Observer=0；Firefox资源计数清理通过 | PASS（固定预算及可观测资源） | Firefox精确JS heap API不可用，未冒充观测零；REL-06长测复用冻结构建，不扩大为后续源码或所有设备 |
| PF-07 | 当前生产 bundle 的分组 raw/gzip 预算 | BUILD-02；`scripts/check-bundle-size.mjs` | main、Worker、Highcharts 分组预算已建立，旧新增 ≤100KB gzip 不再作为当前阈值 | 最近生产构建及 `check:bundle-size` 已通过；最终业务改动后随 BUILD-01 重跑 | PASS（当前预算合同） | 预算分别为 main 1,950,000/520,000 B、Worker 900,000/240,000 B、Highcharts 450,000/160,000 B；保留 Vite 大 chunk 提示，不以警告推断尚未建立预算 |
| PF-08 | Tab/Simulation 不重复完整 ledger/request | R-DYN no new backtest-run/candles | selector/cache/single-flight | A-E2E request guard; adapter race tests | PASS | 补多策略/live 高频和 network waterfall |
| PF-09 | Highcharts/Observer/Worker隐藏/销毁与异常构造清理 | 计划§5.4/§11.1；PERF-01 | explicit destroy/terminate与generation guard | 独立生产Chromium/Firefox大账本8场景，early/failed chart construction、10次开关及真实Worker迟到/取消清理通过；window error/rejection/pageerror均空 | PASS（列明资源合同） | HMR、REL-06和三浏览器fixture各保留时点；不将冻结生产SHA扩展到随后Calendar/Performance/Header修改 |
| PF-10 | 浏览器运行期功能与性能适用范围 | 计划G9固定浏览器基准；跨浏览器功能另验 | 现有三浏览器真实引擎fixture；新增生产Chromium/Firefox大账本DPR1/2 | 生产矩阵8场景无开发模块/外部请求/页面错误；Settings/Performance三浏览器、Log/Calendar18场景另列 | PASS（列明运行期覆盖） | 仅Chromium DPR1承担既定预算；Firefox超出观察值保留，未建立WebKit性能/全设备SLA。完整UI、Provider和VoiceOver不由本行关闭 |

## 17. 引擎、数值和最终独立性 Gate

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| ENG-01 | Summary/Performance/Analysis/Simulation 使用命名人口，不强行统一分母 | 新窗口参考Summary 96/277但Trades276；本地Summary96/276，Analysis另用含open的277行 | domain selectors明确closed/open/analysis/simulation人口；保留本地可复算规则 | domain/controller回归、ui-actual-chain与reference-formulas；固定账本280行/2,520字段另由ENG-04a通过 | PARTIAL（明确展示人口差异） | 不再缺固定BTC逐字段golden；页面分母差异如实保留，不以改原始账本或把未知值填0消除 |
| ENG-02 | close mark-to-market equity/drawdown/benchmark exact series | 计划 G4b.2 contract（参考页面本身不公开内部 series） | local PineTS/Vela-PineTS reportSeries/reportTail | adapter/Worker/in-process tests + E2E exact-equity | PASS | 仅表示本地契约已验证；不表示与参考站数值一致 |
| ENG-03 | currency、max contracts、entry/exit bar index bridge | 参考 UI 无独立可见字段；engine audit | G4b.3 bridge + capability validation（当前 Fork 身份升级为 G8.1/schema 4）；raw audit relation 由独立 `auditLedger` capability 管理 | Vela-PineTS `27 files / 261 tests`、G4b.3 targeted bridge tests、controller/domain tests | PASS | raw capability 不由本行扩大；缺失/过期 audit envelope 仍 false，边界见 `BACKTEST_LEDGER_AUDIT.md`（本地忽略证据，公开仓库不携带） |
| ENG-04 | 历史 BTCUSDT/1h fixture 的参考对账 | 历史计划 G0/DoD；不是用户后来冻结的 BTCUSDT/15m/SMA 窗口 | 固定 UTC/24 bars/Pine source/parameters；应用层真实执行并输出 3 笔 ledger | package fixture 及本地/registry 回归保留 | OUT OF SCOPE（参考对账） | 按需求表 ENGINE-06，1h 参考 golden 不重入本期阻塞；本地既有回归仍维护。当前固定窗口数值见 ENG-04a，页面差异另归 UI |
| ENG-04a | LuxAlgo BTCUSDT/15m 5,000 bars 上的 SMA 9/21 有限对账 | 2026-10-06 新窗口完整 Trades Log 与 Summary/Simulation 输入 | 当前 Node、Chromium PineEngine/PineWorkerEngine 使用同一完整输入，280 closed/open rows 均可归一化；2026-10-07 以当前构建 fresh replay 重算仍为 280/280 | `audit-evidence/2026-10-07-reference-parity-rerun/comparison.json`：280/280、2,520 fields、13 scalars、differenceCount=0、pass=true | PASS（当前输入窗口） | 输入和证据在忽略目录；更换 source/行情/参数需重跑；不扩展为 TradingView 全复杂撮合或完整组件/交互 PASS |
| ENG-05 | raw order/fill、reversal relation、partial close/pyramiding | 计划 G4b/G6/G8；当前 ENGINE-03 有限合同 | identity-bound auditLedger、费用分摊、风险平仓及 margin 审计已实现；margin order/fill/parent 缺失已修，旧差异证据保留 | 桥接310/310、引擎offline1773+1；实际双引擎风险/entry16/16、跨订单/实时回滚14/14，归档305+191=496字段零差异 | PASS（本期有限合同） | 后续新反例继续修；不增加全排列、外部TV逐Fill或参考没有的raw UI。部分平仓不等于盘口流动性 |
| ENG-06 | Bar Magnifier/低周期撮合及 applied precision | 计划 §8.5；TV 调研；当前 ENGINE-02/03 合同 | 默认父OHLC、Properties低周期开关、四点路径/重算因果边界及明确覆盖率/fallback；跨订单时间序和live closeTime已修 | 双真实引擎历史精度8/8、风险/entry16/16、跨订单/实时14/14、完整输入离线重放496字段及最终产物SMA零差异 | PASS（本期有限合同） | 833/2,000覆盖率、forming/asOf及未来边界已验；不能将seconds/live fallback叫实际高精度。全模块参考UI另归UI-08，真实tick/外部TV逐Fill不作为条件 |
| ENG-07 | Simulation 固定 seed 逐值与参考一致 | 参考 chunk seed `12648430`；本地实现同 seed | deterministic PRNG/formulas | 参考站、本地 PineEngine 与 PineWorkerEngine 的非默认 Shuffle/Resample 输入与结果分别 3,954/21,954 字段零差异；variation=0 分布隐藏、Drawdown/tooltip/focus 链通过 | PASS（当前参数合同） | 其它 closed ledger、seed 或参考 chunk 版本变化时需重新生成逐 run/percentile 对账；完整视觉仍归 UI-08 |
| ENG-08 | 参考站/远程资源完全不是运行依赖 | R-DYN 网络仅观察；计划独立运行硬标准 | local Vela/PineTS/Provider/Highcharts | dev/prod LuxAlgo=0、blocked external=0；最终产物扫描、fresh clone 构建和 `test:e2e:offline` 通过（Provider 请求仅计数/阻断） | PASS | 真实上一制品 rollback 与无行情缓存行为仍需单独验证 |
| ENG-09 | `max_intraday_loss`、`max_intraday_filled_orders`、`max_cons_loss_days` 风险规则按交易所日切换 | Pine 风险语义；当前 ENGINE-03 合同 | 日内权益峰值、交易所日边界、撤单/费用/平仓、永久与日内熔断、live rollback已修；禁止entry方向仅平仓、仓位上限缩量及strategy.order归属已验 | 独立经济预期、桥接/引擎回归、风险/entry浏览器16/16和实时回滚2/2；margin+risk归档305字段重放一致 | PASS（本期有限合同） | 不声明tick/盘口精度或完整TV逐事件对账；实际新缺陷按新反例登记 |
| ENG-10 | Pine bare `error()` runtime failure | Pine runtime error contract；参考站不公开实现细节 | Core bare built-in throws typed `PineRuntimeError`; Adapter creates first strategy error entries, fences late context, and Retry reexecutes current inputs | Core error2/2、Adapter32/32、相关Controller/History121/121；真实Pine/PineWorker四场景/64项通过 | PASS（列明双引擎错误合同） | 真实脚本错误、首次失败、旧报告不复活和修复后恢复均已验证；其它运行时错误组合继续按各自合同回归 |

## 18. 现有功能非回归与发布回滚

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| NR-01 | 顶部工具栏按钮只注册一份、无重复点击/面板 | 计划 §2.3/§11.4；参考工具栏为宿主能力 | Backtest feature composition boundary，不修改 `main.ts` 工具动作 | A-OLD 22/22 + core E2E toolbar smoke | PARTIAL | 缺每个按钮点击次数、DOM snapshot、视觉 diff |
| NR-02 | Indicators 分类/收藏/On chart/个人脚本保持 | 计划既有功能合同；用户统一收藏要求 | 共用FavoriteService；图例与代码入口按实际Workspace实例解析名称，source key/savedName保持 | A-OLD/E2E分类/脚本smoke；真实Worker图例→Viewer→Favorites双向及</>标题/源码164项；旧Workspace恢复两浏览器三阶段保持脚本/收藏/模板及key diff=0 | PASS（当前恢复合同） | 参考账户保存报告与本地统一收藏明确不同；长期脚本持久化产品方案仍待讨论 |
| NR-03 | Pine editor、模板、布局、截图保持 | 计划既有功能合同 | 独立 BacktestFeature host/cleanup | A-OLD/E2E partial smoke | PARTIAL | 需要故障注入后逐项确认仍可用 |
| NR-04 | Provider路由、OHLCV和订阅生命周期不因报告交互回归 | 计划§11.4；后续DATA-11明确授权连续性/重试修复 | Backtest读取Adapter；Provider分页/切周期按当前需求保护，不承诺所有历史内部实现不变 | 主E2E请求守卫、DATA-11多Cell/真实OHLC、REL-01两数据源各两小时socket平衡关闭与静默恢复 | PASS（列明非回归合同） | 原先泛称缺订阅/重连证据已由后续专项补齐；记录实际source/代理环境，不把有限多Cell与单市场长测合称全排列实网验证 |
| NR-05 | Backtest host/adapter/render/worker 出错不阻断旧 Workspace | 计划G9 failure isolation | guarded construction/diagnose/retry；定位错误显示toast并可重新打开Viewer | storage/定位四模式×双浏览器8/8、198/198通过；市场/范围/Inputs/Properties/收藏/报告/Worker保持，错误清除后键盘定位恢复 | PASS（列明本地故障合同） | 仅覆盖明确注入的storage getter/method/quota与chart-locate throw；线上、未知设备和未注入自然故障不由此承诺 |
| NR-06 | feature flag/kill switch 与发布回滚不改写旧 Workspace | 计划§12.4/G9；当前SCOPE-01 | composition root的`VITE_ENABLE_BACKTESTING` opt-out关闭回测host/订阅；发布回滚流程文档保留 | `npm run test:e2e:kill-switch`：production preview回测子树/动态host=0，旧工具栏/Indicators/Pine editor/Templates可用，Workspace字节不变，blocked/LuxAlgo=0/0；`BACKTEST_RELEASE_ROLLBACK.md`列manifest流程 | PASS（本地kill switch）；DEFERRED（线上rollback） | 上一线上制品hash、部署切回、CDN/browser cache和回滚后的schema恢复，待目标环境恢复该任务时验收；未执行不写PASS，也不阻塞当前。日常旧Workspace恢复继续归STG-03/06，不随线上任务取消 |
| NR-07 | 验证顺序：先原有回归，再新增测试 | 计划§0/§12.0 | 文档规定固定顺序 | 最新根627/627、类型/构建、dev/prod E2E、生产32状态及普通strict visual通过；8图diff0，5类ring负控拒绝且原阈值不变。616/624仅历史时点 | PASS（已执行顺序） | 不是整体发布通过；每个后续commit保留时间、环境、完整输出和工作树状态 |

## 19. 历史阶段状态汇总与下一步 Gate（当前状态见顶部最新独立复查）

### 19.0 2026-09-28 历史批次证据补充

本批次新增并复核：

- Provider network/history contracts：`tests/provider-network.test.mjs` 与
  `src/integrations/vela/provider-history.test.mjs` 各 `8/8`（合计 `16/16`）；覆盖 Binance/
  Hyperliquid timeout/retry、点范围、inclusive 边界、排序/去重/limit、OHLCV 归一和默认远程
  icon 关闭均有离线证据。
- Raw lifecycle bridge：根 `npm test` `219/219`；adapter/domain/controller 定向 `63/63`；
  Vela-PineTS raw-ledger/context/Worker 定向 `47/47`。这只证明本地 Fork 的 identity-bound
  envelope 可安全传输和降级，不等于 TradingView 逐 Fill parity。
- LC-05 多 Cell：`npm run test:e2e:multicell` 通过，2×2 fixture 中初始 6 个报告，销毁后
  `activeCharts/activeObservers=0/0`、Workbench/图表 DOM 为 0、Storage 写入/删除/清空为
  `0/0/0`、Provider request 在 destroy 后不增长、blocked/page/HMR/WebSocket 均为 0；合同测试 `1/1`。
- 当前代码级门禁：既有回归 `22/22`、根 TypeScript、dependency contract 和生产构建通过。

上述历史证据不覆盖 DATA-11 或完整参考视觉/交互；固定数值窗口状态见 ENGINE-04。开发 HMR 与生产长生命周期分别验收，VoiceOver/真实设备仍未验；Safari 专项、线上部署/CDN/rollback 按 SCOPE-03/SCOPE-01 暂缓。

### 19.1 可以暂时视为局部通过的能力

- 本地 Dock/Viewer/四 Tab/Simulation 的主要 DOM 入口和状态机已存在。
- 现有回归、当前根测试记录、TypeScript、依赖 fingerprint、构建、开发/生产 E2E、Binance/Hyperliquid smoke 已有证据。
- Viewer/Simulation 的请求、Storage 和部分生命周期守卫已通过；运行时没有观察到 LuxAlgo 请求。
- Trades Analysis 的结构、Trades Log 的当前列/排序、Calendar 聚合和 Simulation 应用层合同已有较完整的单测与 E2E。

这些结论只能用于对应行，不得向“完整一比一”外推。

### 19.2 历史批次的阻断项目（已被当前需求表取代）

以下为当时缺口，不能直接加入当前执行队列。1h 参考 golden 已移出当前范围，完整 TV 外部逐 Fill 不是当前关闭条件；现行 UI、复杂撮合和非回归缺口见需求表，不能仅凭下方旧清单重开任务。

1. 固定 Binance BTCUSDT/1h fixture 与参考站的逐笔、汇总和最终截图对账（本地/registry 对账已通过）。
2. Performance 非空 benchmark、精度/单位，尤其 `Strategy Outperformance` 的参考证据。
3. Entry/Exit 精确 bar/marker 定位，以及 reversal/partial-close/pyramiding/raw fill relation。
4. Bar Magnifier 的完整 TradingView 低周期/逐 Fill 语义和 applied precision 对账（第一版四点回放/fallback 已接入）。
5. Desktop/mobile 参考差分；本地 mobile 与参考站约 900px 以下行为目前存在未决分歧。
6. 完整视觉 diff、production axe/WCAG、keyboard-only，以及完整应用而非 fixture 的跨浏览器证据。
7. 10k/100k 数据、虚拟列表/downsample、拖拽 FPS、heap/实例资源计数。
8. 生产 destroy/remount、故障注入全矩阵、feature flag（测试 fixture 的无 HMR smoke 已通过）。
9. 最终产物无远程/参考资源静态扫描、fresh clone/清缓存构建和生产断网壳 smoke 已通过；线上 rollback 按用户要求移出当前范围。

### 19.3 历史阶段的执行顺序（当前见需求表）

```text
G0 冻结 BTCUSDT/1h + 参考截图/DOM/请求
  ↓
固定 fixture 逐笔对账（先 registry/local，再 reference/local）
  ↓
补 chart focus、复杂成交、Bar Magnifier 完整语义/逐 Fill（G8）
  ↓
  Desktop/mobile visual diff + a11y/keyboard
  ↓
10k/100k、虚拟化、downsample、FPS、heap/实例计数
  ↓
故障注入 + HMR + rollback + fresh clone/offline artifact
  ↓
按 12.0 顺序重跑所有旧回归和新增测试，逐行将证据补回本矩阵
```

每次将一行从 PARTIAL/BLOCKED 改为 PASS，必须在同一提交中补充对应 artifact 路径、命令、环境（浏览器/viewport/DPR/locale/timezone）、结果摘要和 reviewer；不允许只改状态文字。

### 19.4 2026-09-28 续跑：Trades Log 有界渲染与真实门禁

`ec420b4` 只优化 Trades Log 的单页 DOM 构造，不改变报告字段、排序和定位语义。根测试
`238/238`、视觉/a11y 四 viewport、Chromium/Firefox/WebKit、生产 E2E 和 10k/100k 性能门禁均通过。
这使 NR-01/NR-05、PF-02/PF-03/PF-06/PF-09 的本地证据更完整，但仍不能把本地 golden 当成参考站
最终视觉差分；参考站逐笔/最终截图、复杂成交、VoiceOver 和 rollback 继续保持 PARTIAL。

### 19.5 2026-09-28 续跑：响应式 Backtest 入口与旧回归修正

当前工作树将参考断点冻结为：`1024px` 保留 Dock，`≤1023px` 隐藏 Dock、取消图表高度
reservation，并显示唯一的 `Backtest` 入口；该入口和桌面 Dock 共用同一 Viewer/report 生命周期，
不会重复启动回测、Provider 或 Storage 写入。G3a 浏览器 fixture 已同步为桌面 Dock/焦点路径加
`800px` compact entry 路径，避免以旧测试契约迫使窄屏继续显示 Dock。

本轮证据：根 `npm test` `240/240`、既有回归 `22/22`、TypeScript、生产 build、开发/生产 E2E、
multi-cell、Chromium/Firefox/WebKit、四 viewport visual/a11y、Provider smoke、dist independence
和 10k/100k performance gate 均通过。修复前唯一失败是旧 G3a 在 `800px` 寻找已按参考隐藏的
Dock；更新测试后开发 E2E 通过，未观察到 page error、非法外部请求、HMR/WebSocket 或资源泄漏。

这些证据仍只关闭本地响应式/回归缺口；参考站动态逐 Fill/最终截图差分、完整 TradingView
broker parity、VoiceOver、真实 rollback 和动态登录恢复仍不能标为 PASS。

### 19.6 2026-09-28 续跑：深历史与订单生命周期门控

- 深历史覆盖已从“保留浅账本并等待”收敛为公开 `partial`；`history:complete` 刷新 context/ledger
  前为 `computing + unknown`，`aborted` 为 `partial-history`，不会把旧策略标量或交易行呈现为最终。
- Controller 的交易账本、账户标量、风险/benchmark/exact curve capability 与 Simulation 统一要求
  `historical-final` 或 `live-provisional`；新增 unknown/partial projection 回归覆盖。
- PineTS 同 ID 未成交订单替换与同 bar market replacement 已补生命周期和数量回归，避免同一逻辑订单
  生成多个可成交物理订单。
- 当前证据：根 `244/244`、既有回归 `22/22`、adapter/controller/precision `75/75`、PineTS
  strategy `24 files / 129 tests`、Vela-PineTS `27 files / 277 tests`、Provider smoke、生产 E2E
  和三浏览器 fixture 均通过。PineTS 全仓动态 suite 仍为外部/上游阻断，不能更新为 PASS。

### 19.7 2026-09-29 当前工作树复核

- 回测实现验证基线为 `1d72d6f`，当前工作树干净；`npm run test:regression:existing` 为 `22/22`，根
  `npm test` 为 `256/256`，`npm run build`、TypeScript、dependency contract 和独立产物扫描通过。
- 固定 BTCUSDT/1h fixture 为 `2/2`，Vela-PineTS 全量本地套件为 `27 files / 277 tests`；Binance 与
  Hyperliquid Provider smoke 均返回 `historyBars=5/live=true`；Chromium/Firefox/WebKit fixture 均为
  `trades=3`、`netProfit=-1.6809529999998745`、资源销毁 `0/0`。
- 固定 Chromium 性能门禁重新通过：10k/100k Trades Log 分页 p95 `42.0/33.5ms`，Dock FPS
  `60.06/59.90`，long-task p95 `0ms`，Simulation 10k `118.9ms`，销毁后 Chart/Observer `0/0`。
- 生产构建预览地址 `http://127.0.0.1:4188/?chart=maximized` 返回 HTTP 200；生命周期故障隔离测试通过。
- PineTS 全仓联网测试再次因 `api.binance.com`/`fapi.binance.com` ConnectTimeout 阻断；参考站逐笔
  benchmark、完整 TradingView 逐 Fill/复杂订单、VoiceOver 和真实 rollback 仍保持 BLOCKED/PARTIAL，
  不因本次本地复核而升级状态。

本轮补充的本地发布门禁：正确生成并校验 release manifest（commit、branch、clean tree、lockfile
和 dist 文件集全部通过）；`npm run test:e2e:offline`、`npm run test:e2e:kill-switch`、生产预览
`http://127.0.0.1:4188/?chart=maximized` 均返回 HTTP 200。断网 smoke 中拦截的请求仅属于已登记
Binance/Hyperliquid Provider，`unexpectedExternalHosts=[]`、`luxalgoHosts=[]`、`pageErrors=[]`。

### 19.8 2026-09-29 过量平仓回归修复

- PineTS Broker Emulator 修复超量 `closePartialPosition` 的净持仓更新：实际账本已按持仓量截断时，
  `position_size` 现在同步使用 `effectiveQtyToClose`，不会再由超量请求制造伪反向仓位。
- 回归用例覆盖持仓 2、请求平仓 10：结果必须为零持仓、一笔数量 2 的关闭交易；正常 FIFO、反转、
  pyramiding 与 commission 用例保持通过。
- 验证：PineTS strategy `24 files / 130 tests`、根 `npm test` `255/255`、既有回归 `22/22`、
  TypeScript 与生产构建通过。PineTS 全仓联网 suite 继续因 Binance ConnectTimeout 外部阻断，
  参考站逐笔对账、完整 TradingView broker parity、VoiceOver、生产 HMR/rollback 仍保持
  `PARTIAL/BLOCKED`。
