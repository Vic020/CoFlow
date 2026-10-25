# 开发指南

CoFlow 0.1.4 支持真实团队模式，以及独立的本地演示模式。版本由维护者手动管理。

## 环境

- Node.js 24、npm、Go 1.25。
- 团队模式需要 PostgreSQL；本地可使用 Docker Compose。
- Go 读取进程环境变量，不自动读取 `.env`。配置参考根目录 `.env.example`。

## 团队模式

```sh
npm ci
docker compose up -d db
export COFLOW_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
export DATABASE_URL='postgres://coflow:coflow_dev@127.0.0.1:5432/coflow?sslmode=disable'
npm run dev:api
```

另开终端：

```sh
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。首次访问使用 `http://127.0.0.1:3000/?token=<本机初始化 token>`，校验通过后创建管理员和工作空间；这是一次性初始化，数据库已有账号后不能再次创建管理员。无效链接不展示初始化表单。随后新成员只能通过邀请加入。

默认监听本机。部署前先完成工作空间初始化，配置实际站点 `COFLOW_WEB_ORIGIN`、HTTPS 和 `COFLOW_SECURE_COOKIES=true`，更换开发数据库口令，并安排备份。每个实例的服务器、域名和正式部署独立配置，不写入公开仓库。默认前端为 3000、API 为 8080；端口被占用时，修改 Go 的 `COFLOW_ADDR`，同时设置 Next.js 的 `API_BASE_URL`。后者用于构建／开发时的同源转发，生产镜像默认使用 Compose 内网的 `http://api:8080`。

## 会话、邀请与权限

- 密码使用 bcrypt 哈希，长度 8–72 字节。
- 浏览器使用 7 天有效的 HttpOnly、SameSite=Lax 会话 Cookie，数据库只存会话哈希。退出即撤销当前会话。
- 成员可以按邮箱生成邀请。链接通过页面手动复制分享，不自动发邮件。邀请 7 天有效、一次性使用，创建者或管理员可以撤销。
- 邀请原文只在生成时返回；链接使用 `/#invite=...`，不把邀请放入服务端 URL 查询参数。
- 已有账号接受邀请时需匹配当前登录账号或验证原密码，不会通过邀请重置密码。
- 管理员可移除普通成员；不能移除管理员。移除同时撤销该团队下的会话和全部 Agent 凭证，重新加入不会恢复旧凭证。
- 多团队账号可以在侧栏左上角的团队菜单中切换或新建团队。成员、项目、简报和评论读取都以当前团队为边界。
- 暂无邮箱验证、找回密码或管理员转让界面；不要把邀请当作密码重置入口。

## 个人 Agent 凭证

打开侧栏的 Agent 凭证，为当前成员和团队创建凭证。可选权限：只读、读取与上报、读取/上报/评论；有效期 1–365 天，默认 90 天。

完整凭证仅创建时返回，数据库只存哈希、前缀和管理元数据。一次性弹窗提供安装提示词，关闭后清除内存中的密钥，不写入浏览器本地存储。Agent 校验服务与目标身份后安装用户级 Skill、保存本机凭证并关联当前项目；日常通过「上报 CoFlow」或页面复制的简短指令复用。同一工作沿用 source_id。

HTTP 使用 `Authorization: Bearer <个人凭证>`。本机路径、权限、调度建议和失败恢复见 [Agent 接入](AGENT_REPORTING.md) 与[规范 Skill](../skills/coflow-report/SKILL.md)。不要在开发文档中粘贴安装提示词中的真实密钥。CLI、MCP 暂未正式支持。

不要把真实凭证写进示例文件、源码或日志。Agent 身份来自 Token，不采信请求体的作者或团队字段；Agent 无权管理账号、邀请和凭证，管理员 Token 也不获得管理他人简报的权限。

新的团队默认创建“团队协作”项目（ID `general`）和初始领域，项目／领域管理、别名、归档、合并及排序已支持。

## 独立演示模式

```sh
npm run dev:demo
```

未配置 DATABASE_URL 时，演示简报保存在 `apps/api/.data/demo.json`，所有写入归属演示成员陈一，不要求凭证。与团队模式的数据、登录和凭证明确区分。不要把演示模式暴露为正式团队服务。

## PostgreSQL 迁移

Go 启动时在数据库事务中执行内嵌 SQL 迁移，使用数据库锁防止并发执行，并记录 SHA-256 校验值。已应用迁移不可修改，后续变化增加新迁移文件。

