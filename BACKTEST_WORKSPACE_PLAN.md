# Quant Tools 回测工作区一比一复刻与功能完备实施计划（最终复核版）

> 版本：1.1
>
> 日期：2026-09-25
>
> 文档状态：最终评审版，待实施
>
> 实施目标：功能完备、前端 UI 与交互一比一对标、运行时完全独立于参考网站
>
> 使用场景：当前阶段仅本地自用，许可证不作为本计划的设计、实施或验收阻塞项

## 0. 执行结论

本项目能够在现有 Vela Workspace 与 PineTS 基础上实现一个独立运行、功能完整、前端 UI 与交互一比一对标 LuxAlgo Quant 回测工作区的版本。

最终结果必须同时满足三条硬性标准：

1. **功能完备**：策略自动回测、摘要 Dock、完整查看器、Performance、Trades Analysis、Trades Log、Simulation、参数重算、图表定位、多图多策略、空态和错误态全部可用。
2. **UI/交互一比一**：布局、尺寸、间距、颜色、字体、图标、图表、表格、滚动、拖拽、悬停、Tab、响应式和状态切换均通过差分验收。
3. **独立运行**：生产代码和构建产物不请求 `app.luxalgo.com`、LuxAlgo 私有接口、远程页面资源或其 Next.js chunk；市场数据只使用项目明确注册的 Binance/Hyperliquid Provider。

当前瓶颈不在页面，而在回测结果契约：Vela 已经公开策略概要和交易账本，但当前 Vela-PineTS 桥接没有输出逐 K 权益、基准、完整风险指标、bar index、订单和 fill 流水。计划将先冻结对标合同，再建立独立 Backtesting Feature，最后扩展桥接和撮合引擎。任何阶段都不得用近似值冒充参考站正式指标。

底层源码采用“两个必需、一个条件式”策略：PineTS 与 Vela-PineTS 的完整上游源码最终保存在本仓库并作为本地 workspace 依赖；Vela 只有在公开 API Spike 证明无法完成精确定位/结果契约时才本地化。源码通过 Git subtree 保留上游同步能力，不保存或修改 `node_modules`。

分阶段交付只是降低实施风险，**中间阶段不等于最终范围缩减**。只有所有 Final Gate 通过，才能宣称“功能完备、一比一复刻”。

## 1. 对标证据与可信边界

本计划来自三类证据交叉验证。

### 1.1 动态浏览器实测

已登录参考站并实际执行一次回测，覆盖：

- 添加内置 Strategy 并自动运行。
- 图表交易标记、持仓区间和 Strategy 徽章。
- Inputs / Properties 设置。
- 底部摘要的展开、折叠、拖拽和打开完整查看器。
- Performance、Trades Analysis、Trades Log、Simulation 四个页面。
- Trades Log 列表、日历和 Entry/Exit 图表定位。
- Simulation 的 Resample、Shuffle 和即时重绘。
- 删除策略并确认摘要和查看器入口消失。
- 相关运行请求和四个结果页的数据复用关系。

动态测试完成后已移除临时策略并关闭测试页面，没有保存、分享、下单或修改账户配置。

### 1.2 静态页面审计

上传的 `backtest.html` 是运行态 DOM 快照，不是源码或可独立运行页面。它可作为以下项目的证据：

- Performance 页面的 DOM 层级、字段、样式和响应式结构。
- 默认 Dock 高度约 280px、最小高度约 104px。
- `Performance / Trades Analysis / Trades Log / Simulation` 标签结构。
- Highcharts 13.0.0 图表形态和 Lucide 风格图标。
- 正收益 `#089981`、负收益 `#f23645` 等视觉 token。
- Net Profit、Trades、Win Rate、Max Drawdown、Profit Factor 摘要。
- Cumulative P&L、Net Daily PNL、Weekday Performance 和 All/Long/Short 表格。

静态文件不包含 React 组件源码、事件处理器、原始图表数据、公式、API 响应和另外三个页面的运行内容。因此只提炼结构和视觉证据，不将该 HTML 或参考站 bundle 复制进仓库。

### 1.3 当前项目能力审计

当前项目已经具备：

- `PineWorkerEngine` 策略执行入口。
- Workspace 级 `script:run` 事件。
- `run.kind`、`run.complete`、`run.forming`、`run.strategy`。
- 异步 `run.trades()` 交易账本。
- IndicatorHandle 的 Inputs、Properties、可见性、源码更新和删除控制。
- Vela 已绘制的策略订单标记和持仓区域。
- Binance、Hyperliquid OHLCV Provider。
- 已完成的模块化 Composition Root 和统一生命周期清理。

当前 [`workspace-events.ts`](src/integrations/vela/workspace-events.ts) 仅将 `script:run` 写入编辑器日志；[`workspace-port.ts`](src/domain/ports/workspace-port.ts) 没有回测结果接口。这正适合新增独立 Backtesting Feature，而不是继续扩大通用 WorkspacePort 或把逻辑放回 `main.ts`。

### 1.4 动态网络观察与本项目替代边界

参考站实测观察到：

- Workspace/偏好：`/api/quant/workspaces`、indicator templates、chart preferences、watchlists、indicator favorites。
- 行情：区域化数据域的 `/v1/{source}/{symbol}/info` 与 `/candles`。
- 策略挂载或重算：`POST /api/quant/backtest-run`。
- 四个结果页和 Simulation：主要复用同一份结果，切 Tab 和调整 Simulation 未出现逐页回测请求。

这些请求只用于理解触发时机，不作为实现依赖。本项目对应关系为：

| 参考站边界 | 本项目实现 |
| --- | --- |
| Workspace/偏好 API | 现有 Workspace state 与本地 Repository |
| 参考行情 `/info`、`/candles` | Vela Binance/Hyperliquid Provider |
| `backtest-run` | 本地 `PineWorkerEngine` + BacktestResultsAdapter |
| 四页结果数据 | 同一 `BacktestReport` 与 selector |
| Simulation | 本地 Simulation Worker |

不能仅凭一次网络观察断言参考站的策略计算完全发生在浏览器；但本项目的实现必须明确全部在自身 Vela/PineTS 链路内完成。

### 1.5 统一测试交易品基线

所有对标、公式、截图、E2E 和性能回归统一使用项目现有数据源能够稳定支持的市场：

- Provider：`binance`。
- Ticker：`BTCUSDT`。
- 默认图表周期：`1h`。
- 数据类型：Binance OHLCV Kline。
- 内部测试标识：`provider=binance + ticker=BTCUSDT + timeframe=1h`。
- UI 的 venue/display symbol 由 Vela 实际解析结果和 G0 参考截图冻结，不在业务代码中硬编码 `BINANCE.US` 或 `BTCUSD`。

不使用 XAUUSD、黄金或其他当前项目没有 Provider 支持的交易品作为 fixture。确定性测试需将指定时间范围内的 BTCUSDT candles 固化到本地 fixture，避免 Binance 后续新增 K 线导致期望值漂移；Provider smoke test 仍使用实时 Binance 接口验证连接能力。

对标基线分成两套，避免把“视觉相同”和“数值相同”混为一项：

- **视觉/交互基线**：使用参考站可稳定加载的 Strategy，冻结页面状态、viewport、DPR、字体、locale、timezone 和截图。
- **数值/引擎基线**：使用一组可在参考站与本项目运行的、源码受控的可移植 Pine 策略，选择已经收盘的固定历史区间，并保存 candles 校验和、策略源码校验和、参数、逐笔交易和汇总结果。

若参考站不能注入本地 candles，则必须选取已经结束且不会再变化的 Binance BTCUSDT 历史区间，并先核对双方 OHLCV 校验和；数据本身不同的样本不得用于判断撮合公式是否一致。

## 2. 范围定义

### 2.1 本计划完整范围

- 策略添加后自动回测，无额外 Run 按钮。
- 首次完成提示、Strategy 徽章及 Show backtest 入口。
- 策略图例的 Hide、Settings、Move pane、Favorite、Edit code、Remove 联动。
- Inputs 和 Properties 的草稿、校验、Cancel、Reset、Ok 与单次重跑。
- 桌面底部 Backtest Dock。
- 完整 Backtest Viewer。
- Performance 全部字段、图表和 All/Long/Short 对比。
- Trades Analysis 全部图表和统计。
- Trades Log 列表、排序、日历、导出和图表定位。
- Simulation 的 Resample、Shuffle、风险指标、图表和控制项。
- 多 Cell、多策略、活动策略切换和生命周期隔离。
- 历史加载、实时形成 K 线、重算、取消、乱序响应和 stale 状态。
- 无交易、仅未平仓、全胜、全负、全平手和错误状态。
- 桌面、平板、移动端、触摸和键盘交互。
- 确定性结果、视觉差分、性能、可访问性和独立运行验收。
- 现有 PineTS 高精度历史回测/Bar Magnifier TODO 与结果工作区的最终整合。

### 2.2 不属于本回测工作区的范围

