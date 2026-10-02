# Vela / PineTS 本地依赖决策记录

> 日期：2026-09-27
>
> 状态：当前版本采用“两个本地 fork、Vela 主包保留 registry”方案。

## 结论

当前回测工作区的执行链路由仓库内的两个 workspace package 固定提供：

- `packages/pinets`：`pinets@0.9.34` 的本地源码版本，保存 Pine 执行与 broker 改造。
- `packages/vela-pinets`：`@luxalgo/vela-pinets@0.2.13` 的本地 bridge，保存 PineTS 与 Vela context/report 的适配。

`@luxalgo/vela@0.7.7` 暂时继续使用 registry 依赖。当前应用只使用其公开 Workspace/Plugin API；回测结果通过 `vela-pinets` 的显式 snapshot 边界进入应用，不把 Vela 私有对象透传到 UI。

这不是运行时远程依赖：生产构建把本地 workspace fork 编译进应用，依赖契约会检查版本、source SHA、workspace link、build fingerprint、sentinel 和单例解析。

## 何时需要把 Vela 主包本地化

只有满足以下任一条件，才开启独立的 Vela fork Spike/迁移：

1. 公开 API 无法提供回测所需的版本化 raw orders/fills、parent/reversal relation 或原子 snapshot；
2. Bar Magnifier 需要修改 Vela 的数据加载、Worker wire schema 或 chart-to-engine 生命周期；
3. 公开类型/生命周期无法保证多 Cell、取消、乱序响应和 destroy-remount 契约。

在 Spike 证明前，不通过 `as any` 或 marker 推断伪造上述能力；`rawOrders`、`rawFills` 和低周期 precision 继续保持明确的 unavailable/capability=false。

## 本地版本与上游同步规则

- fork 源码保留上游 commit、`localPatchRevision`、`reportSchemaVersion` 和构建 sentinel；不直接修改 `node_modules`。
- PineTS 与 Vela-PineTS 的升级先在隔离分支执行，依次通过 fixture determinism、strategy/reversal/FIFO、adapter、root regression、build、dev/prod E2E 和 Provider smoke，再更新 dependency baseline。
- Vela 主包若转为 workspace，必须同时更新 `package.json`、lockfile、`docs/forks/DEPENDENCY_BASELINE.json`、build metadata 和回滚记录；不能只替换 `node_modules`。
- 每次升级保留可回滚的 registry baseline，旧 report schema 与旧 fixture 在迁移窗口内继续可读。

## 当前边界

本决策不宣称已实现 raw order/fill 或 Bar Magnifier。当前公开状态和未完成项见
[`BACKTEST_PARITY_MATRIX.md`](../backtesting/current/BACKTEST_PARITY_MATRIX.md)。
