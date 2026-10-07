# Final Gate Closure Plan

> 2026-10-07 桌面续验终态：根632/632、类型/构建、dev/prod主E2E及工程门禁通过；桌面32场景/1,792项、Analysis164、Log/Calendar858、Settings和strict visual四图diff=0通过。Simulation最后Preserve scoped CSS补丁另验84/84及重建/生产E2E。证据与源码时点见 `audit-evidence/2026-10-07-desktop-acceptance-final/README.md`（本地忽略）；下方627及更早数字保留各自批次。手机专项默认deferred/full可选，桌面VoiceOver、共享参考差异和最终提交CI仍按需求表开放；当前提交已在本地建立，远端 CI 待本次提交。

工作分支：`task/p1-priority`（从 `master` 的 `a7aa5bf` 创建）

当前需求状态总表见 [BACKTEST_REQUIREMENTS_STATUS.md](../backtesting/current/BACKTEST_REQUIREMENTS_STATUS.md)。

2026-10-07 UI 标准修正：功能、交互、图标和组件风格对标，布局适配本项目；不复制或预留参考 AI 侧栏/登录 banner，不要求整页绝对位置或像素误差阈值。所有未验模块仍按实际证据关闭，参考缺陷、裁切或不可读重叠不能以复刻为由保留。

最新范围调整：手机端适配按需求表 SCOPE-07 暂缓，手机布局/横竖屏/safe-area/触摸及手机实机不作为当前 Gate。已有代码、测试与历史证据保留，当前继续桌面 UI 全模块、缩放、键盘、VoiceOver 及通用功能。

2026-10-07 口径复核：原 6/7/8/9/10+14 的映射以需求表为准；DATA-11、代表网络恢复、ENGINE-03 的三项有限验收、STARTUP-01 资源预算和 REL-06 本地生产两小时范围已关闭，不将它们扩大成所有网络或所有订单排列通过。完整桌面 Backtest Workspace UI、桌面VoiceOver和最终提交 CI 仍开放。长期持久化只待讨论，其它 golden 不重入队；Safari和手机适配/手机实机触摸暂缓。原第 15 项题名待追溯，不能用它取消其它项目。

## 本轮 P1 范围

| 顺序 | 任务 | 关闭标准 | 当前状态 |
| --- | --- | --- | --- |
| 1 | master CI | master push 自动触发，开发/生产业务回归均运行 | 触发配置、actionlint、本地开发/生产回归通过；尚未 push，远端执行待验证 |
| 2 | 完整参考数值对账 | 相同行情/脚本/参数的完整 Entry/Exit/Size/P&L/MFE/MAE、汇总与 Simulation 对账 | **当前验收窗口通过**：Binance Spot `BTCUSDT · 15m · SMA`，相同 OHLC 序列/参数下 `test:reference:golden` 通过 280/280 笔、2,520 字段、13 项汇总和 Simulation 输入。其它脚本、行情和窗口不纳入本阶段阻塞 |
| 3 | 复杂撮合和 Bar Magnifier | 按原 TODO/TV 调研完整映射，以独立预期和回归验收 | **本期有限合同通过**：默认/高精度与 fallback、历史精度 8/8、风险/entry 16/16、跨订单/实时风险 14/14 浏览器及归档重放 496 字段已验。Margin call 审计和 live closeTime 已修；当前 SMA 重算零差异。部分平仓不等于盘口流动性，完整 TV 外部逐 Fill 不作为当前条件。 |
| 4 | 长时行情和恢复 | 两数据源两小时、多次断网、代表静默故障、终态和资源计数 | **已列范围通过**：Hyperliquid/Binance 各两小时恢复及 socket 清理通过；新增实际 CONNECT 静默 45 秒，双引擎恢复约 2.57 秒、16/16 隧道关闭，页面/迟到错误 0。完整生产 Workspace 两小时资源长测也已通过（7,200.505 秒、资源预算及卸载清理通过），不证明全部地区、设备或自然交易所故障。 |
| 5 | 实际部署和 rollback | candidate/previous 制品、实际切换、CDN/browser cache 和数据恢复证据 | 用户要求暂不考虑，移出本阶段，不算通过 |
| 6 | 工作区组件/交互对标与本地布局适配（原 10+14） | 完整 Backtest Workspace 的功能、交互、图标和组件风格对标，本地可用区域下无非预期遮挡/裁切且入口可达；不要求 AI/banner 或整页逐像素重合 | 部分组件和交互已有证据，完整模块/状态对照仍开放。含 Dock/Header、四 Tab、Calendar、Settings/Simulation 弹窗、图表联动、星标同步、滚动恢复和错误恢复，不能缩成四张默认页面 |
| 7 | K 线缺失合并 P1（DATA-11） | 任意周期最新 2,000 + 视口、主动分页、失败不误标覆盖、小缺口与两引擎完整性门控 | **已冻结范围通过**：窗口、缓存、接缝、Retry、精度不足、真实行情、手势与当前生产 smoke 已验；代表代理静默已补证。后续影响此合同的改动继续回归；不挂靠整个 ENGINE-03 或无限地区观测。 |
| 8 | 启动加载性能（P2） | 默认深度、首次绘制、Provider 初始化和错误降级有可重跑基线 | 真实缓存和完整报告冷3+prime1+warm3已验，冷/热报告中位数1296/927ms。追加受控80次ABBA渐进预算通过：首绘median改善40.33%，完整报告/暖路径/内存未越原10%上限，完整结果一致；独立资源对照空图JS gzip减少44.05%、SMA减少17.50%，达到≥15%目标。应用长时资源另由 REL-06 的冻结生产构建两小时合同覆盖；不以少量网络样本宣称跨设备 p95。 |