- LuxAlgo 账户、订阅、聊天、AI、云工作区、分享和发布服务。
- 真实券商下单和实盘交易。
- 交易所订单簿、排队位置、市场冲击和真实逐笔 Tick 撮合。
- 将参考站私有 API 作为本项目运行依赖。

这些内容不是参考回测工作区自身的必需组成，不影响本计划的“回测功能完备”定义。

## 3. 已确认的参考行为合同

### 3.1 入口与生命周期

1. 无 Strategy 时不渲染空 Dock，也不显示无意义的 Viewer。
2. `Indicators → 搜索 → 点击 Strategy 行` 后自动添加并运行。
3. 搜索期间显示 `Searching…`。
4. 首次成功显示一次性 `First backtest complete!` 提示。
5. 图表同步显示订单标记、持仓背景和 Strategy 徽章。
6. Strategy 徽章提供说明和 `Show backtest`。
7. 删除策略后，其图层、结果、Dock、Viewer 入口和在途任务全部清理。
8. Symbol、provider、timeframe、Inputs、Properties 和源码变化触发重算。
9. Tab、排序、日历翻页、Viewer 开关和 Simulation 控件不得重新运行策略。

### 3.2 Settings 合同

参考策略实测的 Properties 包含：

- Initial capital。
- Default qty value/type。
- Pyramiding。
- Commission value/type。
- Slippage。
- Margin long/short。

默认值基线为：初始资金 1,000,000、fixed qty 1、pyramiding 0、commission 0%、slippage 0、long/short margin 100%。不同脚本的 Inputs 由其 schema 决定。

设置对话框必须遵循：

- 输入修改先进入 draft state。
- Cancel、关闭和 Esc 不提交、不重跑。
- Reset defaults 的作用范围需在 G0 实机确认；未确认前不得自行定义。
- Ok 使用一次 `setInputs` 和一次 `setProps` 批量提交，不能逐字段触发多次完整回测。
- 非法数值、空日期、越界、精度和单位按 schema 校验。
- 日期与时间使用图表时区解释，显示格式遵守已冻结的 locale 规则。

### 3.3 底部 Dock

- 是 Vela Workspace 的应用层兄弟节点，不是右侧 SidePanel。
- 默认高度约 280px，折叠最小高度约 104px；最终像素以 G0 截图测量为准。
- 顶部包含策略名、结果日期范围、折叠和打开完整 Viewer。
- 展示 Net Profit、Trades、Win Rate、Max Drawdown、Profit Factor。
- 展示累计 P&L/Equity 图形。
- 支持 Pointer 拖拽、Pointer Capture、窗口变化后的高度 clamp 和键盘调整。
- 拖动时图表必须连续 reflow，不能出现空白、遮挡或坐标错位。

### 3.4 完整 Viewer

- Viewer 替换右侧图表工作区域，不跳转路由，也不是浏览器全屏 Modal。
- 打开后保留全局顶部栏；在参考完整布局中左侧 AI 区也保留。
- 返回图表时恢复原 chart、viewport、面板高度和回测摘要。
- Header 保留策略收藏星标；收藏状态必须与现有 FavoriteService 和指标列表同步，不能形成第二份状态。
- 每次重新打开默认进入 Performance。
- Tab 栏 sticky，内容区独立滚动。
- 同一次打开期间记录每个 Tab 的 scroll position；重新打开后的恢复规则以 G0 实测为准。
- Viewer 和 Dock 共享同一份结果快照，不各自重新计算。

### 3.5 Performance

必须复刻：

- 顶部 Summary 与累计 P&L 图。
- Net Daily PNL 图。
- Weekday Performance 图。
- All / Long / Short 对比表。
- Net Profit。
- CAGR。
- Gross Profit / Gross Loss。
- Profit Factor。
- Average P&L per Day / Week。
- Drawdown。
- Calmar / Sharpe / Sortino。
- Buy and Hold PnL / % Gain。
- Strategy Outperformance。
- Tooltip、legend、hover、空数据和 benchmark 不可用状态。

参考图表使用 Highcharts 13.0.0。为最大化视觉与交互一致性，默认实施方案使用本地打包的同版本 Highcharts，并按需加载；不使用 CDN。

### 3.6 Trades Analysis

动态实测确认需覆盖：

- P&L Distribution 及均值参考线。
- Winner、loser、breakeven Winrate 图。
- All / Long / Short 交易统计。
- Duration vs P&L。
- 平均和极值交易持续时间。
- 日/周交易频率。
- 连胜、连败和恢复相关统计。
- 当前未平仓行与真正 breakeven 的区分。

所有字段、tooltip、坐标、排序和空态在 G0 形成逐字段 Parity Matrix；未有参考证据的字段不得自行添加。

### 3.7 Trades Log

- 默认顺序、Trade # 规则和稳定排序需按参考冻结。
- 列包含 Entry、Exit、Size、Net P&L、MFE、MAE、Cumulative P&L 等参考字段。
- Long/Short 使用对应标签和颜色。
- Entry/Exit 单元格悬停或聚焦后出现 `Show entry/exit on chart`。
- 点击后关闭 Viewer、恢复图表、将目标 bar 放在确定位置并显示 crosshair/高亮。
- 定位不改变回测结果、策略参数或图表市场。
- List / Calendar 两种 View Mode 使用同一交易源。
- Calendar 按月分页，显示每日 P&L、交易数、胜率和月汇总。
- Calendar 以 exit timestamp 归属日期；未平仓交易不进入已实现日历。
- 支持 CSV 导出，字段、顺序、时区和数值精度固定。

反手交易必须区分“交易 size”和“订单 marker quantity”：从 -1 反转到 +1 时，交易行 size 可为 1，图表成交标记可能是 +2。

动态样本中未平仓兼容行出现过 Trade #0、epoch 日期和 `N/A` 的组合。G0 必须冻结其最终可见文案；领域层不得把 `0`、`1970-01-01` 或 `N/A` 当成真实 exit，Adapter 统一规范为 `exitTime: null`。即使为视觉一比一保留参考显示，排序、Calendar、duration、closed-trade 统计和 Simulation 也只能按 `null/open` 语义处理。

### 3.8 Simulation

必须复刻：

- Resample：从已平仓交易中有放回抽样。
- Shuffle：对同一组已平仓交易做无放回重排；每条路径最终收益相同。
- 默认 1,000 runs、P&L variation 0%、Preserve win/loss 关闭。
- 1.5×、2×、3×和自定义 drawdown threshold。
- USD / % 单位。
- Histogram / Cumulative 切换。
- Probability of profit、Median outcome、P95–P99 drawdown、Risk of ruin、阈值突破概率、P95 losing streak、Actual open max drawdown。
- Simulated paths 与分位带。
- Outcome、Drawdown、Streaks & Recovery 图表/表格和说明文案。

`P&L variation` 和 `Preserve win/loss` 的确切随机公式必须通过 G0 黑盒样本确认，不能凭名称猜测。实现层注入可复现 PRNG；生产使用随机 seed，测试固定 seed。

## 4. 数据人口与公式合同

### 4.1 单一原始报告，多组显式 selector

Dock、Viewer 和四个 Tab 必须读取同一份 `BacktestReport`。参考站不同页面存在人口差异，因此不强行用一个分母，而是在同一原始数据上建立命名明确的 selector：

- `closedTrades`：真正已平仓交易。
- `openTrades`：当前未平仓交易。
- `realizedNet`：已平仓净收益。
- `unrealizedNet`：当前浮动收益。
- `markToMarketNet`：realized + unrealized。
- `analysisRows`：参考 Trades Analysis 实际展示人口。
- `simulationPopulation`：Simulation 实际抽样人口。

这样既防止页面各自私算，又能有意复刻参考站已确认的不同口径。

所有上游未平仓 sentinel（`exitTime=0`、epoch 或文本 `N/A`）在 Adapter 边界转换为 `null`；可选 raw 值只能用于诊断/兼容显示，禁止进入日期 bucket、平仓排序或已实现统计。

### 4.2 已观察到的兼容口径

一次动态样本中观察到：

- Summary：Trades 13、8 胜 5 负、61.54%。
- Simulation：使用 13 个 closed trades。
- Shuffle 的固定最终 realized 结果为 11,304.43 USD。
- Summary Net Profit 为 10,943.62 USD，包含约 -360.81 USD 当前浮亏。
- Trades Analysis 显示 14 rows、8 winner、5 loser、1 current/breakeven 兼容行，胜率 57.14%。
- 静态快照还出现过 Dock 33.74% 与 Viewer 33.33% 的不一致；该差异目前只作为待复验样本，不直接复制为产品规则。

因此当前兼容目标是：

- Summary trade count / win rate 使用已平仓非零结果人口。
- Summary Net Profit 使用 mark-to-market。
- Simulation 只使用 eligible closed trades。
- Trades Analysis 按参考行为显示 current/open 兼容行并使用自己的分母。

G0 将固定 candles、脚本、参数和时间范围重新验证上述推断。若产品决定修正参考站自身的不一致，必须写成明确的有意偏离，不能悄悄统一后仍声称一比一。

