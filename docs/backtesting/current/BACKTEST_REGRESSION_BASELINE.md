# 回测开发非回归基线

> **2026-10-01 当前独立复查**：见 [R-09 第三次复查](../reports/BACKTEST_R09_RECHECK_3_2026-10-01.md)、[R-08～R-11 复查报告](../reports/BACKTEST_R08_R11_RECHECK_2026-10-01.md) 及 [新证据](../../../audit-evidence/2026-10-01-r09-recheck-3/README.md)。当前工作树重新执行根测试 413/413、Vela-PineTS 283/283、构建、类型、依赖、主 E2E 和静态独立性检查；R-08/R-10/R-11 缺陷场景通过，R-09 三引擎 pointer-open 及主 E2E 通过。下方旧测试数量和旧失败仅作历史索引，不能替代新 Final Gate。

> **2026-09-30 动态深审（历史快照）**：综合结论见 [BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md](../reports/BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md)，动态证据见 [audit-evidence/2026-09-30-dynamic-deep/README.md](../../../audit-evidence/2026-09-30-dynamic-deep/README.md)。该轮记录 R-05/R-06/R-07 及 D-01；当前状态以本文件第一条 2026-10-01 指针和最新计划为准。

> **第四轮独立复查（2026-09-30，历史快照）**：以 [BACKTEST_AUDIT_RECHECK_4_2026-09-30.md](../reports/BACKTEST_AUDIT_RECHECK_4_2026-09-30.md) 和 [第四轮证据](../../../audit-evidence/2026-09-30-recheck-4/README.md) 为准；当前源状态以本文件第一条动态深审指针为准。

> **此前独立复查（历史快照）**：见 [BACKTEST_AUDIT_RECHECK_4_2026-09-30.md](../reports/BACKTEST_AUDIT_RECHECK_4_2026-09-30.md)。其 R-06/R-07 边界已在当前工作树重新 probe。

> 第二、三轮修复记录曾报告 S-01～S-03、U-01 及 R-05～R-07 的对应场景通过，详见 [第二轮修复记录](../reports/BACKTEST_RECHECK_2_REMEDIATION_2026-09-30.md) 和 [第三轮修复记录](../reports/BACKTEST_RECHECK_3_REMEDIATION_2026-09-30.md)；第四轮复查重新发现 R-06/R-07 的适配器边界，因此“空行情缓存边界已修复”不作为当前结论。以下独立审计摘要及测试数字均保留为历史记录，Final Gate 仍开放。

> 第二轮独立修复复核（2026-09-30，历史快照）见 [BACKTEST_AUDIT_RECHECK_2_2026-09-30.md](../reports/BACKTEST_AUDIT_RECHECK_2_2026-09-30.md)。R/O 原场景已通过当时的新验证；当前状态以顶部第四轮复查为准，不能宣称全部 Final Gate 通过。
> 建立日期：2026-09-25
> 当前审计 HEAD：`53ab05795f45e5440eba1c1513b3bb63a659b9ae`
> 回测接入前应用基线：`89f277e82f71d9e6c3d0dfc66b0ed1aef44e2c7a`
> 分支：`feature/backtest-workspace-build`
> Node：`v24.15.0`
> npm：`11.13.0`

这份基线用于回测工作区每个实现 Gate 的回归对账。这里的“基线”是回测代码接入前的既有行为；当前工作树的验证结果单独记录，不能用新增回测测试抵消旧功能回归。回测新增功能不能以“新测试通过”为由跳过既有功能验证；任何未解释的旧行为变化都阻止合并。

> 文档中的早期 G4/G6/G8 小节保留为历史过程记录。最新状态以顶部 2026-09-30 recheck 为准；下方旧通过/失败均须按当时对象解读，不得替代新证据。

## 2026-09-29 独立审计复核（修复前历史快照）

本节只记录独立报告的边界。用户已明确此前测试集、fixture 和测试结论不能作为本轮证据；下方旧命令的历史数字继续保留以便追溯，但不构成 PASS 或发布 Gate。独立新建的服务探针、输入、实际结果和 F-01～F-10 详见 [`BACKTEST_INDEPENDENT_AUDIT_2026-09-29.md`](../reports/BACKTEST_INDEPENDENT_AUDIT_2026-09-29.md)。

- 新启动 dev `127.0.0.1:5181`：Workspace 真实入口、15m→1h、UTC→Los Angeles、2×2、Pine Editor、策略运行和 Viewer 四页可操作；新启动 production preview `127.0.0.1:5182` 返回 HTTP 200。
- 独立 `Both Independent` Settings 输入同时修改 Length/Precision，一次 Apply 观察到两个 Worker `update` 和两次 `script:run`；独立 adapter/domain probe 复现 revision 混用、context rejection 静默、嵌套快照/报告可变和 Trade # 负值边界。
- Binance 元数据/行情请求在本机浏览器发生 CORS/WebSocket/ERR_FAILED，真实 Provider 长链路保持 BLOCKED；不把网络环境结果冒充应用通过。
- Fork typecheck 仍失败于 `test/pine-worker-engine.test.ts:213` 的 `EngineAlert.type`；`npm run release:verify` 直接缺少必填 `--manifest`。这两项是独立命令观察，不被旧测试通过抵消。

## 已执行命令

### 2026-09-29 Summary 语义与 Provider 恢复修正（HEAD `9997294` + 未提交工作树）

- Summary/Dock 从逐 bar equity 改为按交易序号的累计已实现盈亏，Tooltip 独立从 Trade #1
  开始，保留方向、UTC exit time；24 bar 固定样本保留 24 个 exact equity 点作风险数据、
  Summary 仅 3 个交易点。移除 equity 兜底，避免缺少交易账本时绘制绝对账户值。
- 桌面 Performance 的 scroll/首卡起点按参考实时 DOM 对齐为 Viewer +107px；header/tabs
  显式 border-box，使独立 fixture 与真实 Workspace 的盒模型一致。参考截图与公式证据详见
  `BACKTEST_REFERENCE_EVIDENCE.md`，不是仅根据本地 screenshot 自设基线。
- Provider 保留 10s request deadline、30s index deadline；late response、一次后台重试及
  online 显式恢复通过公共 DataControl 重注册目录。永不结束的旧 attempt 可被新请求替代，
  旧 late response 不能覆盖新 index；destroy 移除 online 监听并拒绝迟到注册。
- `npm run test:regression:existing` → `npm test`：22/22 → 254/254。
- `npx tsc --noEmit --pretty false`、fresh Vite production build、`check:dependencies`、
  `check:dist:independence`：PASS。两个本地 Fork 本轮也完整构建通过；最后增量仅应用层。
- 单独运行真实 BTCUSDT fixture 页面，包括 3 个 Summary 点和鼠标悬浮 `Trade #3`/UTC：PASS。
  Highcharts 首次 pointer event 的 lazy search tree 初始化用后续真实 mousemove 验证，
  不使用截图文本或修改 chart 内部状态代替交互。

`historical_net_profit` 是否附加 current/open 尾点仍缺参考原始 payload，当前保守使用 closed
账本，不把此项或完整 TradingView/参考数值对账提升为 PASS。

该批次最终增量验证：

- `python3 tests/e2e_app.py --preview` → `python3 tests/e2e_app.py`：均 PASS；
  Production/Dev 的 blockedExternalRequests、luxalgoRequests 均为 0；Dev 全应用生命周期
  7/7，固定 fixture 销毁后 Chart/Observer=0/0，净收益保持 -1.6809529999998745。
- `python3 tests/visual_a11y_gate.py --update`（参考几何/交易曲线变更后人工检查本地截图）→
  无 `--update` 重跑：PASS；四 viewport 的 Dock/Performance 共 8 张本地 golden 像素差 0，
  axe/contrast/keyboard 通过。此处是本地回归基线，不冒充参考网站像素完全等价。
- `QUANT_PERF_ARTIFACT=1 python3 tests/backtest_performance.py --strict`：PASS；
  10k/100k 数据集、10k Simulation，原始结果与 trace 在
  `artifacts/backtest-performance-latest.json` 及同目录 zip；销毁后资源计数归零。
- `python3 tests/e2e_cross_browser.py`：Chromium/Firefox/WebKit 均 PASS，BTCUSDT/1h
  均 3 笔交易、净收益 -1.6809529999998745，页面错误/未知请求/销毁后 Chart/Observer 均为 0。
- 最新 production preview 已在 `127.0.0.1:4188` 启动并通过真实浏览器加载；人工验证入口为
  `http://127.0.0.1:4188/?chart=maximized`。该服务使用当前 `dist/`，不会引用参考站页面。

### 2026-09-29 设置弹窗隔离与参考几何续跑（未提交工作树，HEAD `9997294`）

修复 Inputs / Properties 同名 key 的默认值和条件可见性互相覆盖；仅 Properties 的
`use_bar_magnifier` 显示精度选择器，同名个人输入继续保留原始 checkbox。小数输入显式
使用 `step=any`。提交期间禁用字段，并以弹窗 session 隔离迟到的成功/失败响应，避免关闭
后重新打开另一策略时被旧请求关闭或显示旧错误；销毁后的响应和排队 focus 同样失效。

- `npm run test:regression:existing` → `npm test`：22/22、249/249（修复前后均依序重跑通过）。
- `python3 tests/e2e_strategy_settings.py`：PASS，真实 Chromium/Firefox/WebKit DOM 验证同名字段、精度控件
  作用域、小数输入、旧请求成功/失败、销毁期间请求返回；默认独立启动 Vite `127.0.0.1:4194`，
  可用 `QUANT_SETTINGS_BASE_URL` 复用开发服务，用 `QUANT_SETTINGS_BROWSER=firefox|webkit` 切换引擎，
  不构建或覆盖 dist。
- `npx tsc --noEmit --pretty false`：PASS。
- `python3 tests/e2e_app.py`：PASS，完整页面 mounts/destroys=7/7，
  blockedExternalRequests/luxalgoRequests=0/0；固定 BTCUSDT 24 根 K 线、3 笔交易，
  净收益 -1.6809529999998745，销毁后 Chart/Observer=0/0。
- `python3 tests/backtest_app_lifecycle_fault.py`：PASS；完整 dev 应用两轮初始化失败/
  ResizeObserver 失败后，Favorites/Pine editor 可操作，正常重新挂载仅一个回测宿主；
  mounts/destroys/noopDestroys=6/6/1。仅此故障路径通过，不据此关闭全部 HMR/VoiceOver Gate。
