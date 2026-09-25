# Quant Tools 架构拆分改造计划（最终版）

> 版本：3.0  
> 日期：2026-09-25  
> 文档状态：最终版  
> 实施状态：Phase 0—6 已完成并通过验收；Phase 7 为后续独立优化  
> 改造性质：应用层等价重构，不改变现有产品功能和底层引擎行为

## 0. 执行摘要与已确定结论

本项目采用“模块化单体 + Ports/Adapters 边界”的改造方案。保留一个 Vite 前端应用，不拆微前端和多 npm package；`Vela Workspace` 继续作为图表内核，`PineWorkerEngine` 继续作为 Pine 执行入口，Binance/Hyperliquid Provider 继续由 Vela 提供。

本次只重构 Quant Tools 自己的应用层和集成层，不复制、不拆解、不直接修改 Vela、Vela-PineTS、PineTS 的上游源码或 `node_modules` 产物。现有工具栏、指标管理、个人脚本、收藏、模板、布局恢复和行情行为均属于必须保留的回归基线。

最终执行顺序固定为：

```text
冻结行为基线
  → 建立应用生命周期
  → 提取领域模型、端口和存储适配器
  → 收口 Vela/PineTS 边界
  → 逐功能迁移
  → 样式与遗留代码收口
  → 全量验收
```

以下事项与架构拆分解耦，不阻塞本计划：

- 自建脚本的服务端/云端持久化：保持“待讨论”，本次只预留 Repository 替换边界。
- PineTS 高精度回测/Bar Magnifier：继续按 `TODO.md` 独立立项，不混入等价重构。
- 首屏体积和懒加载：在结构改造通过后独立优化。
- Vela、Vela-PineTS、PineTS 升级或 Fork：按独立依赖升级流程执行。

## 1. 背景

改造基线已经完成 Vela Workspace、PineTS、Binance、Hyperliquid、指标管理、个人 Pine 脚本、指标收藏和工作区模板等功能集成，但应用层逻辑曾主要集中在 `src/main.ts`，样式也主要集中在 `src/style.css`。实施过程中即使工作区已经出现候选拆分文件，也必须按本文的阶段 Gate 验收，不能以“文件已移动”代替架构完成。

改造前主要结构问题：

- `src/main.ts` 同时承担应用启动、Vela 插件注册、Workspace 创建、指标管理、收藏、Pine 编辑器、模板、弹窗、持久化协调和事件监听。
- `workspace`、`editorPanel`、`indicatorManager`、`openPopover` 等全局可变状态使功能之间形成直接依赖。
- Pine 编辑器、指标管理器和收藏逻辑相互直接调用，后续增加回测、云端脚本、账户和新数据源时会继续放大耦合。
- 应用代码直接读取 `workspace.active.instances`、`libraryRows()`、`onChartRows()`、`nativeCatalog` 等 Vela 运行时结构，升级 Vela 时影响面较大。
- `src/storage.ts` 同时管理个人脚本、编辑器草稿、旧布局、指标收藏和工作区模板。
- 当前自动化测试主要覆盖存储层，UI 和 Vela 集成行为缺少回归保护。
- Vela contributions、Workspace/Chart/Indicator 事件和全局 DOM 监听没有统一的注册、注销和销毁生命周期。

本次改造的目标不是简单地把大文件切割成小文件，而是建立稳定的功能边界、状态归属、依赖方向和生命周期。

## 2. 当前技术基线

| 层级 | 当前组件 | 用途 |
| --- | --- | --- |
| 图表与工作区 | `@luxalgo/vela@0.7.7` | 图表、工具栏、多图布局、绘图、指标宿主和 Workspace 状态 |
| Pine 桥接层 | `@luxalgo/vela-pinets@0.2.13` | 将 PineTS 作为 Vela 脚本引擎运行 |
| Pine 引擎 | `pinets@0.9.34` | Pine Script 解析和执行 |
| 编辑器 | CodeMirror 6 | Pine 源码编辑、快捷键和错误行显示 |
| 数据源 | Vela Binance/Hyperliquid Provider | 历史和实时 OHLCV 数据 |
| 应用存储 | `localStorage` | 个人脚本、草稿、收藏、模板和 Workspace 状态 |
| 构建 | TypeScript + Vite | 类型检查和前端构建 |

最终验收时的可执行基线：

- `npm test`：18 项测试通过。
- `npm run build`：构建通过。
- `npm run test:e2e`：开发模式完整浏览器回归通过。
- `npm run test:e2e:prod`：生产构建与 Preview 完整浏览器回归通过。
- `npm run test:providers`：Binance、Hyperliquid 历史和实时 OHLCV 验证通过。
- 生产构建主 JavaScript 为 3,316.00 kB、gzip 891.80 kB；相对改造前分别增加 7.21 kB 和 2.96 kB，原因是新增生命周期、Service、Adapter 和兼容校验，未改变功能加载范围。
- 拆分后的生产 CSS 与改造前构建产物 SHA-256 完全一致。

改造前基线 Git SHA 为 `35d07aa`。基础依赖版本和 lockfile 在改造期间保持不变，详细证据见第 17 节。

## 3. 改造目标

### 3.1 核心目标

1. 将 `src/main.ts` 缩减为应用启动入口。
2. 按功能划分指标管理、Pine 编辑器、工作区模板等模块。
3. 将 Vela、PineTS 和存储实现隔离在明确的集成边界内。
4. 消除跨功能的全局可变状态和双向直接调用。
5. 明确每类状态的唯一数据源和兼容策略。
6. 建立统一的初始化、订阅、注销和销毁生命周期。
7. 为后续回测、云端脚本、新数据源和账户功能保留稳定扩展点。
8. 在不改变现有行为的前提下建立可持续回归测试。

### 3.2 非目标

本次改造不包含：