### 4.3 公式必须显式定义

至少冻结以下公式：

- `grossProfit = Σ(max(tradeNetPnl, 0))`。
- `grossLoss = abs(Σ(min(tradeNetPnl, 0)))`。
- `realizedNet = Σ(closed trade netPnl)`。
- `markToMarketNet = realizedNet + openPnl`。
- `profitFactor = grossProfit / grossLoss`。
- Win rate 的交易人口、breakeven epsilon 和费用前/后分类。
- Avg trade、Avg winner、Avg loser 的分母。
- Cumulative P&L 按 exit 时间正序累计，列表可倒序展示。
- MFE/MAE 的方向调整、手续费、滑点和 intrabar high/low 口径。
- Portfolio drawdown 与单笔 MAE 分开。
- Drawdown 金额和百分比的权益峰值分母。
- CAGR 的起止日期与年化方式。
- Sharpe/Sortino 的采样周期、无风险利率和样本不足规则。
- Calmar 的收益和 drawdown 分母。
- Daily/weekly/weekday 的 timezone、bucket 和未交易日期规则。
- Duration 的时间和 bar 计数方式。
- Profit Factor 在 grossLoss=0、无交易和全平手时显示 `∞`、`—` 或其他参考值。
- `NaN`、`Infinity`、负零、超大数、小币种精度和单位格式化。

### 4.4 数据来源与可用性

每项指标携带来源与可用原因：

```ts
interface BacktestMetric {
  value: number | null;
  unit: 'currency' | 'percent' | 'ratio' | 'count' | 'contracts' | 'duration';
  source: 'engine' | 'trade-ledger' | 'derived';
  unavailableReason?:
    | 'not-exposed'
    | 'not-applicable'
    | 'insufficient-data'
    | 'partial-history'
    | 'partial-ledger'
    | 'division-by-zero';
}
```

不支持或数据不足时显示参考样式的 `—`，不得显示伪造的 0。最终版本不允许保留 `approximation` 名义下的近似正式指标。

## 5. 目标架构

### 5.1 数据流

```text
Binance / Hyperliquid OHLCV
             ↓
Vela Workspace + PineWorkerEngine
             ↓
script:run / handle.context() / trades()
             ↓
VelaBacktestResultsAdapter
  - bootstrap
  - cell/indicator lifecycle
  - revision / stale guard
  - capability / provenance
             ↓
BacktestStore ─────→ BacktestMetrics / Simulation Worker
      │
      ├────────→ BacktestDock
      ├────────→ BacktestViewer（4 Tabs）
      └────────→ BacktestChartNavigator
```

### 5.2 模块落点

```text
src/domain/
  backtesting.ts
  backtest-metrics.ts
  ports/
    backtest-results-port.ts
    backtest-control-port.ts
    backtest-chart-port.ts

src/integrations/vela/
  backtest-results-adapter.ts
  backtest-control-adapter.ts
  backtest-chart-adapter.ts

src/integrations/storage/
  backtest-preferences-repository.ts

src/features/backtesting/
  backtest-store.ts
  backtest-controller.ts
  backtest-workbench.ts
  backtest-viewer.ts
  backtest-formatters.ts
  simulation-worker.ts
  views/
    summary-view.ts
    performance-view.ts
    trades-analysis-view.ts
    trades-log-view.ts
    simulation-view.ts
  charts/
    chart-factory.ts
    chart-options.ts
  backtest.css
  backtest-responsive.css
```

目录表示职责边界，不要求为几行逻辑制造空文件。不得将回测逻辑重新堆入 `main.ts`、Indicator Manager 或通用 `WorkspacePort`。

### 5.3 职责边界

- `domain/backtesting.ts`：领域模型、状态、能力和人口定义，不导入 Vela 或 DOM。
- `backtest-results-adapter`：唯一读取 ScriptRun、Handle、Chart、Workspace 的结果适配器。
- `backtest-control-adapter`：Inputs/Properties schema、draft 提交和批量更新。
- `backtest-chart-adapter`：精确定位时间/bar，隔离 Vela 导航 API。
- `backtest-store`：状态机、active cell、active strategy、revision、last-good result 和 lazy ledger。
- `backtest-metrics`：纯函数聚合和 selector，不接触 DOM。
- `simulation-worker`：随机模拟、取消、进度和固定 seed 测试。
- `backtest-workbench`：布局、splitter、折叠和 Viewer 容器。
- 各 View：只消费 Store selector，不直接访问 Vela。
- Preferences Repository：只保存确认需要持久化的 UI 偏好，不保存回测结果。

### 5.4 宿主布局

应用层改为：

```text
#app.quant-workspace-shell
├── #workspace                  VelaHost，min-height: 0
├── #backtest-workbench         桌面 Dock，shrink: 0
└── #backtest-viewer            覆盖 chart 工作区的 Viewer
```

要求：

- 不向 Vela 私有 DOM 内部注入节点。
- Vela 保持挂载，Viewer 打开时不销毁并重建 chart。
- Dock resize、折叠、Viewer 开关后触发受控 reflow。
- 全局仅挂载一套可见 report DOM，不复制静态快照中隐藏的多套 SVG。
- 回测 Controller 必须先于 Workspace 销毁，所有图表、Worker、Observer、监听和 Promise generation 都被释放。

## 6. 领域数据契约

### 6.1 标识、状态和终态

```ts
interface BacktestKey {
  cellId: string;
  indicatorId: string;
}

type BacktestStatus =
  | 'waiting-data'
  | 'compiling'
  | 'computing'
  | 'updating'
  | 'ready'
  | 'suspended'
  | 'no-data'
  | 'no-trades'
  | 'open-only'
  | 'partial'
  | 'error';

type BacktestFinality =
  | 'historical-final'
  | 'live-provisional'
  | 'partial-history'
  | 'unknown';
```

每个结果的稳定 key 为 `cellId + indicatorId`。不得只按策略标题、symbol 或 indicatorId 全局索引。

### 6.2 BacktestReport

完整报告至少包含：

- key、revision、snapshot/runId。
- title、source identity、report schema version，以及 engine/bridge/host 的版本与构建 SHA。
- provider、symbol、display symbol、timeframe、timezone、currency、price precision。
- requested range、actual data range、effective strategy range。
- cause、status、finality、forming、history complete/reason/progress。
- Inputs schema/value 和 Properties schema/value。
- Account state：position、avg price、equity、initial capital、realized/unrealized P&L、gross、drawdown/run-up。
- Closed trades、open trades、analysis rows。
- Raw orders、fills 和 reversal relation。
- Equity、drawdown、benchmark series。
- 汇总、All/Long/Short、daily、weekly、weekday、duration 和 streak selector。
- Simulation input/result/status。
- warnings、error、capabilities、provenance、availability。

`currency`、range、timezone 等不应塞入 WorkspacePort；新增最小只读 `BacktestContext` 按 cell 提供。

### 6.3 能力声明

```ts
interface BacktestCapabilities {
  tradeLedger: boolean;
  exactEquityCurve: boolean;
  exactDrawdownCurve: boolean;
  riskRatios: boolean;
  benchmark: boolean;
  rawOrders: boolean;
  rawFills: boolean;
  barIndices: boolean;
  individualOpenPnl: boolean;
  executionPrecision: 'chart-ohlc' | 'lower-timeframe' | 'tick';
}
```

UI 根据 capability 决定展示正式值、禁用控制或显示 `—`。仅解析到 `use_bar_magnifier=true` 不代表高精度撮合已经生效。

## 7. 事件、并发与状态机

### 7.1 状态转换

```text
ABSENT
  └─ add strategy → WAITING_DATA / COMPILING
       └─ run start → COMPUTING
            ├─ complete + trades → READY
            ├─ complete + 0 closed + open → OPEN_ONLY
            ├─ complete + no position → NO_TRADES
            ├─ incomplete/aborted → PARTIAL
            └─ failure → ERROR

READY / NO_TRADES / OPEN_ONLY
  ├─ inputs/code/market change → UPDATING（保留 last-good + 明确遮罩）
  ├─ hide → SUSPENDED
  ├─ live tick → READY（finality = LIVE_PROVISIONAL）
  └─ remove/cell destroy → ABSENT
```

重算失败时保留 last-good 还是清空，按参考实测冻结；默认建议保留并明确标识 error/stale，避免旧结果被误认为新结果。

### 7.2 必须处理的 Vela 事件

| 事件 | 行为 |
| --- | --- |
| `script:run` strategy | 更新轻量概要、revision 和 finality；按策略拉账本 |
| `script:run` indicator | 同 ID 从 strategy 改为 indicator 时删除旧回测结果 |
| `indicator:added` | 绑定 ready/error 并执行 bootstrap |
| `indicator:removed` | 清理结果、选择和在途任务 |
| `indicator:visibility` | hidden 标记 suspended；show 标记 computing |
| `indicator:inputs` | 使当前结果进入 updating，等待一次 inputs run |
| `indicator:error` | 保留 last-good 并附错误；失败的 updateCode 不误删旧结果 |
| `load:start` | 隔离旧市场结果，进入 waiting-data |
| `load:end` | bars=0 时标记 no-data；如已有明确异常则同时附 error |
| `market:changed` | 更新 committed symbol/timeframe |
| `history:progress` | 更新深历史进度 |
| `history:complete` | 记录 depth/genesis/aborted；aborted 必须 partial |
| `cell:active` | 切换当前 Dock/Viewer 上下文 |
| `cell:created` | 绑定 Chart 并 bootstrap |
| `cell:destroyed` | 注销并删除该 Cell 结果 |