- 参考站 desktop Viewer 几何复核后移除本地滚动 panel 的重复 `margin-top:16px`；标题到
  Tabs 的 16px 壳层间距保留，Performance 首卡 `padding-top:0` 与卡内部约 32px 内容间距保留。
  `python3 tests/visual_a11y_gate.py --update` 后再以普通命令复核：四 viewport 截图、axe、
  对比度和键盘门禁均通过。

这里只关闭设置表单与异步生命周期的明确缺陷，不代表参考站逐笔/最终视觉、完整 Broker
语义、真实回滚或 VoiceOver Final Gate 已完成。Provider 子任务另行验证，不复用这里的结果。

### G4b.2 历史全 Gate 验证

| 命令 | 结果 | 证据摘要 |
| --- | --- | --- |
| `npm run test:regression:existing` | PASS | 原有回归集 18/18 tests passed（底层命令：`node --test tests/architecture.test.mjs tests/storage.test.mjs`） |
| `npm test` | PASS | 全量 103/103 tests passed；新增覆盖逐 K exact series、百分比单位边界、run restart、stale full recovery、同步 pending 与 full+tail 竞态 |
| `npm --workspace packages/vela-pinets run typecheck && ... test -- --run && ... lint` | PASS | 类型检查、lint 和 22 files / 214 tests 全部通过；显式 full/tail selector、in-process/Worker structured clone、报告身份和 O(1) summary 均在内 |
| `npm --workspace packages/pinets run test -- tests/namespaces/strategy --run` | PASS | Strategy 子系统 11 files / 50 tests 全部通过；其中 report series 5/5、streaming rollback 8/8 |
| `npm --workspace packages/pinets run test -- --run` | 外部阻塞 | 全仓执行期间 `api.binance.com` / `fapi.binance.com` 持续 connect timeout，既有联网用例批量超时后中止；未出现本批 Strategy/report-series 断言失败，不能记作全仓 PASS |
| `npm run check:dependencies` | PASS | 三个依赖的版本/来源/SHA 对账通过；执行指纹为 `quant-tools-g4b.2` / `reportSchemaVersion=2`，Vela-PineTS 内嵌 PineTS SHA、fingerprint 和 sentinel 一致 |
| `npm run build` | PASS | fresh 重建 PineTS、Vela-PineTS 内联 Worker、TypeScript 与 Vite 成功；主 JS 3,480.63 kB（gzip 937.42 kB），Highcharts 本地 chunk 278.26 kB（gzip 102.67 kB）；CSS 39.21 kB（gzip 7.09 kB） |
| `npm run test:e2e` | PASS | 开发模式 E2E 通过；除既有功能与回测组合 smoke 外，SMA Cross 的可见 Performance 曲线强制为 `exact-equity`；离线守卫 `blockedExternalRequests=0`、`luxalgoRequests=0`，Viewer storage 写入/删除/清空均为 `0`、生命周期 `mounts=6/destroys=6/noopDestroys=1` |
| `npm run test:providers` | PASS | Binance `historyBars=5/live=true`；Hyperliquid `historyBars=5/live=true` |
| `npm run test:e2e:prod` | PASS | 生产 Preview E2E 通过；包含上述既有功能、回测 smoke 与真实 `exact-equity` 曲线断言；离线守卫 `blockedExternalRequests=0`、`luxalgoRequests=0`，Viewer storage 写入/删除/清空均为 `0`（生产模式不运行 lifecycle fixture） |

相对回测接入前记录（JS 3,316.00 kB / gzip 891.80 kB，CSS 13.24 kB），G4b.2 历史构建增加主 JS 164.63 kB、gzip 45.62 kB、CSS 25.97 kB；Highcharts 已拆为本地按需 chunk。该差异已记录但尚未等同于性能 Gate 通过；后续仍需按计划建立明确 bundle/首屏/交互预算，并通过运行时测量判断是否需要收缩。

以上数字来自包含机器可读 Fork fingerprint 与逐 K exact-series 桥接的 G4b.2 fresh build。该历史构建中的 `@luxalgo/vela-pinets` 公开常量、两份 `fork-build-info.json`、源码常量和依赖基线已完成逐字段对账；应用产物、Vela-PineTS ESM/CJS/global 及其内联 Worker 均包含当时组合 sentinel，PineTS 四种产物包含本地 PineTS sentinel。构建尺寸不是身份指纹，发布对账仍以完整 fingerprint/SHA/schema/sentinel 契约为准。

PineTS Rollup 仍报告上游既有的 array 循环依赖和 `astring` 不可达 default fallback 静态警告；`astring@1.9.0` 实际 `baseGenerator` 导出可用，四种 bundle 与声明均成功生成。本轮没有借 fingerprint 改造顺带修改 transpiler 兼容分支。

G4b.2 当时已在 Full Access 环境下重新执行开发/生产 E2E 与 Provider smoke 并通过；早期受限沙箱的 `listen EPERM` 不再作为该阶段证据或例外。

### G4b.3 增量验证

| 命令 | 结果 | 证据摘要 |
| --- | --- | --- |
| `npm run test:regression:existing` | PASS | 原有回归集保持 18/18 |
| `npm test` | PASS | 根全量 191/191；新增覆盖账户币种、All/Long/Short 最大持仓、逐笔 Entry/Exit bar index 和 capability 降级边界 |
| adapter/controller/domain 定向测试 | PASS | 66/66；覆盖 snake_case/camelCase 映射、UI report 字段、ready/current-revision ledger、非法或过期 index 拒绝 |
| `npm --workspace packages/vela-pinets run test -- --run` | PASS | 26 files / 228 tests |
| Vela-PineTS G4b.3 定向测试 | PASS | 3 files / 38 tests；覆盖 context、empty-run suppression 和 strategy trades 桥接 |
| `npm --workspace packages/pinets run test -- tests/namespaces/strategy --run` | PASS | Pine strategy 子系统 15 files / 70 tests；不能替代 PineTS 全仓联网结果 |
| Vela-PineTS typecheck / lint | PASS | Vela-PineTS 类型检查与 lint 均通过 |
| `npx tsc --noEmit` | PASS | 根应用 TypeScript 检查通过 |
| `npm run check:dependencies` | PASS | G4b.3 历史记录；当前工作树 G8.1 fingerprint/schema 见下方 Full Access 增量，`reportSeries/reportTail` envelope 独立保持 `schemaVersion=1` |
| `npm run build` | PASS | 已在 G4b.3 revision 上 fresh 重建；G4b.2 构建尺寸只保留为历史记录 |
| `npm run test:e2e` / `npm run test:e2e:prod` | PASS | G4b.3 开发与生产 Preview E2E 均通过 |
| `npm run test:providers` | PASS | G4b.3 Binance/Hyperliquid Provider smoke 通过 |
| `npm --workspace packages/pinets run test -- --run` | 未记为 PASS | PineTS 全仓联网套件当前没有 G4b.3 PASS；不把历史 timeout 或 strategy 67/67 转记为全仓 PASS |

当前依赖契约完整 fingerprint 为：

```text
@luxalgo/vela-pinets@0.2.13|upstream=a2a2097be8f30b4b596b13212ed4608c36c2ea26|patch=quant-tools-g8.1|pinets=beacd587e83aa7ee061023f8cea66b2e887d5676|schema=4|engine=pinets@0.9.34|upstream=beacd587e83aa7ee061023f8cea66b2e887d5676|patch=quant-tools-g8.1|schema=4
```

因此 G4b.3 记录应视为历史阶段证据；当前工作树的 G8.1 状态见文末 Full Access 增量。PineTS 全仓联网、参考站最终数值对账及完整视觉/性能 Final Gate 仍开放；固定 BTCUSDT 本地/registry 对账已通过，G4b.2/G4b.3 的产物尺寸和旧验证数据继续明确标注为历史证据。

### G6 Trades Log 列表对标增量验证

本次增量调整 Viewer 的 Trades Log 列表投影、局部样式、纯排序/格式化函数，以及 Controller 从领域交易生成参考 Trade # 的 UI 映射；没有修改 PineTS、Vela-PineTS、Provider、Storage schema、Calendar 聚合或策略成交语义。条件 Size/MFE/MAE 列、全列排序、`Summary 非零已平仓人口 - exit rank` Trade #、方向 badge、UTC 双行 Entry/Exit、价格/币种、excursion tooltip 与 MAE 显示、Crosshair 定位入口及 open-exit presentation sentinel 均以当前线上 chunk 和动态 DOM 证据为准。

