# Vela-PineTS 本地 fork 记录

## 基线身份

- 包：`@luxalgo/vela-pinets@0.2.13`
- 上游 tag：`v0.2.13`
- 上游 commit：`a2a2097be8f30b4b596b13212ed4608c36c2ea26`
- 本地 patch revision：`quant-tools-g4b.3`
- 本地目录：`packages/vela-pinets`
- 机器可读身份：`packages/vela-pinets/fork-build-info.json`
- 编译期身份：`packages/vela-pinets/src/build-info.ts`

该包是 PineTS 与 registry Vela `0.7.7` 公共插件 API 之间的桥。Worker 是单独构建并内嵌 PineTS 的执行上下文，因此仅检查主线程依赖版本不足以证明实际运行代码一致。

## Worker / in-process 身份合同

`PreparedScript.token.build` 携带组合 fingerprint 与 sentinel。in-process 和 Worker 都把执行 provenance 放入 context snapshot；Worker 还必须提供独立的 `workerFingerprint`。主线程会在 prepare 返回和 execute 入口校验 token：旧 dist、旧 Worker 或外部构造的 PreparedScript 缺少当前 sentinel 时明确报错，不能静默执行。

组合身份同时记录：

- Vela-PineTS 上游 SHA 与本地 patch revision；
- 内嵌 PineTS 的上游 SHA 与完整 fingerprint；
- report schema；
- in-process/worker 执行种类和 Worker fingerprint。

应用适配层只接受结构完整、SHA 合法且 Worker fingerprint 存在的 Worker provenance，再映射为 provider-neutral `BacktestReport.provenance`。这项校验用于诊断和发布对账，不改变策略计算值。

## 当前本地改造边界

当前桥接扩展包括报告标量、account currency、最大持仓峰值和 trade bar index 透传、构建 provenance、stale Worker 失败保护，以及带 runId/snapshot revision 的逐 K equity/drawdown/benchmark 报告。完整历史只在显式选择 `reportSeries` 时复制，live tick 使用至多一个点的 `reportTail`；默认 summary 保持 O(1)。应用只有在同一 identity、point count 和严格单调序列全部校验通过后才开启 exact curve capability；`barIndices` 也只在当前已接受 ledger 的每个必需 leg 都通过非负整数与先后顺序校验时开启。G8 第一版已在 in-process/Worker wire 中透传 lower-timeframe envelope、覆盖率和 fallback reason，并与 PineTS Fork 的四点回放对齐；raw orders/fills、精确 reversal relation、完整复合订单语义和参考逐 Fill 对账仍属于后续 Gate。

## 更新规则

1. 先导入并验证新的上游 Vela-PineTS 基线。
2. 更新两份 build metadata，并同步确切的内嵌 PineTS SHA/fingerprint。
3. 同时验证 `PineEngine` 与 `PineWorkerEngine`，不得只验证一种执行路径。
4. fresh build 后从产物验证 Worker 身份，保留旧 Worker/旧 PreparedScript 的反向失败用例。
5. 重跑应用 Adapter、Controller、现有工具栏/指标/脚本/存储及 E2E 非回归。

## 必过验证

```sh
npm --workspace packages/vela-pinets run typecheck
npm --workspace packages/vela-pinets test -- --run
npm --workspace packages/vela-pinets run build
npm run check:dependencies
npm test
npm run build
```
