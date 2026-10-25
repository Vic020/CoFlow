# 部署与备份

本文部署自用／自托管真实团队服务。维护者购买的服务器用于自用，不作为开源仓库的公开演示后端。公开 GitHub Pages 仅运行虚拟数据网页，无 Go API、数据库或真实账号，详见 [Pages 说明](GITHUB_PAGES.md)。

当前版本 0.1.3。暂不需要购买服务器即可继续本地开发。以下为通用自托管配置；每个部署环境仍需独立验收，2C2G 的资源配置需按实际负载测试。

## 生产拓扑

同一台服务器运行 Caddy、Next.js 生产服务、Go API 和 PostgreSQL。只暴露 80/443，数据库与应用端口在 Compose 内网。Caddy 自动申请证书；需要真实域名解析到机器并放通 80/443。Cookie 启用 Secure，源站校验绑定同一个 HTTPS 域名。

Compose 的内存上限合计约 1.4GB，给系统留余量；数据库限制 20 连接，Node 堆限制 256MB，Go 软内存目标 192MiB，日志轮转。这里只运行协作平台，不在机器上构建镜像、运行 Agent／模型或处理视频。

## 构建与启动

在本地或 CI（内存足够的环境）构建与目标服务器相同架构的镜像。Apple Silicon 本机通常是 arm64，若服务器为 x86_64，应在 Docker 开启相应跨架构构建支持，使用 `DOCKER_DEFAULT_PLATFORM=linux/amd64` 构建并验证后导出。

```sh
cp deploy/production.env.example .env.production
# 本地编辑域名、随机十六进制数据库密码与独立的初始化 token（各用 openssl rand -hex 32 生成）；不要把真实值提交到 Git。
docker compose --env-file .env.production -f compose.production.yaml build
docker save coflow-api:0.1.3 coflow-web:0.1.3 | gzip > /tmp/coflow-images.tar.gz
```

将镜像包、compose.production.yaml、deploy/Caddyfile 和私密的 .env.production 通过 SSH 传至自己的服务器，导入后启动：

```sh
gunzip -c coflow-images.tar.gz | docker load
docker compose --env-file .env.production -f compose.production.yaml up -d --no-build
```

Go 自动运行新增迁移。首次初始化必须设置服务器环境变量 `COFLOW_BOOTSTRAP_TOKEN`（建议用 `openssl rand -hex 32` 单独生成），通过 `.env.production` 传入 Go，文件权限设为 600。未配置或少于 32 位时，初始化接口返回 503；缺失或错误 token 返回 403。现有团队的登录、邀请和使用不受影响。

维护者通过私密初始化链接 `https://coflow.example.com/?token=<token>` 打开站点。网页不提供 token 输入框：先请求 Go 校验接口，缺失、错误或已失效时不展示初始化表单；有效时进入团队名、称呼与账号设置。网页读取后立即移除地址栏参数，token 仅在当前组件内存保留，刷新后需重新打开完整私密链接。校验接口和创建接口均使用 `X-CoFlow-Setup-Token` 请求头，最终创建仍由 Go 独立校验。

初始化 URL 本身包含密钥，应只向维护者私下提供。HTTPS 页面使用 `Referrer-Policy: no-referrer`；若另行开启代理、CDN 或应用访问日志，应对 `token` 查询参数脱敏，避免把完整初始化 URL 写入日志。不得将真实链接写入 Git、公开工单或 `NEXT_PUBLIC_` 变量。

默认先本地开发与隔离测试。发布源码版本、更新 GitHub Pages 和更新自用服务器是独立动作，分别需要维护者明确指定；发版不自动部署。

数据库事务保证首次初始化仅成功一次，同一 token 无法再次创建管理员。完成后可清空服务器配置并重建 API 容器；后续新团队通过登录账号创建，成员通过邀请加入，不使用初始化 token。已有私有网络限制可作为额外保护。

## 备份

```sh
sh scripts/backup-database.sh
```

备份输出到 `backups/`（仅当前用户可读），成功后才从临时文件改名；脚本不自动删除历史备份。可由自己的系统定时任务每日执行，并将备份另存一份到机器外。备份含账号、简报及凭证哈希，应按私密数据保存。仅有同机备份不能抵御整机丢失。

## 恢复演练

先在同版本 PostgreSQL 的独立空数据库恢复，不覆盖正在使用的数据库：

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T db createdb -U coflow coflow_restore_check
cat backups/<备份文件>.dump | docker compose --env-file .env.production -f compose.production.yaml exec -T db pg_restore -U coflow -d coflow_restore_check --no-owner --no-acl --exit-on-error
```

检查用户、团队、简报、评论、分类、协作、通知及迁移记录数量，再通过指向恢复库的隔离 API 验证登录、上报与团队隔离。真实故障切换前停止写入、保留旧库及当前备份，再由维护者明确选择恢复目标。

## 上线后验收

验证 HTTPS、Secure Cookie、邀请加入、个人凭证上报、跨团队隔离、手机评论与协作进展。让北京、上海、深圳成员在实际办公网络测试页面响应和晚高峰表现，观察 `docker stats`、内存、重启次数和磁盘增长；资源不足时再优化或升级。当前不宣称已完成公网性能或恢复后完整登录流程验收。
