# CoFlow CLI 实施计划

日常使用请看 [CoFlow Skill 的 CLI 指南](../skills/coflow/references/cli.md) 和 [完整命令表](../skills/coflow/references/cli-commands.md)。修改 `apps/cli/commands.json` 后运行 `node scripts/sync-cli-reference.mjs` 并一并提交生成文件。文档检查和 Web 构建都会核对命令表。已安装的 CLI 用 `coflow help --json` 查询该版本实际支持的命令。

建议作为 0.7 的主线。CLI 是 CoFlow 的完整产品入口，人可以在终端操作，Agent 可以按同一套命令和协议代办。验收目标是：网页上用户有权完成的产品操作，都有对应的 CLI 命令，或者可以从终端发起并由本人确认。CLI 使用现有 Go 业务服务、对象权限和审计记录。

当前 `apps/cli` 提供 Rust 1.83+ 源码和独立的 `coflow` 可执行文件，支持 OAuth 2.0 设备授权和团队绑定的 Agent Token。已接通身份核验、工作区、Todo、Timeline、Calendar、Context、Data 和交接查询。项目与领域管理、账号管理、助手和回收站可从 CLI 生成请求，再由登录用户在网页执行。

## 身份与授权

| 使用方式 | 登录与权限 |
| --- | --- |
| 用户本人运行 | `coflow auth login --server <url>` 从终端发起浏览器确认。服务端签发可撤销、绑定实例和用户的 CLI 授权。进入哪个空间，由配置和显式的 `--space` 决定，每次请求检查当前成员资格与角色。 |
| Agent 代办 | 用户通过 `coflow auth grant` 发起授权，确认空间、允许的操作、有效期，以及适用的项目或 Todo 限定。Agent 只使用这一份授权。审计记录实际用户、CLI 客户端、授权标识、动作和对象。 |
| 现有 Agent Token | 继续兼容当前命令和原有 scopes；迁移到 CLI 授权由用户选择。 |

Go 对每次操作取用户现有权限、授权范围和对象规则的交集。CLI 凭证使用系统凭证库。无桌面环境的 Agent 从受控凭证存储读取，普通配置只存实例、空间和授权标识。配对码短时、一次性并绑定发起端。注销、撤销、成员移除和角色变化会影响后续请求。命令可用 `coflow whoami --json` 返回当前用户、实例、空间、授权范围和过期时间。

删除或合并分类、批量改期、角色与权限变更等命令显示影响范围。高影响操作按服务端规则要求本人确认，即使在非交互模式也如此。当前确认结果显示在网页。Agent 可在有权限时重新查询被变更的记录。登录、授权和密钥轮换由本人完成，明文密钥只在签发流程按现有规则交付。

### 已实现的浏览器登录

用 `COFLOW_URL` 指向 CoFlow 实例，例如本地团队模式的 `http://127.0.0.1:3103`。执行 `coflow auth login`。终端给出网页地址和配对码，在网页的 Agent 凭证页输入配对码，核对账号、空间、权限和有效期，再点击允许。默认只读，七天后失效。需要写入时用 `--scope "reports:read reports:write"` 明确提出。随后运行 `auth status` 或 `whoami` 核对。退出用 `auth logout`，也可通过网页凭证列表撤销。

本阶段使用 [OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628.html)。配对码十分钟失效，设备凭证只能兑换一次。macOS 默认把新凭证存入系统钥匙串。无桌面环境使用权限隔离文件，配置在 `~/.config/coflow/cli`。已有 `COFLOW_TOKEN` 优先用于业务命令。

- `auth login --space TEAM_ID` 保存指定空间的登录，`space list` 查看已保存的空间，`space use --space TEAM_ID` 设默认空间。业务命令支持显式 `--space`。
- `workspace bind --server URL --space TEAM_ID` 把当前目录绑定到实例、用户和空间，`workspace unbind` 清除绑定。显式服务器及环境变量优先。
- `auth grant --space TEAM_ID --todo TODO_ID` 或 `--project PROJECT_ID` 请求受限授权。默认一天、只读。明确申请任务写权限后可修改允许的字段、排期或提交验收，仍受原有对象权限约束。受限授权当前覆盖 Todo，任务历史记录对应授权 ID。

## 命令覆盖

