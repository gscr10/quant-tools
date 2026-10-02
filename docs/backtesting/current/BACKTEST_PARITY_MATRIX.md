# Backtest Workspace Parity Matrix

> **2026-10-01 R-08～R-11 修复后独立复查（历史指针）**：R-08、R-10、R-11 结论保留于 [报告](../reports/BACKTEST_R08_R11_RECHECK_2026-10-01.md)；R-09 的历史状态见 [R-09 首次复查](../reports/BACKTEST_R09_RECHECK_2026-10-01.md)，当前状态以本文件下一条最新指针为准。整体仍为 **PARTIAL**。

> **2026-10-01 最新独立复查**：[R-09 第三次复查](../reports/BACKTEST_R09_RECHECK_3_2026-10-01.md)、[R-09 新证据](../../../audit-evidence/2026-10-01-r09-recheck-3/README.md)。当前工作树重新运行后，R-08、R-10、R-11 的本轮缺陷场景通过；R-09 的 Tab/Shift+Tab、Escape、busy、destroy、三浏览器 Workbench pointer-open 和主 E2E 均通过。根测试 413/413、Vela-PineTS 283/283、构建、类型、依赖和静态独立性检查均由本轮重新执行。完整 reference golden、复杂撮合、长时 Provider、全量像素、VoiceOver/跨设备、bundle threshold 和 rollback 仍未完成，整体 **PARTIAL，Final Gate 未关闭**。下方旧报告和修复记录只作历史索引，不作为当前通过依据。

> **2026-10-01 修复者过程记录（历史）**：见 [账本与视觉修复记录](../reports/BACKTEST_LEDGER_VISUAL_REMEDIATION_2026-10-01.md)。SMA-UI-01 真实网络首次添加及单 tick 对照已通过；D-01 正常启动、工厂晚挂载、深历史和仅增加根数请求时序通过；V-03/04/05/07/08 与 V-10 modal 部分有新证据。没有按这些局部缺陷重新计算整张矩阵的 PASS 数，整体仍 **PARTIAL**。下方审计结论按各自历史对象解读。

> **2026-09-30 最新 SMA 9/21 参考对账**：固定 LuxAlgo `BTCUSDT/15m` 5,000-bar 响应与用户脚本已由参考站执行，并以同一响应喂给本地 PineEngine；Net P&L、Gross Profit/Loss、Max DD、96/184、Profit Factor 均一致，固定窗口算术 parity 为 PASS。证据见 [BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md](../reports/BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md) 和 `audit-evidence/2026-09-30-sma-cross-parity/reference-sma-921-runtime.json`。默认本地 Binance.US 500-bar UI ledger/readiness 仍 OPEN，矩阵整体仍 PARTIAL。

> **2026-09-30 动态深审（历史快照）**：综合报告见 [BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md](../reports/BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md)，本地动态证据见 [audit-evidence/2026-09-30-dynamic-deep/README.md](../../../audit-evidence/2026-09-30-dynamic-deep/README.md)，参考站深审见 [BACKTEST_REFERENCE_DEEP_AUDIT_2026-09-30.md](../reports/BACKTEST_REFERENCE_DEEP_AUDIT_2026-09-30.md)。R-05/R-06/R-07 当前独立 probe 9/9 通过；新增 D-01 的初始历史完成后策略插入时序问题仍为开放项。矩阵整体保持 **PARTIAL**，Final Gate 未关闭。

> **此前独立复查（历史快照）**：见 [BACKTEST_AUDIT_RECHECK_4_2026-09-30.md](../reports/BACKTEST_AUDIT_RECHECK_4_2026-09-30.md)。其 R-06/R-07 边界已在当前工作树重新 probe；矩阵当前状态以顶部最新独立复查为准。

> **参考站动态补充（2026-09-30）**：用户提供的 workspace 已成功登录并采集真实四 Tab、Settings、Simulation 和 13 笔策略报告，详见 [BACKTEST_REFERENCE_LIVE_AUDIT_2026-09-30.md](../reports/BACKTEST_REFERENCE_LIVE_AUDIT_2026-09-30.md)。固定 SMA 9/21/5,000-bar 响应对账已完成；默认本地 500-bar UI ledger、provider/partial policy 和 open-row 计数仍未完成。

> 版本：0.1（审计草案）
>
> 采集/整理：2026-09-26（参考动态记录中包含 2026-09-27 的续验条目）
>
> 历史采集基线：`4df3c8b`。该历史轮次对象：`feature/backtest-workspace-build` 的
> `53ab05795f45e5440eba1c1513b3bb63a659b9ae` 加未提交业务修复，不是“只有文档修改”。
> 该历史轮次独立结论为 **PARTIAL**，见 [BACKTEST_AUDIT_RECHECK_4_2026-09-30.md](../reports/BACKTEST_AUDIT_RECHECK_4_2026-09-30.md)。
> 第二轮审计发现的 S-01～S-03、U-01 后续已修复并复跑，见 [修复记录](../reports/BACKTEST_RECHECK_2_REMEDIATION_2026-09-30.md)。局部场景通过不关闭整体 parity；原独立失败证据未改写。
> 第三轮修复记录曾将 R-05～R-07 的目标场景标为通过，见 [第三轮修复记录](../reports/BACKTEST_RECHECK_3_REMEDIATION_2026-09-30.md)；第四轮独立复查重新发现 R-06/R-07 的适配器边界开放项，整体 parity 仍未完成。
> 下方矩阵保留历史需求及证据索引，旧测试数字/fixture/修复记录不作为本轮通过依据，最新状态以
> recheck 的新输入、dev/production 浏览器、实际引擎及故障时序证据为准。

## 1. 使用规则

本矩阵将参考站行为、本地实现和验证证据分开记录。每一行必须同时回答四个问题：参考站实际是什么、本地现在做了什么、什么自动化证据证明了什么、还差什么。

状态含义：

- **PASS**：有明确参考证据；本地实现覆盖该条；并有与该条直接对应的自动化或可复核运行证据。仅“代码看起来有”不够。
- **PARTIAL**：实现或局部测试存在，但缺视觉/交互/边界/数值/生命周期等至少一类证据，或已知存在未解决差异。
- **BLOCKED**：验收需要的外部条件、固定 fixture、底层能力或产品决策尚未具备；不能用局部绿灯替代。
- **NOT STARTED**：当前没有可验收的实现或测试。

除非行内明确标注，`PASS` 只表示该行的局部合同通过，不表示对应 Tab 或整个项目完成。`BACKTEST_WORKSPACE_PLAN.md` 的 G9/Final Gate 仍以所有相关行通过为准。

本次独立审计的证据边界：`A-UNIT`、`A-OLD`、`A-E2E`、`A-PROVIDER`、`A-DEP` 以及仓库历史 fixture/截图均不作为本轮通过证据。它们只保留为需求索引；当前状态以独立审计报告中的新建输入、服务探针和代码复核为准。

## 2. 证据索引

