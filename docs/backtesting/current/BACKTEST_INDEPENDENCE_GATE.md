# 回测静态产物独立运行 Gate

> 最新脚本错误/持久化/故障隔离/K线缓存保护修改后，需以本轮最终构建重新生成产物摘要；上一版Tab/Simulation/极小轴产物为12 files / 3,731,990 bytes、main raw/gzip 1,826,350/489,506，均在既定预算内。当前独立性检查仍保持禁止项/静态外链0，完整状态见[需求表](BACKTEST_REQUIREMENTS_STATUS.md)；独立性通过不关闭VoiceOver或明确保留的产品差异。

> 2026-10-07 桌面非文字可辨识续验：已修复 Calendar 焦点框、Settings 默认控件边界及 Simulation 置信区间低对比度/区间键盘不可达。实际两浏览器控件20项取色、16项键盘通过；区间轮廓及中位线最低4.41:1，原始68点可读，Simulation四场景144/144通过，计算值未改。最新根639/639、类型、重建/生产主E2E、紧凑桌面4场景228项及6项清理、包体/仓库/dist检查通过。此前完整本地门禁保持原时点；本轮未改视觉基线，VoiceOver与参考交互差异仍开放。证据仅在忽略目录 `audit-evidence/2026-10-07-essential-control-contrast/after/` 和 `audit-evidence/2026-10-07-simulation-band-contrast/`。

> 2026-10-07 桌面续验终态：根639/639、类型/构建、dev/prod主E2E及工程门禁通过；Dock 393/393、桌面 Dock 632项、Summary/Dock键盘176项及桌面32场景/1,792项、Analysis164、Log/Calendar858、H-06图例收藏/</>与L-11定位164项、Settings和strict visual四图diff=0通过。Simulation最后Preserve scoped CSS补丁另验84/84，Settings刷新竞态、box-sizing、空态Ghost、H-06与L-11已在后续批次通过。证据与源码时点见 `audit-evidence/2026-10-07-dock-keyboard-closure/README.md`（本地忽略）；下方627及更早数字保留各自批次。手机专项默认deferred/full可选，桌面VoiceOver和共享参考差异仍按需求表开放；GitHub CI 按用户决定暂缓，不作为当前 Gate。

> 最新范围调整：手机端适配/手机实机触摸按需求表 SCOPE-07 暂缓，不再作为当前交付阻塞；已有结果保留。此调整不改变独立运行、桌面功能或通用数据完整性要求。

> UI 当前按[需求表](BACKTEST_REQUIREMENTS_STATUS.md)的“组件对标、布局适配”标准验收，不复制参考 AI 侧栏/登录 banner，也不要求整页逐像素一致；此标准不改变本 Gate 的独立运行要求，不授权运行时加载参考站资源。

> 当前状态及最新验证以 [BACKTEST_REQUIREMENTS_STATUS.md](BACKTEST_REQUIREMENTS_STATUS.md) 为准。DATA-11、REL-01、ENGINE-03、STARTUP-01、REL-06与PERF-01列明范围已有独立证据；PERF-01仅固定Chromium生产预算通过，Firefox超出观察值仍保留。本地strict visual已按原阈值复核通过；本Gate仍不能替代完整UI和真实设备；GitHub CI 按当前决定暂缓，下方旧数字只作历史记录。

> **2026-10-07最新UI构建批次**：根627/627、类型/构建、依赖/仓库/dist及显式bundle预算通过；dev/prod主E2E非法外部请求0、dev生命周期7/7；生产32状态page/window错误与blocked0。本地visual独立审图/DOM A/B后普通strict复验8图diff0，精确ring检查5类负控拒绝，原阈值未放宽、首跑失败保留于 `audit-evidence/2026-10-07-ui-layout-acceptance/`。Settings同源控件、本地SVG未引入参考运行依赖；原参考JS仅留忽略目录用于受控展示验证，不是应用依赖、自然Benchmark或计算golden。原始资料/认证状态不进入部署包；上述结果不代表行情离线、VoiceOver/真机或全UI通过。

> **2026-10-01 R-08～R-11 修复后独立复查（历史指针）**：R-08、R-10、R-11 结论保留于 `报告`（本地忽略证据，公开仓库不携带）；R-09 的历史状态见 `R-09 首次复查`（本地忽略证据，公开仓库不携带），当前状态以本文件下一条最新指针为准。整体仍为 **PARTIAL**。

> **2026-10-01 独立复查（历史）**：`R-09 第三次复查`（本地忽略证据，公开仓库不携带）、`新证据`（本地忽略证据，公开仓库不携带）。R-09 当前 Workbench pointer-open 契约在 Chromium、Firefox、WebKit 均回 Settings 触发按钮；Tab/Shift+Tab、Escape、busy、destroy、主 E2E 及构建门禁均通过。R-08、R-10、R-11 的本轮缺陷场景也通过。完整 reference golden、复杂撮合、长时 Provider、全量像素、VoiceOver/跨设备、bundle threshold 和 rollback 仍开放，整体 **PARTIAL，Final Gate 未关闭**。下方旧报告只作历史索引。

> **2026-10-01 修复者过程记录（历史）**：见 `账本与视觉修复记录`（本地忽略证据，公开仓库不携带）。图表 BTC/ETH 改用与 Viewer 共用的本地 SVG，不新增外部图标依赖；静态独立性仍须在最终构建后复核。下方业务状态保留为修复前审计记录，整体 Final Gate 不因静态检查通过而关闭。

