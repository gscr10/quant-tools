# Quant Tools

基于 LuxAlgo Vela Workspace 和 PineTS 构建的独立图表与 Pine 指标工作区。

## 开发命令

```bash
npm ci
npm run dev
npm test
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

## 架构

- `src/main.ts`：应用启动和 HMR 销毁入口。
- `src/app`：Composition Root、生命周期和 Vela 图标注册。
- `src/domain`：纯业务模型、Pine 源码规则和应用端口。
- `src/features`：收藏、指标、Pine 编辑器和 Workspace Templates。
- `src/integrations/vela`：Workspace、Provider、Pine Engine、事件和扩展状态集成。
- `src/integrations/storage`：个人脚本、草稿、收藏、模板和 legacy layout repository。
- `src/shared`：无业务含义的通用 DOM、Dialog、Popover 和数据校验。
- `src/config`：平台指标和 Workspace 静态配置。

依赖方向：

```text
main → app（组合与生命周期）
          ├→ features → domain ports
          └→ integrations → domain ports

integrations/storage → localStorage
integrations/vela    → Vela / Provider
integrations/pinets  → Vela-PineTS / PineTS
```

详细边界、实施阶段和验收标准见 [ARCHITECTURE_REFACTOR_PLAN.md](./ARCHITECTURE_REFACTOR_PLAN.md)。

## 开源依赖边界

Vela、Vela-PineTS 和 PineTS 均通过 npm 依赖使用。本仓库不复制或直接修改其 `node_modules` 源码。应用架构调整只作用于项目自身的功能和集成层。

高精度回测引擎改造、云端脚本持久化和进一步的构建体积优化不属于本次等价架构重构，相关事项记录在 [TODO.md](./TODO.md)。
