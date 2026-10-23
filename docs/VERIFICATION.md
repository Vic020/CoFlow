# 验证记录

更新：2026-10-24（Asia/Shanghai）；当前版本 0.1.0，未自动递增。

## 本机隔离双会话与公开内容审查（2026-10-24）

- 生产前端构建配合本机临时代理，以两个 localhost 子域分别承载 Alice、Bob 的独立 Cookie，会话互不覆盖，也未改变现有真实账号会话。
- 使用随机临时 PostgreSQL schema 和虚拟身份／示例链接；Codex、Claude Code 仅为测试接口模拟来源。浏览器验证评论提醒、协作分配与完成、内容编辑权限、多链接保存及跨会话可见性。
- 日报确认 2 名成员、2 条简报、1 项交付、0 阻塞、3 个链接、0 待办协作。测试 PASS 后清理 schema，停止测试服务并关闭临时浏览器页。
- Git 追踪改为截图白名单：仅保留审核过的虚拟公开预览和早期设计素材。本机验收图、HAR、日志、临时目录和数据库导出加入忽略规则；取消截图追踪仅影响后续提交，已有历史不改写。
- 本节之前引用的验收截图可能是本地文件，不再作为公开仓库交付物。正式公网、真实 Agent 工具和异地体验仍待验收。

## 网页编辑、多链接与接入边界（2026-10-24）

- 网页详情增加编辑入口；原作者和网页管理员可修改标题、正文、分类、状态、关注成员及最多 20 个链接，来源 Agent／Model、原作者、source_id 和创建时间不变。
- 保存采用最新 updated_at 检查和数据库行锁；发生并发更新／新评论时拒绝过期编辑，保留草稿并提示重新打开。记录编辑前后快照与通知。
- 独立 PostgreSQL schema 验证多个链接保存与移除、非法 URL 拒绝、作者／管理员权限、Agent Token 拒绝、跨团队隔离、来源保护、分类锁和历史数量；Go race 全量通过。
- 浏览器检查多链接新增、现有四个链接回填、桌面／390px 编辑布局及取消；未修改用户的正式简报。
- 上报方式排序为手动、Agent、Skill、API、CLI、MCP；CLI 与 MCP 共用暂未提供提示，当前正式接入为 HTTP 与 Skill。
- 增加 MIT LICENSE 和包元数据，版本保持 0.1.0；类型、版本一致性、Agent 测试及生产构建通过。
- 预览：`design/report-edit-preview.png`、`design/report-edit-mobile-preview.png`、`design/report-multiple-links-preview.png`。

## 布局与分类排序（2026-10-24）

- 项目／领域改为紧凑列表与对齐编辑区，桌面拖拽句柄、Alt + ↑ / ↓ 键盘操作、手机上下移动按钮共用持久化排序接口；保留 Timeline 内联编辑。
- 浏览器实际验证项目拖拽保存、键盘恢复顺序、手机领域上下移动；测试结束已恢复原顺序。
- 新增迁移 005 保存团队分类顺序，GET catalog 与 meta 沿用保存的顺序。
- Go PostgreSQL 测试覆盖排序持久化、元数据顺序、重复／不完整列表拒绝、Agent 权限与跨团队隔离；Go race、TypeScript、Agent 测试、版本检查、生产构建通过。
- 预览：`design/catalog-layout-preview.png`、`design/catalog-order-mobile-preview.png`。

## 设置分类管理（2026-10-24）

- 团队设置包含成员、邀请、项目、领域四个独立入口；项目与领域复用现有分类管理功能，无重复的类型切换栏。
- 浏览器验证项目待整理计数、现有项目编辑与合并目标、切换领域后表单重置；未修改真实团队数据。
- 检查 390 × 844 手机布局，类型检查、版本一致性和 Next.js 生产构建通过。
- 预览：`design/settings-projects-preview.png`、`design/settings-domains-mobile-preview.png`。

## 统一上报弹窗（2026-10-24）

- 顶部上报默认进入手动页签；右侧更多接入方式已在后续精简中移除。
- 浏览器检查六种页签、方向键切换、手动草稿保留及复制成功提示，未发布测试简报。
- 验证 Skill 下载入口、API / CLI 命令与示例展示；MCP 明确显示暂未提供。
- 检查桌面及 390 × 844 手机布局；类型检查、3 项 Agent 测试、版本检查与 Next.js 生产构建通过。
- 预览：`design/report-hub-agent-preview.png`、`design/report-hub-mobile-preview.png`。

## 构建与协议