### 7.3 初始化补采

Workspace 可能在事件绑定前已经恢复并运行策略，因此首次订阅后必须：

1. 先绑定 Workspace 与每个 Chart 事件。
2. 枚举已有 cells 和 indicator handles。
3. 对已有 Handle 调用 `handle.context(['meta', 'strategy', 'trades', 'warnings'])`。
4. context 为空时等待 ready 后重试。
5. 等待 `chart.historyComplete()`；如果已错过 completion reason，标记 unknown，不伪造成 depth/genesis。
6. 生成与后续 `script:run` 相同的领域事件。

### 7.4 异步账本一致性

`run.trades()` 是异步读取，不能假设 Promise 返回时仍对应事件产生时的同一执行上下文。必须实现：

- 每个 BacktestKey 独立 revision。
- 每个策略最多一个账本请求在途，后续请求合并为 desiredRevision。
- Promise 返回前后检查 key、revision、application epoch 和策略是否仍存在。
- 旧结果直接丢弃并记录 stale-drop，不更新 UI。
- 如果期间出现新 revision，立即为最新 revision 补拉一次。
- `complete=false` 不拉完整 ledger。
- tick 更新轻量概要，不在每个 tick 传输完整账本。
- bar 或交易指纹变化时刷新账本。
- 面板关闭时只维护必要概要。
- remove、cell destroy、market change、app destroy 都使在途结果失效。

实时形成 K 线下如果概要与账本无法获得原子快照，结果必须标为 provisional。最终桥接增加 `runId/snapshotToken` 后再承诺强一致。

## 8. Vela/PineTS 能力改造

### 8.1 当前可直接使用

- StrategyState 的仓位、均价、equity、open/net/gross P&L、胜负平、最大回撤/Run-up、初始资金。
- StrategyTrade 的方向、数量、Entry/Exit 时间价格、订单 ID、备注、P&L、手续费、MAE/MFE 和 open 状态。
- Vela 图表上的成交标记。
- Inputs / Properties schema 和批量更新。
- complete、forming、warnings 和错误。

### 8.2 扩展 Vela-PineTS 桥接

必须输出 PineTS 已有但当前被裁剪的：

- CAGR、Sharpe、Sortino。
- Buy & Hold PnL/% 和 Strategy Outperformance。
- Drawdown/Run-up 百分比。
- Account currency。
- 最大持仓数量。
- Entry/Exit bar index。
- 更完整的未平仓交易信息。

Worker 内联 PineTS，因此升级项目根部 `pinets` 依赖不会自动更新实际引擎；应重新构建和锁定自己的 Vela-PineTS Worker 版本。

### 8.3 新增历史结果模型

为完整 Performance 和精确联动增加：

- 不可变 runId/snapshot token。
- 逐 K equity series。
- 逐 K drawdown/underwater series。
- benchmark/buy-and-hold series。
- raw order ledger。
- raw fill ledger。
- Entry/Exit bar index 和 parent order/trade relation。
- 数据覆盖、执行起止、requested/applied precision 和 fallback reason。

大数据通过异步 selector 按需拉取，不塞入每个 tick 的 `script:run`。

### 8.4 图表定位公开接口

Vela 内部存在 bar focus 行为，但当前不是稳定公开 Host API。为实现一比一 `Show entry/exit on chart`，增加窄语义接口：

```ts
interface BacktestChartPort {
  focusExecution(input: {
    cellId: string;
    indicatorId: string;
    barIndex?: number;
    time: number;
    side: 'entry' | 'exit';
  }): void;
}
```

接口负责：

- 激活正确 Cell。
- 关闭 Viewer 但保留 Dock。
- 以冻结的 bar 数量和左右留白设置 visible range。
- 将 crosshair 聚焦到精确 bar。
- 高亮对应 marker/持仓区间。
- 恢复键盘焦点和读屏通知。

不得调用 Vela 私有字段或依赖不稳定 DOM 坐标。

### 8.5 高精度撮合

按现有 [`TODO.md`](TODO.md) 的 Bar detalization 方案实施：

- 默认父周期 OHLC/OLHC 四点路径。
- 按映射加载低周期 K 线并按时间回放。
- 市价、限价、止损、止盈、移动止损、反转、部分平仓和保证金事件。
- `calc_on_order_fills`、`calc_on_every_tick`、`process_orders_on_close`、`backtest_fill_limits_assumption`。
- 缺低周期数据时显式回退并展示原因。
- 结果记录 requested/applied precision、低周期和覆盖率。

这属于最终功能完备 Gate；不会为了提前展示 UI 而假装已支持。

### 8.6 能力归属与改造边界

| 能力 | 首要落点 | 是否需要底层 Fork |
| --- | --- | --- |
| Dock、Viewer、四个结果页、Simulation、状态管理和样式 | Quant Tools `src/features/backtesting` | 否 |
| 读取当前公开的概要、交易账本、Inputs/Properties | Quant Tools Vela Adapter | 否 |
| 透传 PineTS 已有但桥接裁掉的风险/交易字段 | Vela-PineTS | 是，必需 |
| 原子 runId、逐 K 权益/回撤、订单和 Fill 历史 | PineTS + Vela-PineTS | 是，最终版必需 |
| Bar Magnifier、低周期价格路径与成交顺序 | PineTS + Vela-PineTS Worker | 是，最终版必需 |
| Entry/Exit viewport、crosshair 和 marker 精确高亮 | Quant Tools Adapter 优先；Vela 公共 API 不足时进入 Vela | 条件式 |
| Binance/Hyperliquid OHLCV 获取和实时订阅 | 现有 Vela Provider | 否 |

执行原则是先在应用适配层证明公共 API 的能力边界，再引入最小源码改动。页面、报表公式和 Simulation 不得下沉到基础包；PineTS 不重复实现应用层可以由不可变原始数据纯计算得到的指标；Vela 不承担策略撮合。这样后续某项上游能力补齐时，可以删除对应本地补丁，而不需要重写整个回测工作区。

## 9. Fork 与本地源码依赖策略

### 9.1 Fork 决策矩阵

最终依赖形态统一为“**两个必需 Fork + 一个条件式 Fork**”，不得再默认三个基础包都长期本地化：

| 组件 | 当前基线 | 引入时点 | 最终处理 | 改造边界 |
| --- | --- | --- | --- | --- |
| Quant Tools 应用层 | 当前仓库 | G1 起 | 不 Fork | Dock、Viewer、四个 Tab、Simulation、状态和样式均在 `src/features/backtesting` |
| `@luxalgo/vela-pinets` | `0.2.13` | G4a | 必须维护本地 Fork | 扩展 PineTS→Vela 映射、Worker 消息、不可变结果和内联本地 PineTS |
| `pinets` | `0.9.34` | G4a | 最终版必须维护本地 Fork | G4b 增加可观测结果，G8 实现 Bar Magnifier 和低周期撮合 |
| `@luxalgo/vela` | `0.7.7` | G2 Spike 后决定，最迟 G4a | 条件式最小 Fork | 仅补公共 run selector 或精确 bar focus/marker highlight；公共 API 达标则继续使用官方精确版本 |
| Binance/Hyperliquid Provider | 随 Vela | 现有 | 不单独 Fork | 继续负责 OHLCV、symbol info、实时订阅和低周期序列 |
| Highcharts | 未安装 | G5 | 精确锁定 `13.0.0` 普通依赖，不 Fork | 报告图表，本地打包、按需加载，不修改其源码 |

边界解释：

- 回测页面本身绝不进入 Vela、Vela-PineTS 或 PineTS。
- PineTS 已有 CAGR、Sharpe、Sortino、Buy & Hold、currency、最大持仓和 trade bar index 等字段；仅开放这些字段时先修改 Vela-PineTS 映射，不重复改写 PineTS 计算。
- PineTS 当前没有满足本计划要求的不可变逐 K 报告、完整历史订单/Fill ledger 和低周期撮合，因此 G4b、G8 必须修改其源码；G4b 只增加可观测性，不改变成交语义。
- G2 必须用公开 API 实现定位 Spike，并生成 `docs/forks/VELA_FORK_DECISION.md`：记录可用 API、缺口、截图/像素证据、是否需要 Fork 和可删除补丁的条件。Spike 不得访问私有 renderer、内部字段或依赖 DOM 坐标。
- 若公开 Vela 已能满足稳定 run selector 与精确定位，则不创建 `packages/vela`，根依赖锁定官方 `0.7.7`；只有决策记录证明缺口不可由应用 Adapter 解决时，才导入 Vela 源码。
- 最终仓库应有两个本地源码包，或在 Vela Fork 被证明确有必要时有三个；目录、`package.json`、lockfile、构建脚本和决策记录必须完全一致。

