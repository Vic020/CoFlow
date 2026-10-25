# 开发指南

CoFlow 0.1.3 支持真实团队模式，以及独立的本地演示模式。版本由维护者手动管理。

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

默认监听本机。部署前先完成工作空间初始化，配置实际站点 `COFLOW_WEB_ORIGIN`、HTTPS 和 `COFLOW_SECURE_COOKIES=true`，更换开发数据库口令，并安排备份。服务器、域名和正式部署仍需单独落实。

## 会话、邀请与权限

- 密码使用 bcrypt 哈希，长度 8–72 字节。
- 浏览器使用 7 天有效的 HttpOnly、SameSite=Lax 会话 Cookie，数据库只存会话哈希。退出即撤销当前会话。
- 成员可以按邮箱生成邀请。链接通过页面手动复制分享，不自动发邮件。邀请 7 天有效、一次性使用，创建者或管理员可以撤销。
- 邀请原文只在生成时返回；链接使用 `/#invite=...`，不把邀请放入服务端 URL 查询参数。
- 已有账号接受邀请时需匹配当前登录账号或验证原密码，不会通过邀请重置密码。
- 管理员可移除普通成员；不能移除管理员。移除同时撤销该团队下的会话和全部 Agent 凭证，重新加入不会恢复旧凭证。
- 多团队账号可以在团队设置中切换。成员、项目、简报和评论读取都以当前团队为边界。
- 暂无邮箱验证、找回密码或管理员转让界面；不要把邀请当作密码重置入口。

## 个人 Agent 凭证

打开侧栏的 Agent 凭证，为当前成员和团队创建凭证。可选权限：只读、读取与上报、读取/上报/评论；有效期 1–365 天，默认 90 天。

完整凭证仅创建时返回。数据库仅存 SHA-256 哈希、前缀和管理元数据。页面只在当前内存会话内暂存凭证以复制 Prompt，不写入浏览器本地存储。退出、刷新或切换团队后清除。已保存的凭证可在凭证页面重新验证；首次复制配置 Prompt 授权 Agent 保存到用户目录，之后只读取明确指定的凭证文件。

```text
读一下 http://127.0.0.1:3000/agent/coflow-report/SKILL.md，服务地址是 http://127.0.0.1:3000，我的凭证是 <个人凭证>，按照要求上报一下当前项目的进展、交付链接和阻塞。
```

HTTP 使用 `Authorization: Bearer <个人凭证>`。日常 Prompt 优先读取 `COFLOW_TOKEN`，否则读取按站点／团队／成员隔离的 `~/.coflow/credentials/.../*.token`。保存路径与规则见 [Agent Skill](../skills/coflow-report/SKILL.md)。CLI、MCP 暂未正式支持。

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
npm run typecheck
npm run build
npm run version:check
npm run test:api
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

默认英文，支持简体中文；个人设置保存账号语言。字典、扩展规范与本地验证见[多语言说明](I18N.md)。用户写入的业务内容保持原文。
