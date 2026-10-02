# TODO

## 2026-10-02 首次加载优化分支复核（当前状态）

本轮基于 `feature/startup-loading-optimization` 的当前源码重新执行，不沿用旧 fixture 作为唯一证据。启动优化计划见 [STARTUP_LOADING_OPTIMIZATION_PLAN.md](docs/architecture/STARTUP_LOADING_OPTIMIZATION_PLAN.md)。

- [x] D-01 新策略首轮上下文缺少 `trades` 时不再误判为已结算空账本；历史完成后立即挂载、晚挂载、两种引擎及 hide/show/市场切换复核通过。
- [x] Provider live 生命周期：Binance 异步 `spotWsBase()`、Hyperliquid 重连、迟到 `onopen`、嵌套订阅和重复 unsubscribe 均有回归测试；专项 7/7 通过。
- [x] 根回归：`npm test` 467/467；Provider/storage/progressive 专项、TypeScript 与 `git diff --check` 通过。
- [x] S1/S2 本轮补强：symbol index 的 `metadataCacheTtlMs <= 0` 语义与 REST 元数据一致；模板状态校验；渐进短页 genesis 探测及失败门控均有回归测试。
- [x] PineTS 测试分流：`npm --workspace packages/pinets run test:offline` 提供 1,637 个离线测试；`test:network` 显式保留联网覆盖，网络故障不再混入启动优化本地门禁。
- [x] S4 bundle threshold：新增 `npm run check:bundle-size`，对 main/worker/highcharts raw 与 gzip 产物建立可执行预算门禁。
- [ ] 启动优化 Final Gate：本轮补测 Chromium/Firefox/WebKit 首绘与 getter/methods 存储故障均通过；完整冷/热 p95、长时 Provider/断网恢复、实际线上入口、部署制品 rollback、完整 Provider/品种/模板回归仍未关闭。
- [x] 本地 release manifest/verify：旧 checkout、dist 篡改拒绝及当前 dist 完整性均通过；部署平台 slot rollback/CDN 缓存恢复仍需线上验收。
- [x] Provider index 恢复周期：缓存过期后的重复故障可再次 fallback/retry/re-register；malformed symbol descriptor 不再污染交易品索引，ticker 外层空白会被归一化。
- [x] 历史点位恢复周期解析严格区分 `M` 月与 `m` 分钟；Workspace 历史预算和 runtime storage 输入边界已补回归。
- [x] Bar Magnifier lower-feed 对超大/非安全周期值安全降级，不构造不安全范围或 limit；补充 Vela-PineTS 回归。
- [x] `request.security` secondary feed 对 resolved malformed OHLC、坏 getter、非法 volume、重复和乱序时间戳安全归一，同时保留 rejected Provider error metadata；补充 Vela-PineTS 回归。
- [x] 本轮回归：根测试 468/468、Vela-PineTS 288/288、Provider network/history 专项通过、TypeScript、build、startup、依赖契约、dist 独立性、bundle budget 和 `git diff --check` 通过。

## 2026-10-01 R-08～R-11 修复后独立复查（当前状态）

详见 [BACKTEST_R09_RECHECK_3_2026-10-01.md](docs/backtesting/reports/BACKTEST_R09_RECHECK_3_2026-10-01.md)、[R-09 新证据](audit-evidence/2026-10-01-r09-recheck-3/README.md) 与 [BACKTEST_R08_R11_RECHECK_2026-10-01.md](docs/backtesting/reports/BACKTEST_R08_R11_RECHECK_2026-10-01.md)。本轮不继承修复记录 PASS；本轮重新执行真实页面、三浏览器 pointer/keyboard 探针和完整项目门禁。

- [x] R-08：Performance All/Long/Short 与 Outperformance 当前页面口径可复算；双引擎 8/8、真实 Binance 页面复核通过。
- [x] R-10：市场/副周期竞态与旧 run fence；双引擎等待期不再 ready/Simulation。
- [x] R-11：503/429/超时/非法 JSON、Retry 12,500 根、旧请求 supersede、共享 Provider 多 Cell；独立矩阵 18/18，双 Cell 复核通过。
- [x] R-09 完整焦点生命周期：Tab/Shift+Tab/Escape/busy 及真实 Workbench pointer-open 三浏览器均回到 Settings 触发按钮；主 E2E 通过。
- [x] D-01 动态历史绑定：本轮修复“idle 且缺少 trades 字段被误判为空账本”的边界；独立历史完成后立即挂载、晚挂载和延迟适配器流程均未再观察到 ready + 空账本。完整参考站逐笔 golden 仍另行开放。
- [ ] 完整参考站逐笔 golden（仍缺 227 closed）、复杂撮合/Bar Magnifier、真实 WS/长时故障、全量像素对账、VoiceOver/跨设备、bundle threshold、rollback。

本次文档刷新后再次执行 `npm test`、Vela-PineTS、TypeScript、build、依赖契约、dist 独立性、主 `npm run test:e2e` 和 `git diff --check`，结果通过；新证据目录包含三浏览器 pointer/keyboard、Settings traversal 及结构化门禁 status JSON。R-09 当前契约关闭，但整体 **PARTIAL**；Replay 仍不在当前阶段范围。

## 2026-10-01 R-08～R-11 修复后复核（历史记录；当前状态见上一节）

详见 [R-08～R-11 修复记录](docs/backtesting/reports/BACKTEST_R08_R11_REMEDIATION_2026-10-01.md) 与 [新证据](audit-evidence/2026-10-01-r08-r11-remediation/README.md)。

