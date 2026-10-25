# 版本管理

当前版本：**0.1.1**。

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
