# External Final Gate Inputs

本文件只记录无法在本机自证的验收输入与判定标准。没有对应输入时必须标记 `not_run` 或 `PARTIAL`，不得用本地 fixture 代替。

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
- Binance Spot/Futures 与 Hyperliquid 的实际连接日志

通过标准：断网期间无旧代次数据回写；恢复后只建立一个有效 lease；无重复 socket、定时器或订阅；恢复后的行情和回测 revision 连续。

## 3. 参考站逐笔 golden

需要提供：

- 与本地完全相同的 ticker、周期、时间区间、策略源码和参数
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

## 4. VoiceOver / 真实触摸设备

Safari 专项按用户要求移出本阶段验收范围，不标为通过。VoiceOver 和真实设备触摸仍保留。

需要提供：

- VoiceOver 开启的 macOS/iOS 设备
- 至少一台真实 iOS 或 Android 触摸设备

通过标准：四个 Viewer Tab、Settings、Simulation、返回图表、焦点回收、读屏名称/状态、触摸滚动和点击均通过；Playwright WebKit 只能作为补充证据。

## 5. 全量像素级对账

需要提供：

- 同一浏览器版本、DPR、字体、时区和窗口尺寸
- 参考站与本地各页面的稳定截图
- 截图生成时间和输入数据 SHA-256

通过标准：按页面、viewport、状态和交互阶段逐张比较；差异阈值、允许的动态区域和未对账区域必须显式列出，不能只比较单个 Performance 页面。

当前这些输入均未完整提供，因此整体 Final Gate 继续保持 `PARTIAL`。

## 6. 最近一次真实网络门禁记录（2026-10-03）

- 普通 push 门禁：已通过（本地构建、单元、复杂撮合、触摸、视觉/a11y）。
- 手动 workflow `37132010789`：60 秒连续订阅及 browser offline/online recovery 成功，Binance Spot/Futures 与 Hyperliquid history/live 均返回有效数据；这只是短时真实网络证据。
- 手动 workflow `37133498353`（600 秒）和 `37134927725`（120 秒）：在 Binance 初始请求处收到 `TypeError: Failed to fetch`；有限重试后仍失败，未进入连续订阅阶段，因此不能计为长时通过。
- 这些结果证明门禁能正确暴露上游网络不可用，也证明短时恢复路径可运行；不证明小时级 WebSocket 稳定性、跨区域代理黑洞或持续断网恢复。后续长时验证应在可访问交易所 API 的 runner/网络条件下执行并保留完整输出。
- 手动 workflow `37150267544`（2026-10-03，`provider_duration_seconds=7200`）的 local-gates 通过，但 provider-soak 在 Binance 初始请求处经 3 次重试仍为 `Failed to fetch`，deployment 因未配置 `QUANT_DEPLOY_URL` 保持 `not_run`；该运行不能关闭任何外部 Final Gate。
- 先前本机记录不足以证明 7200 秒连续 lease soak 已完整执行；短时探针的无 callback 结果不能归因为两小时运行失败。小时级验证仍未完成。

## 7. 本机重新验证（2026-10-06）

- `python3 tests/provider_smoke.py --duration-seconds 120 --recovery` 实际退出码为 0，总耗时 141.703 秒；同一页面连续订阅 120 秒。Binance 收到 61 次回调，最大间隔 7,566ms；Hyperliquid 收到 135 次回调，最大间隔 8,469ms。两者断网期间回调数为 0，恢复后均收到新行情。Futures 历史与 metadata 检查通过；此结果不证明 Futures 连续 WebSocket 稳定性。
- Provider wrapper 已增加首次 live callback 后 12 秒静默 watchdog；静默时会替换 lease、拒绝旧代次回调，并在构造器瞬时失败后以 2 秒延迟重试。定向 provider-live/soak/CLI 测试 31/31 通过。
- watchdog 版本 Hyperliquid 90 秒真实 soak 通过：84 candle callbacks、最大间隔 3,974ms、2 次 offline→online 恢复、3 个 socket 创建/关闭平衡、offline/late callback/cleanup error 均为 0。随后两小时 Hyperliquid scope 已通过：7200.133 秒、8617 callbacks、23 次恢复、24/24 socket 创建/关闭、最终 active=0、offlineBars=0、cleanup 三项为 0，终态 SHA-256 已核对。Binance Spot/Futures 长时仍受网络/HTTP 451 限制，不能扩展为 all-provider 通过。
- 本机真实 `safaridriver` 创建 Safari session 返回 `session not created`：必须在 Safari Settings 的 Developer 部分启用 `Allow remote automation`。Safari 已安装，但此次真实浏览器自动化尚未执行；没有更改用户系统授权设置。