### 9.2 管理方案

采用两层组合：

```text
Git subtree --squash
  └─ 保存官方完整源码、固定上游 SHA、支持后续同步

npm workspaces + file: dependencies
  └─ 本地解析、构建、测试和锁文件复现
```

不采用以下方式作为正式方案：

- 不修改或保存 `node_modules` 中的构建产物。
- 不把 npm 安装包中的 `dist` 当成 Fork 源码；当前安装包并不包含完整上游开发源码。
- 不用 `patch-package` 承担引擎级改造。
- 不用 Git branch/tag URL 作为依赖，避免安装时漂移、联网和无法可靠生成 `dist`。
- 当前不使用 submodule，避免 clone、CI 和部署遗漏初始化。
- 当前不建立私有 npm registry；出现第二个消费项目后再评估。

每个源码包按两次独立提交接入：第一笔只导入并验证未修改的上游源码，第二笔才增加 Quant Tools 补丁。不得把上游导入、格式化和功能改造混在同一提交，否则后续无法可靠区分 upstream delta。导入前还必须核对 npm 包版本、仓库 tag/commit、`package.json`、公开 exports 和固定 fixture 行为；若 npm 发布物没有可追溯到等价源码的 tag/SHA，则暂停该包的源码改造并先形成来源差异记录，不能随意选取相近分支冒充基线。

### 9.3 目标目录

```text
quant-tools/
├── src/
├── packages/
│   ├── vela/                  # 仅 VELA_FORK_DECISION 判定需要时存在
│   ├── vela-pinets/           # 完整上游源码，桥接与 Worker
│   └── pinets/                # 完整上游源码，策略执行与撮合
├── docs/
│   └── forks/
│       ├── VELA_FORK_DECISION.md
│       ├── vela.md             # 仅实际 Fork Vela 时存在
│       ├── vela-pinets.md
│       └── pinets.md
├── package.json
└── package-lock.json          # 根工作区唯一安装基线
```

每份 `docs/forks/*.md` 必须记录：

- 官方仓库 URL。
- 初始 tag、version 和完整 commit SHA。
- 本地版本号和导入日期。
- 修改目的、文件和公共 API。
- 上游源码导入提交与本地补丁提交。
- 对应单测/契约测试。
- 每次 subtree 同步、冲突处理和结果。
- 上游已提供等价能力时的补丁退场条件。

subtree 目录不包含嵌套 `.git`。各 subtree 自带的 lockfile 可保留用于来源审计和包内上游测试，但应用安装与发布只认根 `package-lock.json`。`node_modules`、缓存和临时构建目录不提交。默认不把可重建的 Fork `dist` 当作源码提交；根构建必须先生成依赖包 `dist` 再构建应用。

### 9.4 本地包解析

保留上游 package name，避免更改现有 import 和 peer dependency。默认的“两包本地化”配置为：

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  "dependencies": {
    "@luxalgo/vela": "0.7.7",
    "@luxalgo/vela-pinets": "file:./packages/vela-pinets",
    "pinets": "file:./packages/pinets"
  }
}
```

只有 `VELA_FORK_DECISION.md` 判定必须修改 Vela 时，才将第一项切换为 `"file:./packages/vela"` 并加入该源码目录。本地版本建议使用 build metadata，保持原 semver 基线和 peer range 兼容：

```text
@luxalgo/vela-pinets  0.2.13+quant.1
pinets                 0.9.34+quant.1
@luxalgo/vela          0.7.7+quant.1    # 仅条件式 Fork 启用时
```

规则：

- `file:` 是解析本地源码的硬约束；不能仅依赖同名 workspace 的隐式匹配。
- 根 `package-lock.json` 是应用 CI/本地构建的唯一依赖锁，必须提交。
- `npm ls @luxalgo/vela @luxalgo/vela-pinets pinets` 必须只有一份有效实例；PineTS、Vela-PineTS 必须解析到 workspace link，Vela 必须与决策记录一致地解析到精确 registry 版本或 workspace link。
- 应用只能从 package `exports` 导入，不允许深度导入 `packages/**/src`。
- 未进入 Fork 阶段前，上游包从 `^` 范围改为精确版本，禁止安装时静默升级。
- 根 package.json 记录已验证的 `engines.node` 和 `packageManager`；当前环境基线为 Node `24.15.0`、npm `11.13.0`、lockfile v3，正式写入前由 fresh build 再确认。
- Build metadata 只用于人读版本，不作为 Worker 身份证明。每个本地包必须生成机器可读 `fork-build-info`，至少包含 package name/version、upstream SHA、local patch revision 和 report schema version；Vela-PineTS 另外记录 bridge SHA 与 embedded PineTS SHA。
- in-process Engine 与 Worker 都必须把 build fingerprint 写入 `BacktestReport.provenance`；加入一个只有本地 PineTS 构建才会返回的无业务副作用 sentinel 契约，防止 Worker 意外内联 registry 版本或旧 `dist`。

### 9.5 构建和开发顺序

```text
packages/pinets → packages/vela-pinets ──────────┐
                                                  ├─→ Quant Tools App
@luxalgo/vela@0.7.7（默认）───────────────────────┘