| 模块 | 计划命令与范围 |
| --- | --- |
| 身份与空间 | `auth login/logout/status/grant/revoke`、`whoami`、`space list/use`，以及个人设置、成员、邀请、角色和授权管理 |
| Todo | `todo list/show/create/edit/move/comment`，覆盖分配、依赖、提交验收、退回、完成、重开与归档。审批沿用指定验收人规则。 |
| Timeline 与协作 | `report list/show/upsert/comment`，以及分类、关联 Todo、协作请求、转任务、历史和回收站 |
| Calendar | `calendar list/show/create/edit/archive`，以及任务排期、节点、批量变更和冲突提示 |
| Context | `context search/show/tree/create/edit`，以及来源、复核、归档与恢复 |
| Data 和接续 | `data summary/detail` 与 `handoff read/changes`，复用统计口径、来源权限和增量游标 |
| 工作区与 AI | 项目与领域管理、收件箱、AI 配置、会话、模板、定时任务及现有 MCP 连接管理。实装顺序按路由权限和用户使用频率决定。 |

以 CLI 命令与现有网页/API 的覆盖清单跟踪每项能力。需要新接口的命令先更新 OpenAPI，并在 Go 中明确支持的身份、权限和审计。已有网页登录限制的路由逐项审查，业务层共用原逻辑。平台预览、图谱和看板的图形交互在终端以可查询的数据和对应业务动作呈现。

## 网页确认

在命令末尾加 `--prepare` 生成请求。例如 `coflow catalog merge --kind project --id OLD --file merge.json --prepare`。把输出粘贴到 **Agent 凭证 → 审查 CLI 请求**。核对空间、账号、目标和参数后点击执行，结果在网页显示。终端只生成草案。浏览器使用现有会话执行，Go 在处理请求时再次核对身份。含凭证的配置草案应留在本地，直接在网页查看执行结果。

批量改期用 `coflow calendar reschedule --file changes.json --prepare`。一次最多 25 张任务，文件包含唯一 `operation_id` 与 `changes` 数组。每项带上任务 ID、当前修订号和新排期，用 `null` 清除排期。任何一项失败都会回滚整批，原请求可用同一操作 ID 重试。

在仓库根目录运行 `cargo install --path apps/cli --locked --root "$HOME/.coflow"` 安装。构建需要 Rust，运行只需要安装后的 `coflow` 二进制。用 `coflow help --json` 获取此版本的完整命令和确认要求。

## 执行约定

- 统一提供 `--json`、`--help` 和 `--non-interactive`。JSON 标准输出只有结果，诊断走标准错误，退出码区分输入错误、身份失效、权限不足、修订冲突、等待确认和网络故障。
- 支持用文件或标准输入批量传入文档与结构化内容。所有写入都按服务端规则传递修订和操作 ID。若收到 409，输出当前修订和恢复方法，接手人核对变更后再提交。
- 查询可分页，列表和详情返回稳定 ID 与对象链接。增量游标按用户、实例、空间、项目和权限分别保存。工作目录绑定可指定默认目标，进入新目录或切换空间可用 `whoami` 复核。
- CLI 使用 Cargo 构建，预编译附件按 [CLI 打包与发布](CLI_RELEASE.md) 单独准备。Skill 提供命令示例，Agent 可以直接使用 `--help` 和 JSON 输出接手。

## 让人和 Agent 知道下一步

每个命令的帮助、错误和更新提示都要说明「发生了什么」「为什么」「接下来怎么做」。面向用户的文字用短句，先写动作再解释术语。比如把 `source_id` 解释成「同一份进展的编号，改这份进展时继续用它」。

| 场景 | 提示设计 |
| --- | --- |
| 初次使用 | `coflow help` 给出一条从确认身份、查任务到核对结果的推荐流程。根帮助按目的分组，例如「接手一张任务」「提交今天的进展」。 |
| 查询某条命令 | `coflow help todo change` 和 `coflow todo change --help` 显示该版本真正支持的参数、最小示例、所需权限、会修改什么、如何查回结果，以及常见错误。按服务端能力明确哪些命令在当前空间可用。 |
| Agent 自行发现 | CLI 提供 `coflow help --json`。由同一命令定义生成参数、示例、只读或写入类型、权限要求、确认条件和依赖能力。Agent 先确认身份和空间，再读取命令要求。 |
| 用错或执行失败 | 未知命令给出相近候选与帮助入口，漏填参数给出可复制的用法。缺权限时说明需要哪项授权。旧修订冲突时提示「这张任务刚被改过，先打开最新版本，再决定要不要重试」。写入结果不明时先回读或按操作约定复用原请求。 |
| 有新版本 | `coflow update check` 从 CoFlow 的 GitHub Releases 检查稳定版本，并提供官方发布说明和升级提示。没有版本兼容表时标明服务器兼容性未知。只对已核实的版本发提示。CLI 与服务器不兼容时说明少了哪项能力，并指向可用命令或需要升级的一端。更新提示走标准错误，用户自行决定是否升级。 |