- [x] R-08 Performance 收益口径：MTM 总收益、多空可证明分项、Outperformance 统一公式；对冲缺少逐腿估值时不伪造方向值（后续独立复查继续通过）。
- [x] R-09 WebKit Settings Tab/Shift+Tab、Escape 与 busy 焦点约束；该历史批次的合成探针通过；后续独立复查发现真实 WebKit pointer-open 后 Escape 的 focus return 边界，当前仍未关闭。
- [x] R-10 市场/副周期竞态与旧 run fence；双引擎六场景及旧 run 注入通过（后续独立复查继续通过）。
- [x] R-11 Provider 503/429/timeout/invalid JSON、Retry、真实空历史、共享 Provider 多 Cell 隔离；双引擎故障矩阵18/18，真实双 Cell 通过（后续独立复查继续通过）。
- [x] 同 id Cell 重建、切市场时 Retry Promise 绑定实例/代次/市场，不复用旧请求（后续独立复查继续通过）。
- [ ] 完整逐笔 reference golden：仍缺 227 closed；精确执行 source bytes 仍需重新冻结。
- [ ] Bar Magnifier/partial fill/pyramiding/reversal/OCA 等复杂撮合及默认 Provider 深历史/partial policy。
- [ ] 长时 Provider 故障、跨设备/VoiceOver、整体像素 diff、bundle threshold、实际 rollback 等 Final Gate。

整体仍为 **PARTIAL**；Replay 按用户要求不在本阶段范围。

## 2026-10-01 账本与视觉修复（修复者过程记录）

修复记录与新证据见 [BACKTEST_LEDGER_VISUAL_REMEDIATION_2026-10-01.md](docs/backtesting/reports/BACKTEST_LEDGER_VISUAL_REMEDIATION_2026-10-01.md)。以下旧审计和旧失败保留追溯，不作为本轮通过依据。

- [x] SMA-UI-01：默认首次添加策略恢复完整 KPI/交易；新真实 Binance.US 500-bar、12 次采样、真实 WebSocket frame 和单 tick 停止对照通过。
- [x] D-01 正常启动：接管初始历史代次；Controller terminal/readiness 与账本发布条件统一；两种真实引擎无需 reload/tick 即完整首发。
- [x] V-04/V-05/V-07/V-08：移动 KPI、关闭按钮、Settings 可见图标、SVG 实例 ID；三浏览器新 DOM/交互验证通过。
- [x] D-01 扩展：生产工厂提前观察 history，晚挂载恢复已知依据；原始 adapter 不再 ready+unknown；工厂真实浏览器与销毁验证通过。
- [x] 深历史时序：两种真实引擎 × 12,000 根市场切换、36→2,000 depth-only 四组通过；挂起首个旧range请求时立即失效旧ready，补齐后恢复。
- [x] V-03：图表/Viewer 本地 BTC/ETH SVG 统一，真实图表解码/导出与未知资产 fallback 验证通过。
- [x] V-10 modal 部分：双弹窗及三浏览器各 14/14；精确视觉几何仍开放，不将 V-10 整项关闭。
- [ ] 完整逐笔 golden、Provider 深历史/partial policy、复杂撮合、整体像素对账、长时/VoiceOver/rollback 等 Final Gate。Replay 除外。

## 2026-09-30 独立参考对账与真实 Provider 复核（修复前记录）

最新综合报告：[BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md](docs/backtesting/reports/BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md)。固定 LuxAlgo 5,000-bar 响应上的用户 SMA 9/21 与本地 PineEngine 算术 parity 已通过；2026-10-01 全新浏览器流程再次确认本地默认 Binance.US 500-bar 真实 UI 的 ledger 指标仍为空、Viewer readiness 未完成，证据见 [independent real-provider recheck](audit-evidence/2026-10-01-independent-recheck/README.md)。D-01 history/strategy insertion race 和视觉 V-04/V-05 仍开放。整体 Final Gate 仍为 **PARTIAL**。

- [x] 固定 provider response + 固定窗口的 SMA 9/21：参考站与本地 PineEngine Net P&L `-435.20`、Gross Profit/Loss、Max DD、96/184、Profit Factor `0.992` 一致；open row 的 280/281 人口差异已记录。
- [ ] 默认本地应用改为可对账的 provider/partial policy，并修复真实 500-bar ledger/readiness；不能用固定引擎结果替代 UI 链路。
- [ ] D-01、移动 KPI 溢出、Settings close 默认样式、宿主壳层、复杂撮合、VoiceOver、rollback 等 Final Gate。

## 2026-10-01 动态深审 D-01 修复

- [ ] D-01：已增加 partial/pending 门控并通过单测，但两种真实引擎动态探针仍观测到首个 status=ready、history.complete=false、trades=0；不能关闭，需继续定位 Controller/adapter 首个快照来源。详见 [BACKTEST_DYNAMIC_DEEP_REMEDIATION_2026-10-01.md](docs/backtesting/reports/BACKTEST_DYNAMIC_DEEP_REMEDIATION_2026-10-01.md)。
- [ ] 继续完整参考站逐笔字段（Entry/Exit/Size/P&L/MFE/MAE）对账、复杂撮合/Bar Magnifier、真实 Provider 深历史故障、VoiceOver/跨设备/长时资源、bundle threshold 和实际 rollback。

## 2026-09-30 动态深审（历史快照）

