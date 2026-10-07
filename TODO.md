# TODO

> 最新对齐批次（2026-10-07）：共享Tab滚动196/196、Simulation挂载生命周期216/216、极小轴8个实际图表28标签、Adapter脚本错误双引擎64项、旧Workspace恢复两浏览器三阶段、故障隔离198项和K线连续性31项通过；根653/653、Adapter32/32、相关Controller/History121/121通过。类型、构建、生产主E2E和工程门禁已通过。其他未关闭项以需求表为准；当前提交已在本地建立，远端 BUILD-03 仍待本次提交的 Actions；手机/Safari/线上/Replay继续暂缓。

> 2026-10-07 桌面非文字可辨识续验：已修复 Calendar 焦点框、Settings 默认控件边界及 Simulation 置信区间低对比度/区间键盘不可达。实际两浏览器控件20项取色、16项键盘通过；区间轮廓及中位线最低4.41:1，原始68点可读，Simulation四场景144/144通过，计算值未改。最新根639/639、类型、重建/生产主E2E、紧凑桌面4场景228项及6项清理、包体/仓库/dist检查通过。此前完整本地门禁保持原时点；本轮未改视觉基线，VoiceOver与参考交互差异仍开放。证据仅在忽略目录 `audit-evidence/2026-10-07-essential-control-contrast/after/` 和 `audit-evidence/2026-10-07-simulation-band-contrast/`。

> 2026-10-07 桌面续验终态：根639/639、类型/构建、dev/prod主E2E及工程门禁通过；Dock 393/393、桌面 Dock 632项、Summary/Dock键盘176项及桌面32场景/1,792项、Analysis164、Log/Calendar858、H-06图例收藏/</>与L-11定位164项、Settings和strict visual四图diff=0通过。Simulation最后Preserve scoped CSS补丁另验84/84，Settings刷新竞态、box-sizing、空态Ghost、H-06与L-11已在后续批次通过。证据与源码时点见 `audit-evidence/2026-10-07-dock-keyboard-closure/README.md`（本地忽略）；下方627及更早数字保留各自批次。手机专项默认deferred/full可选，桌面VoiceOver、共享参考差异和最终提交CI仍按需求表开放；当前提交已在本地建立，远端 CI 待本次提交。

> 当前有效的需求、优先级和验收状态统一见 [BACKTEST_REQUIREMENTS_STATUS.md](docs/backtesting/current/BACKTEST_REQUIREMENTS_STATUS.md)。本文件后续章节保留历史推进记录和细项 TODO。

## 2026-10-07 多轮对话口径复核（当前）

原 6/7/8/9/10+14/15 的对应关系、状态和关闭条件见需求表；下方旧日期是过程记录，不覆盖当前决定。

UI 验收标准已按最新用户修正：功能、交互、图标和组件风格对标参考，整体布局适配本项目；不复制或预留 AI 侧栏/顶部登录 banner，不再要求整页 1px / 0.5% / 1% 阈值。旧像素描述保留历史，当前按需求表 UI 标准与计划 §10 执行；未验模块不自动变为通过，本地截图非回归仍保留。

最新决定：**手机端适配暂缓（SCOPE-07）**。手机布局、横竖屏、safe-area、手机触摸/实机专项不继续扩展，也不阻塞本阶段；已完成修复和历史证据保留。当前聚焦桌面工作区全模块、窗口缩放、键盘、通用业务缺陷及桌面辅助技术；既有通用回归继续。下方历史手机待验项不再进入本期执行队列。

本次复核已将Settings、Performance、Log/Calendar和PERF-01的新直接证据同步至需求表。必要回归测试和经人工核对的本地视觉基线可随代码提交，原参考JS、审计数据和截图继续留忽略目录。参考入口/授权已提供，无需重复补充；控制组件展示、真实数值golden与本地非回归分别验收。

桌面续验新增结果（晚于下方627批次）：Performance/Analysis同输入原生组件1,014/1,014；Settings当前12类Inputs在两浏览器×两真实引擎4/4；Entry/Exit原生标签定位两浏览器各37/37；Simulation同输入148/148、永久交互68/68及独立复核8项通过。修复数字类型/timeframe override、日期图标、Settings色块/勾号/标签列/textarea、Simulation菜单/两级Escape/外部关闭和help拦截点击。本批统一桌面回归已完成，结果和最后Preserve CSS补丁的验证边界见顶部632批次记录，不扩大为全部Final Gate。默认测试/CI选择desktop；保留full可选入口和未选手机基线，手机专项显式deferred。

- [x] PERF-01：独立生产Chromium/Firefox×DPR1/2的8个大账本场景、完整冷selector trace、range/多series tooltip、Worker取消/替换/销毁与异常构造清理通过。固定Chromium DPR1 selector p95=52.2/399.9ms、分页41.4/42.2ms达原预算；Firefox10k分页124ms、100k聚合656/589ms超对照值保留，不称全浏览器同预算。100k factory最慢约1.14s单列；76/76定向回归，证据 `audit-evidence/2026-10-07-runtime-performance/`，不以启动预算替代。
- [x] 前一统一门禁批次：根627/627、类型/构建、开发/生产主E2E、依赖/仓库/dist通过；dev生命周期7/7、非法外部请求0。生产主入口32状态page/window错误和blocked0；Analysis8组×41通过。证据 `audit-evidence/2026-10-07-ui-layout-acceptance/`。616/624、桥接310/310、引擎1773+1和release29/29保留各自批次，不能合并成最新全量复跑声明；后续632批次见顶部。
- [x] 本地视觉非回归：独立逐张审8组旧新图和DOM A/B，确认8px为12px货币suffix使8行各增1px，无数字/行裁切；glyph/mobile Tab为已确认改动。检查修为border0+精确可见shadow ring，5类负控拒绝；已审baseline与候选逐字节一致，普通strict门禁8图diff0，原0.001像素差/1px本地阈值未放宽。首跑失败保留，不改业务迎合旧检查；证据 `audit-evidence/2026-10-07-ui-layout-acceptance/`，不等于全参考UI通过。

较早实施批次继续有效于其范围：ENGINE-03跨订单/实时风险14/14、归档496字段，修复Margin call审计及live closeTime；STARTUP-01空图/SMA gzip减少44.05%/17.50%；风险/entry16/16、Simulation非默认参数链、当时Settings生产32状态/34交互及210图表文字对比度。它们的616/310/1773+1总数不覆盖后续UI源码。独立生产Workspace两小时（7,200.505秒、121采样）及卸载Worker/Socket归零亦保留冻结构建范围；全UI、真实设备未因此关闭。

