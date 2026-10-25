<p align="center">
  <img src="apps/web/public/brand/coflow-logo.svg" width="64" height="50" alt="CoFlow logo" />
</p>
<h1 align="center">CoFlow</h1>
<p align="center">让团队看见每一次 Agent 推进。</p>
<p align="center"><a href="https://vic020.github.io/CoFlow/">演示团队 ↗</a> · 纯静态、虚拟数据，无需登录</p>
<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.1.1-087354" alt="Version 0.1.1" /></a>
  <img src="https://img.shields.io/badge/status-early_self_hosted-e5a53e" alt="Early self-hosted release" />
  <img src="https://img.shields.io/badge/Next.js-TypeScript-17212d" alt="Next.js and TypeScript" />
  <img src="https://img.shields.io/badge/backend-Go-00ADD8" alt="Go backend" />
</p>
<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#agent-接入">Agent 接入</a> ·
  <a href="https://github.com/users/Vic020/projects/1">产品路线图</a> ·
  <a href="https://github.com/Vic020/CoFlow/wiki">使用指南</a> ·
  <a href="https://github.com/Vic020/CoFlow/releases">Releases</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="docs/DEVELOPMENT.md">开发指南</a>
</p>

CoFlow 是面向异地团队的 Agent 进展与交付协作空间。成员通过 Codex、Claude Code 等工具上报简报和交付链接，团队在统一的 Timeline 中浏览、评论并讨论阻塞。

> **当前版本：0.1.1，早期自托管版本。** 已支持 PostgreSQL 真实账号、团队邀请、个人 Agent 凭证，以及 Timeline、日报和评论。已提供部署配置和数据库备份脚本，公网体验与容量仍需验收，邮件能力尚未提供；独立演示模式继续保留。

## 界面预览

![CoFlow Timeline（虚拟示例数据）](docs/design/public-preview.png)

预览使用隔离测试库中的虚拟团队与示例交付链接，不含真实成员数据。

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

## 技术栈

| 层级 | 技术                                              |
| ---- | ------------------------------------------------- |
| 前端 | Next.js、React、TypeScript                        |
| 界面 | Tailwind CSS、shadcn/ui 组件模式、Radix、Lucide   |
| 后端 | Go、Gin                                           |
| 数据 | PostgreSQL、pgx、sqlc；本地演示可使用 JSON 持久化 |
| 接入 | HTTP API、OpenAPI、Agent Skill；CLI／MCP 未来支持       |

## 快速开始

### 环境要求

- Node.js 24 与 npm
- Go 1.25
- Docker：仅在需要 PostgreSQL 开发环境时使用

### 安装与启动

在项目根目录安装前端依赖：

```sh
npm ci
docker compose up -d db
```

启动团队模式后端（首次启动自动迁移数据库）：

首次创建管理员使用 `http://127.0.0.1:3000/?token=<初始化 token>` 私密链接，校验通过后才展示表单，不提供 token 输入框。请在本机私下保存生成的值，不要提交到 Git。已初始化后正常登录无需 token。

```sh
export COFLOW_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
DATABASE_URL='postgres://coflow:coflow_dev@127.0.0.1:5432/coflow?sslmode=disable' npm run dev:api
```

另开一个终端启动前端：

```sh
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，创建首个管理员和工作空间，再到团队设置邀请成员。

只体验原有示例数据可运行 `npm run dev:demo`；此模式不要求 PostgreSQL，简报保存在被忽略的 `apps/api/.data/demo.json`。

修改端口、使用 PostgreSQL、配置环境变量与重新生成 SQL 查询，见[开发指南](docs/DEVELOPMENT.md)。

## Agent 接入

Agent 凭证可在侧栏或 `/credentials` 页面创建与管理，支持权限、有效期、撤销，以及复制上报 Prompt。完整凭证只在创建时弹窗明文显示，关闭或离开页面后清除。团队设置提供成员、邀请、项目与领域四个管理分类；项目与领域支持拖拽排序（手机可上下移动，键盘可使用 Alt + ↑ / ↓），顺序保存到团队并同步 Timeline。Timeline 也保留分类快捷编辑入口。左上角可切换或新建团队，各团队可以使用不同称呼。首次复制「配置 Prompt」交给 Agent，校验身份后保存到本机用户目录；之后复制不含密钥的上报 Prompt，优先读取 COFLOW_TOKEN，否则读取指定文件，并校验团队与成员。

在 Timeline 右侧点击 **创建接入凭证**，创建绑定自己的 Token；之后点击 **复制上报 Prompt**，粘贴给正在工作的 Agent，即可让它读取规范并上报。顶部 **上报**打开统一弹窗，可切换手动或 Agent 等上报方式。支持直接复制提示词、下载 Skill、查看 API 命令与 JSON 示例；切换页签保留手动草稿。CLI、MCP 页签位于末尾，标记为暂未提供。

默认本地 Prompt：

```text
读一下 http://127.0.0.1:3000/agent/coflow-report/SKILL.md，服务地址是 http://127.0.0.1:3000，我的凭证是 <个人凭证>，按照要求上报一下当前项目的进展、交付链接和阻塞。
```

| 接入资源     | 位置                                                           |
| ------------ | -------------------------------------------------------------- |
| 在线 Skill   | `/agent/coflow-report/SKILL.md`                                |
| Skill 源文件 | [skills/coflow-report/SKILL.md](skills/coflow-report/SKILL.md) |
| 在线 OpenAPI | `/agent/openapi.yaml`                                          |
| 协议源文件   | [docs/openapi.yaml](docs/openapi.yaml)                         |
| 示例简报     | [docs/example-report.json](docs/example-report.json)           |

### 本机凭证配置

创建凭证后，复制一次性的「配置 Prompt」交给 Agent，明确授权它校验身份并保存凭证。保存路径由页面生成：

```text
~/.coflow/credentials/<编码后的服务 origin>/<编码后的 team_id>/<编码后的 member_id>.token
```

站点标识使用 `encodeURIComponent(new URL(service).origin)`；团队／成员 ID 同样编码，并将 `.` 额外编码为 `%2E`。例如服务 `http://127.0.0.1:3000` 的目录名为 `http%3A%2F%2F127.0.0.1%3A3000`。使用提示词给出的完整路径，无需人工拼接。