- Next.js 生产构建与 TypeScript 检查通过。
- OpenAPI 的结构与引用校验通过；Skill 官方 quick_validate 校验通过。
- 版本一致性检查通过，CLI `--version` 输出 0.1.0。
- Skill 下载返回 Markdown，并从规范源文件同步生成。

## PostgreSQL 身份集成

使用项目 PostgreSQL，在独立随机 schema 内运行 `COFLOW_TEST_DATABASE_URL=... go test -race ./...`，结束后清理测试 schema，不覆盖正式团队数据。

通过的行为：

- 首次工作空间/管理员初始化，重复初始化被拒绝；迁移可重复运行。
- 密码登录、HttpOnly/SameSite 会话 Cookie、退出后会话失效；不返回密码哈希。
- 两名真实成员通过邀请加入同一团队，各自 Agent 上报归属正确，客户端伪造成员/团队字段无效。
- 邀请一次性使用、撤销和过期；两个请求并发接受同一邀请时仅一个成功。
- 已有账号加入需验证原密码或匹配登录态，不会通过邀请重置密码。
- 相同成员/团队/source_id 的重复上报更新原记录，其他成员相同来源标识互不覆盖。
- Token 只读/上报/评论权限，不能管理账号/邀请/凭证；无效 Bearer 不回退到浏览器身份。
- Token 仅存哈希，过期/撤销后立即失效，其他成员不能撤销不属于自己的 Token。
- 团队切换后的数据隔离，以及 Token 固定归属原团队。
- 成员不能更新他人记录；网页管理员可更新团队记录，管理员 Agent Token 没有额外权限。
- 移除成员后，会话和全部旧凭证失效且被撤销，不能借重新加入恢复旧凭证。
- 评论、JSON 持久化、链接和分类校验及跨站写入保护的原有演示测试继续通过。

## 页面与 CLI

在临时验证 schema 中执行，结束后已删除全部测试账号、会话、邀请与凭证。正式工作空间保持未初始化，留给用户创建自己的管理员。

- 浏览器登录后显示真实团队与当前成员。
- 团队设置生成邀请链接、复制入口和撤销操作正常。
- 创建个人凭证后，带凭证的 Prompt 可用；撤销后清除当前凭证并禁用复制。
- 退出登录回到登录页。
- CLI 使用真实 Token 上报，服务端成员/团队归属正确；撤销该 Token 后 CLI 被拒绝。
- 原有桌面/移动 Timeline、筛选、日报、评论与侧栏交互已验证；新账号页面检查桌面和手机布局。

截图：`design/team-settings-preview.png`、`design/token-management-preview.png`、`design/workspace-setup-preview.png`。前两张使用临时测试人物，完整凭证和有效邀请链接不包含在截图中。

## 独立邀请页面

- `/invite` 独立展示四步协作动效，390px 手机布局和底部邮箱输入已在浏览器检查。
- 无邀请参数时提交邮箱会提示使用完整邀请链接；失效邀请显示错误并禁用继续按钮。
- 新生成链接采用 `/invite#invite=...`；邮箱匹配后继续原有账号确认流程，旧 `/#invite=...` 入口保留。
- TypeScript、版本一致性及 `git diff --check` 通过。Turbopack 在当前沙箱中出现本地端口权限错误，改用 `npm run build --workspace @coflow/web -- --webpack`，生产构建通过。
- 预览截图：`design/invite-preview.png`、`design/invite-mobile-preview.png`、`design/invite-mobile-form-preview.png`。

## 当前边界

邀请通过复制链接分享，不自动发邮件。邮箱验证、找回密码、管理员转让和公网部署仍待后续实现。独立演示模式继续保留，与真实团队模式分开。


## 2026-10-24：分类与协作闭环

保持版本 0.1.0。新增功能记录在 Unreleased。

- `go test -race ./...` 全部通过，使用独立测试 schema：未知分类提议、名称／别名匹配、多领域去重、8 个并发上报、分类合并、归档与事务回滚、人工归属保护、历史快照、评论提醒、协作状态与进展、通知、已读以及跨团队隔离。
- `npm run typecheck`、`npm run version:check`、`git diff --check` 通过；OpenAPI 与 Skill 校验通过，公开下载资源已同步。
- Next.js webpack 生产构建和 Go／Next.js Docker 镜像构建通过；前端独立容器本机 HTTP 检查返回 200。
- 浏览器在专用验收 schema 中验证：分类合并后历史简报归并、协作从处理中更新至完成、日报统计、评论提醒、消息全部已读；390px 手机端验证详情与评论可用。
- 实际执行数据库备份，并恢复到独立临时库：核对 2 条简报、1 个协作请求及 3 条历史记录。随后清理恢复库与专用验收 schema，不保留虚拟账号与凭证。
- 生产 Compose、Caddy HTTPS 和备份／恢复步骤已准备。尚未购买服务器、配置真实域名或进行公网部署；2C2G 配置是资源预算，尚非真实服务器压力测试结论。