最新综合报告：[BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md](docs/backtesting/reports/BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md)。本轮使用新启动的本地服务、独立 Chromium 动态探针和当前源适配器 probe；旧测试集、旧 fixture、旧修复记录只作为场景索引。

- [x] R-05/R-06/R-07 当前适配器独立 probe：9/9 通过；新证据见 [dynamic-deep](audit-evidence/2026-09-30-dynamic-deep/README.md)。
- [x] 两种真实 Pine 引擎、Viewer 四 Tab、Simulation、Settings 失败恢复、EMPTY/hide/show、重叠市场/周期、多 Cell、重复挂载和销毁资源动态路径已复查。
- [ ] **D-01**：图表已宣布初始 `history:complete` 后立即新增策略，首个快照可能 `ready` 但 `history.complete=false`、交易数为 0、`canSimulate=false`，而引擎原始 context 已有 closed trade；两种引擎均复现，需修复并补真实浏览器证据。
- [ ] 参考站同数据逐笔/汇总对账、复杂撮合/Bar Magnifier/partial fill/复合订单、真实 Provider 深历史故障链路、跨设备/VoiceOver/长时资源、bundle threshold 和真实制品 rollback。

当前整体回测计划仍为 **PARTIAL，Final Gate 未关闭**；不要用 root/Vela 测试总数或参考站动态截图宣称全部完成。

## 2026-09-30 第四轮独立复查（历史快照）

最新报告：[BACKTEST_AUDIT_RECHECK_4_2026-09-30.md](docs/backtesting/reports/BACKTEST_AUDIT_RECHECK_4_2026-09-30.md)。R-06/R-07 后续修复记录见 [BACKTEST_RECHECK_4_REMEDIATION_2026-09-30.md](docs/backtesting/reports/BACKTEST_RECHECK_4_REMEDIATION_2026-09-30.md)，原第四轮失败证据保留。

- [x] **R-05**：synthetic snapshot 已显式提供 `ledgerRevision`；独立浏览器加载 Simulation fixture 通过，开发 E2E 重新通过。
- [x] **R-07**：EMPTY 后新增策略、迟到旧 market/load/history 事件、旧 run metadata 均已增加 cell 级 noData/市场归属/清理门控。
- [x] **R-06**：mixed tick 缺少 `trades` 时明确拒绝；合法同 run/non-regressing 过渡及后续 full recovery 保留，旧 run/retry 仍拒绝。
- [ ] 继续参考站逐笔/汇总对账、完整撮合/Bar Magnifier/复合订单、真实 Provider 长链路、跨设备/长时资源、VoiceOver、bundle threshold 和实际制品 rollback 等 Final Gate。

局部真实引擎和 smoke 通过不代表整个回测计划完成。证据归档见 [audit-evidence/2026-09-30-recheck-4/README.md](audit-evidence/2026-09-30-recheck-4/README.md)。

## 2026-09-30 第二轮独立修复复核（历史记录；当前状态见第四轮）

对象为 `feature/backtest-workspace-build` 的 HEAD `53ab05795f45e5440eba1c1513b3bb63a659b9ae` 加最新未提交修复。相对上轮有 7 个业务文件改变。本轮重新构建、拉起 dev/production 服务并编写全新探针；未沿用仓库测试、旧审计或修复者结论作通过证据。详见 [BACKTEST_AUDIT_RECHECK_2_2026-09-30.md](docs/backtesting/reports/BACKTEST_AUDIT_RECHECK_2_2026-09-30.md)。

- [x] R-01 原场景：摘要先/后于 full 均不再清空交易账本。
- [x] R-02 原场景：full/summary 正反成功/错误顺序均正确保留完整结果或错误。
- [x] R-03 原场景：失败 tail 恢复后的 Retry 拒绝旧 run，匹配身份可恢复。
- [x] R-04 原场景：两类真实引擎静态图表晚加策略、hide/show 和串行市场切换均正确。
- [x] O-01：显式拒绝非普通 DTO；普通数据保持隔离/冻结，实际 Worker 普通数据可用。
- [x] O-02/F-07：真实 dev/production 故障后停用旧报告，重读宿主、重开及完整 Apply 恢复；正常合并仍只一次更新。
- [x] O-03/F-06/F-09：真实金额轴不再显示浮点尾数，编号/Open 及定位正常；MTM/已实现口径分别验证。
- [x] F-03/F-04/F-05/F-08：fresh 类型/CLI 验证、快照与领域冻结保护复核通过。
- [x] S-01：重叠市场请求代次及 history 归属已修复；两种真实引擎原场景、同 symbol 周期切换、空行情和恢复复测通过。
- [x] S-02：tick 遵循已宣布版本下限，合法 restart 保留；原独立故障注入重新执行通过。
- [x] S-03：bootstrap 成功/失败统一归属及完整 envelope 校验，首次 discovery 也验证请求市场；旧响应/旧错误不覆盖新 Retry。
- [x] U-01：错误全文换行、低高度可滚动；四种 viewport 的真实 DOM 及键盘验证通过。
- [ ] 按计划继续参考站逐笔/汇总、完整撮合/Bar Magnifier/复合订单、真实 Provider 故障、跨浏览器/跨设备/长时资源及真实制品 rollback 验收。

R/O/S/U 的 `[x]` 仅指明确修复与复测场景，不代表相关模块全部关闭。最新修复记录见 [BACKTEST_RECHECK_2_REMEDIATION_2026-09-30.md](docs/backtesting/reports/BACKTEST_RECHECK_2_REMEDIATION_2026-09-30.md)，原独立失败证据保持不变；后续仍需独立复核。Replay 不在本阶段范围，许可证不作为本地自用阶段的验收阻塞。

