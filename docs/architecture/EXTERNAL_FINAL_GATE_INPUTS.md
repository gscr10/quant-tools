# External Final Gate Inputs

本文件只记录无法在本机自证的验收输入与判定标准。没有对应输入时必须标记 `not_run` 或 `PARTIAL`，不得用本地 fixture 代替。

2026-10-07 当前范围以 [需求状态表](../backtesting/current/BACKTEST_REQUIREMENTS_STATUS.md) 为准：固定 BTCUSDT/15m/SMA 数值窗口、Hyperliquid/Binance 本机两小时及双引擎代表 CONNECT 静默恢复已通过；当前纳入本阶段的本地功能、桌面 Workspace 和构建门禁已完成。线上部署/CDN/rollback、Replay、Safari、手机适配及实体桌面 VoiceOver 按需求表暂缓；以下输入仅供未来恢复这些范围时使用。

## 1. 线上部署 / rollback / CDN

用户已要求本阶段先忽略这一项；不再作为当前 P1 的阻塞条件，也不标为通过。以下输入留给后续恢复验收时使用。

需要提供：

- candidate HTTPS 地址：`QUANT_DEPLOY_URL`
- previous/rollback HTTPS 地址：`QUANT_PREVIOUS_URL`
- 实际部署槽位切换记录（时间、制品 commit、manifest SHA-256）
- CDN purge/invalidation 记录和浏览器缓存清理方式

远程 CI 可使用仓库 Variables `QUANT_DEPLOY_URL` 和可选的 `QUANT_PREVIOUS_URL` 自动执行同一 smoke；未配置时会显式标记 `not_run`，不会让 CI 伪造线上通过。

执行：

```bash
QUANT_DEPLOY_URL=https://candidate.example \
QUANT_PREVIOUS_URL=https://previous.example \
npm run test:e2e:deployment
```

通过标准：candidate 和 previous 均返回 200；入口不可缓存；hash 资源 immutable；页面无错误；无参考站请求；切回 previous 后旧 hash 仍可加载。

## 2. 长时 WebSocket / 断网恢复

需要提供：

- 可持续运行至少 2 小时的浏览器/服务器环境
- GitHub Actions 手动触发 `Final gates` workflow 的 `provider-soak` job 可作为 10 轮真实网络采样入口（它仍不是 2 小时断网证明）
- 可控断网、代理黑洞或网络策略注入
- 当前验证路由的实际连接日志：Hyperliquid 与 Binance Spot 本机两小时均已通过；修复版 Binance Spot 两小时长测已通过：实际观测 7,200.111 秒、23 次恢复、3,458 callbacks，29/29 sockets 创建/关闭平衡；activeSubscriptions/activeSockets/offlineBars/late callbacks 均为 0、cleanupErrors=[]，close 等待 2,066ms。终态 5 文件 SHA-256 及 Provider 源码哈希已核对。默认浏览器路径（`explicitBrowserProxy=false`）未排除系统代理/PAC/VPN；新增双引擎 CONNECT 静默故障通过：真实 TLS bytes 扣留约 45 秒，navigator 始终在线、账本/revision 稳定，放行后约 2.57 秒恢复；16/16 隧道关闭。证据在忽略目录 `audit-evidence/2026-10-07-provider-connect-blackhole/`；不代表全部代理/地区或完整应用长时。Futures 可选路由的 451 不阻塞已通过部分。

通过标准：断网期间无旧代次数据回写；恢复后只建立一个有效 lease；无重复 socket、定时器或订阅；恢复后的行情和回测 revision 连续。

## 3. 参考站逐笔 golden

需要提供：

- `BTCUSDT · 15m · SMA` 与本地完全相同的时间窗口、结束 K 线、实际 OHLC、源码和参数（仅根数相同不足以证明输入相同）；Binance.US 与全球 Spot 分别记录来源
- 参考站完整 Trades Log JSON（不能是截断的 DOM 文本）
- 本地对应 report JSON

执行：

```bash
REFERENCE_GOLDEN=/path/reference.json \
LOCAL_GOLDEN=/path/local.json \
npm run test:reference:golden
```

通过标准：交易数量一致，且每笔 Trade # 的方向、Entry/Exit 时间与价格、Size、P&L、MFE、MAE 全部在约定容差内一致；open row 的展示差异必须单独记录。

Comparator 还会在输入阶段拒绝以下不完整证据：缺少或重复的 Trade #、双方都省略的字段、非有限数值，以及无法归一化的数字。未平仓交易的 Exit 字段可以显式为 `null`，但不能省略；方向大小写和数字字符串会按规范归一化。这样可以避免把截断导出或字段缺失误报为 parity。

## 4. 桌面 VoiceOver / 手机专项（当前暂缓）

实体桌面 VoiceOver 按 SCOPE-08 暂缓；Safari 专项按 SCOPE-03 暂缓；手机端布局、手机触摸及手机实机专项按用户最新决定 SCOPE-07 暂缓。三项均不作为当前完成条件，未来恢复范围时再提供对应环境。

2026-10-07 本机能力核对：通过 ApplicationServices 调用 `AXIsProcessTrusted()` 返回 `false`；System Events 只读查询未返回，已终止该次查询。当前工具进程没有可用的系统辅助功能自动化权限，不将浏览器 AX/DOM 检查称为 VoiceOver 已验。当前开发工具路径也未提供 `devicectl`、`xctrace` 或 `adb`；这只说明没有已配置的设备测试入口，不推断用户没有实体设备。未变更系统权限或读屏设置。