截图：`design/catalog-management-preview.png`、`design/collaboration-detail-preview.png`、`design/daily-summary-preview.png`、`design/collaboration-mobile-preview.png`，均使用虚拟验收数据。

## 首次创建工作空间引导

- 三步依次填写团队名称、称呼、邮箱与密码；仅最终提交调用原有 Go 初始化接口。
- 浏览器验证团队名进入第二步文案、姓名进入最终欢迎语，返回后称呼仍保留；未提交或创建验收账号。
- 桌面与 390px 手机布局检查通过，密码显示按钮保留；动效遵循减少动态效果偏好。
- TypeScript、版本一致性和 diff 检查通过。截图：`design/onboarding-ready-preview.png`、`design/onboarding-mobile-preview.png`。


## Agent 凭证独立页面

- `/credentials` 使用工作空间侧栏和共享 AuthGate；侧栏常驻，客户端切换页面时保留 Timeline 状态；完整凭证仅在一次性弹窗打开时暂存。
- 创建表单直接选择名称、权限与有效期；管理列表展示前缀、权限、有效／过期／撤销状态和最近使用日期，复用原有 Go 创建／撤销 API。
- 凭证创建后提供复制凭证与上报 Prompt。完整凭证在弹窗内明文展示，关闭／离开页面时清空；已有凭证验证仍校验当前成员与团队。
- 浏览器验证真实账号的已有凭证列表、侧栏导航及 390px 手机布局，未创建额外凭证或撤销已有凭证；此前身份集成测试覆盖创建、撤销和权限隔离。
- Next.js webpack 生产构建包含 `/`、`/credentials`、`/invite` 并通过；TypeScript、版本一致性与 diff 检查通过。标语与时区已从界面移除。
- 截图：`design/credentials-page-preview.png`、`design/credentials-mobile-preview.png`，只展示凭证前缀。


## 常驻布局、团队切换与独立称呼

- 共享路由布局保留侧栏、团队信息和 Timeline 状态；浏览器输入搜索词后切换凭证再返回，搜索词保留，侧栏节点未重新挂载。
- 团队设置改为 `/settings` 独立页面；团队切换菜单底部提供 `/teams/new`，仅填写团队名称和本团队称呼，无邮箱／密码步骤。浏览器只预览，未创建额外真实团队。
- 新迁移 004 为已有成员回填称呼。独立 schema 中 `go test -race ./...` 通过，验证新团队称呼、当前身份与元数据一致、原团队称呼不受影响、切回后恢复，以及 Agent Token 无权新建团队。
- 一次性凭证弹窗明文展示，关闭、路由离开或团队切换清除完整凭证；异步创建响应不会在页面卸载后写回全局凭证。浏览器验收未创建／撤销真实账号凭证。
- Next.js webpack 构建包含 `/`、`/credentials`、`/settings`、`/teams/new`、`/invite`；类型、版本与 diff 检查通过。团队设置桌面／390px 手机布局已检查。
- 截图：`design/team-switcher-preview.png`、`design/new-team-onboarding-preview.png`、`design/team-settings-page-preview.png`。


## 设置分类、个人菜单与快捷上报

- 设置页提供成员／邀请侧边分类；分类管理移入 Timeline 铅笔入口，点击展开内联编辑，完成后收起；退出登录仅在个人菜单展示。
- AuthGate 只读取当前成员的凭证元数据判断是否有有效可上报凭证，不恢复、存储或回显完整密钥。创建／撤销后刷新元数据，切换团队丢弃旧团队的异步响应。
- 默认上报 Prompt 复用 Agent 既有配置，包含目标团队／成员校验要求；首次配置仍在一次性弹窗复制带凭证 Prompt。Skill 说明凭证缺失、身份不匹配与重复上报的处理。
- 浏览器验证成员／邀请切换、个人菜单中的退出入口、Timeline 编辑开关，以及已有凭证时的复制按钮和默认 Prompt 文案。未执行退出、邀请发送、分类写入或新建／撤销真实凭证。
- `npm run test:agent` 三项测试通过，覆盖默认 Prompt 不含空／伪造密钥、首次配置与演示模式密钥边界、只读／过期／撤销凭证判定。Skill quick_validate、生产构建、类型、版本及 diff 检查通过。
- 截图：`design/settings-categories-preview.png`、`design/account-menu-preview.png`、`design/timeline-catalog-edit-preview.png`。
