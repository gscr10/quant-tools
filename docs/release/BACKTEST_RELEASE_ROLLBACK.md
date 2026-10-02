# 回测工作区发布、断网与回滚证据

本文把“生产产物在断网环境可启动”和“发布回滚到上一份制品”分成两类证据，避免把
浏览器路由 mock、kill switch smoke 或一次 fresh clone 构建误报成完整 rollback。

## 当前已实现的断网 smoke

```bash
npm run test:e2e:offline
```

该命令先从当前源码重新生成生产 `dist/`，再启动独立的 Vite production preview。
Playwright 在浏览器上下文中中止所有非本地 HTTP(S) 请求，不 mock Binance、Hyperliquid
或任何 CDN；因此它验证的是“网络断开时应用壳仍可启动”，不是“无行情数据也能绘图”。

允许出现的被阻断请求只有已登记的行情 Provider：

- `api.binance.com`
- `api.binance.us`
- `fapi.binance.com`
- `api.hyperliquid.xyz`

这些请求会被计数并输出为 `providerAttempts`，但不会访问真实网络。任何其它外部域名、
`app.luxalgo.com`/`*.luxalgo.com`、页面异常或旧 Workspace 控件缺失都会使命令失败。通过
条件是：HTTP 200、Favorites/Templates/Pine Editor/Backtest host 各只挂载一次，Indicators
可打开，且 `pageErrors=0`、`unexpectedExternalHosts=[]`、`luxalgoHosts=[]`。

本次本地 production preview 证据：

```json
{
  "mode": "production-preview-offline",
  "status": 200,
  "blockedExternalRequests": 6,
  "providerAttempts": 6,
  "blockedHosts": [
    "api.binance.com",
    "api.binance.us",
    "api.hyperliquid.xyz",
    "fapi.binance.com"
  ],
  "unexpectedExternalHosts": [],
  "luxalgoHosts": [],
  "websocketAttempts": [],
  "pageErrors": [],
  "workspace": {
    "favorites": 1,
    "templates": 1,
    "pineEditor": 1,
    "backtestHost": 1
  }
}
```

这条结果不能替代 `npm run test:e2e:prod` 的本地 Provider fixture、`npm run
test:providers` 的真实 Provider smoke，也不能证明完全离线时有可用 K 线缓存。它的作用是
防止生产 bundle 在断网时因参考站、CDN、远程字体/图标或其它未登记服务而阻塞旧 Workspace。

## 当前已实现的独立性与禁用证据

以下命令互相补充：

```bash
npm run check:dist:independence
npm run test:e2e:prod
npm run test:e2e:kill-switch
```

`check:dist:independence` 是静态产物扫描；生产 E2E 使用本地确定性 Provider 路由并断言
未登记请求和 LuxAlgo 请求为零；kill switch 则确认 `VITE_ENABLE_BACKTESTING=false` 时
不创建回测 host、不写改 Workspace，并且旧工具栏、Indicators、Pine Editor、Templates
仍可使用。三者都不是上一版本制品回滚。

发布候选和上一版本的可复制身份可用只读 manifest 记录（将 stdout 保存到发布 artifact，
命令本身不会写入仓库）：

```bash
node scripts/release-manifest.mjs --require-clean --require-dist \
  > /tmp/quant-tools-release-manifest-candidate.json
```

manifest（`schemaVersion=1`）包含 commit/branch、工作树状态、Node/npm、`package-lock.json` SHA-256 以及
`dist/` 每个文件的大小和 SHA-256。输出文件应放在仓库外的发布 artifact 目录；否则重定向
文件本身会使 `--require-clean` 看到未跟踪文件。上一版本应在其独立源码 checkout/构建目录
执行同一命令后保存为 `release-manifest-previous.json`；也可以用当前版本脚本通过
`--root <previous-checkout>` 为尚未包含该脚本的旧版本生成同格式 manifest；不要用当前目录的
hash 冒充上一版本。

生成后必须在目标 checkout 上做只读校验，避免只保存“看起来像 manifest”的 JSON：

```bash
node scripts/release-manifest.mjs --root "$CANDIDATE" --require-clean --require-dist \
  > "$ARTIFACTS/release-manifest-candidate.json"
node scripts/release-manifest.mjs --root "$PREVIOUS" --require-clean --require-dist \
  > "$ARTIFACTS/release-manifest-previous.json"
node scripts/verify-release-manifest.mjs --root "$CANDIDATE" \
  --manifest "$ARTIFACTS/release-manifest-candidate.json" --require-clean
node scripts/verify-release-manifest.mjs --root "$PREVIOUS" \
  --manifest "$ARTIFACTS/release-manifest-previous.json" --require-clean
```

