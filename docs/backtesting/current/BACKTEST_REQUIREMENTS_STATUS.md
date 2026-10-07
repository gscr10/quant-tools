# 回测工作区需求状态表

> 2026-10-07 继续复核：在当前工作树重新执行 `npm test`（653/653）、Vela-PineTS（310/310）、TypeScript、生产构建、bundle/依赖/仓库/dist/release 门禁及 `npm run test:e2e:prod`，均通过。真实 Provider 低周期/跨周期检查 `tests/e2e_history_real.py` 的 16 个场景和双引擎主动手势分页 `tests/e2e_history_gestures.py` 的 26 个场景均通过；未发现新的业务回归。此记录只更新验证时点，不改变手机、Safari、线上部署、Replay、桌面 VoiceOver 等既有范围决定。

> 最新对齐批次（2026-10-07）：H-09改为共享Tab滚动/实际高度夹紧，受控56项、真实dev70项及prod70项通过；S-11离开Simulation后恢复默认并按策略身份取消旧任务，浏览器216/216通过；D-10极小轴科学记数已对齐，8个实际surface/28个SVG标签通过。随后真实脚本错误重试/首次错误处理已修，Adapter32/32、相关Controller/History121/121及双引擎真实4/4通过；旧Workspace恢复两浏览器各三阶段通过；故障隔离8/8场景、198/198检查通过。K线空最新页缓存保护/连续性定向31项通过。Adapter/持久化修改后的根测试为653/653，类型、构建、生产主E2E和工程门禁已通过。证据在忽略目录 `audit-evidence/2026-10-07-tab-parity-closure/`、`2026-10-07-real-script-error-final/`、`audit-evidence/2026-10-07-storage-restoration-final/`、`audit-evidence/2026-10-07-workspace-fault-isolation-final/`；旧per-Tab/保留参数/极小轴差异不再列为未完成，下面更早批次保留时点。本地提交已建立，远端 BUILD-03 以本次提交的 Actions 为准。

> 2026-10-07 后续两项修复：pointer hover提示时Escape曾误关Viewer；Analysis点选Escape曾blur到BODY。现先隐藏提示、保留Tab/所选点焦点，Home继续导航；无提示时正常退出。两浏览器Simulation164/164、Performance/Analysis独立66/66及Analysis永久212/212通过，原失败均保留；最后源码根639/639、类型、新构建/生产主E2E及包体/独立性检查通过。证据在本地忽略目录 `audit-evidence/2026-10-07-pointer-tooltip-escape/`、`2026-10-07-shared-tooltip-escape/`；不是全量视觉或VoiceOver复验。并纠正旧golden/HMR/图例待办、参考状态误述和补丁/rollback范围冲突。

> 2026-10-07 桌面非文字可辨识续验：已修复 Calendar 焦点框、Settings 默认控件边界及 Simulation 置信区间低对比度/区间键盘不可达。实际两浏览器控件20项取色、16项键盘通过；区间轮廓及中位线最低4.41:1，原始68点可读，Simulation四场景144/144通过，计算值未改。最新根639/639、类型、重建/生产主E2E、紧凑桌面4场景228项及6项清理、包体/仓库/dist检查通过。此前完整本地门禁保持原时点；本轮未改视觉基线，VoiceOver与参考交互差异仍开放。证据仅在忽略目录 `audit-evidence/2026-10-07-essential-control-contrast/after/` 和 `audit-evidence/2026-10-07-simulation-band-contrast/`。

更新时间：2026-10-08（UI 验收按用户最新修正：功能、交互及组件风格对标，整体布局适配本项目；当前内容已本地 commit，远端 BUILD-03 仍待对应提交的 Actions 结果）

**最新范围调整：手机端适配暂缓。** 手机布局、横竖屏、safe-area、手机触摸及手机实机专项不再作为本阶段开发或验收阻塞（SCOPE-07）；不是已通过，也不回退已有实现。当前继续桌面工作区全部模块的功能、组件、交互和本项目布局适配，包含桌面窗口缩放、键盘及辅助技术要求。已有手机证据保留，通用数据/引擎缺陷不因手机暂缓而免修。

**现行 UI 验收口径**：“像素级复刻”指 Backtest Workspace 的功能、交互、图标和组件风格与参考站一致，同时适配本项目的页面空间。本项目没有参考站左侧 AI 对话区和顶部登录 banner，不复制这两部分，也不保留它们的占位。整页绝对坐标、宽高和逐像素差异不作为通过条件；具体检查方式见下方“UI 对标评价标准”。此决定替代旧文档的全页 1px / 0.5% / 1% 硬阈值，不自动关闭尚未验证的模块。

**最新桌面续验已完成本批验证**：Dock 原生组件同输入对照 393/393、Dock 两浏览器四宿主 632 项、Summary/Dock 键盘 176 项、根 639/639、类型/构建、dev/prod 主 E2E、依赖/仓库/包体/dist 通过；桌面 responsive 32 场景/1,792 项、Analysis164 项、Log/Calendar858 项及 Settings 专项通过。Dock 视觉基线已按确认的垂直 Header→KPI→图表结构更新，desktop/laptop strict visual 通过，阈值未变；tablet/mobile 基线未改。最后 Settings 同快照刷新竞态、独立挂载 box-sizing、空态 Ghost 以及 H-06 图例名称均已修复。失败记录与源码时点见本地 `audit-evidence/2026-10-07-dock-keyboard-closure/` 和 `2026-10-07-dock-components/`。默认 desktop，手机 full 保留可选；整体 Final Gate 仍未关闭。

此前UI批次：Analysis8组各41项、Settings三浏览器、Log/Calendar18组/2,610项、图标8组988项及根627/627、生产32状态均保留当时证据。它们不覆盖后续修改；最新桌面续验见上段，各组件同输入及typed引擎验证见下表。

当前进展：非 OCA 跨订单顺序、形成中 K 线风险回滚、归档输入离线重放三项已有新构建证据；Margin call 审计缺失和实时 closeTime 遗漏已修。Calendar 跨格金额重叠已修为七列内可读缩写，并提供触摸/键盘可打开的完整日值；同输入参考组件差分和实际交互矩阵分别留证，不将 DOM 激活采集冒充真实 pointer 验收。全部工作区组件/状态尚未统一关闭。完整 Workspace 两小时实测仍限定其冻结生产构建、Chromium 和真实 Hyperliquid 范围，不扩大为全部设备、最新未提交源码或线上部署。

复核对象：`task/p1-priority` 当前最新提交（包含本轮生产 E2E 稳定性修复）。需求口径、代码实现和验收结果分别记录；末尾列明已取得证据及其时点，不用既往测试数字证明最新工作树整体通过。

较早 Log 卡片边框与视觉基线批次已核对坐标轴抗锯齿、Return-to-chart 图标和卡片填充高度，并通过当时的视觉/a11y、根测试、类型、构建及开发/生产 E2E。其后又有控件、Calendar、Performance 和性能修改；旧截图通过不覆盖最新源码，本轮最终统一门禁须单独记录，不自动刷新基线。

这份表是当前有效的需求清单；用户的明确决定优先于本文。旧审计报告和历史测试记录只用于追溯，不覆盖这里的状态。

本次再次复核补齐了原矩阵 PF-01～06、PF-09～10 的大数据/图表性能映射（PERF-01），避免误把启动预算通过当作全部运行期性能通过；同时同步清理关联文档中仍将已验长测和启动预算列为待办的旧文字。用户已确认无需补充信息，已提供的参考站入口和现有授权继续有效；参考差异的复测、同输入采集和实现判断仍是后续工作，不笼统改成“等待用户确认”。

低周期 K 线连续性、分页保护和统一周期切换策略的实现与验证细节见
[BACKTEST_LOW_TIMEFRAME_GAP_REMEDIATION.md](BACKTEST_LOW_TIMEFRAME_GAP_REMEDIATION.md)。
该文档中的局部通过不能代替完整 K 线需求验收；跨区域与长时网络分别记录证据和环境；手机实机按 SCOPE-07 暂缓，桌面辅助技术不因手机暂缓而取消。

本次文档复核保留原 6/7/8/9/10+14/15 的最终决定，并纠正两类状态混淆：可信手势到达历史边缘即可触发有界补取，不要求被图表钳制的视口实际越界；各层实现和验收必须对应最新受影响源码。参考站四 Tab 的新截图/DOM 已取得，但全模块差分尚未完成。复核发现并修复的高精度/撮合缺陷单列在 ENGINE-03 下，不能仅写作缺少证据。每份结果只证明其对应的运行时源码和场景，不能将历史通过数直接扩大为当前全部 Gate。

较早门禁批次（风险平仓/entry 限制修复前）：根 600/600、Vela-PineTS 310/310、PineTS offline 1701 passed + 1 skipped；周期切换/手势/缺口 Retry、历史精度 8/8 等已列直接证据保持各自范围。修复版 Binance 两小时已取得终态，见 DATA-10/REL-01；当前风险和生产 UI 批次见下方。

STARTUP-01 测量纠正（2026-10-07）：旧 `startup-real-*` 探针仍使用 Playwright routing，禁用了 HTTP 缓存，撤回其热缓存结论。更正后不拦截真实请求，每 context 仅初始化一次；本机 Chromium + 显式代理、生产构建的冷 context 3/3 首绘为 `5500.2/2700.5/789.8ms`，无静态资源缓存命中；同一 context 的 prime 为 `847.3ms`，后续 warm 3/3 为 `673.7/225.2/241.9ms`，JS/CSS 均有 ResourceTiming 和 CDP 缓存命中证据。页面错误为 0；首绘时部分后台/补历史请求仍在途，不据此宣称完整 2,000 根或策略结果已完成。修正探针后受控 ABBA 4/4 通过；旧 12/12 仅保留为当时的受控性能结果。新证据在忽略目录 `audit-evidence/2026-10-07-startup-cache-corrected-{cold,warm,controlled}/`；少量首绘样本不证明稳定 p95 或其它网络环境。

STARTUP-01 完整阶段新证据：真实 Binance Spot BTCUSDT/15m、恢复内置 SMA 9/21，冷 3 页 + prime 1 页 + warm 3 页通过；每页完整历史 2,000 根连续、曲线 2,000 点、104 closed + 1 open，同 run/revision 且五项 KPI 和 Simulation 可见。冷/热中位数依次为首绘 787/311ms、完整历史 1230/848ms、账本 1296/927ms、Performance 1459/1084ms、Simulation 1545/1181ms；后两项包含自动点击与 UI 工作。warm 静态资源传输为 0，有 CDP 缓存证据；无行情/Worker 替换或 routing，页面错误 0。证据在 `audit-evidence/2026-10-07-startup-full-report/`，关闭完整阶段计时缺口，不能用六个样本声称稳定 p95。

STARTUP-01 渐进加载预算另经独立生产产物对照通过：冷/热各 10 轮 ABBA，四组各 20 次，共 80 次正式测量及 2 次预热；受控 HTTP 为每请求 300ms、200,000B/s。冷首绘 median/p95 从 1301/1618ms 降到 776/950ms，median 改善 40.33%；冷完整报告从 1468/1913ms 降到 1354/1766ms，热报告从 1402/1588ms 降到 1302/1509ms。页内暖路径最大 median 回退 1.23%，页面/Worker retained heap 最大 median 增加 0.50%，均满足原 10% 上限；每次两次行情请求，完整 OHLCV/交易/曲线/精度 SHA 相同。82 次流程页面/请求错误为 0，Worker/Canvas 销毁归零。证据 `audit-evidence/2026-10-07-startup-progressive-budget-final/` 的 142 项哈希通过；未剔除正式样本。

STARTUP-01 最后的资源预算也已独立通过：eager/lazy 隔离生产构建，空图与恢复 SMA 各变体 20 次、ABBA 共 80 页；真实 gzip HTTP，无 routing。空图首启 JS 849,138→475,075B（下降44.05%），SMA 950,361→784,053B（下降17.50%）。SMA 在完整历史/Worker账本/曲线及真实Dock Highcharts增强后采样；40份报告摘要一致。首次开编辑器、编辑/运行、销毁通过，开编辑器后两变体字节收敛（差0.14%），没有删除功能换收益。零页面/请求/非法外部错误；264项SHA通过，失败采样边界批次留存。证据 `audit-evidence/2026-10-07-startup-resource-budget-final-5/`。原≥15%预算与渐进预算分别关闭，上一段末句仅描述其当时边界，不继续作为待办；REL-06 本地生产两小时范围已另行关闭，跨设备/线上生命周期不在本地证据内。