| 命令 | 结果 | 证据摘要 |
| --- | --- | --- |
| `npm run test:regression:existing` | PASS | 原有架构、Storage、收藏、模板和旧快照恢复保持 18/18 |
| `npm test` | PASS | 根全量 191/191；新增 Trades Log 排序、条件列、参考 Trade #、专用数值/价格精度、excursion、定位 timestamp 和源码/UI 合同覆盖 |
| `npx tsc --noEmit` / `npm run check:dependencies` / `git diff --check` | PASS（G6 历史） | 根类型、三个本地依赖及 `quant-tools-g4b.3/schema=3` 指纹、补丁格式均通过 |
| Pine strategy / Vela-PineTS | PASS（G6 历史） | Pine strategy 15 files / 67 tests；Vela-PineTS 26 files / 227 tests，桥接结果未回归；当前 G8.1 定向为 21 files / 121 tests、Vela-PineTS 27 files / 261 tests |
| `npm run build` | PASS | 完整 prebuild 重建两个本地 Fork 后，TypeScript 与 Vite 250 modules 构建通过；仅保留既有上游静态警告和 bundle-size 提示 |
| `npm run test:e2e` / `npm run test:e2e:prod` | PASS | 开发与生产 DOM E2E 新增表头顺序、默认/切换排序、badge、双行 Entry/Exit、Crosshair 和 MFE/MAE tooltip 断言；旧工具栏、指标、编辑器、脚本、模板、截图和生命周期组合 smoke 继续通过 |
| E2E 独立运行/Storage 守卫 | PASS | dev/prod 均为 `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer storage writes/removes/clears=`0/0/0`；dev lifecycle 保持 `6/6/1` |
| `npm run test:providers` | PASS | Binance/Hyperliquid 均为 `historyBars=5/live=true` |

这组结果证明当前列表增量没有给已实现功能带来已检测到的非预期影响，但不把 G6 或项目 Final Gate 提前标记为完成。参考站逐笔数值、完整截图差分、虚拟列表/大数据性能、精确 marker 高亮及 reversal/partial-close/pyramiding fixture 仍需按计划完成；Calendar 后续增量见下节。

### G6 Trades Calendar 对标增量验证

本次增量依据 2026-09-26 当前线上 Calendar chunk 与动态 DOM 重新冻结日历合同。原先 Viewer 内的日期分桶、聚合和渲染已拆为领域日期桶、纯 Calendar selector 与独立 Calendar renderer；没有修改 PineTS/Vela-PineTS 成交、Provider、Storage schema 或 Simulation 人口。

- 已修复 `AVG TRADES PER DAY` 错除以自然月天数的问题，现与参考一致按有成交日期数作为分母。
- 已补齐浏览器当前月初始化、`Move to current month`、前后月、完整无交易日期格、空月 `+0.00 CUR / 0.00 / —`、整数 `% win`、locale Best/Worst 日期及账户币种分层显示。
- 领域日期桶现在统一由 `calendarDateParts/calendarDateKey` 实现，Performance 的 daily/weekly/weekday 与 Calendar 共用同一时区解析；open/epoch sentinel、非法时间和未知 P&L 不会被伪造成 1970/零收益交易日，真实 breakeven 日保持中性色。
- 新增纯函数 fixture 覆盖 UTC、America/Los_Angeles DST、Asia/Tokyo 正时区跨月、非法 timezone 回退、数字字符串时间戳、epoch sentinel、闰年、跨年月份移动、同日多笔、unknown P&L、零收益与 Best/Worst tie、活跃日均值和空月。
- Calendar 聚合按 report revision、不可变 ledger 身份和 timezone 在 Viewer 内单次缓存，Intl formatter 按 timezone 复用；月导航及同 revision 的收藏/Simulation 投影复用 ledger 身份，不再重复扫描整本 ledger，真正替换 ledger 时仍会失效。同一 run 的 live revision 只使聚合缓存失效，不再把用户选中的月份跳回当前月；同一策略开始新 `runId` 时则回到当前月。内部 View Mode 与顶层 report tabs 使用稳定 tabpanel 关系，报告更新和月导航重绘后恢复焦点，Calendar grid 补齐 `row/gridcell` 语义；金额/币种在 `1024px` 以下分行，`767px` 以下使用 760px 横向滚动画布。
- 当前根全量为 `191/191`，原有回归 `18/18`，TypeScript、dependency contract、fresh production build、Provider smoke 与开发/生产 E2E 均通过。E2E 将浏览器和行情时钟固定在运行当月 15 日，原子检查当前月标题、7 个 weekday、28–31 个日期格、非空日 P&L/交易数/整数胜率、四个汇总字段的精确反算、前后月/当前月结果与焦点、账户币种和活跃日均值，并在 `1025/1024/901/900/768/767/700/641/640 × 900` 边界用 `+999,999.99` 探针断言日期格无横向溢出；独立运行守卫仍为 `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer Storage `0/0/0`，开发态 lifecycle `6/6/1`。

这证明 Calendar 当前实现与自动化验证范围已闭环，但 G6 仍因固定 BTCUSDT 最终数值/截图差分、Trade Log 虚拟化、精确 marker 高亮及复杂成交 fixture 未完成而保持开放。

### G6 Trades Analysis 对标增量验证

本次增量仅修改 Quant Tools 应用层的领域 selector、Controller/UI DTO、专用 Analysis View、
本地 Highcharts 适配与 scoped CSS；没有修改 PineTS、Vela-PineTS、Provider、Storage schema、
策略成交语义、Calendar 或 Simulation 人口。页面现在按参考合同固定为顶部 Histogram + Donut、
10 行 All/Long/Short 表、全宽 Duration vs P&L、9 行 duration 表，并移除旧版三张自创卡片。

- open/current 只在 Analysis selector 缺少显式 delta 时投影为 zero/breakeven；显式 delta 优先，
  canonical closed/open、Calendar 与 Simulation 保持不变。整页空态使用 canonical closed count，
  因而 open-only 为空、真实 breakeven-only 仍可展示。
- Duration scatter 严格使用 `duration_bars → timestamp/timeframe` 两级口径，不再错误混入
  inclusive bar index；表格 duration、UTC day/Sunday-week、duration-bar streak 与 OLS 均由纯
  selector 生成。参考真实 snake_case 时间字段已纳入。
- Histogram 使用零锚定精确 bins、首尾边界、bin-width tick/pointRange、两位小数刻度、圆角柱和
  Strategy aggregate 三条参考线；aggregate 缺失时线值为 0，不拿表格交易均值冒充。
- Donut 仅有 Winners/Losers/可选 Breakevens；Duration 使用一个逐点红绿着色的 circle scatter
  series 与一个不进图例的 trend series。Highcharts 仍来自本地按需 chunk，保留同步 SVG fallback、
  generation guard、destroy/ResizeObserver 和手工 SVG a11y 描述。

| 命令 | 结果 | 证据摘要 |
| --- | --- | --- |
| `npm run test:regression:existing` | PASS | 原有架构、Storage、收藏、模板和旧快照恢复保持 18/18 |
| `npm test` | PASS | 根全量覆盖 Analysis 公式、极端人口、Controller 映射、View/Highcharts 合同及全部既有测试 |
| `npx tsc --noEmit` / `npm run check:dependencies` / `git diff --check` | PASS（G6 历史） | 根类型、三个本地依赖与 `quant-tools-g4b.3/schema=3` 身份、补丁格式均通过 |
| `npm run build` | PASS | fresh 重建两个本地 Fork 与应用；Highcharts 保持独立本地 chunk，仅有既存上游静态/bundle-size warning |
| `npm run test:e2e` / `npm run test:e2e:prod` | PASS | 真实 DOM 固定验证 10/9 行及顺序、三类图表、单 scatter+trend、donut 无 Current、SVG a11y、Tab teardown/re-entry；原有功能组合 smoke 同时通过 |
| E2E 独立运行/Storage 守卫 | PASS | dev/prod 均为 `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer storage writes/removes/clears=`0/0/0`；dev lifecycle 保持 `6/6/1` |
| `npm run test:providers` | PASS | Binance/Hyperliquid 均为 `historyBars=5/live=true` |

1440×900、DPR 2 的 BTCUSDT/SMA Cross 手工运行验收确认三图升级、10+9 行、纵向滚动和无横向
溢出；这不是最终视觉 golden。G6 仍因固定参考数值/完整截图差分、Trade Log 虚拟化、精确
marker 高亮与复杂成交 fixture 未完成而保持开放；G9 的 a11y/视觉/性能 Final Gate 也没有提前完成。

### G7 Simulation 对标增量验证

本次增量只修改 Quant Tools 应用层的 Simulation 领域算法、Controller 投影与缓存、本地模块
Worker、Viewer/Highcharts 适配、scoped CSS 和测试；没有修改 PineTS、Vela-PineTS、Provider、
Storage schema 或策略成交语义。线上生产 chunk 已确认参考固定 seed 为 `12648430`，本项目据此
冻结 Mulberry32、Resample/Shuffle、Laplace variation、preserve win/loss、MAE-aware drawdown、
percentile/histogram、streak/recovery 和 512-point band 上限，不再使用运行时随机 seed。

- 默认 1,000 runs 同步计算，`>= 2,000` 使用本地模块 Worker；支持进度、取消、supersede、
  Worker 启动失败回退、structured-clone 后深层冻结，以及按交易人口隔离、每人口最多 8 项的
  有界 LRU core 缓存。USD/%、threshold 和 Histogram/Cumulative 只重新投影，不重跑核心模拟。
- pending/error 保留上一份成功结果；同人口 live revision 复用 Worker，人口变化才异步重启。
  Simulation 控件不触发 Pine 重跑、Provider 重订阅、WebSocket 或 Storage 写入。
- 页面覆盖 KPI、Simulated Paths、Outcome/Drawdown distribution、Streaks & Recovery、说明文案、
  tooltip、Retry，以及无已平仓交易和初始资金无效空态。Highcharts 与 More 均由本地 chunk
  加载，保留同步 SVG fallback；构建新增本地 `backtest-simulation.worker` chunk，不请求 CDN。
- 桌面 Modal 与移动 Drawer 已覆盖 modal 背景隔离、焦点陷阱、Worker 多次 progress 重绘后的
  同 key 焦点恢复、隐藏/inert/aria-hidden 节点过滤、`1023/1024px` 双向断点焦点回退和销毁清理。
- 最终视觉复核按参考源码移除 toolbar 错误的 `min-height:72px`，实测高度由 88px 收敛为 48px；
  help tooltip 增加视口碰撞校正，左边界保持 8px；KPI unit 保持参考的 `5 trades` 大小写。桌面
  Settings 为 448×332，移动 Drawer 为 390×742.7；这些尺寸已有浏览器断言，但项目级 golden
  截图差分仍保留给 G9。

| 命令 | 结果 | 证据摘要 |
| --- | --- | --- |
| `npm test` | PASS | 根全量 191/191；覆盖固定 PRNG/公式、1k/10k 性能与有界存储、Worker 取消/乱序/失败、Controller 缓存/投影、View/Highcharts、焦点和全部既有测试 |
| `npm run test:regression:existing` | PASS | 原有架构、Storage、收藏、模板和旧快照恢复保持 18/18 |
| `npx tsc --noEmit` / `npm run check:dependencies` / `git diff --check` | PASS（G7 历史） | 根类型、三个本地依赖与 `quant-tools-g4b.3/schema=3` 指纹、补丁格式均通过；本阶段没有产生 Fork 变更 |
| `npm run build` | PASS | fresh 重建两个本地 Fork 和应用；Vite 260 modules，Simulation Worker 4.37 kB，本地 Highcharts More 98.66 kB / Highcharts 277.74 kB；仅有既存上游静态与 bundle-size warning |
| `npm run test:e2e` / `npm run test:e2e:prod` | PASS | 开发与生产 Preview 覆盖真实 Viewer、2500-run Worker pending/progress/完成、设置重绘焦点、modal 隔离、响应式回退、空态、Retry/投影和既有功能组合 smoke |
| E2E 独立运行/副作用守卫 | PASS | dev/prod 均为 `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer Storage `0/0/0`；Simulation fixture 的 Pine/Provider/WebSocket/Storage 非预期副作用为 0，dev lifecycle 保持 `6/6/1` |
| `npm run test:providers` | PASS | Binance/Hyperliquid 均为 `historyBars=5/live=true` |

这组证据完成 G7 当前参考版本下的应用层闭环，并证明本增量没有给已覆盖的工具栏、指标、
编辑器、个人脚本、模板、Provider 和 Storage 行为带来非预期影响；它不把整个 Backtest 项目
标记为完成。G5/G6 的参考站最终数值与截图差分、G8 完整低周期/逐 Fill 撮合语义，以及 G9
的完整视觉、长时性能、资源计数和故障注入 Final Gate 仍保持开放。