- 不修改或 Fork Vela、Vela-PineTS、PineTS 源码。
- 不升级上述基础依赖版本。
- 不改变 Binance、Hyperliquid 的数据请求逻辑。
- 不实现高精度历史回测或 Bar Magnifier。
- 不引入真实 Tick、订单簿或撮合系统。
- 不设计自建脚本的云端持久化方案。
- 不改变现有 localStorage key 和已保存数据格式。
- 不重新设计现有 UI、交互和工具栏功能。
- 不在结构迁移阶段同步进行大规模性能优化。

## 4. 基础开源项目边界

当前项目通过 npm 依赖使用 Vela 和 PineTS，仓库内没有它们的上游源码副本。`node_modules` 和 `dist` 不纳入 Git。

本次会拆分和整理的是项目自身的应用代码以及调用 Vela 的集成代码，不会拆解基础开源项目本身。

### 4.1 保持不变的底层能力

- `VelaWorkspace` 继续作为图表和工作区核心。
- `BinanceProvider` 和 `HyperliquidProvider` 继续由 Vela 提供。
- `PineWorkerEngine` 继续作为 Pine 引擎入口。
- Vela 原生指标、工具栏、对象树、数据窗口和绘图能力保持不变。
- Workspace state 继续由 Vela 编码、恢复和持久化。

### 4.2 允许整理的集成代码

- `VelaWorkspace` 的配置和创建代码。
- Vela Widget、Legend、SidePanel 和 StatePersistence contributions。
- 对 `workspace.active`、`workspace.context()`、Chart 和 IndicatorHandle 的应用层调用。
- Vela 事件到应用功能的映射。
- Pine 编辑器、指标管理器、收藏和模板与 Vela 的连接代码。

### 4.3 后续底层改造边界

如果未来实现 PineTS 高精度回测，应作为独立的引擎项目或独立维护的依赖版本进行，不直接修改本项目的 `node_modules`。该工作不属于本次架构拆分。

## 5. 架构原则

### 5.1 模块化单体

项目继续保持单一前端应用，不拆微前端、不拆多个 npm package。按业务功能纵向组织用例、UI、Vela contribution 和测试；跨功能稳定模型与端口统一放在 `domain`。

### 5.2 单向依赖

```text
main.ts
   ↓
app（组合根、协调、生命周期）
   ├──────────────→ features（用例与 UI）
   ├──────────────→ integrations（外部适配器）
   └──────────────→ domain（模型与端口）
                         ↑
features ────────────────┤
integrations ─────────────┘

integrations/storage ─→ localStorage
integrations/vela ─────→ Vela / Provider
integrations/pinets ───→ Vela-PineTS / PineTS
```

约束：

- `domain` 不依赖 `app`、`features`、`integrations`、Vela、CodeMirror 或浏览器全局对象。
- `features` 只能依赖 `domain`、`shared` 和自身内部模块；不得直接依赖另一个 Feature 的实现。
- `integrations` 只能依赖 `domain`、`shared`、`config` 和外部包；不得反向导入 Feature。
- `app` 是唯一允许同时组装 Feature 与 Integration 的 Composition Root。
- 业务 Service 不直接操作 DOM；Controller/View 不直接读写 localStorage。
- 只有 `integrations/vela/**` 和明确命名的 `*.vela.ts` 入站适配器可以直接导入 Vela。
- Feature 间协作使用领域端口、显式回调或只读订阅；不得直接引用对方的 Controller。
- 不引入全局 EventBus，避免形成新的隐式耦合。

允许的依赖矩阵：

| 来源 | 允许依赖 | 禁止依赖 |
| --- | --- | --- |
| `main.ts` | `app`、样式入口 | 具体 Feature、Vela 运行时 |
| `app` | `features`、`integrations`、`domain`、`shared`、`config` | 无边界的全局单例 |
| `features/<x>` | `domain`、`shared`、本 Feature；`*.vela.ts` 可额外依赖 Vela | 其他 Feature 实现、`app`、具体存储适配器 |
| `integrations/<x>` | `domain`、`shared`、`config`、对应外部包 | `features`、`app` |
| `domain` | 同层纯模块 | DOM、localStorage、Vela、CodeMirror、`features`、`integrations` |
| `shared` | 无业务含义的通用工具 | Feature 业务模型和具体外部实现 |

### 5.3 显式注册，禁止导入副作用

Vela contribution 模块统一导出 `registerXxx()`，由应用启动层显式调用。模块导入本身不注册按钮、侧栏或状态处理器。

### 5.4 小而明确的 Vela 边界

不复制 Vela 的完整 API，也不创建新的巨型 Gateway。只暴露项目真正使用的应用语义，例如：

- 添加脚本指标或原生指标。
- 删除和读取图上指标。
- 获取内置指标目录。
- 打开 Pine 编辑器侧栏。
- 获取和应用 Workspace state。
- 下载截图和发送 Toast。

### 5.5 等价迁移

每个阶段只调整结构，不趁机改变功能。功能优化、交互调整、存储升级和性能优化必须在架构迁移完成后独立排期。

### 5.6 端口只为真实变化点服务

只为已存在或明确可预见的外部边界定义端口：Workspace、脚本存储、编辑器状态、收藏、模板和未来数据 Provider 注册。纯内部函数不为了“看起来分层”额外包装接口。

端口应使用业务语义，不透出完整 Vela 对象、DOM 节点树或 localStorage 细节。若新增用例需要能力，按最小范围扩展端口，禁止把整个第三方 API 原样搬进 `WorkspacePort`。

### 5.7 以公开契约隔离功能实现

每个 Feature 只公开创建函数、Service 接口、必要模型和 `destroy()`；内部 Controller、DOM 选择器和临时状态不构成跨模块 API。跨 Feature 复用的纯规则上移到 `domain`，跨 Feature 编排留在 `app`，不得通过深路径导入另一个 Feature 的内部文件。

## 6. 目标目录结构