需要提供：

- 可用的 macOS VoiceOver 环境；手机 iOS/Android 设备输入留待恢复 SCOPE-07 时再使用

恢复本节时的通过标准：桌面四个 Viewer Tab、Settings、Simulation、返回图表、焦点回收及读屏名称/状态均通过。当前不执行实体读屏或手机触摸验收；Playwright WebKit 或浏览器 AX 检查不能代替真实读屏证据。

## 5. 工作区组件与交互对标、本地布局适配

参考站地址与访问授权已经提供；以下材料由后续复测采集，不要求用户重复提供截图或登录信息：

- 浏览器版本、DPR、字体、时区、viewport，以及两站各自有效工作区宽高
- 同输入/状态下参考站与本地各模块的稳定截图、DOM 和实际交互记录；必要时隔离同宽组件对照
- 截图生成时间和输入数据 SHA-256

通过标准（2026-10-07 用户修正）：Backtest Workspace 全模块的功能、交互、图标与组件风格一致，整体布局适配本项目可用空间；没有 AI 侧栏/登录 banner，也不留占位。按模块、viewport、状态和交互逐项验证，解释合理伸展/换行等差异，修复遮挡、裁切、不可读重叠和不可达入口。截图差分是诊断工具，不以整页绝对坐标或像素误差百分比作硬门槛；不能只比较 Performance，也不能自动刷新本地基线或将未验条目改为通过。

2026-10-07 固定数值窗口已有完整输入并通过；Hyperliquid/Binance 本机两小时、代表静默恢复及 REL-06 完整生产 Workspace 两小时终态均已完成各自合同。PERF-01 的固定 Chromium 生产预算和列明的跨浏览器功能/资源合同也已通过，计时和设备限制见需求表。桌面 Backtest Workspace 组件和本地布局适配已按当前标准完成；实体桌面 VoiceOver、手机适配/手机实机触摸暂缓。不能再将已验长测与性能合同重新列为待办。

## 6. 最近一次真实网络门禁记录（2026-10-03）

- 普通 push 门禁：已通过（本地构建、单元、复杂撮合、触摸、视觉/a11y）。
- 手动 workflow `37132010789`：60 秒连续订阅及 browser offline/online recovery 成功，Binance Spot/Futures 与 Hyperliquid history/live 均返回有效数据；这只是短时真实网络证据。
- 手动 workflow `37133498353`（600 秒）和 `37134927725`（120 秒）：在 Binance 初始请求处收到 `TypeError: Failed to fetch`；有限重试后仍失败，未进入连续订阅阶段，因此不能计为长时通过。
- 这些结果证明门禁能正确暴露上游网络不可用，也证明短时恢复路径可运行；不证明小时级 WebSocket 稳定性、跨区域代理黑洞或持续断网恢复。后续长时验证应在可访问交易所 API 的 runner/网络条件下执行并保留完整输出。
- 手动 workflow `37150267544`（2026-10-03，`provider_duration_seconds=7200`）的 local-gates 通过，但 provider-soak 在 Binance 初始请求处经 3 次重试仍为 `Failed to fetch`，deployment 因未配置 `QUANT_DEPLOY_URL` 保持 `not_run`；该运行不能关闭任何外部 Final Gate。
- （截至 2026-10-03 的历史结论）先前本机记录不足以证明 7200 秒连续 lease soak 已完整执行；短时探针的无 callback 结果不能归因为两小时运行失败。后续 §7 已补齐 Hyperliquid 两小时终态；2026-10-07 修复版 Binance Spot 两小时已取得 passed 终态，见 §3 当前路由记录。此前失败批次保留，不改写旧结果。

## 7. 本机重新验证（2026-10-06）

- `python3 tests/provider_smoke.py --duration-seconds 120 --recovery` 实际退出码为 0，总耗时 141.703 秒；同一页面连续订阅 120 秒。Binance 收到 61 次回调，最大间隔 7,566ms；Hyperliquid 收到 135 次回调，最大间隔 8,469ms。两者断网期间回调数为 0，恢复后均收到新行情。Futures 历史与 metadata 检查通过；此结果不证明 Futures 连续 WebSocket 稳定性。
- Provider wrapper 已增加首次 live callback 后 12 秒静默 watchdog；静默时会替换 lease、拒绝旧代次回调，并在构造器瞬时失败后以 2 秒延迟重试。定向 provider-live/soak/CLI 测试 31/31 通过。
- watchdog 版本 Hyperliquid 90 秒真实 soak 通过：84 candle callbacks、最大间隔 3,974ms、2 次 offline→online 恢复、3 个 socket 创建/关闭平衡、offline/late callback/cleanup error 均为 0。随后两小时 Hyperliquid scope 已通过：7200.133 秒、8617 callbacks、23 次恢复、24/24 socket 创建/关闭、最终 active=0、offlineBars=0、cleanup 三项为 0，终态 SHA-256 已核对。2026-10-07 Binance 本机两小时也已通过，见 §3；Futures 451 和 Spot 可达性需分开记录，不扩展为 all-provider 通过或所有路由不可用。
- 本机真实 `safaridriver` 创建 Safari session 返回 `session not created`：必须在 Safari Settings 的 Developer 部分启用 `Allow remote automation`。Safari 已安装，但此次真实浏览器自动化尚未执行；没有更改用户系统授权设置。