| ID | 证据 | 可证明范围 | 不能证明的范围 |
| --- | --- | --- | --- |
| R-DYN | [`BACKTEST_REFERENCE_EVIDENCE.md`](../reports/BACKTEST_REFERENCE_EVIDENCE.md) 动态矩阵、追加动态复核、Full-access 续验 | 参考站在固定浏览器中的入口、字段、请求时序、部分几何和响应式行为 | 本项目数值相等、完整截图差分、未观察到的状态 |
| R-LIVE | [`BACKTEST_REFERENCE_LIVE_AUDIT_2026-09-30.md`](../reports/BACKTEST_REFERENCE_LIVE_AUDIT_2026-09-30.md) 真实 workspace 登录采集 | 真实四 Tab、Settings、Simulation 控件、指标人口和 open-row 语义 | 同数据本地逐笔/逐字段相等、参考站未来版本和未观察状态 |
| R-SMA921 | [audit-evidence/2026-10-01-recheck-ledger-visual/parity/README.md](../../../audit-evidence/2026-10-01-recheck-ledger-visual/parity/README.md) | 重新解析参考原始档案，当前 Node/浏览器双引擎新执行；53 closed + 1 open 共 536 字段、10 个已实现汇总一致 | 尚缺 227 closed；实际执行 source bytes 未证明；非外站本轮新采集、非完整 Performance/曲线一致 |
| R-RECHECK | [BACKTEST_LEDGER_VISUAL_RECHECK_2026-10-01.md](../reports/BACKTEST_LEDGER_VISUAL_RECHECK_2026-10-01.md)、[audit-evidence/2026-10-01-recheck-ledger-visual/README.md](../../../audit-evidence/2026-10-01-recheck-ledger-visual/README.md) | 本輪新构建、真实网络dev/prod、双引擎正常/故障路径、三浏览器视觉、独立SMA计算 | 未覆盖的全量reference/像素/复杂撮合/WS长链/rollback不作PASS |
| R-HTML | 外部参考 artifact `backtest.html`（580,219 bytes，SHA-256 `96549a059940d5785f831c18fb52b1f6a65d0830746ff6e0af731a19e42a805b`；原文件不入库） | Performance/Dock 的静态 DOM、字段顺序、Highcharts 形态、视觉 token | 事件处理、原始数据、公式、其它三个 Tab 的运行行为；需要外部 artifact 才能复核 |
| R-CHUNK | 参考组件 chunk SHA `8928f58b281cddd772241487387406fe310898bbb7c7dc6aaa257d6e2b360146`；图表/helper chunk SHA `2691702ab96f8f21f30e064723141dea28eac666268ecc8ad4db49d76a8f0950` | Trades Analysis 的结构、公式和图表合同（见参考证据追加章节） | 当前站点未来版本、完整 hover/键盘行为 |
| L-UI | [`src/features/backtesting/backtest-workbench.ts`](../../../src/features/backtesting/backtest-workbench.ts)、[`backtest-viewer.ts`](../../../src/features/backtesting/backtest-viewer.ts)、[`backtest.css`](../../../src/features/backtesting/backtest.css) | 当前本地 DOM、状态机、样式和清理路径 | 视觉上是否达到 1px/0.5% 阈值 |
| L-DOM | [`src/features/backtesting/trade-analysis-view.ts`](../../../src/features/backtesting/trade-analysis-view.ts)、[`trade-calendar-view.ts`](../../../src/features/backtesting/trade-calendar-view.ts)、[`simulation-view.ts`](../../../src/features/backtesting/simulation-view.ts) | 三个专用 View 的结构和语义 | 参考站未冻结字段的相等性 |
| L-DOMAIN | [`src/domain/backtesting.ts`](../../../src/domain/backtesting.ts)、[`backtest-metrics.ts`](../../../src/domain/backtest-metrics.ts)、[`backtest-simulation.ts`](../../../src/domain/backtest-simulation.ts) | 纯 selector、人口、公式、不可用值和 deterministic simulation | 参考站未知公式或撮合精度 |
| L-APP | [`src/app/backtest-controller.ts`](../../../src/app/backtest-controller.ts)、[`backtest-feature.ts`](../../../src/app/backtest-feature.ts) | Adapter/Controller 生命周期、报告映射、故障隔离和多 Cell 选择 | 底层 broker 的真实成交语义 |
| A-UNIT | `npm test`（当前批次 `241/241`）、`tests/backtest-*.test.mjs`、`tests/*simulation*.test.mjs`、`tests/*calendar*.test.mjs`、`tests/*analysis*.test.mjs` | 纯函数、契约、DOM 源码合同和状态机的已覆盖断言 | 没有被测试覆盖的视觉、真实浏览器、多浏览器和大数据行为 |
| A-OLD | `npm run test:regression:existing`（当前 `22/22`，[`tests/architecture.test.mjs`](../../../tests/architecture.test.mjs)、[`tests/storage.test.mjs`](../../../tests/storage.test.mjs)） | 原有架构、Storage 和旧快照的代码级回归 | 工具栏每个点击的完整 DOM/视觉基线 |
| A-E2E | `npm run test:e2e` / `npm run test:e2e:prod`，[`tests/e2e_app.py`](../../../tests/e2e_app.py) | 当前 fixture 的 DOM、请求、Storage、Simulation、部分响应式和组合 smoke；`npm run test:e2e:cross-browser` 另证 BTCUSDT fixture 的 Chromium/Firefox/WebKit | 完整参考截图差分、VoiceOver、长时资源计数和完整应用跨浏览器视觉行为 |
| A-PROVIDER | `npm run test:providers` / [`tests/provider_smoke.py`](../../../tests/provider_smoke.py) | Binance、Hyperliquid 各自历史 5 bars + live smoke | 固定 BTCUSDT/1h 与参考站逐笔数值相等 |
| A-DEP | `npm run check:dependencies`、`npm run build`、Fork fingerprint/sentinel、`npm run test:e2e:offline`、`npm run release:manifest` | 本地包版本、SHA、Worker 内嵌版本、Highcharts 本地构建；fresh clone、生产断网壳和文件级 manifest 证据 | 上一制品真实 rollback、清缓存恢复和无行情缓存行为仍未完成 |
| A-UNVERIFIED | 计划与基线中明确列出的 `[ ]` 项：参考站最终数值/视觉对账、完整视觉/a11y/性能、HMR/资源计数、G8 完整低周期逐 Fill/复杂订单语义等 | 证明这些项目仍未完成 | 不能把“未观察到失败”理解为通过 |
| A-LEDGER | [`BACKTEST_LEDGER_AUDIT.md`](../reports/BACKTEST_LEDGER_AUDIT.md) 及 PineTS/Vela 定向测试 | 证明 round-trip trade ledger、reversal/FIFO/pyramiding 的内部撮合语义，以及本地 Fork `auditLedger` 的 identity-bound raw order/fill bridge | 上游 Vela 基线仍无 raw selector；本地 envelope 缺失、过期或 malformed 时 capability 必须回退 false；不能据此宣称完整 TV broker parity |
| A-FORK | [`VELA_FORK_DECISION.md`](../../architecture/VELA_FORK_DECISION.md) 与 dependency contract | 证明 PineTS/Vela-PineTS 的本地源码版本、Vela 主包的 registry 边界和触发本地化的条件；清缓存构建已在 `44ade5c` 临时 clone 复核 | 不能证明断网发布或 rollback 演练已经完成 |

## 3. Dock（底部回测摘要）

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | 无策略时不显示空 Dock | R-DYN §动态行为矩阵：无 Strategy 不渲染空 Dock | Workbench 初始 `hidden`，无报告时进入 empty state | A-E2E `verify_backtest_workspace`、fixture remove 路径 | PASS | 继续在策略删除、cell destroy 和刷新后保留该断言 |
| D-02 | 策略加入后自动出现，不增加 Run 按钮 | R-DYN Strategy 入口 | `BacktestFeature` 监听 strategy run；Dock 只有 settings/viewer/collapse 入口 | A-E2E strategy attach/complete smoke | PASS | 固定首次添加策略的参考请求计数仍需 G0 复采 |
| D-02a | 初始 history complete 后新增策略不得发布 ready 空账本 | 原失败保留为历史；本輪新真实 Binance.US 500 bars 首次加载 | 当前普通初始/晚挂载/晚加策略正确继承历史与账本 | audit-evidence/2026-10-01-recheck-ledger-visual/real-provider/summary.json，history/PineEngine.json、PineWorkerEngine.json | PASS（该目标场景） | 156 次真实采样无缺失，两引擎各 19 项正常生命周期通过；异步市场与历史故障见 D-02b/c |
| D-02b | 切市场后旧报告不得重新完成/模拟 | 本地正确性门禁，不依赖参考推断 | PineEngine/PineWorkerEngine 以 run/context/history 身份 fence 撤销旧 ready 与 Simulation | audit-evidence/2026-10-01-r08-r11-remediation/independent-r10-2、independent-r10-overlap-2；报告 §4 | PASS（本轮缺陷场景） | 仅覆盖受控异步竞态；复杂多周期执行、Worker 长时资源仍待 Final Gate |
| D-02c | 历史网络失败不得伪装为源耗尽 | 计划失败/partial语义 | Provider failure 保留 error/aborted 语义；Retry 绑定原始 target、Cell、market 和代次 | audit-evidence/2026-10-01-r08-r11-remediation/independent-r11-2、independent-r11-multicell-2；报告 §5 | PASS（本轮缺陷场景） | 仅覆盖 503/429/timeout/invalid JSON 受控矩阵；长时断网/重连和资源计数仍待 |
| D-03 | 展开高度约 280px | R-DYN 1440×900 实测 `280px` | `DEFAULT_DOCK_HEIGHT=280`，CSS 高度变量 | A-E2E G3a 几何断言（约 279–280） | PASS | 首轮截图差分仍未建立，像素阈值待 G0 |
| D-04 | 折叠高度约 28px，只留控制行 | R-DYN 折叠后 `28px`，入口文案为 Expand | CSS collapsed height 28；collapse button/ARIA controls | A-E2E G3a 折叠/展开几何断言 | PASS | 需补参考与候选状态截图 hash |
| D-05 | 可在 104px 最小高度至视口上限间拖拽 | 参考要求见计划 §3.3；动态只确认 Pointer 拖拽 | separator、Pointer Capture、clamp、double-click reset 已实现 | 固定 Chromium 1440×900/DPR1 性能 Gate：10k/100k 拖拽 59.87/59.91 FPS、long-task p95=0ms；键盘/边界合同仍在 | PARTIAL | 参考截图差分、WebKit/Firefox、边界前后 1px 仍待 |
| D-06 | 键盘调整、Home/End、ARIA separator | 计划 §10.4 的 separator 合同 | `role=separator`、`valuemin/max/now`、controls、keydown；折叠时隐藏子树焦点回收到控制按钮 | `tests/strategy-settings.test.mjs`、G3a fixture 的 ArrowUp/ArrowDown/Home/End、边界 clamp、折叠焦点回收合同 | PARTIAL | 已补真实浏览器逐键盘动作与折叠焦点回收；仍缺参考站键盘行为证据及焦点截图差分 |
| D-07 | Header 显示策略名、日期范围、收起/打开 Viewer | R-DYN Dock 几何/字段；R-HTML Dock KPI/header | `dockTitle`、`dockRange`、collapse/viewer controls | A-E2E title/viewer 入口断言；范围合同定向测试 | PARTIAL | 缺完整 reference/candidate header 截图差分与所有状态文案对账 |
| D-08 | 五个 KPI：Net Profit、Trades、Win Rate、Max Drawdown、Profit Factor | R-DYN KPI 示例；R-HTML `Net Profit` 等静态字段 | Workbench `renderDockMetrics` 与方向 breakdown | A-E2E/Viewer contract 覆盖结构；没有逐字段 golden 数值对账 | PARTIAL | 用固定 BTC fixture 逐字段核对精度、符号、单位和空值 |
| D-09 | Summary 使用 mark-to-market Net Profit | R-DYN §4.2 Summary 包含 open 浮亏；R-HTML 仅静态示例 | Controller `netPnl + openPnl`，Dock/Viewer 共用报告 | Domain/controller tests 覆盖 open P&L 映射 | PARTIAL | 需要参考站与固定 fixture 的逐笔/汇总数值证据 |
| D-10 | 累计 P&L/Equity 图独立显示，拖动时 reflow | R-DYN Dock 独立曲线；R-HTML Highcharts 容器 | Dock SVG fallback + Highcharts upgrade/reflow；大曲线 render 上限 2,000，raw tooltip source 保留 | E2E exact-equity source、固定 Chromium 10k/100k 曲线（raw→render 10k/100k→2,000）与 drag FPS | PARTIAL | reference screenshot diff、range/多 series tooltip 和跨浏览器仍待 |
| D-11 | Collapse、Viewer、Settings 不重跑策略/Provider | R-DYN tab/Viewer 未产生 `backtest-run`；计划 §3.3 | Workbench 回调只改布局/打开状态；Controller 分离 simulation | A-E2E 请求/Storage/worker 守卫 | PASS | 扩展到 Dock resize、双击 reset 和 live tick 期间计数 |
| D-12 | Viewer 打开时 Dock 隐藏但 chart 保持挂载 | R-DYN Viewer absolute overlay、返回恢复 | `backtest-feature.ts` 设置 reserved height/ARIA suppression，不销毁 Vela | A-E2E geometry、Viewer open/return | PASS | HMR、异常关闭和多 Cell 资源计数仍待补 |
| D-13 | Dock 高度/折叠跨刷新持久化规则 | 参考是否持久化尚未 G0 冻结；本地先采用安全可回退的 UI 偏好合同 | 独立 `quant-tools:backtest-dock:v1` key，仅保存 `{version,height,collapsed}`；Workbench 只在用户折叠、键盘/双击/拖拽结束时写入；不保存报告、交易或 Workspace state；恢复后按当前 viewport/options clamp，坏值回退默认 | `tests/backtest-preferences.test.mjs` repository 校验 + Workbench seam 合同；`tests/architecture.test.mjs` key/边界合同 | PARTIAL | 参考站是否跨刷新保留高度/折叠仍需 G0 动态复测；若参考不持久化，保留为本地有意偏好并在范围中注明 |