前一完整门禁批次（跨订单、Margin call 审计、closeTime、Header/收藏/滚动、启动资源、Simulation 焦点和 Highcharts point 键盘桥接之后）记录根 **616/616**、Vela-PineTS **310/310**、PineTS offline **1773 passed + 1 skipped**、类型、重建及开发/生产主 E2E 通过。双引擎风险/entry **16/16**、跨订单/实时风险 **14/14**、归档重放 **496 字段零差异**及固定 SMA 的 280 行/2,520 字段/13 汇总保持各自证据范围。生产主入口 **32 状态 + 34 交互**、Simulation 非默认参数/焦点链也只证明当时源码。其后 624/624 仍早于最后的 sentinel 回归及当前 UI 修改；两组数字均不能称当前最终门禁。axe 的 SVG `incomplete` 不等于 VoiceOver/真机或全部无障碍通过。

状态含义：

- **已完成**：当前范围内已有实现，并有直接对应的自动化或真实浏览器证据。
- **部分完成**：核心路径可用，但仍有明确的视觉、边界、数据范围或外部环境缺口；行内区分已确认缺陷与缺少验收证据，二者不混为一谈。
- **待验收**：实现或交付步骤已有，但缺对应验证记录。
- **进行中**：已启动执行，但尚未得到终态结果；不得提前写成通过。
- **外部阻塞**：代码路径已有，但验收依赖当前环境无法提供的网络、设备或同源数据；不等同于已发现代码缺陷。
- **待讨论**：需求方向已记录，技术方案或产品口径尚未确定。
- **暂不做**：已明确移出当前阶段。
- **当前范围外**：不是本阶段的验收条件，未来扩展时再单独建立基准。

## 对话结论映射（保留原编号）

下表的原编号对应此前多轮讨论的未完成任务列表，不等于本文末尾的新执行排序。

| 原编号 / 决定 | 最终执行口径 | 对应需求 |
| --- | --- | --- |
| 6：数据源、代理和交易品种 | Spot 为现货，Futures 为合约，Hyperliquid 裸 `BTC` 为 USD 永续。保留 Spot 基准、Hyperliquid 恢复和可选 Futures；分别检查浏览器/进程代理、REST 和 WebSocket。Futures 451 不阻塞 Spot，不据一次失败认定接口整体写坏。 | DATA-01～03、DATA-08/10 |
| 7：参考站数值对账 | 只验收 `BTCUSDT · 15m · SMA`，相同时间区间或根数；同时固定结束 K 线、实际 OHLC、源码、参数和未收盘 K 线处理，避免同根数不同数据。其它品种/策略/窗口不自动追加为阻塞。 | ENGINE-04/06 |
| 8：复杂撮合与精度 | 依照原 TODO 和 TradingView 调研实现并逐项验收，具体范围见本表“复杂撮合细项”。默认父周期 OHLC，Properties 开关启用低周期高精度。完整 TV 外部逐 Fill 对账不作为当前条件，但不能据此省略重算配置、费用/风险及复合订单边界。 | ENGINE-01～03、SCOPE-05 |
| 9：长时行情和断网恢复 | Hyperliquid 可承担真实恢复验证；Binance Spot 保留可访问环境下的回归。分别记录已通过的 Hyperliquid、Binance 两小时传输/恢复结果、已修复的 teardown 门禁竞态；持续跨网络边界仍单独验收。 | REL-01/06 |
| 10 + 14：合并 UI 对标 | 只对照 Backtest Workspace 及全部内部模块：Dock/Header、Viewer、Performance、Trades Analysis、Trades Log/Calendar、Simulation、Settings、图表联动及弹窗/状态。第四个 Tab 是 Simulation，Calendar 是 Trades Log 内的视图。功能、交互、图标、组件风格一致；整体布局适配本项目，不复制 AI 侧栏/登录 banner 或占位，不要求全页逐像素重合。 | UI-01～10、ENGINE-05 |
| 15：当前不做 | 保留暂不做决定；现有材料未恢复原第 15 项题名，不执行该编号，也不猜成 VoiceOver/真机等项目的取消依据。 | SCOPE-06 |
| 新增：K 线缺失 + 任意周期切换 | 合并为一个 P1；普通切换最新 2,000 根并重置视口，用户主动深历史才继续分页。整页失败、小缺口、任意周期、缓存和回测完整性一并验收。 | DATA-04～09/11 |
| Safari / 线上环境 / Replay | 仅 Safari 专项明确暂不考虑；缺目标环境时先忽略线上部署/CDN/rollback；Replay 暂不做。不能扩大为取消桌面 VoiceOver；手机实机另按 SCOPE-07 暂缓。 | SCOPE-01～03、UI-10 |
| 最新：手机端适配暂缓 | 手机布局、横竖屏、safe-area、手机触摸与手机实机专项先不做，不作为当前关闭条件。已有修复和证据保留；桌面功能、缩放、键盘、VoiceOver 和通用计算正确性继续维护。 | SCOPE-07、UI-08/10 |
| 自建脚本持久化 | 现有本地存储继续维护；长期持久化只记“待讨论”，不展开方案、不升级为本期 P1 实施或发布阻塞。 | BASE-05、SCOPE-04 |
| 既有功能和仓库 | 不破坏 master 原有功能；远程只留可构建代码、必要测试和当前文档，审计附件留本地。许可证不作为当前本地自用阶段阻塞。 | BASE、BUILD、REL-04/05 |

对话中的“按照建议推进”授权继续完成上述范围，不代表相关项目已经验收，也不代表取消原来的关闭条件。三个容易混淆的合同保持如下：

- **数值对账**：同根数还须同结束 K 线、同 OHLC 和同策略配置。本地日常默认 2,000 根与参考窗口 5,000 根是两个用途；不为对账而更改日常默认深度，也不拿 Hyperliquid 永续价格代替 Binance Spot。
- **精度**：默认普通 OHLC；用户可选高精度低周期 OHLC。缺少或不完整的子周期必须明确 fallback/失败，不能把“已打开开关”当作“实际高精度”。复杂撮合仍按 TODO/TV 调研维护，免去外部 TV 对账不等于免去实现和独立测试。
- **2,000 根**：加载条数、重置后的时间窗口、屏幕实际可见条数分别验收。任意普通周期切换都适用，不能只修 1m/5m；窄屏也框定完整窗口，不表示 2,000 根在少于 2,000 个像素中都能逐根辨识，可继续缩放查看。

普通切换时宿主自动携带的旧 `bars` 不代表用户主动请求深历史，不能借此继承旧深度。父周期行情缺口未解决时不得发布完整报告或开放 Simulation；只有父周期完整、单独高精度子周期不可用时，才允许明确回退到默认 OHLC，并展示原因。这两类状态不能共用模糊的 fallback 结论。

新页面的明确合同是默认加载 2,000 根；“视口定位到这 2,000 根”针对普通周期切换。冷启动/恢复的原生初始视口单独记录，不自动增加“清除保存的视口、所有入口都强制展示 2,000”的新要求。窄屏切换仍须满足已确认的切换目标。

用户在切换后主动缩放、拖动或定位交易，后续 resize 保留其视口，不再强制 ALL。程序性的初始 fit、ALL 和 resize 不自动补历史；用户在历史边缘主动继续向过去拖动、横向滚动或缩小时，按 DATA-05 有界补取。Vela 会钳制可见范围，不能把“视口数学上越出已有数据”当作唯一触发条件。共享缓存可以保留更早数据，“显示最新 2,000 根”不要求清空其它周期或 Cell 的缓存。

## 一、数据源与 K 线加载

| 编号 | 优先级 | 需求 | 当前结论 | 验收口径 / 剩余工作 |
| --- | --- | --- | --- | --- |
| DATA-01 | P0 | Binance Spot `BTCUSDT` 作为回测基准 | 已完成（固定输入窗口） | 数值证据见 ENGINE-04。在线访问可使用 Binance 全球或 Binance.US Spot 端点，但两者是不同交易场所，不能视作 OHLC 天然相同的镜像；每次对账记录实际来源和行情 SHA。连接可用不等于同数据对账通过。 |
| DATA-02 | P1 | Hyperliquid `BTC` 数据接入 | 已完成（用途受限） | `BTC` 是 USD 永续，用于 Provider、实时订阅和恢复验证，不替代 Binance Spot 对账。 |
| DATA-03 | P2 | Binance Futures 数据接入 | 已完成（可选路由） | Futures 路由和 Provider 合同保留，并已做受控历史/live 验证；部分网络环境会返回 HTTP 451，这是访问环境限制。它不是当前 Spot 回测验收阻塞项。 |
| DATA-04 | P1 | 新页面和普通周期切换默认加载最新 2,000 根 | 已完成（列明的切换与视口合同） | 无显式深度偏好时默认 2,000，旧默认自动迁移，无须用户清缓存。最新真实 Vela + 受控 Provider：Chromium 51/51、Firefox 50/50；顶部/键盘/移动入口、双向/快速切换、日周月、多 Cell 与窄屏均通过。655 px Cell、326 px 手机和 resize 实际加载/可见均为 2,000；已加载窗口内的滚轮、拖动、日期定位通过，越界补历史单列 DATA-05。显式 Vela 0.7.7 视口补丁见 BASE-03。冷启动/恢复保留原视口；保存的深度只用于恢复，下一次普通切换仍重置 2,000。主动范围/深度和 inline 数据例外，不足 2,000 只显示实际数据。 |
| DATA-05 | P1 | 用户主动请求更深历史仍可分页 | 已完成（当前本地范围） | 原生鼠标拖动、横向滚轮和缩小到历史边缘，每次操作连续段追加最多 2,000 根，无重复并发/递归补取；实际请求和 rawBars 验证通过。Chromium、Firefox 各两引擎 26/26，覆盖持续缺口、实际 Viewer Retry 后再补至 6,000 根、旧请求/连切、多 Cell、genesis、销毁、绘图和价格轴误触。显式 12,500 深度/4,000 范围仍可用。inline EMPTY 不被误判在线；补历史后普通切换仍回到最新 2,000。当前生产 E2E、本地完整门禁和真机之外的 touch 模拟已通过；真实长时网络仍归 DATA-10/REL-01。 |
| DATA-06 | P1 | 分页失败不能形成大空洞 | 已完成（受控真实缓存路径） | guarded Provider 保留最终异常，不再被 Vela safeBars 吞成成功空页；失败不提交错误覆盖。真实 MultiProviderFeed/BarStore 验证实际复取、跨页接缝、旧断裂缓存失效及其它 series 保留。缓存与原专项 13/13；不代替真实交易所长时故障验收。 |
| DATA-07 | P1 | 页内/页边界缺口识别、补取和残留提示 | 已完成（检测、补取与明确拒绝合同） | 每次最多补 8 段、每段最多 1,000 根；超预算或仍缺失明确报错，不生成假 K 线。Vela 空最新页不再把旧缓存 island 当作当前窗口完整，watermark会清除并保留后续补取机会；history-resilience定向6/6通过。Binance 月线使用 UTC 日历月，Hyperliquid 原生 1M 使用 epoch 对齐的固定 30 天，缓存和分页沿用实际 Provider 的规则。真实两数据源1m/5m/2h/4h/D/W、最近月线复验通过；Hyperliquid全历史月线在2021-07-02有真实缺根，直接公共接口也返回空数组，正确拒绝完整性认证。上市前/尾部不外推；自定义Session Provider不套用24/7合同。 |
| DATA-08 | P1 | Provider 错误可见且可恢复 | 已完成（列明的受控故障） | 503/429/超时/非法 JSON/无进度响应、Retry 与市场代次隔离已有证据；prefix/older/junction 双引擎 6/6：故障期不能 ready/Simulation，history.complete=false，Try again 恢复 2,000 根与 20 笔账本。最新高精度六场景 × 两引擎 12/12 也通过；真实跨网络持续故障归 REL-01，不能由受控故障代替。 |
| DATA-09 | P1 | Hyperliquid 月线负时间戳 | 已完成（请求边界及真实返回） | 负 epoch 起点钳制为 `0`，避免该原因造成的 422；最近 24 根真实月线连续。更早源数据缺根按 DATA-07 报错，不等于请求修复失败，也不能把 2,000 当作交易所必有的月线数量。 |
| DATA-10 | P2 | 数据源职责与网络可用性 | 已完成（列明的本机与代表代理合同） | Binance Spot、Hyperliquid REST 及各两小时真实恢复通过；修复版 Binance 7,200.111 秒、23 次恢复、3,458 callbacks、29/29 sockets 平衡，终态哈希通过。新增真实 Hyperliquid CONNECT 代理静默验证，两引擎均持续扣留加密数据约 45 秒，navigator 始终 online；watchdog 至少两次换连，允许初始 3 秒在途数据排空，随后稳定期账本/revision 不推进，放行后分别 2.57/2.57 秒恢复新 socket candle。16/16 隧道关闭，页面错误、迟到回调为 0。故障为明确的传输注入，不伪称自然交易所故障。不证明所有地区/代理可用，Futures 451 单独记录；REL-06 的本地生产两小时范围另有独立证据，线上/跨设备生命周期不在本地证据内。 |
| DATA-11 | P1 | K 线缺失合并验收（DATA-04～09） | 已完成（已冻结的本期验收范围） | 任意周期最新 2,000 及窄屏视口、主动分页、缓存/接缝、双引擎缺口门控/Retry、高精度不足与实际行情绘制均通过。REL-01 已补持续静默代理恢复，结合两数据源两小时证据，关闭已列代表网络子项。源数据缺根时明确拒绝、不伪造 K 线；不据此宣称所有网络或所有 ENGINE-03 组合通过。后续影响此合同的改动须按 BUILD-01 回归；新发现的具体历史完整性缺陷另开，不重新泛化为无限观测。 |

