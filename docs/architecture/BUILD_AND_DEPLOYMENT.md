# 构建与部署说明

公开 `master` 分支只依赖仓库内源码、workspace fork、锁定依赖和必要文档；
审计附件不会参与构建。

## 首次安装或 fork 源码变更

```bash
npm ci
npm run build
```

`npm run build` 会先构建 `packages/pinets` 和 `packages/vela-pinets`，再构建主应用。

## 日常开发和测试

```bash
npm test
npm run dev

# 已确认 fork 产物未过期时的快速开发入口；过期时会失败并提示先构建，
# 不会静默使用旧产物。首次安装或修改 fork 源码后不要使用该入口。
npm run dev:fast

# 只校验 fork 产物，不启动 Vite；适合 CI 或启动前检查
npm run dev:fast -- --check-only

# 按 HTTP 实际响应判断服务就绪，不使用固定 sleep
npm run wait:dev -- --url http://127.0.0.1:5173/

# 一次执行本地启动优化门禁（不包含真实网络 Provider smoke 和浏览器 E2E）
npm run verify:startup

# 可选真实 Provider 三轮 soak（会实际访问 Binance/Hyperliquid）
npm run test:providers:soak

# 部署前长时短样本 soak（10 轮；会实际访问 Binance/Hyperliquid）
npm run test:providers:long

# 部署前完整预检：本地构建门禁 + 10 轮真实 Provider soak
npm run verify:startup:deploy

# 完整本地验收：快速门禁 + 启动性能 + Provider soak + E2E/离线/性能/a11y
npm run verify:startup:full

# 受控启动性能 ABBA 矩阵（默认每组 20 次，证据写入被忽略目录）
npm run test:startup:matrix
```

该门禁会先运行根测试和 Vela-PineTS fork 测试，再执行类型、构建、Bundle、依赖、仓库卫生、dist 独立性和 release 校验。

`verify:startup` 同时执行仓库卫生检查：`audit-evidence/`、`docs/audit/`、`dist/` 和
`node_modules/` 不得被 Git 跟踪，并要求 `audit-evidence/` 保持在忽略规则中，避免审计附件或本地生成物进入部署分支。

`verify:startup:full` 会额外执行三次样本的启动矩阵，并以每个矩阵单元
5 秒首绘 p95 作为回归保护，同时覆盖 localStorage getter/methods/quota 故障启动探针、真实 Provider soak、主流程/Settings/
故障隔离/多 Cell、开发/生产/三浏览器 E2E、离线 smoke、严格性能和视觉无障碍检查；另外在 Chromium、Firefox、WebKit 各执行一次 0 秒索引/行情延迟启动探针，覆盖事件同 tick 到达时的初始化竞态。该阈值只是本地自动回归护栏，
不代表跨机器或长时间生产网络延迟已经验收。

需要更大样本时可显式启用同一护栏：

```bash
npm run test:startup:matrix -- --samples 20 --max-p95 5000
```

不传 `--max-p95` 时，矩阵只采集并输出性能证据；传入后超出阈值或出现失败
样本会返回非零退出码。

测试和开发启动会通过 `scripts/ensure-fork-build.mjs` 检查 fork 的 `dist` 是否存在且
不早于源码、构建配置和 lockfile；只有缺失或过期时才重建，避免每次启动都重复执行
完整 fork 构建。`npm run dev:fast` 使用同一份指纹校验但不触发构建，适合已知产物
未变化的连续开发；校验失败时请改用 `npm run build:forks` 或普通 `npm run dev`。
不要直接运行裸 `vite` 作为 fresh checkout 的验证命令，因为它会绕过该前置检查。

## Vite 入口边界

根应用只扫描根 `index.html`。`packages/vela-pinets/playground/` 是 fork 自己的开发
示例，使用它自己的 `inline-worker:` 插件，不属于主应用依赖图；主应用使用构建后的
workspace package exports，因此不需要复制 playground 插件。

## 线上部署

服务器从 `master` 拉取后执行：

```bash
npm ci
npm run build
npm run preview -- --host 0.0.0.0
```

服务就绪以日志出现 `VITE ... ready` 或实际 HTTP 200 为准，不使用固定 sleep 推断。

部署前可执行独立制品门禁，验证 fork 构建锁、manifest、Storage 对账和本地
candidate/previous rollback 闭环：

```bash
npm run test:release
```

Manifest 生成和验证都会拒绝 `dist` 中的符号链接，确保发布包记录和实际服务字节
不依赖 tar/rsync 的链接解析策略，也不能通过链接越过 `dist` 根目录。

该命令验证的是本地制品流程；真实部署槽位、CDN 缓存和跨机器回滚仍需线上验收。

发布 manifest 对 `dist/` 采用 fail-closed 规则：目录内必须是普通文件和目录，
发现符号链接会在生成或校验阶段直接失败。这样可以避免不同部署工具对链接的跟随、
打包或跨目录解析产生未被 SHA-256 manifest 覆盖的内容。

构建会把当前 Git commit 的短 ID 注入顶部工具栏版本标识；CI/无 `.git` 环境可通过
`VITE_COMMIT_ID` 显式传入，未提供时显示 `dev`。

## 当前非阻塞事项

主应用 bundle 仍有大 chunk warning。Highcharts 已经按功能动态加载；后续应基于 gzip
体积和启动耗时建立 threshold，再决定是否拆分其他依赖，不以消除 warning 作为唯一目标。