## 4. Viewer Header、容器和通用 Tab 行为

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| H-01 | Viewer 覆盖 chart 工作区而非路由/浏览器 Modal | R-DYN Viewer 框 `absolute inset-0 z-20`，保留全局栏 | 应用层 sibling/overlay，Vela chart 不销毁 | A-E2E Viewer geometry 与 chart suppression | PASS | 补 1440/1280/1024 reference-candidate 几何快照 |
| H-02 | Header 资产徽标、symbol、timeframe | 参考BTC/ETH标识与当前本地资产约定 | 图表与Viewer共用本地BTC/ETH SVG，其它资产fallback | audit-evidence/2026-10-01-recheck-ledger-visual/visual/findings.md：多实例gradient、decode/canvas及ETHFI/BTCDOM/FOO | PARTIAL | 已测图标修复通过，完整视觉/其它资产/各DPR黄金差分仍待 |
| H-03 | provider 不可用时不显示 `unknown` 占位 | 最新本地修复与计划范围推断 | provider 过滤，symbol/timeframe 缺失时隐藏对应块 | Viewer contract 记录缺失字段断言 | PASS | 加入所有空值组合的浏览器快照 |
| H-04 | Header 显示策略名和 UTC 日期范围；同年省略重复年份 | R-DYN Header；参考日期范围动态记录 | `formatBacktestRange`、settled series/ledger range inference | Controller/viewer contract 定向测试 | PARTIAL | 缺参考跨年/同年多 locale 截图和最终日期精度对账 |
| H-05 | Return to chart/minimize 图标关闭 Viewer 并恢复布局 | R-DYN `Return to chart` | Header back button，close path 恢复 Dock、ARIA 和焦点 | A-E2E click/hidden/Storage assertions | PASS | 补 Esc、浏览器 Back、异常 report 更新中的返回路径 |
| H-06 | Strategy favorite 星标与列表/图例共用状态 | R-DYN Header favorite；计划 §3.4 | `favoriteButton` 调用现有 callback，不创建第二份结果状态 | Viewer contract `Save strategy`/`Remove from saved`；既有 favorite regression | PARTIAL | 缺 Viewer→指标列表→刷新三向同步的 DOM/Storage 证据 |
| H-07 | Settings 入口只在 Dock 提供，Viewer 不重复展示 | R-DYN/HTML Viewer header 只有 Return、market identity 和 favorite；Settings 从 chart Dock 打开 | Dock callback 进入 `StrategySettingsPanel`；Viewer header 不再注册 settings button | `tests/strategy-settings.test.mjs`、A-E2E Dock settings + Viewer absence smoke | PASS | 批量提交请求数仍需独立浏览器计数 |
| H-08 | 首次打开默认 Performance；重新打开不记住最后 Tab | R-DYN §3.4、动态 tab 复用 | `open()` 清空 scroll、选择 Performance | Viewer contract/Tab E2E | PASS | 补重载、report revision 和多个策略切换的默认态 |
| H-09 | Tab sticky、内容区独立滚动、每 Tab 保存 scroll | R-DYN §3.4 | `scrollPositions` map、sticky CSS、panel scrollTop restore | 有 scroll/Tab 相关合同，但无完整截图与跨 Tab 长内容 E2E | PARTIAL | 补每 Tab 长内容滚动位置和 viewport 断点测试 |
| H-10 | 四个 Tab 顺序和文案 | R-DYN、R-HTML 明确 `Performance / Trades Analysis / Trades Log / Simulation` | `TABS` 固定四项，tablist/tabpanel | A-E2E selected/controls；unit viewer contract | PASS | 视觉字体、间距和 active underline 仍需差分 |
| H-11 | Tab 切换只 selector/re-render，不请求回测/行情 | R-DYN 网络观察 | Viewer render + chart destroy/recreate，仅 Controller report 不重跑 | A-E2E market/backtest request guard | PASS | 加入连续快速切换和 live revision 竞态证据 |
| H-12 | Viewer 关闭、destroy 幂等且图表实例释放 | 参考行为只确认返回；计划 §5.4/§11 | `destroyReportCharts`、Viewer destroy、feature cleanup | Highcharts contract、lifecycle fixture 部分覆盖 | PARTIAL | 缺 10 次 open/close 的实例/Observer/heap 计数 |
| H-13 | Replay → 选择 K 线 → Backtest → Return to chart 状态链 | 2026-09-29 登录参考站动态复核：Replay 后显示 K 线选择提示，选择后出现 Backtest，进入 Viewer 后提供 Return to chart | 本地已有普通 Backtest Viewer 和 Return to chart；Replay 状态链不在本阶段范围 | 参考站 DOM/交互证据保留于 `BACKTEST_REFERENCE_EVIDENCE.md`；不作为当前发布验收项 | OUT OF SCOPE | 暂不实现、不阻塞当前回测工作区；未来若纳入，再增加 Workspace adapter Replay seam |

## 5. Performance Tab

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 | Summary 区及累计 P&L 图 | R-CHUNK historical_net_profit 与 trades_history 同序号关联；Tooltip Trade #=index+1；2026-09-29 同层几何测量 | `renderPerformance` 改为按交易序号的 realized-ledger 曲线；exact equity 独立保留作风险数据；live snapshots 不重建未变化图表 | 固定 24 bars/3 trades 的 Summary 3 点、UTC/方向/Trade #3 hover；live surface signature/performance tests | PARTIAL | 已关闭逐 bar equity 误用与持续闪烁缺口；open/current 尾点参考 payload、受控逐笔数值和完整 hover golden 仍待 |
| P-02 | Net Daily PNL 图（250px） | R-HTML `Net Daily PNL (USD)`、Highcharts 250px | local bar chart、currency/positive/negative colors | Viewer/E2E chart host contract | PARTIAL | 缺日期 bucket、axis、tooltip、hover 精确对账 |
| P-03 | Weekday Performance 图（七个 Sun–Sat 桶） | R-HTML `Weekday Performance (USD)`；计划要求七桶补零 | `weekdayPerformance` selector + bar chart | Domain tests cover seven buckets/zeros | PARTIAL | 缺参考全周空桶截图和视觉刻度 diff |
| P-04 | All/Long/Short 表头、分组和 14 个指标行 | R-HTML table 17 `<tr>`（含表头/分组），All/Long/Short；字段静态可见 | `PERFORMANCE_ROWS`、`renderMetricTable`、Risk-Adjusted/Benchmark groups | Viewer contract/domain/controller tests | PARTIAL | 固定 fixture 逐行数值、顺序、字体、分组边界尚未 golden 验收 |
| P-05 | All/Long/Short 独立且使用可解释的一致口径 | 参考有方向列；计划要求方向汇总 | All 使用 account mark-to-market P&L；Long/Short 仅在逐腿估值可证明时分解，否则保持 unavailable | audit-evidence/2026-10-01-r08-r11-remediation/recheck-r08/results.json、independent-real-provider-2/result.json；报告 §2 | PASS（本地口径） | 已验证 All = Long + Short 的可证明场景及对冲不可证明场景；参考站方向口径仍需完整外部 golden |
| P-06 | Gross Loss 显示正的损失幅度 | R-DYN Performance 说明 | domain `grossLoss` 归一化为正幅度，formatter 显示 | `backtesting-domain.test.mjs` | PASS | 以固定负样本与参考值做最终数值差分 |
| P-07 | Average P&L per Day/Week 方向维度 | 参考静态/动态字段；计划新增方向维度 | `averagePnlPerDay/Week` All/Long/Short | domain/controller targeted tests | PARTIAL | 无参考跨自然空日/周受控样本，精确精度规则未冻结 |
| P-08 | Drawdown 为单一复合行；风险分组/Benchmark 分组 | R-DYN/计划 §3.5 | `drawdown` 单元格复合金额+百分比，分组行渲染 | Viewer contract/domain tests | PASS | 缺截图确认行高、分组 border 和长数字折行 |
| P-09 | Benchmark 缺失值：All 为 ASCII `-`，Long/Short 真空白 | R-DYN 最新续验、计划 §11 当前批次 | formatter/metric table distinguishes benchmark All vs direction blank | Viewer contract test、E2E table snapshot | PASS | 只证明缺失态；非空 benchmark 单位/精度仍未有参考证据 |
| P-10 | Strategy Outperformance 的单位/公式 | 本地计划定义 Net Profit - Buy and Hold；参考完整非空口径仍待冻结 | 页面使用同一可见 Net Profit 与 Buy & Hold，Outperformance 按前者减后者；缺失输入保持 unavailable | audit-evidence/2026-10-01-r08-r11-remediation/recheck-r08/results.json、independent-real-provider-2/result.json；报告 §2 | PASS（本地口径） | 已完成页面算术与无交易 unavailable 语义；参考站非空 benchmark 的完整外部语义仍待 golden |
| P-11 | CAGR/Calmar/Sharpe/Sortino 来源与 unavailable 规则 | R-DYN 字段；参考公式未完整黑盒冻结 | Engine scalar pass-through + capability fallback | Controller/domain capability tests | PARTIAL | 缺参考数值 fixture、采样周期/无风险利率/样本不足对账 |
| P-12 | Buy & Hold PnL/% Gain | R-DYN 当前样本缺失为 `-`；非空样本未观察 | PineTS fields + benchmark capability | Adapter/controller tests for field availability | BLOCKED | 需要固定参考 benchmark 样本和本地 candles hash 对账 |
| P-13 | Tooltip、legend、hover、axis、positive/negative colors | R-HTML Highcharts DOM、颜色 `#089981/#f23645`；动态截图哈希 | local Highcharts 13 renderer + SVG fallback/descriptions | Highcharts renderer contracts、E2E chart host | PARTIAL | 没有 reference/candidate hover screenshot、键盘 tooltip 和完整轴 golden |
| P-14 | 货币/百分比/小于 1 的精度 | R-DYN 样本 Short daily `-0.9705556 USD`；计划明确规则未冻结 | 通用 formatter 多数两位，Trades Log 有专用精度 | Unit tests cover basic formatting | PARTIAL | 当前 `-0.97 USD` 与参考样本存在潜在差异；先复测全指标精度再改 |
| P-15 | 空数据、no-trades、open-only、loading/error | R-DYN/计划状态合同 | Viewer status branches and empty/status/error views | Controller/viewer tests + E2E simulation empty, partial paths | PARTIAL | Performance 各状态的参考文案/截图尚未逐一冻结 |
| P-16 | 结果曲线来自同一 runId/snapshotRevision 的 exact series | 参考复用同一结果；本地计划 G4b.2 contract | Adapter validates identity/count/monotonicity; report exact capability | Adapter/controller tests, E2E `exact-equity` assertion | PASS | 交易账本/order/fill 尚未与曲线形成单一原子包，扩大 capability 前需补 |

