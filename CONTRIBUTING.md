# Contributing

感谢参与 Quant Tools。提交代码前请先确认改动属于当前分支目标，并避免把本地产物或审计原始材料混入业务提交。

## 开发流程

```bash
npm ci
npm test
npm run build
npm run check:dependencies
npm run check:dist:independence
git diff --check
```

涉及回测工作区时，还应运行相关 Playwright E2E。涉及 `packages/pinets` 或
`packages/vela-pinets` 时，同时运行对应 workspace 测试和 typecheck。

## 提交边界

- 业务修复、测试、文档整理分开提交。
- 不提交 `dist/`、日志、PID、临时 shell 输出、浏览器 profile 或认证状态。
- `audit-evidence/`、`docs/audit/` 和 `docs/backtesting/reports/` 是本地/私有审计目录，
  已加入 `.gitignore`，不要使用 `git add -f` 将其带入公开提交。
- 不在源码、测试、Issue 或 commit message 中写入密码、Cookie、token 或个人账户信息。

## Pull Request 建议

描述变更范围、验证命令、已知限制和是否影响本地 fork。回测行为变化应同时更新对应的
Parity Matrix/TODO 状态，但不要覆盖历史审计报告。