## 当前证据状态

命令级回归证据已具备；参考站动态黑盒记录见 [`BACKTEST_REFERENCE_EVIDENCE.md`](../reports/BACKTEST_REFERENCE_EVIDENCE.md)。以下本项目 G0/集成证据尚未由本文件自动生成，在采集前不得将最终非回归 Gate 标记为完成：

- 浏览器名称/版本、viewport、DPR、locale、timezone 的固定记录。
- 工具栏/指标/编辑器/模板操作的 DOM 快照、点击次数和视觉差分产物。
- localStorage 全量快照、写入次数和旧快照恢复记录（当前已补 Viewer 前后 local/sessionStorage key/value 对账；全流程快照和旧快照迁移记录仍待补）。
- Provider 请求 URL/参数/订阅次数断言产物。
- create/destroy、HMR、cell/indicator 删除前后的 listener、Worker、Observer、Chart 和 DOM 计数（当前已补 lifecycle fixture 的 mount/destroy/no-op 计数；listener/Worker/Observer/Chart 计数仍待补）。
- 回测结果/Simulation/定位失败时的故障注入记录，及确认旧 Workspace 仍可用的 E2E 证据。

这些项目是后续每个实现 Gate 的必需补充，不得以“npm test/build 通过”替代。

### G0 审计补充（2026-09-26）

`tests/e2e_app.py` 现在在开发和生产 E2E 中自动执行以下可审计断言，并在命令输出打印不含用户数据的摘要：

- Context 级 request listener 对所有页面（主回归、legacy fixture，以及开发模式 lifecycle 页面）检查 `luxalgo.com` 及其子域；预期请求数严格为 `0`。Binance/Hyperliquid 仍由本地 route mock 提供，不把参考站作为数据或运行时依赖。
- Context 级 catch-all 离线守卫会阻断并记录所有未被本地页面或明确 mock 接管的 HTTP(S) 请求；主回归和生产 Preview 的 `blockedExternalRequests` 必须为 `0`。这比只检查 LuxAlgo 域更严格，可捕获 CDN、字体、远程 chunk 或其他隐性运行时依赖。
- 回测 Viewer 打开前保存 local/sessionStorage 的 key/value 快照；返回图表并等待持久化 debounce 后再次快照。除明确允许 Vela 工作区文档 key `quant-tools:workspace:v2` 外，其余 key/value 必须完全相同；同时 storage monkey-patch 的写入、删除、清空计数和 key 摘要必须证明 Viewer 未触碰非 workspace 存储。
- lifecycle fixture 暴露成功 `mounts`、实际 `destroys`、重复 destroy 的 `noopDestroys` 计数。当前固定流程要求 `6/6/1`，并继续保留可选回测构造失败、ResizeObserver 失败和重复销毁后的 DOM/工具栏断言。

本轮实际输出（值只包含计数和 key 名，不打印脚本源码、workspace 内容或账户信息）：

```text
dev:     blockedExternalRequests=0, luxalgoRequests=0, viewer writes/removes/clears=0/0/0, lifecycle mounts/destroys/noop=6/6/1
preview: blockedExternalRequests=0, luxalgoRequests=0, viewer writes/removes/clears=0/0/0
```

这些断言把“项目可独立运行”和“回测 Viewer 不污染既有持久化”从人工观察提升为可重复的 G0 证据；它们不替代后续对 DOM 快照、Provider 订阅次数、Worker/Observer/Chart 计数和故障注入覆盖的补齐。

## 本轮变更边界

领域模型、Vela 回测 Adapter、Controller 和 Dock/Viewer 壳已经通过 `createApp` 挂载，但仍保持独立的 Feature/生命周期边界，没有接管 `main.ts`、既有指标/编辑器/模板服务或 Provider 注册。G6 Trades Analysis、Trades Log 列表与 Calendar，以及 G7 Simulation 应用层增量，均已在 G4b.3 历史引擎身份上重跑开发和生产 E2E；当前 G8.1 身份已重新构建并补充低周期/性能证据。既有组合 smoke 覆盖“回测加入/打开 Viewer/切换四 Tab/Analysis 三图与两表/列表排序/List-Calendar 切换/Simulation Worker 与设置/移除策略”与工具栏、指标、脚本、模板、截图流程；Provider smoke 也通过。构造/ResizeObserver 故障注入、重复挂载计数、LuxAlgo 零请求、Viewer Storage 不变性和 Simulation Pine/Provider/WebSocket/Storage 零副作用已有自动断言；监听器/Worker/Observer/Chart 完整资源计数、全量 DOM/Storage 快照、HMR 和跨功能深度断言仍必须补齐，不能把核心 smoke 结果当作最终集成非回归结论。

当前状态明确分为三层：

- **G4b.3 隔离级 PASS（历史）**：根全量 `191/191`、原有回归 `18/18`、adapter/controller/domain 定向测试、Vela-PineTS `26 files / 227 tests`、Pine strategy `15 files / 67 tests`（含 `marketData/aggregation.test.ts` 的 strategy+aggregation 批次为 `16 files / 103 tests`）、两层 TypeScript、Vela-PineTS lint 和 dependency contract 已通过。
- **G4b.3 核心集成 smoke PASS**：fresh build、开发/生产 E2E 与 Binance/Hyperliquid Provider smoke 已在当前 revision 重跑并通过；G4b.2 对应结果继续保留为历史基线。
- **G7 应用层闭环 PASS**：根全量 `191/191`、原有回归 `18/18`、TypeScript、dependency contract、fresh build、开发/生产 E2E 和 Provider smoke 均在最终 Simulation revision 上通过；Worker、视觉几何、焦点、空态和零副作用证据见 G7 小节。
- **集成级部分完成、仍待补**：核心 E2E 已覆盖既有故障注入、重复 create/destroy、LuxAlgo 零请求和 Viewer storage 不变性；G8.1 已补固定 Chromium 性能/资源 artifact，但仍缺 PineTS 全仓联网、listener/Worker/Observer/Chart 的跨环境计数、全量 DOM/Storage 快照、HMR、Provider 订阅次数、参考站最终数值对账与完整跨浏览器视觉/性能 Gate。

### 报告指标与单位能力边界

- G4b.2 已提供带 `runId/snapshotRevision` 的逐 K close mark-to-market equity、close underwater、累计 intrabar max drawdown 与首次真实 fill 锚定的 benchmark。Adapter 只有在 identity、point count、bar index 及 time/bar 单调性全部校验通过时才开启 exact equity/drawdown/benchmark capability；不满足时仍回退到显式 `realized-ledger` 或 unavailable，绝不伪装为精确曲线。
- Vela-PineTS 默认 summary 只携带 O(1) 身份字段；完整 `reportSeries` 仅显式选择时复制，live tick 使用至多一个点的 `reportTail`。同 forming bar 尾点替换、新 K 追加；run restart、stale full response、同步 pending 和 full+tail 交错均已有回归保护。
- G4b.3 已接通 `account_currency` → UI report `currency`、`max_contracts_held_all/long/short` → 账户 All/Long/Short 最大持仓，以及逐笔 `entry_bar_index/exit_bar_index` → UI `entryBar/exitBar`。bar-index capability 只在 ledger ready 且属于当前 revision、所有必需 index 为非负 safe integer、closed trade 有 exit、`exit >= entry` 且 index 不超过当前 execution bar 时开启；新 live revision 不继承旧 ledger 的 exact capability。
- 持仓 bar 数按 TradingView/Pine 包含端点公式 `exitBarIndex - entryBarIndex + 1` 计算，同 bar 交易为 `1`；只有 exact `barIndices` capability 可用时才提供，否则保持 unavailable。
- CAGR、Sharpe、Sortino、drawdown/run-up 百分比和 Buy & Hold 标量继续按逐字段 availability 透传；曲线 capability 不会从单个标量推导。raw orders/fills、精确 reversal/parent relation、单一原子 order/fill/curve 报告包与完整低周期/逐 Fill 语义仍属后续项。
- G4b.3 新字段首先补齐数据合同；参考 UI 不存在 Currency、Max contracts 或 Bar index 的独立列/KPI，因此不得因字段可用而自行新增这些可见项。Entry/Exit bar index 用于既有图表定位交互。
- `Strategy Outperformance` 的单位合同已统一为账户币种金额：PineTS 与领域 fallback 都按 `strategy.netprofit - strategy.buy_and_hold_pnl`，与 `Buy and Hold PnL` 同单位；Viewer 使用报告实际 currency，不再套 `%` 格式。
- 最新 Performance 对标审计中，该字段在 All 的不可用值使用 ASCII `-`，不适用于 Long/Short 的单元格保持真正为空；样本仍没有提供可见单位的正值证据。因此上述金额口径来自当前 PineTS 引擎合同；仍需 G0 用参考站可用 benchmark 样本确认最终可见后缀和精度，若证据不同应拆成不同命名字段，而不是静默改单位。
- G4b.3 的机器可读身份 `quant-tools-g4b.3` / `reportSchemaVersion=3` 已通过历史 dependency contract、字段桥接、in-process/Worker 相关测试及 fresh build；当前身份已升级为 G8.1/schema 4（见 Full Access 增量），series envelope 自身的 `schemaVersion=1` 是独立 wire 版本。G4b.2/schema 2 的 fresh build 和 E2E 身份检查保留为历史证据；固定 BTCUSDT 本地/registry 逐笔对账已通过，参考站数值差异与复杂成交 fixture 仍是独立未完成项。

## 现有功能不变性

回测开发前后必须继续验证：

- 顶部工具栏按钮只注册一份，Indicators、Favorites、Templates、Screenshot、Pine Editor 入口和原有绘图工具仍可用。
- 指标管理的类别顺序保持 `On chart → Favorites → My indicators → Built-ins`；原生/个人指标添加、删除、星标、源码入口和搜索行为保持一致。
- Pine 编辑器打开、编辑、运行、保存、删除、错误显示和返回图表保持一致。
- `quant-tools:workspace:v2`、个人脚本、编辑器草稿、收藏和模板的旧 localStorage 数据可恢复；回测只使用独立版本化偏好 key，不写入计算结果。
- Workspace 模板保存/加载、Cell 级外部指标恢复、截图下载和图表最大化状态保持一致。
- Binance/Hyperliquid Provider 的历史 OHLCV 映射、实时订阅、请求形状和连接能力保持一致。
- `createApp → destroy → createApp`、HMR、Cell/指标删除不会产生重复 DOM、监听器、Worker、Observer、策略运行、Provider 订阅、Toast 或 Storage 写入。
- 回测区域、结果适配器、Simulation Worker 或图表定位失败时，Workspace、工具栏、指标、编辑器和模板仍可正常使用。