## 6. Trades Analysis Tab

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| A-01 | 顶部 P&L Distribution + Winrate donut 两列/窄屏单列 | R-CHUNK/R-DYN Analysis 合同 | `renderTradeAnalysisView` overview grid, local Highcharts/SVG | Domain/view/E2E chart count | PARTIAL | 缺完整下半页 screenshot diff、字体/间距/高度逐像素证据 |
| A-02 | Histogram bins、颜色、三条 aggregate 参考线 | R-CHUNK 明确 `ceil(sqrt(N))`、边界和线颜色 | `trade-analysis.ts` selector + renderer | `trade-analysis-domain`/Highcharts contract/E2E | PASS | 需要受控极端值浏览器 golden 与线上 chunk 漂移检查 |
| A-03 | Donut 只有 Winners/Losers/可选 Breakevens，无 Current | R-CHUNK/R-DYN | donut selector/presentation projection | E2E asserts no Current + chart contracts | PASS | VoiceOver legend与零 breakeven的读屏顺序仍待验收 |
| A-04 | 第一表精确 10 行，All/Long/Short | R-CHUNK | 专用 Analysis DTO/View | E2E 10-row/order assertions、domain tests | PASS | 视觉 table row height/number format 尚未 golden |
| A-05 | Duration vs P&L 单 scatter + OLS trend，不把 trend 放 legend | R-CHUNK | 一个 colored scatter + trend series | E2E chart/series contract、domain OLS tests | PASS | 缺真实 hover/keyboard/tooltip 与截图差分 |
| A-06 | 第二表精确 9 行，duration/frequency/streak bars | R-CHUNK | 专用 selector/view | E2E 9-row/order assertions、domain tests | PASS | 非分钟周期、DST/极端 streak 的参考对账未完成 |
| A-07 | open/current 只在 Analysis 投影为 breakeven，不能污染其它人口 | R-DYN §4.2、R-CHUNK | `includeOpenInAnalysis`/presentation-only projection | Domain/controller tests for open/real breakeven; E2E open-only | PASS | 需固定参考 open+closed+true breakeven 三者同屏 fixture |
| A-08 | 空交易页显示 `No trades available` | R-CHUNK | Analysis empty state keyed to canonical closed population | Domain/view/E2E empty-state tests | PASS | 补全胜/全负/仅 open 的参考截图 |
| A-09 | Duration fallback、UTC day/Sunday week、streak semantics | R-CHUNK 公式 | selector implements finite duration/timestamp fallback | `trade-analysis-domain.test.mjs` | PARTIAL | 公式有单测，但缺参考跨时区/非分钟周期逐字段数值证据 |
| A-10 | 不显示自创三张卡片/Current slice | R-CHUNK 明确排除 | 旧 cards removed; dedicated View | E2E selectors and source contract | PASS | 保持线上 chunk 版本变化时重新审计 |
| A-11 | Analysis 图表 a11y、hover、键盘和 reduce motion | 计划 §10.4；参考静态未提供完整语义 | SVG descriptions/fallback、ARIA host、CSS reduced motion | 部分 E2E SVG `desc`/host checks | PARTIAL | 尚未跑 axe、keyboard-only golden 或 VoiceOver |

## 7. Trades Log / Calendar

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| L-01 | 默认按 Trade # 降序；新列首次降序，重复切换 | R-DYN `13 → 0`、追加线上 chunk 排序规则 | `DEFAULT_TRADE_SORT`/stable comparator | `tests/backtest-viewer-contract.test.mjs`、A-E2E sort assertions | PASS | 复杂 reversal/同 timestamp tie fixture 尚未覆盖 |
| L-02 | 可见列及条件列：Trade #、Entry、Exit、Size、Net P&L、MFE、MAE、Cumulative P&L | R-DYN/线上 chunk；CSV 未观察 | local conditional Size/Excursion columns | A-E2E header/order/empty colspan assertions | PASS | 完整视觉列宽/横向滚动差分待 G9 |
| L-03 | Long/Short badge、UTC/browser-locale datetime、价格精度和币种 | R-DYN 追加复核 | `formatTradeDateTime/Price`、direction badge、专用 number formatter | Unit/viewer/E2E formatting assertions | PASS | 需要固定 locale 与多资产精度 screenshot |
| L-04 | open row 视觉 sentinel 可兼容，但领域 exit 必须 null | R-DYN/计划 §3.7 | presentation epoch/N/A only; domain/calendar/simulation use null | domain normalization + viewer contract | PASS | 最终 open row 文案仍需参考复测冻结 |
| L-05 | Entry/Exit `Show … on chart`，关闭 Viewer 并定位 marker | R-DYN 动态复核：点击后 Viewer 关闭，出现垂直 crosshair/横向价格线、Long entry/exit marker 与 tooltip；临时截图 `locate-entry.png` SHA256 `961d96…`、`locate-exit.png` SHA256 `566604…` | Crosshair callback closes Viewer；`VelaWorkspaceAdapter.focusBacktestExecution` 通过公开 `setVisibleRange` + `renderer.setExternalCrosshair` 激活 Cell、恢复焦点 | Full-access 动态截图确认参考视觉；本地 adapter seam/source contract + A-E2E button/return；未有本地 marker/bar-index 像素断言 | PARTIAL | 已补公开 crosshair seam；仍需本地固定 fixture 的 bar-index/marker 高亮自动断言，且 Vela registry 未公开 marker-select API，不得伪造高亮能力 |
| L-06 | Calendar list/calendar icon-only tabs，使用同一交易源 | R-DYN `role=tab` list/calendar | `renderTradeCalendar` and shared `trades` | A-E2E mode/ARIA assertions | PASS | 视觉 icon/token 差分待补 |
| L-07 | Calendar exit 日分桶、日 P&L/count/win%、月汇总 | R-DYN 追加 Calendar 公式 | `aggregateBacktestTradeCalendar` + view; open excluded | Calendar unit/E2E exact aggregate and month navigation | PASS | 只完成当前合同；参考截图差分、跨 locale 仍待 |
| L-08 | 当前月/前后月/Move to current month/空月/焦点恢复 | R-DYN Calendar DOM | calendar month state/cache/focus restoration | A-E2E month navigation/focus/empty month | PASS | 需要 DPR/横竖屏 golden |
| L-09 | CSV 导出入口 | R-DYN 当前样本未观察到可见按钮 | 未增加导出按钮 | A-E2E/DOM absence expectation | PASS | 若未来参考出现入口，先更新 R-DYN 和本行，不得自行添加 |
| L-10 | 上万行虚拟化/分页 | 计划性能合同；参考静态快照不是大数据证据 | Bounded 200-row trade window，保留页码、排序 source index、定位和 ARIA window metadata；连续滚动 virtual list 尚未引入 | `tests/backtest-performance.test.mjs` 100k rows bounded-window contract + root `219/219` | PARTIAL | 若产品需要连续滚动，再补 spacer/IntersectionObserver；当前分页已限制 DOM 上限 |
| L-11 | reversal、partial-close、pyramiding、同 timestamp 多事件 | 计划 G6 要求；参考样本未覆盖 | 本地 Fork 已桥接 identity-bound order/fill DTO、parent/reversal relation 与 partial progress；领域层保留事件关系；图表 marker 对同 timestamp 不同成交价保持独立、同价 reversal/FIFO 仍合并；显式 OCA `cancel/reduce` 已按实际成交数量处理并写入取消事件 | adapter/domain 定向测试、PineTS ledger fixture、`strategy-trades` marker regression、OCA 固定 OHLC fixture；无完整复杂成交 UI/参考逐笔对账 | PARTIAL | 仍需同 timestamp/实时复合订单 fixture、Trades Log raw 视图和 TradingView 逐 Fill 对账，不能把首版 progress 当交易所 partial fill |

