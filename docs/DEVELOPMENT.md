# CoFlow

异地团队的 Agent 进展与交付协作空间。Timeline 是默认入口，支持按项目、领域、成员、Agent 和日期筛选，按日报聚合，围绕简报进行讨论。

**当前版本：本地开发演示。** 已建立真实 Go API 和交互式 Next.js 前端，身份、团队与项目为演示数据；还未实现正式登录、邀请、个人 Token。后端仅允许显式 `COFLOW_DEMO=true` 启动，默认监听回环地址。不要作为公网团队服务部署。

## 快速启动

环境：Node.js 24、Go 1.25；PostgreSQL 可选。依赖版本由 package-lock.json 和 go.sum 锁定。

```sh
npm ci
```

终端一（后端）：

```sh
npm run dev:api
```

终端二（前端）：

```sh
npm run dev
```

打开 http://127.0.0.1:3000 。页面请求经 Next.js 转发到本机 Go API，默认无需额外配置。使用 `localhost` 或修改端口时，将后端 `COFLOW_WEB_ORIGIN` 设置成页面的实际 Origin。

演示上报和评论保存在 `apps/api/.data/demo.json`，该目录不纳入版本控制。所有写入使用演示成员陈一；其余成员是浏览与协作场景示例。切换筛选与刷新不会丢失上报。

## Agent / CLI

```sh
node apps/cli/coflow.mjs list
node apps/cli/coflow.mjs report --file docs/example-report.json
```

同一 source_id 更新同一简报，避免定时任务重试重复上报。更改目标地址可设置 `COFLOW_URL`，演示接口仅应用于本机开发。Skill：`skills/coflow-report/SKILL.md`；协议：`docs/openapi.yaml`。

## Skill 下载与一句话上报

打开页面左侧的“Agent 接入”，可下载 Skill、查看 API 协议并复制一句话 Prompt。链接自动使用当前站点地址。

- 本机 Skill：<http://127.0.0.1:3000/agent/coflow-report/SKILL.md>
- 本机协议：<http://127.0.0.1:3000/agent/openapi.yaml>

```text
读一下 http://127.0.0.1:3000/agent/coflow-report/SKILL.md，服务地址是 http://127.0.0.1:3000，按照要求上报一下当前项目的进展、交付链接和阻塞。目前是本地演示模式，无需凭证。
```

这是本机地址，其他电脑或云端 Agent 不能直接使用它访问本机服务。正式部署后，页面将生成对应站点的 URL。当前演示不接受个人凭证，不能声称凭证已验证；正式登录与 Token 功能完成后再提供带凭证的 Prompt。

Skill 可以脱离项目源码独立阅读，通过 HTTP 直接上报，不要求安装 CLI。`scripts/sync-agent-assets.mjs` 在前端 dev/build 前从 `skills/` 与 `docs/` 同步下载文件；修改源文件后运行该脚本即可更新开发中的下载内容。

## PostgreSQL 开发模式

需要启动 Docker 服务：

```sh
docker compose up -d db
```

Compose 首次创建数据库卷时自动执行初始 schema。然后从 apps/api 启动后端：

```sh
COFLOW_DEMO=true DATABASE_URL=postgres://coflow:coflow_dev@127.0.0.1:5432/coflow?sslmode=disable go run ./cmd/server
```

设置 DATABASE_URL 时使用 PostgreSQL + pgx + sqlc；未设置时使用本地 JSON 存储。两种模式共享 API。已有数据库不会自动执行后续迁移；第二阶段将补齐版本化迁移执行器。不要删除已有数据库卷来应用迁移。

生成查询代码（在 apps/api）：

```sh
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate
```

生成的 `internal/db` 代码纳入源码。修改 SQL 后重新生成。

## 验证

```sh
npm run typecheck
npm run build
npm run test:api
```

后端关键测试覆盖 source_id 幂等、客户端无法伪造身份、跨团队读取边界、评论持久化、作者修改权限、链接验证、跨站写入保护。

## 结构

- `apps/web`：Next.js 响应式前端，shadcn 风格组件源代码
- `apps/api`：Go Gin API、两种存储实现、SQL schema 和生成查询
- `apps/cli`：不依赖额外包的 Node CLI
- `skills/coflow-report`：Agent 上报 Skill
- `docs/PRODUCT.md`：已确认的产品约定、阶段与待办
- `docs/design`：已确认的参考效果图与实际截图

团队正式版剩余工作见 `docs/PRODUCT.md`。
