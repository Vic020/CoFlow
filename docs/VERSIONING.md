# 版本管理

当前版本：**0.2.1**。

## 规则

- 只有维护者明确要求更新版本时，才修改版本号。
- 日常开发、修复、构建、提交与 CI 不自动递增版本号，也不自动打 Git 标签。
- 默认先本地开发和隔离测试；发版与部署分别由维护者明确要求。发布 Release 不代表更新自用服务器或 GitHub Pages，部署目标和时机需另行指定。
- `VERSION` 是当前版本的依据。其他记录需与其一致。
- 新的未发布变化写入 `CHANGELOG.md` 的 `Unreleased`；明确归档版本时再整理版本条目。
- 已有版本的历史记录保留，不因新版本而覆写。

## 需要保持一致的位置

| 位置                                   | 用途                          |
| -------------------------------------- | ----------------------------- |
| `VERSION`                              | 当前项目版本                  |
| 根目录 `package.json`                  | 项目版本                      |
| `apps/web/package.json`                | Web 版本                      |
| `apps/cli/package.json`                | CLI 版本，`--version` 的来源  |
| `package-lock.json`                    | 根项目与 workspace 的锁定记录 |
| `apps/api/internal/version/version.go` | Go API 版本，健康检查响应使用 |
| `docs/openapi.yaml`                    | API 协议版本                  |
| `CHANGELOG.md`                         | 对应版本的变化记录            |
| `README.md`、`README.zh-CN.md`          | 英文／中文展示的版本号与徽标        |

## 检查

```sh
npm run version:check
```

该命令只检查版本记录，不写文件、不递增版本、不创建提交或标签。英文／中文 README 的展示文字和徽标由维护者在明确更新版本时一并调整。

## 发布清单

1. 先完成本地检查与隔离测试，审查拟提交内容，排除真实团队资料和私有运维文件。
2. 维护者明确要求版本变更后，同步上述记录、生产 Compose 镜像标签及适用版本文档，将 Unreleased 整理为对应版本；在 `docs/releases/` 编写发布说明。
3. 再次执行版本检查，提交并推送经过审查的源码。只有明确要求发布时，才为目标提交创建标签和 GitHub Release；不要把本机未提交状态当成发布源码。
4. Release 只附公开源码或经检查的公开产物；不附私密镜像配置、数据库、凭证、会话或本机 QA 输出。
5. 需要更新运行实例时，单独按[部署指南](DEPLOYMENT.md)备份、升级和验收；需要更新公开演示时，单独手动运行 [Pages 工作流](GITHUB_PAGES.md)。

0.2.1 的实际变化与验证范围见[发布说明](releases/v0.2.1.md)。历史发布说明保留当时的版本与事实，不随当前版本批量替换。

README、Wiki、Projects 与发布说明的同步职责、页面映射和交付状态见[文档与 GitHub 维护流程](MAINTENANCE.md)。

镜像可以按[镜像构建流程](IMAGE_BUILDS.md)从现有标签手动构建；这不改变 VERSION，也不自动创建 Release 或部署。