## 8. Simulation Tab

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | Resample/Shuffle 方法及默认 1,000、variation 0、Preserve off | R-DYN Simulation 控件复核 | `simulation-view.ts` controls/defaults | A-E2E `verify_simulation_workspace` + domain tests | PASS | 参考 seed/公式版本变化需重新记录 |
| S-02 | 固定 seed `12648430`、Laplace variation、preserve win/loss | R-DYN 生产 chunk 复核、基线 §G7 | `backtest-simulation.ts` deterministic PRNG/variation | Simulation unit tests + E2E shuffle terminal invariant | PASS | 尚需与参考固定 fixture 逐值对账，不只验证内部确定性 |
| S-03 | Drawdown threshold 1.5x/2x/3x/custom 与 USD/% | R-DYN | selector/projection + controls | A-E2E aria-pressed and KPI/chart changes | PASS | 缺参考 screenshot/tooltip 精确差分 |
| S-04 | Outcome/Open Max DD Histogram/Cumulative 切换 | R-DYN | independent chart mode selectors | A-E2E controls/Highcharts hosts | PASS | 视觉坐标/柱宽/tooltip golden 未完成 |
| S-05 | KPI、paths、Outcome、Drawdown、Streaks & Recovery 内容 | R-DYN/计划 §3.8 | `renderSimulationView` full page | A-E2E titles/KPI/table/chart count | PARTIAL | 结构通过但完整字段/文案/数值 screenshot 尚未冻结 |
| S-06 | settings dialog：runs/variation/preserve，桌面 Modal | R-DYN | dialog, `aria-modal`, focus isolation | A-E2E field defaults, modal inert/aria-hidden, progress | PASS | 与参考尺寸/字体仍需视觉差分 |
| S-07 | 移动端 Drawer、safe area、settings focus restore | R-DYN/计划响应式；本地 390×844 约束 | CSS breakpoint + mobile trigger/drawer | A-E2E `verify_simulation_mobile_settings` geometry/focus | PASS | 参考站是否显示同等 Drawer 需补一次动态对照；否则记录有意偏离 |
| S-08 | Worker progress/cancel/supersede/failure fallback/cache | 计划 G7；参考只观察即时重绘，不公开 Worker | Controller Worker runner、bounded cache、sync fallback | A-E2E 2,500 run pending/progress/complete + unit race tests | PASS | 长时 worker/heap/kill 证据仍属性能 Gate |
| S-09 | 控件变化不重跑 Pine、不重订阅 Provider、不写 Storage | R-DYN 无新 backtest/candles | Controller updateSimulation isolates simulation | A-E2E rerun/websocket/market/storage guards | PASS | 扩展到刷新、多个 Cell、Worker 失败场景 |
| S-10 | no-trades/open-only/error/retry | 计划状态合同，参考空态未完整采集 | simulation unavailable/empty/retry branches | A-E2E simulation empty/error fixture + controller tests | PARTIAL | 各状态参考文案、尺寸和截图未冻结 |
| S-11 | Simulation 与其它 Tab 共用 immutable report，不重算策略 | R-DYN tab reuse | same report + explicit simulation projection/cache | A-E2E tab/re-entry and request guards | PASS | 原子 order/fill/curve report 尚未完成 |

## 9. Strategy Settings

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| ST-01 | Inputs/Properties 两 tab，Properties 字段和默认值 | R-DYN Settings 复核：capital/qty/pyramiding/commission/slippage/margin | `StrategySettingsPanel` schema-driven form | `tests/strategy-settings.test.mjs` + A-E2E field checks | PASS | 未冻结所有脚本 Inputs 的参考排序/控件样式 |
| ST-02 | 草稿修改不立即提交；Cancel/close/Esc 不重跑 | R-DYN 拦截请求计数 | draft state + close/cancel/Esc | settings unit/E2E and reference request evidence | PASS | 补浏览器事件计数 artifact（不仅源代码合同） |
| ST-03 | Reset defaults 只重置当前草稿，不请求 | R-DYN `qty 2 → Reset → 1`, no request | reset draft implementation | A-E2E reset value and request guard | PASS | 补 Inputs 与 Properties 混合草稿的回归 |
| ST-04 | Ok 一次批量提交 Inputs/Properties 后重跑 | 参考一次提交；本地策略重跑独立验证 | 显式 `batchPineSettings` 合并两种引擎执行；Vela 仍管理宿主状态 | 2026-09-30 recheck 新 dev/production 实际入口：两标签变化 1 update/1 run、参数读回和结果正确，无改动 0 update；两 engine 独立验证 | PARTIAL | F-07 和 O-02 原问题已独立关闭，失败提示可完整显示并可重新提交恢复；参考站完整错误行为和非法输入矩阵仍待 |
| ST-05 | min/max/step、日期、精度、单位校验 | R-DYN DOM validation attrs | schema field validators and input attrs | strategy-settings unit checks | PARTIAL | 缺全字段非法值矩阵及参考错误文案 |
| ST-06 | Settings 与 report revision/last-good/error 生命周期一致 | 计划 §7/§3.2 | Controller updates report after settings callback | controller tests | PARTIAL | 重算失败保留 last-good 的参考行为仍需冻结 |

## 10. Provider、市场和数据边界

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| PR-01 | 固定验收市场 Binance BTCUSDT · 1h，数据为 OHLCV Kline | R-DYN/计划 §1.5 明确基线 | Vela Binance provider + market identity mapping；新增本地 24 根 OHLCV/UTC/固定参数 fixture | A-E2E `verify_btcusdt_fixture`（24 bars/24 points、hash 绑定、零外部请求）+ A-PROVIDER live smoke | PARTIAL | 本地/registry 逐笔已通过；参考站非空 benchmark 与最终截图数值仍未冻结，故不升为 PASS |
| PR-02 | Binance 历史与 live 连接 | 项目 Provider contract；参考请求为 candles | existing Binance provider | A-PROVIDER `historyBars=5/live=true` | PASS | 5 bars smoke 不等于完整深历史/重连/限流验收 |
| PR-03 | Hyperliquid 历史与 live 连接 | 参考站 source discovery 仅作目录证据；本地功能范围含 Hyperliquid | existing Hyperliquid provider | A-PROVIDER `historyBars=5/live=true` | PASS | 无需把参考站其它 source 误写成本地支持 |
| PR-04 | provider/symbol/displaySymbol/timeframe 透传 Header | R-DYN Header；参考 symbol 显示规则需冻结 | `BacktestContext` → UI report fields | controller/viewer contract tests | PARTIAL | `BINANCE.US/BTCUSD` 与本地 `BTCUSDT` 的显示规则需 G0 冻结 |
| PR-05 | 只有市场/策略/参数变化触发 run；Tab/Simulation 不触发 | R-DYN network observation | event/revision guards | A-E2E request counts, simulation no-rerun guard | PASS | 多 Cell、快速切换和 websocket reconnect 计数待补 |
| PR-06 | OHLC 回测 vs tick/lower-timeframe execution | 计划 §8.5、TradingView 映射表；上游没有自动 Bar Magnifier | 本地 Fork 接入 provider-backed lower-timeframe OHLCV、四点 child replay 和显式 chart-OHLC fallback；1m/5m 秒级映射按 provider 边界禁用 | `bar-magnifier-runtime`、PineTS broker/worker parity、precision/UI contract tests | PARTIAL | 仍缺固定 BTCUSDT 逐 Fill 与 TV 对账、秒级历史、全部 calc_on_* / 复合订单语义；不能宣称完整 tick 等价 |
| PR-07 | 历史深度、partial forming、aborted history | 计划 §7/§8 capability 合同 | Adapter 暴露 `loaded/target/barsLoaded/oldestTime/progress/reason`，Domain/UI 保留 coverage；`ScriptRun.complete` 不再单独代表深历史完成 | adapter/controller history coverage tests；主 E2E、multi-cell、cross-browser、Provider smoke 通过 | PARTIAL | 缺真实 Binance 深历史中断/恢复浏览器证据；`aborted` 仍需真实网络故障注入 |

## 11. Storage、Favorite 与现有功能隔离

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| STG-01 | 回测计算结果不持久化；刷新后重新计算 | 计划 §11.2；参考结果由 workspace/session 复用 | Backtest report held in Controller/Store，未写 storage | A-E2E Viewer 前后 snapshot + mutation audit `0/0/0` | PASS | 需补刷新/崩溃恢复确认“重新计算”而非恢复旧结果 |
| STG-02 | Viewer open/close/tab/simulation 不写旧 key | R-DYN tab controls no request；本地独立性合同 | Viewer callbacks no storage calls | A-E2E `assert_storage_unchanged`、mutation audit | PASS | 允许 workspace key 的例外需在完整快照中解释每次变化 |
| STG-03 | `quant-tools:workspace:v2`、脚本、收藏、模板 schema 不变 | 计划 §2.3、`BACKTEST_REGRESSION_BASELINE.md` | Backtest feature mounted separately; storage facade untouched | A-OLD 22/22 + core E2E scripts/templates/favorites smoke | PARTIAL | 缺全量旧 fixture migration、key/value diff artifact和多次刷新验证 |
| STG-04 | Favorite 复用既有 FavoriteService，不复制状态 | R-DYN Header/legend favorite | Viewer callback → app favorite service | viewer contract + existing favorite tests | PARTIAL | 缺跨指标列表、图例、Viewer、刷新四向同步 E2E |
| STG-05 | Pine editor / personal scripts / templates / screenshot 不受影响 | 计划 §2.3、回归基线 | feature composition boundary，不接管这些模块 | A-E2E existing toolbar/editor/template/screenshot smoke | PARTIAL | 仍缺逐按钮次数、完整 DOM snapshot 和视觉 diff |
| STG-06 | Settings Inputs/Properties 由 Vela workspace state 管理 | R-DYN settings；计划 §11.2 | control adapter only submits Vela schema; report result transient | settings/controller tests | PARTIAL | 需旧 workspace 恢复后 settings/回测一致性证据 |

