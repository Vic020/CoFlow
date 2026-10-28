# GitHub Pages 演示团队

公开入口：https://vic020.github.io/CoFlow/

2026-10-29：0.2.3 已通过[手动部署 40736666663](https://github.com/Vic020/CoFlow/actions/runs/40736666663)，源码 `a79223d393284d46cbbbf548245e0a0dd244df86`。独立出站 HTTPS 核验首页、Todo、Docs 为 200，Skill 1.2.0 四文件和 OpenAPI 哈希与发布源码一致，`/api/v1/meta` 为 404，无真实后端。本机 Chrome 访问仍遇到连接关闭，因此不宣称本机浏览器验收通过；服务器与 Pages 的部署结果分别记录。

2026-10-28：0.2.2 演示已通过[独立手动部署](https://github.com/Vic020/CoFlow/actions/runs/40707090708)，源码 `c9ac58f98fe82b2f6355317869639daa0ea7f38e`。六条 Todo 示例的优先级边框、[Docs 阅读页](https://vic020.github.io/CoFlow/docs/)与 Skill 1.1.0 展示已核验；首页／Todo／Docs 为 200，Skill 入口、三份参考与 OpenAPI 哈希匹配规范，`/api/v1/meta` 为 404。此处仅提供合成数据，没有真实后端。

2026-10-27：0.2.0 演示已通过[独立手动构建与部署](https://github.com/Vic020/CoFlow/actions/runs/40493602382)，源码为 `5d863b0077a98b58c4caccf297b1f4692e687914`（与 v0.2.0 相同应用代码，另含发布验证文档）。[Todo 演示](https://vic020.github.io/CoFlow/todo/)包含六条示例、居中阅读与原位编辑入口，已验证与 Timeline 的双向跳转及统一 Skill 1.0.0 展示。此次部署不涉及私有团队服务或生产凭证。

2026-10-24：Pages [构建与部署已通过](https://github.com/Vic020/CoFlow/actions/runs/40090413102)。经维护者明确授权，已解除个人主页的旧自定义域名绑定，恢复默认 github.io 地址；浏览器已验证 HTTPS 演示团队加载成功。若曾访问过旧跳转，浏览器可能缓存重定向，可清除缓存或使用无痕窗口。DNS 记录未改动。

演示使用合成的 Flow Studio 团队、Alice／Bob／Carol／Dan、公开 Wiki 和仓库链接。0.2 源码展示 Timeline、筛选、日报、详情、手动上报与评论，以及六条覆盖四列的 Todo 联动示例；修改仅在当前标签页内存中有效，刷新重置。不是多人共享的真实服务，不提供账号、邀请、凭证或 Agent 上报接口。浏览器不向后端上传内容，也不将试填内容保存到 localStorage。

购买的服务器用于维护者自用的真实团队，与 GitHub 公开演示分开。不得把真实 API 地址、数据库、Cookie、token、用户内容或私有交付链接注入 Pages 构建。普通自托管模式仍然使用 Next.js + Go + PostgreSQL，权限在 Go 中处理。

## 构建与发布

```sh
npm ci
NEXT_PUBLIC_COFLOW_PUBLIC_DEMO=true NEXT_PUBLIC_COFLOW_BASE_PATH=/CoFlow npm run build --workspace @coflow/web -- --webpack
```

此 Next.js 版本在 export 模式下把自定义 `distDir` 作为导出目录，静态产物为 `apps/web/.next-pages`，只部署此目录，不部署 `.next` 或整个仓库。仓库 Settings → Pages → Source 选择 GitHub Actions；仅在维护者明确要求更新演示站后，手动运行 `.github/workflows/pages.yml`（Actions → Public demo · GitHub Pages → Run workflow）。主分支推送、打标签和发布 Release 都不会自动更新 Pages。构建步骤只读取仓库中的合成示例，不依赖任何账号或服务器 secret。

Fork 后需要按仓库名称修改 base path，使用自己的 Pages 地址。不要通过此开关模拟真实身份或生产权限。

## 验收

- `npm run test:demo`：示例边界、读取副本、内存修改、拒绝凭证／身份操作及外部请求。
- 静态导出后检查 `/CoFlow/`、资源、详情、筛选、日报和手机布局；直接打开子页面也应可用。
- 检查请求，确认没有 `/api`、localhost API 或自用服务器请求。
- 刷新后新建的试填简报和评论消失；他人的浏览器看不到这些修改。
- 发布结果以 GitHub Pages 工作流及线上页面实际状态为准。