## 基线产物

- 既有生产截图：[artifacts/quant-tools-production.png](../../../artifacts/quant-tools-production.png)
- 既有自动化回归：[tests/e2e_app.py](../../../tests/e2e_app.py)
- 存储/架构回归：[tests/storage.test.mjs](../../../tests/storage.test.mjs)、[tests/architecture.test.mjs](../../../tests/architecture.test.mjs)

回测实现新增的字段、截图、请求和事件断言必须附加在本基线之后，不得删除或放宽上述现有断言。若实现确实需要改变现有行为，必须先更新本文件写明原因、影响范围、迁移/兼容策略和新的可验证证据，再进入对应 Gate。

## 当前批次补充证据（2026-09-27）

本批次补入了固定 Binance `BTCUSDT · 1h` 的应用层浏览器 fixture。页面只加载仓库内的 24
根 OHLCV、固定 Pine 源码和本地 `PineEngine`，再经 `BacktestController → BacktestWorkbench`
渲染四个结果页；不访问 Binance、LuxAlgo 或其它外部资源。

| 命令/证据 | 结果 | 关键输出或边界 |
| --- | --- | --- |
| `npm run test:fixture:btcusdt` | PASS | 2/2；canonical fixture SHA256 `29b1d15777827e46b47a7386aa368f0389252b16565f58b3b19805c363e39cd1`；strategy SHA256 `e3e6260620a19b4c5941a039a358ea398462cdf5fbbe861847e0eeadc69f98bc`；report series SHA256 `5fb737328cc2efe83c5e4c9f2a036c4beb40e0f5a18f29e9658be15068c5aeae`；与离线 `pinets@0.9.34` registry baseline 的 3 笔交易、summary 和 24 点 report 对账通过 |
| `npm run test:e2e` | PASS | 本轮主回归 `blockedExternalRequests=0`、`luxalgoRequests=0`、`marketRequests=157`、Viewer Storage `0/0/0`、dev lifecycle `7/7/1`；新增 BTC fixture 为 24 bars/24 report points、3 trades、Performance exact-equity、Analysis 10+9 行、Log 3 行、Simulation 可见，外部请求/Storage 写入均为 0 |
| `python3 tests/e2e_app.py --preview` | PASS | production app smoke `blockedExternalRequests=0`、`luxalgoRequests=0`、`marketRequests=66`、Viewer Storage `0/0/0`；engine-backed fixture 只在 dev runner 执行，因为 preview 仅发布 `dist/`，不会把测试页及 workspace source 当成生产运行时依赖 |
| `npm run test:regression:existing` / `npm test` | PASS | 原有回归 `18/18`；根全量 `191/191` |
| `npx tsc --noEmit --pretty false` / `npm run check:dependencies` / `git diff --check` | PASS | 根类型、workspace fingerprint/sentinel、补丁格式均通过 |

本批次还修复了两个验证层问题：固定 fixture 元数据加固后同步更新 canonical hash，避免错误
基线误报；主回归在策略设置提交后的短暂 updating revision 中读取 Analysis donut 时增加了
“closed-ledger projection ready”等待，避免把合法的瞬时空 DOM 当作功能失败。该等待不放宽最终
断言，仍要求 winners/losers、10+9 行表和三图全部出现。

本批次的长时 Viewer/Dock 资源循环还捕获并修复了一个真实的 Highcharts More 生命周期竞态：
Simulation 首次加载本地 `arearange` 模块后，已销毁 Viewer 的排队 `ResizeObserver` 回调可能对
普通 Dock 轴执行 `reflow()`，触发 Highcharts More 的 `pane.hasSeriesType` 异常。渲染器现在将
ResizeObserver 回调绑定到 host generation/live chart record、在回调内防御 `reflow()`，并明确
将笛卡尔轴的 `minorTicks` 设为 `false`；这样既不会吞掉真正的 SVG fallback，也不会让异常泄漏
到 Workspace。修复后的开发 E2E 以 10 次 `open → Simulation → close` 循环验证：
`activeCharts`/`activeObservers` 在每次关闭回到 Dock 基线 `1/1`，最终销毁为 `0/0`，页面错误为
零，且既有请求、Storage 和 lifecycle 审计保持不变。

逐项对标矩阵见 [`BACKTEST_PARITY_MATRIX.md`](BACKTEST_PARITY_MATRIX.md)。矩阵明确保留
`PARTIAL/BLOCKED/NOT STARTED` 项，不将本批次局部 PASS 误写成最终一比一完成；完整低周期/逐 Fill、
raw fills/复杂成交、完整视觉/a11y/性能、HMR/资源计数和 rollback 仍按计划开放。

### 2026-09-27 ledger boundary audit

`BACKTEST_LEDGER_AUDIT.md` 对 PineTS 内部 broker、Vela-PineTS snapshot 和应用 adapter 做了只读审计。结论是当前公开结果为 round-trip `StrategyTrade[]`；`rawOrders`/`rawFills`、partial-fill event、parent/reversal relation 仍未形成稳定 DTO，因此能力声明继续为 `false`，不得从 marker、pending queue 或 trade rows 推断原始事件。定向验证通过：PineTS strategy 3 files / 14 tests，Vela-PineTS strategy/context 2 files / 29 tests。
### 性能 Gate 增量（2026-09-27）

本批次补齐了大账本/大曲线的代码级边界，但不提前宣称浏览器性能 Final Gate：

- `Trades Log` 超过 200 行时采用稳定分页，单页最多插入 200 个交易行；排序结果按 ledger 引用和排序键缓存，翻页不会重复 O(n log n) 排序。
- 曲线 render series 上限 2,000 点；每个 bucket 保留低/高 extrema 与首尾点，完整 `tooltipPoints` 仍留在 renderer descriptor 中，Highcharts tooltip 通过二分 nearest raw point 取原始值。
- `tests/backtest-performance.test.mjs`：100k 点采样保留 spike/端点、raw tooltip nearest、100k trade sorting 和分页 source contract 通过；该单测批次的耗时仅作为当前机器记录，不作为跨机器 p95。
- `npm run benchmark:backtest` 已提供固定 1k/10k/100k trade-sort 与 chart-downsample 重复测量（7 次、首轮 warmup 丢弃），输出 Node/平台/CPU 及 p50/p95/max JSON；历史 Apple M5 / Node v24.15.0 的 100k sort p95 `5.585ms`、100k downsample p95 `0.442ms` 保留为代码级历史基线。这些是纯 selector/采样基准，不等价于浏览器 DOM/Highcharts/FPS/heap Gate。
- Highcharts renderer 增加 `getReportChartResourceStats()`，显式记录活动 Chart/ResizeObserver 并在销毁 finally 中回零；固定 Chromium 10 次 open/close、heap snapshot、Dock drag FPS 的采样随后由浏览器性能 Gate 补齐（见下节）。

因此 PF-02/PF-03/PF-06/PF-09 在 `BACKTEST_PARITY_MATRIX.md` 中由 NOT STARTED/BLOCKED 调整为 PARTIAL；固定设备 trace、浏览器滚动/tooltip 和长时资源 artifact 仍保持开放。

### 浏览器大数据性能 Gate 增量（2026-09-27）

新增 `tests/backtest_performance.py` 与 `tests/fixtures/backtest-performance.html`，在固定
Chromium、1440×900、DPR1 下真实挂载 Workbench，覆盖 10k/100k Trades Log、Dock/Viewer
曲线、Dock pointer drag、10 次 open→close 资源循环，并在同一浏览器中通过真实
`BacktestController`/Worker 执行 10k Simulation。运行命令：

```bash
QUANT_PERF_ARTIFACT=1 npm run test:e2e:performance
```

本机证据（Apple M5、Chromium `/Applications/Chromium.app/Contents/MacOS/Chromium`）如下：

| 样本 | DOM 行数 | 曲线 raw→render | 分页同步 p95 | Dock FPS / long-task p95 | 10 次循环 heap 增量 | Chart/Observer（循环后→销毁后） |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 10k trades | 200 | 10,000→2,000 | 38.4ms | 59.87 / 0ms | +0.36MiB | 1/1→0/0 |
| 100k trades | 200 | 100,000→2,000 | 40.6ms | 59.91 / 0ms | +0.42MiB | 1/1→0/0 |

真实 Simulation 10k（16-trade population）耗时 `129ms`，结果保留 `bandPoints=17`，
heap 增量 `+1.49MiB`，无页面错误。原始 Playwright trace 与 heap/资源 JSON 写入
`artifacts/backtest-performance-{10000,100000,simulation}.zip` 和
`artifacts/backtest-performance-latest.json`；后者为可审计摘要，不把单机数据冒充跨浏览器
保证。PF-02/03/04/05/06/09 的“本地固定 Chromium 性能证据”已具备；跨浏览器 fixture
smoke 已补齐，但生产发布生命周期和参考站视觉差分仍保持开放。

### 当前工作树回归复核（2026-09-27）