## 12. Lifecycle、并发和故障隔离

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| LC-01 | `createApp → destroy → createApp` 不重复 DOM/监听/Worker | 计划 §5.4/§11.4 | unified `destroy()`、feature cleanup、idempotent guards | lifecycle fixture `mounts/destroys/noopDestroys=7/7/1` | PASS | 仅开发 instrumentation；生产 lifecycle 计数为 null，需正式资源计数 |
| LC-02 | Viewer/Highcharts render destroy/re-entry 不留实例 | 计划 §5.4、参考切 Tab 复用结果 | `destroyReportCharts` before subtree replacement; generation guards | Highcharts renderer contract + E2E Analysis re-entry | PARTIAL | 缺 10 次循环 Highcharts/ResizeObserver/heap artifact |
| LC-03 | stale run/ledger/full series 不得覆盖新 revision | 计划 §7.4、G4b.2 | key/revision/runId/snapshotRevision/epoch checks | adapter/controller tests: run restart, stale full, full+tail, sync pending | PASS | order/fill/curve 尚未原子化，扩大一致性保证前需补 |
| LC-04 | `run.trades()` 延迟/reject/complete=false/旧 Cell 清理 | 计划 §7.4/§13.2 | single-flight/desiredRevision/cancellation/last-good | adapter/controller targeted tests | PASS | 需浏览器注入真实 worker/provider 延迟并记录请求计数 |
| LC-05 | 多 Cell/多策略隔离，后台结果不抢当前 Dock | 计划 §6/§7 | key=`cellId+indicatorId`，active-cell selection guard | `backtest-multicell-contract.test.mjs` + `npm run test:e2e:multicell`：2×2 fixture、后台 snapshot/error/late、stale revision/epoch、同 Cell 删除和空 Dock、destroy 资源回零 | PARTIAL | 浏览器状态/资源隔离已通过；完整应用多策略真实 Provider/Worker 长时与参考视觉差分仍待 |
| LC-06 | strategy→indicator、hide/show、remove 清理结果 | 计划事件表 | BacktestFeature event handlers and status transitions | adapter/controller tests + core E2E remove/hide smoke | PARTIAL | 缺所有事件的逐事件 trace、Provider/Worker/listener 计数 |
| LC-07 | 回测/报告/Simulation/定位失败只降级回测区域 | 计划 §2.3/§11.3、G9 | guarded diagnostics, retry/error view, app mount isolation | E2E fail resize/empty/error/worker fallback paths | PARTIAL | 缺 adapter throw、chart locate throw、storage unavailable、market timeout 全矩阵 |
| LC-08 | HMR/重复销毁/刷新后无残留 | 计划 G9 | destroy is idempotent；fixture runner 已验证无 HMR client 的一次性跨浏览器路径 | `npm run test:e2e:cross-browser` fixture 三引擎 hmr/websocket=`0`，资源销毁 `0/0` | PARTIAL | 仍需完整应用 HMR/reload 长时 runner 与 listener/Worker/Observer/DOM 计数 |
| LC-09 | live tick 只传尾点；不重复拉完整 ledger | 计划 §7.4/G4b.2 | reportTail + revision-aware ledger refresh | adapter race contracts; E2E market request guard | PARTIAL | 缺长时高频 tick、ledger request count和内存 trace |

## 13. 独立运行和本地依赖

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| I-01 | 运行时不请求 `app.luxalgo.com` 或其子域 | R-DYN URL 仅作为观察边界；计划要求替代 | 应用只用本地 Vela/PineTS +本地 Provider | A-E2E dev/prod `luxalgoRequests=0` | PASS | 保持 catch-all 守卫，禁止未来引入远程 chunk |
| I-02 | 不依赖未声明外部 HTTP(S)、CDN、远程字体/图标 | 计划 §1.4/§10/§12 | Highcharts 本地 chunk；SVG icons 本地；Provider 由 mock/注册表控制 | A-E2E `blockedExternalRequests=0` + `npm run check:dist:independence`（dist 6 files、forbidden matches 0、静态 HTML/CSS remote URLs 0）+ `npm run test:e2e:offline`（6 个登记 Provider 请求被阻断、unexpected/LuxAlgo=0）+ fresh clone build | PARTIAL | 仅证明生产壳在断网时不依赖未登记服务；真实无行情缓存绘图和 rollback 仍待 |
| I-03 | Highcharts 精确 13.0.0、本地按需加载、无 CDN | R-HTML Highcharts 13.0.0；计划 §3.5/G9 | root dependency `13.0.0`，local renderer/chunks | `check:dependencies`、build、E2E local chart hosts | PASS | 补产物 hash 和断网加载证据 |
| I-04 | PineTS/Vela-PineTS 使用本地源码版本和 Worker fingerprint | 计划 §9；engine audit | `packages/pinets`、`packages/vela-pinets` workspace/file deps，当前 `quant-tools-g8.1` / `reportSchemaVersion=4` | A-DEP fingerprint/sentinel、Vela-PineTS tests | PASS | 当前未改源码包与 registry 固定 fixture 逐笔一致仍未证明 |
| I-05 | Fresh clone、删除 Fork dist/node_modules/cache 后可复现构建 | 计划 §9.7/G9 | build scripts/prebuild 已存在 | `44ade5c` 临时 fresh clone：空 `node_modules`/Fork `dist` 执行 `npm ci`、`npm run build`、根 `npm test`，构建后 Git clean | PASS | 继续在发布候选 commit 上重复；不替代跨浏览器/回滚演练 |
| I-06 | 不复制参考 HTML、Next chunk、Cookie、账户状态 | 计划 §1.2/用户独立运行要求 | 上传 HTML 留在外部证据路径，未进入 app；无账户凭据代码 | `check:dist:independence` 禁止 reference host/Next/storage-state/cookie/email，当前 0 matches；E2E storage 0/0/0；fresh clone 产物清单和 `test:e2e:offline` 已复核 | PARTIAL | 仍需源码/public 全量扫描 artifact 与真实 rollback 记录 |
| I-07 | registry 包与本地 Fork 零行为变更对账 | 计划 G4a/G9 | 本地 Fork 已有修改；固定 fixture 内置一次性 `pinets@0.9.34` registry baseline | `npm run test:fixture:btcusdt` 2/2：3 笔交易、summary、24 点 reportSeries 与离线 baseline 对账；canonical fixture/report hash 已锁定 | PARTIAL | registry baseline 是一次性离线保存的可审计 artifact，仍需在更广错误/复杂成交样本上扩展；不能据此宣称整个 Fork 零行为变更 |
| I-08 | fork upstream SHA、local patch、schema、embedded SHA 一致 | 计划 §9.4 | build-info/fingerprint/sentinel contracts | `npm run check:dependencies` PASS（记录于基线） | PASS | 每次 Fork 改动继续把 fingerprint 写入 report 并重跑 |
| I-09 | 应用只从 package exports 导入，不深度导入 packages/src | 计划 §9.4/§13.7 | 当前 imports 走包 exports | architecture/dependency contract tests | PASS | 加静态扫描防止后续回归 |

## 14. Desktop / Tablet / Mobile 响应式

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| RSP-01 | 1440×900 桌面 Dock/Viewer 几何 | R-DYN 精确 Dock/Viewer 框与滚动区尺寸 | CSS/layout host + Dock/Viewer | A-E2E 部分 geometry checks | PARTIAL | 缺 reference/candidate/diff 三件套、DPR/字体元数据和 1px 门槛 |
| RSP-02 | 1024px 仍显示完整 chart/Dock | R-DYN 响应式边界 | CSS 未在 1024 隐藏回测区域 | A-E2E calendar/simulation width checks，非完整参考截图 | PARTIAL | 补 1024/1023 前后 1px 真实 Viewer/Dock 对照 |
| RSP-03 | `1023px` 及以下切为窄屏 Chart + Backtest 入口；`1024px` 保留 Dock | R-DYN 2026-09-28 viewport recheck：`1024` 为 Dock，`1023/901/900/390` 为 Backtest 入口 | Workbench 在 `<=1023px` 隐藏 Dock、取消 chart height reservation，显示 gauge `Backtest` 入口；Viewer 打开/返回共用同一生命周期 | `backtest-viewer-contract` compact breakpoint test；本地 BTCUSDT fixture 实测 `1023` 入口 / `1024` Dock | PARTIAL | 断点和入口行为已对齐；完整应用 shell 的各 viewport/DPR 截图差分、Viewer 窄屏滚动仍待 Final Gate |
| RSP-04 | Simulation 移动 Drawer、safe-area、焦点 | 参考移动行为未完全冻结；计划要求触摸可用 | local 390px drawer/mobile settings controls | A-E2E mobile geometry/focus assertions | PARTIAL | 若参考站确实隐藏该入口，需记录为有意偏离并更新范围 |
| RSP-05 | Calendar ≤767px 横向滚动，不锁死纵向 | 计划 §10.3；参考日历窄布局待完整截图 | CSS min-width 760 + overflow-x | A-E2E 1025/…/640 width probes | PASS | 仍需 DPR2、横屏、200% zoom 和实际 keyboard scroll |
| RSP-06 | Dock KPI/table 横向滚动和触摸 hit area | 计划响应式约束 | max-content KPI与overflow | audit-evidence/2026-10-01-recheck-ledger-visual/visual/results.json：三浏览器四视口12/12无重叠、文字包含、末项可达 | PARTIAL | V-07目标缺陷关闭；实体触摸/完整表格/参考像素差分仍待 |
| RSP-07 | 1920/1440/1280/1024/768/390/360，portrait/landscape，DPR1/2 | 计划 §13.5 | 部分 CSS breakpoints | 目前仅局部 390、1024/… calendar E2E | PARTIAL | 完成全 viewport matrix 和 screenshot diff |