### P1 K 线缺失的关闭标准

| 场景 | 需要证明的行为 | 当前证据边界 |
| --- | --- | --- |
| 任意普通周期切换 | 1h→1m/5m、低→高、日周月、快速连切、多 Cell、顶部/快捷入口统一重置到最新 2,000 根及新视口，旧请求不回写，不因旧跨度自动请求十几万根。 | Chromium 51/51、Firefox 50/50；真实 Vela、受控行情，宽屏/窄屏切换完整窗口和 resize 均通过。新 Vela 补丁受版本及完整 SHA 校验，升级时须重新验证。 |
| 2,000 与例外 | 无缓存初开、旧状态迁移、明确深度偏好、实际不足 2,000、inline 数据分别符合合同；主动拖动/缩小/范围/深度请求仍可加载更多。 | 已实测旧 500 自动迁移、6,000 偏好恢复后切换重置、37/500/80 根实际历史、12,500 深度和 4,000 显式范围；实际 pointer/wheel 补历史已通过双浏览器/双引擎专项。在线 Retry 使用明确、按 Cell 隔离的重载标记，普通 inline EMPTY 仍保持离线合同，不根据空数组猜测来源。冷启动/恢复约 201 根初始视口与加载量分开记录。 |
| 大空洞与缓存恢复 | 深窗口中间页失败同游标重试，持续失败不跳页/误报覆盖；恢复后确实重新请求并补齐缺失范围。 | 真实缓存类 13/13，包含旧缓存失效、恢复后实际复取及再次命中；浏览器 Try again 双引擎补齐。均为受控行情/故障，不冒充当前交易所在线证据。 |
| 小缺口与周期边界 | 页内/分页接缝、超过补取预算、2h/4h 和各交易所原生月线有明确处理；真实无数据与请求失败可区分。 | 真实 REST 共 16 个场景：15 个完整数据窗口，1 个 Hyperliquid 历史月线真实缺口被正确拒绝。新渲染探针在销毁前验收：Binance 1m/5m/2h 各 2,000 raw/visible，月线实际 111 根全部可见；四张截图、OHLC、连续性和 Canvas 绘制通过。35 次公共行情响应均 HTTP 200，无页面错误。旧销毁后截图不再用于此结论。 |
| 回测与性能 | 父周期缺口使两种引擎保持 partial/error；仅子周期不足可明确回退精度。无伪造 K 线、无限补取、重复订阅。 | 缺口/Viewer Retry 6/6、高精度 12/12 通过；独立成交预期：4 笔，默认 +20、高精度 -20。尾部缺根缓存已修复，恢复后重开高精度会重新取数；迟到旧请求不会删除新成功缓存。最新生产 E2E 通过；双引擎及代表网络合同已由 DATA-11/REL-01 关闭，REL-06 本地生产长测亦已通过，跨设备/线上生命周期不在本地证据内。 |

## 二、回测引擎与结果

| 编号 | 优先级 | 需求 | 当前结论 | 验收口径 / 剩余工作 |
| --- | --- | --- | --- | --- |
| ENGINE-01 | P0 | 默认回测精度 | 已完成 | 默认使用 `chart-ohlc`，按父周期 OHLC/OLHC 路径计算。 |
| ENGINE-02 | P1 | 高精度模式开关 | 已完成（本期历史精度合同） | Settings → Properties → Backtest precision 提供 `Default precision` / `High precision`；通过 `use_bar_magnifier` 启用低周期 OHLC 回放，不是 tick/盘口。forming 子 K 的 `asOf` 截止、历史上限、覆盖率和未来边界已由双真实引擎浏览器 8/8 验证，含可见 fallback 及独立成交预期；组合证据见已关闭的 ENGINE-03，后续按BUILD-01非回归。1m→10s、5m→30s 因现有 Provider 缺秒级历史会明确回退；live 请求当前返回 `live-mode-not-supported`，不能声称所有周期/实时状态均应用高精度。15m→2m、1h→10m 等按已实现映射取数。参考视觉归 UI-08。 |
| ENGINE-03 | P1 | 复杂撮合及原 TODO 的完整语义范围 | 已完成（下方列明的本期有限合同） | 基础订单、重算生效时点、OCA 路径顺序、收盘成交和 forming/覆盖率已有独立预期；Worker 协议组合及实际双引擎历史精度 8/8、风险/entry 16/16 均有证据。剩余三项已补齐：跨订单价格路径 12/12、形成中风险回滚 2/2 浏览器，以及完整归档离线重放 496 字段零差异。Margin call 审计和 live closeTime 的新缺陷也已修复并加入永久回归。固定 SMA 最新重算零差异；不宣称全部订单排列、交易所流动性 partial fill 或完整 TV 外部逐 Fill 对账。后续实际缺陷单独登记，不以无边界的“所有组合”反复重开本项。 |
| ENGINE-04 | P1 | BTCUSDT/15m/SMA 参考数值 | 已完成（2026-10-07 当前引擎独立复跑） | SMA 9/21，同一份 5,000 根参考 OHLC、源码/参数；当前引擎 fresh replay 仍为 **279 closed + 1 open = 280 行**，共 2,520 个字段、13 项汇总和 Simulation 输入通过，证据在忽略目录 `audit-evidence/2026-10-07-reference-parity-rerun/`。不是旧窗口的 280 closed + 1 open，也不是本地在线 2,000 根与参考 5,000 根天然一致。open 人口/展示差异归 UI，不能抹平为页面一比一。 |
| ENGINE-05 | P1 | Simulation | 已完成（本地范围） | 结果确定性、取消、Worker 隔离、不同视图和报告 revision 更新已覆盖；最新非默认 Shuffle/Resample 参数链在参考站、本地 PineEngine 与 PineWorkerEngine 中分别完成 3,954/21,954 字段对账，variation=0 正确隐藏 Outcome Distribution，Drawdown/Histogram/Cumulative、tooltip、backdrop close 和 variation→Tab→Escape 焦点路径通过。全模块组件/交互对照及真实辅助技术仍按 UI-08/UI-10 维护；运行期性能与生命周期分别见 PERF-01/REL-06。 |
| ENGINE-06 | P2 | 其它策略、行情和时间窗口的 golden（含历史 1h fixture） | 当前范围外 | 本阶段只冻结并验收 Binance Spot `BTCUSDT/15m/SMA`；Parity Matrix 中较早的 `BTCUSDT/1h` fixture 仅作历史回归记录，不是当前验收阻塞。其它组合未来扩展时再提供固定行情和脚本。 |

固定窗口证据在本地忽略目录 `audit-evidence/p1-final-gates-20261006/reference/` 的 `comparison.json`、`reference-golden.json`、`local-golden.json`。行情 SHA-256 为 `f943f2f6ce2c857c0259a9454fca87b2444bd4e8d4fe1d8c1b766c2d35b45bae`，源码 SHA-256 为 `369edd6df53042c9341a6f904ee22e33d26133cb97bc7d5378f312b9b267050e`；[逐笔比较器](../../../tests/reference_golden_compare.py) 可重比已有输入，不等于重新登录参考站或采集行情。

ENGINE-04 的需求验收记录保持有效；之后修改撮合源码时，仍须将同一份已冻结输入交给重新构建的本地引擎生成新结果，再与参考结果比较，作为 BUILD-01 的非回归。仅重新比较两份旧 JSON 不能证明新引擎无退化，也不需要为此增加其它策略、品种或时间窗口。

### 复杂撮合细项（原第 8 项，不另立一套范围）