```text
src/
├── main.ts
├── app/
│   ├── create-app.ts
│   ├── lifecycle.ts
│   └── register-icons.vela.ts
├── config/
│   ├── platform-indicators.ts
│   └── workspace-options.ts
├── domain/
│   ├── indicators.ts
│   ├── scripts.ts
│   ├── pine-source.ts
│   └── ports/
│       ├── workspace-port.ts
│       ├── script-repository.ts
│       ├── editor-repository.ts
│       ├── favorite-repository.ts
│       ├── favorite-service.ts
│       └── template-repository.ts
├── integrations/
│   ├── vela/
│   │   ├── create-workspace.ts
│   │   ├── workspace-adapter.ts
│   │   ├── workspace-events.ts
│   │   ├── workspace-contributions.ts
│   │   ├── external-indicator-persistence.ts
│   │   └── provider-registry.ts
│   ├── pinets/
│   │   └── create-engine.ts
│   └── storage/
│       ├── json-store.ts
│       ├── script-repository.ts
│       ├── editor-repository.ts
│       ├── favorite-repository.ts
│       ├── template-repository.ts
│       └── legacy-layout-repository.ts
├── features/
│   ├── indicators/
│   │   ├── indicator-service.ts
│   │   ├── indicator-manager.vela.ts
│   │   ├── native-indicator-info.vela.ts
│   │   ├── indicator-contributions.vela.ts
│   │   └── indicators.css
│   ├── favorites/
│   │   ├── favorite-service.ts
│   │   └── favorite-popover.ts
│   ├── pine-editor/
│   │   ├── pine-editor-controller.ts
│   │   ├── script-service.ts
│   │   ├── pine-editor-contribution.vela.ts
│   │   └── pine-editor.css
│   └── workspace-templates/
│       ├── workspace-templates.ts
│       ├── template-contribution.vela.ts
│       └── workspace-templates.css
├── shared/
│   ├── dom.ts
│   ├── overlays.ts
│   ├── text-dialog.ts
│   ├── guards.ts
│   └── *.css
├── scripts/
│   └── library/
└── styles/
    ├── base.css
    └── responsive.css
```

目录结构表示责任边界，不要求机械地创建每一个示例文件。简单逻辑可以合并，但不能破坏依赖方向；当文件同时承担组合、业务、DOM 和第三方适配中的两类以上职责时才继续拆分，避免从“单一大文件”走向“过度碎片化”。

迁移期间允许保留 `src/storage.ts` 作为兼容导出门面；所有调用迁移完成后再删除。兼容门面不得继续增加新逻辑。`src/style.css` 作为稳定的 CSS 导入入口可以保留，它只负责按固定顺序 `@import` 各模块样式。

`lifecycle.ts` 是小型 DisposerStack，而不是新的业务框架；如果 `create-app.ts` 已能清晰地管理逆序销毁，也可先内联，达到复杂度阈值后再提取。`app-coordinator` 同理，不作为必须制造的空抽象。

最终 `src/main.ts` 仅负责启动：

```ts
import { createApp } from './app/create-app';
import './style.css';

const app = createApp('#workspace');

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}
```

## 7. 状态归属

| 状态 | 唯一数据源 | 说明 |
| --- | --- | --- |
| 图表、布局、绘图、原生指标 | Vela Workspace state | 使用现有 `quant-tools:workspace:v2` |
| 图上的外部 Pine 指标 | Vela Workspace state 的 `ext` | 使用 `quant-tools.external-indicators` contribution key |
| 个人脚本 | ScriptRepository | 保留 `vela-pine:scripts:v1` |
| 编辑器草稿 | EditorRepository | 保留 `vela-pine:editor:v1` |
| 指标收藏 | FavoriteRepository | 保留 `vela-pine:indicator-favorites:v1` |
| 工作区模板 | TemplateRepository | 保留 `vela-pine:workspace-templates:v1` |
| 旧版独立布局 | LegacyLayoutRepository | `vela-pine:layout:v1`，确认无兼容用途后再删除 |
| Dialog、搜索、Popover 状态 | 对应 UI Controller | 仅存在于当前页面内存 |

### 7.1 收藏兼容策略

当前 `SavedScript.favorite` 与独立指标收藏列表存在重复状态。本次改造采用以下策略：

1. `FavoriteService` 成为收藏读写的唯一业务入口。
2. `FavoriteRepository` 作为标准收藏数据源。
3. `SavedScript.favorite` 暂时作为旧数据和脚本菜单的兼容镜像。
4. 所有双写和迁移逻辑集中到 `FavoriteService`。
5. 本次不升级存储格式；删除重复字段需要以后单独设计 schema migration。

### 7.2 数据兼容要求

- 不修改现有 key。
- 不静默清除无法识别的数据。
- 解析外部输入和持久化 payload 时继续执行类型校验。
- 保存旧版本数据 fixture，持续验证新代码能够恢复旧数据。
- Workspace 模板中的 Vela `ext` 内容必须继续原样恢复。

## 8. 应用生命周期

应用启动顺序：

1. 创建基础存储适配器和各 Repository。
2. 创建 Feature Service，并在 Composition Root 中准备跨功能协调回调。
3. 注册图标、Widget Action、Legend Action、SidePanel 和 StatePersistence。
4. 保存每个 Vela 注册函数返回的 unregister disposer。
5. 创建 `VelaWorkspace`。
6. 创建指标管理器、Pine 编辑器等 UI Controller。
7. 绑定 Workspace、Chart 和 IndicatorHandle 事件。
8. 保存事件返回的 unsubscribe disposer。
9. 启动 DOM、Window 和 MutationObserver 监听。
10. 返回统一的应用实例。

应用实例契约：

```ts
interface QuantApp {
  readonly workspace: WorkspacePort;
  destroy(): void;
}
```

`destroy()` 必须：

- 防止重复执行。
- 关闭当前 Popover 和应用自建 Dialog。
- 清理编辑器草稿定时器。
- 删除 `document` 和 `window` 监听。
- 断开 MutationObserver。
- 取消 Workspace、Chart 和 IndicatorHandle 订阅。
- 销毁 Feature Controller。
- 调用 `workspace.destroy()`，刷新最后的 Workspace 持久化状态。
- 注销 Vela contributions。
- 确保重新创建应用后不会出现重复按钮、重复日志和重复响应。