## 15. Accessibility 与不可见语义

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| AX-01 | Viewer tabs 使用 tablist/tab/tabpanel，支持 arrows/Home/End | 计划 §10.4；参考静态 tab 无完整 ARIA | local roles, aria-selected/controls, keyboard handler | A-E2E selected/label checks、viewer contract | PASS | 需要键盘-only 全路径录制，不只 selected 属性 |
| AX-02 | Dock separator/collapse 有 truthful ARIA | 计划 §10.4 | separator value attrs、collapse controls/expanded | strategy-settings contract + G3a DOM checks | PASS | 补 screen reader name/state 与实际键盘 sequence |
| AX-03 | Viewer open 时 background inert/aria-hidden，关闭原子恢复 | 计划 §10.4、local feature comments | chart suppression MutationObserver、simulation modal isolation | A-E2E modal isolation/restore | PASS | 扩展到 Viewer（非 Simulation）全页面和 Vela menu/focus tree |
| AX-04 | 表格 caption/scope/aria-sort、Calendar grid semantics | 计划 §10.4 | table semantics, calendar row/gridcell, sort attrs | A-E2E table/calendar ARIA + unit contracts | PASS | axe 扫描尚未执行，不能由 DOM 合同替代 |
| AX-05 | 图表有可读描述/数据表，不只靠红绿 | 计划 §10.4 | SVG fallback/`desc`/aria-label/manual descriptions | A-E2E Simulation/Analysis SVG description checks | PARTIAL | Performance/Dock 全图表、键盘 tooltip 和色盲对比仍待 |
| AX-06 | Loading/result/error live region 与 focus recovery | 计划 §10.4 | Viewer transient states now use atomic `role=status`/`aria-live=polite` and `role=alert` for errors; status/error/retry and simulation focus restoration | `tests/backtest-viewer-contract.test.mjs` live-region contract + A-E2E Simulation progress/focus | PARTIAL | 仍需浏览器真实 announcement trace、production/跨浏览器和 VoiceOver 证据 |
| AX-07 | WCAG 2.2 AA、axe critical/serious=0 | 计划 §10.4 executable threshold | 本地 axe-core 4.10.3 注入四 viewport fixture，保留自定义 ARIA/对比度检查 | `npm run test:visual:a11y`：四 viewport critical/serious=0、axe violations=0；artifact 为本地 gate 输出 | PARTIAL | 仅完成 dev/local candidate；prod、VoiceOver/真实屏幕阅读器和参考站差分仍待 |
| AX-08 | Chromium + macOS VoiceOver smoke | 计划 §10.4 | 语义大部分已实现 | 无 VoiceOver recording/log | BLOCKED | 实机执行 keyboard/VoiceOver smoke并留档 |
| AX-09 | reduced-motion、focus visible、触摸 hit area/对比度 | 计划 §10.3/10.4 | CSS reduced-motion、focus-visible、扩大部分按钮 | `npm run test:visual:a11y` computed geometry/contrast audit；结构通过，Performance accent `3.692:1` 已记录 | PARTIAL | 产品确认 accent 对比度或调整 token；补 target-size/跨浏览器测量 |
| AX-10 | 不复制参考重复 ID、空 aria-label、隐藏元素可聚焦缺陷 | 计划 §10.4 | local IDs/hidden filtering/focusable helper | `npm run test:visual:a11y` 四 viewport duplicate-id/unnamed/ARIA reference scan = 0 | PARTIAL | 全 Viewer/Dock axe + hidden/focus tree 和屏幕阅读器证据 |
| AX-11 | Strategy Settings 实际Tab顺序、Escape与模态焦点 | 本地aria-modal合同 | inert/互斥已生效，Tab trap、触发按钮回收和宿主 fallback 已实现 | `audit-evidence/2026-10-01-r09-recheck-3/pointer-keyboard-workbench-rerun.json`、`settings-tab/results.json`、`gates/e2e.status.json`；三浏览器 modal/traversal 专用探针 | PASS（当前契约） | 当前 Workbench pointer-open、keyboard Enter、Cancel 三引擎均回 Settings 触发按钮；报告移除时回图表 Canvas。VoiceOver、实体 Safari Full Keyboard Access 和跨设备触摸仍由 AX-08/Final Gate 单独覆盖 |

## 16. Performance、资源和可扩展性

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| PF-01 | 聚合 O(trades + buckets)，每 revision memoize | 计划 §11.1 | pure selectors + Calendar cache + simulation population cache | `npm run benchmark:backtest` 1k/10k/100k p50/p95 JSON；浏览器 Gate 另证 10k/100k 分页/曲线同步 p95 `38.4/40.6ms` | PARTIAL | 仍需独立 selector 聚合 trace 与跨浏览器/生产 artifact |
| PF-02 | Trades Log 大账本虚拟列表/分页 | 计划 §11.1 | 200 行分页；排序 entries 携 sourceIndex、缓存排序结果，caption/定位/键盘语义保留 | `tests/backtest-performance.test.mjs` + `QUANT_PERF_ARTIFACT=1 npm run test:e2e:performance -- --strict`：10k/100k DOM 均 200 行，分页同步 p95 `38.4/40.6ms`，trace/heap JSON 已留档 | PARTIAL | 连续滚动/虚拟列表仅在产品要求时补；参考视觉和跨浏览器仍待 |
| PF-03 | 大曲线按像素 downsample，保留原始 tooltip | 计划 §11.1 | Dock/Viewer render series 上限 2,000 点；bucket 保留端点/低高 extrema；`tooltipPoints` 原始序列 + 二分 nearest hover | 单测 100k extrema/nearest；浏览器 Gate raw→render `10k/100k→2,000`，Highcharts trace 已留档 | PARTIAL | range/多 series tooltip、参考视觉和跨浏览器仍待 |
| PF-04 | Simulation 1k/10k runs Worker/cancel/progress | 计划 §11.1/G7 | synchronous small + Worker threshold/cancel/progress，runs 上限 10k | `QUANT_PERF_ARTIFACT=1 npm run test:e2e:performance -- --strict` 真实 Worker 10k `129ms`、progress `0→10000`、bandPoints=17、heap +1.51MiB | PARTIAL | cancel latency、生产 Worker 生命周期和跨浏览器仍待 |
| PF-05 | Dock drag/reflow ≥50 FPS，长任务 p95≤50ms | 计划 §11.1 threshold | reflow/ResizeObserver hooks | 固定 Chromium 10k/100k：59.87/59.91 FPS，long-task p95=0ms；原始 trace 已留档 | PARTIAL | 参考 screenshot、WebKit/Firefox、不同 DPR/窗口仍待 |
| PF-06 | 10 次 open/close 后 heap 增量≤20MB、Highcharts/Observer=0 | 计划 §11.1 | destroy/generation guards；renderer 暴露 `getReportChartResourceStats()` 统计活动 Chart/ResizeObserver | 固定 Chromium 10k/100k：heap +0.41/+0.39MiB，循环后 1/1、销毁后 0/0；trace/JSON 已留档 | PARTIAL | 生产发布/HMR、跨浏览器和完整 heap snapshot 仍待 |
| PF-07 | 新增生产 bundle ≤100KB gzip | 计划 §11.1；基线已有历史体积 | Highcharts/Simulation 分 chunk；主包有既有增长 | A-DEP build 输出，但当前批次没有按阈值 artifact | PARTIAL | 重新生成基线/候选 bundle report，批准或收缩超额 |
| PF-08 | Tab/Simulation 不重复完整 ledger/request | R-DYN no new backtest-run/candles | selector/cache/single-flight | A-E2E request guard; adapter race tests | PASS | 补多策略/live 高频和 network waterfall |
| PF-09 | Highcharts/Observer/Worker 在隐藏/销毁时释放 | 计划 §5.4/§11.1 | explicit destroy, worker terminate path；Chart/Observer 计数器和 generation guard | 单测/renderer contract + 固定 Chromium 10 次 Dock/Viewer 循环与 Simulation Worker 10k；资源回零证据已留档（当前 artifact） | PARTIAL | 异常构造、HMR、生产生命周期、跨浏览器仍待 |
| PF-10 | Chromium/WebKit/Firefox 支持范围 | 计划 G9 | `tests/e2e_cross_browser.py` 对固定 BTCUSDT fixture 提供三引擎 smoke；不改变生产运行时 | `npm run test:e2e:cross-browser`：Chromium、Firefox、WebKit 均 `trades=3`、`netProfit=-1.6809529999998745`、page/response/external/ws 错误为 0，资源销毁后 `0/0` | PARTIAL | 仅覆盖确定性 fixture 的引擎兼容性；完整应用视觉、Provider、VoiceOver 和不同 DPR/viewport 仍待 |

