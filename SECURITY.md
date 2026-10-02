# Security policy

## Reporting a vulnerability

请不要在公开 Issue 中提交密码、Cookie、token、API key、账户信息或可复现的私有 workspace 数据。

如果发现安全问题，请通过私下渠道联系项目维护者，并提供：

- 受影响的 commit 或版本；
- 最小复现步骤；
- 影响范围；
- 不包含敏感凭据的日志或截图。

## 本地凭据

Provider/API 凭据只能通过环境变量或本地未跟踪配置提供。参考站登录态、storage state 和浏览器 profile
不得进入仓库。审计截图、原始响应和浏览器复跑材料应保存在本地或私有归档中，
不作为公开 GitHub 构建内容提交。
