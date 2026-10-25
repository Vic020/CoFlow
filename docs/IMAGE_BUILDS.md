# GitHub 镜像构建

正式 API／Web 镜像可以由 GitHub 托管的 Linux 构建机生成。本地继续开发调试与相称验证，不再需要为了发布镜像执行本机跨架构构建和整包上传。

## 手动运行

在仓库 Actions 中选择 **Build release images · GHCR → Run workflow**：

1. **Use workflow from** 选择 `main`。
2. 输入已存在的稳定版本标签，例如 `v0.1.4`，然后运行。
3. 等待 `verify` 和 `publish` 成功，查看 publish 作业 Summary 中 API／Web 的完整摘要引用。

只有主分支历史上的标签、标签与 VERSION 一致、且对应提交已有成功的 main push CI 时才允许构建。未完成／失败的 CI、PR 检查或其他提交的成功结果不能替代。工作流代码从手动选择的 main 读取，实际镜像源码固定为被验证标签的提交。

工作流只支持 `workflow_dispatch`，不因普通推送、标签或 Release 自动触发；也不创建版本、标签、Release、Pages 或服务器部署。不要改成由外部 PR 或 `pull_request_target` 触发发布。

## 镜像与可见性

镜像名称为 `ghcr.io/<owner>/<repository>-api` 和 `ghcr.io/<owner>/<repository>-web`，全部小写。每次构建使用 `<版本>-<提交前12位>-<run_id>.<attempt>`，重跑产生新标签；不覆盖既有版本别名，也不推送 `latest`。部署使用 Summary 中的 `@sha256:…` 摘要，而不是可被改写的标签。

通用镜像只含公开程序，适合公开发布。**GHCR 首次创建的包可能为私有，构建成功不等于已经可以匿名拉取。** 维护者需在账号 Packages 中分别核对 API、Web 包的可见性；确认只有公开程序后设为 Public，并用未登录的客户端验证拉取。不要将账号的其他包或仓库权限一起放开。

再次构建同一源码也可能因基础镜像或工具链更新而得到不同摘要；保留源码提交、构建 run 和两个镜像摘要，不宣称位级可复现。

## 信息边界

| GitHub 构建使用 | 只保留在私有服务器 |
| --- | --- |
| 已发布源码、锁文件、Dockerfile、公开依赖缓存 | 数据库、真实成员与团队内容、备份 |
| 内网通用地址 `http://api:8080` | 实例域名、SSH 私钥和私有运维清单 |
| 内置、限时的 GITHUB_TOKEN，用于当前仓库的镜像发布 | 数据库密码、Agent 凭证与初始化 token |

不需要添加生产 Secrets，不使用服务器 SSH，不连接真实 API 或数据库。测试数据库仍由原 CI 使用合成身份单独创建。不要把自用服务器注册为公共仓库的 self-hosted runner。

校验作业仅有 contents/actions 读取权限，发布作业仅有 contents 读取和 packages 写入权限。官方 Actions 固定到完整提交 SHA；升级依赖时核对官方来源。checkout 不保留 Git 凭证；Docker 构建只接收干净源码，`.dockerignore` 排除 Git、本机目录、私密配置、备份和 QA 产物。额外的路径检查会拒绝意外纳入标签的本机文件，但不能替代人工隐私审查或检测任意正文里的密钥。

构建日志、缓存、摘要和产物按可能公开处理；不通过 Docker ARG／ENV 或 `NEXT_PUBLIC_` 传递秘密。不要依赖日志遮罩修复错误的秘密传入。发布令牌只用于 Registry 登录，不进入镜像层。此隔离减少生产数据外泄入口，但不代表消除了依赖、工作流或部署环节的全部风险。

## 手动部署

镜像构建不改变现有实例。维护者明确要求部署后：

1. 在服务器备份并核验数据库，保存当前私密 Compose、应用摘要和回滚依据。
2. 将私有 Compose 中 `api.image`、`web.image` 改为本次 Summary 的摘要引用，保留私密环境配置、数据库和证书卷。
3. 使用现有环境文件执行 `docker compose … pull api web`，再执行 `docker compose … up -d --no-build --no-deps api web`。`…` 表示该实例记录的 `--env-file` 和 `-f` 参数，不是可直接复制的命令。
4. 核对运行镜像、HTTPS、health 版本、迁移、既有会话及协议下载；将部署结果记入私有运维记录。

公开镜像无需服务器持有 GitHub 凭证。先实测服务器到 GHCR 的拉取速度；受网络影响失败时，可在另一台可信机器拉取、核验摘要后通过私有 SSH 导入镜像，无需重新本机构建。不要更换未知镜像源、关闭 TLS 校验或将生产配置交给构建流程。

详细备份与回滚规则见[部署指南](DEPLOYMENT.md)。0.1.4 的旧版本回滚还需考虑软删除兼容性。

## 本地检查与故障

```sh
npm run test:images
npm run docs:check
npm run version:check
```

测试覆盖标签输入、版本／主分支边界、私有文件拒绝、唯一镜像标签与严格 CI 匹配。实际 GitHub 构建、GHCR 可见性和匿名拉取需分别验收；本地通过不能代替远端成功。

- **CI 校验失败**：先查看源提交的 CI，不能跳过检查或改用其他提交的结果。
- **GHCR 权限失败**：核对仓库允许 Actions 发布包、包与仓库关联及当前工作流权限；不要加入生产凭证解决。
- **只成功发布一个镜像**：本次交付未完成，不部署混合版本。修复后重跑，使用新一次成功构建的两个摘要。
- **构建成功但拉取 401／403**：先核对两个包是否已公开；不要将个人 GitHub 令牌复制进公开配置。
