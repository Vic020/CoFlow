# 文档导航

[English](README.md)

CoFlow **0.2.2** · [中文 Wiki](https://github.com/Vic020/CoFlow/wiki/Home-zh-CN) · [English Wiki](https://github.com/Vic020/CoFlow/wiki)

**让团队看见每一次 Agent 推进。** 汇集多个 Agent 的进展、交付与反馈，让团队抓住需要关注的重点。

| 目标 | 文档 |
| --- | --- |
| 组织多人、多 Agent 协同交付 | [协作指南：理念、工具接入与页面／工作手册](COLLABORATION_GUIDE.md) |
| 创建团队、上报与协作 | [使用指南](USAGE.md) |
| 为 Agent 安装并复用上报能力 | [Agent 接入](AGENT_REPORTING.md) |
| 解决登录、邀请与上报问题 | [排障指南](TROUBLESHOOTING.md) |
| 本地开发与隔离测试 | [开发指南](DEVELOPMENT.md) |
| 自托管、升级、备份与回滚 | [部署指南](DEPLOYMENT.md) |
| 构建合成数据的公开离线演示 | [GitHub Pages](GITHUB_PAGES.md) |
| 维护翻译与展示时区 | [多语言](I18N.md) |
| 实施 0.2 Todo 与 Timeline 联动 | [Todo 功能与实施计划](TODO_V0.2.md) |
| 了解现有能力与后续范围 | [产品定义](PRODUCT.md) · [路线图](ROADMAP.md) |
| 团队试用与检查验收事实 | [试用清单](PILOT.md) · [验证记录](VERIFICATION.md) |
| 准备发布与查看版本变化 | [版本管理](VERSIONING.md) · [0.2.2 发布说明](releases/v0.2.2.md) · [更新日志](../CHANGELOG.md) |
| 在 GitHub 构建通用 Docker 镜像 | [镜像构建](IMAGE_BUILDS.md) |
| 维护文档、Wiki、Projects 与发布流程 | [维护规范](MAINTENANCE.md) |

## 协议源文件

- [CoFlow Skill](../skills/coflow/SKILL.md)：安装、身份校验、上报和 Todo 共用一个入口，详细规则按需读取链接的参考文件。
- [OpenAPI](openapi.yaml)：字段、接口和权限；API 基础路径为 `/api/v1`。
- [合成简报示例](example-report.json)：新工作使用新 source_id，持续更新沿用原标识。

实例中的 `/agent/coflow/SKILL.md` 和 `/agent/openapi.yaml` 由 `scripts/sync-agent-assets.mjs` 从规范源文件生成。

## 使用边界

真实团队使用 PostgreSQL 和账号；本机演示与 Pages 使用独立合成数据，Pages 无后端。0.2.2 包含 Todo 与 Timeline 联动。Calendar、AI 助手、Context 和数据统计为后续规划。当前支持统一 CoFlow Skill 与 HTTP API，CLI／MCP 为未来接入方式。

源码发布、Pages 更新和私有服务器部署分别安排。公开文档只保留通用示例；部署清单、凭证、备份与真实团队数据不进入 Git。参见[安全说明](../SECURITY.md)与[贡献约定](../CONTRIBUTING.md)。