图标注册没有对应 unregister，应使用固定 ID 并保持幂等注册。

## 9. 功能模块职责

### 9.1 Indicators

负责：

- On chart、Favorites、My indicators、Built-ins 四类指标数据组装。
- 原生指标和 Pine 指标的统一展示模型。
- 指标添加、删除、查看源码或实现信息。
- 顶部 Indicators 入口。
- 图例收藏和代码按钮。
- 指标管理 Dialog。

不负责：

- Pine 源码编辑器内部状态。
- Workspace state 的底层编码。
- 交易所数据请求。

### 9.2 Favorites

负责：

- 原生指标、平台 Pine 指标和个人 Pine 脚本的统一收藏模型。
- 收藏读写、去重、旧 `SavedScript.favorite` 兼容同步。
- 收藏快速菜单和收藏变化订阅。
- 顶部 Favorite indicators 入口。

收藏 Service 可通过领域端口注入 Pine Editor 和 Indicators，但两个 Feature 不互相导入实现。删除、重命名个人脚本触发的收藏同步必须经过单一用例，不能由多个 UI 各自双写。

### 9.3 Pine Editor

负责：

- CodeMirror 创建和销毁。
- 草稿恢复和延迟保存。
- 脚本新建、保存、另存、重命名和删除。
- 脏状态、脚本菜单、收藏入口和日志面板。
- Pine Run、错误日志和错误行定位。
- Pine 编辑器 SidePanel contribution。

不直接调用 IndicatorManager。脚本变化通过 ScriptService 订阅或 App Composition Root 通知其他功能。

### 9.4 Workspace Templates

负责：

- 获取当前完整 Workspace state。
- 保存、应用、查看和删除模板。
- 顶部模板入口和相关 Dialog/Popover。

模板内容继续使用 Vela 的完整 state，不自行拆解图表文档。

### 9.5 Integrations/Vela

负责：

- 创建和销毁 Workspace。
- 配置 Provider、Pine Engine、顶部工具栏和默认状态。
- 将 Vela 实例转换为应用需要的只读模型和命令。
- 管理外部 Pine 指标的 Vela `ext` 持久化。
- 将 Workspace、Chart、IndicatorHandle 事件映射为 `WorkspaceEventSink`，再由 App Composition Root 分发。

Vela 事件适配器不得反向导入 Pine Editor 等 Feature。标题解析等纯规则放到 `domain`，事件通过 `WorkspaceEventSink` 一类的小接口上送给 `app`。

### 9.6 Integrations/Storage

负责：

- JSON 读取、校验和写入。
- localStorage 不可用时的会话内存降级。
- 各类数据的 Repository API。
- 旧数据兼容和未来 schema migration 入口。

### 9.7 App / Composition Root

负责：

- 创建 Repository、Service、Adapter 和 Controller。
- 将跨 Feature 交互连接为显式回调或端口实现。
- 确保 Vela contribution 在 Workspace 创建前注册。
- 统一收集 disposer，并按初始化的逆序销毁。
- 处理 HMR 和重复挂载。

`app` 只做装配和流程协调，不承载指标分类、收藏规则、脚本解析或存储校验等业务逻辑。

### 9.8 最小公开契约

| 契约 | 必需能力 | 禁止泄漏 |
| --- | --- | --- |
| `WorkspacePort` | 添加/删除/读取指标、打开面板、状态读写、Toast、截图 | `workspace.active`、Chart 实例、Vela 内部集合 |
| `ScriptRepository` | `list/get/save/rename/delete` | localStorage key、JSON 结构细节 |
| `EditorRepository` | 草稿读取和保存 | 定时器、CodeMirror 状态 |
| `FavoriteRepository` | `list/replace` 或幂等 `set` | 兼容双写逻辑 |
| `TemplateRepository` | `list/save/delete` | Workspace state 内部拆解 |
| `WorkspaceEventSink` | 指标变化、脚本日志、脚本错误 | Vela EventBus 和 Handle 生命周期 |
| Feature Controller | `open/sync/destroy` 中实际需要的最小集合 | DOM 内部节点、其他 Controller 实例 |

Repository 端口位于 `domain/ports`，浏览器 localStorage 实现在 `integrations/storage`。未来改为服务端持久化时替换适配器或增加组合适配器，不改 UI Controller 的调用协议。

### 9.9 横切规则

- 错误处理：用户可恢复错误通过 Toast/Dialog 展示；开发错误附模块和操作上下文记录；除有明确注释的降级路径外，禁止空 `catch` 吞掉关键状态恢复失败。
- 隐私与安全：日志不得输出完整个人脚本、令牌或敏感配置；远端脚本未来接入时仍按不可信输入处理。Pine Worker 是执行隔离边界，但本计划不把它声明为完整安全沙箱。
- 可观测性：Provider、Workspace restore、脚本运行和持久化失败应具有可定位的错误来源；不在等价迁移中引入远端埋点。
- 可访问性：迁移后保留按钮标签、键盘关闭、焦点返回和 `aria-expanded` 状态。
- 国际化：本次不引入 i18n 框架，但新增用户文案集中在对应 Feature，避免散落在 Integration。

### 9.10 后续扩展落点

| 后续能力 | 主要新增位置 | 不应改动 |
| --- | --- | --- |
| 新行情数据源 | `integrations/vela/provider-registry` 和 Provider Adapter | 指标/Pine Editor UI、现有 Repository |
| 云端个人脚本 | 新的 ScriptRepository Adapter，在 `app` 选择或组合 | 编辑器 Controller、脚本领域模型 |
| 回测结果面板 | 独立 `features/backtesting` + 明确 Engine/Result Port | Workspace Adapter 的通用职责、现有指标管理器 |
| PineTS 高精度撮合 | 独立引擎 Fork/版本 + Vela-PineTS Worker 桥接 | 当前应用仓库中的 `node_modules` |
| 账户与交易 | 独立 Feature 和鉴权/API Integration | 行情 Provider、图表状态存储 |