## 2026-09-29 最新 goal 续跑（未完成最终验收）

- [x] 修复 Summary/Dock 把逐 K equity 当累计交易盈亏的错误：参考 chunk 明确使用
  historical_net_profit 与 trades_history 同序号关联；现在显示 ordinal 交易曲线、
  一基 Trade #、方向和 UTC 时间，风险计算仍保留独立 exact equity。
- [x] 修复设置 Inputs/Properties 同名 key 冲突、异步返回污染新弹窗与数值输入边界。
- [x] 修复 Binance 1.5s 冷启动索引误超时、fallback 固化和 never-settle 恢复失败；
  默认保留网络保护，并经公共 DataControl 重新注册恢复的完整目录。
- [x] 校准已验证的 desktop Performance 滚动起点，补独立盒模型与暗色 tooltip 对比度。
- [x] 本轮旧回归 22/22、全量 254/254、类型/构建、Dev/Production E2E、四 viewport
  visual/a11y、严格性能门禁通过；细节见 `BACKTEST_REGRESSION_BASELINE.md`。
- [ ] 参考 Summary 在 current/open 情况下是否追加尾点、固定 BTCUSDT 同行情逐笔数值、
  四 Tab 全面视觉/交互对账仍未关闭；完整 Broker、HMR、VoiceOver 和真实发布回滚门禁
  保持原有未完成状态。不得将上述局部通过宣称为原始 goal 全部完成。
- [x] 修正 desktop Viewer 四 Tab 内容层的参考几何：移除滚动 panel 的重复 16px
  `margin-top`，保留 Performance 首卡无额外 page 顶部 padding；刷新视觉基线并复跑门禁。
- [x] 修复实时回测快照导致的曲线持续闪烁：forming/computing 快照和可见曲线未变化的
  report 不再销毁重建 Viewer/Highcharts；补充 Simulation/Analysis 状态签名避免吞掉进度更新。
- [x] 修复 Viewer 市场 Logo 与右上角退出/展开图标：BTC/ETH 使用本地 inline SVG，
  右上角使用四角 glyph，禁止远程图标依赖。

## 2026-09-28 原始 goal 续跑检查点

本轮继续收敛回测工作区的状态一致性与 PineTS 订单生命周期边界：

- 深历史 `history:progress` 期间保留内部 head ledger 只用于 race/identity 保护，公开状态固定为
  `partial`；`history:complete` 会重新读取完整 context/ledger，直到刷新被接受前固定为
  `computing + finality=unknown`，避免浅历史结果闪现为最终结果。
- `history:complete(aborted)` 无论是否存在 `ScriptRun` 都保持 `partial-history`，不再误报 `ready`。
- Controller 只在 `historical-final` 或 `live-provisional` 暴露交易、账户标量、曲线和 Simulation；
  `unknown`/`partial-history` 的旧 context 不会泄漏到 Dock、Viewer 或更新 Simulation。
- `strategy.entry()` / `strategy.order()` 对仍未成交的同 ID 订单执行替换，保留 cancelled/created
  lifecycle 事件；同 bar 重复 market ID 不会把被替换的旧单计入 reversal 数量。

本轮验证结果：

- 根 `npm test`：`244/244`；既有回归：`22/22`；回测 adapter/controller/precision 定向：`75/75`。
- PineTS 订单生命周期定向：`23/23`；PineTS strategy 定向：`24 files / 129 tests`；
  Vela-PineTS：`27 files / 277 tests`。
- `npx tsc --noEmit --pretty false`、`npm run build`、dependency contract、dist independence、
  Provider smoke、production E2E 和 Chromium/Firefox/WebKit 均通过；Binance/Hyperliquid smoke
  均为 `historyBars=5, live=true`。
- `npm run test:forks` 仍不能记为全量 PASS：在 `NODE_USE_ENV_PROXY=1` 下仍有 PineTS 上游联网/动态
  fixture 与 5 秒网络测试失败（`19 failed / 1962 passed / 5 skipped`），这些失败集中在依赖
  Binance 动态数据或上游 transpiler/stream 基线，不能冒充应用回测通过；本地 strategy/Vela
  定向套件已单独通过。

剩余 Final Gate 仍是参考站逐笔/最终视觉对账、完整 TradingView 逐 Fill/复杂订单语义、完整应用
HMR/destroy/remount/故障注入、VoiceOver、真实 rollback 和清缓存发布演练；当前本地实现不得将
这些 PARTIAL 项宣称为已完成。

## 2026-09-28 当前 goal 复核记录

截至 2026-09-28 23:18（+08:00），Binance/Hyperliquid provider 已在工作区边界增加有限请求超时、
Binance 镜像重试、symbol index fallback、历史范围归一和取消后的回调保护；浏览器 Provider smoke
验证两者均可返回历史与实时数据。

2026-09-29 13:42（+08:00）修复 provider 冷启动回归：原 1.5s 索引预算会把 Binance 的正常响应误判
成超时，并被 Vela registry 固化成整次会话仅一个交易品；现已放宽到 30s，且迟到/重试成功的完整
索引会通过 Vela 公开 `DataControl.registerProvider` 重新注册，刷新共享 Registry 与交易品选择器。
启动与一次后台恢复均失败时，浏览器后续 `online` 事件会再触发显式索引恢复；Workspace 销毁时同步
移除该监听。
`PineEngine.prepare()` 对非字符串源码也已与 Worker 统一为异步错误。
PineTS 内置 BinanceProvider 另已将 global/US mirror 共享为一个总超时预算，避免 Node 直连受限时
两次完整等待叠加；默认预算已调整为 10s 以覆盖代理/冷连接，显式 `requestTimeoutMs` 仍可由宿主覆盖。