`verify-release-manifest` 会校验 commit/branch、Node/npm、工作树状态、lockfile SHA/字节数、
`dist/` 文件集合及每个文件 SHA/字节数；它不会 checkout、reset、构建或删除文件。artifact
必须放在 checkout 之外，避免 manifest 自身污染 clean 状态。

回滚前后的浏览器存储不能直接比较原始 localStorage 字节：Vela 会规范化 JSON，脚本/收藏/模板
仓库也会更新 `savedAt`，运行时报告可能带 revision 字段。使用 schema-aware 对账工具保留原始
hash，同时对键排序并去除已登记的运行时字段（不会输出脚本、账户或 Workspace 内容）：

```bash
node scripts/storage-reconciliation.mjs \
  --before "$ARTIFACTS/storage-before.json" \
  --after "$ARTIFACTS/storage-after.json" \
  > "$ARTIFACTS/storage-reconciliation.json"
```

只有 `equal=true`、`changed=[]` 且 `issues=[]` 才能把持久化恢复记为通过；如果出现未知 key、
解析失败或用户字段差异，必须保留 `PARTIAL`，不能用 canonical hash 静默掩盖变化。工具会列出
问题所在的 storage/key 和原因，但不会打印对应值。

## 尚未关闭的真实 rollback Gate

当前仍缺一份“候选制品 → 触发阈值 → 上一份已验证制品”的真实切换记录。发布前必须在独立
临时目录或部署环境执行，不能在用户当前工作树上 checkout、reset 或清理文件：

1. 记录候选与上一版本的完整 commit SHA、`package-lock.json` SHA256、`dist/` 文件清单及每个
   文件 SHA256；同时保存 Node/npm、构建时间和 `check:dependencies` 输出。
2. 对候选制品运行 `test:regression:existing`、`npm test`、类型检查、build、`test:e2e:prod`、
   `test:e2e:offline`、`test:e2e:kill-switch`、Provider smoke 和 `check:dist:independence`。
3. 在临时浏览器 Profile 中保存 Workspace、个人脚本、收藏和模板快照；切换到候选制品并
   人为触发一个已定义阈值（例如回归失败、未登记外部请求、资源计数不归零或性能超标）。
4. 将服务切回上一份已验证制品（按部署平台的原子版本指针/容器 digest 操作），清空浏览器
   HTTP 缓存后强制刷新；不要删除或改写持久化 Workspace 数据。
5. 在回滚版本上重新运行既有回归、production E2E、offline smoke、Provider smoke 和
   `npm run test:regression:existing`；读取旧脚本、收藏、模板，比较 Storage/schema 字节和
   DOM/请求/生命周期计数。
6. 将触发原因、候选/回滚 SHA 与 artifact hash、命令完整输出、浏览器/Node 版本和最终
   Storage 对账写入本文件或发布记录；若任一项缺失，状态保持 `PARTIAL`。

推荐使用临时 worktree/临时部署目录完成第 2–5 步。不得在主工作树使用
`git reset --hard`、`git checkout --` 或递归删除；本地源码、用户脚本与 lockfile 必须可恢复。

## 证据状态

| Gate | 状态 | 说明 |
| --- | --- | --- |
| 生产产物静态独立性 | PASS | `check-dist-independence` 已有记录 |
| 生产 Preview + 本地 Provider E2E | PASS | `test:e2e:prod` 已有记录 |
| Backtesting kill switch | PASS | `test:e2e:kill-switch` 已有记录 |
| 断网生产壳 smoke | PASS | `test:e2e:offline`；Provider 请求仅计数并阻断 |
| 上一份已验证制品真实回滚 | PARTIAL | 已完成独立 worktree、同端口候选→上一版本切换和启动 smoke；尚缺生产平台原子 slot/容器切换证据 |
| 回滚后完整回归与 Storage/schema 对账 | PARTIAL | 已完成候选/上一版本 manifest 校验、共享浏览器 Storage 对账和关键页面 smoke；尚缺上一版本全套回归与 Provider/offline 重跑 |

## 2026-09-28 隔离回滚演练（PARTIAL，不得视为通过）

在主工作树之外使用临时 worktree
`/private/tmp/quant-tools-rollback.wXPCry` 做了候选 → 上一版本 → 候选的槽位切换
演练。主工作树没有 checkout、reset 或清理。候选和上一版本的身份分别为：

- 候选：`be1d824dc4dd2d862ae0bb73a69af2bb7f0a4258`
- 上一版本：`b3ed3669c39ce73075ed3500308e40350edd699b`

两份 worktree 均为 clean；候选执行 `npm run test:regression:existing` 为 `21/21`，
`npm run check:dist:independence -- --json` 为 `forbiddenMatches=[]`，候选
`release-manifest.mjs --require-clean --require-dist` 可解析。上一版本没有
`release-manifest.mjs`，只能保存一份标记为 `manifestKind=compatibility-generated` 的
只读清单，不能冒充同一格式的正式上一版本 manifest。原始证据保存在 worktree 外：