- [x] P1 DATA-11：已冻结的合并验收范围通过。2,000 根/窄屏、任意周期、主动手势、缓存/接缝、双引擎门控与 Retry、历史精度和真实渲染均有证据；两数据源两小时恢复及新增双引擎 CONNECT 静默/恢复也已补齐。真实缺根明确拒绝，不伪造数据；后续改动继续回归，不要求整个 ENGINE-03 或所有地区通过。
- [x] P1 K线缓存岛修复：Vela 空最新页与旧缓存同时存在时不再错误宣布旧缓存覆盖当前窗口；清理错误 watermark，保留后续重取路径。`src/integrations/vela/history-resilience.test.mjs` 6/6及原周期切换/连续性专项通过。
- [x] DATA-05 手势分页子项：Chromium、Firefox 各两引擎 26/26，实际向左拖动、横向滚轮和缩小到边缘每段操作追加最多 2,000 根；Viewer Retry 后再补至 6,000、快速切换、genesis、多 Cell、销毁、绘图/价格轴误触均验。在线 Retry 与 inline EMPTY 明确区分。联动发现并修复近似相等盈亏导致直方图分桶超量和报告 computing 卡住，相关单元 104/104。该专项通过不代替 DATA-11 最终集成。
- [x] P0 BUILD-01已执行部分：最后Tab/Simulation/极小轴对齐后根646/646，随后脚本错误/持久化/K线连续性修复的根测试652/652；Adapter32/32、相关Controller/History121/121、类型、构建、生产主E2E和工程门禁通过。此前Dock/桌面矩阵/strict visual保留各自时点。最终提交CI另列，不宣称全部测试全量复跑；引擎/桥接/撮合/长期资源继续注明对应批次，全UI/设备不自动关闭。
- [ ] 原10+14整体仍PARTIAL：列明的Dock、Calendar、Performance/Analysis、图标/Header及局部状态已验；H-09共享滚动、S-11离开Simulation恢复默认、D-10极小轴、ENG-10脚本错误、STG-03/06当前恢复合同及LC-07/NR-05存储/定位异常隔离均已按列明合同通过。仍保留Dock偏好、统一收藏/账户保存回测、草稿Apply/即时提交以及正确性/可读性增强等明确差异；桌面VoiceOver归UI-10。本地布局适配须保证入口和内容可达，手机适配暂缓，不据局部通过将全UI自动改为PASS。
- [x] Settings：当日参考控件取证后完成数字单击/长按、blur min/max/int、Vela公共下拉、标题拖拽及移动空间复位。三浏览器320/390/1440、键盘/外部点击、Reset/Apply/失败/迟到响应/destroy通过；实测observer loop已修，page/window错误0、553源码/测试SHA稳定。`audit-evidence/2026-10-07-settings-live-controls/`；31属性/modal trap保留，全部schema/参考错误文案未由普通SMA替代。
- [x] Performance P-12/P-14：原组件51受控props、本地三浏览器各48例/432cell一致；正百分比+号、小数/科学计数/百万M/ratio及12px单位已修。`audit-evidence/2026-10-07-performance-controls/`；只关闭展示，不称自然非空Benchmark或计算golden，不复制参考10k错误本金/风险假0，方向CAGR保持未定义。
- [x] Log/Calendar：同DTO24状态对照与18组/2,610真实交互断言通过；Header改动后手机12组/1,752和24态截图新采集，分别源码稳定，373证据哈希通过。修复排序/分页焦点和tabpanel、币种行高、tooltip、七列金额重叠；完整日值可通过pointer/键盘/touch打开，11金额边界和280px嵌入容器已验。`audit-evidence/2026-10-07-log-calendar-completion/`；不称引擎golden或真机。
- [x] 图标/手机长标题：当日参考路径、native viewBox/stroke、真实操作共8组988断言/100图标实例通过；三ETH Viewer共27 SVG ID无重复/悬空，资产3场景和360/390长普通名/长token共4场景通过。标题不遮挡Favorite/Close，无远程Logo、window/page错误0；40文件哈希通过。`audit-evidence/2026-10-07-backtest-icon-parity/LOCAL_ICON_VERIFICATION.md`。保留本地可访问的Simulation关闭按钮，不假称参考Drawer也有该控件。
- [x] 当时工作树视觉基线复核：回测 Log 卡片边框 CSS 与 screenshot baseline 已核对；新旧差异仅为已确认的坐标轴抗锯齿、Return-to-chart 图标和 Log 卡片填充高度。该批 `npm run test:visual:a11y`、根测试、类型检查、构建及开发/生产 E2E 通过；只证明对应时点的本地非回归，不等于最新全模块组件/交互对照关闭。
- [x] 原 6/9（明确网络范围）：Hyperliquid 与修复版 Binance Spot 本机两小时均已通过。新增真实 Hyperliquid CONNECT 代理静默验证，两引擎均持续扣留加密数据约 45 秒，navigator 始终 online；watchdog 至少两次换连，允许初始 3 秒在途数据排空，随后稳定期账本/revision 不推进，放行后分别 2.57/2.57 秒恢复新 socket candle。16/16 隧道关闭，页面错误、迟到回调为 0。故障为明确的传输注入，不伪称自然交易所故障。REL-06 本地生产 Workspace 两小时范围已另行通过；默认网络不宣称纯直连，Futures 451 不阻塞 Spot，未测地区/设备/线上环境不作承诺；旧失败终态保留。
- [ ] 最终合并/push 后验证对应提交的 CI；本次文档复核不自动发布。开发 HMR 与短期 20 次挂载销毁已验；真实 Hyperliquid 2,000 根/实时流、Pine Worker、持续四 Tab/Settings 操作的完整生产两小时实测已取得 passed 终态，资源预算和卸载清理通过。采样中的短暂 DOM/listener 峰值在卸载后归零，不能用单次峰值推导长期泄漏。该证据限本地 Chromium + 冻结 dist，不替代其它设备或线上验收。
- [x] STARTUP-01 缓存测量已纠正（2026-10-07）：旧探针 routing 禁用了 HTTP cache，撤回旧热启动证明。移除真实模式 routing、仅一次 context 初始化后，生产冷 3/3（5500/2701/790ms）、prime 后 warm 3/3（674/225/242ms）有 ResourceTiming/CDP 缓存证据；最终探针 SHA 复核另跑 prime+warm 2/2，受控 ABBA 4/4。证据在忽略目录 `audit-evidence/2026-10-07-startup-cache-*`，29 文件哈希已核验。仅证明首绘和静态缓存，完整历史/结果耗时与代表样本性能预算仍需验证；长时资源复用 REL-06，不自动扩大为所有机器/地区。
- [x] STARTUP-01 完整阶段计时后续已补：真实生产冷 3 + prime 1 + warm 3 页，2,000 根连续行情/2,000 点曲线/104 closed + 1 open 及同身份账本、Performance、Simulation 均通过，无页面错误。冷/热完整账本中位数 1296/927ms；本地 `audit-evidence/2026-10-07-startup-full-report/` 保留原始计时、缓存和 Worker 证据。受控渐进和资源拆分预算随后通过；不将各 3 次实网结果作统计 SLA。
- [x] STARTUP-01 渐进预算后续通过：冷/热各10轮ABBA、80次正式样本加2次预热；冷首绘median改善40.33%，完整历史/报告、暖路径与内存均满足原10%预算，每次两次行情请求、完整数据/账本/曲线/精度SHA相同。142项证据哈希通过，原始pilot失败保留；资源拆分首屏实际JS gzip对照随后通过（空图减少44.05%，SMA减少17.50%）。
- [x] UI周统计缺陷：真实双引擎链发现Performance周一分桶与参考/Analysis周日口径不同，已修并补UTC/时区反例。同5,000根参考行情实跑，每引擎Analysis57/57一致；Log实际分页277行、2,208/2,216单元一致，8项为已明确的负零/Open展示差异。Performance30/42一致，剩余公式/人口/日期/benchmark和全模块视觉继续开放。证据 `audit-evidence/2026-10-07-ui-actual-chain/`。
- [x] UI Header 活动日期：参考实际使用首末 closed exit，已新增独立 `activityRange`；双真实引擎 SMA/零交易/open-only/单closed 共8/8通过。SMA显示 `Aug 16 - Oct 6, 2026`，无closed隐藏，单笔同日起止；完整行情 `range/history` 仍从 Aug15 起，不影响风险、补历史或Simulation。风险比率三位小数也经同批确认。证据 `audit-evidence/2026-10-07-ui-actual-chain/header-fix/`（开发链，非生产/全像素）。
- [x] UI收藏/滚动已列缺陷：Viewer星标刷新、list反向/两Cell后台/刷新/销毁同步、重开top0、同Tab不重置、pending恢复scroll已修；原生产35/35两次及边界23/23保留时点。真实Worker图例→Viewer→Favorites及反向、</>名称/源码与定位联合164项也已验。后续H-09已改共享滚动并通过196项，不再保留该差异；账户save-backtest与本地统一收藏仍是明确不同功能。
- [ ] UI-10 剩余项：生产32状态/34交互、DOM/AX通知及210个文字已验；后续两浏览器20项必要边界取色、16项键盘、Simulation区间68原始点/正式144项及SVG fallback已验。原218次axe文字对比度incomplete保留，不误称非文字缺陷。实际VoiceOver仍未验，本机AX自动化未授权；其它缺口必须列具体控件/状态，不把已验hover/键盘重新列待办。手机/Safari专项暂缓。
- [x] 原 7：2026-10-06 固定窗口 SMA 9/21、5,000 根相同 OHLC 的 279 closed + 1 open（280 行）已通过；最新跨订单/margin audit/closeTime 产物重新执行，2,520 字段、13 汇总差异为 0，证据在 `audit-evidence/2026-10-07-frozen-sma-cross-order-final/`。未使用旧本地结果，不冒称浏览器 Worker/Simulation 或新参考窗口全部再验；其它 golden 不重入队。
- [x] 原 8 / ENGINE-03：按需求表完整映射原 TODO 的本期有限合同已关闭。基础订单/重算/风险/默认与高精度、forming/覆盖率浏览器 8/8、风险/entry 实际双引擎两精度 16/16，加本轮跨订单 12/12、实时风险回滚 2/2 和完整归档离线重放 496 字段。新修 Margin call order/fill/parent 审计与 live closeTime；旧归档 80 个审计差异保留，不修改旧结果或放宽比较。当前完整默认/高精度输入包可独立重放；无需完整 TV 外部逐 Fill，也不新增盘口流动性模拟或产品导出按钮。后续实际缺陷按新反例登记，不无限追加所有排列。
- [x] 原 8 已验子项：默认 chart-ohlc、Properties 精度开关、历史低周期回放和明确 fallback；秒级/live 不支持时不能称已应用高精度。
- [x] 高精度子周期尾部缺根缓存恢复：失败精度校验仅失效本次请求窗口，迟到结果不能删除更新后的缓存；重新启用高精度会重取恢复数据，双引擎独立成交预期及可见 fallback 已验证。1m/5m 的秒级子行情不可用时仍明确回退，不能声称所有周期高精度。
- [x] 窄屏 Vela 0.7.7 兼容补丁已纳入构建锁、完整 SHA 和指纹；隔离安装/构建通过，升级注意事项见 `docs/forks/vela-viewport.md`。不再将当前集成描述为完全未修改 Vela 产物。

