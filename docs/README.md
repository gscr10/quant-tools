# 项目文档

这里是 Quant Tools 的 GitHub 文档入口。

## 从哪里开始

- [项目说明与开发命令](../README.md)
- [回测工作区文档](backtesting/README.md)
- [架构改造计划](architecture/ARCHITECTURE_REFACTOR_PLAN.md)
- [本地 fork 与依赖基线](forks/DEPENDENCY_BASELINE.md)
- [构建与部署说明](architecture/BUILD_AND_DEPLOYMENT.md)
- [首次加载与行情初始化优化计划](architecture/STARTUP_LOADING_OPTIMIZATION_PLAN.md)

## 文档分层

| 目录 | 内容 | 提交建议 |
| --- | --- | --- |
| `docs/backtesting/` | 回测文档导航（README） | GitHub 公开保留 |
| `docs/forks/` | PineTS/Vela-PineTS fork、版本和构建约定 | GitHub 公开保留 |
| `docs/backtesting/current/` | 当前有效的回测需求、计划、状态矩阵和回归基线 | GitHub 公开保留 |
| `audit-evidence/`、`docs/audit/`、`docs/backtesting/reports/` | 审计截图、原始响应、历史报告和清理记录 | 仅本地/私有归档，不进入 GitHub |

## GitHub 发布原则

源码、测试、依赖基线和当前状态文档可以公开；参考站账户、Cookie、登录态、workspace 标识、
本机绝对路径和大体积截图/原始响应不应进入公开发布包。审计材料应保存在私有归档中，
公开仓库只保留必要的摘要和当前状态。
