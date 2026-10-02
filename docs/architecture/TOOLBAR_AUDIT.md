# LuxAlgo Quant 顶部工具栏对标审计

对标页面：<https://app.luxalgo.com/quant?chart=maximized>

本项目现在直接使用参考页面同源的 `@luxalgo/vela/workspace` 承载图表工具栏、布局、图表历史和侧栏，避免继续维护一套外观相似但行为不同的手写实现。

| 参考入口 | 本项目对应 | 点击后的实际功能 | 结论 |
| --- | --- | --- | --- |
| Symbol | BTCUSDT | 打开完整品种搜索，优先使用 Binance，Hyperliquid 作为额外数据源 | 已对标 |
| Timeframe | 15m | 打开 1m–1M 周期菜单并切换真实行情 | 已对标 |
| Chart style | Candles | Candles / Bars / Line / Area / Baseline / Heikin Ashi | 已对标 |
| Layout | 1 | 1×1–4×4 多图布局，并提供 Symbol / Interval / Crosshair / Style 同步开关 | 已重新实现；原入口只有禁用占位 |
| Indicators | Indicators | 保留 On chart 管理，并明确分为 Favorites、Built-ins、My indicators；个人保存的 Pine 指标可直接添加、收藏、编辑和删除 | 已对标并补齐个人指标管理 |
| Favorite indicators | Indicators 右侧下拉箭头 | 快速添加收藏指标；收藏状态与指标弹窗、图表指标行及个人脚本统一 | 已对标，不再与 Indicators 重复 |
| Indicator Templates | 书签按钮 | 保存、应用、查看和删除完整工作区模板 | 已重新实现；原入口错误指向“我的脚本” |
| Undo / Redo | 撤销 / 重做 | 操作指标、绘图等图表历史 | 已修复；原实现错误操作代码编辑器文本 |
| Data window | 数据窗口按钮 | 打开真实数据侧栏，显示时间、OHLC、成交量和指标值 | 已修复；原实现只隐藏/显示图表标题 |
| Object tree | 对象树按钮 | 打开真实对象树侧栏，管理图表、指标和绘图对象 | 已修复；原实现只是临时指标下拉菜单 |
| Pine editor | 代码按钮 | 打开可调整宽度的 Pine 编辑器侧栏，支持运行、保存、另存、收藏和日志 | 已对标 |
| Screenshot | 相机按钮 | 下载当前单图或多图布局 PNG | 已对标 |

Data window、Object tree、Pine editor 采用与参考页相同的互斥侧栏逻辑；同一时间只展开一个。顶部已无“有入口但无实际功能”的占位按钮。