## 17. 引擎、数值和最终独立性 Gate

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| ENG-01 | Summary/Performance/Analysis/Simulation 使用命名人口，不强行统一分母 | R-DYN `13/61.54%` vs Analysis `14/57.14%` vs Simulation 13 | domain selectors `closedTrades/openTrades/analysisRows/simulationPopulation` | domain/controller tests + documented fixture rules | PARTIAL | 固定 BTC reference/local fixture 逐字段对账仍未完成 |
| ENG-02 | close mark-to-market equity/drawdown/benchmark exact series | 计划 G4b.2 contract（参考页面本身不公开内部 series） | local PineTS/Vela-PineTS reportSeries/reportTail | adapter/Worker/in-process tests + E2E exact-equity | PASS | 仅表示本地契约已验证；不表示与参考站数值一致 |
| ENG-03 | currency、max contracts、entry/exit bar index bridge | 参考 UI 无独立可见字段；engine audit | G4b.3 bridge + capability validation（当前 Fork 身份升级为 G8.1/schema 4）；raw audit relation 由独立 `auditLedger` capability 管理 | Vela-PineTS `27 files / 261 tests`、G4b.3 targeted bridge tests、controller/domain tests | PASS | raw capability 不由本行扩大；缺失/过期 audit envelope 仍 false，边界见 [`BACKTEST_LEDGER_AUDIT.md`](../reports/BACKTEST_LEDGER_AUDIT.md) |
| ENG-04 | 固定 BTCUSDT/1h candles、策略、参数下逐笔 Entry/Exit/Size/P&L/MFE/MAE | 计划 G0/DoD；2026-09-30 参考 workspace 提供真实 Moon Phases 13 笔/14 行分析样本，但不是同一固定 fixture | 固定 UTC/24 bars/Pine source/parameters；应用层真实执行并输出 3 笔 ledger | package fixture 2/2 + dev browser fixture：Entry/Exit/Size/P&L/MFE/MAE、summary、reportSeries hash 与 registry baseline 对账；参考动态截图/DOM 已归档 | PARTIAL | 1h 基线仍缺 reference/local 同 hash 逐笔数值对账和复杂成交 fixture；另见 ENG-04a 的 15m SMA 9/21 固定响应算术 PASS |
| ENG-04a | LuxAlgo BTCUSDT/15m 5,000 bars 上的 SMA 9/21 有限对账 | 已保存真实参考原始响应/完整53 closed与1 open | 当前Node、Chromium PineEngine/PineWorkerEngine重新执行三种源码，280closed+1open | audit-evidence/2026-10-01-recheck-ledger-visual/parity/reference-v-current-comparison.json；536字段和10个realized汇总一致 | PASS（已采字段）；完整PARTIAL | 仅53/280 closed=18.93%，缺227；不能证明参考执行字节hash；R-08及E-01口径风险另列 |
| ENG-05 | raw order/fill、reversal relation、partial close/pyramiding | 计划 G4b/G6/G8 | PineTS fork 有 append-only `_order_events/_fill_events`；本地 Vela-PineTS 通过 `auditLedger` 公开 identity-bound DTO，adapter/domain 动态开启 raw capabilities；上游 Vela 基线仍 false；`cash_per_order` 多 lot close 已按一次 broker order 计费并按数量分摊 | 根 `241/241`；PineTS strategy `23 files / 126 tests`；adapter/domain/controller 与 Vela-PineTS raw-ledger 既有套件通过 | PARTIAL | 仍缺完整复杂成交 fixture、同 timestamp/OCA/实时复合订单、TradingView 逐 Fill 和 raw UI 展示；不可把首版桥接升级为完整 broker parity |
| ENG-06 | Bar Magnifier/低周期撮合及 applied precision | 计划 §8.5；TV parent→child 表与 provider 数据边界 | G8.1 PineTS/Vela-PineTS Fork 已支持经过校验的 lower bars、四点路径、覆盖率和 fallback reason；`calc_on_order_fills`/`calc_on_every_tick` 首版已在 chart-OHLC/lower-timeframe 边界驱动不增报告点的脚本重算；应用 capability 仅在完整覆盖时标记 `lower-timeframe` | `bar-magnifier.test.ts`、`bar-magnifier-audit.test.ts`、`calc-on-recalculation.test.ts`、runtime/worker parity、adapter/UI precision tests | PARTIAL | 实时 tick、raw order/fill、完整复合订单语义、固定 BTCUSDT 逐 Fill 对账和跨浏览器 UI 仍待；G8 完整 Gate 未关闭 |
| ENG-07 | Simulation 固定 seed 逐值与参考一致 | 参考 chunk seed `12648430`；本地实现同 seed | deterministic PRNG/formulas | unit/E2E internal determinism | PARTIAL | 需同一 closed ledger 与参考输出逐 run/percentile 对账 |
| ENG-08 | 参考站/远程资源完全不是运行依赖 | R-DYN 网络仅观察；计划独立运行硬标准 | local Vela/PineTS/Provider/Highcharts | dev/prod LuxAlgo=0、blocked external=0；最终产物扫描、fresh clone 构建和 `test:e2e:offline` 通过（Provider 请求仅计数/阻断） | PASS | 真实上一制品 rollback 与无行情缓存行为仍需单独验证 |
| ENG-09 | `max_intraday_loss`、`max_intraday_filled_orders`、`max_cons_loss_days` 风险规则按交易所日切换 | Pine 风险 API 语义；参考站未公开内部 broker 事件 | PineTS 以 `syminfo.timezone` 计算日键，记录日初 equity/netprofit、成交订单数和连续亏损日；intraday 状态跨日重置，run-level halt 保留 | `risk-intraday.test.ts`：5/5；strategy 定向 21 files/114 tests；streaming snapshot 自动回滚风险状态 | PARTIAL | chart-OHLC 仍无 tick 级风险检查；需 TradingView 固定样本逐事件对账并补异常时区/DST/低周期边界 |
| ENG-10 | Pine bare `error()` runtime failure | Pine runtime error contract；参考站不公开实现细节 | Core bare built-in now throws typed `PineRuntimeError`, matching `runtime.error()` failure boundary | `core-error.test.ts` 2/2 | PARTIAL | Error UI/host mapping and cross-worker serialization remain separate gates |

## 18. 现有功能非回归与发布回滚

| ID | 对标项 | Reference evidence | Local implementation | Automated evidence | 状态 | 差异 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| NR-01 | 顶部工具栏按钮只注册一份、无重复点击/面板 | 计划 §2.3/§11.4；参考工具栏为宿主能力 | Backtest feature composition boundary，不修改 `main.ts` 工具动作 | A-OLD 22/22 + core E2E toolbar smoke | PARTIAL | 缺每个按钮点击次数、DOM snapshot、视觉 diff |
| NR-02 | Indicators 分类/收藏/On chart/个人脚本保持 | 计划既有功能合同 | 未改 Indicator Manager/Favorite Service 内部实现 | A-OLD + E2E category/script/favorite smoke | PARTIAL | 缺跨 Viewer favorite 全流程和完整旧快照 diff |
| NR-03 | Pine editor、模板、布局、截图保持 | 计划既有功能合同 | 独立 BacktestFeature host/cleanup | A-OLD/E2E partial smoke | PARTIAL | 需要故障注入后逐项确认仍可用 |
| NR-04 | Provider URL、OHLCV mapping、订阅数不变 | 计划 §11.4 | Backtest reads adapter context, does not replace provider registry | A-PROVIDER + E2E market requests | PARTIAL | Provider subscription count、重连和多 Cell trace 缺失 |
| NR-05 | Backtest host/adapter/render/worker 出错不阻断旧 Workspace | 计划 G9 failure isolation | guarded construction/diagnose/retry | E2E fail ResizeObserver/mount fixture only | PARTIAL | 补 adapter/report/worker/chart-locate/storage/market timeout 注入矩阵 |
| NR-06 | feature flag/kill switch 与发布回滚不改写旧 Workspace | 计划 §12.4/G9 | composition root 的 `VITE_ENABLE_BACKTESTING` opt-out kill switch；关闭时不创建回测 host/订阅 | `npm run test:e2e:kill-switch`：production preview、回测子树/动态 host=`0`、旧工具栏/Indicators/Pine editor/Templates 可用、Storage 状态不变、blocked/LuxAlgo=`0/0`；`BACKTEST_RELEASE_ROLLBACK.md` 记录 offline smoke 与 manifest 流程 | PARTIAL | 仍需上一已验证制品 hash、真实 rollback、清缓存 fresh clone 和旧 schema 恢复 |
| NR-07 | 验证顺序：先原有回归，再新增测试 | 计划 §0/§12.0 | 文档规定固定顺序 | 当前批次先 `npm run test:regression:existing` `22/22`，再 `npm test` `219/219` | PASS | 每个后续 commit 保留时间、环境、完整输出和工作树状态 |

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

上述证据不能替代参考站逐笔/视觉差分、完整复杂订单、生产 HMR/VoiceOver 和真实 rollback，相关行继续保持 PARTIAL。

### 19.1 可以暂时视为局部通过的能力

- 本地 Dock/Viewer/四 Tab/Simulation 的主要 DOM 入口和状态机已存在。
- 现有回归、当前根测试记录、TypeScript、依赖 fingerprint、构建、开发/生产 E2E、Binance/Hyperliquid smoke 已有证据。
- Viewer/Simulation 的请求、Storage 和部分生命周期守卫已通过；运行时没有观察到 LuxAlgo 请求。
- Trades Analysis 的结构、Trades Log 的当前列/排序、Calendar 聚合和 Simulation 应用层合同已有较完整的单测与 E2E。

这些结论只能用于对应行，不得向“完整一比一”外推。

### 19.2 当前明确阻断 Final Gate 的项目

1. 固定 Binance BTCUSDT/1h fixture 与参考站的逐笔、汇总和最终截图对账（本地/registry 对账已通过）。
2. Performance 非空 benchmark、精度/单位，尤其 `Strategy Outperformance` 的参考证据。
3. Entry/Exit 精确 bar/marker 定位，以及 reversal/partial-close/pyramiding/raw fill relation。
4. Bar Magnifier 的完整 TradingView 低周期/逐 Fill 语义和 applied precision 对账（第一版四点回放/fallback 已接入）。
5. Desktop/mobile 参考差分；本地 mobile 与参考站约 900px 以下行为目前存在未决分歧。
6. 完整视觉 diff、axe/WCAG、keyboard-only、VoiceOver，以及完整应用而非 fixture 的跨浏览器证据。
7. 10k/100k 数据、虚拟列表/downsample、拖拽 FPS、heap/实例资源计数。
8. 生产 destroy/remount、故障注入全矩阵、feature flag/rollback（测试 fixture 的无 HMR smoke 已通过）。
9. 最终产物无远程/参考资源静态扫描、fresh clone/清缓存构建和生产断网壳 smoke 已通过；仍待真实 rollback 演练。

### 19.3 推荐执行顺序

```text
G0 冻结 BTCUSDT/1h + 参考截图/DOM/请求
  ↓
固定 fixture 逐笔对账（先 registry/local，再 reference/local）
  ↓
补 chart focus、复杂成交、Bar Magnifier 完整语义/逐 Fill（G8）
  ↓
Desktop/mobile visual diff + a11y/keyboard/VoiceOver
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