Safari 专项、Replay、真实线上部署/rollback/CDN 及手机端适配/手机实机触摸本阶段暂缓；桌面 VoiceOver 仍未验收，缺环境时记录具体阻塞。自建脚本长期持久化只待讨论。
原始行情、截图、认证状态及执行日志不加入 Git；只提交业务代码、可重跑测试和必要状态文档。
以下历史测试总数和旧分支运行记录仅说明当时验证，不作为本轮通过依据。

### 2026-10-06～07 证据与边界（各项按实际运行时点使用）

- 较早风险/UI 批次根测试 616/616、Vela-PineTS 310/310、PineTS offline 1,773 passed/1 skipped；低周期/分页/周期切换专项、未知资产 fallback/币种显示和 0% margin 边界均有定向通过。最新 UI 批次根 627/627、类型/构建、开发/生产主 E2E 和生产 32 状态检查通过；各项源码时点与局限见需求表，不把旧引擎数字称为本次重跑。PineTS 全仓联网测试另有网络依赖失败，不记为离线全仓通过。
- 本轮 fresh build、类型检查、Vela-PineTS 全包 lint 与开发 E2E 通过；最新生产主 E2E 已重新执行通过；六组触摸模拟与旧 visual gate 保留各自时点。新增生产主入口可访问性 32 状态/34 交互通过，SVG 对比度 incomplete 与真机另验。原有 runtime 三处多余类型断言已移除。
- 生产预览无 fixture 实测请求 Binance.US 两页共 2,000 根 BTCUSDT/15m；12 次采样 KPI 账本完整，页面错误为 0，多空分项与 Outperformance 均可复算。
- 当前参考数据为 2026-10-06 新采集的 279 closed + 1 open；不能把它描述成旧窗口缺失的 227 行已补齐。完整新样本已重新用最终构建的本地引擎对账。
- 参考 Viewer 仍有将 open 计入胜率分母、open Exit epoch、已实现与 MTM 口径差异。保留 R-08 和 open-state 修复；这些显示差异不能假装已达成一比一。
- Performance 同宿主边界实测：四个 Tab、三个图表、摘要卡和 KPI 栏的 36 个几何字段误差不超过 0.02 CSS px。该证据不覆盖所有页面、主题、viewport 或数值语义。
- 长测 runner 新增 15 秒落盘心跳、失败终态、同一订阅内周期性断网、真实 WebSocket candle-frame 和 teardown 证据；CI 保存短期 artifact，不把行情或审计附件加入 Git。
- 本地部署 smoke 的空壳/未挂载误报和参考站子域漏检已修复，5 个浏览器反例测试通过。此项只加固测试工具，不代表用户已暂缓的真实部署/rollback 验收通过。
- 修复 Provider 断网期间的缓存重发布：Vela 在 offline 撤销 live lease 时可能对缓存 K 线发出 `tick/history`；适配层现在保留已有 settled ledger，拒绝该类离线 replay 的 revision、曲线和指标更新，初次无账本加载与联网后的新 tick 仍正常。PineEngine/PineWorkerEngine 真实 Hyperliquid Workspace 3 周期共 6/6 通过，offline 前后 revision/status/trades 不变，恢复后各建立一个新 socket 且无迟到 callback。
- watchdog 版本 Hyperliquid 90 秒真实 soak 已通过（84 callbacks、最大间隔 3,974ms、2 次 offline→online、3 个 socket 平衡清理、offline/late callback/cleanup error 为 0）；随后两小时真实长测通过（7,200.133 秒、8,617 callbacks、最大间隔 8,649ms、23 次恢复、24 sockets 平衡清理、active=0、offline/late/cleanup error 为 0）。该证据仅关闭 Hyperliquid 本机 scope；若上游网络在 Binance 路由受限，仍保持 all-provider gate fail-closed。
- Provider 重连资源复核（2026-10-06）：PineEngine/PineWorkerEngine 各 3 周期均在每周期强制 CDP GC 后保持固定的 JSEventListeners（987/990）与节点数（1698），destroy 后降至 721；与 fixed-3 基线一致，未确认已关闭 WebSocket handler 泄漏。长测中未强制 GC 的 Performance 指标不能单独作为泄漏证据；资源稳定性仍需纳入长时终态结果。
- Performance/Analysis/Simulation 移动与桌面几何按参考站最新 DOM 校准；视觉/a11y 门禁重新通过，触摸矩阵、开发/生产 E2E、三浏览器 fixture 也通过。全状态、主题和组件风格/交互的完整对照仍开放；按最新用户标准适配本项目布局。
- 本机原始参考证据、截图和长测状态分别位于忽略目录 `audit-evidence/p1-final-gates-20261006/reference/`、`audit-evidence/2026-10-06-p1-matching/`、`audit-evidence/2026-10-06-p1-live-app/`、`audit-evidence/2026-10-06-p1-hyperliquid-watchdog12-two-hour/`；它们不随 Git 提交。