> **2026-09-30 动态深审指针（历史快照）**：静态产物 Gate 不能替代业务动态验收。最新结论见 `BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带），本地动态证据见 `audit-evidence/2026-09-30-dynamic-deep/README.md`（本地忽略证据，公开仓库不携带），参考站黑盒证据见 `BACKTEST_REFERENCE_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带），固定 SMA 9/21 对账见 `BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带）。R-05/R-06/R-07 当前 probe 9/9 通过，但 D-01 和真实 Provider ledger/readiness 仍开放，Final Gate 仍不通过。

> **第四轮独立复查（2026-09-30，历史快照）**：见 `BACKTEST_AUDIT_RECHECK_4_2026-09-30.md`（本地忽略证据，公开仓库不携带） 与 `第四轮证据`（本地忽略证据，公开仓库不携带）。当前源状态以顶部最新独立复查为准。

> **历史记录（第三轮，2026-09-30）**：见 `BACKTEST_AUDIT_RECHECK_3_2026-09-30.md`（本地忽略证据，公开仓库不携带）。该轮发现的 R-05～R-07 问题已在后续修复中重新复测；当前结论以第四轮报告为准。

> 后续修复构建：8 files / 4,227,098 bytes，禁止项/静态远程资源URL为0；S/U 修复与真实引擎复测见 `修复记录`（本地忽略证据，公开仓库不携带）。以下保留修复前审计数据，不以静态产物检查代替业务验收。
> 第三轮修复记录曾将 R-05～R-07 标为已复测；第四轮复查重新发现 R-06/R-07 的适配器边界，本 gate 仍只证明产物独立性，不证明外部参考 parity 或复杂撮合完成。

> 第二轮历史复核（2026-09-30）见 `BACKTEST_AUDIT_RECHECK_2_2026-09-30.md`（本地忽略证据，公开仓库不携带）。当时 fresh build 为 8 files / 4,226,165 bytes，禁止项/静态远程 URL 为 0；下方数字保留为历史记录，当前业务状态以第四轮复查为准。

该检查针对 `dist/` 发布产物，不会访问参考站，也不会把登录态、Cookie、账户凭据或
`backtest.html` 打进构建结果。它是运行时 E2E（`blockedExternalRequests=0`）之外的
静态防回归检查。

运行顺序：

```bash
npm run build
npm run check:dist:independence
```

脚本会递归扫描 `dist/` 中的文本 bundle，拒绝以下内容：

- `app.luxalgo.com` 参考站地址；
- Next.js `_next/` / `next/static/` chunk 路径；
- `storageState`、Cookie 或 `sessionStorage` 快照标记；
- 误打包的邮箱地址。

HTML/CSS 中的静态远程 `src`、`href` 或 `url()` 也会在 JSON 输出中列出。Vela attribution
`https://luxalgo.com/vela`、Provider API 常量和 Highcharts 的版权链接属于本地依赖/数据
适配代码，脚本只报告而不把它们误判为参考站依赖；是否实际发起请求仍由离线 E2E 守卫验证。

历史复核环境曾记录 6 个文件、约 3.8 MB；该数字不适用于当前 HEAD。当前
`53ab05795f45e5440eba1c1513b3bb63a659b9ae` 在 Apple M5、Node v24.15.0 下产物为 8 个文件、
4,216,487 bytes；禁止项和静态远程资源 URL 均为 0。该
检查不能替代 fresh clone、断网预览、浏览器资源计数或 WebKit/Firefox 验证，相关 Final
Gate 继续在 `BACKTEST_PARITY_MATRIX.md` 中保持 PARTIAL。

Quant 的 Binance/Hyperliquid provider 默认使用本地 BTC/ETH SVG data URL resolver；未识别资产
由 Vela 使用本地 initials badge。这样 `crypto-icons.ledger.com` 不属于默认运行时网络契约；只有
宿主显式传入 `{ remoteSymbolIcons: true }` 才会选择性恢复该依赖，断网 Gate 不得把该选择误记
为默认独立运行。

发布制品身份还必须经过 `scripts/verify-release-manifest.mjs` 的只读复核。该复核在指定
checkout 上逐项验证 commit、`package-lock.json` 和 `dist/` 文件集合/摘要，避免把“当前目录
重新生成的 hash”误当成上一版本。候选与上一版本的 manifest 应分别放在 checkout 外的 artifact
目录；回滚后的浏览器持久化则使用 `scripts/storage-reconciliation.mjs`，同时保留原始字节
摘要和去除已登记运行时字段后的 canonical 摘要。

## 2026-09-29 独立复核指针

用户已明确此前测试集、fixture 和结论不能作为本轮证据。当前完整命令结果、Fork typecheck 失败、
动态联网 suite 阻断、性能局部通过边界，以及适配器/domain 的 revision、context、浅冻结、Trade #、
Settings 双重更新和 open Exit 风险，统一记录在
`BACKTEST_INDEPENDENT_AUDIT_2026-09-29.md`（本地忽略证据，公开仓库不携带）。
该报告基于当前工作树重新执行，不继承本文件早期小节的 PASS 数字；本 Gate 只能作为静态产物检查，
不能单独证明业务功能或参考站 parity。
# 历史独立复查指针（2026-09-30）

该轮独立结论和证据以 `BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md`（本地忽略证据，公开仓库不携带）及 `动态深审证据`（本地忽略证据，公开仓库不携带）为准。旧测试集、旧报告、修复记录和本地累计测试数字仅保留为历史索引；当时 R-05/R-06/R-07 probe 9/9 通过并记录 D-01，D-01 已在后续版本关闭。当前状态以需求表和本文件顶部 2026-10-07 指针为准，整体 Final Gate 仍不通过。