性能增量和本地视觉 gate 合入前再次复核，未修改参考站状态，也未把参考站作为运行时依赖：

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm test` | PASS | 根全量 `191/191`，包含性能、Viewer、Analysis、Simulation 和既有功能合同 |
| `npm run test:regression:existing` | PASS | 原有架构/Storage 回归 `18/18` |
| `npx tsc --noEmit --pretty false` / `git diff --check` | PASS | 类型与补丁格式均通过 |
| `npm run benchmark:backtest` | PASS（历史基线） | Apple M5/Node v24.15.0；100k sort p95 `5.585ms`，100k downsample p95 `0.442ms`；仅为代码级 benchmark |
| `npm run build` | PASS | 本地 PineTS/Vela-PineTS、TypeScript、Vite 全链路成功；仅有既有上游 circular/astring/bundle warning |
| `npm run test:e2e` | PASS | `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer Storage `0/0/0`、dev lifecycle `6/6/1`；BTC fixture 24 bars/3 trades |
| `npm run test:fixture:btcusdt` | PASS | 固定 fixture determinism `2/2`，canonical hashes 保持不变 |
| `npm run check:dependencies` | PASS | 三依赖 workspace/registry fingerprint 与当前 `quant-tools-g8.1/schema=4` 对账通过（G4b.3/schema=3 为历史身份） |
| `npm run test:visual:a11y` | PASS | 4 viewport、geometry golden、PNG diff、键盘 tab/Home/End、DOM ARIA 检查通过；仅输出已知 3.692:1 accent 对比度提示；基线说明见 [`BACKTEST_VISUAL_A11Y_BASELINE.md`](../reports/BACKTEST_VISUAL_A11Y_BASELINE.md) |
| `npm run check:dist:independence` | PASS | `dist/` 静态扫描 6 files / 4,059,904 bytes，reference host、Next chunk、auth/cookie/email 禁止项均为 0；规则见 [`BACKTEST_INDEPENDENCE_GATE.md`](BACKTEST_INDEPENDENCE_GATE.md) |
| `npm run test:e2e:prod` | PASS | 生产 Preview `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer Storage `0/0/0`；production lifecycle instrumentation 按设计为 `null` |
| `npm run test:providers` | PASS | Binance/Hyperliquid 各 `historyBars=5` 且 `live=true` |

完整 reference/candidate screenshot diff、axe/VoiceOver、生产发布生命周期和故障注入仍未
关闭对应 Final Gate；固定 Chromium 的 10 次 open/close heap、Dock drag FPS 与 10k Simulation
证据已记录于上节 artifact。跨浏览器 fixture smoke 的范围和限制见下方最新增量。

### Full Access 增量复核（2026-09-27）

本轮在完整文件/网络权限下重新执行了引擎边界、资源生命周期和独立产物检查：

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm --workspace packages/pinets run test -- --run tests/namespaces/strategy` | PASS | 当前 `21 files / 121 tests`，含 stop-limit 三项回归、Bar Magnifier 低周期/负向边界与未对齐聚合起点拒绝 |
| `npm --workspace packages/vela-pinets run test -- --run` | PASS | 当前 `27 files / 261 tests`，含 Worker session-scoped fetchSeries 与生命周期竞态 contract |
| `npm run test:fixture:btcusdt` | PASS | 固定 BTCUSDT `2/2`，canonical/report hash 不变 |
| `npm run check:dist:independence` | PASS | `dist` 6 files / 4,059,904 bytes，禁止远程资源匹配为 0 |
| `python3 tests/e2e_app.py` | PASS | `blockedExternalRequests=0`、`luxalgoRequests=0`、market `157`；Viewer Storage `0/0/0`；lifecycle `7/7/1`；BTCUSDT Viewer 循环后 Chart/Observer `1/1`，销毁后 `0/0` |
| `python3 tests/e2e_app.py --preview` | PASS | production `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer Storage `0/0/0` |

该轮修复了两个真实浏览器/引擎缺陷：`strategy.order/entry` 的 `stop+limit` 订单原先
没有 broker 分支，会永久停留在 `pending`；Simulation 首次加载本地 Highcharts More 后，
排队的 `ResizeObserver` 可能在 Dock/Viewer 切换期间触发 `pane.hasSeriesType` 异常。两项
均有定向回归和 E2E 证据；这不等于完整 TradingView 低周期/逐 Fill 语义、raw fills 或完整 Final Gate 已完成。

### G8.1 / Full Access 当前工作树复核（2026-09-28）

本节是当前未提交 G8.1 工作树的最新证据；G4b.3 的 `schema=3` 和 15/67 记录保留为历史阶段，
不能覆盖当前 Fork 身份。`npm run check:dependencies` 实际输出的完整 fingerprint 为：

```text
@luxalgo/vela-pinets@0.2.13|upstream=a2a2097be8f30b4b596b13212ed4608c36c2ea26|patch=quant-tools-g8.1|pinets=beacd587e83aa7ee061023f8cea66b2e887d5676|schema=4|engine=pinets@0.9.34|upstream=beacd587e83aa7ee061023f8cea66b2e887d5676|patch=quant-tools-g8.1|schema=4
```

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm run test:regression:existing` | PASS | 原有架构/Storage 回归 `22/22` |
| `npm test` | PASS | 根全量 `219/219` |
| `npm --workspace packages/pinets run test -- --run tests/namespaces/strategy` | PASS | `21 files / 121 tests`；覆盖 Bar Magnifier、stop-limit、margin/trailing/streaming 边界与未对齐聚合起点拒绝 |
| `npm --workspace packages/vela-pinets run test -- --run` | PASS | `27 files / 261 tests`；含 runtime、Worker parity 与生命周期竞态 |
| `node --test tests/provider-network.test.mjs` | PASS | Provider network guard `8/8`；覆盖 Binance mirror/timeout、Hyperliquid timeout/retry 与 symbol-index fallback |
| `node --test src/integrations/vela/provider-history.test.mjs` | PASS | Provider history guard `8/8`；覆盖 range、point retry、排序/去重/limit 与 icon resolver 边界 |
| `npm run build` | PASS | 两个本地 Fork、内联 Worker、TypeScript、Vite 全链路成功；仅既有 upstream warning |
| `npm run test:fixture:btcusdt` | PASS | 固定 BTCUSDT/1h fixture `2/2`，canonical/report hash 不变 |
| `QUANT_PERF_ARTIFACT=1 npm run test:e2e:performance -- --strict` | PASS | 最近一次 10k/100k 分页 p95 `38.4/40.6ms`；Dock FPS `59.87/59.91`、long-task p95 `0ms`；heap `+0.36/+0.42MiB`；Simulation 10k `129ms`、heap `+1.51MiB`；资源 `1/1→0/0`；artifact 为 `artifacts/backtest-performance-latest.json` |
| `npm run test:visual:a11y` | PASS（提示） | 四 viewport geometry/PNG/键盘/ARIA 通过；Performance 活动态对比度 `3.692:1` 仍记录为提示 |
| `npm run check:dist:independence` | PASS | `dist` 6 files / `4,059,904` bytes；禁止远程/reference 资源匹配为 0 |
| `npm run check:dependencies` | PASS | G8.1 / `reportSchemaVersion=4`；series envelope 仍为 `schemaVersion=1` |
| `npm run test:e2e:prod` | PASS | production Preview `blockedExternalRequests=0`、`luxalgoRequests=0`、Viewer Storage `0/0/0` |
| `npm run test:e2e:kill-switch` | PASS | `VITE_ENABLE_BACKTESTING=false` 下 `backtestHosts=0`、`blockedExternalRequests=0`、`luxalgoRequests=0`；既有 Workspace 仍可启动 |
| `npm run test:providers` | PASS | Binance/Hyperliquid 各 `historyBars=5` 且 `live=true` |
| `npm --workspace packages/pinets run test -- --run` | BLOCKED（外部） | 全仓既有联网用例访问 `api.binance.com`/`fapi.binance.com` 时 ConnectTimeout；本地定向 strategy 套件通过，不能把全仓阻塞记为代码 PASS |

该复核证明 G8.1 的低周期四点回放、显式 fallback、in-process/Worker parity、应用性能和本地独立
产物门禁均有可重复证据；仍不能宣称完整 TradingView 逐 Fill/复合订单语义、参考站逐笔数值/截图
一致、跨浏览器 Final Gate 或 PineTS 全仓联网套件完成。

### 2026-09-27 checkpoint / fresh-clone 复核

本批次将已验证工作树提交为 `44ade5c`（`feat(backtest): add precision and release gates`），并在
独立临时 clone `/tmp/quant-tools-fresh.Ycogil/repo` 中删除缓存状态后重新执行：

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm ci` | PASS | fresh clone 安装 367 packages；仅记录 npm audit 的既有 1 low/3 moderate 提示，不自动改锁文件 |
| `npm run build` | PASS | 从空的 `node_modules`/Fork `dist` 生成应用与两个本地 Fork；仅保留既有 upstream circular/bundle warning |
| `npm test` | PASS | 根全量 `196/196` |
| `npm run check:dependencies` | PASS | G8.1/schema 4 fingerprint 与当前源码一致 |
| `npm run check:dist:independence` | PASS | `dist` 6 files / `4,059,918` bytes；禁止 reference/Next/auth/remote resource 匹配为 0 |
| `git status --short --branch` | PASS | 构建后 clone 工作树保持 clean（仅显示分支与 origin tracking） |
| `npm --workspace packages/vela-pinets run lint` | PASS | 修复 Worker 测试替身的 `unknown` 直接抛出后，ESLint 0 error |

当前主工作树已恢复正常（非 kill-switch）构建产物；本临时 clone 可安全移除，不包含账户凭据、
Cookie 或参考站 storage state。PineTS 全仓联网套件仍因 `api.binance.com`/`fapi.binance.com`
连接超时保持 `BLOCKED`，不能把该外部阻塞记作代码失败或通过。

### Dock UI 偏好隔离复核（2026-09-28）

回测 Dock 的高度与折叠状态现在使用独立版本化 key
`quant-tools:backtest-dock:v1`，payload 仅为 `{version,height,collapsed}`。恢复时拒绝
旧版本、非有限/非正高度和非布尔折叠值，并由 Workbench 按当前 viewport、`min/max`
约束 clamp；无效值回退到默认 `280px` / 展开状态。拖拽仅在 pointerup、键盘调整、双击
重置和折叠操作结束时写入；打开/关闭 Viewer、报告刷新、viewport clamp、destroy 不写入。
该 key 不包含回测结果、交易账本、策略参数或 `quant-tools:workspace:v2`。

`npm test` 在本次增量中为 `201/201`；新增
`tests/backtest-preferences.test.mjs` 与架构合同覆盖 key、schema 校验、坏值回退和
Workbench 持久化边界。参考站是否实际跨刷新保留 Dock 偏好仍未动态冻结，因此矩阵 D-13
保持 `PARTIAL`，本地实现不宣称该行为已与参考站一比一。

### 跨浏览器与生产断网增量复核（2026-09-27）

本轮新增两个只读发布/浏览器门禁，均不把 LuxAlgo 或远程页面作为运行依赖：

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm run test:e2e:cross-browser` | PASS | 固定本地 BTCUSDT/1h fixture 在 Chromium、Firefox、WebKit 均通过；每个浏览器 `trades=3`、`netProfit=-1.6809529999998745`、`pageErrors=0`、`badResponses=0`、`blockedExternalRequests=0`、`hmrRequests=0`、`websockets=0`；Viewer 关闭恢复 Dock 资源 `1/1`，fixture 销毁后 `0/0` |
| `npm run test:e2e:offline` | PASS | production preview HTTP 200；Favorites/Templates/Pine Editor/Backtest host 各 `1`；拦截的 6 个请求全部属于登记的 Binance/Hyperliquid Provider；`unexpectedExternalHosts=[]`、`luxalgoHosts=[]`、`pageErrors=[]`、WebSocket `[]` |
| `npm run release:manifest -- --require-dist` | PASS（诊断） | 输出 schema v1、commit/branch、Node/npm、lockfile SHA256 和 `dist/` 文件级 SHA256；候选发布需在 clean commit 上将 stdout 保存到仓库外 artifact，再加 `--require-clean` |

