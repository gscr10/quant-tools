# Quant Tools

基于 LuxAlgo Vela Workspace 和 PineTS 构建的独立图表与 Pine 指标工作区。

## 开发命令

```bash
npm ci
npm run dev
npm test
npm run test:regression:existing
npm run build
npm run test:e2e
npm run test:e2e:prod
npm run test:providers
```

本地完整浏览器回归：

```bash
python3 -m pip install playwright
npm run test:e2e
```

`test:e2e` 会临时启动 Vite 开发服务器和无界面 Chromium，验证多图布局、侧栏、指标管理、个人脚本、收藏、撤销重做、截图、模板、刷新恢复和应用销毁重建。`test:e2e:prod` 会先构建，再对生产预览执行同一套核心业务回归。macOS 会自动使用 `/Applications/Chromium.app`；其他环境可通过 `CHROMIUM_EXECUTABLE` 指定浏览器。

`test:e2e` 使用确定性的模拟行情，不依赖交易所网络。`test:providers` 单独连接 Binance 和 Hyperliquid 的公开接口，验证真实历史 K 线和实时订阅，因此需要可访问外网。

E2E 还会在每个 BrowserContext 安装离线网络守卫：本地 Vite 页面和明确注册的 Binance/Hyperliquid/icon mock 可以继续运行，其他未被 mock 接管的 HTTP(S) 请求会被阻断并计入失败；主回归和生产 Preview 都要求 `blockedExternalRequests=0`、`luxalgoRequests=0`。因此 E2E 的独立运行结论不依赖参考站或任何远程页面资源；只有 `test:providers` 是有意保留的真实外网连通性检查，不应与离线 E2E 混为一谈。

`test:regression:existing` 只运行回测接入前的架构、存储和既有功能回归集，用于与回测新增测试分开对账；每个回测实现 Gate 都必须先通过该命令，再运行完整的 `npm test`。

## 架构

- `src/main.ts`：应用启动和 HMR 销毁入口。
- `src/app`：Composition Root、生命周期和 Vela 图标注册。
- `src/domain`：纯业务模型、Pine 源码规则和应用端口。
- `src/features`：收藏、指标、Pine 编辑器、Workspace Templates 和 Backtesting Viewer/Workbench。
- `src/integrations/vela`：Workspace、Provider、Pine Engine、事件、扩展状态和 Backtest Adapter 集成。
- `src/integrations/storage`：个人脚本、草稿、收藏、模板和 legacy layout repository。
- `src/shared`：无业务含义的通用 DOM、Dialog、Popover 和数据校验。
- `src/config`：平台指标和 Workspace 静态配置。

依赖方向：

```text
main → app（组合与生命周期）
          ├→ features → domain ports
          └→ integrations → domain ports

Backtesting 的 `Controller/Store` 位于 `src/app` 与 `src/features/backtesting`，通过
`src/integrations/vela/backtest-*` 适配 Vela；Viewer 不直接依赖 Vela 或 Provider。

integrations/storage → localStorage
integrations/vela    → Vela / Provider
integrations/pinets  → Vela-PineTS / PineTS
```

详细边界、实施阶段和验收标准见 [ARCHITECTURE_REFACTOR_PLAN.md](docs/architecture/ARCHITECTURE_REFACTOR_PLAN.md)。

## 开源依赖边界

Vela 主包继续使用精确锁定的 registry `@luxalgo/vela@0.7.7`；PineTS 与
Vela-PineTS 已导入 `packages/pinets`、`packages/vela-pinets`，并通过 npm
workspace 的 `file:` 依赖在本地构建。这样 Worker 会随本地引擎一起重建，且
fresh checkout 不依赖对 `node_modules` 的手工修改。上游来源、tag/SHA、完整性
和当前解析方式见 [`docs/forks/DEPENDENCY_BASELINE.md`](./docs/forks/DEPENDENCY_BASELINE.md)。

应用架构调整只作用于项目自身的功能和集成层；本地 fork 的后续差异必须保留
可审计的上游基线、构建记录和回归证据。

高精度回测引擎改造、云端脚本持久化和进一步的构建体积优化不属于本次等价架构重构，相关事项记录在 [回测 TODO](./docs/backtesting/current/TODO.md)。

回测当前计划、状态矩阵和回归基线见
[docs/backtesting/README.md](./docs/backtesting/README.md)。完整文档导航见
[docs/README.md](./docs/README.md)。审计截图、原始响应和历史复查材料保存在本地或
私有归档中，不作为线上构建仓库内容。

贡献方式见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题请见 [SECURITY.md](./SECURITY.md)。