长期脚本持久化仅记“待讨论”，不列为 P1 实施/发布阻塞；线上部署/CDN/rollback、Replay、Safari 专项暂缓。原第 15 项保留“暂不做”，题名未恢复，不猜测对象。本节的新实测与下方历史测试数分开记录；文档修正不等于完整验收通过。

## 2026-10-06 P1 Final Gate 续跑（历史过程记录）

### 当时验收记录（2026-10-06；不覆盖顶部当前清单）

- [x] Canonical reference source is fixed to Binance Spot `binance:BTCUSDT`; the reference parity case is `BTCUSDT · 15m · SMA` with the same OHLC sequence, strategy source, parameters and ending bar. Hyperliquid `BTC` is a USD perpetual and is used for provider/live recovery validation, not as a substitute for Spot Golden data. Binance Futures `BTCUSDT.P` remains an optional route and is not a Spot acceptance blocker.
- [x] The canonical reference window is accepted: 280/280 trades and 2,520 fields, with summary and Simulation inputs matching. This closes the requested BTCUSDT/15m/SMA window only; it does not claim parity for other scripts, markets or windows.
- [x] Default backtest precision is `chart-ohlc` (parent-bar OHLC/OLHC simulation). The Settings → Properties `Backtest precision` selector exposes `Default precision` and `High precision`; high precision requests `use_bar_magnifier` lower-timeframe replay and reports an explicit fallback when child data is unavailable. It is simulated OHLC, not exchange tick data.
- [x] P1 timeframe-switch client protection: ranged Vela loads now retry the same cursor instead of skipping an empty failed page, and registered Binance/Hyperliquid continuous routes validate and repair internal gaps across minute/hour, 2h/4h, day/week and venue-specific month boundaries without fabricating candles. The generic custom/session helper remains limited to its declared calendar contract. Ordinary switches across any timeframe now reset to the newest 2,000 bars and frame that window; explicit range/depth requests and offline data remain caller-controlled. Added deterministic coverage for transient failure, persistent failed-page boundaries, page-internal repair, venue calendar boundaries and the unified switch policy.
- [x] P1 low-timeframe real-network closure: fresh Chromium through the configured proxy loaded Binance Spot `BTCUSDT` 1m and 5m with two pages/2,000 rows per timeframe and zero observed time-step gaps; a controlled 1m middle-page 503 was retried at the identical `endTime` with no page error. A genuinely sparse upstream interval remains visible rather than being invented.
- [x] Hyperliquid monthly history boundary: 2,000-bar `M` requests no longer send a negative epoch start and the provider contract now clamps that pre-epoch window to `0`; deterministic request-shape regression added.
- [ ] Backtest Workspace follow-up remains scoped to its internal modules (Performance, Trades Analysis, Trades Log, Calendar, Simulation, Settings, Dock/Viewer and chart linkage): continue reference-state and pixel/interaction coverage without expanding this item to unrelated application surfaces.

- [x] 修复浏览器 offline 期间 Vela/PineEngine 对缓存 K 线的 `tick/history` 重发布：已有 settled ledger 的 revision、status、trades、曲线和 Simulation 能力保持不变；联网后只接受新的 Provider tick。PineEngine/PineWorkerEngine 真实 Hyperliquid Workspace 3 周期共 6/6 通过，offline 无 callback/迟到数据，恢复后 socket 与账本均连续。
- [x] 交易账本 FIFO/ANY、部分平仓 MFE/MAE、剩余持仓投影和 closed Trade ID 回归；根测试 554/554、Vela-PineTS 303/303、matching 65/65。
- [x] Performance/Analysis/Simulation 桌面与移动布局按最新参考 DOM 校准；视觉/a11y、开发/生产 E2E、Chromium/Firefox/WebKit fixture 和 touch 矩阵通过。
- [x] 静默 WebSocket watchdog：live lease 安装后立即启动，首次 live callback 后每根 K 线重新计时；12 秒无新 candle 会撤销旧 lease、重建订阅并拒绝旧代次回调；销毁会清理 watchdog。首帧永不到达、静默重连、旧消息隔离和 timer cleanup 均有回归覆盖。
- [x] Hyperliquid 两小时真实 WebSocket/断网恢复已通过 watchdog 版本：7,200.133 秒连续订阅、8,617 candle callbacks、最大间隔 8,649ms、23 次 offline→online 全部恢复；24 sockets 创建/关闭平衡，active=0，offlineBars/late callbacks/cleanup errors 均为 0。证据在被忽略的 `audit-evidence/2026-10-06-p1-hyperliquid-watchdog12-two-hour/`。GitHub runner 对 Binance 的 `Failed to fetch` 仍不能计为通过。
- [x] Provider 重连资源复核：真实 PineEngine/PineWorkerEngine 各 3 个断网恢复周期均在每周期强制 CDP GC 后保持稳定（JSEventListeners 987/990、Nodes 1698，无随 socket 数增长的残留）；destroy 后 listener 降至 721。非 GC soak 采样中的 listener 上升属于 Chromium/DevTools 延迟统计，当前没有确认的 provider handler 泄漏。证据在被忽略的 `audit-evidence/2026-10-06-p1-provider-workspace-resource-recheck-watchdog12/`，不替代长时 Final Gate。
- [x] 2026-10-06 新参考窗口完整 golden：`reference_golden_compare.py` 逐字段比较 280/280 rows、2,520 fields，差异为 0；完整输入和结果留在被忽略的 `audit-evidence/`，更换行情/脚本/参数时必须重新生成。
- [x] bundle raw/gzip 当前预算门禁通过：main `1,762,844/470,887`、worker `828,480/207,197`、Highcharts `376,416/134,100`；Vite 大 chunk warning 仍保留为优化提示，不以强拆包消除 warning。
- [ ] VoiceOver/真实设备、全量像素、TradingView 全复杂撮合，以及参考站其它行情/脚本窗口的重复 golden 仍保持外部/后续 Final Gate；实体 Safari 按用户要求暂不考虑，不能用单一输入窗口的局部绿灯替代。

> 线上部署/CDN/rollback 已按当前用户决定移出本阶段验收范围；没有服务器地址、部署方式或 previous 入口，不将其列为当前阻塞，也不把本地 preview 当作线上通过证据。

## 2026-10-03 Final Gate 门禁加固（历史记录）