跨浏览器门禁加载的是仓库内确定性 fixture，证明的是 PineTS/Vela-PineTS 桥接、四个 Viewer
Tab 和图表资源生命周期在三种浏览器中的兼容性；它不等价于完整应用在三种浏览器下的视觉
一比一、VoiceOver 或生产 Provider 行为。`tests/vite-performance.config.ts` 对测试服务关闭
HMR，并将 backtest CSS 改为普通本地 `<style>` 注入，因此本轮结果确认为 `hmrRequests=0`。
生产断网 smoke 也不声称无行情缓存时可以绘图；它只证明壳、旧 Workspace 控件和本地 bundle
不会依赖参考站/CDN。

真实“候选制品 → 上一份已验证制品”切换、清缓存恢复和 Storage/schema 对账仍未执行，状态
保留 `PARTIAL`，详见 [`BACKTEST_RELEASE_ROLLBACK.md`](../../release/BACKTEST_RELEASE_ROLLBACK.md)。

### 候选提交与测试服务隔离复核（2026-09-27）

本轮将发布门禁整理为候选提交 `8158d4c`（此前的 manifest 文档修复为 `be1d824`，跨浏览器/断网
门禁增强为 `8158d4c`）。此前 agent 中断暴露的根因是多个测试服务共用端口并复用旧 Vite 进程，
而不是业务断言失败；跨浏览器和断网 runner 现在会在启动前拒绝已占用端口，并在探测到服务进程
提前退出时报告启动错误。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm test` | PASS | 根全量 `196/196` |
| `QUANT_CROSS_BROWSER_PORT=4583 python3 tests/e2e_cross_browser.py --browsers chromium,firefox,webkit` | PASS | 三引擎各 `trades=3`、净利润 `-1.6809529999998745`；外部请求、页面错误、HMR、WebSocket 均为 `0`；销毁后资源 `0/0` |
| `QUANT_OFFLINE_PORT=4582 python3 tests/release_offline_smoke.py` | PASS | HTTP `200`；6 个请求均为登记 Provider；`unexpectedExternalHosts=[]`、`luxalgoHosts=[]`、`pageErrors=[]` |
| `npm run check:dependencies` | PASS | G8.1 / `schema=4` fingerprint |
| `npm run check:dist:independence` | PASS | 6 个产物、禁止匹配 `0` |
| `node scripts/release-manifest.mjs --require-clean --require-dist` | PASS | clean candidate `8158d4c8ec48628b312ed832e35f7609da9dc7a8`；dist 6 files / `4,059,918` bytes；lockfile SHA 已记录于外部 manifest |

manifest 示例必须直接调用 Node 脚本；直接重定向普通 `npm run` 会把 npm 启动横幅写入 stdout，
因此已在 [`BACKTEST_RELEASE_ROLLBACK.md`](../../release/BACKTEST_RELEASE_ROLLBACK.md) 中改为可解析的命令。

### 未实现能力继续落地增量（2026-09-28）

本轮没有把缺口仅留作 TODO，而是补齐了可在当前 OHLCV 数据模型中安全定义的引擎语义：

| 能力 | 实现与边界 | 证据 |
| --- | --- | --- |
| PineTS 内部 order/fill lifecycle | append-only `_order_events` / `_fill_events`，记录 created/filled/cancelled/rejected；snapshot/restore 只回滚事件长度与 sequence；不改变 Vela `rawOrders/rawFills=false` | `order-ledger.test.ts`、streaming rollback；strategy 定向 `20 files / 109 tests` |
| `process_orders_on_close` | 当前 K 线收盘追加 broker pass，更新同一 report tail；默认下一根开盘语义保持不变 | `process-orders-on-close.test.ts` 2/2 |
| `backtest_fill_limits_assumption` | limit/TP 要求超过配置 tick 验证距离，仍按请求限价成交；0 保持旧触价行为 | `limit-verification.test.ts` 2/2 |
| `strategy.cancel` lifecycle | 取消事件有原因并保持已成交订单不变；`immediately` 在当前 broker 模型中明确等同同步取消，不伪造延迟语义 | `cancel-lifecycle.test.ts` 6/6 |
| intraday risk | `max_intraday_loss`、`max_intraday_filled_orders`、`max_cons_loss_days` 使用 `syminfo.timezone` 日键，跨日重置 intraday 状态，保留 run-level halt | `risk-intraday.test.ts` 3/3 |
| bare `error()` | 原先 console-only no-op 改为抛出可捕获 `PineRuntimeError`，不影响 `runtime.error()` 契约 | `core-error.test.ts` 2/2 |

本轮复核命令：`npm test` `201/201`、PineTS strategy `20 files / 109 tests`、PineTS core error `2/2`、
`npx tsc --noEmit`、`git diff --check` 均通过。仍保持开放且不得标为完成的项目包括
`calc_on_order_fills`/`calc_on_every_tick` 完整重算、对外 raw/partial/parent fill DTO、
TradingView 逐 Fill 数值对账、秒级历史数据、参考站视觉差分和真实 rollback 制品演练。

### Viewer 状态播报增量（2026-09-28）

回测 Viewer 的 loading、no-data/no-trades/open-only/suspended 状态现在以原子
`role="status"`/`aria-live="polite"` 区域替换内容；编译或运行失败使用
`role="alert"`/`aria-live="assertive"`，重试按钮仍保留在同一公告区域。此改动只增加
可访问性语义，不改变视觉布局、报告数据或重试生命周期。`tests/backtest-viewer-contract.test.mjs`
新增 live-region 契约，当前定向测试 `25/25`、TypeScript 与 diff 检查通过；真实屏幕阅读器
announcement、production/跨浏览器语音行为仍归 AX-06/AX-08 的 PARTIAL Gate。

### Provider / raw ledger / multi-cell 增量（2026-09-28）

本批次复核结果：既有回归 `22/22`、根 `npm test` `219/219`、Provider network/history 离线
contract 各 `8/8`（合计 `16/16`）、adapter/domain/controller 定向 `63/63`、Vela-PineTS
raw-ledger/context/Worker 定向 `47/47`、`npx tsc --noEmit --pretty false`、
`npm run check:dependencies` 与 `npm run build`
通过。

Provider integration 现在对 Binance/Hyperliquid 的历史 range 做实例级校验、点范围重试、OHLCV
排序/去重/边界/limit 归一；默认不调用远程 symbol-icon CDN，故独立运行不新增该隐式依赖。
PineTS order/fill lifecycle 通过本地 `auditLedger` extension 在 in-process/Worker 间传输，
Adapter 仅在 run/revision/bar identity 校验通过时动态开启 `rawOrders/rawFills`，上游 Vela 基线
能力仍为 false；旧的“永远没有 raw bridge”描述属于 9 月 26 日历史审计，不应覆盖当前状态。

新增 `npm run test:e2e:multicell` 2×2 浏览器 fixture：后台 Cell 的 snapshot/error/迟到响应不抢
当前 Dock，stale revision/epoch 被丢弃，同 Cell 删除回退与空 Dock 行为正确；destroy 后
Chart/Observer/Workbench/DOM 回零，Provider 与 Storage 不增长，外部请求/HMR/WebSocket 为 0。
TradingView 逐 Fill、复杂订单、参考站最终视觉/数值、生产 HMR/VoiceOver 与真实 rollback 仍为
PARTIAL/待外部证据，不由本批次绿灯扩大。

### 当前 goal 续跑复核（2026-09-28）

本轮继续针对 Binance/Hyperliquid 超时、PineEngine 异步错误契约及跨浏览器/生产独立运行做复核。
共享工作树中 provider network/index/history/live guard 已保留有限超时、镜像重试、索引 fallback、
旧响应淘汰、范围归一和取消后回调抑制；`preparePine` 另增加非字符串源码的运行时校验，使
in-process `PineEngine.prepare()` 与 Worker prepare 对 malformed source 都异步 reject。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm test` | PASS | 根全量 `238/238`；provider timeout/retry/cache recovery、storage、回测 controller/viewer、既有 Workspace 契约均通过 |
| `npm run test:regression:existing` | PASS | 原有架构/Storage/收藏/模板回归 `22/22` |
| `npm --workspace packages/vela-pinets run test -- --run` | PASS | `27 files / 277 tests`；包含 malformed prepare async reject 回归 |
| `npm run build` | PASS | PineTS/Vela-PineTS Fork、内联 Worker、TypeScript、Vite 全链路构建成功 |
| `npm run check:dependencies` | PASS | 三依赖 workspace/registry 来源、SHA、G8.1/schema=4 fingerprint 一致 |
| `npm run test:providers` | PASS | Binance 与 Hyperliquid 各 `historyBars=5`、`live=true` |
| `node --test tests/provider-network.test.mjs` | PASS | Provider network/index guard `15/15`；含真实 Vela Binance/Hyperliquid 失败缓存恢复与 stale identity 防护 |
| `npm run test:e2e:cross-browser` | PASS | Chromium/Firefox/WebKit 均 `trades=3`、`netProfit=-1.6809529999998745`、`pageErrors=0`、`blockedExternalRequests=0`、`hmrRequests=0`、`websockets=0`；销毁资源 `0/0` |
| `npm run test:e2e:multicell` | PASS | `badResponses=0`、`blockedExternalRequests=0`、`pageErrors=0`、`initialReports=6`、`providerRequests=4`、销毁后 charts/observers `0/0` |
| `npm run test:e2e:prod` | PASS | production Preview `blockedExternalRequests=0`、`luxalgoRequests=0`、`marketRequests=64`、Workspace storage 仅既有 `quant-tools:workspace:v2` 写入 |
| `npm run test:e2e:offline` | PASS（预期 provider 阻断） | HTTP 200、`pageErrors=[]`、`luxalgoHosts=[]`、`unexpectedExternalHosts=[]`；24 个被阻断请求全部为登记 Binance/Hyperliquid Provider |

本轮一次 `npm run test:forks` 初始结果曾因 malformed prepare 测试失败；修复后 Vela-PineTS 全套
277/277 通过。PineTS 全仓联网套件仍受 Node 直连 Binance/fapi 网络环境阻塞，不能记录为全仓 PASS；
浏览器 Provider smoke 已证明实际浏览器路径正常。`npm run release:verify` 不带参数会按脚本契约输出
usage，正式复核应提供 `--manifest <file>`（不是业务失败）。

