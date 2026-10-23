# 部署与备份

当前版本 0.1.0。暂不需要购买服务器即可继续本地开发。以下文件是可审查的部署准备，尚未在公网服务器上线；2C2G 的资源配置仍需上线后实测。

## 生产拓扑

同一台服务器运行 Caddy、Next.js 生产服务、Go API 和 PostgreSQL。只暴露 80/443，数据库与应用端口在 Compose 内网。Caddy 自动申请证书；需要真实域名解析到机器并放通 80/443。Cookie 启用 Secure，源站校验绑定同一个 HTTPS 域名。

Compose 的内存上限合计约 1.4GB，给系统留余量；数据库限制 20 连接，Node 堆限制 256MB，Go 软内存目标 192MiB，日志轮转。这里只运行协作平台，不在机器上构建镜像、运行 Agent／模型或处理视频。

## 构建与启动

在本地或 CI（内存足够的环境）构建与目标服务器相同架构的镜像。Apple Silicon 本机通常是 arm64，若服务器为 x86_64，应在 Docker 开启相应跨架构构建支持，使用 `DOCKER_DEFAULT_PLATFORM=linux/amd64` 构建并验证后导出。

```sh
cp deploy/production.env.example .env.production
# 本地编辑域名与随机十六进制数据库密码；不要把真实值提交到 Git。
docker compose --env-file .env.production -f compose.production.yaml build
docker save coflow-api:0.1.0 coflow-web:0.1.0 | gzip > /tmp/coflow-images.tar.gz
```

将镜像包、compose.production.yaml、deploy/Caddyfile 和私密的 .env.production 通过 SSH 传至自己的服务器，导入后启动：

```sh
gunzip -c coflow-images.tar.gz | docker load
docker compose --env-file .env.production -f compose.production.yaml up -d --no-build
```

Go 自动运行新增迁移。第一次通过 HTTPS 打开站点时，由维护者创建自己的管理员账号，再发送邀请。空实例应先限制入口仅维护者访问，完成初始化后再向团队开放，避免他人抢先创建首个管理员。

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