- [x] 部署 smoke 对 HTML 引用的每个静态资源强制检查 HTTP 200；非 hash 资源不再可能以 404 被误报通过。
- [x] 部署 smoke 拒绝 candidate 与 previous/rollback 使用同一 URL，避免同槽配置伪造回滚证据。
- [x] 修复 `wait-for-http` 失败路径测试在全量并发下的 Node 子进程启动抖动；当前根测试 554/554 通过。
- [x] TypeScript、生产构建、release 29/29、`git diff --check` 通过。
- [ ] 完整参考站 Trades Log、VoiceOver/真实设备及可访问交易所的长时断网恢复仍需外部输入；实体 Safari 按当前决定暂不考虑，线上部署/CDN/rollback 已按当前范围暂不处理，不计入本阶段 Final Gate。
- [x] GitHub Actions `37132010789` 完成 60 秒真实 Binance/Hyperliquid 连续订阅与 offline→online recovery；仅作为短时真实网络证据，小时级 soak、跨区域代理黑洞和线上部署仍开放。
- [ ] GitHub Actions `37133498353` 的 600 秒尝试在 Binance 初始请求处 `Failed to fetch`，未形成小时级证据；需在可访问交易所 API 的 runner 上重试，不能将网络失败标记为通过。
- [ ] GitHub Actions `37134927725` 的 120 秒尝试在三次有限重试后仍无法访问 Binance；测试已正确 fail-closed，需更换可访问交易所 API 的 runner/网络。
- [x] 本机真实网络 120 秒连续订阅与恢复：Binance 61 callbacks/最大间隔 2,091ms，Hyperliquid 98 callbacks/最大间隔 6,022ms，offline→online 均恢复；仅作为单机短时证据，小时级和跨区域 Final Gate 仍开放。
- [x] 本机真实网络 10 轮连续历史/live 与恢复（2026-10-03）：Binance Spot/Futures、Hyperliquid 每轮均成功，10/10 轮 offline→online 恢复；仅作为增强的单机证据，小时级和跨区域 Final Gate 仍开放。
- [ ] 远端 workflow `37144883619` 的 local-gates 已通过，但 provider-soak 在首次 Binance 请求处 `Failed to fetch`，未形成连续订阅证据；需可访问交易所 API 的 runner/网络后重试。
- [x] 修复视觉/a11y CI 冷 runner 死锁：`tests/visual_a11y_gate.py` 不再将 Vite 输出写入未读取的 PIPE，改用临时日志文件；新增架构回归断言，等待 `f34a1c5` 后的新 CI 运行确认。
- [x] 修复一次性浏览器 fixture 的 Vite `Outdated Optimize Dep` 竞态：性能/Provider 配置关闭自动依赖 discovery，并新增架构回归断言；本地视觉/a11y 已通过，等待远端复核。
- [x] 远端 workflow `37148882921` 已通过全部 local-gates（启动/仓库、撮合、golden、触摸、视觉/a11y）；Provider/线上 deployment 仍因外部输入缺失保持开放。
- [x] 两个独立本地 preview 槽位已执行 candidate/previous deployment smoke；仅作为本地发布协议证据，不关闭真实线上 CDN/rollback Gate。
- [x] 本机 10 分钟真实 Provider 连续运行与恢复通过：Binance 288 callbacks/最大间隔 6,061ms，Hyperliquid 383 callbacks/最大间隔 10,838ms，均完成 offline→online；跨区域/代理黑洞/线上长时 Gate 仍开放。
- [x] 断网恢复 smoke 增加 `offlineBars=0` 断言，确保 offline 窗口不接受旧/迟到行情；新增恢复合同回归测试。

## 2026-10-02 首次加载优化分支复核（历史记录）

本轮基于 `feature/startup-loading-optimization` 的当前源码重新执行，不沿用旧 fixture 作为唯一证据。启动优化计划见 [STARTUP_LOADING_OPTIMIZATION_PLAN.md](docs/architecture/STARTUP_LOADING_OPTIMIZATION_PLAN.md)。

截至 2026-10-03，完整本地验收序列的各阶段均已通过；当前根测试为 532/532、Vela-PineTS 为 292/292、release 专项为 29/29、Provider recovery 本地验证通过。GitHub workflow `37132010789` 曾完成 60 秒真实网络连续订阅与 offline→online recovery；后续 600 秒/120 秒尝试分别因 runner 到 Binance 的 `Failed to fetch` 在初始化阶段失败，不能写成 10/10 长时通过。类型/构建、Bundle/依赖/repository-hygiene/dist/release、启动与视觉/a11y 门禁均通过；真实长时断网恢复、跨机器、线上 rollback 和复杂撮合等外部 Final Gate 仍未关闭。

### `task/network-release-gates` 追加推进

- [x] Provider live 增加真实 `offline`/`online` 生命周期：半开 socket 先撤销 lease，恢复时重新订阅，generation token 拒绝迟到旧 socket；覆盖失败后恢复和销毁竞态。
- [x] 新增 PineTS 1H/10m Bar Magnifier 独立 golden，固定验证 lower-feed 覆盖、stop/limit 顺序、Entry/Exit、P&L、MAE/MFE 和最终无 open trade。
- [x] 发布缓存 smoke：入口 HTML 的 no-cache/回滚切换与 hash 资源 immutable 保留旧资源兼容；release 专项当前 29/29。
- [x] Bar Magnifier/OCA/pyramiding/reversal/margin 定向回归：5 个策略测试文件共 50/50 通过；这关闭本地已实现语义的回归风险，不代表 TradingView 全量逐 Fill 对账已完成。
- [x] 新增 `npm run test:e2e:touch`：Chromium/Firefox/WebKit × phone/tablet，使用 `has_touch + tap()` 验证 Viewer/Simulation/返回图表及资源回收；默认端口冲突自动选择临时端口，显式 `QUANT_TOUCH_PORT` 仍严格校验。
- [ ] VoiceOver/真实 iOS/Android、参考站完整逐笔 golden 和复杂撮合全量语义仍需对应外部环境或同源数据；实体 Safari、线上 CDN/cache/rollback 按当前决定暂不纳入本阶段；详见 [FINAL_GATE_CLOSURE_PLAN.md](docs/architecture/FINAL_GATE_CLOSURE_PLAN.md)。

追加真实网络 soak：`python3 tests/provider_smoke.py --rounds 10` 通过，Binance Spot/Futures 与 Hyperliquid 每轮历史、symbol-info/live/unsubscribe 均成功；这是短时增强证据，仍不等同于长时间断网恢复验收。

追加兼容性回归：`npm run test:e2e:kill-switch` 通过（禁用回测的生产构建和页面入口均正确）；`npm run test:pinets:offline` 通过，PineTS 离线套件 1,637 tests、1 skipped。kill-switch 会生成禁用回测的 dist，因此保持为独立发布前检查，不并入默认 full 命令。