扩展点只说明代码归属，不代表本次实施这些功能。

## 10. 分阶段实施计划

### Phase 0：冻结行为基线

目标：在移动代码前建立可验证的当前行为合同。

任务：

- [x] 建立顶部工具栏功能回归清单。
- [x] 保存个人脚本、收藏、编辑器草稿、模板和 Workspace state 的旧数据 fixture。
- [x] 补充存储兼容和外部指标序列化测试。
- [x] 增加基础浏览器回归测试。
- [x] 浏览器自动测试使用模拟数据源或网络拦截，不依赖交易所网络稳定性。
- [x] 保留真实 Binance/Hyperliquid 的人工 smoke test。
- [x] 记录构建体积和当前页面关键行为作为基线。

验收：

- [x] 所有现有自动测试通过。
- [x] 当前工具栏、指标、编辑器和模板流程均有对应检查项。
- [x] 旧数据 fixture 能在当前代码中正常恢复。

### Phase 1：建立应用启动和生命周期

目标：先解决全局注册和资源释放，再开始功能迁移。

任务：

- [x] 新建 `createApp()` 组合根和最小 Lifecycle/Disposer 管理。
- [x] 将 Workspace 创建收口到应用启动流程。
- [x] 收集 Vela contribution unregister。
- [x] 收集 Workspace/Chart/Indicator unsubscribe。
- [x] 管理 DOM、Window、MutationObserver 和定时器清理。
- [x] 接入 Vite HMR dispose。
- [x] 实现幂等 `destroy()`。
- [x] 任一初始化步骤失败时，逆序释放此前已经创建的资源。

验收：

- [x] 应用可以创建、销毁并再次创建。
- [x] 不出现重复按钮、重复事件或重复日志。
- [x] 销毁前最后一次 Workspace 修改不会丢失。

### Phase 2：提取纯逻辑与存储层

目标：建立不依赖 Vela 和 DOM 的稳定基础。

任务：

- [x] 提取领域模型、Repository/Workspace 端口、Workspace 配置和平台指标清单。
- [x] 提取 Pine 标题解析、源码 key 和数据校验等纯函数到 `domain`。
- [x] 拆分 JSON Store 和各浏览器 Repository 适配器，并通过构造参数注入 Service。
- [x] 保持现有 key 和数据格式不变。
- [x] 建立 FavoriteService，集中收藏兼容和同步。
- [x] 标记旧 LayoutRepository 为 legacy。

验收：

- [x] Repository 和纯函数具有独立单元测试。
- [x] 所有旧数据 fixture 可恢复。
- [x] 收藏、脚本和模板操作行为与改造前一致。
- [x] Domain 测试无需 DOM、localStorage、Vela 或 CodeMirror 即可运行。

### Phase 3：建立 Vela 集成边界

目标：限制应用其他模块直接依赖 Vela 运行时结构。

任务：

- [x] 提取 `createWorkspace()`。
- [x] 集中 Provider 和 Pine Engine 配置。
- [x] 建立应用需要的 Workspace command 和 indicator read model。
- [x] 移动外部指标 StatePersistence。
- [x] 移动 Workspace、Chart、Indicator 事件绑定。
- [x] contribution 回调优先使用 Vela 提供的 `WidgetContext`，避免读取模块全局 Workspace。
- [x] 将 Provider 注册集中为显式工厂清单，为未来新增数据源保留单一入口。
- [x] 移除 Integration 对 Feature 的反向导入，纯解析规则改依赖 `domain`。

验收：

- [x] 功能模块不直接读取 Vela 内部运行时集合。
- [x] Integration 不导入任何 Feature 实现。
- [x] 多图布局中的外部指标仍按 cell 正确保存和恢复。
- [x] Provider 和 Pine Engine 行为没有变化。

### Phase 4：迁移功能模块

按以下顺序逐个迁移，每完成一个功能即删除 `main.ts` 中对应旧实现：

#### Phase 4.1：通用 UI

- [x] Button、Text Dialog、Popover 等通用 DOM 工具。
- [x] Popover 单实例管理与统一销毁。

#### Phase 4.2：Workspace Templates

- [x] 模板服务。
- [x] 保存、应用、查看和删除 UI。
- [x] 顶部模板 contribution。

#### Phase 4.3：Favorites

- [x] 收藏统一模型和 FavoriteService。
- [x] 旧脚本收藏字段兼容同步。
- [x] 收藏快速菜单。

#### Phase 4.4：Indicators

- [x] 指标统一展示模型。
- [x] 四类指标分组逻辑。
- [x] Indicator Manager Dialog。
- [x] 图例收藏和代码入口。
- [x] 原生指标实现信息 Dialog。

#### Phase 4.5：Pine Editor

- [x] CodeMirror 状态和错误标记。
- [x] 编辑器 Controller。
- [x] ScriptService 和脚本菜单。
- [x] 保存、另存、重命名、删除和收藏。
- [x] Run、日志和错误定位。
- [x] Pine SidePanel contribution。

验收：

- [x] Feature 不直接引用另一个 Feature 的 Controller。
- [x] Feature 不直接导入另一个 Feature 的具体 Service；跨 Feature 能力依赖领域端口。
- [x] 功能刷新通过显式服务订阅或 App Composition Root 协调完成。
- [x] `main.ts` 不再包含具体业务逻辑。

### Phase 5：样式、遗留代码和边界收口

目标：完成结构清理，不改变视觉设计。

任务：