```text
/private/tmp/quant-tools-rollback.wXPCry/artifacts/release-manifest-candidate.json
/private/tmp/quant-tools-rollback.wXPCry/artifacts/release-manifest-previous-compat.json
/private/tmp/quant-tools-rollback.wXPCry/artifacts/rollback-slot-smoke.json
```

槽位 smoke 的三阶段页面和关键 Workspace/Backtest 节点均存在，且没有页面异常；不过
它报告 `previousStorageByteEqual=false`、`candidateStorageByteEqual=false`，因为原演练
比较了包含运行时 revision/时间字段的原始 `localStorage` 字节，尚未完成按 schema 去除
运行时字段后的用户数据哈希对账。因此这不是“持久化无损”的证据。另有 42 个外部请求，
其中出现 `crypto-icons.ledger.com`；这是 Vela 内置 Binance/Hyperliquid symbol icon
resolver 的运行时 CDN，不是参考站域名，但当前断网门禁的登记列表没有它，故不能把该次
运行当作“零未登记外部资源”。当前代码已在 Quant integration 边界默认关闭该可选 resolver，
Vela 会显示本地 initials badge；只有显式调用
`createWorkspaceProviders({ remoteSymbolIcons: true })` 才会恢复该远程图标依赖。下一次演练需重新生成候选/上一版本
制品并确认 icon host 不再出现，不能用历史 42 请求结果替代。

结论：本次演练证明了临时 worktree、候选/上一版本身份和基础回归流程可执行，但真实回滚
Gate 仍为 `PARTIAL`。在完成 schema-aware Storage 对账、基于新 icon 策略的候选/上一版本
正式 manifest 以及回滚后清缓存/完整 E2E 复核前，保持表格中的 `NOT STARTED`/`PARTIAL` 状态。

本次补充的 `release-manifest --root`、`verify-release-manifest` 与
`storage-reconciliation` 只关闭了“证据工具缺失”这一工程缺口，并不把上述隔离演练自动升级
为 PASS；候选/上一版本仍需在独立部署槽位完成清缓存切换、完整回归和外部 icon 依赖决策。

## 2026-09-29 独立制品切换补充（PARTIAL）

本次在主工作树之外重新构建并验证了候选与上一版本制品，未在主工作树执行 checkout、reset
或清理操作：

- 候选 worktree：`9424715308b6617f239134d16966604aaf373af6`
- 上一版本 worktree：`99972941a72d6bcb5e2ff8fe2abd01cdc1dd18ad`
- 候选与上一版本均在 Node `v24.15.0` / npm `11.13.0` 下成功 `npm run build`。
- 两份 manifest 均通过 `verify-release-manifest --require-clean`，包含 lockfile SHA256、完整
  `dist/` 文件清单和逐文件 SHA256。候选产物为 4,141,798 bytes，上一版本产物为
  4,132,398 bytes。
- 将候选 preview 与上一版本 preview 依次绑定到同一 `127.0.0.1:4197` 端口，使用同一浏览器
  Storage 进行候选→上一版本切换。上一版本启动返回 HTTP 200，无 page error；Backtest
  Workbench、Dock、Viewer 及既有工具栏均能挂载。
- Storage 对账结果为 `equal=true`、`changed=[]`、`issues=[]`。对账使用真实认可的
  Workspace、Favorites、Templates schema；Workspace 的运行时 `panels`/revision 字段按工具
  规则忽略，用户字段未发生变化。
- 页面未请求 `luxalgo.com`；候选和上一版本均可在本地 preview 独立启动。

证据文件保存在仓库外，避免污染工作树：

```text
/tmp/quant-candidate-manifest.json
/tmp/quant-candidate-verify.json
/tmp/quant-rollback-AFhZeS-previous-manifest.json
/tmp/quant-previous-verify.json
/tmp/rollback-storage-reconciliation.json
```

上一版本初次构建暴露了旧 checkout 的 `packages/pinets/tsconfig.dts.json` 使用本地
`typeRoots`、而临时 worktree 没有依赖目录的问题；在临时 worktree 中仅建立显式依赖符号链接后
构建成功，随后移除符号链接并以 clean tree 重新生成 manifest。该问题是隔离构建环境问题，不是
应用代码失败，也不应把共享 `node_modules` 作为发布制品依赖。由于尚未接入真实部署平台的
原子 slot 指针、清缓存操作和上一版本完整测试矩阵，本证据仍保持 `PARTIAL`，不能宣称正式
生产 rollback Gate 已 PASS。
