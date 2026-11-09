# 文档导航

[English](README.md)

CoFlow **0.5.0** · [中文 Wiki](https://github.com/Vic020/CoFlow/wiki/Home-zh-CN) · [English Wiki](https://github.com/Vic020/CoFlow/wiki)

**让团队看见每一次 Agent 推进。** 汇集多个 Agent 的进展、交付与反馈，让团队抓住需要关注的重点。

| 目标 | 文档 |
| --- | --- |
| 使用 AI 助手、配置模型与确认业务操作 | [AI 助手首版](ASSISTANT_V0.4.md) |
| 组织多人、多 Agent 协同交付 | [协作指南：理念、工具接入与页面／工作手册](COLLABORATION_GUIDE.md) |
| 创建团队、上报与协作 | [使用指南](USAGE.md) |
| 为 Agent 安装并复用上报能力 | [Agent 接入](AGENT_REPORTING.md) |
| 解决登录、邀请与上报问题 | [排障指南](TROUBLESHOOTING.md) |
| 本地开发与隔离测试 | [开发指南](DEVELOPMENT.md) |
| 自托管、升级、备份与回滚 | [部署指南](DEPLOYMENT.md) |
| 构建合成数据的公开离线演示 | [GitHub Pages](GITHUB_PAGES.md) |
| 维护翻译与展示时区 | [多语言](I18N.md) |
| 实施 0.2 Todo 与 Timeline 联动 | [Todo 功能与实施计划](TODO_V0.2.md) |
| 设计 0.3 默认上报日历与跨模块排期 | [Calendar 功能与实施计划](CALENDAR_V0.3.md) |
| 了解现有能力与后续范围 | [产品定义](PRODUCT.md) · [路线图](ROADMAP.md) |
| 团队试用与检查验收事实 | [试用清单](PILOT.md) · [验证记录](VERIFICATION.md) |
| 准备发布与查看版本变化 | [版本管理](VERSIONING.md) · [0.5.0 发布说明](releases/v0.5.0.md) · [更新日志](../CHANGELOG.md) |
| 在 GitHub 构建通用 Docker 镜像 | [镜像构建](IMAGE_BUILDS.md) |
| 维护文档、Wiki、Projects 与发布流程 | [维护规范](MAINTENANCE.md) |
| 跨 session／模型接手 GitHub 管理 | [分步操作与 Agent 交接手册](GITHUB_OPERATIONS.md) |


[可续跑发布工具](RELEASE_AUTOMATION.md)


[统一界面与加载反馈规范](UI_DESIGN.md)

## 协议源文件

- [CoFlow Skill](../skills/coflow/SKILL.md)：安装、身份校验、上报和 Todo 共用一个入口，详细规则按需读取链接的参考文件。
- [OpenAPI](openapi.yaml)：字段、接口和权限；API 基础路径为 `/api/v1`。
- [合成简报示例](example-report.json)：新工作使用新 source_id，持续更新沿用原标识。

实例中的 `/agent/coflow/SKILL.md` 和 `/agent/openapi.yaml` 由 `scripts/sync-agent-assets.mjs` 从规范源文件生成。

## 使用边界

真实团队使用 PostgreSQL 和账号；本机演示与 Pages 使用独立合成数据，Pages 无后端。0.5.0 包含 Timeline、Todo、Calendar、AI 助手与 Context；真实模型兼容性、其余协议和统计继续独立验收。外部 Agent 使用统一 CoFlow Skill 与 HTTP API；平台助手还支持经授权的只读远程 MCP Client。CLI 和 CoFlow 对外 MCP Server 继续规划。

- [协作闭环](COLLABORATION_LOOP.md)：0.4.1 起提供增量反馈、接续事实与任务推进确认。

- [任务验收](TODO_ACCEPTANCE.md)：0.4.1 起提供验收标准、指定验收人与交接记录。

- [独立联网服务](WEB_SERVICES.md)：搜索／抓取供应商、个人与团队配置及使用边界。

[Context、阻塞与委托](CONTEXT.md) — 本地 Unreleased 实现与验收边界。
