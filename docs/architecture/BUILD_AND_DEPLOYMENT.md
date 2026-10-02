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
```

测试和开发启动会通过 `scripts/ensure-fork-build.mjs` 检查 fork 的 `dist` 是否存在且
不早于源码、构建配置和 lockfile；只有缺失或过期时才重建，避免每次启动都重复执行
完整 fork 构建。不要直接运行裸 `vite` 作为 fresh checkout 的验证命令，因为它会绕过
该前置检查。

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

构建会把当前 Git commit 的短 ID 注入顶部工具栏版本标识；CI/无 `.git` 环境可通过
`VITE_COMMIT_ID` 显式传入，未提供时显示 `dev`。

## 当前非阻塞事项

主应用 bundle 仍有大 chunk warning。Highcharts 已经按功能动态加载；后续应基于 gzip
体积和启动耗时建立 threshold，再决定是否拆分其他依赖，不以消除 warning 作为唯一目标。