- [x] D-01 新策略首轮上下文缺少 `trades` 时不再误判为已结算空账本；历史完成后立即挂载、晚挂载、两种引擎及 hide/show/市场切换复核通过。
- [x] Provider live 生命周期：Binance 异步 `spotWsBase()`、Binance Futures 与 Hyperliquid 重连、迟到 `onopen`、嵌套订阅和重复 unsubscribe 均有回归测试；专项 11/11 通过，Binance/Hyperliquid 均覆盖 30 轮断开/重连后销毁，确认不会泄漏重连定时器或复活最后连接。
- [x] 根回归（历史批次）：当时工作树 `npm test` 506/506；当前总数以本节顶部最新验收为准（512/512）。Provider metadata（含 TTL=0 并发隔离）/storage/progressive、fork lock/recovery、release artifacts 专项、统一 HTTP 就绪探测、TypeScript 与 `git diff --check` 通过。
- [x] Provider 历史边界再次 fail-closed：即使未经过网络守卫的自定义 DataProvider 返回非数组或全为 malformed OHLC 行，也会发布明确错误，不再伪装成成功的空行情/genesis；新增根级回归。
- [x] `npm run verify:startup` 聚合门禁已完整执行：根测试、类型、构建、Bundle/依赖/dist、Release 和 `dev:fast --check-only` 均通过；真实 Provider smoke 与浏览器 E2E 仍单独执行。
- [x] 新增 `npm run verify:startup:full` 完整本地验收入口，串联快速门禁、三样本启动矩阵（每个单元首绘 p95 5 秒护栏）、Provider soak、主流程/Settings/故障隔离/多 Cell、开发/生产/三浏览器 E2E、离线 smoke、严格性能和视觉/a11y 回归；线上长时网络与 rollback 仍单独保留。
- [x] 新增显式 `npm run test:providers:soak` 三轮真实 Provider soak；Binance Spot/Futures 与 Hyperliquid 每轮历史、symbol-info、live 首帧和 unsubscribe 均通过。该证据不替代长时 WebSocket/断网恢复验收。
- [x] `dev:fast` 现在由独立入口消费 `--check-only`，只读校验不会再把该参数错误转发给 Vite；只读命令和真实临时端口启动均已回归。
- [x] `dev:fast` 在只读校验时检测活动 fork-build lock，避免与正在生成的产物并发启动 Vite；新增竞态回归。
- [x] 增加独立 `npm run test:release` 门禁，统一覆盖 fork-build lock/recovery、release manifest、Storage 对账和 rollback 闭环；当前 27/27，包含产物、发布根目录、锁文件及构建输入符号链接的 fail-closed 回归。
- [x] 发布 manifest 和 verifier 均拒绝 `dist` 符号链接，避免部署 tar/rsync 解析差异或链接越界导致制品字节不可控；新增独立回归。
- [x] fork 构建指纹拒绝构建输入符号链接，避免外部路径内容被纳入缓存身份或绕过工作区边界；新增 `check-only` 回归。
- [x] 生产 E2E 的 Trades Log 视图模式等待改为 DOM 契约，移除固定 500ms 睡眠，避免 Tab 切换中间态造成偶发验收失败；生产预览重新构建复跑通过。
- [x] 增加 `npm run test:startup:matrix`：按 ABBA 顺序隔离运行裸 ticker 与显式 provider 路由，输出每组首绘 median/p95；2026-10-02 最新 Chromium dev 20×4 样本 80/80 无页面错误，baseline median-of-medians `2677ms`、optimized `738ms`，baseline/optimized p95 上界分别 `2885ms/1039ms`。该受控收益不能关闭跨机器 p95、真实网络和长时 Provider 门禁。
- [x] 启动矩阵新增可选 `--max-p95` / `--max-failures` 自动护栏；三样本 `--max-p95 5000` 实测 12/12 样本无失败，baseline p95 约 `2945ms`、显式 provider p95 约 `980ms`。
- [x] 存储故障启动探针覆盖 `localStorage` getter、get/set/remove 方法和 `QuotaExceededError`；三种故障注入均能完成首绘且不阻断工作区启动，quota 已纳入 `verify:startup:full`。
- [x] 0 延迟初始化竞态探针纳入 `verify:startup:full`：Chromium、Firefox、WebKit 各执行一次 `index-delay=0`、`bar-delay=0`，当前 3/3 首绘成功；此前仅手工覆盖的同 tick 事件顺序现在有自动化门禁。
- [x] 仓库卫生门禁纳入 `verify:startup`：拒绝 Git 跟踪 `audit-evidence/`、`docs/audit/`、`dist/`、`node_modules/`，并校验 `audit-evidence/` 的忽略规则，避免部署分支携带本地审计附件或生成物。
- [x] 架构回归固定 `test:release` 脚本契约，避免部署前门禁依赖手工拼接命令。
- [x] S1/S2 本轮补强：symbol index 的 `metadataCacheTtlMs <= 0` 语义与 REST 元数据一致；模板状态校验；渐进短页 genesis 探测及失败门控均有回归测试。
- [x] PineTS 测试分流：`npm --workspace packages/pinets run test:offline` 提供 1,637 个离线测试；`test:network` 显式保留联网覆盖，网络故障不再混入启动优化本地门禁。
- [x] S4 bundle threshold：新增 `npm run check:bundle-size`，对 main/worker/highcharts raw 与 gzip 产物建立可执行预算门禁。
- [ ] 启动优化 Final Gate：本轮补测 Chromium/Firefox/WebKit 首绘与 getter/methods/quota 存储故障均通过；完整冷/热 p95、长时 Provider/断网恢复、实际线上入口、部署制品 rollback、完整 Provider/品种/模板回归仍未关闭。
- [x] 增加安全的 `npm run dev:fast`：复用 fork 输入/输出/toolchain 指纹做只读校验；过期或缺失时拒绝启动并提示先构建，普通 `npm run dev` 仍负责自动修复。
- [x] Pine Editor 真正按首次可见/用户操作懒加载：隐藏侧栏挂载、后台诊断和删除事件不会触发 CodeMirror chunk；打开/新建/打开脚本才加载，失败可重试，destroy 会断开观察器。
- [x] 修复嵌套 WebSocket 订阅的异常回滚：内层同步失败恢复进入该 lease 前的外层构造器，不再破坏仍存活的 Provider guard；新增嵌套失败及 30 轮生命周期回归。
- [x] 本地 release manifest/verify：旧 checkout、dist 篡改拒绝及当前 dist 完整性均通过；部署平台 slot rollback/CDN 缓存恢复仍需线上验收。
- [x] Provider index 恢复周期：缓存过期后的重复故障可再次 fallback/retry/re-register；malformed symbol descriptor 不再污染交易品索引，ticker 外层空白会被归一化。
- [x] 历史点位恢复周期解析严格区分 `M` 月与 `m` 分钟；Workspace 历史预算和 runtime storage 输入边界已补回归。
- [x] Bar Magnifier lower-feed 对超大/非安全周期值安全降级，不构造不安全范围或 limit；补充 Vela-PineTS 回归。
- [x] `request.security` secondary feed 对 resolved malformed OHLC、坏 getter、非法 volume、重复和乱序时间戳安全归一，同时保留 rejected Provider error metadata；补充 Vela-PineTS 回归。
- [x] 渐进历史分页无进度保护：重复页、忽略 `to` 边界或非空但不可归一化响应不再误判 genesis；保留已绘制前缀并发布错误，补充回归。
- [x] lower-timeframe cache 只缓存完整有限 OHLCV；混合 malformed 结果不污染 TTL，后续 retry 可恢复。
- [x] 历史观察器保留本代 completion 边界，迟到 Provider/progressive 错误会撤销假 genesis/no-data；新增两条回归。
- [x] release manifest 增加显式 `--help`，避免帮助请求误生成 JSON；release-artifacts 回归 9/9。
- [x] fork 构建锁释放竞态：旧 owner 在 token 校验与删除之间不再可能误删新 owner 的同名锁；原子 hand-off 与受控竞态回归已通过。
- [x] fork 构建锁 owner.json 初始化失败会清理刚 claim 的目录，不再留下无 owner 锁导致后续构建无限等待；失败注入回归已通过。
- [x] Provider metadata 不可安全克隆时 fail-closed 且不进入 TTL 缓存；progressive abort 即使已获取完整前缀也返回明确错误，避免误发布 ready。
- [x] Provider 网络层所有 JSON 响应（含不可缓存历史 K 线）均按调用方隔离；并发 transport 仍去重，嵌套数组/行对象 mutation 回归通过。
- [x] Hyperliquid POST JSON 响应同样按调用方隔离，覆盖 universe/nested payload 的并发 mutation 回归。
- [x] 不可克隆的非 metadata 历史 JSON 会 fail-closed，并清理 in-flight 状态允许后续重试。
- [x] 修复开发 E2E Trades Log 表头在实时报告替换期间的交叉读取时序误报；等待完整 sortable header 快照后，开发 E2E 复跑通过。
- [x] 修复 aborted-history Retry 在 market 缺少 `bars` 时静默降级到 500 根；history observer 与 adapter 现在统一使用 2000 根默认深度，并有回归测试。
- [x] fork 构建完成清单不再把 npm 调用方的 `npm_config_user_agent` 当作产物输入；直接 Node 调用与 `npm run` 现在复用同一缓存，仍按 Node/platform/arch 和源码 fingerprint 隔离。
- [x] 本轮工作区回归补齐 Settings、故障隔离、多 Cell、strict performance、visual/a11y、开发/生产 E2E、三浏览器和 Binance/Hyperliquid smoke；未停止外部已存在的 5190 端口进程。
- [x] 生产离线 smoke：HTTP 200、页面错误 0、无非预期外部资源；Provider 请求按离线策略被阻断并可观测，不伪造行情成功。
- [x] 本轮回归（历史批次）：根测试 473/473、Vela-PineTS 291/291；旧数字仅保留用于追溯，不代表当前工作树总数。
- [x] 历史修复批次记录：Workspace 持久化 `bars` 小数预算在迁移边界规范为正整数；`request.security` secondary feed 重新执行时间范围和 newest-tail limit；新增根级 `npm run typecheck` 统一根应用与 Vela-PineTS 类型检查。当时目标回归 30/30、根测试 483/483、Vela-PineTS 292/292，构建/依赖/dist/bundle 门禁通过；当前总计以本节顶部状态为准。
- [x] secondary feed 边界补强：直接 Worker/in-process 路径拒绝非有限日期、反向区间和 `limit <= 0`，避免宽松第三方 Provider 绕过应用 range 合同；Vela-PineTS 全量 292/292、边界目标 30/30 通过。
- [x] Provider live 重复生命周期 soak：新增 30 轮 subscribe/unsubscribe、socket 关闭、wrapper 恢复和重复 unsubscribe 幂等回归；该修复批次根测试为 483/483，当前总计以本节顶部状态为准。该本地门禁不替代真实长时网络/断网恢复验收。
- [x] Provider metadata 缓存隔离：TTL 命中和并发去重均向调用方提供独立嵌套快照，消费者修改 `symbols`/`filters` 不会污染后续请求；Provider network 回归已覆盖。
- [x] Fork 构建并发保护：`ensure-fork-build` 增加跨进程锁和构建后复查，真实双进程并发执行只重建一次，等待者复用产物；避免测试/构建并行时读到中间 fork 输出。
- [x] 正式构建入口接入并发保护：`prebuild` 不再绕过 `ensure-fork-build` 直接执行 fork 构建，`npm run build` 与 test/dev 共用同一锁和二次状态检查。
- [x] 公共 `npm run build:forks` 也统一走锁；真正编译步骤改名为内部 `build:forks:run`，避免维护者从该入口绕过并发保护。
- [x] Fork 缓存完成清单：使用输入/输出 SHA-256、失败 marker 和 PineTS 类型入口校验，失败/中断后的部分产物不会被下次启动误复用；stale-lock 回收增加二次互斥和 owner 重读。
- [x] Fork 缓存环境隔离：完成清单记录 Node/platform/arch/npm toolchain fingerprint，跨环境缓存自动失效并重建。
- [x] Fork 缓存内容身份回归：输入内容变化但 mtime 不变时仍能识别并重建。
- [x] 显式 provider 路由启动对照：受控 2 秒索引延迟下，`binance:BTCUSDT` 首绘约 1.07s，裸 `BTCUSDT` 约 3.15s；保留裸 ticker 的有限回退，不伪造其已绕过索引等待。
- [x] Provider smoke 增加真实 Binance spot、Binance futures（`BTCUSDT.P`/1h）和 Hyperliquid（`BTC`/15m）路由；历史、futures symbol-info 和 spot/Hyperliquid live 均通过。长时网络故障仍开放。
- [x] 固化 `npm run test:providers:long` 十轮真实 Provider soak 入口；该命令用于部署前手工执行，不并入默认门禁，不能替代长时断网/恢复验收。
- [x] 固化 `npm run verify:startup:deploy` 部署预检入口：串联本地快速门禁和十轮真实 Provider soak；默认完整门禁仍保持可离线运行。
- [x] 增加 Binance 45m/180m 聚合 golden，验证 15m/1h 子周期选择、3 倍分桶、OHLC 和 newest-tail limit；真实深历史/forming bar 仍需线上验收。
- [x] Pine Editor/CodeMirror 改为首次打开动态加载；主 chunk 约从 2.28MB/648KB gzip 降到 1.77MB/477KB gzip，动态编辑器 chunk 约 508KB/170KB gzip；主 E2E、类型检查和构建通过。
- [x] E2E 增加编辑器 chunk 的首屏未加载/打开后加载断言，开发与生产回归均通过。

