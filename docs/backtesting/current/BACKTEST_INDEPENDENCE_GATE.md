# 回测静态产物独立运行 Gate

> **2026-10-01 R-08～R-11 修复后独立复查（历史指针）**：R-08、R-10、R-11 结论保留于 [报告](../reports/BACKTEST_R08_R11_RECHECK_2026-10-01.md)；R-09 的历史状态见 [R-09 首次复查](../reports/BACKTEST_R09_RECHECK_2026-10-01.md)，当前状态以本文件下一条最新指针为准。整体仍为 **PARTIAL**。

> **2026-10-01 最新独立复查**：[R-09 第三次复查](../reports/BACKTEST_R09_RECHECK_3_2026-10-01.md)、[新证据](../../../audit-evidence/2026-10-01-r09-recheck-3/README.md)。R-09 当前 Workbench pointer-open 契约在 Chromium、Firefox、WebKit 均回 Settings 触发按钮；Tab/Shift+Tab、Escape、busy、destroy、主 E2E 及构建门禁均通过。R-08、R-10、R-11 的本轮缺陷场景也通过。完整 reference golden、复杂撮合、长时 Provider、全量像素、VoiceOver/跨设备、bundle threshold 和 rollback 仍开放，整体 **PARTIAL，Final Gate 未关闭**。下方旧报告只作历史索引。

> **2026-10-01 修复者过程记录（历史）**：见 [账本与视觉修复记录](../reports/BACKTEST_LEDGER_VISUAL_REMEDIATION_2026-10-01.md)。图表 BTC/ETH 改用与 Viewer 共用的本地 SVG，不新增外部图标依赖；静态独立性仍须在最终构建后复核。下方业务状态保留为修复前审计记录，整体 Final Gate 不因静态检查通过而关闭。

> **2026-09-30 动态深审指针（历史快照）**：静态产物 Gate 不能替代业务动态验收。最新结论见 [BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md](../reports/BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md)，本地动态证据见 [audit-evidence/2026-09-30-dynamic-deep/README.md](../../../audit-evidence/2026-09-30-dynamic-deep/README.md)，参考站黑盒证据见 [BACKTEST_REFERENCE_DEEP_AUDIT_2026-09-30.md](../reports/BACKTEST_REFERENCE_DEEP_AUDIT_2026-09-30.md)，固定 SMA 9/21 对账见 [BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md](../reports/BACKTEST_REFERENCE_PARITY_DEEP_AUDIT_2026-09-30.md)。R-05/R-06/R-07 当前 probe 9/9 通过，但 D-01 和真实 Provider ledger/readiness 仍开放，Final Gate 仍不通过。

> **第四轮独立复查（2026-09-30，历史快照）**：见 [BACKTEST_AUDIT_RECHECK_4_2026-09-30.md](../reports/BACKTEST_AUDIT_RECHECK_4_2026-09-30.md) 与 [第四轮证据](../../../audit-evidence/2026-09-30-recheck-4/README.md)。当前源状态以顶部最新独立复查为准。

> **历史记录（第三轮，2026-09-30）**：见 [BACKTEST_AUDIT_RECHECK_3_2026-09-30.md](../reports/BACKTEST_AUDIT_RECHECK_3_2026-09-30.md)。该轮发现的 R-05～R-07 问题已在后续修复中重新复测；当前结论以第四轮报告为准。

> 后续修复构建：8 files / 4,227,098 bytes，禁止项/静态远程资源URL为0；S/U 修复与真实引擎复测见 [修复记录](../reports/BACKTEST_RECHECK_2_REMEDIATION_2026-09-30.md)。以下保留修复前审计数据，不以静态产物检查代替业务验收。
> 第三轮修复记录曾将 R-05～R-07 标为已复测；第四轮复查重新发现 R-06/R-07 的适配器边界，本 gate 仍只证明产物独立性，不证明外部参考 parity 或复杂撮合完成。

> 第二轮历史复核（2026-09-30）见 [BACKTEST_AUDIT_RECHECK_2_2026-09-30.md](../reports/BACKTEST_AUDIT_RECHECK_2_2026-09-30.md)。当时 fresh build 为 8 files / 4,226,165 bytes，禁止项/静态远程 URL 为 0；下方数字保留为历史记录，当前业务状态以第四轮复查为准。

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
[`BACKTEST_INDEPENDENT_AUDIT_2026-09-29.md`](../reports/BACKTEST_INDEPENDENT_AUDIT_2026-09-29.md)。
该报告基于当前工作树重新执行，不继承本文件早期小节的 PASS 数字；本 Gate 只能作为静态产物检查，
不能单独证明业务功能或参考站 parity。
# 第四轮独立复查指针（2026-09-30）

当前独立结论和新证据以 [BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md](../reports/BACKTEST_DYNAMIC_DEEP_AUDIT_2026-09-30.md) 及 [动态深审证据](../../../audit-evidence/2026-09-30-dynamic-deep/README.md) 为准。旧测试集、旧报告、修复记录和本地累计测试数字仅保留为历史索引；当前适配器 R-05/R-06/R-07 probe 9/9 通过，但 D-01 仍开放，整体 Final Gate 不通过。