- [x] 将 CSS 按 Base、Indicators、Pine Editor、Popover、Templates 拆分。
- [x] 保持原有选择器优先级和导入顺序。
- [x] 删除确认无引用的模拟数据和遗留实现。
- [x] 用自动化检查循环依赖、Integration→Feature、Feature→Feature 和越层 Vela 导入。
- [x] 编写架构说明和模块责任文档。
- [x] 更新 README 中的开发、构建和目录说明。
- [x] 检查许可证声明和 lockfile，确认未把第三方构建产物复制进仓库。

验收：

- [x] 视觉和交互无非预期变化。
- [x] 无循环依赖。
- [x] 未使用代码已经移除或明确标注保留原因。

### Phase 6：全量验收与合入

目标：证明这是等价重构，并以可回滚的提交序列合入。

任务：

- [x] 执行单元、架构、浏览器回归和真实行情 Smoke Test。
- [x] 对照顶部工具栏、指标、脚本、收藏、模板和刷新恢复清单逐项签字。
- [x] 使用改造前 fixture 验证存储兼容。
- [x] 连续执行创建→销毁→重建，确认注册、监听和 UI 入口均不重复。
- [x] 对比构建产物体积；只记录差异，不在本阶段顺带做性能重写。
- [x] 更新 README 和本计划的验收状态，再按提交顺序合入。

验收：

- [x] 第 13 节全部满足。
- [x] 没有未解释的功能、数据兼容或构建体积回归。
- [x] 回滚任一阶段不会破坏已验收的前置阶段。

### Phase 7：独立性能优化（后续计划）

该阶段不属于本次等价重构的完成条件，在架构改造验收后另行执行：

- [ ] 使用构建分析工具确认主要体积来源。
- [ ] 评估 Pine Editor 和 Pine 脚本库按需加载。
- [ ] 评估 Vela 允许的代码拆分边界。
- [ ] 建立 bundle size 基线或预算。
- [ ] 验证懒加载不会破坏 contribution 的注册时机。

## 11. 测试策略

### 11.1 单元测试

覆盖：

- Pine 标题提取和源码 key。
- 存储数据校验和旧数据恢复。
- ScriptRepository、FavoriteRepository、TemplateRepository。
- 收藏同步和兼容迁移。
- 指标四分类和搜索过滤。
- 外部指标 payload 序列化与反序列化。

### 11.2 适配器合同测试

使用模拟 Workspace/Chart 数据验证：

- Vela 数据向应用 Indicator model 的转换。
- 添加、删除、收藏和打开指标的命令路由。
- 多 cell 外部指标状态不会写错目标图表。
- Workspace 模板完整传递，不被应用层篡改。

### 11.3 浏览器回归测试

覆盖主要用户流程：

- 顶部工具栏按钮入口唯一且功能正确。
- Indicators、Favorites、My indicators、Built-ins。
- 个人脚本新建、保存、另存、重命名和删除。
- Pine 指标运行、错误提示和源码重新打开。
- 收藏状态在编辑器、指标管理器和图例之间一致。
- 工作区模板保存、应用和删除。
- 刷新后恢复 Workspace、外部指标、脚本和收藏。
- 应用销毁后重新挂载不会重复响应。

顶部工具栏验收矩阵：

| 入口 | 必验行为 | 重复/冲突检查 |
| --- | --- | --- |
| Symbol | 打开品种选择、切换品种、正确路由 Provider | 只有一个入口，不额外请求无关数据源 |
| Timeframes | 切换周期并刷新图表/指标 | 不重复订阅实时 K 线 |
| Style | 切换图表样式 | 不影响指标和绘图状态 |
| Layout | 切换多图布局和活动 cell | 不重复创建 cell 监听，活动图表正确 |
| Indicators | 打开四分类管理器 | 不与 Vela 默认入口叠加，不出现重复 Dialog |
| Favorites | 打开收藏列表并添加到活动图表 | 收藏状态与管理器、图例一致 |
| Templates | 保存、应用、删除完整工作区模板 | 外部 Pine 指标 `ext` 不丢失 |
| Undo/Redo | 对支持的图表操作撤销/重做 | 不与浏览器或编辑器历史混用 |
| Panels | Data Window、Object Tree、Pine Editor 切换 | 同一 panel 不重复挂载 Controller |
| Screenshot | 仅触发一次下载 | 不保留重复注册的原生/自定义截图按钮 |

所有自定义入口还需校验稳定 ID、按钮数量为 1、键盘可达、Tooltip/aria 标签正确，以及应用重建后仍为 1。

### 11.4 真实数据 Smoke Test

自动测试不依赖交易所网络；在本地或部署环境单独验证：

- Binance 历史 K 线和实时更新。
- Hyperliquid 历史 K 线和实时更新。
- 品种和周期切换。
- Pine 指标随实时行情刷新。

### 11.5 架构约束测试

自动检查：

- `main.ts` 只依赖组合根和样式入口，并保持为最小启动文件。
- TypeScript 模块图不存在循环依赖。
- Vela 直接 import 只存在于允许的目录或 `*.vela.ts`。
- `integrations` 不反向 import `features`。
- 不同 Feature 之间不深路径 import Controller/Service 实现。
- localStorage 只由 Vela 内部持久化或 `integrations/storage` 访问。
- 已删除文件、旧函数和模拟数据没有残留引用。

架构测试用于阻止边界回退，但不能替代代码评审；正则检查不足时升级为 TypeScript AST 或依赖图工具。

### 11.6 质量 Gate

| Gate | 必须执行 | 通过条件 |
| --- | --- | --- |
| 每次提交 | `npm test`、`npm run build` | 全部通过，无新增未解释警告 |
| 每个 Phase | 对应单元/合同测试 + 本阶段人工清单 | 行为等价，回滚点明确 |
| Phase 4/5 | `npm run test:e2e` | 核心流程通过，无页面/控制台错误 |
| 合入前 | 全部自动测试 + 两个真实 Provider smoke test | 第 13 节全部满足 |

CI 环境不得依赖 Binance/Hyperliquid 的实时网络稳定性。浏览器自动化使用 mock/offline bars 或请求拦截；真实接口验证作为可记录结果的独立 Gate。

