# 回测工作区文档入口

当前状态以最新报告和计划为准，历史报告只用于追溯，不覆盖当前结论。

> 当前唯一的需求状态入口是 [BACKTEST_REQUIREMENTS_STATUS.md](current/BACKTEST_REQUIREMENTS_STATUS.md)。
> 它汇总了此前关于数据源职责、2,000 根周期切换、低周期 K 线缺口、精度开关、参考站对账、远端 CI、启动性能和范围边界的多轮结论。下方计划、矩阵和基线中的旧日期内容只用于追溯。

2026-10-07 最新 UI 口径：功能、交互、图标和组件风格对标参考站，整体布局适配本项目的可用区域；不复制或预留参考 AI 侧栏、顶部登录 banner，不要求整页像素和绝对坐标重合。详情见需求表“UI 对标评价标准”与计划 §10。当前纳入本阶段的桌面模块和状态已完成，合理布局差异不等于缺陷。

最新范围调整：**手机端适配暂缓**，详见 SCOPE-07。手机布局、横竖屏、safe-area、触摸及手机实机专项不作为本期阻塞；保留已有修复和证据，继续桌面全模块、窗口缩放、键盘及通用业务验证。

## 当前入口

1. [最终建设计划](current/BACKTEST_WORKSPACE_PLAN.md)
2. [Parity Matrix](current/BACKTEST_PARITY_MATRIX.md)
3. [Regression Baseline](current/BACKTEST_REGRESSION_BASELINE.md)
4. [Independence Gate](current/BACKTEST_INDEPENDENCE_GATE.md)
5. [TODO](current/TODO.md)

## 范围状态

截至 2026-10-07，固定 BTCUSDT/15m/SMA 窗口（279 closed + 1 open）数值、ENGINE-03 列明的有限撮合合同和精度开关已验；当前需求表纳入本阶段的本地功能、桌面 UI、数据恢复和构建门禁均已完成。完整 TradingView 外部逐 Fill 对账、其它策略/窗口 golden 不属于本阶段关闭条件。
DATA-11 K 线缺失合并 P1 已按列明范围关闭：任意周期最新 2,000 根与窄屏视口、实际手势补历史、月线规则、缓存/分页、双引擎 Retry、高精度恢复和真实行情渲染已有证据。Hyperliquid/Binance 两小时及代表 CONNECT 静默恢复通过；STARTUP-01 启动预算和 REL-06 冻结生产 Workspace 两小时也已通过各自合同，不重新列为待办。详细结果统一见需求表，避免多个文档测试数字漂移。
UI 对标包含 Backtest Workspace 全部模块及其跨入口/刷新/滚动/定位交互；评价标准允许本项目布局与参考站容器不同，不要求整页像素重合。PERF-01 的固定 Chromium 生产预算及列明跨浏览器功能/资源合同已通过；Firefox 的部分计时超过 Chromium 对照值，不能声称所有设备同预算。实体桌面 VoiceOver、手机、Safari、远端 CI、线上部署、Replay 和长期脚本持久化按需求表单独暂缓或待讨论。
线上部署/CDN/rollback、Replay、Safari 专项、手机适配/手机实机触摸及实体桌面 VoiceOver 均按需求表暂缓；它们不影响当前纳入范围的本地交付结论。
长期脚本持久化仅待讨论；其它策略/品种 golden 不在本期，完整 TV 外部逐 Fill 不作为当前关闭条件，但撮合语义继续按 TODO/TV 调研维护。

## 证据

可直接重跑的专项入口包括 `npm run test:e2e:settings`、`npm run test:e2e:analysis`、`npm run test:e2e:trade-log-calendar`；三项也已接入 Final gates 工作流。它们检查真实控件、悬浮提示/键盘、排序分页/日历及页面错误，输出写入本地忽略的 `audit-evidence/`。CI 配置已更新不代表尚未推送的提交已经由远端执行。

`npm run test:e2e:responsive` 当前只跑桌面窗口及 DPR 矩阵；其中 720×450 / DPR2 检查 200% 缩放的等效布局，不冒称操作了浏览器真实缩放菜单。手机触摸矩阵保留为 `npm run test:e2e:touch` 和手动工作流的 `verify_mobile` 可选项。混合专项保留完整矩阵入口，默认门禁选择桌面范围；手机专有布局/触摸结果不恢复为本期交付要求。

完整审计截图、原始响应和历史复查报告属于本地/私有归档，不进入公开构建仓库。
公开仓库只保留上面的当前计划、状态矩阵、回归基线和 TODO；这些文件不依赖外部
审计附件即可理解项目当前状态。