- 每台电脑可创建自己的凭证，名称建议包含设备名，例如「MacBook」。同一电脑的多个 Agent 可共用该文件。
- 文件只保存 token，POSIX 目录权限为 `700`、文件为 `600`；Windows 使用仅当前用户可访问的 ACL。明文文件的安全性低于系统钥匙串，应保护本机账号。
- 首次配置先校验服务、团队和成员，再保存；已有不同凭证须确认后替换。无保存指令时，凭证仅用于当前请求。
- 日常提示词不含密钥，指定读取路径；环境变量或文件凭证无效、身份不符时停止，不扫描其他路径或聊天记录寻找替代品。
- 浏览器不写入本机文件，不持久保存密钥。文件由获得授权的 Agent 创建在用户目录中，不进入项目或 Git；设备丢失或停用时在凭证页撤销，删除本机文件不等于撤销。

CLI 与 MCP 标记为未来支持，当前请使用 Agent Prompt、Skill 或 HTTP API。仓库中的 CLI 原型暂不作为正式接入方式。

当前本机 URL 仅供能访问这台电脑的 Agent 使用；其他电脑或云端 Agent 需要可访问的部署地址。团队模式使用个人 Bearer 凭证，可限制权限、设置有效期并撤销，完整值仅在创建时返回。独立演示模式不使用个人凭证。

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

## 路线图

- [x] Timeline、组合筛选、日报汇总与响应式布局
- [x] 简报、交付链接、评论与上报去重
- [x] 一键复制上报 Prompt、Skill 下载、HTTP API
- [x] 网页编辑简报、多人关注与多链接表单
- [x] 正式登录、邀请加入与团队权限
- [x] 个人 Agent 凭证及撤销
- [x] 项目与领域管理
- [x] 跨设备未读与站内通知
- [x] PostgreSQL 迁移与身份/隔离集成验证
- [ ] 正式团队部署与备份
- [ ] CLI／MCP 正式接入

后续版本：**0.2 Todo 看板**，支持自定义列及人与 Agent 共同管理；**0.3 Calendar**，支持项目／领域日历、甘特排期、Big Day 与版本节点。

实施顺序与验收标准见[版本工作计划](docs/ROADMAP.md)，现有功能范围见[产品定义](docs/PRODUCT.md)。

## 贡献

提交前请遵循[贡献与公开内容约定](CONTRIBUTING.md)，不要上传真实团队数据、凭证或本机验收记录。

欢迎提出问题、讨论方案与提交改进。提交变更时请说明解决的问题、界面或接口变化，以及实际完成的验证；涉及界面时附桌面或手机截图。

版本由维护者手动管理。普通功能、修复、构建和提交**不自动递增版本号**；变更记录到 [CHANGELOG.md](CHANGELOG.md)。版本更新规则见[版本管理](docs/VERSIONING.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。

## 部署与备份

参见[部署指南](docs/DEPLOYMENT.md)：Docker 多阶段镜像、Caddy HTTPS、2C2G 资源预算与数据库备份／恢复演练。提供源码、自托管配置与独立的静态演示；不提供公共真实团队服务。

## 社区与项目入口

- [Release](https://github.com/Vic020/CoFlow/releases)：版本说明与源码下载。
- [Projects](https://github.com/users/Vic020/projects/1)：0.2 Todo、0.3 Calendar 产品计划。
- [Wiki](https://github.com/Vic020/CoFlow/wiki)：基本使用指南。
- [Issues](https://github.com/Vic020/CoFlow/issues/new/choose)：Bug 与功能建议。
- [Actions](https://github.com/Vic020/CoFlow/actions)：自动验证；新工作流运行结果以 GitHub 实际状态为准。
- [安全说明](SECURITY.md) · [获取帮助](SUPPORT.md) · [贡献约定](CONTRIBUTING.md)。

## 公开演示与自用部署

[GitHub Pages 演示站](https://vic020.github.io/CoFlow/)展示虚拟的 Flow Studio 团队。可筛选、查看日报与详情、试填简报和评论；操作只在当前页面内存中有效，刷新恢复示例，不向服务器上传。无需登录，不连接 Go、数据库或真实团队。请勿输入真实项目或个人信息。

**购买的服务器用于维护者自用的真实团队，与 GitHub 公开演示无关。** 自托管用户使用自己的服务和凭证；公开 Pages 不依赖、不代理或访问这些服务器。

Pages 使用独立构建标记静态导出；普通构建仍为 Next.js standalone + Go。详见 [Pages 部署说明](docs/GITHUB_PAGES.md)。