## 12. 风险与控制措施

| 风险 | 控制措施 |
| --- | --- |
| Vela contribution 注册时机变化 | 保持“先注册、后创建 Workspace”的顺序 |
| HMR 或重复初始化导致重复按钮 | 保存 unregister，并在 HMR dispose 中销毁应用 |
| Workspace 最后一次修改未落盘 | 销毁流程必须调用 `workspace.destroy()` |
| 旧 localStorage 数据失效 | 固定旧数据 fixture，保持 key 和 schema 不变 |
| 收藏双状态失步 | 所有读写经过 FavoriteService |
| Feature 之间形成循环依赖 | 禁止跨 Feature 导入实现，由领域端口和 App 组合根连接 |
| Integration 反向依赖 UI Feature | 事件只上送 `WorkspaceEventSink`，纯规则放入 Domain |
| Vela 升级影响扩散 | 将直接 Vela 调用限制到集成层和 `*.vela.ts` |
| Vela Adapter 逐渐复制完整上游 API | 仅按用例添加最小业务语义，并在评审中检查端口规模 |
| 初始化中途失败留下注册项 | 初始化失败与正常销毁共用逆序 Disposer 流程 |
| CSS 拆分造成视觉变化 | 最后拆 CSS，固定导入顺序并执行浏览器回归 |
| 自动测试受交易所网络干扰 | 自动化使用模拟 Provider，真实接口采用独立 smoke test |
| 依赖范围变化导致构建不可复现 | 使用 `npm ci` 和 lockfile，重构提交禁止依赖升级 |
| 为未来需求过度抽象 | 只抽取真实外部边界；没有第二实现或变化点的内部逻辑保持直接 |
| 重构和功能优化混杂 | 每个提交只完成一个等价迁移目标 |

### 12.1 第三方依赖升级规则

架构改造期间冻结 `@luxalgo/vela`、`@luxalgo/vela-pinets` 和 `pinets`。改造完成后的升级遵循：

1. 每次只升级一个边界或一组必须联动的兼容版本。
2. 先阅读 changelog、类型变化和许可证，再修改 Adapter/Contribution。
3. 用 lockfile 固定可复现版本；禁止直接 patch `node_modules`。
4. 重跑 Workspace 状态 fixture、Adapter 合同、E2E 和真实 Provider smoke test。
5. `PineWorkerEngine` 内可能内联 PineTS；升级 PineTS 时必须验证 Worker 实际运行版本，不能只看顶层 `package.json`。
6. 需要修改引擎时使用独立 Fork/包版本和独立变更计划，不把补丁混入应用架构提交。

## 13. 最终验收标准

### 13.1 架构

- [x] `src/main.ts` 只保留样式导入和应用启动。
- [x] 不再存在跨功能共享的 `workspace`、`editorPanel`、`indicatorManager` 全局变量。
- [x] Feature 之间不直接引用对方 Controller。
- [x] Feature 之间不直接导入对方的具体 Service，Integration 不反向导入 Feature。
- [x] Domain 不依赖 DOM、localStorage、Vela、CodeMirror 或上层模块。
- [x] Vela 直接调用集中在集成层和明确的 Vela contribution 文件。
- [x] 每类持久化状态具有唯一归属。
- [x] 所有订阅、全局监听和 Vela 注册均可清理。
- [x] 项目不存在循环依赖。
- [x] `src/storage.ts` 等兼容门面要么删除，要么仅保留有说明的转发导出。

### 13.2 功能

- [x] 顶部工具栏全部现有功能保持不变。
- [x] 指标四分类、添加、删除、收藏和代码入口保持不变。
- [x] Pine 编辑器全部现有操作保持不变。
- [x] 多图布局、截图、对象树和数据窗口保持不变。
- [x] Binance 和 Hyperliquid 数据行为保持不变。
- [x] 旧脚本、草稿、收藏、模板和 Workspace state 均可恢复。
- [x] 页面重复挂载不会出现重复按钮或重复事件。

### 13.3 质量

- [x] `npm test` 全部通过。
- [x] `npm run build` 通过。
- [x] 浏览器核心流程回归通过。
- [x] 架构边界自动检查通过。
- [x] Binance、Hyperliquid 真实数据 smoke test 结果已记录。
- [x] 每个实施阶段均有独立、可回滚的 Git 提交。
- [x] 不修改 Vela、Vela-PineTS、PineTS 上游源码。
- [x] 架构重构期间不升级基础依赖。

## 14. 提交和回滚策略

推荐按阶段提交：

1. `test: 建立架构重构行为基线`
2. `refactor: 建立应用启动与生命周期`
3. `refactor: 提取领域端口并拆分存储适配器`
4. `refactor: 建立 Vela 集成边界`
5. `refactor: 拆分工作区模板功能`
6. `refactor: 拆分收藏功能`
7. `refactor: 拆分指标管理功能`
8. `refactor: 拆分 Pine 编辑器功能`
9. `refactor: 拆分样式并清理遗留代码`
10. `test: 完成架构改造全量回归`
11. `docs: 完善项目架构与开发说明`

实际实施将相邻且必须同时编译的步骤合并为五个可回滚提交，并逐个从提交快照执行 `npm test` 与 `npm run build`：

| 提交 | 内容 |
| --- | --- |
| `ecde528` | Domain、Port、Repository 与存储兼容边界 |
| `ba30d25` | Vela/PineTS Integration、共享 UI 与生命周期 |
| `a57ca87` | Indicators、Favorites、Pine Editor、Templates Feature |
| `1463256` | Composition Root 切换、样式拆分与遗留模拟数据清理 |
| `807edfb` | 架构约束、旧状态、E2E、生产预览和 Provider 验证 Gate |

每个提交必须满足测试和构建通过，禁止在同一提交中同时进行结构迁移、功能调整和依赖升级。出现问题时应回滚当前阶段，不回滚已经验收的前置阶段。