本文件记录从 `master` 已通过的本地启动优化继续收敛 Final Gate 的范围、证据和边界。它不把本地 fixture 或 Playwright 模拟结果写成线上验收结论。

## 已推进

- Provider live：`offline` 会撤销当前 socket lease，`online` 重新建立订阅；live lease 安装即启动首帧 watchdog，之后每根 candle 重置计时，12 秒静默会撤销 lease 并重新订阅；generation token 阻止迟到旧 socket 回写。覆盖 Binance、Hyperliquid、首帧永不到达、重复断开、静默连接、销毁和失败后恢复。
- Bar Magnifier：新增独立 1H/10m golden，校验 lower-feed 覆盖、precision envelope、stop/limit 顺序、Entry/Exit、P&L、MAE/MFE 和无残留持仓。
- 触摸交互：新增 Chromium/Firefox/WebKit 的 `has_touch + tap()`，覆盖手机/平板、四个 Viewer Tab、Simulation 设置、返回图表和资源回收。
- 既有 release manifest 已覆盖 candidate/previous 同槽切换、制品篡改拒绝和 Storage reconciliation；新增缓存 smoke 校验入口 HTML 可重新验证、hash 资源 immutable 且回滚保留旧资源。不把本地模拟等同真实 CDN/线上回滚。
- Provider smoke 使用独立的无 HMR Vite 配置，避免 fork 构建或源文件变更触发测试页导航；已完成 Binance Spot/Futures、Hyperliquid 真实网络 10 轮历史与 live 验证。
- `vite preview` 已提供发布缓存契约：HTML 入口 `no-cache/no-store/must-revalidate`，带 hash 的静态资源 `immutable`；这只证明本地预览协议，线上 CDN 仍需部署实测。
- 本地回归门禁已补齐：等待服务测试在高负载下不再因 Node 子进程启动抖动误报；该批次根测试 616/616、Vela-PineTS 310/310，PineTS offline 1,773 passed/1 skipped，release 29/29，Provider recovery 本地验证通过，触摸 E2E 6/6，Bar Magnifier matching 68/68 通过。当前新增 UI 的验证另见需求表，不用该历史批次代替。

