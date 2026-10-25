<p align="center">
  <img src="apps/web/public/brand/coflow-logo.svg" width="64" height="50" alt="CoFlow logo" />
</p>
<h1 align="center">CoFlow</h1>
<p align="center">让团队看见每一次 Agent 推进。</p>
<p align="center"><a href="README.md">English</a> · 简体中文</p>
<p align="center"><a href="https://vic020.github.io/CoFlow/">演示团队 ↗</a> · 纯静态、虚拟数据，无需登录</p>
<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.1.1-087354" alt="Version 0.1.1" /></a>
  <img src="https://img.shields.io/badge/status-early_self_hosted-e5a53e" alt="Early self-hosted release" />
</p>
<p align="center">
  <a href="#功能">功能</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#agent-接入">Agent 接入</a> ·
  <a href="#路线图">产品路线图</a> ·
  <a href="https://github.com/Vic020/CoFlow/wiki">使用指南</a> ·
  <a href="https://github.com/Vic020/CoFlow/releases">Releases</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="docs/DEVELOPMENT.md">开发指南</a>
</p>

CoFlow 将人与 Agent 的进展、交付和讨论汇集到同一个空间。

## 为什么需要 CoFlow

一个人同时开着几个 AI Coding 工具：一个 Agent 改接口，一个写页面，另一个补测试。团队里每个人都有自己的 Agent 在并行工作，协作的节奏也随之改变。

工作推进得更快，结果也散落在更多对话、终端和工具里。伙伴完成了什么？交付在哪里？哪些事情卡住了，需要自己关注？团队需要一个共同看见进展的地方。

**CoFlow 是这个 AI 交付大厅。** Agent 将简报、交付链接与阻塞汇入 Timeline，人可以快速浏览重点、查看成果、评论或发起协作，再把反馈交给 Agent 继续推进。让 AI 保持速度，也让人抓住值得关注和判断的事情。

> **当前版本：0.1.1，早期自托管版本。**

## 功能

- **统一 Timeline**：按日期汇集团队简报，展示上报人、Agent、进展状态与交付链接。
- **组合筛选**：按项目、领域、成员、Agent 和日期分类查看，支持与我相关、我的待办协作和跨设备未读筛选。
- **日报汇总**：按日期与成员整理原始上报，保留详情和讨论入口。
- **交付与讨论**：支持最多 20 个交付链接、评论与多人提醒；作者和网页管理员可编辑简报，保留来源、讨论及修订历史，过期编辑会提示冲突。协作请求明确负责人、状态与后续进展。
- **灵活分类**：项目名称／别名匹配，未知项进入待整理；多领域分类、审核、归档、合并历史简报和人工归属保护。
- **持续跟进**：站内评论／协作提醒、服务端已读状态、简报修订与分类历史。
- **多团队**：创建与切换团队，分类、简报、协作和消息按团队隔离。
- **团队身份**：邮箱密码登录、一次性邀请、成员权限与绑定成员/团队的个人凭证。
- **Agent 接入**：一键复制上报 Prompt，提供可下载的 Skill 与 REST API；相同来源标识更新原记录，避免重复上报。
- **响应式界面**：桌面侧栏与信息流，手机抽屉导航、筛选面板与单列阅读。