以下保留 [TODO 的高精度历史回测范围](../../../TODO.md#pinets-高精度历史回测tradingview-bar-detalization-对标) 与计划 §8.3/8.5/G8 的映射。各项由独立经济预期、桥接/浏览器和下方三项有限验收共同覆盖。源码路径只是验证入口，具体通过时点以直接证据为准；不额外要求任意组合的穷举证明。

| 语义 | 已有实现 / 验证入口 | 当前边界与关闭条件 |
| --- | --- | --- |
| 市价、限价、止损/止盈、stop-limit、移动止损、跳空与同 K 路径 | `order.test.ts`、`stop-limit.test.ts`、`trailing-parity.test.ts`、`bar-magnifier*.test.ts`、`cross-order-path.test.ts` | 默认/高精度路径已有独立预期；新增非 OCA 近/远 stop 与退出/入场先后在真实双引擎 12/12 通过。不宣称所有移动止损跨单排列穷举通过。 |
| 净持仓、FIFO/ANY、部分平仓、pyramiding、reversal、OCA | `close-entries-rule.test.ts`、`pyramiding-reversal.test.ts`、`oca.test.ts`、`order-ledger.test.ts` | 账本、关系和 Worker 组合已验，实际双引擎风险/部分 margin 及跨订单验证补齐有限集成。维持净持仓，不新增多空同时持仓 Hedge Mode。 |
| 手续费、滑点、最小变动单位、margin | `commission-order.test.ts`、`close-entries-accounting-boundary.test.ts`、`margin-call.test.ts`、`margin-audit.test.ts` 及订单/精度测试 | 多 lot 手续费、三类费用、双向滑点、部分 margin、反转与风险平仓已有独立算术及浏览器证据。新增 Margin call 的 order/fill/parent 关系审计；7 个回归通过，完整归档重放验证费用、数量、关系和曲线。 |
| `process_orders_on_close`、`backtest_fill_limits_assumption` | `process-orders-on-close.test.ts`、`limit-verification.test.ts`、`recalculation-causality-boundary.test.ts` | 收盘下单不得使用已经过去的 OHLC，重算创建订单按生效位置撮合；定向独立预期及 Worker 组合通过，作为持续回归保留。 |
| `calc_on_order_fills`、`calc_on_every_tick` | `calc-on-recalculation.test.ts`、`streaming-rollback.test.ts`、`risk-forming-rollback.test.ts` | 模拟价格点、生效时序和形成中风险回滚已验：默认 live 两种真实引擎 2/2，更新同根后再追加一根与静态账本/audit/曲线一致。历史模拟点不称为真实交易所 ticks；高精度 live 仍显式回退。 |
| 日内/连续亏损风控、方向/仓位限制与交易所日期 | `risk-intraday.test.ts`、`risk-liquidation.test.ts`、`risk-entry-controls.test.ts` | 新增 27 项平仓与 26 项 entry 限制独立预期：日内亏损/成交上限、最大回撤、连续亏损均正确撤单/平仓；费用、部分 margin、反转和重算不重复扣量或生成虚假成交。仓位上限对 entry 缩量、禁止方向 entry 只平仓；两项 entry 规则不限制 strategy.order，账户级熔断仍有效。默认及实际 applied 的低周期均验；交易所日切换及春/秋 DST 已有独立预期；BTC UTC 范围不新增其它交易所日历或无界异常时区矩阵。 |
| order/fill、parent/reversal、账本与曲线身份 | PineTS `ledger.ts`、Vela-PineTS `contextSnapshot.ts`、Adapter；`raw-ledger-boundary.test.ts` | 带身份的 audit DTO、联合 context、旧 revision 拒绝已有验证；本轮 Margin call 因果顺序和 live 曲线 closeTime 补齐，归档重放核对结果。不增加参考站没有的 raw 展示面板。 |
| 低周期数据、历史上限与精度展示 | runtime/Worker parity、高精度缺口 12/12、Settings | forming 子 K 的请求前 `asOf`、Hyperliquid 最近约 5,000 根子 K 上限、833/2,000 覆盖率、未来边界和 no-lookahead 已由 PineTS/Vela 定向测试覆盖；两种真实浏览器引擎 forming/closed/history-cap/inclusive-future 共 8/8 已验。风险/跨订单浏览器另验 applied 精度与独立预期；生产主 E2E 只证明集成 smoke，不冒充所有组合。秒级/live 不可用明确回退，不插值、不默认高精度。 |
| provenance 与可复现输入 | context/report envelope、Fork fingerprint；`tests/replay_engine_archive.mjs`；原 TODO 第五阶段 | 新归档捕获真实 execute 请求的 presence/undefined/value、源码、参数、market/syminfo、父/子 OHLC、asOf、mode/historyState、引擎指纹及结果；两份有限场景 496 字段离线重放零差异，导出有限输入包也可独立重放。旧缺少 Margin call audit 的归档保留 80 字段差异，不改旧证据。原始数据只留本地，不新增用户导出按钮。 |

前六行测试路径基于 `packages/pinets/tests/namespaces/strategy/`，桥接测试基于 `packages/vela-pinets/test/`。真实逐笔成交/订单簿、流动性排队和市场冲击模拟不在原 TODO 首期范围；它们不能与本期必须覆盖的部分平仓/多腿成交混淆。外部 TV 对账按 SCOPE-05 处理。

### ENGINE-03 本轮确认的问题与验收依赖

以下是原第 8 项内的实施细项，不另增一套需求编号。列出的源码修复已落地；定向通过仍不能代替重建后的 Worker/浏览器和最终生产回归验收。

| 问题 / 边界 | 当前依据与进展 | 关闭条件 |
| --- | --- | --- |
| 高精度重算后新订单可能回溯成交，或不能在同父 K 的后续价格点成交 | 独立 OHLC 路径已复现；订单生效序号和撮合/重算顺序已有修复 | 已列缺陷关闭：止盈、跟进开仓和市价平仓不得读取下单前路径，Worker 组合及后续跨订单浏览器证据共同覆盖。 |
| OCA 按声明顺序而非价格路径选择获胜订单 | 简单 entry 及混合 stop-limit OCA 的远/近价反例已有修复；同价保留声明顺序 | 已列缺陷关闭：默认/高精度路径、取消关系与 Worker 组合通过。非 OCA 另见下方有限验收，不无限追加排列。 |
| 日内亏损未按当日权益峰值计算；收盘新单使用过去 OHLC | 独立 cash/percent 风控、收盘单反例及风险触发后取消挂单已有修复和定向测试；组合 parity 覆盖费用/持仓/重算与 reversal | 已列缺陷关闭：下两行 16/16 实际浏览器及新增实时回滚验证已覆盖对应路径。 |
| 风控仅熔断而未平仓，或与 margin/反转/部分退出嵌套产生重复成交 | 已修复风险撤单/市场平仓、费用/滑点、跨日与永久熔断；新增 27 项独立预期通过。重建后双真实引擎 × 默认/高精度 × 日内亏损/margin 组合 8/8 通过，账本、Viewer、100% 子周期覆盖和清理均验证 | 此已列缺陷关闭。独立经济预期为净利/权益 -22/978 与 -320/280；margin 分拆 48/7 + 22/7。不将这些场景扩大为全部 ENGINE-03 关闭。 |
| max_position_size 整单拒绝、allow_entry_in 拦截应有平仓、entry-only 规则误伤 strategy.order | 新探针复现：上限 2 下请求 3 实际仓位错误为 0；禁止 short 后已有 long 2 不能平仓。已修复缩量、只平仓、规则归属及同 K 多订单投影；26 个独立算术用例修前 24 fail/2 pass、修后全通过 | 已列源码和单元缺陷关闭；重建后 entry 两场景 × 双引擎 × 默认/高精度新增 8/8，与原风险场景合计 16/16 浏览器通过；其它撮合组合仍按 ENGINE-03 验证。 |
| 未收盘子 K 被显示为已应用高精度；有限子历史覆盖率误报 | 独立 bridge 探针已覆盖 forming 子 K、未来边界和最近 5,000 根子 K 对 2,000 根父 K 的 833/2,000 覆盖率；真实 Hyperliquid `BTC` 4h→30m 请求验证约 5,000 根上限，可触发 partial fallback | 该边界已由 `tests/e2e_precision_history.py` 双真实引擎浏览器 8/8 关闭：请求时点、收盘判断、833/2,000 覆盖率、可见原因及独立成交预期一致；不扩大为生产复杂组合全部完成。 |
| Margin call 已平仓但审计缺 order/fill 及父订单关系 | 新增 7 个独立回归，修复前 6 个失败；正常、低周期、延迟强平皆补齐真实数量、时间和关系，嵌套风险在 margin audit 发布后处理 | 已关闭：重建后 16/16 风险浏览器通过；完整归档 margin+risk 的 305 字段重放通过。旧归档 80 个 audit 差异仍保留为真实历史，不放宽比较器。 |
| 实时追加/更新未提供 closeTime 导致曲线与静态回放不同 | 实际双引擎风险回滚探针发现；实时路径统一使用显式 closeTime 或 openTime + 周期时长，与初始加载一致 | 已关闭：显式/省略 closeTime 的永久回归通过；两引擎形成中更新、下一根固化后完整曲线/账本/audit 与静态结果一致。 |
| 复杂组合的集成与复现覆盖 | 对应引擎批次根 616/616、桥接 310/310、引擎 offline 1773 + 1 skipped、类型、开发/生产主 E2E 通过；风险 × 双引擎 × 两精度 16/16、跨订单/实时风险 14/14、归档重放 496 字段通过 | 本期有限集成关闭，证据见下表。此后应用层修改由新门禁覆盖；实际网络失败单独记录，不宣称所有排列或所有网络均通过。 |

独立复现说明在本地忽略目录 `audit-evidence/2026-10-07-engine-boundaries/`；永久回归入口包括 `recalculation-causality-boundary.test.ts`、`risk-fee-combinations.test.ts` 和 `packages/vela-pinets/test/bar-magnifier-history-boundaries.test.ts`。尚未完成的修复不标为已关闭。

最终三项有限验收如下，现已按本期合同关闭 ENGINE-03；不保留无边界的“所有组合待验”。新发现的实际缺陷仍须单独登记与修复。

| 有限验收项 | 当前判断 | 明确通过条件 |
| --- | --- | --- |
| 非 OCA 跨订单价格段顺序 | 已修复远 stop110 抢先 near105、TP105 未释放后到 entry110 额度；10 个引擎回归通过，实际浏览器 3 场景 × 双引擎 × 两精度 12/12 | 独立预期：near stop 净利/权益 -1/10006；TP105→entry110 为 2/10004；entry105→TP110 保持拒绝后到退出提前释放额度，为 8/10008。数量、费用和关系已验；同价保留已有 entry-first 规则。 |
| 实时风险状态回滚 | 已通过双真实引擎 2/2；本轮另修 live closeTime 遗漏 | forming close90 产生风险平仓 -22/978；同根改105后恢复仓位2、净利-1/权益1009。下一根固化后与静态已收盘输入的交易/audit/完整曲线一致；高精度 live 仍显式 fallback。 |
| 归档输入离线重放 | 已通过 margin+risk 305 + position-cap 191 = 496 字段；有限导出包独立进程再放同样零差异；最新 closeTime 产物再次重放通过 | 真 execute 元数据、参数、源码、父/子 OHLC、asOf/market/syminfo、引擎指纹与结果一并归档，离线禁止网络。对比成交、费用、审计关系、完整曲线及精度，runId 只用于归属不要求字面相同。不新增产品导出入口。 |

## 三、回测工作区功能模块

### UI 对标评价标准

| 检查对象 | 通过条件 |
| --- | --- |
| 功能与交互 | 工作区内模块、入口、字段、状态流转、操作结果及图表联动按已冻结合同对标。loading / partial / error / retry / busy 等异常与边界状态同样检查，不能只验默认截图。 |
| 组件与视觉 | 图标形状、字体层级、颜色、按钮/字段/卡片/图表风格及组件内的排列关系对标参考。核对图轴、legend、hover/tooltip、焦点与选中状态；已记录的数据正确性和可访问性修正保留，不复制参考缺陷。 |
| 本项目布局适配 | 使用本项目真实工作区的可用宽高；Dock、Viewer、表格、图表和弹窗合理伸展、换行、分列或滚动，保持信息层级和操作顺序。不得为空缺的 AI 侧栏或登录 banner 留白，不按参考宿主的整页宽度硬套断点。 |
| 不单独判为失败的差异 | 由宿主空间造成的绝对位置、容器宽高、列宽与换行差异，以及字体栅格化、合理的亚像素取整差异。须能解释其来源，不借“适配”掩盖组件风格或功能变化。 |
| 仍须修复的问题 | 遮挡、裁切、不可读的跨格重叠、页面非预期滚动、按钮/数值不可达、图标错误、交互缺失、状态或计算错误。窄屏截断时应有点击/键盘可达的完整信息，不能仅依赖 hover。 |
| 验证与证据 | 在相同数据/状态下实操，并记录两站各自有效工作区尺寸；可隔离同宽组件核对样式。截图、DOM 和局部几何差分用于定位问题，不再以整页像素差百分比或所有边界 ≤1px 判定。当前本地截图基线继续用于非回归；改标准不等于自动刷新基线或将 PARTIAL 改成 PASS。 |

以下 UI-01～10 及后文的“参考差分/视觉对账”均按此标准执行。历史截图、数值及当时结论保留追溯，参考站 AI/登录等宿主区域不进入本期验收。

本阶段以桌面为实施及验收范围；下表已取得的手机结果仍是有效历史证据，未完成的手机适配和手机触摸验收统一转入 SCOPE-07，不能继续列作 UI-08/UI-10 的本期阻塞。桌面紧凑窗口与浏览器缩放仍属于桌面可用性，不能一并取消。

| 编号 | 优先级 | 需求 | 当前结论 | 验收口径 / 剩余工作 |
| --- | --- | --- | --- | --- |
| UI-01 | P0 | Dock/Header/Viewer 生命周期 | 已完成（本地功能合同） | 无策略空态、策略加入、Viewer 返回、Settings、报告移除/销毁已有回归。本轮真实生产35/35两次、状态边界23/23，修复星标不刷新、重开继承scroll、同Tab重点击回0及临时加载丢scroll；双Cell/刷新/销毁后微任务同步通过。生产两小时资源与卸载清理已在 REL-06 的冻结构建范围通过；完整参考语义/视觉归UI-08。 |
| UI-02 | P1 | Performance | 已完成（列明的桌面组件及展示合同） | 当日原生组件与本地真实 Workbench 使用相同 13 类输入：空/仅 open/单赢亏/全平/全赢亏/混合/极值/跨 DST/日周月，共同检查 1,014/1,014 通过，其中 Performance 693 个表格单元。六图共 276 点、145 次实际命中 hover、图轴/图例/零线及上下表均留证；修复 tooltip 日期/币种/背景、空方向、行高与空交易伪零周图。此前 Benchmark 三浏览器对照保持有效。保留下方实际本金/风险/MTM 和 UTC 等明确差异，方向 CAGR 不填假值；Summary/Dock 曲线另由 A-CURVE 两浏览器各88项补齐键盘逐点访问；VoiceOver 仍归 UI-10。证据 `audit-evidence/2026-10-07-performance-analysis-closure/`，不冒称新的引擎 golden 或全部辅助技术通过。 |
| UI-03 | P1 | Trades Analysis | 已完成（列明的桌面组件及展示合同） | 与 UI-02 共用 13 类输入的真实参考原生组件对照，Analysis 902 个表格单元及三图点/轴/参考线/hover 一致，含 open 投影、真实平手、稀疏日期、日周月与极值；修复 tooltip 白底白字、隐藏分类键盘入口、空方向和表格样式。Chromium/Firefox 的真实 hover、Home/End、legend hide/show 及 Chart/Observer 清理有永久回归；此前双真实引擎 57/57 字段结果保留。证据 `audit-evidence/2026-10-07-performance-analysis-closure/`；共享 loading/error/retry 由 UI-01/08 验证，VoiceOver 独立保留 UI-10，不重复要求已关闭的原始 golden。 |
| UI-04 | P1 | Trades Log | 已完成（列明的列表与桌面定位合同） | 同 DTO 24 状态及 18 组/2,610 断言已验列表、501 行遍历、排序、200 行分页、焦点/tabpanel/ARIA、行高及卸载；修复排序/分页焦点和币种行高。新增实际 Entry/Exit 定位在 Chromium/Firefox 各 37/37：当前周期 ±60 根、蓝色原生 label、精确十字线、4 秒清理，open 仅 Entry；旧市场/报告、Cell 切换和销毁清理，不污染收藏/指标库/模板/持久化/Undo。定位失败可见并可恢复。证据 `audit-evidence/2026-10-07-trade-location/`。保留负零/Open 修正及随本地分页变化的列宽，不复制参考 epoch；手机/Safari 专项暂缓，UI DTO 不冒充引擎 golden。 |
| UI-05 | P1 | Trades Log 内 Calendar | 已完成（列明的导航、日值与可读性合同） | 最新同参考 DTO 的当前/前月/空月、hover 及两 DPR 共 24 状态对照已完成；独立 18 组/2,610 断言联合验证月份/列表状态、真实 pointer/键盘/touch、tooltip Escape、销毁和源码稳定。七列内金额可读缩写、单位可换行；实际日期按钮显示未缩写金额/币种/笔数/胜率并可关闭回焦点。11 种金额边界含正负小数、±1e-9、百万附近值，保留非零和符号，原数据不变；手机及 280px 桌面嵌入容器无跨格重叠。保留本项目响应式适配，不复制参考手机溢出；不据此关闭全工作区、所有 locale 或真实设备。 |
| UI-06 | P1 | Settings | 已完成（本期桌面控件与提交合同） | 当前桥接的12类Inputs及31个可变Properties具备控件；Chromium/Firefox×两真实引擎4/4实际计算验证typed提交与一次Apply，数字options/time/timeframe override已修。纯净参考context取证后修正26px色块、双路径勾号、跨组共享标签列及textarea padding；日期/时间/菜单/提示/图标已核对。两浏览器桌面焦点、拖拽、数字、下拉、Reset/Apply/失败恢复/destroy通过，R-09不重开。证据 `audit-evidence/2026-10-07-settings-schema-completion/`。保留draft-only Reset、31属性、volume、原始epoch/day-mask及a11y增强；全部撮合组合归ENGINE-03，不把无限脚本排列加为Settings阻塞。 |
| UI-07 | P1 | 图表联动 | 已完成（既有路径） | 返回图表、交易定位、Viewer 覆盖与挂载关系已有回归；新增任意周期切换已由 DATA-11 联合验收。后续改变切换、定位或视口时继续非回归。 |
| UI-08 | P2 | 全模块功能、交互与组件视觉对标及本项目布局适配（原 10+14） | 部分完成（列明桌面合同及三项后续对齐已验） | 原Dock393/393、桌面632、曲线键盘176及strict visual保留时点；后续H-09共享滚动196项、S-11挂载生命周期216项、D-10实际小值轴28标签通过。仍明确保留统一指标收藏与账户保存回测、Settings草稿Apply与参考即时提交的差异；本地正确指标、Dock偏好、可访问性和显式错误恢复不冒称参考字面一致。**其中“账户保存回测”依赖参考站账户/云服务，而本项目当前是独立本地自用版本；“参考即时提交”是参考站字段事务语义，本地已冻结为可回滚的一次性草稿 Apply 合同。这两项是已接受的范围边界差异，不是本地缺陷或未接线入口。** 手机暂缓；不复制AI/banner/整页坐标，不重复打开已关闭三项。 |
| UI-09 | P2 | 工作区图标、资产Logo和SVG稳定性 | 已完成（列明glyph/资产/多实例合同） | 当日参考路径对照，Chromium/Firefox×桌面/手机×DPR1/2共8组、988断言/100图标实例通过：星标、关闭、排序、List/Calendar、定位、Simulation、Dock、mobile gauge及原生Settings；真实点击/回焦点通过。三ETH Viewer每例27个SVG ID无重复/悬空，BTC/ETH本地图标及Canvas导出、未知ETHFIUSDT的ET fallback共3场景通过，无远程Logo。360/390普通长名和长token共4场景验证不遮挡Favorite/Close、完整换行及实际点击。40文件SHA通过；保留本地额外可访问Simulation关闭按钮，不伪称参考Drawer有该控件，不扩展为全交易所资产库或全UI通过。 |
| UI-10 | P2 | 桌面可访问性与跨浏览器；手机专项暂缓 | 部分完成（列明的生产、文字及必要图形合同已验） | 生产主入口32状态/34交互、DOM/AX通知及18图210个文字已验，文字最低4.595:1。后续两浏览器实际取色20项和键盘16项关闭Calendar焦点框及Settings四类控件边界；Simulation区间虚实轮廓与中位线最低4.41:1，全部68原始点及low/high可访问，正式四场景144/144和SVG fallback通过。原218次axe incomplete为文字检测不确定记录，不等于218个非文字缺陷；保留原始记录及对应人工测量。实际VoiceOver尚未验，本机AX自动化未授权；未覆盖状态须列明具体控件/场景，不重复将已验hover、键盘或区间列为待做。手机/Safari专项按SCOPE-07/03暂缓。可读性修正保留，不复制参考低对比度。 |

UI-10 后续两项Escape缺陷已修：鼠标悬停且Tab保焦点时先隐藏图表提示，第二次关闭Viewer；移出后提示已消失则直接关闭。Analysis点选Escape不再blur到BODY，保留精确point焦点并可Home继续浏览。两浏览器Simulation164/164、独立Performance/Analysis66/66及永久Analysis212/212通过，后者覆盖distribution/donut/duration与DPR1/2，Calendar子浮层优先级也已验。数值/状态不变，Chart/Observer销毁归零。原chart-focused Escape未覆盖这些路径，原失败证据保留；不扩大为实际读屏通过。

参考站已观察到的 open 行人口/胜率分母、open Exit epoch、已实现收益与 MTM 口径差异仍属于 UI-02～04/08 的展示差异。不能以原始账本 golden 通过关闭页面差异，也不能为复制参考站异常而悄悄撤销此前交易编号、Open 时间和收益口径修复；逐项记录参考行为、本地行为及差异处理，再作完整复刻验收。

2026-10-07 已进一步读取实际参考页加载的模块，并执行其原始导出函数对同一输入复算，六项数值及七种日期输入均有直接代码证据，见本地 `audit-evidence/2026-10-07-reference-formulas/`（15 项 SHA 通过）：

| 差异 | 已确认原因 | 本轮处理 |
| --- | --- | --- |
| CAGR 97.76% 与本地约 0.7103% | 参考 helper 默认本金固定 10,000，调用未传策略实际 1,000,000，且使用首末 closed exit；本地用实际本金及行情窗口 | 保留实际本金，不复制错误常量；方向 CAGR 的本金/时间分配仍未定义，不填假值。 |
| Calmar 82.503 与本地约 0.607 | 参考另用首 entry 至末 exit 计算固定 10,000 的 CAGR，与页面显示的 CAGR 起止不同 | 保留本地同一 CAGR/回撤百分比的可复算口径；比率显示统一为参考的三位小数。 |
| 回撤 1.18% 与本地 1.17% | 参考金额/初始本金；本地是引擎权益高水位分母 | 保留引擎真实统计，不能将分母差异叫四舍五入误差或零差异。 |
| Sharpe/Sortino 与 Benchmark | 参考桥接显式填 `risk` 的 0 和空 `benchmark` 对象 | 保留本地已实现的风险和基准能力，缺值不伪装成 0。 |
| Summary 胜率 34.66% 与本地 34.78% | 参考 Viewer 覆盖桥接胜率，将 open 纳入 277 行分母，但 Trades 显示 276；本地 Summary 使用已平仓非零人口 | 保留现行 Summary/Analysis 各自人口并纠正旧源码注释；该窗口没有真实 closed breakeven，不能推论所有零收益样本都一致。 |
| Header 起始 Aug 16 与原本地 Aug 15 | 参考标题使用首末 closed exit，无 closed 时隐藏；它不是行情窗口 | `activityRange` 已在双真实引擎 8/8 场景验证：SMA 显示 Aug 16–Oct 6，零交易/仅 open 隐藏，单笔 closed 同日起止；原 `range/history`、精度提示和风险/Simulation 不变。证据 `audit-evidence/2026-10-07-ui-actual-chain/header-fix/`，为开发实际链，不冒称生产或全量像素。 |

上表解释了已列差异，不意味着用户取消一比一目标或全部视觉已通过。需要保留的本地正确能力与参考站异常必须公开记录，不能通过修改原始账本、损坏计算或删掉功能来消除截图差异。

Settings 的 UI-06/ST-02～04 通过指本地草稿事务合同：修改和 Reset 不立即执行，Cancel/关闭/Escape 丢弃草稿，Ok 一次合并提交。当前参考为字段即时提交、Reset 即时应用默认值、Cancel 逐字段还原；Ok/关闭/Escape 仅关闭并保留已提交值。这是整个提交流程的明确差异，不只是 Reset 的不同；无网络请求不能证明参考没有在本地 Worker 重算。源码依据见本地 `audit-evidence/2026-10-07-simulation-reference-tab-state/STATE_CONTRACTS.md`，不撤销已验证的本地批量提交和错误恢复能力。

### UI 合并任务中的易漏细项

以下仍属于原 10+14，不是扩大到整个宿主网站。对应 [Parity Matrix](BACKTEST_PARITY_MATRIX.md) 的历史 `PARTIAL` 不能自动变成当前通过；已有局部实现与尚缺的参考/集成证据分开确认。

| 模块 / 对应矩阵 | 已有部分 | 仍需核对 |
| --- | --- | --- |
| Dock 折叠、拖拽和高度恢复（D-04～D-13） | 原生参考/本地同输入393/393，折叠45、展开280、图表164、Ghost32、宿主75%上限及阈值/键盘已验；最新极小轴按原formatter对齐科学记数，两浏览器8surface/28标签通过 | 保留本地独立高度/折叠偏好和可读颜色，不复制参考无持久化/低对比度；极小轴差异已关闭，浮点噪声清理和非有限值保护仍保留。 |
| 星标（H-06 / STG-04） | Viewer/list/FavoriteService双向、双Cell后台及刷新/销毁通过；后续真实Worker两浏览器完成legend→Viewer→Favorites及反向、</>实际名称/源码，与定位合计164项；图标由UI-09列明合同验收 | 保留用户要求的统一指标收藏，不再将已验图例联动/图标列为待做。参考按钮调用服务器save-backtest，本地没有账户保存回测能力；不能把统一指标收藏称为远端保存报告的等价实现。 |
| Tab 与滚动（H-08 / H-09） | 已按参考改单一共享位置，新内容按实际scrollHeight/clientHeight夹紧；同Tab不变、重开Performance/top0、同页pending恢复、导航/终态/新context清理均保留 | 本期合同关闭：旧实现新测试5项失败留证，修后两浏览器受控56、真实dev70、prod70通过，source/dist稳定。Firefox已测亚像素取整允许0.5 CSS px，不照抄某次参考offset或要求整页像素重合。 |
| Settings（ST-04 / ST-05） | 原生参考12类型脚本对照、两浏览器×两引擎typed计算及合并Apply已验；4处控件样式、焦点/失败恢复和日期/单位已有直接证据 | 本期有限桌面合同关闭；draft-only Reset/额外属性/source volume/时间保真为保留差异，不改原始引擎值迎合参考异常；VoiceOver单列。 |
| Trades Log / Calendar / 定位（L-05） | 同 DTO 24 状态、分页/排序/Calendar 实操已有证据；新桌面 Entry/Exit 范围、原生蓝色 label/十字线、4 秒清理及隔离在两浏览器各 37/37 通过 | 已列定位缺口关闭；不扩大为所有时区/locale 或全工作区，手机/Safari 专项暂缓。 |
| Performance / Analysis / Simulation | 原同输入组件对照和已列键盘/tooltip/弹窗保留；最新Simulation共6场景216/216，含真实Worker计算、迟到progress/完成投递、同报告revision和close/reopen | S-11已关闭：离页后默认Resample/1000/0及默认显示参数，同Tab/同报告更新不重置；按cell/indicator清理与取消，旧成功/失败不能覆盖新会话。算法和原始账本未改；VoiceOver归UI-10，正确性口径差异不伪报零差异。 |
| Logo、响应式与状态 | UI-09已列工作区glyph/多实例/资产合同通过；Calendar窄格完整日值可达 | 桌面未覆盖状态/VoiceOver按UI-08/10维护，手机适配和手机实机触摸按SCOPE-07暂缓；不重验已关闭图标或新增全交易所资产库。 |

## 四、实时、生命周期与独立运行

| 编号 | 优先级 | 需求 | 当前结论 | 验收口径 / 剩余工作 |
| --- | --- | --- | --- | --- |
| REL-01 | P1 | 断网、恢复和静默 WebSocket | 已完成（列明的两小时与代表静默故障） | Hyperliquid 7,200.133 秒/23 次恢复/8,617 callbacks/24 sockets、Binance 7,200.111 秒/23 次恢复/3,458 callbacks/29 sockets 均平衡清理。新增真实 Hyperliquid CONNECT 代理静默验证，两引擎均持续扣留加密数据约 45 秒，navigator 始终 online；watchdog 至少两次换连，允许初始 3 秒在途数据排空，随后稳定期账本/revision 不推进，放行后分别 2.57/2.57 秒恢复新 socket candle。16/16 隧道关闭，页面错误、迟到回调为 0。故障为明确的传输注入，不伪称自然交易所故障。见 tests/e2e_provider_blackhole.py。旧 Binance teardown 失败证据保留；默认网络路径未排除系统代理。REL-06 的本地生产两小时范围已另行关闭，不要求全部 Futures 地区、设备或线上环境通过。 |
| REL-02 | P1 | 旧报告、旧 tick、旧 history 不污染新市场 | 已完成（列明市场/读取竞态合同） | revision、run、market、Cell 和读取Retry门控已覆盖PineEngine/PineWorkerEngine；D-01/R-07等列明场景保持原证据。最新真实脚本运行失败后的重试发现独立缺陷，单列REL-07，不用旧竞态通过覆盖该场景。 |
| REL-03 | P1 | 多 Cell 隔离 | 已完成（本地范围） | 后台 Cell 的结果、错误和迟到响应不会抢占当前 Cell；多 Cell E2E 和销毁清理通过。 |
| REL-04 | P0 | 项目可独立运行，不依赖参考站 | 已完成 | 生产构建使用本地 Vela-PineTS、PineTS、Highcharts 和本地 Logo；dist 独立性检查和外部 LuxAlgo 请求审计通过。 |
| REL-05 | P0 | GitHub 远程只保留可构建业务代码和必要文档 | 已完成 | `audit-evidence/` 中的审计截图、临时日志、构建产物和历史审计附件被忽略；repository hygiene 通过。必要测试及其受版本管理的 `tests/visual-baseline/` 是回归输入，不属于审计附件；不能笼统声称所有 PNG/截图都不会提交。 |
| REL-06 | P2 | 长生命周期和重复挂载清理 | 已完成（限定本地生产构建范围） | 独立冻结 `dist` 的 Chromium Workspace 运行 7,200.505 秒、121 次采样、真实 Hyperliquid BTC 永续、四 Tab/Settings 操作均无页面错误；最终资源 2 documents/3,406 nodes/1,076 listeners，低于 3,906/1,176 预算，卸载后 Worker 1/1、Socket 2/2 关闭且 active=0，服务已停止。采样期间偶发未回收峰值 Nodes=4,744、Listeners=1,224，属于浏览器/DevTools 清理延迟；终态经卸载验证归零，不据此宣称所有设备均无泄漏。证据：`audit-evidence/2026-10-07-production-workspace-two-hour/results.json`（SHA-256 终态已核验）。该结论不扩大为全部设备、最新未提交 UI、线上部署/CDN/rollback；桌面辅助技术归 UI-10，手机触摸按 SCOPE-07 暂缓。 |

## 五、既有 Workspace 功能与工程约束

| 编号 | 优先级 | 需求 | 当前结论 | 验收口径 / 剩余工作 |
| --- | --- | --- | --- | --- |
| BASE-01 | P0 | 顶部工具栏按钮逻辑和交互 | 已完成（功能合同） | Symbol、周期、样式、布局、指标、收藏、模板、撤销/重做、Panels、Screenshot 等保持既有回归；当前 UI 对标只涵盖回测关联入口，不以历史 NR-01 扩成整个宿主页面重做。 |
| BASE-02 | P0 | 指标管理分类与收藏 | 已完成（功能合同） | 列表顺序为 On chart、Favorites、My indicators、Built-ins，保留星标、源码/详情和 `</>` 操作标识；回测前后个人指标、收藏和编辑器保持非回归，不扩大为整个指标库新增视觉对标任务。 |
| BASE-03 | P0 | Vela Workspace 替换手写图表模拟 | 已完成（公共 API + 明确的兼容补丁） | 主体通过 Vela API 接入；历史容错另依赖 CachingDataFeed、registry、BarStore 内部边界。窄屏还通过 [Vela viewport 补丁](../../forks/vela-viewport.md) 改写已锁定 0.7.7 ESM 的柱间距下限，纳入构建锁/指纹并校验输入输出 SHA。不能再声称完全未修改上游产物；升级须重验缓存/覆盖、缩放、拖动、resize 和独立安装构建。 |
| BASE-04 | P0 | PineTS/Vela-PineTS 本地源码依赖 | 已完成 | 必要 Fork 以 workspace 包构建，Worker 版本和 build fingerprint 可验证；修改后会重新构建。 |
| BASE-05 | P0 | 既有浏览器脚本/Workspace 持久化 | 已完成（本地能力） | 既有保存/恢复/迁移继续做非回归；长期持久化仅在 SCOPE-04 记录待讨论，不升级为当前开发任务。 |
| BASE-06 | P1 | 主入口与功能模块解耦 | 已完成（Phase 0–6） | `main.ts` 已收敛为启动入口；Workspace、Provider、Backtest、Storage、Engine 通过明确边界和公共 seam 组装。架构计划 Phase 0–6 已验收；后续性能优化属于独立 Phase 7，不作为本需求阻塞。 |
| BASE-07 | P0 | 前端显示构建版本 commit ID | 已完成 | 页面显示短 commit ID，构建产物中的版本与构建提交可核对。 |
| BASE-08 | P0 | Fresh checkout 独立构建和本地预览 | 已完成（本地范围） | install、Fork 构建、TypeScript、Vite build、preview、dist 独立性和生产 E2E 已通过；真实线上部署不在本阶段范围。 |
| BASE-09 | P0 | 远程仓库瘦身 | 已完成 | 远程只保留业务源码、必要测试和当前文档；审计证据及审计截图、临时日志、dist、node_modules 不进入提交。必要视觉回归基线仍随测试保留，具体排除以 `.gitignore` 和 repository hygiene 为准。 |
| BASE-10 | P1 | Provider 来源职责清晰 | 已完成 | Binance Spot 是回测基准；Hyperliquid BTC 用于永续/实时恢复；Binance Futures 保留为可选路由，不作为 Spot 阻塞。 |
| BUILD-01 | P0 | 单元、冒烟、回归和既有功能保护 | 本批列明门禁通过（持续非回归要求） | 最新根653/653、Adapter32/32、相关Controller/History121/121、类型、构建、生产主E2E、依赖/仓库/包体/dist通过；共享滚动196项、Simulation216项、实际轴28标签、脚本错误64项、故障隔离198项及K线连续性31项另有直接证据。此前dev主E2E、桌面32场景/1,792项、Dock632、Summary/Dock键盘176、Settings、Analysis及Log/Calendar专项保持各自时点，未称本轮全部重跑；desktop/laptop已审视觉基线及预算未改，远端CI单列BUILD-03。 |
| BUILD-02 | P2 | Bundle 体积预算门禁 | 已完成（当前预算） | main/Worker/Highcharts raw/gzip 预算门禁通过；Vite 大 chunk warning 是可选优化项，不阻塞当前本地发布。历史 Parity Matrix 的“新增 bundle ≤100KB gzip”是旧增量阈值，未纳入当前验收预算。 |
| BUILD-03 | P1 | 最终提交的远端 CI 回归 | 进行中（最新提交已推送） | workflow、actionlint 和本地静态/业务验证通过；GitHub Actions 已由 `task/p1-priority` 推送触发，待该 run 完成后按同一 SHA 记录结果，旧 run 不代替本次提交。 |
| STARTUP-01 | P2 | 新页面启动与行情初始化性能 | 已完成（本期有限性能合同） | 默认2,000、渐进历史、Worker/editor懒加载、dev:fast、存储降级/去重已落地；真实冷3+prime1+warm3完整阶段/缓存已验。80次渐进ABBA满足首绘≥20%、报告/暖路径/内存≤10%退化及结果一致预算；另80页资源对照空图-44.05%、SMA-17.50%达到JS gzip≥15%，完整报告/图表及编辑器功能均实际验证。长时资源的本地冻结构建合同已由REL-06单独通过，不宣称全地区/设备或统计SLA。 |
| PERF-01 | P2 | 大账本、图表与 Simulation 运行期性能 | 已完成（固定 Chromium 生产基准与列明的跨浏览器功能合同） | 独立生产图谱、源码全程稳定，Chromium/Firefox × DPR1/2 的 10k/100k 共 8 场景通过结构/资源检查；固定 Chromium DPR1 冷 selector p95 52.2/399.9ms、分页 41.4/42.2ms，满足原 100/500ms 预算。range 极值/真实多 series tooltip、异常构造清理、10k Worker 371–917ms、progress≥100 后取消/替换/销毁 0–1ms 已验；Chromium 拖拽60.2–60.3FPS、十次开关 retained heap +0.30–0.34MiB、Chart/Observer归零。Firefox 10k分页124ms、100k聚合656/589ms超过 Chromium 对照值，记录为观察，未声明同预算通过；其精确 heap/long-task API 不可用。100k report factory 最慢约1.14s另列，不冒称端到端低于500ms。最新 UI 修改不具有该批相同 SHA；完整 UI/真机归 UI-08/10，不强加未约定的全设备 SLA。 |

## 六、暂缓、范围外和待讨论（不混入实施队列）

| 编号 | 需求 | 当前结论 | 依据 / 后续口径 |
| --- | --- | --- | --- |
| SCOPE-01 | 真实部署、CDN、rollback | 暂不做 | 用户表示目前没有环境，“这部分可以先忽略”；本地构建、预览和缓存合同仍维护。 |
| SCOPE-02 | Replay | 暂不做 | 用户明确本阶段先不考虑。 |
| SCOPE-03 | Safari 专项 | 暂不做 | 用户明确“Safari 验证——这个后续可以不考虑”；不取消桌面 VoiceOver，WebKit 自动化可保留。手机另按 SCOPE-07 暂缓。 |
| SCOPE-04 | 自建脚本长期持久化 | 待讨论 | 只记录待讨论，不给技术方案，不列为当前 P1 开发或发布阻塞。 |
| SCOPE-05 | 完整 TradingView 外部逐 Fill 对账 | 当前不作为关闭条件 | 当前验收策略是已选语义的独立预期/回归；仍按 TODO 和 TV 调研实现，不能表述为用户取消复杂撮合。 |
| SCOPE-06 | 原列表第 15 项 | 暂不做，题名待核对 | 保留原编号和决定，不据未知题名扩大排除范围。 |
| SCOPE-07 | 手机端布局、交互适配与专项验收 | 暂不做 | 用户明确“手机端……适配可以先暂时不做”。暂停新增手机布局/横竖屏/safe-area/触摸及手机实机验证，不作为当前完成阻塞，不标为通过；保留已有修复和证据。桌面各模块、窗口缩放、键盘及通用业务逻辑继续验收。 |
| 参见 ENGINE-06 | 其它品种/策略/窗口 golden | 当前范围外 | 第 7 项限定 BTCUSDT/15m/SMA，不把扩展 golden 混入本期未完成队列。 |

## 本轮新增确定问题（2026-10-07，处理中）

| 编号 | 优先级 | 需求 / 缺陷 | 当前结论 | 验收口径 |
| --- | --- | --- | --- | --- |
| REL-07 | P1 | 真实脚本运行失败、首次错误及Retry不得恢复旧报告 | 已完成（列明双引擎错误合同） | Adapter32/32、相关Controller/History121/121；PineEngine/PineWorkerEngine首次错误、已有报告后错误、Retry和修复后恢复4场景/64项通过。Retry重新执行当前输入，旧context不再转ready；普通指标错误不创建回测entry；Provider/账本Retry保持原合同。 |

旧工作区逐key恢复（STG-03/06）和存储/定位异常隔离（LC-07/NR-05）均已通过列明的本地合同；前者允许storage异常时会话内存降级，后者只覆盖明确注入场景。以上工作不扩展长期脚本持久化、手机或线上回滚范围。

## 当前状态排序（含已关闭项；新排序不替换原编号）

| 顺序 | 优先级 | 关联需求 | 已完成部分 | 剩余工作 / 关闭条件 |
| --- | --- | --- | --- | --- |
| 1 | P0 | BUILD-01 | 最后对齐后根651/651、Adapter32/32、相关Controller/History121/121；共享滚动196项、Simulation216项、实际轴28标签及双引擎脚本错误64项通过；类型/构建/生产主E2E需在本轮修改后重跑 | 此前Dock/桌面矩阵/strict visual保留各自时点；存储恢复已通过，异常隔离正在最终复核。后续改动继续非回归，不自动关闭CI或辅助技术。 |
| 1a | P1 | REL-07 / ENG-10 | 真实双引擎错误、首次失败、旧报告隔离和修复后Retry已通过 | Adapter永久32/32、相关121/121、真实4场景/64项；后续脚本错误组合继续按本合同回归。 |
| 2 | P1 | DATA-11（DATA-04～09） | 已列窗口/连续性/缓存/手势/双引擎门控与当前生产 smoke 通过；持续代理静默恢复也已补证 | 本期合并验收关闭；后续实现变动继续回归。不能扩大成全部网络、整个 ENGINE-03 或真机均通过。 |
| 3 | P1 | ENGINE-03（原 8） | 基础/历史精度 8/8、风险/entry 16/16、跨订单/实时回滚 14/14、归档重放 496 字段及最新开发/生产 E2E 通过 | 本期有限合同关闭，后续缺陷按新反例处理；不新增完整 TV 外部逐 Fill、盘口模拟或产品导出入口。 |
| 4a | P0 | UI-01、UI-07 | Dock/Header/Viewer 生命周期与图表联动的本地功能合同已通过；普通周期切换由 DATA-11 联合覆盖 | 继续作为 BUILD-01 的非回归范围；完整参考视觉归 UI-08。 |
| 4b | P1/P2 | UI-02、UI-03、UI-04、UI-05、UI-06、UI-08、UI-09 | 原有限组件合同保持；最新共享滚动196项、Simulation生命周期216项、实际小值轴28标签及最后生产集成通过 | H-09/S-11/D-10不再列待办。明确保留统一指标收藏/账户保存、草稿Apply/即时提交及正确性/可读性增强的差异；桌面VoiceOver仍归UI-10，最终CI另验。 |
| 5 | P1 | REL-01，关联 DATA-10（原 6/9） | 两数据源各两小时恢复、双引擎实际 CONNECT 45 秒静默及恢复均通过 | 已列网络合同关闭；REL-06 本地生产两小时范围另已通过，未测地区/设备/线上环境不作可用性承诺；旧失败批次保留。 |
| 6 | P1 | BUILD-03 | workflow 与本地门禁已有 | 最终提交发布后核对远端 CI；这是交付步骤，不是本次自动合并指令。 |
| 7 | P2 | STARTUP-01 | 真实完整启动/缓存、80次渐进预算及80页资源对照均通过；SMA首启JS gzip减少17.50% | 原有限预算关闭，后续修改继续回归；不重列已验事项，也不扩大为全球网络/设备SLA。 |
| 8 | P2 | REL-06 | 开发 HMR、主入口 CSS/整页刷新、独立生产宿主 20 次挂载/销毁及两小时生产 Workspace 已验 | 独立冻结 dist 的真实行情/Worker 和持续 UI 操作运行 7,200.505 秒，资源预算和卸载清理通过；该本地 Chromium 证据不代表全部设备、最新未提交 UI 或线上部署。 |
| 9 | P2 | UI-10 | 生产32状态/34交互、DOM/AX通知及210个文字；后续20项必要边界取色、16项键盘、Simulation区间68原始点/144项正式交互及SVG fallback通过 | 实际VoiceOver仍未验，本机AX自动化未授权；其它缺口须给出具体控件/状态，不用“全部tooltip/非文字incomplete”重复列已完成项。手机/Safari专项暂缓，已有自动化不替代读屏实测。 |
| 10 | P2 | PERF-01 | 固定 Chromium 生产预算及 Chromium/Firefox DPR1/2 功能/资源矩阵已通过，包含完整冷 selector、range tooltip、Worker 取消和异常清理 | 本期列明范围关闭；Firefox 超出 Chromium 对照值、100k factory 约1.14s及 API 缺失如实保留，不称全浏览器/全设备同预算。后续改动按 BUILD-01 维护。 |

已关闭的 ENGINE-04 固定窗口数值对账、ENGINE-01/02 默认精度与开关、ENGINE-03 有限撮合合同、DATA-11/REL-01 和当前 bundle 预算不重复实施；源码改变时继续非回归。待讨论/范围外项目保留在上一节。

## 当前判断与维护规则

项目已具备独立本地构建和人工测试能力，整体仍为 **PARTIAL**。H-09共享滚动、S-11参数挂载生命周期、D-10极小轴记法、STG-03/06恢复合同、ENG-10脚本错误合同及LC-07/NR-05明确故障隔离合同均已直接验收；K线、有限撮合、固定golden、代表网络、性能及长生命周期维持各自证据。剩余内容分为两类：一是用户明确保留的**范围差异**——参考站账户保存回测依赖云账户，本地只提供指标/脚本/Workspace/Dock 的持久化；参考站字段即时提交，本地保留可取消、可回滚的一次性草稿 Apply；二是实际验收项——桌面 VoiceOver 和最终提交后的远端 CI。这些不能通过增加一个未授权账户接口或破坏已冻结的本地事务合同来“伪关闭”。手机/Safari/线上部署等暂缓项不混入当前阻塞。

历史记录：根554/554、桥接303/303、低周期23/23，以及后续根616/624/627、引擎1773+1均保留各自时点。sentinel、Settings/Calendar/Performance及Header后已有根639/639和完整本地门禁；最新非文字修复又通过根639/639、类型、重建/生产主E2E及受影响专项。前一次完整门禁与最后定向验证分别记录，不冒称每轮全量重跑。

以下按批次列直接验证及证据边界；历史数据/引擎证据保留对应源码时点，最新应用修复使用本批根测试、生产E2E和受影响浏览器专项，不声称所有证据均在最后一次编辑后重跑。

| 验证 | 结果 | 证明 / 不证明 |
| --- | --- | --- |
| 周期切换实际 Vela 浏览器矩阵 | Chromium 51/51、Firefox 50/50，无页面错误 | 受控 Provider 的宽/窄屏实际 2,000 loaded/visible、缩放/拖动/resize 和缓存；不证明真实交易所/实体触摸，也不代替实际越界补历史。脚本：`tests/e2e_timeframe_switch.py`。 |
| 实际手势补历史及完整业务路径 | Chromium、Firefox 各双引擎 26/26，定向单元 104/104 | `tests/e2e_history_gestures.py` 使用真实 pointer/wheel，核对 Provider 请求、OHLC、history、Viewer/Retry 和账本；覆盖补至 4,000/6,000 根后再次切换、故障恢复、旧请求、多 Cell、genesis、销毁及误触。零页面错误/非预期外部请求/映射异常。额外修复近似相等盈亏导致直方图分桶超量、报告卡在 computing 的问题；分桶上限 256。行情/故障仍是受控输入，不替代实际交易所或最终生产集成。 |
| 双引擎缺口/Retry 实测 | 6/6，页内/旧页/接缝分别覆盖两引擎 | 真 Vela、PineEngine/PineWorkerEngine、Adapter 和 Viewer；受控行情。`python3 tests/e2e_history_continuity.py` 实际点击 Try again、重取并恢复完整账本。 |
| 高精度缺口及恢复 | 双真实引擎六场景 12/12，页面错误 0；当时 Vela-PineTS 305/305 | `tests/e2e_precision_continuity.py` 覆盖子数据补齐/持续缺口/HTTP 503/空/尾部不足及父周期缺口。当前 forming/asOf、覆盖率和因果边界已在 309 测试批次新增覆盖；不冒充 tick 精度或真实交易所故障。 |
| 历史精度可见状态与成交预期 | 本轮双真实引擎 8/8，页面/外部错误 0，清理后 Canvas/dialog=0 | `tests/e2e_precision_history.py`：forming、完整 closed、历史 cap、inclusive-future 各两引擎。独立 OHLC 预期验证 Entry/Exit/P&L；5,000 子 K 对 2,000 父 K 显示 833/2,000（41.7%）及明确 fallback。受控数据、真实浏览器 Worker；不是在线交易所或最终生产复杂组合。证据：`audit-evidence/2026-10-07-precision-history/`。 |
| 实际交易所月线、连续性与渲染 | 16 个合同场景通过：15 个完整、1 个真实缺口明确拒绝；4 个实际图表渲染通过 | 修正后的 `tests/e2e_history_real.py` 无行情拦截，在 workspace 存活期间核对 rawBars、可见根数、OHLC/间距、Canvas 绘制并截图。Binance 1m/5m/2h 各 2,000，月线 111；35 次公共行情 HTTP 200，页面错误/请求失败均为 0，销毁后 Canvas=0。Hyperliquid 2021-07-02 缺口直接核实为源缺失。 |
| 最新受影响单元回归 | 60/60（continuity/cache/progressive/provider-history）；视口/构建协调器 28/28 | 对应各自命令与输入，不与早期同为 60/60 的另一组专项混算；不代替浏览器和在线验收。 |
| 根/桥接/引擎批次 | 最新根653/653；前一完整本地门禁桥接310/310、matching68/68、有限golden1/1；离线引擎1773+1保留原批次 | 本轮 `npm test` 653/653 通过；最后三项对齐、脚本错误、持久化、故障隔离和K线连续性另有直接证据；不把旧646或原引擎总数称为最新全量复跑。 |
| 本次独立数据/撮合专项复核 | 数据定向54/54；matching68/68；补充风险/重算/费用/跨订单123/123 | 未发现新的确定性业务缺陷，未为通过检查修改业务源码。仅核对应用当前注册的 guarded Binance/Hyperliquid；外部自定义未接 guard 的 Provider 不属于 DATA-11 已验路径。撮合范围仍是 ENGINE-03 有限合同，不扩大为完整 TV/盘口/tick 对账；这些选择集可能重叠，不合计成新的全量测试数。 |
| TypeScript | 通过 | 根应用与 Vela-PineTS 类型检查。 |
| 最新生产构建及开发/生产主E2E | 最后Tab/Simulation/极小轴对齐后重建/生产主E2E通过，非法外部/LuxAlgo请求0；共享滚动真实dev/prod各70项 | 最新主日志为 `audit-evidence/2026-10-07-tab-parity-closure/production-e2e.log`；此前开发主E2E与生产32状态保留原时点，不替代VoiceOver或数据/撮合/长时证据。 |
| 本地视觉非回归与最后受影响UI验证 | 前一完整门禁desktop/laptop四图strict diff=0、桌面32场景1,792项；最后两浏览器紧凑桌面4场景228项+6项清理通过 | 最后必要图形修改未更新基线或阈值；用实际Calendar/Settings取色键盘、Simulation原生/fallback及紧凑桌面专项验证，见 `dock-keyboard-closure/nontext-responsive/`。旧8图审阅和5类ring负控留原记录，不写成最后修改后的全量截图通过。 |
| 工程与文档校验 | repository hygiene、git diff --check、bundle/依赖/dist/release 和本地链接检查通过；主表列数一致、需求 ID 唯一。此前 Vela 补丁后隔离 `npm ci --offline → build → bundle → dist` 有通过证据 | 本轮重跑的业务门禁见上方各行；此前隔离构建和文档检查不能单独证明全部功能通过。审计原始行情/日志/截图仍只存忽略目录。 |
| HMR / 短期生产生命周期 | 开发 3 次 HMR；生产 20 次挂载/销毁通过 | `tests/backtest_runtime_lifecycle.py`；17.73 秒，实际 Worker 和应用模块、受控行情，独立生产测试宿主。553 源码/探针文件起止 SHA 不变，22 证据哈希通过。主入口 CSS 保留弹窗、main 整页刷新关闭旧 Worker 并恢复策略；资源归零，开发有 3 条已处理取消日志。不证明生产小时级资源稳定。证据：`audit-evidence/2026-10-07-runtime-lifecycle/`。 |
| 风险撮合实际双引擎集成 | 16/16；页面错误/外部请求为 0 | `tests/e2e_risk_liquidation.py`：日内亏损、margin+risk、仓位缩量、禁止方向只平仓 × 两引擎 × 两精度。Margin call audit 修复后，完整 execute 请求、结果与 provenance 新归档在 `audit-evidence/2026-10-07-risk-browser-complete-request/`；账本/Viewer/100% 覆盖和资源归零。其后的 closeTime 改动由 14/14 浏览器及归档再放覆盖。公开 pending 从完整事件重建，不假称私有队列。 |
| 跨订单/实时风险实际双引擎 | 14/14；页面错误/外部请求为 0 | `tests/e2e_order_paths.py` 与 `audit-evidence/2026-10-07-order-path-browser-final/`。12 个跨订单默认/低周期场景 + 2 个 live 回滚场景；独立价格、数量、费用、权益和 audit/曲线。受控 OHLC、实际 Worker，非交易所或完整 TV 对账；3 个附件 SHA 已核验。 |
| 完整归档离线重放 | 305 + 191 = 496 字段零差异 | `tests/replay_engine_archive.mjs`；新归档再放及独立有限输入包均通过，最新 closeTime 构建又在 `audit-evidence/2026-10-07-engine-archive-replay-close-time/` 通过。网络请求为 0，trade exit 均可关联审计。旧 margin audit 缺失归档仍有 80 个真实差异，保留 `...engine-archive-replay-old-diff/`，未修改旧结果或比较容差。 |
| 生产主入口可访问性与移动端 | 32状态/34交互、18图210文字通过；页面错误/非法请求0 | 真实 Pine/Simulation Worker、受控行情。最新图表文字颜色构建再次实测，`audit-evidence/2026-10-07-svg-contrast/` 共309文件SHA已核验；不足项102→0，最低4.595:1，无漏测。原始axe incomplete218次保留，明确只关闭可见文字范围，不冒充tooltip/全部状态/VoiceOver/真机。前一Settings布局批次仍保留。 |
| 较早 Log/Calendar 实测对照（历史批次） | 16 排序 × 20 行 = 320/320；两月 Calendar 数据一致；完整八列桌面列宽逐列几何 0 差异，390px 七列全宽 | `audit-evidence/2026-10-07-ui-live-modules/` 的参考 274 closed + 1 open，仅作当时 UI 对照，独立于 ENGINE-04 golden。本地实际组件渲染同一份参考 DTO，非本地 Provider 重算。43 文件 SHA 已验，参考 API 保存请求被拦截。该批曾仿照参考跨格金额溢出，现已撤销此验收目标，可读性修正和新证据见 UI-05；旧截图不证明现行布局适配通过。 |
| 固定参考窗口当前引擎重算 | 最新跨订单/margin audit/closeTime 修复后 280 行、2,520 字段、13 汇总零差异 | 新产物 PineEngine 使用冻结 5,000 根 OHLC、源码/参数，等待 onDone 后得到 279 closed + 1 open。目录 `audit-evidence/2026-10-07-frozen-sma-cross-order-final/`；8 证据文件 SHA 已验，源码/dist 及旧参考档案起止不变。本轮 in-process 数值非回归，不冒称新采集、Simulation 或像素全验；真实 Worker 另列。 |
| 较早 Settings 生产几何批次 | Inputs 九组相对几何一致，生产 32 状态/34 交互通过 | `audit-evidence/2026-10-07-settings-production-parity/` 证明当时真实主入口；其后同源下拉/stepper/拖拽/移动边界见下行，不能用本行代替最新控件的生产接线。 |
| Settings 当前控件与生命周期 | Chromium/Firefox/WebKit 专项通过，553 源码/测试起止 SHA 一致；31/31 单元/架构通过 | `audit-evidence/2026-10-07-settings-live-controls/`：真实参考数字/下拉/拖拽与移动布局对照；320/390/1440、pointer/键盘、单次Apply/Reset/失败/迟到响应/destroy。pageerror和window ErrorEvent分别为0，已实修observer loop；0 dev-client。该组件门禁不冒称新生产 App 或实体 Safari/VoiceOver。 |
| Performance 非空 Benchmark 与精度 | 原组件51受控案例；三浏览器各48例/432单元格、135颜色和90后缀检查通过 | `audit-evidence/2026-10-07-performance-controls/`，24文件SHA通过。当日加载原模块的StrategyPerformance/formatter/renderCell直接执行；React/图表外壳替身明确记录。修正+号、小值/科学计数/百万M/ratio及12px单位；与实际Workbench DOM比较。不声称自然非空Benchmark或计算golden，负零规范化和真实文本币种间隔有意保留。 |
| Log/Calendar 最新同DTO和实际交互 | 18/18、2,610断言；Header后手机12/12、1,752断言和24态新截图，分别起止SHA稳定；373证据哈希通过 | `audit-evidence/2026-10-07-log-calendar-completion/`。参考275closed+1open DTO与本地501行交互分别验证，不混同输入；真实pointer/键盘/touch、焦点/ARIA、月份/tooltip、完整日值、11金额边界及280px嵌入容器通过。保留200行分页、修正跨格重叠；参考DOM激活采集不是可信手势，全UI不自动PASS。 |
| 工作区图标及手机长Header | 8例988断言/100图标实例、资产3例、长名4例通过；40文件SHA | `audit-evidence/2026-10-07-backtest-icon-parity/LOCAL_ICON_VERIFICATION.md`。当日参考路径、viewBox、stroke/可见尺寸和真实操作；多ETH实例无SVG ID冲突/悬空，未知资产fallback本地可用。360/390长名/长token完整换行且两按钮可点。原初版遮挡失败保留，当前无page/window/外部错误；不是全交易所资产或整页像素验证。 |
| 运行期性能最终生产基准 | 两份独立生产图谱DPR1/2均exit0，源码全程稳定；定向76/76 | `audit-evidence/2026-10-07-runtime-performance/`：Chromium/Firefox共8个大账本案例，完整冷selector/分页/range tooltip/Worker取消/异常清理通过。固定Chromium DPR1达原预算；Firefox超出对照值及100k factory约1.14s明确保留。无开发模块/外部请求，错误及销毁资源为0；不将本批SHA扩大为随后Calendar/Performance/Header源码，也不声称全浏览器同预算。 |
| 新参考站登录、采集与同输入准备 | 已取得四 Tab 截图/DOM、新 5,000 根 OHLC 与策略上下文 | 当前参考入口跳转到 `vela.luxalgo.com/chart`；精确 SMA 9/21 在新窗口运行，276 closed + 1 open，本地同输入 277 行且已比较的汇总差异为 0。此项是 UI 同输入准备，不冒充该新窗口已完成全部逐笔 golden；ENGINE-04 的已验 279 closed + 1 open 窗口保持独立。全模块视觉/交互仍未关闭。 |
| Binance 两小时恢复 | 修复版完整两小时通过 | 修复版 Binance Spot 两小时长测已通过：实际观测 7,200.111 秒、23 次恢复、3,458 callbacks，29/29 sockets 创建/关闭平衡；activeSubscriptions/activeSockets/offlineBars/late callbacks 均为 0、cleanupErrors=[]，close 等待 2,066ms。终态 5 文件 SHA-256 及 Provider 源码哈希已核对。证据：`audit-evidence/2026-10-07-binance-proxy-two-hour-rerun-fixed/`。默认浏览器网络路径，不宣称直连；maxActive=2 为关闭期间短暂重叠，不宣称全程仅一个物理 socket。旧 `...-rerun/` 仍为 teardown 失败批次；不证明完整应用或持续网络黑洞。 |
| 实际 Provider 持续 CONNECT 静默 | 双真实引擎 2/2；各 45 秒故障，约 2.57 秒恢复 | `tests/e2e_provider_blackhole.py`：真实 Hyperliquid 500 根/实时 candle，经本机代理链；仅在传输层扣留 TLS bytes，未替换 OHLC/WebSocket，也未将浏览器设成 offline。稳定期回调/账本/revision 不推进，watchdog 多次换连；放行后 fresh socket candle 恢复，历史 run 未变。16/16 隧道关闭、页面错误/迟到回调 0。四个输入哈希不变，7 文件 SHA 已验；证据 `audit-evidence/2026-10-07-provider-connect-blackhole/`。代表故障注入，不冒充自然故障或完整应用两小时。 |
| 真实生产完整启动阶段 | 冷3 + prime1 + warm3，共7页通过 | `tests/startup_loading.py --complete-report`；真实 Binance Spot、被动观察原生Worker。完整2,000根/同身份账本曲线、KPI和Simulation实际可用，warm静态缓存有证据。`audit-evidence/2026-10-07-startup-full-report/` 及 cold/warm子目录；14个源码/附件SHA已核验。结果含网络与点击延迟，不用少量样本宣称p95或预算通过。 |
| 渐进加载有限性能预算 | 80 次正式样本 + 2 次预热通过，142 项 SHA 通过 | `tests/startup_progressive_build.mjs` / `tests/startup_progressive_benchmark.py`；受控 HTTP 的相同生产产物 A/B，冷首绘 median 改善40.33%，其余原10%预算及请求数/完整结果一致性通过。页内暖缓存也测，失败 pilot 保留；不是实际交易所耗时或资源拆包对照。 |
| 首屏资源拆分预算 | 80页通过；空图gzip-44.05%，完整SMA启动-17.50%，264项SHA通过 | `tests/startup_resource_build.mjs` / `tests/startup_resource_budget.py`，真实gzip服务/eager与lazy隔离产物。SMA真实Highcharts增强后才统计，报告摘要40/40一致；开编辑器/修改运行/销毁通过，不靠漏算异步chunk或删功能达标。`audit-evidence/2026-10-07-startup-resource-budget-final-5/`；之前采样边界失败批次保留。 |
| 同参考输入的实际 UI 数值链 | 两引擎各 Analysis 57/57、Log 2,208/2,216、Performance 30/42 一致 | `audit-evidence/2026-10-07-ui-actual-chain/`，58 项 SHA 通过。真实 Vela/引擎/Adapter/Controller/Viewer、归档5,000根行情，无手造snapshot；实际点页读取277行。8个Log展示差异和12个Performance字段差异保留，周日起算缺陷已修；不混入 ENGINE-04 的另一冻结窗口，不等于生产/视觉全部通过。 |
| 收藏、Dock 和滚动状态 | 原生产35/35两次及状态边界23/23保留；最新共享滚动受控56、真实dev70、prod70通过 | `tests/e2e_backtest_ui_state.py`、`tests/e2e_backtest_scroll_state.py`；跨Cell收藏/刷新/销毁、Dock偏好和scroll均有各自证据。旧 `2026-10-07-workspace-ui-state/` 中per-Tab合同由最新 `2026-10-07-reference-shared-scroll/` 的196项取代；账户save-backtest与统一收藏差异仍保留，不篡改旧批次结果。 |
| Header展示范围和三位比率 | 双真实引擎×SMA/空/open-only/单closed，共8/8 | `activityRange`与原行情range/history分别验证；SMA标题Aug16–Oct6，对应原历史仍Aug15开始；无closed隐藏。比率0.607/-0.306/-0.341仅改格式。开发真实业务链、11源/输入起止哈希一致，31证据SHA通过；中间并行写入批次另保留不作通过依据。 |

证据在忽略目录 `audit-evidence/` 下的 `2026-10-07-timeframe-switch-full-viewport/`、`2026-10-07-history-continuity/`、`2026-10-07-precision-continuity/`、`2026-10-07-history-real-rendered/` 及 `2026-10-07-history-gestures/`；先前月线销毁后截图由新的 rendered 目录替代。Binance修复版两小时目录为 `2026-10-07-binance-proxy-two-hour-rerun-fixed/`，旧失败批次保留而不作通过依据。参考采集在 `2026-10-07-reference-workspace/`；本轮完整命令日志及终态留本地忽略证据，公开文档不依赖附件即可理解结论。必要测试脚本可进入Git，原始行情、日志、截图和本机绝对路径不进入部署仓库。

后续业务修改须在同一工作树补必要单元、冒烟、回归和实际浏览器证据，不仅重跑历史快照；既有工具栏、指标/收藏、Pine 编辑器、脚本存储、布局/模板、Provider 和截图均须保持正常。审计附件留忽略目录，不纳入部署仓库。

状态依据优先级：用户明确决定 → 本表当前口径 → 对应直接证据 → [TODO](../../../TODO.md) / [Final Gate 计划](../../architecture/FINAL_GATE_CLOSURE_PLAN.md) 当前段落；历史文字不能覆盖新决定，也不能制造未经授权的范围删减。
