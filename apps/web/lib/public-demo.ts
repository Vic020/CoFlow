import type { Meta, Report } from "./types";

const repositoryURL = "https://github.com/Vic020/CoFlow";

const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const members = [
  { id: "demo-alice", name: "Alice", role: "产品", color: "mint" },
  { id: "demo-bob", name: "Bob", role: "研发", color: "blue" },
  { id: "demo-carol", name: "Carol", role: "设计", color: "rose" },
  { id: "demo-dan", name: "Dan", role: "运营", color: "lime" },
];
const projects = [
  { id: "demo-launch", name: "产品发布", domains: ["产品", "研发", "设计"], status: "active" },
  { id: "demo-guide", name: "使用指南", domains: ["内容", "运营"], status: "active" },
];
export const demoMeta: Meta = {
  members, projects, domains: ["产品", "研发", "设计", "内容", "运营"],
  current_user: "demo-alice", mode: "local-demo", timezone: "Asia/Shanghai",
  role: "member", team: { id: "demo-team", name: "Flow Studio · 演示" },
};
const examples = [
  ["demo-alice", "发布计划已确认，交付进入最后一轮验收", "本轮聚焦三个结果：完成交付清单、对齐发布节奏、明确每个环节的负责人。\n\n**下一步**：请大家在对应简报中补充验收反馈，让讨论留在工作现场。", "demo-launch", "产品", "Codex", "progress", 0.5],
  ["demo-bob", "多链接交付与编辑冲突校验已完成", "支持在同一简报中附上设计、代码和验证记录。更新前检查修订时间，避免覆盖伙伴刚刚补充的内容。\n\n- 多链接表单完成\n- 保留原始来源与讨论\n- 并发修改提示重新读取", "demo-launch", "研发", "Claude Code", "delivered", 1.5],
  ["demo-carol", "移动端方案待反馈", "已收紧筛选区与卡片间距，突出标题、状态和交付链接。请 Alice 看一下手机端的信息优先级。\n\n需要确认：筛选面板是否保留上次选择。", "demo-launch", "设计", "Codex", "review", 3],
  ["demo-dan", "新成员指南补齐首次上报流程", "将团队加入、个人凭证配置、首次上报和日常跟进串成一条简短路径。文档链接在下方，可直接查看公开指南。", "demo-guide", "内容", "Claude Code", "delivered", 5],
  ["demo-bob", "示例部署等待资源确认", "部署清单已准备，等待选择演示用资源。这里是虚构的阻塞示例，用来展示团队如何集中发现需要协助的进展。", "demo-launch", "研发", "Codex", "blocked", 22],
  ["demo-alice", "团队协作流程完成首轮走查", "Agent 上报简报和链接 → 团队浏览 → 评论或提出协作请求 → 后续进展持续更新。\n\n这条演示简报把工作主线保留在一个地方。", "demo-launch", "产品", "手动上报", "resolved", 27],
] as const;
let reports: Report[] = examples.map(([author, title, body, project, domain, agent, status, hours], i) => ({
  id: `demo-report-${i + 1}`, team_id: "demo-team", source_id: `demo-source-${i + 1}`,
  author_id: author, title, body, project_id: project, domain, domains: [domain], agent,
  model: "", status, links: [{ title: "公开使用指南", url: `${repositoryURL}/wiki` },
    ...(i === 1 ? [{ title: "开源代码", url: repositoryURL }] : [])],
  mentions: i === 2 ? ["demo-alice"] : [], created_at: ago(hours), updated_at: ago(hours),
  comments: i === 1 ? [{ id: "demo-comment-1", report_id: "demo-report-2", author_id: "demo-alice", body: "已检查交付清单，链接和说明都很清楚。", created_at: ago(1) }] : [],
}));

/** No fetch, cookies, tokens, database, or browser persistence. State lives in this page only. */
export async function publicDemoRequest(path: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method?.toUpperCase() || "GET";
  const clone = <T,>(value: T): T => structuredClone(value);
  if (method === "GET") {
    if (path === "/auth/status") return { mode: "local-demo", initialized: true };
    if (path === "/meta") return clone(demoMeta);
    if (path === "/reports") return { items: clone(reports) };
    if (path === "/tokens") return { items: [] };
  }
  const payload = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  const match = path.match(/^\/reports\/(demo-report-[\w-]+)(\/comments)?$/);
  if (method === "POST" && path === "/reports") {
    if (!payload.title?.trim()) throw new Error("请填写标题");
    const now = new Date().toISOString();
    const report: Report = {
      id: `demo-report-${crypto.randomUUID()}`, team_id: "demo-team", source_id: payload.source_id,
      author_id: "demo-alice", title: payload.title, body: payload.body || "",
      project_id: projects.some(p => p.id === payload.project_id) ? payload.project_id : "",
      domain: payload.domain || "", domains: payload.domain ? [payload.domain] : [],
      agent: payload.agent || "手动上报", model: "", status: payload.status || "progress",
      links: payload.links || [], mentions: payload.mentions || [], comments: [], created_at: now, updated_at: now,
    };
    report.links.forEach(link => { if (!["http:", "https:"].includes(new URL(link.url).protocol)) throw new Error("请使用 HTTP 或 HTTPS 链接"); });
    reports.unshift(report);
    return clone(report);
  }
  const report = match && reports.find(r => r.id === match[1]);
  if (report && method === "POST" && match[2]) {
    if (!payload.body?.trim()) throw new Error("请填写评论");
    const comment = { id: `demo-comment-${crypto.randomUUID()}`, report_id: report.id, author_id: "demo-alice", body: payload.body, created_at: new Date().toISOString() };
    report.comments.push(comment);
    report.updated_at = comment.created_at;
    return clone(comment);
  }
  if (report && (method === "PUT" || method === "PATCH") && !match[2]) {
    if (report.author_id !== "demo-alice") throw new Error("只能编辑自己的演示简报");
    const fields = method === "PATCH" ? ["status"] : ["title", "body", "project_id", "domain", "status", "links", "mentions"];
    const next = clone(report);
    for (const key of fields) if (payload[key] !== undefined) Object.assign(next, { [key]: payload[key] });
    next.links.forEach(link => { if (!["http:", "https:"].includes(new URL(link.url).protocol)) throw new Error("请使用 HTTP 或 HTTPS 链接"); });
    next.domains = next.domain ? [next.domain] : [];
    next.updated_at = new Date().toISOString();
    Object.assign(report, next);
    return clone(report);
  }
  throw new Error("公开演示不连接真实服务，请在自有实例中使用此功能。");
}
