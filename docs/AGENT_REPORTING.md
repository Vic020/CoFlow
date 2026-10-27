# Agent 接入

记录版本：0.2.0；统一 CoFlow Skill 版本 1.0.0。支持 Skill 与 HTTP API；CLI、MCP 尚未正式提供。

## 安装一次，持续复用

1. 在当前团队的「Agent 凭证」创建个人凭证，名称可使用设备或工具名，按需选择权限和有效期。
2. 将仅展示一次的「安装提示词」交给当前项目的 Agent。关闭弹窗后无法重新查看完整凭证；遗失时创建新凭证并撤销不用的旧凭证。
3. Agent 先检查服务、目标团队和成员，再安装用户级 Skill、保存凭证并关联当前项目。安装本身不发布简报。
4. 以后在同一项目中说 **「上报 CoFlow」**。不能自动发现 Skill 的工具，使用 Timeline 的「复制上报指令」或「上报 → Agent」中的完整指令。

网页无法替 Agent 安装本机文件，也无法根据凭证列表证明安装成功。每个 Agent 都需要能够发现 Skill；新电脑需重新安装，建议单独签发凭证，方便逐台撤销。

## 本机保存位置

| 内容 | 路径与用途 |
| --- | --- |
| 凭证 | `~/.coflow/credentials/<encoded-origin>/<encoded-team-id>/<encoded-member-id>.token`，仅保存 token |
| 项目关联 | `~/.coflow/projects/<project-key>/binding.json`，保存服务、目标身份、凭证／Skill 路径和工作单元标识 |
| Skill | 优先使用工具支持的用户级 Skill 目录；无法安装时按 Skill 提供的回退流程处理 |

`project-key` 是项目规范绝对路径的 SHA-256。凭证路径各部分采用 Skill 规定的编码规则，不能直接拼接任意输入。POSIX 目录 `0700`、文件 `0600`；不跟随符号链接，不覆盖不同凭证而不确认。项目关联不存密钥、简报正文或聊天记录，不写入项目或 Git。

读取顺序为 `COFLOW_TOKEN`，否则读取明确指定的凭证文件。环境变量已设置但失效或身份不匹配时停止，不静默换用另一身份，也不扫描目录或旧聊天寻找密钥。完整路径、保存和项目迁移规则以[规范 Skill](../skills/coflow/SKILL.md) 为准。

## 上报内容与持续更新

- 记录实际完成的结果、交付链接、当前阻塞及下一步；未完成的验证应明确标注。
- 已删除的 source_id 返回 409；停止重试并让用户到网页回收站确认是否恢复，不能改用新标识绕过删除。Agent 不可删除、恢复或查看回收站。
- 同一团队、成员和工作沿用 `source_id`，持续更新原简报；新工作创建新标识。超时后先查询原记录，不能换标识盲目重发。
- 项目、领域使用已有 ID 或名称／别名。未知名称进入待整理，人工整理后的归属受保护。
- Agent／Model 表示来源；成员与团队由服务端凭证确定，不接受正文中的身份声明。
- 评论与协作请求是反馈，不自动授权 Agent 执行任务。

[示例 JSON](example-report.json) 只含合成内容。HTTP 字段、状态、链接限制和接口权限见 [OpenAPI](openapi.yaml)。

## 权限与接口

请求使用 `Authorization: Bearer <个人凭证>`，只向已确认的同一服务发送。先无凭证检查 `/api/v1/health`，确认团队服务，再读取 `/api/v1/meta` 核对团队和当前成员；上报能力取决于凭证签发的权限，`meta.role` 不代表 Agent 获得管理员能力；不向重定向目标或其他站点转发凭证。

| 能力 | 权限／边界 |
| --- | --- |
| 读取元数据、简报、分类、历史和协作 | `reports:read` |
| 创建、更新本人的简报 | `reports:write`，沿用来源标识；网页编辑接口不能用 Agent 凭证调用 |
| 评论和维护有权操作的协作 | `comments:write`，仍校验团队和实际参与权限 |
| 账号、邀请、凭证、个人偏好与分类整理 | 网页会话；Agent 凭证无管理权限 |

凭证绑定签发时的团队与成员，网页切换团队不会改变旧凭证归属。删除本机文件不等于撤销；到凭证页撤销后才能停止其服务端访问。

## 可选每日检查

可建议由 Agent 的调度器每天检查变化。创建前确认用户同意、执行时间和时区，并复用已有任务。任务只引用 Skill、本机路径和目标身份，不嵌入密钥。

有实质变化才上报，包括未提交的成果、交付链接、状态或阻塞变化；无变化不写入、不通知。安装不会自动创建任务，CoFlow 服务端也不代为调度。

## 失败时

先保留工作内容，再按 Skill 的失败表处理，向用户说明一个明确的下一步。凭证缺失／失效需重新安装；身份不一致立即停止；网络超时先核实服务与原简报；成功写入但本机检查点失败不能再次新建简报。

详细排障见[排障指南](TROUBLESHOOTING.md)。服务返回成功后才能报告上报完成，不能把本机保存、安装成功或 HTTP 200 的 HTML 页面当作上报成功。

## Todo 接入（0.2）

统一 [CoFlow Skill](../skills/coflow/SKILL.md) 按需读取 [Todo 操作说明](../skills/coflow/references/todos.md)，复用上报的私有凭证和项目关联，下载路径为 `/agent/coflow/SKILL.md`。先校验团队／成员，再读取 `/todo-board` 和 `/todos`，使用稳定 ID 操作；编辑提供 expected_revision，移动另提供 board_revision，每次写入提供 operation_id。

`todos:read` 可读取必要元数据且不附赠简报权限；`todos:write` 需搭配 todos:read，按创建人／负责人规则维护。评论另需 comments:write，共享列仅网页管理员可管理。旧凭证不自动扩权。

上报可带 todo_ids；联合移动再带 todo_moves 和 operation_id，并具备 reports:write、todos:read/write 和对象权限。整个事务成功才宣称上报及移动成功，重试使用完全相同的载荷与操作标识；修订冲突重新读取和处理。每次独立进展用新简报 source_id，任务与简报标识独立。

## 统一 Skill 入口

全 CoFlow 只安装一个 coflow Skill，规范入口为 skills/coflow/SKILL.md，通过 references/installation.md、reporting.md 和 todos.md 按需加载安装、Timeline 与 Todo 规则。安装时保留目录结构和参考文件；日常上报和管理任务复用同一份私有凭证与项目关联，权限仍按模块分别授予。

旧 /agent/coflow-report/SKILL.md 和 /agent/coflow-todo/SKILL.md 是指向统一入口的兼容说明，不再作为独立 Skill 安装。更新已有安装时保留工作映射、凭证及自定义内容，不因改名重复创建凭证。

Todo 可让 Agent 在授权内创建、分配给团队成员、读取、评论和更新任务进度，关联简报及交付；任务仍归属于成员，Agent 是操作来源。CoFlow 不自动启动或调度其他 Agent，任务分配、评论或移动不等于执行实际工作的授权。