`--json` 模式的错误在标准错误中包含稳定的 `code`、可读的 `message` 与可选的 `next_steps`，同时用退出码标明失败。成功 JSON 保持原有输出契约。恢复建议由已知错误和命令定义生成，服务端或对象中的文字仅作为参考信息。Agent 可以自行完成只读核对与参数修正，身份授权、冲突取舍和高影响确认仍走相应流程。

## 当前可用的接手流程

在仓库根目录运行下列命令。团队模式使用 `COFLOW_URL` 和从受控环境注入的 `COFLOW_TOKEN`。先用 `whoami` 取到团队和用户 ID，再按需设置 `COFLOW_EXPECT_TEAM` 和 `COFLOW_EXPECT_USER`。设定后，每次业务请求前都会核对身份，核对失败就停止。

```sh
coflow whoami --json
coflow workspace show
coflow todo list --project PROJECT_ID
coflow handoff read --todo TODO_ID
coflow todo show --id TODO_ID
coflow help report upsert
coflow report upsert --file report.json
coflow data detail --metric reports_created --from 2026-11-01 --to 2026-11-08
```

- `todo change`、`calendar change` 和 `context change` 读取 JSON 文件。先读原记录并填写当前修订号。每次新动作使用新的操作 ID，原样重试才复用该 ID。移动 Todo 还要带上 `todo board` 返回的看板修订号。
- 列表按对应命令帮助提供的游标或偏移量翻页。Calendar 和 Data 的结束日期不计入范围。可传 `--timezone Asia/Shanghai` 按该时区计算。
- `handoff changes` 首次调用建立游标，处理完一页再用 `--checkpoint NAME --save-cursor NEXT_CURSOR` 保存。同一项目下用 `--checkpoint NAME` 继续读取。交接和增量查询需要团队服务器支持相应能力。
- Agent 可用 `help --json` 获取参数和权限，也可加 `--non-interactive` 调用当前命令。失败以非零退出码和标准错误中的 `code` 区分。用 `update check --json` 检查官方稳定版本。

可直接交给 Agent 的说明

> 用这个仓库里的 CoFlow CLI 帮我接手指定任务。先跑 `whoami`，把当前空间和账号告诉我。再查任务、读交接和相关原件。完成工作后，把做了什么、结果怎么样、还有什么没做写成一条进展，关联到这张任务。先从帮助里找命令和例子，保存后读回来确认。遇到权限不足就告诉我缺哪项权限，遇到记录被改过就先读最新版本。只在我指定的空间操作，凭证留在本地环境。

## 实施顺序

1. **可用的终端入口。** 统一配置、身份核验、JSON 和错误契约，兼容现有 Token。建立逐级帮助、恢复提示和可核实的版本更新检查。补齐项目范围内的 Todo、Timeline、Calendar、Context、Data 与 handoff 的读写主流程。用现有接口和测试实例尽早跑通。
2. **正式身份与授权。** 实现浏览器确认、CLI 会话、限时授权、撤销与审计。用两个独立成员验收分配、冲突恢复、权限失效和跨空间隔离。
3. **补齐网页能力。** 按覆盖清单开放批量操作、分类、回收站、账号与团队设置、AI 工作流和高影响确认。逐项对照网页/API 的业务结果。
4. **交付验收。** 同一项真实工作从 Context 和 Todo 接手，经排期、推进、简报、验收，再由 Data 回到原件。分别验证人用终端与 Agent 非交互执行，以及不同客户端使用同一授权协议。

首批以终端完成日常交付闭环为验收目标。完整覆盖以命令清单逐项通过为准。