- 根 `npm test`：238/238；既有回归：22/22；Provider network/index/live guard：18/18。
- PineTS strategy/error 定向套件：124/124；Vela-PineTS 全部本地套件：277/277。
- `npx tsc --noEmit --pretty false`、`npm run build`、`npm run test:e2e:prod`、
  `npm run test:e2e:cross-browser` 和 `npm run test:visual:a11y`：通过。
- Trades Calendar 已补非法时区归一、无交易月份空态和月份导航 ARIA；新增日历回归通过。
- Chromium/Firefox/WebKit cross-browser：均通过，trades=3、净利润一致，页面错误/外部非法请求/HMR/WebSocket 均为 0。
- production E2E：通过；offline smoke：通过（被阻断的 24 次请求均为已登记行情 Provider，LuxAlgo/未知域名为 0）。
- multi-cell E2E：通过；初始报告 6、provider 请求 4、销毁后 Chart/Observer 为 0/0。

### 当前继续推进（2026-09-28）

- 根 `npm test` 已由 238/238 增至 239/239；新增深历史覆盖链路回归。
- Vela `history:progress` / `history:complete` 已完整桥接到 Adapter、Domain 和 UI report：保留
  `loaded/target/barsLoaded/oldestTime/progress/reason`，明确区分 `depth`、`genesis`、`aborted`，
  不再只依赖 `ScriptRun.complete` 推断整段历史是否可用。
- 主 E2E、multi-cell、Chromium/Firefox/WebKit、四 viewport visual/a11y、Provider smoke、生产构建、
  dependency contract、dist independence 和 offline smoke 已在该增量上重跑通过。

上述是当前可复核证据，不代表 TradingView 逐 Fill、复杂订单、参考站最终视觉/数值对账、完整
VoiceOver/性能/rollback Gate 已完成；这些能力继续保持 PARTIAL/待后续证据。
PineTS 全仓套件仍包含依赖 `api.binance.com`/`fapi.binance.com` 的联网用例；Node 直连不启用
环境代理时会超时，启用 Node 24 `NODE_USE_ENV_PROXY=1` 后可以完成请求，但仓库内一部分硬编码
2025 动态 Binance 样本与当前 API 返回不一致，因此仍不将全仓套件记为 PASS，也不把环境/fixture
差异误判为应用 Provider 地址错误。

### 2026-09-28 继续复核结果（本地工作树 `4df3c8b`）

- 根既有回归：`22/22`；根全量：`239/239`；`npm run build`：通过。
- 开发态 E2E 冷启动：通过；`blockedExternalRequests=0`、`luxalgoRequests=0`、
  `marketRequests=148`，生命周期 `mounts/destroys/noopDestroys=7/7/1`，BTCUSDT fixture
  销毁后的 `activeCharts/activeObservers=0/0`。
- 生产态 E2E：通过；`blockedExternalRequests=0`、`luxalgoRequests=0`、
  `marketRequests=64`、Viewer Storage 写入/删除/清空 `0/0/0`。
- 四 viewport visual/a11y：通过；axe、对比度、键盘、golden diff 均无违规/差异。
- Binance/Hyperliquid Provider smoke：各返回 `historyBars=5` 并建立 live 连接；离线
  BTCUSDT fixture：`2/2`。
- `npm run test:forks` 仍不作为全量 PASS：未设置 `NODE_USE_ENV_PROXY=1` 时 Node 直连
  Binance 会超时；启用代理后网络用例可达，但 PineTS 上游部分 2025 硬编码样本与当前
  Binance 历史数据已漂移（例如 `Conditional Assignment Patterns`），该差异属于上游
  动态 fixture，不应改写当前应用回测结果或伪报为引擎回归。
- 2026-09-30 已用用户提供 workspace 成功登录参考站并采集真实四 Tab、Settings、Simulation
  和 13 笔策略报告，详见 `BACKTEST_REFERENCE_LIVE_AUDIT_2026-09-30.md`；该动态样本推进了
  参考证据，但仍不是与本地 fixture 同数据的逐笔对账，不能替代 reference/local golden。

### 2026-09-28 窄屏入口增量复核（当前工作树）

- 根 `npm test`：`240/240`；既有回归：`22/22`；`npx tsc --noEmit --pretty false`：通过。
- 开发 E2E：通过；G3a 已按参考断点拆为桌面 Dock/焦点路径和 `800px` 窄屏
  `Backtest` 入口路径，未新增 Provider、Storage 或 Workspace 生命周期副作用。
- 生产 E2E：通过；`blockedExternalRequests=0`、`luxalgoRequests=0`、
  `marketRequests=64`、Viewer Storage mutation 为 `0/0/0`。
- 多 Cell：初始报告 `6`，销毁后 `activeCharts/activeObservers=0/0`；Chromium/Firefox/WebKit
  BTCUSDT fixture 的 trades/net profit 一致；四 viewport visual/a11y、axe、对比度、键盘和
  golden diff 通过。
- 性能门禁：10k/100k DOM 均保持 200 行，曲线 `raw→render=2,000`，拖拽约 `60 FPS`，
  long-task p95 为 `0ms`，Simulation 10k 完成且资源销毁归零。