## 2026-10-01 R-08～R-11 修复后独立复查（历史记录；当前状态见 2026-10-06 顶部）

详见 `BACKTEST_R09_RECHECK_3_2026-10-01.md`（本地忽略证据，公开仓库不携带）、`R-09 新证据`（本地忽略证据，公开仓库不携带） 与 `BACKTEST_R08_R11_RECHECK_2026-10-01.md`（本地忽略证据，公开仓库不携带）。本轮不继承修复记录 PASS；本轮重新执行真实页面、三浏览器 pointer/keyboard 探针和完整项目门禁。

- [x] R-08：Performance All/Long/Short 与 Outperformance 当前页面口径可复算；双引擎 8/8、真实 Binance 页面复核通过。
- [x] R-10：市场/副周期竞态与旧 run fence；双引擎等待期不再 ready/Simulation。
- [x] R-11：503/429/超时/非法 JSON、Retry 12,500 根、旧请求 supersede、共享 Provider 多 Cell；独立矩阵 18/18，双 Cell 复核通过。
- [x] R-09 完整焦点生命周期：Tab/Shift+Tab/Escape/busy 及真实 Workbench pointer-open 三浏览器均回到 Settings 触发按钮；主 E2E 通过。
- [x] D-01 动态历史绑定：本轮修复“idle 且缺少 trades 字段被误判为空账本”的边界；独立历史完成后立即挂载、晚挂载和延迟适配器流程均未再观察到 ready + 空账本。完整参考站逐笔 golden 仍另行开放。
- [ ] 当时尚缺完整参考站逐笔 golden（227 closed）、复杂撮合/Bar Magnifier、真实 WS/长时故障、全量像素对账、VoiceOver/跨设备、rollback；后续状态以 2026-10-06 顶部记录为准。

本次文档刷新后再次执行 `npm test`、Vela-PineTS、TypeScript、build、依赖契约、dist 独立性、主 `npm run test:e2e` 和 `git diff --check`，结果通过；新证据目录包含三浏览器 pointer/keyboard、Settings traversal 及结构化门禁 status JSON。R-09 当前契约关闭，但整体 **PARTIAL**；Replay 仍不在当前阶段范围。

## 2026-10-01 R-08～R-11 修复后复核（历史记录；当前状态见上一节）

详见 `R-08～R-11 修复记录`（本地忽略证据，公开仓库不携带） 与 `新证据`（本地忽略证据，公开仓库不携带）。

- [x] R-08 Performance 收益口径：MTM 总收益、多空可证明分项、Outperformance 统一公式；对冲缺少逐腿估值时不伪造方向值（后续独立复查继续通过）。
- [x] R-09 WebKit Settings Tab/Shift+Tab、Escape 与 busy 焦点约束；历史复查曾发现真实 pointer-open 的 focus return 边界，已在 R-09 第三轮真实三浏览器复查中关闭。该行保留为历史过程记录。
- [x] R-10 市场/副周期竞态与旧 run fence；双引擎六场景及旧 run 注入通过（后续独立复查继续通过）。
- [x] R-11 Provider 503/429/timeout/invalid JSON、Retry、真实空历史、共享 Provider 多 Cell 隔离；双引擎故障矩阵18/18，真实双 Cell 通过（后续独立复查继续通过）。
- [x] 同 id Cell 重建、切市场时 Retry Promise 绑定实例/代次/市场，不复用旧请求（后续独立复查继续通过）。
- [ ] 完整逐笔 reference golden：仍缺 227 closed；精确执行 source bytes 仍需重新冻结。
- [ ] Bar Magnifier/partial fill/pyramiding/reversal/OCA 等复杂撮合及默认 Provider 深历史/partial policy。
- [ ] 长时 Provider 故障、跨设备/VoiceOver、整体像素 diff、bundle threshold、实际 rollback 等 Final Gate。

整体仍为 **PARTIAL**；Replay 按用户要求不在本阶段范围。

## 2026-10-01 账本与视觉修复（修复者过程记录）

修复记录与新证据见 `BACKTEST_LEDGER_VISUAL_REMEDIATION_2026-10-01.md`（本地忽略证据，公开仓库不携带）。以下旧审计和旧失败保留追溯，不作为本轮通过依据。

- [x] SMA-UI-01：默认首次添加策略恢复完整 KPI/交易；新真实 Binance.US 500-bar、12 次采样、真实 WebSocket frame 和单 tick 停止对照通过。
- [x] D-01 正常启动：接管初始历史代次；Controller terminal/readiness 与账本发布条件统一；两种真实引擎无需 reload/tick 即完整首发。
- [x] V-04/V-05/V-07/V-08：移动 KPI、关闭按钮、Settings 可见图标、SVG 实例 ID；三浏览器新 DOM/交互验证通过。
- [x] D-01 扩展：生产工厂提前观察 history，晚挂载恢复已知依据；原始 adapter 不再 ready+unknown；工厂真实浏览器与销毁验证通过。
- [x] 深历史时序：两种真实引擎 × 12,000 根市场切换、36→2,000 depth-only 四组通过；挂起首个旧range请求时立即失效旧ready，补齐后恢复。
- [x] V-03：图表/Viewer 本地 BTC/ETH SVG 统一，真实图表解码/导出与未知资产 fallback 验证通过。
- [x] V-10 modal 部分：双弹窗及三浏览器各 14/14；精确视觉几何仍开放，不将 V-10 整项关闭。
- [ ] 完整逐笔 golden、Provider 深历史/partial policy、复杂撮合、整体像素对账、长时/VoiceOver/rollback 等 Final Gate。Replay 除外。

## 2026-09-30 独立参考对账与真实 Provider 复核（修复前记录）

