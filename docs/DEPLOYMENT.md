# 部署与备份

本文部署自用／自托管真实团队服务。维护者购买的服务器用于自用，不作为开源仓库的公开演示后端。公开 GitHub Pages 仅运行虚拟数据网页，无 Go API、数据库或真实账号，详见 [Pages 说明](GITHUB_PAGES.md)。

当前版本 0.2.0。暂不需要购买服务器即可继续本地开发。以下为通用自托管配置；每个部署环境仍需独立验收，2C2G 的资源配置需按实际负载测试。

## 生产拓扑

同一台服务器运行 Caddy、Next.js 生产服务、Go API 和 PostgreSQL。只暴露 80/443，数据库与应用端口在 Compose 内网。Caddy 自动申请证书；需要真实域名解析到机器并放通 80/443。Cookie 启用 Secure，源站校验绑定同一个 HTTPS 域名。

Compose 的内存上限合计约 1.4GB，给系统留余量；数据库限制 20 连接，Node 堆限制 256MB，Go 软内存目标 192MiB，日志轮转。这里只运行协作平台，不在机器上构建镜像、运行 Agent／模型或处理视频。

## 构建与启动

优先使用[手动 GitHub 镜像构建](IMAGE_BUILDS.md)，从已验证版本生成通用镜像，再按摘要部署；构建不接入生产信息。以下保留本机构建与私有导入作为备用路径。

在本地或 CI（内存足够的环境）构建与目标服务器相同架构的镜像。Apple Silicon 本机通常是 arm64，若服务器为 x86_64，应在 Docker 开启相应跨架构构建支持，使用 `DOCKER_DEFAULT_PLATFORM=linux/amd64` 构建并验证后导出。

```sh
cp deploy/production.env.example .env.production
# 本地编辑域名、随机十六进制数据库密码与独立的初始化 token（各用 openssl rand -hex 32 生成）；不要把真实值提交到 Git。
docker compose --env-file .env.production -f compose.production.yaml build
docker save coflow-api:0.2.0 coflow-web:0.2.0 | gzip > /tmp/coflow-images.tar.gz
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

## 配置位置

| 配置 | 使用位置 | 说明 |
| --- | --- | --- |
| `COFLOW_DOMAIN` | 生产 Compose／Caddy | 仅域名，不带协议；Go origin 由模板组合为 HTTPS |
| `POSTGRES_PASSWORD` | 生产 Compose | 独立随机口令；已有数据卷改环境变量不会自动修改数据库内的密码 |
| `COFLOW_BOOTSTRAP_TOKEN` | Go | 仅用于首个管理员初始化；不是登录密码或 Agent 凭证 |
| `DATABASE_URL` | Go | 生产模板使用 Compose 内网，禁止在公网暴露数据库端口 |
| `COFLOW_WEB_ORIGIN` | Go | 浏览器站点的完整 origin，包含协议及非默认端口 |
| `COFLOW_SECURE_COOKIES` | Go | 生产 HTTPS 为 true，本机 HTTP 才设为 false |
| `API_BASE_URL` | Next.js 构建／开发 | 同源转发目标；生产 Dockerfile 默认 `http://api:8080`，构建后不能只改运行环境期待重写目标 |

Go 不自动读取 `.env`；生产 Compose 负责注入环境变量。不要打印 `docker compose config` 的完整结果到公开日志，其中可能包含数据库密码与初始化 token。部署不使用 `COFLOW_DEMO=true` 或 `NEXT_PUBLIC_COFLOW_PUBLIC_DEMO=true`。

需保留数据库、Caddy 证书与配置卷，配置文件保持私密权限。迁移是自动执行的 SQL，不需要手工重复执行或重新初始化团队。当前 0.2.0 共 10 个迁移，010 新增团队 Todo 文档、任务通知与协作引用；009 增加简报／评论软删除与评论通知关联，006–008 为个人语言、头像和展示时区；迁移记录表是 `schema_migrations`。

## 升级到 0.2.0

1. 在隔离环境验证目标源码，确认两个镜像版本和目标 CPU 架构一致。镜像只从已检查的源码构建，不将私密配置、数据库或本机调试产物混入构建包。
2. 在服务器备份数据库，并私下保存当前 Compose、环境配置、应用镜像标签和镜像 ID。保留旧镜像，确认备份可解码并在隔离数据库演练恢复；备份不上传到 Release。
3. 导入新镜像，仅更新 Compose 中 `api`、`web` 的镜像引用，保留现有数据库、证书卷、域名和私密配置。
4. 更新应用服务：

   ```sh
   docker compose --env-file .env.production -f compose.production.yaml up -d --no-build api web
   docker compose --env-file .env.production -f compose.production.yaml ps
   ```

5. 检查 API 迁移日志、健康检查版本和服务页面，再验证现有会话、团队隔离、Todo 看板与 Timeline 联动、个人偏好及 Skill 1.0.0 下载。已有团队不重新初始化。

健康接口不需要凭证：

```sh
curl --fail --silent --show-error https://coflow.example.com/api/v1/health
```

预期 `status=ok`、`mode=team`、`version=0.2.0`。同时确认页面可打开，未登录读取 `/api/v1/auth/me` 返回 401，`/agent/coflow/SKILL.md` 与 `/agent/openapi.yaml` 为当前规范内容。CDN 返回 HTML 或拦截页时，先区分边缘规则与应用错误，不关闭应用授权或 TLS 校验来绕过。

健康检查不能代替完整验收。写入验证使用独立合成团队；不要修改真实成员的密码、简报或凭证来测试。浏览器登录测试、真实 Agent 接入和异地容量分别记录通过范围。

## 回滚

0.2.0 的迁移 010 为加法变更，但旧应用不理解 Todo、新任务通知和协作转交引用；已有任务写入后不可据此宣称可直接安全回退。回退前限制访问并核对兼容性，不自动修改或丢弃任务数据。旧 Token 不自动扩权；统一 Skill 更新时保留既有项目关联与凭证。

- 应用启动或验收失败时停止继续变更，保留日志和当前备份。将应用镜像引用恢复到升级前记录，重新启动 `api`、`web` 并检查健康状态。
- 0.1.4 新增迁移是加法变更，但回退应用仍需核对目标旧版的兼容性；不自动删除列、回退迁移记录或恢复数据库。
- 必须恢复数据库时，先停止写入，在隔离目标完成恢复和验收，再由维护者选择切换。保留现库与故障前后备份，明确恢复点之后的数据会丢失。
- 不运行 `docker compose down -v` 处理升级问题；该操作会删除持久化卷。

## 私有运维记录

实例地址、服务器登录方式、部署目录、镜像摘要、备份与回滚位置、验收时间和结果放在私有运维清单；不写入公开文档、GitHub Wiki、Issues、Projects 或 Release。备份成功、可解码、恢复成功和恢复后业务验收是不同状态，记录时分别说明。