## 验证命令

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e:responsive
npm run test:pinets:golden
npm run test:release
npm run test:providers:long
# 本地 Final Gate 聚合门禁（不包含需要外部输入的 golden/线上设备）
npm run verify:final-gates:local
# 完整参考站 Trades Log 对账（两个输入都必须是完整导出）
REFERENCE_GOLDEN=/path/reference.json LOCAL_GOLDEN=/path/local.json npm run test:reference:golden
# 真实部署（必须提供外部地址；没有地址会以 not_run/exit 2 结束）
QUANT_DEPLOY_URL=https://<candidate-host> npm run test:e2e:deployment
# 可选：同时验证 previous/rollback 槽位
QUANT_DEPLOY_URL=https://<candidate-host> \
QUANT_PREVIOUS_URL=https://<previous-host> \
npm run test:e2e:deployment
```

## 当前未验项与后续范围

当前未验项不能仅靠历史截图或受控浏览器模拟关闭；暂缓/范围外项目单列，避免重新混入执行队列：

- 完整生产 Workspace 的两小时活动与资源稳定性已通过（本地 Chromium + 冻结生产构建）；Provider 两小时与代表 CONNECT 静默已通过，未测地区/设备仅作适用边界，不新增无限地区验收。
- 实际部署槽位、CDN/browser cache、真实 rollback 与缓存清理：按用户要求暂不考虑，不纳入当前 Final Gate；本地 preview/release 合同仍仅作为可选的离线验证。
- 当前 BTCUSDT/15m/SMA 固定窗口已通过；其它行情/脚本窗口 golden 属后续扩展，不是本期开放 Gate。
- 已列撮合语义继续按 TODO/TV 调研维护，完整 TV 外部逐 Fill golden 不作为当前关闭条件。
- 桌面 VoiceOver 仍需证据；Safari 专项按 SCOPE-03、手机布局和手机实机触摸按 SCOPE-07 暂缓，不标为通过。
- 完整 Backtest Workspace 功能、交互、图标和组件风格对标及本地布局适配仍开放；不再追逐整页像素重合。STARTUP-01 启动预算、完整历史/策略就绪计时及 DATA-11 K 线合并验收已通过各自合同，不用历史未验文字重开。
- PERF-01（原 PF-01～06、PF-09～10）的本期有限合同已通过：固定 Chromium DPR1 的 10k/100k 冷 selector p95 为 52.2/399.9ms，分页 41.4/42.2ms；range/多 series tooltip、Worker 取消和相应生产资源检查均已留证。Firefox 的 100k 聚合 656/589ms 与一次 10k 分页 124ms 超过 Chromium 对照值，100k report factory 约1.14s另计，不声称全浏览器/全设备同预算；这些观察不重新打开未约定的全设备 SLA。

当前未验项保留 `PARTIAL` 或说明具体阻塞；暂缓/范围外不标为通过，也不再用作当前发布阻塞。

### 2026-10-03 外部复核记录

- 参考站自动登录流程已再次执行，能够进入 Vela workspace 并采集移动端真实页面；但从 `app.luxalgo.com` 到 `vela.luxalgo.com` 的 RSC 导航受到浏览器 CORS/连接关闭影响，未获得完整 Trades Log，因此不能把本次运行升级为完整逐笔 golden 证据。
- 本机没有可无交互授权的实体 Safari/VoiceOver 运行条件；线上部署、CDN purge 和回滚按用户要求移出当前范围，不用 Playwright WebKit 或本地 preview 冒充线上证据。
- 新增 `npm run test:e2e:deployment` 作为真实地址驱动的入口：会检查 candidate/previous 的入口缓存头、hash 资源 `immutable`、页面错误和参考站请求；本地 preview 只用于验证脚本本身，不计入线上 Final Gate。
- 部署门禁现已 fail-closed：所有 HTML 引用的静态资源必须返回 HTTP 200，且 `QUANT_PREVIOUS_URL` 不能与 candidate 地址相同，避免错误槽位或同槽配置被误报为 rollback 通过。
- 新增 `npm run test:reference:golden`：完整导出的交易数组按 Trade #、方向、Entry/Exit 时间和价格、Size、P&L、MFE、MAE 逐字段比较；缺少输入、行数不等或任意字段不一致都会失败，半截参考站抓取不会被当成通过。Comparator 同时拒绝缺少/重复 Trade #、省略字段、非有限数值和无法归一化的数字；未平仓 Exit 允许显式 `null`，但不能省略。该工具仍只验证已提供的两份导出，不能替代真实参考站数据采集。
- 外部验证所需的地址、导出文件、真实设备和通过标准集中记录在 [EXTERNAL_FINAL_GATE_INPUTS.md](EXTERNAL_FINAL_GATE_INPUTS.md)。

- GitHub Actions workflow `37132010789`（2026-10-03）已完成一次 60 秒真实连续订阅：provider-soak 与 browser offline/online recovery 均成功，Binance、Binance Futures、Hyperliquid 均返回有效历史/live 数据；该结果提升了真实网络证据，但不等同于长时间（小时级）稳定性或跨区域故障恢复。
- 随后 workflow `37133498353` 的 600 秒尝试在启动阶段因 GitHub runner 到 Binance 的 `TypeError: Failed to fetch` 失败，未进入连续订阅阶段；该失败保留为真实网络 blocker，不能被解释为业务断线恢复通过。下一次长时验证必须在可访问交易所 API 的 runner/网络条件下重试。
- 最新 workflow `37134927725`（120 秒）在有限三次重试后仍为 `provider soak failed after 3 attempts: Failed to fetch`；重试机制本身已生效，但 runner 的上游网络不可用，长时门禁继续保持未通过。
- 本机真实网络复测（2026-10-03，`python3 tests/provider_smoke.py --duration-seconds 120 --recovery`）通过：Binance 61 callbacks、最大间隔 2,091ms；Hyperliquid 98 callbacks、最大间隔 6,022ms；两者均完成 offline→online recovery，且 Binance Futures history/metadata 可用。该结果是 120 秒单机证据，不替代小时级、跨区域或代理黑洞验证。
- 本轮复测（2026-10-03，`python3 tests/provider_smoke.py --rounds 10 --recovery`）通过：Binance Spot/Futures 与 Hyperliquid 每轮历史/live 均成功，10 轮均完成 offline→online recovery；这是连续轮次证据，不替代小时级、跨区域或代理黑洞验证。
- 远端 workflow `37144883619`（2026-10-03，HEAD `53eb4a6`）的 local-gates 全部通过；provider-soak 在首次真实请求阶段因 GitHub runner 对 Binance 返回 `TypeError: Failed to fetch`，未进入连续订阅，故该运行不计入长时 Final Gate 证据。
- 远端 workflow `37147134495`（2026-10-03，HEAD `f34a1c5`）的启动、撮合、golden、触摸阶段通过；视觉/a11y 步骤触发 15 分钟超时。复核发现视觉脚本把 Vite stdout 接到未读取的 PIPE，冷 runner 输出填满管道后会死锁；已改为临时日志文件并加入架构回归断言，待新 CI run 复核。
- 同一视觉门禁的后续 run `37148415893`（HEAD `ec6b205`）进一步暴露 Vite 自动依赖优化在冷 runner 上返回 504 `Outdated Optimize Dep`；性能/Provider 一次性 fixture 已禁用 `optimizeDeps` discovery，并加入架构回归断言；本地视觉/a11y 复跑通过，待下一次远端 run 复核。
- 远端 workflow `37148882921`（2026-10-03，HEAD `9cd2536`）已通过全部 local-gates：启动/仓库、复杂撮合、reference golden、触摸和视觉/a11y 均成功；Provider soak、真实 deployment 因未配置外部输入而分别跳过/not_run。
- 本轮在两个独立本地 preview 槽位（candidate/previous）执行 `test:e2e:deployment`，入口 no-cache、hash 资源 immutable、页面错误和槽位隔离均通过；这验证部署脚本与 preview 合同，不等同真实线上 CDN/rollback。
- 本机 10 分钟真实连续运行（2026-10-03，`python3 tests/provider_smoke.py --duration-seconds 600 --recovery`）通过：Binance 288 callbacks、最大间隔 6,061ms；Hyperliquid 383 callbacks、最大间隔 10,838ms；两者均完成 offline→online，offline 窗口 0 条旧数据、恢复后重新收到行情。该结果仍不替代跨区域代理黑洞、小时级多次故障和线上环境证据。
- 断网探针现额外断言 offline 窗口不得收到任何行情 callback，并输出 `offlineBars`；本地 recovery 回归结果为 Binance/Hyperliquid `offlineBars=0`。这只增强了断网语义的可观测性，不扩大外部验收范围。

> 2026-10-03 外部网络门禁补充：push 门禁已通过；手动 provider soak 的 fork 构建缺口已修复，但一次 60 秒真实网络运行在 Binance `Failed to fetch` 处失败，未被标记为通过。长时 WebSocket/断网恢复仍需可访问交易所 API 的连续运行证据。

> 2026-10-03 workflow `37150267544`（手动触发，`QUANT_PROVIDER_SMOKE_DURATION_SECONDS=7200`）：local-gates 通过；deployment 因未配置 `QUANT_DEPLOY_URL` 明确 `not_run`；provider-soak 在首次真实请求阶段经 3 次重试后仍为 `Failed to fetch`，未进入 WebSocket/断网恢复阶段。该运行不计入长时 Final Gate 通过证据。

> 历史更正记录：此前本机后台启动未形成持续运行证据，随后失败的是 5 秒探针；该历史记录不代表当前状态。2026-10-06 Hyperliquid watchdog scope 已取得完整 7200 秒终态，见本轮最新证据；Binance all-provider 仍受外部网络条件限制。