最新综合报告：`BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带）。固定 LuxAlgo 5,000-bar 响应上的用户 SMA 9/21 与本地 PineEngine 算术 parity 已通过；2026-10-01 全新浏览器流程再次确认本地默认 Binance.US 500-bar 真实 UI 的 ledger 指标仍为空、Viewer readiness 未完成，证据见 `independent real-provider recheck`（本地忽略证据，公开仓库不携带）。D-01 history/strategy insertion race 和视觉 V-04/V-05 仍开放。整体 Final Gate 仍为 **PARTIAL**。

- [x] 固定 provider response + 固定窗口的 SMA 9/21：参考站与本地 PineEngine Net P&L `-435.20`、Gross Profit/Loss、Max DD、96/184、Profit Factor `0.992` 一致；open row 的 280/281 人口差异已记录。
- [ ] 默认本地应用改为可对账的 provider/partial policy，并修复真实 500-bar ledger/readiness；不能用固定引擎结果替代 UI 链路。
- [ ] D-01、移动 KPI 溢出、Settings close 默认样式、宿主壳层、复杂撮合、VoiceOver、rollback 等 Final Gate。

## 2026-10-01 动态深审 D-01 修复（历史记录；当前状态见 2026-10-02 启动优化复核）

- [x] D-01：该历史探针当时发现首个 `status=ready` / `history.complete=false` 边界；后续已增加 partial/pending、ledger 绑定和新策略首轮门控，并在两种真实引擎的立即挂载、晚挂载、hide/show、市场切换路径复核通过。原始发现详见 `BACKTEST_DYNAMIC_DEEP_REMEDIATION_2026-10-01.md`（本地忽略证据，公开仓库不携带），当前结论以顶部最新状态为准。
- [ ] 继续完整参考站逐笔字段（Entry/Exit/Size/P&L/MFE/MAE）对账、复杂撮合/Bar Magnifier、真实 Provider 深历史故障、VoiceOver/跨设备/长时资源、bundle threshold 和实际 rollback。

## 2026-09-30 动态深审（历史快照）

最新综合报告：`BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带）。本轮使用新启动的本地服务、独立 Chromium 动态探针和当前源适配器 probe；旧测试集、旧 fixture、旧修复记录只作为场景索引。

- [x] R-05/R-06/R-07 当前适配器独立 probe：9/9 通过；新证据见 `dynamic-deep`（本地忽略证据，公开仓库不携带）。
- [x] 两种真实 Pine 引擎、Viewer 四 Tab、Simulation、Settings 失败恢复、EMPTY/hide/show、重叠市场/周期、多 Cell、重复挂载和销毁资源动态路径已复查。
- [x] **D-01（历史发现）**：图表已宣布初始 `history:complete` 后立即新增策略的首个快照曾出现 `ready`/空账本边界；后续已修复并由两种真实引擎浏览器流程复核，不再作为当前开放缺陷。
- [ ] 参考站同数据逐笔/汇总对账、复杂撮合/Bar Magnifier/partial fill/复合订单、真实 Provider 深历史故障链路、跨设备/VoiceOver/长时资源、bundle threshold 和真实制品 rollback。

当前整体回测计划仍为 **PARTIAL，Final Gate 未关闭**；不要用 root/Vela 测试总数或参考站动态截图宣称全部完成。

## 2026-09-30 第四轮独立复查（历史快照）

最新报告：`BACKTEST_AUDIT_RECHECK_4_2026-09-30.md`（本地忽略证据，公开仓库不携带）。R-06/R-07 后续修复记录见 `BACKTEST_RECHECK_4_REMEDIATION_2026-09-30.md`（本地忽略证据，公开仓库不携带），原第四轮失败证据保留。

- [x] **R-05**：synthetic snapshot 已显式提供 `ledgerRevision`；独立浏览器加载 Simulation fixture 通过，开发 E2E 重新通过。
- [x] **R-07**：EMPTY 后新增策略、迟到旧 market/load/history 事件、旧 run metadata 均已增加 cell 级 noData/市场归属/清理门控。
- [x] **R-06**：mixed tick 缺少 `trades` 时明确拒绝；合法同 run/non-regressing 过渡及后续 full recovery 保留，旧 run/retry 仍拒绝。
- [ ] 继续参考站逐笔/汇总对账、完整撮合/Bar Magnifier/复合订单、真实 Provider 长链路、跨设备/长时资源、VoiceOver、bundle threshold 和实际制品 rollback 等 Final Gate。

局部真实引擎和 smoke 通过不代表整个回测计划完成。证据归档见 `audit-evidence/2026-09-30-recheck-4/README.md`（本地忽略证据，公开仓库不携带）。

## 2026-09-30 第二轮独立修复复核（历史记录；当前状态见第四轮）

对象为 `feature/backtest-workspace-build` 的 HEAD `53ab05795f45e5440eba1c1513b3bb63a659b9ae` 加最新未提交修复。相对上轮有 7 个业务文件改变。本轮重新构建、拉起 dev/production 服务并编写全新探针；未沿用仓库测试、旧审计或修复者结论作通过证据。详见 `BACKTEST_AUDIT_RECHECK_2_2026-09-30.md`（本地忽略证据，公开仓库不携带）。

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

R/O/S/U 的 `[x]` 仅指明确修复与复测场景，不代表相关模块全部关闭。最新修复记录见 `BACKTEST_RECHECK_2_REMEDIATION_2026-09-30.md`（本地忽略证据，公开仓库不携带），原独立失败证据保持不变；后续仍需独立复核。Replay 不在本阶段范围，许可证不作为本地自用阶段的验收阻塞。

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

