# Final Gate Closure Plan

工作分支：`task/network-release-gates`

本文件记录从 `master` 已通过的本地启动优化继续收敛 Final Gate 的范围、证据和边界。它不把本地 fixture 或 Playwright 模拟结果写成线上验收结论。

## 已推进

- Provider live：`offline` 会撤销当前 socket lease，`online` 重新建立订阅；generation token 阻止迟到旧 socket 回写。覆盖 Binance、Hyperliquid、重复断开、销毁和失败后恢复。
- Bar Magnifier：新增独立 1H/10m golden，校验 lower-feed 覆盖、precision envelope、stop/limit 顺序、Entry/Exit、P&L、MAE/MFE 和无残留持仓。
- 触摸交互：新增 Chromium/Firefox/WebKit 的 `has_touch + tap()`，覆盖手机/平板、四个 Viewer Tab、Simulation 设置、返回图表和资源回收。
- 既有 release manifest 已覆盖 candidate/previous 同槽切换、制品篡改拒绝和 Storage reconciliation；新增缓存 smoke 校验入口 HTML 可重新验证、hash 资源 immutable 且回滚保留旧资源。不把本地模拟等同真实 CDN/线上回滚。
- Provider smoke 使用独立的无 HMR Vite 配置，避免 fork 构建或源文件变更触发测试页导航；已完成 Binance Spot/Futures、Hyperliquid 真实网络 10 轮历史与 live 验证。
- `vite preview` 已提供发布缓存契约：HTML 入口 `no-cache/no-store/must-revalidate`，带 hash 的静态资源 `immutable`；这只证明本地预览协议，线上 CDN 仍需部署实测。
- 本地回归门禁已补齐：等待服务测试在高负载下不再因 Node 子进程启动抖动误报；根测试当前 532/532，release 29/29，Provider recovery 本地验证通过，触摸 E2E 6/6，Bar Magnifier golden 通过。

## 验证命令

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e:touch
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

## 仍需外部证据

以下项目不能仅靠本机代码或浏览器模拟关闭：

- 长时 WebSocket、真实断网/代理黑洞和跨区域恢复；
- 实际部署槽位、CDN/browser cache、真实 rollback 与缓存清理；
- 参考站同一行情和策略的完整逐笔 Entry/Exit/Size/P&L/MFE/MAE golden；
- TradingView 完整复杂撮合语义（partial fill、pyramiding、reversal、OCA、margin/FIFO 等）；
- 实体 Safari、VoiceOver、真实 iOS/Android 和跨设备触摸；
- 参考站全量像素级对账。

这些项目在没有对应环境和同源数据时保持 `PARTIAL`，不得用“测试通过”替代缺失证据。

### 2026-10-03 外部复核记录

- 参考站自动登录流程已再次执行，能够进入 Vela workspace 并采集移动端真实页面；但从 `app.luxalgo.com` 到 `vela.luxalgo.com` 的 RSC 导航受到浏览器 CORS/连接关闭影响，未获得完整 Trades Log，因此不能把本次运行升级为完整逐笔 golden 证据。
- 本机没有可无交互授权的实体 Safari/VoiceOver 运行条件，也没有部署槽位、CDN purge 和线上回滚凭据；这些仍然是外部验收依赖，不用 Playwright WebKit 或本地 preview 冒充。
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
- 断网探针现额外断言 offline 窗口不得收到任何行情 callback，并输出 `offlineBars`；本地 recovery 回归结果为 Binance/Hyperliquid `offlineBars=0`。这只增强了断网语义的可观测性，不扩大外部验收范围。

> 2026-10-03 外部网络门禁补充：push 门禁已通过；手动 provider soak 的 fork 构建缺口已修复，但一次 60 秒真实网络运行在 Binance `Failed to fetch` 处失败，未被标记为通过。长时 WebSocket/断网恢复仍需可访问交易所 API 的连续运行证据。