本轮修正了“参考断点已隐藏 Dock，但旧 G3a 测试仍寻找 Dock”的真实回归；实现与测试现在
共享 `1024px` 保留 Dock、`≤1023px` 使用单一 Backtest 入口的合同。参考站动态逐 Fill、
最终截图差分、完整 TradingView broker parity、VoiceOver 和真实 rollback 仍保持 PARTIAL，
不能由本地 fixture 证据替代。

### 2026-09-28 Viewer 市场标签增量复核

- 根 `npm test`：`241/241`；新增 Viewer market-label 合同覆盖 `BTCUSDT/ETHUSDT → BTCUSD/ETHUSD`
  以及分隔符/永续后缀归一化。
- 参考站已登录会话实测 `BTCUSDT`、`BTC-USD`、`ETHUSDT` 三组图表/Viewer 标签；本地只在
  Viewer 展示层应用同一规则，原始 report symbol、Provider URL、K 线和回测计算不变。
- 开发 E2E、四 viewport visual/a11y 和截图 golden 在归一化后通过；E2E 对 live table/calendar
  的采样增加了完整 DOM 形状等待，消除旧测试偶发竞态，不放宽业务断言。

这仍不等于参考站逐笔交易数值对账；当前本地 BTCUSDT fixture 的 `3` 笔交易是固定离线
验收样本，参考站恢复策略的 `13` 笔是另一份动态数据，不能直接互相替换。

### 2026-09-28 G8 OCA 撮合增量

- PineTS broker 已实现显式 `strategy.oca.cancel` / `strategy.oca.reduce`：首个实际成交后，
  `cancel` 取消同名兄弟挂单，`reduce` 按实际成交数量缩减兄弟数量；无 `oca_name` 不推断分组。
- 新增 `packages/pinets/tests/namespaces/strategy/oca.test.ts`，覆盖 cancel、reduce remainder
  和无名称不分组；OCA 定向 `3/3`，PineTS strategy 定向套件 `124/124`。
- 该增量只改变 Fork broker 的显式 OCA 生命周期；TradingView 完整逐 Fill/实时复合订单和参考站
  逐笔对账仍保持 PARTIAL，不能将 OCA fixture 视为最终 broker parity。

### 2026-09-28 G8 手续费账本增量

- 修复 PineTS `cash_per_order` 在一次 `close()` / `close_all()` 同时消费多个 FIFO
  仓位时按物理 lot 重复收费的问题：固定手续费现在按一次 broker close order
  计算，再按实际关闭数量分摊到各 closed-trade 行；percent 和 cash-per-contract
  仍保持按数量线性计算，反向开仓的 flat-fee 半额规则保持不变。
- 新增固定 4 根 K 线回归：两笔加仓、一次 `close_all()`，以及两笔加仓后一次反向开仓，
  验证总手续费、Net Profit、每笔 P&L 和 reversal 两条费用腿；PineTS strategy 定向套件
  `23 files / 126 tests` 通过。
- 这只关闭了多 lot 固定手续费的一个明确差异；最小变动单位、复杂复合订单、完整
  TradingView 逐 Fill 对账和其它保证金边界仍保持 PARTIAL。

### 2026-09-28 Viewer Header parity 增量

- 重新核对登录态参考站与静态 `backtest.html`：Viewer header 只保留 Return、市场 identity、
  策略日期范围和收藏星标；Settings 只从 chart Dock 进入。
- 本地移除 Viewer 内重复的 `Open strategy settings`，保留 Dock 的设置、Inputs/Properties、
  Cancel/Reset/Ok 和批量提交逻辑；根 `241/241`、既有回归 `22/22`、开发/生产 E2E 均通过。
- 该项解决的是明确的 UI 入口偏差，不代表参考站最终视觉/逐笔数值 parity 已全部关闭。

## 自建脚本持久化

状态：待讨论。

- [ ] 讨论自建脚本后续的持久化需求与实施方向。

## PineTS 高精度历史回测（TradingView Bar detalization 对标）

状态：G8 第一版已接入并完成 in-process/Worker parity；本轮继续实现了 PineTS 内部 order/fill lifecycle ledger、`process_orders_on_close`、`backtest_fill_limits_assumption`、`strategy.cancel` 生命周期事件、按交易所日重置的 intraday risk 规则，以及在 chart-OHLC/lower-timeframe 路径上的 `calc_on_order_fills`、`calc_on_every_tick` 重算边界；整体仍为 PARTIAL。完整 TradingView 逐 Fill 对账、复合订单语义、秒级历史数据和最终非回归 Gate 仍待完成。

优先级：继续补齐引擎撮合语义与 TradingView 逐 Fill 对账；结果面板的首版精度状态及 Properties 精度入口已接入，完整复现导出仍待排期。

参考资料：