当前范围（2026-10-07）：逐项映射与执行状态见 [需求表的复杂撮合细项](docs/backtesting/current/BACKTEST_REQUIREMENTS_STATUS.md#复杂撮合细项原第-8-项不另立一套范围)。本节保留原始技术调研和分阶段记录；完整 TV 外部逐 Fill、真实逐笔/盘口和秒级数据源扩建不作当前关闭条件，不能反过来省略本地复合订单、重算、费用和风控语义。许可证不作为本地自用阶段阻塞。

状态：G8 第一版及 in-process/Worker parity、order/fill audit、默认/高精度开关和历史回放已有证据；复杂撮合组合边界及最终非回归仍为 PARTIAL。高精度 live 当前显式回退，不能写成完整实时高精度已实现。

优先级：继续以独立预期核对未收口的本地撮合组合；不重复实施已有证据的基础用例。下方旧阶段中的 TV 对账/许可待办按上述当前口径处理，不重入本期队列。

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
- 完整 TradingView 外部导出按 SCOPE-05 不作为本期关闭条件；以独立成交预期验收已选语义。
- [ ] 建立市价、限价、止损、同 K 线止盈止损、跳空、反转、金字塔和部分平仓测试用例。
- 保留 TradingView 调研作为语义参考；完整外部逐 Fill 差分本期不阻塞，本地默认/高精度各自使用独立预期。

#### 第二阶段：重构 PineTS 模拟价格路径（G8 第一版已完成，完整语义仍 PARTIAL）

- [x] 在 PineTS Broker Emulator 中引入有时间顺序的模拟 tick/price-path 回放：低周期 K 线按有序四点路径驱动现有订单状态机；默认图表 OHLC 路径仍保留兼容分支。（PARTIAL：尚未统一替换全部旧撮合阶段。）
- [x] 实现低周期 `O-H-L-C` / `O-L-H-C` 四点回放，并按开盘距离选择中间极值顺序。（PARTIAL：TradingView 全部边界规则尚未逐 Fill 对账。）
- [x] 为低周期窗口定义订单生效、成交和父 K 线账本边界，拒绝窗口外/缺口数据。成交后新订单可在同父 K 后续低周期价格点继续处理，不能回溯创建前路径；父周期报告只保留一个终态点。
- [x] 接入 `calc_on_order_fills`、`calc_on_every_tick` 的首版执行语义：chart-OHLC 在成交后提供一次不增加报告点的重算，已校验的 lower-timeframe 路径按模拟 tick/成交触发重算；当前只余已列跨订单顺序、实时风险回滚和归档重放；完整 TV 外部逐 Fill 按 SCOPE-05 不作为关闭条件。
- [x] 为 PineTS 内部 broker 增加 append-only order/fill lifecycle ledger，并覆盖创建、成交、取消、拒绝、partial progress、parent/reversal relation 和 streaming rollback；通过本地 Vela-PineTS 的 identity-bound `auditLedger` snapshot 选择性桥接到 Quant Adapter 的 `rawOrders/rawFills`，上游未修改的 Vela 能力仍保持 `false`，不把不完整/过期事件伪造成公共结果。
- [x] 实现 `strategy.risk.max_intraday_loss`、`max_intraday_filled_orders` 和 `max_cons_loss_days` 的交易所时区日切换基础语义；chart-OHLC 下仍不宣称 tick 级风险检查等价。
- [x] 将 PineTS 上下文中原先 console-only 的 bare `error()` 实现为可捕获的 `PineRuntimeError`；`runtime.error()` 继续使用同一类运行时错误契约。
- [ ] 保持手续费、滑点、最小变动单位、FIFO、保证金和交易账本统计一致。

#### 第三阶段：接入低周期 K 线（G8 第一版已完成，缓存/Provider 深度仍 PARTIAL）

- [x] 建立集中式图表周期到回放周期映射配置，不把映射散落在 Provider 或 UI 中；不支持 1m→10s、5m→30s 时显式返回未确定映射。
- [x] 通过 Vela 的 `fetchSeries(symbol, timeframe, range)` 请求低周期数据，并在 Worker 中按 session 路由请求。专用有界缓存已实现，见下项；不新增持久缓存要求。
- [x] 按父周期半开时间边界校验并归组低周期 K 线，处理 Binance inclusive closeTime。（PARTIAL：复杂交易时段/交易所时区日历仍待补。）
- [x] 为低周期数据增加按 `provider / symbol / timeframe / range` 复用的有界缓存：执行 session 内并发去重、LRU 容量、成功响应 TTL，以及 provider/精确窗口/会话级失效；`request.security` 仍保持原有非缓存语义。（PARTIAL：跨 session 的持久缓存不纳入，forming/live 请求仍由宿主通知主动失效。）
- [x] 对缺失、重复、不完整、越界、断档和 live/仍在形成的低周期请求定义确定性回退规则，并将覆盖率/原因传到结果 UI。forming/asOf、历史上限、未来边界及 closed 已由 `tests/e2e_precision_history.py` 双真实浏览器引擎 8/8 验证；生产复杂组合仍按 ENGINE-03 验收。
- [x] Binance 优先实现分钟级映射；Hyperliquid 仍沿用 Provider 的历史深度限制。5,000 子 K 上限场景已验证 833/2,000（41.7%）覆盖率及可见 fallback；输入为受控行情，不等于实际交易所各窗口都有完整数据。
- [x] 1m→10s、5m→30s 因当前 Provider 不提供秒级历史数据，首期禁用或回退，不伪造高精度结果；运行时映射 helper 对这两个周期返回 `undefined`，其余周期仅使用表内且 provider-backed 的映射。

#### 第四阶段：重新构建 Worker 桥接层（G8 第一版已完成）

- [x] Fork PineTS 并在源码仓库实现，不直接修改 `node_modules` 产物。
- [x] Fork/rebuild `@luxalgo/vela-pinets`，确保 `PineWorkerEngine` 内联修改后的 PineTS。
- [x] 将本项目依赖锁定到可复现的自有版本或提交哈希，并在 build fingerprint 中记录 Fork 身份。
- [x] 验证 in-process `PineEngine` 与 `PineWorkerEngine` 的 precision envelope/结果边界一致。当前独立预期、真实 Worker 与历史精度/风险浏览器证据分别列于需求表；不以完整 TV 外部 parity 阻塞。
- [x] PineTS / Vela-PineTS 许可证评估按用户决定移出当前本地自用阶段，不作为本阶段实现、验收或部署阻塞；未来公开分发时另行复核。

#### 第五阶段：产品入口与结果展示（G8 第一版已完成）

- [x] 在策略 Properties 中增加“Default precision / High precision”选项；控件直接读写真实 `use_bar_magnifier` boolean 属性，不保存第二份 UI 状态。Cancel/Reset 均只改草稿，precision-only 的 Ok 只发一次 `setProps` 批量更新/重算；秒级数据不受 Provider 支持时继续由结果页现有 precision fallback 明示，不能把“已请求”显示成“已应用”。
- [x] 显示实际采用的低周期、覆盖率、父/子 K 线计数和回退原因；模拟点数可由映射与四点规则确定。独立逐点明细面板未纳入当前产品需求，不作为缺失功能追加。
- [x] 当高精度不可用或发生回退时，在 Dock/Viewer 结果页显示可访问的状态、tooltip 和 machine-readable fallback reason，不只写控制台日志。
- [x] 回测最终结果门控：深度回填期间可以保留图表进度/部分状态，但最终指标、交易账本、曲线能力和 Simulation 均必须等待完整历史与同 revision ledger；适配器/控制器回归已覆盖。
- [x] 在执行上下文/结果 envelope 中记录数据源、精度模式、引擎 provenance 和关键策略参数。2026-10-07 已补真实 execute 完整输入归档，两份有限场景离线重放共496字段零差异；不新增用户导出按钮，原始数据留本地忽略目录。

### 验收标准

- [x] 默认精度下现有基础策略回归集通过。（PARTIAL：PineTS 全仓联网套件受 Binance 网络超时影响，不能宣称全仓 PASS。）
- [x] 1H 高精度能够使用六根 10m K 线生成 24 个有序模拟价格点，并据此处理订单。（PARTIAL：当前证据为本地固定 OHLCV fixture。）
- [x] 同一父 K 线内先后触发的止盈、止损结果与低周期路径一致。（PARTIAL：复杂复合订单组合仍待。）
- [x] 低周期窗口拒绝创建前/窗口外数据并保持确定性时间边界。（PARTIAL：完整未来函数审计和所有重算配置仍待。）
- [x] 缺失低周期数据时结果明确标记为回退模式。
- [x] Worker 版本实际运行自有 PineTS 构建，而不是 npm 包内联的旧版本，并通过 fingerprint/parity 检查。
- 当前逐项验收以独立预期为准；完整 TV 外部逐 Fill 对账按 SCOPE-05 不作为关闭条件，不能混同已通过的 LuxAlgo SMA 数值窗口。

### 暂不纳入

- 交易所真实逐笔成交和订单簿回放。
- 市场冲击、盘口深度、部分成交和排队位置模拟。
- 同时持有多仓与空仓的 Hedge Mode。
- 在没有秒级历史数据时自行插值或随机生成秒级价格路径。

真实 Tick 回测可作为后续独立能力：Binance 可评估 `aggTrade` 数据采集与存储，Hyperliquid 需另行确认历史逐笔数据覆盖。它不应与本次 TradingView 模拟 Tick 对标混为同一任务。
## 2026-10-03 Final Gate 本地收敛（历史过程记录；当前范围见顶部）

- [x] Provider live 在 offline/online、迟到 socket、重复断开和销毁竞态下保持代次隔离；真实 Binance Spot/Futures、Hyperliquid 10 轮 smoke 通过。
- [x] 本地 preview 缓存策略与 release smoke 对齐：入口不可缓存、hash 资源 immutable；真实 CDN/线上 rollback 仍开放。
- [x] 触摸三浏览器、Bar Magnifier golden、release 29 项和根测试 517 项通过。
- [x] Provider smoke 关闭 HMR，避免构建副作用触发页面导航导致假失败；wait-for-http 高负载启动断言已稳定化。
- [ ] 当时记录的外部 Final Gate：真实长时 WS/断网、线上部署与 rollback、参考站完整逐笔 golden、完整复杂撮合对账、实体 Safari/VoiceOver/跨设备、全量像素对账。按当前用户决定，线上部署/CDN/rollback 已移出本阶段；其余未关闭项以顶部需求表为准。
- [x] 新增 `npm run test:e2e:deployment`：配置 `QUANT_DEPLOY_URL`（可选 `QUANT_PREVIOUS_URL`）后检查真实 candidate/previous 入口、hash 资源缓存策略、页面错误和参考站请求；未配置地址时明确 `not_run`，不会伪造通过。
- [x] 新增 `npm run test:reference:golden`：完整参考站/本地交易 JSON 的逐笔字段比较入口；缺少完整输入时明确 `not_run`，不把部分采集结果当成 parity。
- [x] 外部 Final Gate 输入与验收标准已集中记录：[EXTERNAL_FINAL_GATE_INPUTS.md](docs/architecture/EXTERNAL_FINAL_GATE_INPUTS.md)。
- [x] 新增 `npm run verify:final-gates:local`，统一执行本地启动、类型、构建、release、复杂撮合、Bar Magnifier、触摸和视觉/a11y 门禁；外部 golden/线上设备仍需单独输入。

2026-10-03 已重新执行参考站自动登录与动态采集：进入 Vela workspace 并获得真实移动端页面，但 RSC 从 `app.luxalgo.com` 跳转至 `vela.luxalgo.com` 时出现 CORS/连接关闭，未能采集完整 Trades Log；该运行仅作为黑盒行为证据，未关闭逐笔 golden。
