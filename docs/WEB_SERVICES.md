# 独立联网服务（Unreleased）

联网服务与对话模型分开配置。已验证、支持工具调用的模型可使用所选联网服务，无须同厂商；不自动复用模型密钥，也不要求 DeepSeek 模型。当前实现使用各厂商的官方 API，不支持自定义代理地址、自托管端点、整站爬取或浏览器操作。

## 入口与使用

- **个人：** 左下角账号菜单 → 个人 AI 设定 → 联网服务。配置和默认项属于账号，跨本人空间可用，其他成员／管理员不可读取、编辑或使用。
- **团队：** 空间设置 → 联网服务。管理员管理，当前团队成员可用；其他空间不可使用。
- 每条配置选择服务商、名称、API Key 和默认项。点击验证会实际发送一次公开搜索和一次 `https://example.com/` 抓取，可能计费；失败不保存密钥。成功后验证按钮禁用，保存复用十分钟内绑定账号／团队、配置修订、供应商和密钥的凭据，不重复请求。名称／默认项可沿用既有验证；换供应商须重新填 Key，换 Key 须重新验证。
- 聊天工具栏的“联网”默认关闭。开启后选择本轮使用的已验证配置；没有配置时直接打开个人联网设置。团队默认优先于个人默认，没有默认则选择可用配置；显式选择失效不会自动消费其他 Key。选择只留在当前界面会话内存，新对话、打开历史、切换模型／空间恢复关闭。
- 开启联网是对本轮公开资料查询的许可；供应商收到模型生成的搜索词或经校验的网址，不自动收到整个会话／团队正文。搜索和抓取使用同一条所选联网配置，失败不偷偷换服务商。

## 首批供应商

| 供应商 | 搜索 | 获取单页正文 | 适配方式与官方依据 |
| --- | --- | --- | --- |
| Tavily | `/search` | `/extract` | Bearer；基础搜索、最多 5 条，不请求生成答案／原始全文；单 URL Markdown 提取。[Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract) |
| DeepSeek | `/v1/tools/search` | `/v1/tools/fetch` | Bearer；搜索 5 条、不批量抓全文；独立保存联网 Key，可自行填写与模型相同的 Key。[官方指南](https://api-docs.deepseek.com/guides/search/) |
| Exa | `/search` | `/contents` | `x-api-key`；auto 搜索及 highlights，单 URL text 正文。[Search](https://exa.ai/docs/reference/search)、[Contents](https://exa.ai/docs/reference/get-contents) |
| Firecrawl | `/v2/search` | `/v2/scrape` | Bearer；仅 web 搜索、单页 Markdown，不启用 crawl／browser。[Search](https://docs.firecrawl.dev/api-reference/endpoint/search)、[Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape) |

这些供应商均有搜索和单页正文产品，因此首批使用同一套配置表单和工具协议。不同服务的 credits、计价、额度与目标站可达性并不等价；界面显示请求尝试数，不估算价格或把它当成账单。协议测试不等于真实账号的余额／权限验收。

## 边界与记录

每轮最多 3 次外部请求，搜索最多 5 条；本轮相同成功调用复用结果。抓取只接受本轮用户明确提供或搜索真实返回的公开 HTTPS 地址，阻止显式内网、带凭证网址，以及包含已知模型／联网密钥的参数。应用只请求所选供应商的固定官方 HTTPS 端点，不直连目标网页；供应商执行其目标站访问策略。每次 8 秒，仍受原聊天总时限约束；最多读取 1 MiB，摘要／正文分别截断到 1500／8000 字符。

失败停止本轮联网，不自动重试或换厂商；请求被取消／超时不保证供应商未处理或未计费。已成功保存的相同 request_id、消息、联网开关和联网配置 ID 重试返回原结果；改开关或配置需新 request_id。失败／取消后手动重试仍可能再次收费，不承诺跨失败请求账单去重。

来源、供应商、配置 ID／修订和请求数随本空间私有历史保存。返回数据不可信，不能授权 Todo／Timeline／Calendar 写入。提交结果前复查联网配置可见性、验证状态和修订，配置被修改／删除时拒绝提交本轮结果；已发出的外部请求无法撤回。定时任务和 Agent Token 不开放联网功能；公开演示不保存真实 Key、不连接外部服务。

## 存储与升级

迁移 016 新增 `assistant_web_configs`，在迁移 015 的账号级模型配置之后执行。个人记录仅关联用户，团队记录仅关联团队；默认项由事务锁和唯一索引约束。Key 使用原加密主密钥和 `web:` 独立关联域加密，不写入浏览器持久化存储、历史或 API 元数据。

旧版 DeepSeek 模型记录不自动复制、消费或撤销。升级后先在联网服务中单独填写／验证；历史来源继续可读。备份数据库并保留原 `COFLOW_AI_ENCRYPTION_KEY`，不要只回退旧程序来操作已升级的个人配置。应用和 Skill 版本本次保持不变。
