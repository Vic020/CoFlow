# GitHub Pages 演示团队

公开入口：https://vic020.github.io/CoFlow/

2026-10-24：Pages [构建与部署已通过](https://github.com/Vic020/CoFlow/actions/runs/40090413102)，但此入口继承账号个人主页的 `vicyu.com` 自定义域名并重定向到 `vicyu.com/CoFlow/`，目前该地址返回 404。公开访问验收尚未通过，需维护者决定独立子域名或个人主页域名绑定方案；不自动修改其他仓库或 DNS。

演示使用合成的 Flow Studio 团队、Alice／Bob／Carol／Dan、公开 Wiki 和仓库链接。展示 Timeline、筛选、日报、详情、手动上报与评论；修改仅在当前标签页内存中有效，刷新重置。不是多人共享的真实服务，不提供账号、邀请、凭证或 Agent 上报接口。浏览器不向后端上传内容，也不将试填内容保存到 localStorage。

购买的服务器用于维护者自用的真实团队，与 GitHub 公开演示分开。不得把真实 API 地址、数据库、Cookie、token、用户内容或私有交付链接注入 Pages 构建。普通自托管模式仍然使用 Next.js + Go + PostgreSQL，权限在 Go 中处理。

## 构建与发布

```sh
npm ci
NEXT_PUBLIC_COFLOW_PUBLIC_DEMO=true NEXT_PUBLIC_COFLOW_BASE_PATH=/CoFlow npm run build --workspace @coflow/web -- --webpack
```

此 Next.js 版本在 export 模式下把自定义 `distDir` 作为导出目录，静态产物为 `apps/web/.next-pages`，只部署此目录，不部署 `.next` 或整个仓库。仓库 Settings → Pages → Source 选择 GitHub Actions；主分支推送触发 `.github/workflows/pages.yml`，也可手动运行。构建步骤只读取仓库中的合成示例，不依赖任何账号或服务器 secret。

Fork 后需要按仓库名称修改 base path，使用自己的 Pages 地址。不要通过此开关模拟真实身份或生产权限。

## 验收

- `npm run test:demo`：示例边界、读取副本、内存修改、拒绝凭证／身份操作及外部请求。
- 静态导出后检查 `/CoFlow/`、资源、详情、筛选、日报和手机布局；直接打开子页面也应可用。
- 检查请求，确认没有 `/api`、localhost API 或自用服务器请求。
- 刷新后新建的试填简报和评论消失；他人的浏览器看不到这些修改。
- 发布结果以 GitHub Pages 工作流及线上页面实际状态为准。