补充复核（2026-09-28）：PineTS 内置 BinanceProvider 的默认单次请求预算已从 2s 调整为 10s，
仍由 global/US mirror 共享同一总预算；此前在代理/冷连接下 2s 会把健康的 `exchangeInfo` 或
`klines` 误判为空数据。显式 `requestTimeoutMs` 的故障注入合同保持不变，定向 Binance network
测试仍为 `4/4`，根测试、构建、依赖指纹和浏览器 Provider smoke 均通过。启用 Node 24
`NODE_USE_ENV_PROXY=1` 后联网 PineTS 套件可以完成请求，但仓库内若干硬编码 2025 Binance
样本仍与当前动态行情返回不一致（17 个断言），这些属于 stale fixture，不把该套件记为通过，
也不把它们误判成工作区 Provider 地址错误。

### Trades Log 分页渲染续跑（2026-09-28，`ec420b4`）

本轮将单页 Trades Log 从逐行创建节点/逐按钮监听改为有界 HTML fragment + 单一 delegated
click listener；保留原有列、ARIA row index、source index、Entry/Exit 定位、方向徽章、时间/价格
格式化和开仓行禁用 Exit 定位语义。所有插入值经过 HTML escaping，避免异常 Provider 字符串进入
`innerHTML`。旧源码合同同步改为验证等价的新 DOM 契约。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node --test tests/backtest-performance.test.mjs tests/backtest-viewer-contract.test.mjs` | PASS | `35/35`；含 100k ledger 分页、source index、delegated locate 和 ARIA 合同 |
| `npm test` | PASS | 根全量 `238/238` |
| `npm run test:e2e:performance` | PASS | Chromium 1440×900；10k/100k 均单页 200 行，分页 p95 `44.9/41.8ms`，Dock 约 60 FPS，销毁后 Chart/Observer `0/0` |
| `npm run test:visual:a11y` | PASS | 4 viewport；axe/contrast/keyboard/geometry/golden 全部通过 |
| `npm run test:e2e:cross-browser` | PASS | Chromium/Firefox/WebKit；交易数、净利润一致，page error/非法外部请求/HMR/WebSocket 均为 0 |

本轮不改变报告人口、排序或成交语义；PineTS 全仓联网套件仍仅受 Node 直连 Binance/fapi
环境阻塞，Vela-PineTS 本地套件为 `27 files / 277 tests` 通过。

### 可选回测故障隔离与设置竞态复核（2026-09-29）

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm run test:e2e:fault-isolation` | PASS | 对真实 `createApp` 生命周期连续注入两轮 Backtest 挂载失败与 Resize 失败；每轮 Favorites 与 Pine Editor 真实可点击，Templates/Screenshot 入口存在且没有重复（本测试不验证两者完整交互）；失败后不存在 Backtest host；正常重挂载恢复且两次 destroy 后 `mounts/destroys/noopDestroys=6/6/1`，外部请求和 page error 均为 0。 |
| `npm run test:e2e:settings` | PASS | Chromium 真 DOM 回归确认 Inputs/Properties 同名 key 隔离、precision property 位置、float step、整数校验、busy 状态、延迟成功/失败不污染新 dialog session，destroy 后异步完成不复活面板。 |

这两项只证明可选回测功能的错误隔离和设置对话框竞态不会阻断现有 Workspace；不替代
完整生产 HMR、VoiceOver、真实 Provider 超时链路或参考站逐笔/视觉最终对账。

### 形成态 Dock 原地更新复核（2026-09-29）

本轮修复了 forming-bar 报告尾点变化时 Dock/Viewer 整棵重建的问题：同形状 Highcharts
通过 `setData` 原地更新，五个 Dock/Performance KPI 只更新文本与状态 class；终态或图表
形状变化仍走完整 render。Chromium 性能 fixture 新增真实 live snapshot：10k/100k 曲线均
保持同一 Viewer chart host，更新前后 `activeCharts/activeObservers=2/2`，Net Profit 即时
更新为 `+123.45 USD`，随后 ready snapshot 正常重建并由 destroy 回收至 `0/0`。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npx tsc --noEmit` | PASS | 原地更新 renderer、Workbench 与 fixture 类型检查通过 |
| `node --test tests/backtest-performance.test.mjs` | PASS | `9/9`；包含 `updateReportChart`/`setData` 契约 |
| `python3 tests/backtest_performance.py --strict` | PASS | 10k/100k live host identity/resource gate、200 行分页、约 60 FPS 拖拽、长任务 p95=0ms、Simulation 10k 全通过 |
| `npm test` | PASS | 根全量 `255/255`，既有 Provider/Storage/Workspace/Simulation 回归无变化 |
| `npm run build` | PASS | PineTS/Vela-PineTS Fork、TypeScript、Vite 生产构建成功 |

该修复只针对实时 Dock 更新路径，不改变报告人口、订单撮合、终态报告或现有
Viewer 生命周期；参考站逐笔/视觉差分、生产 HMR、VoiceOver 和真实 rollback 仍按矩阵保持
`PARTIAL/BLOCKED`。

### 形成态标量 KPI 原地更新复核（2026-09-29）

补充修复了一个形成态边界：引擎可能只更新 mark-to-market KPI 而不追加曲线点。此前
Viewer 仅比较图表签名时会跳过刷新，导致 Performance 的 Net Profit 保留旧值。现在图表
数据与 KPI 分别比较；标量变化通过既有 Highcharts/DOM 实例原地更新，只有结构变化才完整
重建。性能 fixture 增加了曲线不变、KPI 从旧值变为 `+234.56 USD` 的真实浏览器断言。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npx tsc --noEmit --pretty false` | PASS | Viewer KPI/chart signature 分离通过类型检查 |
| `node --test tests/backtest-performance.test.mjs` | PASS | `9/9`，包含 scalar-only fixture 合同 |
| `python3 tests/backtest_performance.py --strict` | PASS | 10k/100k 曲线 host 保持、KPI 即时更新、资源计数不变；Dock 约 60 FPS、Simulation 10k 通过 |
| `npm test` | PASS | 根全量 `255/255` |
| `npm run build` | PASS | Fork、Worker、TypeScript 与 Vite 生产构建成功 |

同一 fixture 还覆盖了“曲线/指标均不变但状态进入 error”的终态转换：Viewer 必须切换到
错误状态并保留重试入口；恢复 ready 后再验证 forming KPI 的 host/resource 复用。该检查避免
形成态优化把真实错误误判成无变化快照。

补充结果：`npm test` 根全量 `255/255`、`npm run test:e2e:prod` 的
`blockedExternalRequests=0` / `luxalgoRequests=0` / `marketRequests=64` 均通过；工作树保持 clean。

### Viewer 报告重算滚动位置复核（2026-09-29）

Viewer 在非形成态报告重算时会替换当前 Tab 内容。现已保存并恢复活动面板的
`scrollTop`，避免切换/重算后跳回顶部；形成态原地更新继续保持原 DOM 与滚动位置。源码合同
测试已纳入根回归。

视觉/a11y 门禁同时对所有可见 Dock、Performance、Analysis 和 Simulation 图表检查本地
`aria-label`/`desc` 描述，防止仅依赖颜色或鼠标 Tooltip；四 viewport 该检查均通过。

### 新 run 身份刷新复核（2026-09-29）

修复 Viewer 仅比较图表/KPI 签名时的边界：新引擎 run 可能生成完全相同的曲线和 KPI，
但仍必须刷新策略标题并重置 run-scoped 控件。现在 `runId` 变化会强制完整报告刷新；性能
fixture 以相同数据切换 runId/标题并在 Chromium 中断言标题已更新，同时继续覆盖终态错误、
形成态标量 KPI 原地更新和图表资源复用。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npx tsc --noEmit --pretty false` | PASS | Viewer、fixture 类型检查通过 |
| `node --test tests/backtest-performance.test.mjs tests/backtest-viewer-contract.test.mjs` | PASS | `39/39` |
| `python3 tests/backtest_performance.py --strict` | PASS | 10k/100k `runChanged=true`；图表资源、KPI、分页、拖拽、Simulation、销毁门禁全部通过 |

该修复只影响报告身份变化的 Viewer 刷新判定，不改变 Pine 计算、订单撮合、报告数值或
主分支既有工具栏/指标/Provider 行为；参考站逐笔、低周期撮合、生产 HMR 和实机
VoiceOver 等外部证据仍按 parity matrix 保持 `PARTIAL/BLOCKED`。

### 直接 Production Preview 与 Fork 回归复核（2026-09-29）

修复测试编排边界：直接执行 `python3 tests/e2e_app.py --preview` 现在会先检查
`dist/index.html` 是否缺失或落后于源码/最新 commit；过期时自动运行 `npm run build`，
不再依赖调用者手工预构建。新增静态合同测试覆盖该行为。

同时修正 PineTS transpiler 的 Native Data 期望 fixture，使其与当前合法的对象属性简写输出一致；
该修复不改变运行时语义。定向策略/转译套件与 Vela-PineTS 全套均通过；PineTS 全仓仍有
Binance 外部联网测试，因当前网络 ConnectTimeout/Abort 保持 BLOCKED，不计为应用回归失败。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `python3 tests/e2e_app.py --preview` | PASS | 未预先手工构建时自动重建 dist；blockedExternalRequests=0、luxalgoRequests=0、marketRequests=64 |
| `npm test` | PASS | 根全量 257/257 |
| `npm --workspace packages/pinets run test -- --run tests/namespaces/strategy tests/transpiler/pinets-source-to-js.test.ts` | PASS | 25 files / 152 tests |
| `npm --workspace packages/vela-pinets run test -- --run` | PASS | 27 files / 277 tests |

### Dock 图表尺寸稳定性复核（2026-09-29）

修复 ResizeObserver 反馈边界：Highcharts tooltip/SVG 文本测量可能产生同尺寸的重复
ResizeObserver 通知，旧逻辑会对同一尺寸重复调用 `chart.reflow()`，表现为 Dock 右侧图表
视觉上持续伸缩。现在每个图表记录最近一次 host 宽高，仅在实际尺寸变化超过 0.5px 时触发
reflow；真实 Dock 拖拽仍会正常重排，forming/KPI 原地更新不受影响。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npx tsc --noEmit --pretty false` | PASS | ResizeObserver 尺寸去重类型检查通过 |
| `node --test tests/backtest-performance.test.mjs` | PASS | renderer 尺寸去重合同通过 |
| `python3 tests/backtest_performance.py --strict` | PASS | 10k/100k、拖拽约 60 FPS、long-task p95=0、图表资源销毁 0/0 |
| `npm run test:visual:a11y` | PASS | 四 viewport 截图 diff=0、axe/contrast/chart description 全通过 |