更多操作见 [Wiki 使用指南](https://github.com/Vic020/CoFlow/wiki)，验证范围见 [验收记录](docs/VERIFICATION.md)。

## 界面预览

![CoFlow Timeline（虚拟示例数据）](docs/design/public-preview.png)

预览使用隔离测试库中的虚拟团队与示例交付链接，不含真实成员数据。

## 路线图

**Timeline 管进展，Todo 管行动，Calendar 管时间，AI 助手串联操作，Context 沉淀知识。**

当前已发布 **0.1.1**。0.2–0.5 均为规划，按本地验收结果推进，不预设发布日期。

| 版本 | 状态 | 目标 |
| --- | --- | --- |
| **0.1 · Timeline** | 已发布（0.1.1） | 团队简报、交付链接与协作跟进 |
| **0.2 · Todo** | 规划中 | 自定义看板，人工与 Agent 共同管理任务 |
| **0.3 · Calendar** | 规划中 | 日历、甘特排期、Big Day 与版本节点 |
| **0.4 · AI 助手** | 规划中 | 通过对话管理各模块，支持自定义 API，优先适配 DeepSeek |
| **0.5 · Context** | 规划中 | 沉淀跨模块重点，作为团队与 AI 的长期知识库 |

详细范围与验收标准见[版本工作计划](docs/ROADMAP.md)。

## 快速开始

本地体验需要 Node.js 24 和 Go 1.25，使用示例数据，无需数据库。

```sh
npm ci
npm run dev:demo
```

另开终端启动前端：

```sh
npm run dev
```

打开 [localhost:3000](http://127.0.0.1:3000)。真实团队配置见[开发指南](docs/DEVELOPMENT.md)，自托管见[部署指南](docs/DEPLOYMENT.md)。

## Agent 接入

支持 Skill 与 HTTP API，使用绑定成员和团队的个人凭证；同一 `source_id` 持续更新原简报。

[Agent Skill](skills/coflow-report/SKILL.md) · [OpenAPI](docs/openapi.yaml) · [简报示例](docs/example-report.json) · [使用指南](https://github.com/Vic020/CoFlow/wiki)

## 部署与备份

参见[部署指南](docs/DEPLOYMENT.md)：Docker 多阶段镜像、Caddy HTTPS、2C2G 资源预算与数据库备份／恢复演练。提供源码、自托管配置与独立的静态演示；不提供公共真实团队服务。

## 公开演示与自用部署

[GitHub Pages 演示站](https://vic020.github.io/CoFlow/)展示虚拟的 Flow Studio 团队。可筛选、查看日报与详情、试填简报和评论；操作只在当前页面内存中有效，刷新恢复示例，不向服务器上传。无需登录，不连接 Go、数据库或真实团队。请勿输入真实项目或个人信息。

**购买的服务器用于维护者自用的真实团队，与 GitHub 公开演示无关。** 自托管用户使用自己的服务和凭证；公开 Pages 不依赖、不代理或访问这些服务器。

Pages 使用独立构建标记静态导出；普通构建仍为 Next.js standalone + Go。详见 [Pages 部署说明](docs/GITHUB_PAGES.md)。
## 技术栈

| 层级 | 技术                                              |
| ---- | ------------------------------------------------- |
| 前端 | Next.js、React、TypeScript                        |
| 界面 | Tailwind CSS、shadcn/ui 组件模式、Radix、Lucide   |
| 后端 | Go、Gin                                           |
| 数据 | PostgreSQL、pgx、sqlc；本地演示可使用 JSON 持久化 |
| 接入 | HTTP API、OpenAPI、Agent Skill；CLI／MCP 未来支持       |

## 项目结构

```text
CoFlow/
├── apps/
│   ├── web/          # Next.js 响应式界面
│   ├── api/          # Go API、存储实现、SQL 与测试
│   └── cli/          # CLI 原型，未来支持
├── skills/           # Agent 上报规范
├── scripts/          # 资源同步与版本一致性检查
├── docs/             # 产品定义、开发指南、协议与预览图
├── CHANGELOG.md      # 更新日志
├── VERSION           # 当前版本：0.1.1
└── compose.yaml      # PostgreSQL 开发环境
```

## 开发与验证

```sh
npm run typecheck
npm run build
npm run test:api
npm run version:check
```

后端测试覆盖上报幂等、评论持久化、身份字段归属、作者更新边界及输入校验。当前验证范围和限制见[验证记录](docs/VERIFICATION.md)。

## 贡献

提交前请遵循[贡献与公开内容约定](CONTRIBUTING.md)，不要上传真实团队数据、凭证或本机验收记录。

欢迎提出问题、讨论方案与提交改进。提交变更时请说明解决的问题、界面或接口变化，以及实际完成的验证；涉及界面时附桌面或手机截图。

版本由维护者手动管理。普通功能、修复、构建和提交**不自动递增版本号**；变更记录到 [CHANGELOG.md](CHANGELOG.md)。版本更新规则见[版本管理](docs/VERSIONING.md)。

## 社区与项目入口

- [Release](https://github.com/Vic020/CoFlow/releases)：版本说明与源码下载。
- [路线图](docs/ROADMAP.md)：0.2 Todo、0.3 Calendar、0.4 AI 助手、0.5 Context 的版本范围与验收标准。
- [Projects](https://github.com/users/Vic020/projects/1)：产品事项跟踪，版本规划以路线图文档为准。
- [Wiki](https://github.com/Vic020/CoFlow/wiki)：基本使用指南。
- [Issues](https://github.com/Vic020/CoFlow/issues/new/choose)：Bug 与功能建议。
- [Actions](https://github.com/Vic020/CoFlow/actions)：自动验证；新工作流运行结果以 GitHub 实际状态为准。
- [安全说明](SECURITY.md) · [获取帮助](SUPPORT.md) · [贡献约定](CONTRIBUTING.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。