- TradingView 官方说明：[Bar detalization](https://cn.tradingview.com/support/solutions/43000786180/)
- 当前引擎：`pinets@0.9.34`
- 当前桥接层：`@luxalgo/vela-pinets@0.2.13`
- 当前图表层：`@luxalgo/vela@0.7.7`

### 对标结论

TradingView 文档中的 tick 是历史回测使用的“模拟 K 线内价格点”，不是交易所逐笔成交：

- 默认精度：每根图表 K 线按 `Open / High / Low / Close` 展开为 4 个模拟 tick；中间的 High、Low 顺序遵循 TradingView 的历史 K 线路径规则。
- 高精度：选择一个更低周期，按时间顺序读取该周期的 K 线，再将每根低周期 K 线展开为 4 个模拟 tick。
- 模拟 tick 数约为 `floor(图表周期 / 低周期) × 4`，实际数量可能受周期边界和可用数据影响。
- K 线精度与脚本执行次数是两个维度：增加价格路径细节，不应默认等同于在每个模拟 tick 上完整重跑 Pine 脚本。

当前官方周期映射：

| 图表周期 | 低周期 | 低周期 K 线数 | 每根图表 K 线的模拟 tick |
| --- | --- | ---: | ---: |
| 1m | 10s | 6 | 24 |
| 5m | 30s | 10 | 40 |
| 10m | 1m | 10 | 40 |
| 15m | 2m | 7（向下取整） | 28 |
| 30m | 5m | 6 | 24 |
| 1H | 10m | 6 | 24 |
| 4H | 30m | 8 | 32 |
| 1D | 1H | 24 | 96 |
| 3D | 4H | 18 | 72 |
| 1W | 1D | 7 | 28 |

### 当前项目基线

- Binance 历史接口使用 Kline，实时订阅使用 `@kline_<interval>`；输出为 OHLCV，不是 `trade` / `aggTrade` 逐笔成交。
- Hyperliquid 历史接口使用 `candleSnapshot`，实时订阅使用 `type: candle`；输出同样为 OHLCV。
- 两个 Provider 当前最小原生历史周期均为 1m；非原生分钟周期可由更低分钟 K 线聚合。
- Hyperliquid 每个周期只能读取最近约 5,000 根 K 线，高精度深度回测会更早触及历史上限。
- PineTS Fork 已将 `use_bar_magnifier` 接入低周期订单回放第一版：仅在 lower-timeframe 数据完整且通过父/子 K 线覆盖校验时应用四点路径；否则继续使用图表 OHLC，并发布明确的 fallback reason。该实现不是完整 TradingView Broker Emulator 等价实现。
- 当前项目注册的是 `PineWorkerEngine`。Worker 已在 `@luxalgo/vela-pinets` 构建时内联本地 PineTS，in-process/Worker 均透传并校验 precision envelope；仅替换应用的 `pinets` 依赖仍不会更新 Worker 内的执行引擎。

### 目标范围

首期目标是在现有 OHLCV 数据基础上实现与 TradingView Bar detalization 同类的模拟回放，不将真实逐笔成交纳入首期：

1. 默认模式按父周期 OHLC/OLHC 四点路径顺序撮合。
2. 高精度模式按映射表加载低周期 K 线，并将每根低周期 K 线展开为四点路径。
3. 沿模拟价格点依次处理市价、限价、止损、止盈、移动止损、反向开仓和保证金事件。
4. 保持 Pine 标准净持仓语义，不在本任务中增加多空双向持仓。
5. 缺少低周期数据时必须显式回退默认精度，并向上层暴露原因，不能静默产生“高精度”结果。

### 分阶段实施

#### 第一阶段：建立回测基准

- [ ] 固定相同交易品种、周期、回测区间、初始资金、手续费、滑点和仓位参数。
- [ ] 从 TradingView 导出基准交易列表和汇总指标。
- [ ] 建立市价、限价、止损、同 K 线止盈止损、跳空、反转、金字塔和部分平仓测试用例。
- [ ] 记录当前 PineTS 与 TradingView 的逐笔差异，避免高精度改造掩盖已有撮合差异。

#### 第二阶段：重构 PineTS 模拟价格路径（G8 第一版已完成，完整语义仍 PARTIAL）

- [x] 在 PineTS Broker Emulator 中引入有时间顺序的模拟 tick/price-path 回放：低周期 K 线按有序四点路径驱动现有订单状态机；默认图表 OHLC 路径仍保留兼容分支。（PARTIAL：尚未统一替换全部旧撮合阶段。）
- [x] 实现低周期 `O-H-L-C` / `O-L-H-C` 四点回放，并按开盘距离选择中间极值顺序。（PARTIAL：TradingView 全部边界规则尚未逐 Fill 对账。）
- [x] 为低周期窗口定义订单生效、成交和父 K 线账本边界，拒绝窗口外/缺口数据。（PARTIAL：订单成交后的 Pine 重算仍以父 K 线为边界。）
- [x] 接入 `calc_on_order_fills`、`calc_on_every_tick` 的首版执行语义：chart-OHLC 在成交后提供一次不增加报告点的重算，已校验的 lower-timeframe 路径按模拟 tick/成交触发重算；仍需 TradingView 逐 Fill 对账、实时 tick/复合订单语义。（PARTIAL）
- [x] 为 PineTS 内部 broker 增加 append-only order/fill lifecycle ledger，并覆盖创建、成交、取消、拒绝、partial progress、parent/reversal relation 和 streaming rollback；通过本地 Vela-PineTS 的 identity-bound `auditLedger` snapshot 选择性桥接到 Quant Adapter 的 `rawOrders/rawFills`，上游未修改的 Vela 能力仍保持 `false`，不把不完整/过期事件伪造成公共结果。
- [x] 实现 `strategy.risk.max_intraday_loss`、`max_intraday_filled_orders` 和 `max_cons_loss_days` 的交易所时区日切换基础语义；chart-OHLC 下仍不宣称 tick 级风险检查等价。
- [x] 将 PineTS 上下文中原先 console-only 的 bare `error()` 实现为可捕获的 `PineRuntimeError`；`runtime.error()` 继续使用同一类运行时错误契约。
- [ ] 保持手续费、滑点、最小变动单位、FIFO、保证金和交易账本统计一致。

#### 第三阶段：接入低周期 K 线（G8 第一版已完成，缓存/Provider 深度仍 PARTIAL）

- [x] 建立集中式图表周期到回放周期映射配置，不把映射散落在 Provider 或 UI 中；不支持 1m→10s、5m→30s 时显式返回未确定映射。
- [x] 通过 Vela 的 `fetchSeries(symbol, timeframe, range)` 请求低周期数据，并在 Worker 中按 session 路由请求。（PARTIAL：专用低周期缓存策略仍待补。）
- [x] 按父周期半开时间边界校验并归组低周期 K 线，处理 Binance inclusive closeTime。（PARTIAL：复杂交易时段/交易所时区日历仍待补。）
- [x] 为低周期数据增加按 `provider / symbol / timeframe / range` 复用的有界缓存：执行 session 内并发去重、LRU 容量、成功响应 TTL，以及 provider/精确窗口/会话级失效；`request.security` 仍保持原有非缓存语义。（PARTIAL：跨 session 的持久缓存不纳入，forming/live 请求仍由宿主通知主动失效。）
- [x] 对缺失、重复、不完整、越界、断档和 live/仍在形成的低周期请求定义确定性回退规则，并将覆盖率/原因传到结果 UI。（PARTIAL：forming lower bar 尚未作为独立历史状态处理。）
- [x] Binance 优先实现分钟级映射；Hyperliquid 仍沿用 Provider 的历史深度限制。（PARTIAL：Hyperliquid 5,000 根上限提示尚未形成专门 UI Gate。）
- [x] 1m→10s、5m→30s 因当前 Provider 不提供秒级历史数据，首期禁用或回退，不伪造高精度结果；运行时映射 helper 对这两个周期返回 `undefined`，其余周期仅使用表内且 provider-backed 的映射。

#### 第四阶段：重新构建 Worker 桥接层（G8 第一版已完成）

- [x] Fork PineTS 并在源码仓库实现，不直接修改 `node_modules` 产物。
- [x] Fork/rebuild `@luxalgo/vela-pinets`，确保 `PineWorkerEngine` 内联修改后的 PineTS。
- [x] 将本项目依赖锁定到可复现的自有版本或提交哈希，并在 build fingerprint 中记录 Fork 身份。
- [x] 验证 in-process `PineEngine` 与 `PineWorkerEngine` 的 precision envelope/结果边界一致。（PARTIAL：完整 TradingView 数值 parity 仍待。）
- [ ] 评估并遵守 PineTS / Vela-PineTS 的 AGPL-3.0 许可义务。

#### 第五阶段：产品入口与结果展示（G8 第一版已完成）

- [x] 在策略 Properties 中增加“Default precision / High precision”选项；控件直接读写真实 `use_bar_magnifier` boolean 属性，不保存第二份 UI 状态。Cancel/Reset 均只改草稿，precision-only 的 Ok 只发一次 `setProps` 批量更新/重算；秒级数据不受 Provider 支持时继续由结果页现有 precision fallback 明示，不能把“已请求”显示成“已应用”。
- [x] 显示实际采用的低周期、覆盖率、父/子 K 线计数和回退原因；模拟点数可由映射与四点规则确定。（PARTIAL：尚未提供独立的逐点明细面板。）
- [x] 当高精度不可用或发生回退时，在 Dock/Viewer 结果页显示可访问的状态、tooltip 和 machine-readable fallback reason，不只写控制台日志。
- [ ] 回测结果仅在完整历史加载结束后生成，避免将深度回填过程中的中间结果当作最终结果。
- [x] 在执行上下文/结果 envelope 中记录数据源、精度模式、引擎 provenance 和关键策略参数。（PARTIAL：完整可导出复现包仍待。）

### 验收标准

- [x] 默认精度下现有基础策略回归集通过。（PARTIAL：PineTS 全仓联网套件受 Binance 网络超时影响，不能宣称全仓 PASS。）
- [x] 1H 高精度能够使用六根 10m K 线生成 24 个有序模拟价格点，并据此处理订单。（PARTIAL：当前证据为本地固定 OHLCV fixture。）
- [x] 同一父 K 线内先后触发的止盈、止损结果与低周期路径一致。（PARTIAL：复杂复合订单组合仍待。）
- [x] 低周期窗口拒绝创建前/窗口外数据并保持确定性时间边界。（PARTIAL：完整未来函数审计和所有重算配置仍待。）
- [x] 缺失低周期数据时结果明确标记为回退模式。
- [x] Worker 版本实际运行自有 PineTS 构建，而不是 npm 包内联的旧版本，并通过 fingerprint/parity 检查。
- [ ] 基准用例与 TradingView 的入场时间、出场时间、方向、数量、成交价和盈亏逐项对照，并记录仍无法对齐的差异。

### 暂不纳入

- 交易所真实逐笔成交和订单簿回放。
- 市场冲击、盘口深度、部分成交和排队位置模拟。
- 同时持有多仓与空仓的 Hedge Mode。
- 在没有秒级历史数据时自行插值或随机生成秒级价格路径。

真实 Tick 回测可作为后续独立能力：Binance 可评估 `aggTrade` 数据采集与存储，Hyperliquid 需另行确认历史逐笔数据覆盖。它不应与本次 TradingView 模拟 Tick 对标混为同一任务。