迁移采用逐入口替换：先新增新模块和测试，再把一个入口切换到新模块，确认旧路径没有调用后删除对应旧实现。任何时刻同一个 Vela contribution、DOM 监听或持久化写入只能有一个生效路径，禁止用新旧逻辑长期双跑。

回滚约束：

- 阶段提交不得修改持久化 key/schema，因此代码回滚不要求数据回滚。
- 如确需 schema migration，必须移出本计划并提供向前迁移、回读兼容和备份策略。
- 删除 legacy 文件前先用 `rg`、构建和 E2E 证明无引用，并在独立提交中删除。
- 合入前保留改造基线 SHA；禁止用破坏性 reset 覆盖用户其他改动。

## 15. 决策记录与待讨论项

### 15.1 已确定

| 决策 | 结论 |
| --- | --- |
| 应用形态 | 模块化单体，不拆微前端/多包仓库 |
| 图表内核 | 保留 Vela Workspace |
| Pine 执行 | 保留 Vela-PineTS 的 PineWorkerEngine |
| 行情 | 保留 Vela Binance/Hyperliquid Provider 和现有 OHLCV 行为 |
| 依赖方式 | npm + lockfile，不复制或直接修改上游源码 |
| 迁移策略 | 等价重构、逐入口替换、阶段性 Gate |
| 跨模块协作 | Domain Port + 显式回调/订阅，由 App 组合根装配 |
| 持久化兼容 | key/schema 保持不变，先抽 Repository 边界 |

### 15.2 待讨论但不阻塞本计划

| 事项 | 当前处理 |
| --- | --- |
| 自建脚本长期持久化 | `TODO.md` 保持“待讨论”；本次只保证 Repository 可替换 |
| PineTS 高精度回测 | 按 `TODO.md` 独立立项和 Fork/Worker 重建边界实施 |
| 是否移除 `SavedScript.favorite` | 本次保留兼容镜像，未来通过 schema migration 决定 |
| 旧 `vela-pine:layout:v1` 删除时间 | 完成 fixture 和兼容窗口确认后单独处理 |
| Bundle 拆分目标 | Phase 7 经构建分析后设预算 |

## 16. 实施结论

本次改造定位为：

> 应用层模块化、Vela 集成边界治理、状态归属治理和生命周期治理。

改造不会拆解或替换最初引入的 Vela/PineTS 基础开源项目。底层图表、行情 Provider 和 Pine 引擎继续按当前方式运行；项目只重新组织自身的应用逻辑和集成代码。

Phase 0—6 已按上述边界完成。性能优化、云端持久化和高精度回测在本计划完成后分别独立推进。

## 17. 最终验收记录

### 17.1 功能等价证据

- 同一份 `tests/e2e_app.py` 核心业务用例分别在改造前 `35d07aa` 临时快照和改造后代码上执行，均通过。
- 覆盖 Symbol、Timeframe、Style、Layout、Indicators、Favorites、Templates、Undo/Redo、Panels、Screenshot 等顶部入口，并校验入口数量唯一。
- 覆盖四类指标、搜索、内置/平台/个人指标添加、移除、收藏、代码入口和原生实现信息。
- 覆盖 Pine 脚本新建、保存、另存、修改、收藏、运行、图例代码入口、重命名和删除。
- 覆盖双图 cell 级外部指标隔离、模板保存/应用/删除、页面刷新恢复和截图下载。
- 使用从改造前版本真实导出的 `tests/fixtures/workspace-v2.json` 验证双图 Workspace 和 `ext` 外部 Pine 指标恢复；该 fixture 在新旧两版均通过。
- 应用创建、幂等销毁、重建、初始化失败回滚、Popover 清理和未到防抖时间的编辑器草稿落盘均通过浏览器验证。

### 17.2 自动验证结果

| 验证项 | 最终结果 |
| --- | --- |
| `npm test` | 18/18 通过 |
| `npm run build` | 通过 |
| `npm run test:e2e` | 通过，含生命周期与旧 Workspace fixture |
| `npm run test:e2e:prod` | 通过，生产构建与 Preview 执行同一核心业务回归 |
| `npm run test:providers` | Binance 5 根历史 K 线 + 实时更新通过；Hyperliquid 5 根历史 K 线 + 实时更新通过 |
| 架构约束测试 | 无循环依赖、无 Integration→Feature、无跨 Feature 实现依赖、无越界 Vela/localStorage 使用 |
| 阶段提交验证 | 五个实施提交快照均独立通过 `npm test` 和 `npm run build` |
| `git diff --check` | 通过 |

### 17.3 构建与视觉对比

| 项目 | 改造前 `35d07aa` | 改造后 | 差异 |
| --- | ---: | ---: | ---: |
| 主 JavaScript | 3,308.79 kB | 3,316.00 kB | +7.21 kB（+0.22%） |
| 主 JavaScript gzip | 888.84 kB | 891.80 kB | +2.96 kB（+0.33%） |
| CSS | 13.24 kB | 13.24 kB | 0 |
| CSS SHA-256 | `2afde4e01d5f2109ede67b1099aa12c0c73297271d48403ec6230f68e6aa9ed3` | 相同 | 字节一致 |

JavaScript 的小幅增长来自显式生命周期、Service/Adapter 边界、数据校验和销毁逻辑，未增加新的业务依赖或功能加载范围。现有大包体积警告属于已记录的 Phase 7 性能事项，不影响本次等价重构验收。

### 17.4 边界结论

- `package-lock.json` 未变化，Vela、Vela-PineTS、PineTS 和其他依赖未升级。
- 未复制、Fork 或修改 Vela、Vela-PineTS、PineTS 及 `node_modules` 源码。
- Binance/Hyperliquid Provider、PineWorkerEngine、Workspace key 和全部现有应用存储 key/schema 保持不变。
- 自建脚本云端持久化和 PineTS 高精度回测仍按 `TODO.md` 独立处理，没有混入本次改造。