Compose 仅启动数据库与持久化卷，不依赖从 macOS 挂载初始化 SQL 文件。已有数据卷会保留；不要通过删除数据卷应用迁移。

SQL 修改后，在 `apps/api` 生成查询：

```sh
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate
```

`internal/db` 生成代码纳入源码。根目录 `scripts/sync-agent-assets.mjs` 在前端 dev/build 前同步 Skill 和 OpenAPI 到下载目录；运行中的下载内容可手动执行此脚本更新。

## 验证

```sh
npm run version:check
npm run typecheck
npm run test:agent
npm run test:i18n
npm run test:demo
npm run test:api
npm run build --workspace @coflow/web -- --webpack
```

完整身份集成测试（在 `apps/api`）：

```sh
COFLOW_TEST_DATABASE_URL='postgres://coflow:coflow_dev@127.0.0.1:5432/coflow?sslmode=disable' go test -race -count=1 ./...
```

每个身份集成测试会创建独立的随机 schema，并在结束后清理；不会清空或覆盖正式团队表。未设置变量时，这部分测试明确跳过，演示测试仍运行。

## 分类与协作

迁移 003 增加 `classifications`、多领域、原始分类、人工归属锁、简报历史、协作请求／更新、消息与已读记录。Go `internal/workspace` 用 PostgreSQL 事务和团队级 advisory lock 串行化分类整理与上报，防止并发提议重复或合并丢失；保留 sqlc 管理报告读写。

成员在团队设置管理分类，未知名称先进入 pending。同一个 source_id 的 Agent 更新会保留人工纠正后的归属；其余内容仍可更新。归档项保留历史筛选，但不接收新报告。旧单领域字段 domain 兼容，团队模式推荐 domains 数组；demo 保持原协议和本地未读。

`/catalog`、`/collaborations` 和简报历史可供有 reports:read 的 Agent 读取；协作写入需要 comments:write，分类整理与已读／站内信只允许网页登录。通知在创建或更新的同一事务内落库，不发外部邮件／消息，页面每 30 秒轮询。已读提交展示过的 updated_at，避免吞掉并发的新进展。

生产准备见 [DEPLOYMENT.md](DEPLOYMENT.md)。更改版本时也需手动同步 compose.production.yaml 中的应用镜像标签；开发和提交不会自动升级版本。

团队内称呼保存在 memberships.display_name，迁移 004 为已有成员回填账号名。创建新团队可传 display_name，/auth/me 与 /meta 按当前团队返回称呼，账号、密码及旧 Agent Token 的团队归属保持不变。

## 界面语言

默认英文，支持简体中文；账号菜单直接切换并保存账号语言。字典、扩展规范与本地验证见[多语言说明](I18N.md)。用户写入的业务内容保持原文。

## 代码与数据入口

| 目录 | 责任 |
| --- | --- |
| `apps/web` | 页面、交互、多语言与同源 API 转发 |
| `apps/api/internal/identity` | 账号、团队、会话、邀请、个人资料与 Agent 凭证 |
| `apps/api/internal/workspace` | 分类、简报修订、协作、通知等团队业务 |
| `apps/api/db/migrations` | 内嵌数据库迁移；新增文件，不修改已应用内容 |
| `apps/api/db/queries` | sqlc 查询源文件 |
| `skills/coflow-report`、`docs/openapi.yaml` | Agent 与 HTTP 协议规范源文件 |

迁移 006–008 分别增加个人语言偏好、头像与展示时区。昵称使用成员关系中的 display_name，头像与语言／展示时区属于账号；修改密码撤销其他网页会话，不自动撤销 Agent Token。身份与授权逻辑在 Go 中完成，不依赖隐藏前端按钮。

新增个人资料或日期界面时遵循 [I18N.md](I18N.md)。个人偏好 PATCH 支持部分字段更新，缺省字段不能覆盖现有值；时间戳保持原值，日期分组使用展示时区。

测试只使用合成身份和独立测试 schema。不要把生产 DATABASE_URL 传给测试，也不要提交 `.local/`、数据库导出、浏览器会话或 QA 截图。完成前检查 `git diff --check` 和拟提交内容；验收事实与限制记录到 [VERIFICATION.md](VERIFICATION.md)，功能变化写入 CHANGELOG 的 Unreleased。