packages/vela（条件式启用后替代官方 Vela）────────┘
```

要求：

1. `npm ci` 安装根 workspace 和全部构建依赖。
2. PineTS 先完成 build/typecheck/test；Vela 仅在本地 Fork 启用时执行同样步骤。
3. Vela-PineTS 使用本地 PineTS 和当前决策选定的 Vela 重新生成内联 Worker。
4. 运行 Vela-PineTS build/typecheck/test。
5. 再执行 Quant Tools 的 typecheck、build、单测和 E2E。

任何 PineTS 修改后都必须重建 Vela-PineTS；只重建根应用不能更新 Worker 中的 PineTS。根脚本新增：

- `build:forks`：按依赖顺序构建实际启用的本地包。
- `test:forks`：运行实际启用本地包的类型检查和测试。
- `predev`：至少保证 forks 已构建。
- `prebuild`：执行 `build:forks`。

频繁开发底层时使用各包 watch 或统一编排；Vite 仍消费包的公开 `dist/exports`，不能绕过包构建直接读取源码。

### 9.6 上游同步流程

每次升级必须作为独立变更执行：

1. 冻结当前 BTCUSDT fixture、数值、API 和视觉基线。
2. Fetch 官方 tags/commits，先确认目标 tag 与已发布 npm 包的来源对应，再在升级分支执行对应 `git subtree pull --squash`。
3. 解决本地差异冲突，不顺带重写不相关模块。
4. 更新 `docs/forks/*.md`、本地版本和根 lockfile。
5. 运行每个 Fork 的上游测试、本地新增测试和 typecheck。
6. 重新构建 Vela-PineTS Worker，核对实际内联的是目标 PineTS 版本。
7. 运行 Adapter 契约、BTCUSDT 数值对账、dev/prod E2E、Provider 和视觉测试。
8. 检查公共 API、bundle 和性能差异。
9. subtree 同步及完成合并所必需的机械冲突处理作为一笔提交；行为性本地适配、文档和 lockfile 另行提交；两者共同组成一个可回滚的升级变更集。

若未来需要把单个 subtree 发布为独立 Fork，可用 `git subtree split` 推送到专用仓库；本地单项目阶段不增加该维护成本。

### 9.7 可重复构建 Gate

Fork 接入后必须验证：

- Fresh clone，不依赖全局工具和旧 `dist`。
- 删除本地 Fork `dist`、根 `node_modules` 和 npm cache 后，`npm ci && npm run build` 能完整成功。
- `npm ci` 对 lockfile 不一致直接失败。
- lockfile 中实际启用的本地包条目为 workspace/file link，没有 registry 同名包重复实例；Vela 的解析方式与决策记录一致。
- 构建完成后 `git status` 干净，代码生成没有留下未提交文件。
- dev、production preview 和 E2E 实际加载本地版本及正确 Worker。
- 源码和产物不存在对 `node_modules` 的补丁依赖。
- 本地未改源码包接入后的固定 BTCUSDT 结果与原 registry 包逐笔一致，先证明依赖迁移为零行为变更。
- `BacktestReport.provenance`、Worker fingerprint、in-process fingerprint 和 `docs/forks` 中的 SHA 完全一致。
- Worker sentinel 契约通过，且故意替换成旧 Worker fixture 时测试能可靠失败。

“一次 clone 可构建”不等于完全离线；普通第三方依赖仍从 npm registry 安装。若以后要求断网安装，应独立建设 npm cache/mirror，不把整个 `node_modules` 提交进仓库。

### 9.8 Fork 引入与退场 Gate

每个条件式或新增补丁都必须满足相同治理规则：

1. 先用失败的能力/契约测试证明现有公开 API 确实不能满足需求。
2. 在 `docs/forks` 记录缺口、最小修改面、公开 API、测试、上游基线和负责人边界。
3. 只修改拥有该能力的最下层包；应用层问题不得通过修改 PineTS 或 Vela 掩盖。
4. 上游升级时先验证是否已经提供等价能力；若提供，则删除本地补丁并通过同一契约测试。
5. 某个包不再包含必要本地差异时，从 `packages/`、workspaces、`file:` 依赖和构建脚本一并移除，切回经过验证的精确 registry 版本，不长期保留无修改 Fork。

## 10. UI 一比一实施规范

### 10.1 视觉基线

G0 在固定 viewport、DPR、字体、timezone、locale 和数据下保存：

- Dock 展开、折叠、默认高度、最大可用高度。
- Viewer Header 和四个 Tab。
- 每个 Tab 的默认、hover、tooltip、选中和滚动状态。
- Settings Inputs/Properties。
- List、Calendar、Simulation 控件。
- loading、no-trades、open-only、partial、error。
- 桌面、平板、手机 portrait/landscape。

所有测量写入 `BACKTEST_PARITY_MATRIX.md`，包含尺寸、间距、字体、weight、line-height、颜色、border、radius、shadow、z-index、动画时长和 easing。

### 10.2 差分标准

- 主要容器、Dock、Header、Tab、表格列和图表边界几何差异不超过 1px。
- 文本和 Canvas/SVG 抗锯齿允许 2px 局部容差。
- 颜色 token、字体规格、文案、正负号、单位和格式必须精确一致。
- 排除实时价格、光标和随机 Simulation 后，桌面截图差异目标不高于 0.5%，移动端不高于 1%。
- 所有交互状态必须有结构化断言，不能只凭截图或肉眼判断。
- 如果操作系统字体栅格化造成差异，使用项目内固定字体资源和统一 Playwright 环境。

阈值在首轮基准截图建立后可收紧，但不得以放宽阈值掩盖结构错误。

### 10.3 响应式

- 桌面 Dock、Viewer 和表格行为按参考还原。
- 移动端不强行压缩桌面 Dock；按参考使用全屏 Report/Sheet。
- G0 实测移动端策略完成后的打开方式和返回后的再次入口。
- 验证断点前后 1px、portrait/landscape、safe-area、200% zoom、窄高和宽矮窗口。
- Tab 可横向滚动且不触发页面拖拽。
- 表格和 KPI 横向滚动不锁死纵向页面。
- hover-only 控件在 touch/hover:none 下提供等价常显或点击入口。
- Dock 高度是否跨刷新持久化以参考实测为准；如持久化，值必须版本化、校验并按 viewport clamp。

### 10.4 可访问性与视觉兼容

一比一复刻视觉和行为，但不复制静态参考中重复 ID、空 aria-label、无 tab 语义、背景可聚焦等不可见缺陷：

- Tab 使用 tablist/tab/tabpanel，并支持 Left/Right/Home/End。
- Splitter 提供 separator、valuemin/max/now、controls 和键盘箭头/Home/End。
- Collapse 提供 expanded/controls。
- Viewer 打开时管理焦点，Esc/Return 关闭并还焦。
- Viewer 打开时保持 Vela 图表挂载，但对被覆盖的图表、Dock 和菜单区域设置 `inert` 与合适的 `aria-hidden`；关闭时原子恢复，防止隐藏控件仍进入 Tab 顺序或读屏树。
- 图表提供可读描述或同数据表，不只靠红绿区分。
- 表格使用 caption、scope 和排序状态。
- Loading/result/error 使用克制的 live region。
- 支持 reduced-motion。
- 保持外观不变的前提下扩大透明触控 hit area。
- 策略标题只通过 `textContent` 渲染，避免脚本标题注入。

## 11. 性能、持久化与故障隔离

### 11.1 性能

- 聚合复杂度保持 O(trades + buckets)，每个 revision 只计算一次并 memoize。
- 1k/10k/100k trade fixtures 建立预算。
- Trades Log 使用虚拟列表或分页，不一次插入上万 DOM 行。
- 大曲线按像素宽度 downsample，同时保留 tooltip 原始数据访问。
- Simulation 超过阈值进入独立 Worker，支持 cancel 和 progress。
- Highcharts 懒加载、实例复用并显式 destroy。
- ResizeObserver 和 reflow 防抖，拖拽过程保持流畅。
- 面板隐藏时不重复渲染；重新显示后执行一次确定性 reflow。
- 为新增 JS/CSS 建立 bundle budget，避免无界增长。

### 11.2 持久化

不持久化计算结果。刷新后由已恢复的 Workspace 策略重新计算。

只允许持久化经 G0 确认的 UI 偏好，例如：

- Dock 高度。
- Dock collapse 状态。
- 可能的 View Mode。
- 首次完成提示是否已展示。

Viewer 每次重新打开默认 Performance 是已观察行为，不能被“记住最后 Tab”的常见做法破坏。策略 Inputs/Properties 继续由 Vela Workspace state 负责。

### 11.3 错误隔离与本地诊断

- 回测 UI 错误只降级 Backtesting Feature，不能使 Vela Workspace 崩溃。
- 用户可见 retry/close 和明确错误状态。
- 记录 run start/success/error/cancel/stale-drop、aggregation/render duration、trade count、cause、complete/finality。
- 诊断带 cell/strategy/revision correlation。
- 不记录 Pine 源码、完整交易明细、账户凭据或用户内容。
- 默认诊断为本地 no-op/console adapter，不引入外部运行依赖。

## 12. 分阶段实施 Gate

### G0：冻结动态、静态和公式对标合同

任务：

- [ ] 固定 Binance BTCUSDT / 1h、参考策略、本地 candle fixture、参数、日期、timezone、locale、viewport 和 DPR。
- [ ] 将视觉/交互基线与数值/引擎基线分开；数值基线使用双方可运行的源码受控 Pine 策略，并保存策略与 candles 校验和。
- [ ] 保存四个 Tab、Dock、Settings、List、Calendar、Simulation 的基准截图和结构化结果。
- [ ] 补测多 Strategy、多 Cell、0 trade、open-only、compile/runtime error、行情失败和重算失败。
- [ ] 补测 mobile 打开/返回、Dock 高度持久化、Reset defaults、Viewer scroll 恢复。
- [ ] 黑盒确认 P&L variation、Preserve win/loss 和风险指标公式。
- [ ] 冻结未平仓兼容行的 Trade #、epoch/`N/A` 显示规则，同时确认其不进入 closed/Calendar/Simulation 人口。
- [ ] 冻结 Viewer symbol 显示规则；不盲目复制一次样本中的 BTCUSD/BTCUSDT 差异。
- [ ] 建立字段级、状态级、网络级和视觉级 `BACKTEST_PARITY_MATRIX.md`。

退出条件：每个页面字段都有参考证据、人口、公式、单位、时区、来源和空值规则；不存在“开发时再猜”。

### G1：领域合同、fixtures 和纯函数

任务：

- [ ] 新建 BacktestKey、Report、Metric、Capabilities、Context、Trade/Order/Fill 模型。
- [ ] 实现 formatter、population selector 和全部指标纯函数。
- [ ] 建立固定 Binance BTCUSDT OHLCV、策略、账本和 simulation seed fixtures。
- [ ] 为 observed 13/14 人口差异建立显式兼容 fixture。
- [ ] 为不可用数据建立 `—` 与原因合同。

退出条件：公式和格式单测全通过；UI 不需要导入 Vela 类型即可渲染完整 fixture。

### G2：Vela 结果/控制/导航适配器

任务：

- [ ] 实现 bootstrap、完整事件表和销毁。
- [ ] 实现 revision、single-flight ledger、stale discard 和 epoch cancellation。
- [ ] 实现 active cell、多策略选择和 market 隔离。
- [ ] 实现 Inputs/Properties draft 与批量提交。
- [ ] 用 Vela 公开 API 实现当前可达的 chart navigation Adapter，不读取私有字段或 DOM 坐标。
- [ ] 完成精确 bar focus、crosshair、marker highlight 和不可变 run selector 的能力 Spike，形成 `docs/forks/VELA_FORK_DECISION.md`。
- [ ] 处理 partial history、aborted、forming 和 last-good。

退出条件：多 Cell、多策略、连续参数变化、隐藏、删除、源码改为 indicator、市场切换均不串数据；destroy/remount 无重复监听；Vela 是否 Fork 已有证据化结论，Adapter 不依赖私有实现。

### G3：Dock / Viewer 壳和响应式交互

任务：

- [ ] 改造 App Shell，增加应用层 Dock 和 Viewer。
- [ ] 实现拖拽、折叠、键盘 resize、reflow 和 z-index 协调。
- [ ] 实现 Header、Tab、返回图表、focus management 和 scroll container。
- [ ] 实现桌面/平板/手机布局与 safe-area。
- [ ] 加入 Settings、Favorite、Strategy badge 和 Show backtest 联动。

退出条件：使用 fixture 时壳层视觉差分达标；所有键盘、触摸和响应式交互通过；现有工具栏和编辑器无回归。

### G4a：本地源码依赖零行为变更接入

任务：

- [ ] 将根依赖的浮动范围先锁定为官方精确 `0.7.7 / 0.2.13 / 0.9.34`，保存 registry 行为基线。
- [ ] 核对 npm 发布物与官方 tag/SHA/exports/fixture 的来源一致性。
- [ ] 通过 subtree 导入 `pinets`、`vela-pinets` 完整源码；仅当 G2 决策要求时导入 Vela 完整源码。
- [ ] 建立 npm workspaces、`file:` 依赖、本地版本号和 `docs/forks/*.md`。
- [ ] 建立 `build:forks`、`test:forks`、predev/prebuild 和依赖构建顺序。
- [ ] 更新 `tests/architecture.test.mjs` 中硬编码的 `^` 版本断言，使其验证实际 `file:`/精确 Vela 决策、基线 SHA 和单实例解析。
- [ ] 加入机器可读 build fingerprint、Worker embedded PineTS SHA 和 sentinel 契约。
- [ ] 在任何功能补丁前，验证本地未改源码包与 registry 包在固定 BTCUSDT fixture 下的编译、逐笔交易和汇总结果一致。

退出条件：至少两个必需包解析到本地 workspace；Vela 按决策记录解析到精确 registry 版本或本地 workspace；fresh clone 可从源码构建；零改动本地包未改变任何回测行为；依赖迁移与后续能力改造可分别回滚。

### G4b：引擎桥接与不可变结果模型

任务：

- [ ] 对 Vela-PineTS 扩展公开回测结果映射、Worker 消息和按 runId 拉取能力。
- [ ] 仅在决策要求时对 Vela 做公共回测契约、runId selector 和精确定位所需的最小改动。
- [ ] 输出完整风险指标、币种、bar index 和最大持仓。
- [ ] 增加原子 runId/snapshot token 和按 runId 拉取的账本。
- [ ] 增加逐 K equity/drawdown/benchmark series。
- [ ] 增加 raw orders/fills、精确 reversal relation 和执行覆盖范围。
- [ ] 对齐 in-process 与 Worker 的字段和执行结果。
- [ ] 将 capability 从“缺失”切换为真实可用，并补全契约测试。
- [ ] 将本阶段限定为结果可观测性改造；与 G4a/registry 基线逐笔对比 Entry、Exit、Size、Price、P&L，任何撮合语义变化都退回并延后到 G8。

退出条件：Performance 和 Trades 所需结果均来自同一不可变 runId；除高精度撮合外，四个页面不再因桥接缺失而降级；交易结果与 G4a 基线完全相同；Report、Worker、in-process 和文档中的 build fingerprint 一致。

### G5：Performance 完整闭环

任务：

- [ ] 实现 Dock 五个 KPI 和主曲线。
- [ ] 以精确 `13.0.0` 引入 Highcharts，生成可按需加载的本地 chunk，不请求 CDN。
- [ ] 实现 Performance 三组图表和 All/Long/Short 表。
- [ ] 接入 Highcharts tooltip、legend、resize、empty 和 a11y 描述。
- [ ] 接入同一 runId 的 authoritative equity、drawdown、benchmark 和风险指标。
- [ ] 验证 Summary 与 Performance 各自人口和 mark-to-market 规则。

退出条件：Performance 所有参考字段、图表、tooltip、数值和状态均通过固定基准 fixture 与视觉差分；无近似正式指标。

### G6：Trades Analysis、Trades Log 与图表联动

任务：

- [ ] 实现 Analysis 图表、统计和 open/breakeven 兼容人口。
- [ ] 实现 Log 列表、稳定排序、虚拟化和 CSV。
- [ ] 实现 Calendar 月导航、每日/月度聚合。
- [ ] 按 G2 决策通过应用 Adapter 或最小 Vela Fork 实现 Entry/Exit 精确 bar 定位和 marker 高亮。
- [ ] 实现 reversal、partial close、pyramiding 和同 timestamp 多事件。

退出条件：逐笔字段、累计值、日历值和图表 marker 与固定参考逐行一致；定位结果在预定像素/bar 范围内。

### G7：Simulation 完整闭环

任务：

- [ ] 实现 Resample、Shuffle、variation、preserve win/loss。
- [ ] 实现风险指标、threshold、USD/%、Histogram/Cumulative。
- [ ] 实现 Worker、取消、进度、随机 seed 注入和大样本优化。
- [ ] 实现所有解释文案、tooltip、空态和样本不足状态。

退出条件：固定 seed 下所有 percentile、概率、曲线点、直方图 bucket 和表格逐值一致；Tab 操作不触发策略重跑。

### G8：高精度撮合补齐

任务：

- [ ] 在 `packages/pinets` 完成 Bar Magnifier 的默认四点路径和低周期回放。
- [ ] 补齐限价、止损、止盈、移动止损、反转、部分平仓和保证金事件顺序。
- [ ] 补齐 Pine 相关重算和成交配置语义。
- [ ] 展示 requested/applied precision、低周期、覆盖率和回退原因。
- [ ] 使用成对的父周期/映射低周期 Binance BTCUSDT OHLCV fixture 与参考逐笔对账。
- [ ] 覆盖低周期缺失、重复、越界、仅部分覆盖、仍在形成以及显式回退场景。
- [ ] 重建 `packages/vela-pinets` 内联 Worker，并对齐 in-process 和 Worker 执行结果。

退出条件：精度模式真实可验证；UI 不会仅因脚本参数存在就声称高精度已启用；固定样本下逐模拟点、逐 Fill、订单顺序和结果通过基准对账；in-process/Worker 的 fingerprint 与执行结果一致。

### G9：完整性、性能和独立运行验收

任务：

- [ ] 完成状态、错误、离线、超时、取消、重试和 stale 矩阵。
- [ ] 完成大数据、内存、拖拽、Tab 和 Simulation 性能测试。
- [ ] 完成 Chromium、WebKit 和支持范围内 Firefox 测试。
- [ ] 完成视觉回归、keyboard-only 和自动 a11y 测试。
- [ ] 在 fresh browser、dev、production preview、冷启动和刷新下验收。
- [ ] 主动阻断 LuxAlgo 域名并断言零请求。
- [ ] 验证构建产物无参考 HTML、Next chunk、远程字体或图标。
- [ ] 验证 Highcharts 精确锁定 `13.0.0`、从本地动态 chunk 加载且无 CDN 请求。
- [ ] 验证 `npm ls` 只有一份 Vela/Vela-PineTS/PineTS；两个必需包为本地 workspace，Vela 与 Fork 决策一致，lockfile 无重复或 invalid peer。
- [ ] 删除 Fork `dist` 和本地安装缓存后完成 fresh build，构建后 Git 工作区干净。
- [ ] 验证应用、Worker、in-process 报告的完整 build fingerprint 与 `docs/forks` 基线一致，并通过 sentinel 反向失败测试。
- [ ] 验证不存在 `node_modules` 修改、patch 或深度源码导入。
- [ ] 运行 `npm test`、`npm run build`、`npm run test:e2e`、`npm run test:e2e:prod` 和 `npm run test:providers`，确保零回归。

退出条件：第 14 节 Definition of Done 全部满足。

## 13. 测试矩阵

### 13.1 公式与领域单测

- 0 trade、open-only、1 win、1 loss、all win、all loss、all even。
- 手续费使毛盈利变净亏损。
- grossLoss=0、initialCapital=0、NaN、Infinity、-0。
- Long/Short、reversal、pyramiding、partial entry/exit。
- MFE/MAE、duration、streak、daily/weekly/weekday。
- timezone、DST、周末、缺失 bar、重复 bar。
- Summary/Analysis/Simulation 不同人口。
- 同一 fixture 明确断言 Dock/Summary 的 13 closed、61.54%，Analysis 的 14 rows、57.14%，Simulation 的 13 closed；差异必须来自命名 selector，不能由各页面私算。
- Simulation 固定 seed 和统计恒等式。

### 13.2 Adapter 契约测试

- `complete=false → true`。
- `history:complete(aborted)`。
- `run.trades()` reject、延迟、旧 revision 晚返回。
- 首次事件错过后的 bootstrap。
- 相同 indicatorId 在不同 Cell。
- strategy 更新为 indicator。
- updateCode 编译失败保留旧运行。
- visibility suspend/resume。
- cell create/destroy/restore。
- market load start/end/changed。
- app destroy 时仍有 Promise 在途。
- 未平仓 `exitTime=0`、epoch 和 `N/A` 在 Adapter 后均为 `null`，且不会进入 Calendar、closed 排序或 Simulation。

### 13.3 DOM 和交互测试

- Dock collapse/expand/resize/double reset。
- Viewer open/return/focus restore/Esc。
- Viewer 打开时后台 Vela/Dock/menu 为 inert 且不进入读屏树，关闭后完整恢复。
- Tab 键盘操作和 scroll position。
- Settings Cancel/Reset/Ok 请求计数。
- Favorite 在 Viewer、图例和指标列表之间同步。
- 表格排序、List/Calendar、CSV。
- Entry/Exit 定位。
- Simulation 控件、取消和重启。
- 唯一 ID、table semantics、aria state、live region。
- destroy 幂等和 HMR 重挂载。

### 13.4 E2E

- 固定 Binance BTCUSDT OHLCV + 固定策略的精确结果。
- strategy attach、inputs、properties、code、symbol、timeframe 重跑。
- 2 cells × 2 strategies 隔离。
- remove、hide/show、error、reload、workspace restore。
- dev 与 production preview。
- 请求计数：只有实际策略变化触发 run；Tab/排序/模拟不触发。
- 页面无未捕获异常、console error、HTTP 失败和 listener 泄漏。

### 13.5 Viewport 与视觉

- 1920×1080、1440×900、1280×800。
- 断点前后 1px。
- 1024、768、390×844、360×640、mobile landscape。
- DPR 1/2、200% zoom、touch/hover:none。
- Dock min/default/expanded。
- 四个 Tab、Settings、List、Calendar、Simulation。
- loading、partial、no-trades、open-only、error、positive、negative。
- 固定 clock、timezone、locale、font、DPR 和 seed。

### 13.6 性能预算测试

- 1k、10k、100k trades 聚合。
- 大账本虚拟滚动。
- 大曲线 downsample 与 tooltip。
- 1k/10k Simulation runs。
- 高频 tick 下不重复拉完整 ledger。
- Dock 拖拽和窗口 resize 无明显掉帧。
- 多次 open/close/remove 后内存回落、图表实例释放。

### 13.7 Fork 与可重复构建测试

- 官方 tag/SHA 与实际启用的本地目录基线一致；Vela 的目录/依赖形态与决策记录一致。
- registry 包与未修改本地源码包在固定 fixture 下逐笔、汇总和错误行为一致。
- `npm ls`、lockfile link 和 peer dependency 无重复或 invalid；现有架构测试不再硬编码旧的 `^` 范围。
- PineTS/Vela-PineTS 的 upstream SHA、local revision、bridge SHA、embedded PineTS SHA 和 schema version 能从 Worker 与 in-process 结果中读取并核对。
- Worker sentinel 正向通过，注入旧 Worker 的反向用例可靠失败。
- 删除所有 Fork `dist` 后能通过根构建重新生成。
- Fork build 不改写已跟踪源码或生成未提交文件。
- 上游同步模拟分支可以完整执行 build、typecheck、package tests 和 app contract tests。
- 应用打包不深度引用 `packages/**/src`，也不依赖 `node_modules` patch。
- Highcharts 在 lockfile 中精确为 `13.0.0`，运行时只加载本地 chunk。

## 14. 最终 Definition of Done

只有以下项目全部满足，任务才算完成。

### 14.1 功能完备

- [ ] 自动触发、设置、Dock、Viewer、四 Tab、Simulation、图表定位全部实现。
- [ ] 所有参考字段和控制均有功能，不存在有入口无实现。
- [ ] 多 Cell、多策略、实时、深历史和全状态矩阵正确。
- [ ] 无近似值冒充正式指标，无 unsupported 显示为 0。
- [ ] Bar Magnifier 显示的 applied precision 与实际撮合一致。

### 14.2 UI 与交互一比一

- [ ] 结构化交互 Parity Matrix 100% 通过。
- [ ] 桌面、平板、移动视觉差分达到第 10.2 节阈值。
- [ ] Tooltip、hover、focus、scroll、drag、calendar、chart animation 均对齐。
- [ ] 文案、单位、locale、符号、精度和颜色对齐。
- [ ] 不复制不可见的语义缺陷，键盘和触摸具有等价能力。

### 14.3 数值与引擎一致性

- [ ] 固定 candles、脚本、参数下，逐笔 Entry/Exit/Size/P&L/MFE/MAE 对齐。
- [ ] Summary、Performance、Analysis、Simulation 各自人口和公式对齐。
- [ ] 展示值误差不超过最小显示单位的一半。
- [ ] 精确曲线点、订单和账本属于同一 runId。
- [ ] 固定 seed 下 Simulation 逐值可复现。

### 14.4 稳定性与独立性

- [ ] 所有单测、契约测试、E2E、视觉、a11y、性能测试通过。
- [ ] 现有工具栏、指标、编辑器、收藏、模板和 Provider 测试零回归。
- [ ] destroy/remount、HMR、刷新和 Workspace 恢复无重复监听或状态复活。
- [ ] Fresh checkout 可完成 install、build、preview 和确定性 E2E。
- [ ] 阻断参考站全部域名后功能仍可运行，构建和运行请求为零。
- [ ] 两个必需 Fork 以及任何被决策启用的 Vela Fork，其完整源码、基线 SHA、本地差异和测试记录均在仓库内。
- [ ] Fork 决策记录与实际目录、依赖、lockfile 和构建脚本一致；不存在无必要却长期 vendored 的 Vela。
- [ ] 应用和 Worker 对必需 Fork 只解析本地 workspace 版本，不存在同名 registry 重复包；Vela 的来源与决策记录一致。
- [ ] PineTS 修改后必经 Vela-PineTS Worker 重建，实际运行版本可验证。
- [ ] 每个 BacktestReport 携带完整 build fingerprint，Worker、in-process、构建文档和运行结果中的 SHA 一致。
- [ ] 构建不依赖修改后的 `node_modules`，Fresh clone 后无需人工补丁。

## 15. 完备性复核后已直接纳入的优化

本计划在初稿基础上经过动态交互、静态页面、架构/API、QA 四个角度复核，已补入以下容易遗漏但会影响最终质量的事项：

1. 初始化阶段通过 `handle.context()` 补采已经运行的恢复策略。
2. `cellId + indicatorId + revision + epoch` 防止跨 Cell 和过期账本覆盖。
3. `run.trades()` single-flight、合并刷新和 tick lazy load。
4. `history:complete(aborted)`、partial、forming 和 provisional 的真实状态。
5. 单一 BacktestReport 加页面 selector，兼容 13/14 交易人口差异。
6. 每项指标的 capability、provenance 和 unavailable reason。
7. Engine summary、trade-derived、逐 K mark-to-market 三种口径严格分离。
8. App Shell 级 Bottom Dock，而不是误用 Vela SidePanel 或私有 DOM。
9. 为精确 Entry/Exit 定位新增稳定 Chart Port，不调用 Vela 私有方法。
10. 多策略、多 Cell、源码从 strategy 变 indicator、失败 updateCode 等生命周期。
11. Simulation 的确定性 seed、Worker、取消和大数据性能。
12. 响应式断点、移动端、safe-area、200% zoom、touch/hover:none。
13. Visual parity 与不可见 a11y 缺陷分离，保持外观一致但补齐语义。
14. Highcharts 生命周期、虚拟列表、downsample 和 bundle/performance gate。
15. 阻断参考域名的独立运行 E2E，而不是只靠代码审查判断独立性。
16. 明确页面、桥接、引擎、图表宿主和 Provider 的能力归属，避免用底层 Fork 解决应用层问题。
17. 统一为 PineTS、Vela-PineTS 两个必需 Fork，加经公开 API Spike 决定的 Vela 条件式 Fork。
18. Git subtree 与 npm workspaces 组合，保证一次 clone、可同步上游和本地源码解析。
19. 将 G4 拆成零行为变更的源码接入与结果能力改造，避免依赖迁移回归和引擎回归混在一起。
20. PineTS → Vela-PineTS Worker 的强制重建链、机器可读 fingerprint 和 sentinel，避免实际 Worker 仍运行旧引擎。
21. G4b 只增加结果可观测性，撮合语义统一留在 G8，并使用父/低周期成对 fixture 验证。
22. 精确版本、根 lockfile、单实例解析、Highcharts 本地 chunk 和 fresh build Gate，禁止隐式漂移或 CDN 依赖。
23. Fork 基线 SHA、本地公共 API、补丁退场条件、测试与升级记录，确保未来同步上游可审计、可回滚。
24. 将视觉/交互对标与数值/引擎对账拆成两套基线，数据或策略不同时不误判撮合差异。
25. 在 Adapter 边界把未平仓 epoch/`N/A` sentinel 规范为 `null`，将兼容显示与统计语义解耦。
26. Viewer 覆盖图表时使用 inert/aria-hidden 隔离后台交互，同时保持 Vela 实例挂载。
27. 对 Dock、Analysis、Simulation 的 13/14 人口差异建立跨页面一致性断言，禁止页面私算。

经本轮复核后，计划已经覆盖从策略运行、数据一致性、四页功能、视觉交互、引擎补齐、本地 Fork 生命周期，到性能、错误恢复和独立运行的完整闭环。后续实施过程中若 G0 发现新的参考行为，只能先更新 Parity Matrix 和本计划对应合同，再进入代码实现，避免凭主观设计偏离一比一目标；若底层能力可由新版上游公开 API 满足，则优先收缩本地差异，而不是永久保留不必要的 Fork。
