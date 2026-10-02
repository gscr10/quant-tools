# PineTS 本地 fork 记录

## 基线身份

- 包：`pinets@0.9.34`
- 上游 tag：`v0.9.34`
- 上游 commit：`beacd587e83aa7ee061023f8cea66b2e887d5676`
- 本地 patch revision：`quant-tools-g4b.3`
- 本地目录：`packages/pinets`
- 机器可读身份：`packages/pinets/fork-build-info.json`
- 编译期身份：`packages/pinets/src/build-info.ts`

`fork-build-info.json` 与源码常量必须逐字段一致。应用不在运行时读取 Git，也不依赖 LuxAlgo 网站；fingerprint 会随本地源码进入浏览器构建，确保离线部署仍能确定实际执行版本。

## 当前本地改造边界

本地 fork 是 Pine 解析、运行时和 Broker Emulator 的源码依赖。当前 G4b 改造在既有结算报告标量之外，新增逐 K 的 close mark-to-market equity、close underwater、累计 intrabar 最大回撤和首次真实 Fill 锚定的 benchmark 历史；forming bar 采用可回滚的尾点替换。G4b.3 继续导出引擎原有的 account currency、最大持仓峰值和 trade bar index。当前工作树另有 G8 第一版：在显式 lower-timeframe envelope 且覆盖校验通过时，Broker Emulator 对子 K 线执行四点路径回放；不支持映射或数据不完整时保持 chart-OHLC 并发布 fallback reason。该增量尚未覆盖完整 raw order/fill ledger、所有 `calc_on_*`/复合订单语义或 TradingView 逐 Fill 对账，不能宣称完全等价。

构建身份包含版本、上游 SHA、本地 patch revision、报告 schema、sentinel 和 fingerprint。修改任何会影响执行结果或报告合同的源码时，都必须递增 patch revision；修改报告结构时还必须递增 report schema，并同步 Vela-PineTS 的内嵌身份。

## 更新规则

1. 先记录新上游 tag、commit、tarball integrity 和零修改行为基线。
2. 在独立提交中导入上游源码，不能与本地功能补丁混合。
3. 重放本地补丁并处理冲突，更新 `fork-build-info.json` 与 `src/build-info.ts`。
4. 同步 `packages/vela-pinets/src/build-info.ts` 中内嵌 PineTS 身份；遗漏会被依赖契约拒绝。
5. 对固定 Binance BTCUSDT fixture 比较编译结果、逐笔交易与汇总，再运行完整应用非回归。

## 必过验证

```sh
npm run check:dependencies
npm --workspace packages/pinets test -- --run
npm run build:forks
npm test
npm run build
```

PineTS 上游全量测试包含联网用例；网络失败必须单独记录，不能用跳过结果代替离线契约、固定 fixture 和应用回归的成功证据。
