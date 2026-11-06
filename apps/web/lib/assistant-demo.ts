import type {
  AIAction,
  AIConfig,
  AIConversation,
  AITurn,
  AITemplate,
  AIJob,
  AIMCP,
} from "./assistant";
import type { Meta, Report } from "./types";
import type { Todo } from "./todo";
import { validCivilDay, wallTimeCandidates, civilDay } from "./calendar.ts";
const templateItems: AITemplate[] = [
  {
    id: "builtin-progress",
    scope: "builtin",
    title: "Project progress",
    description: "Tasks, evidence and blockers",
    instructions:
      "Review project {{project}} using verified tasks, reports and schedules.",
    parameters: [{ name: "project", label: "Project", required: false }],
    tools: [
      "read_workspace",
      "find_todos",
      "find_reports",
      "read_calendar",
      "read_todo",
      "read_report",
    ],
    version: 1,
    revision: 1,
    editable: false,
  },
  {
    id: "builtin-schedule",
    scope: "builtin",
    title: "Schedule tasks",
    description: "Preview task schedules",
    instructions: "Prepare schedule drafts for {{project}} during {{dates}}.",
    parameters: [
      { name: "project", label: "Project", required: false },
      { name: "dates", label: "Dates", required: false },
    ],
    tools: [
      "read_workspace",
      "find_todos",
      "read_calendar",
      "read_todo",
      "propose_schedule",
    ],
    version: 1,
    revision: 1,
    editable: false,
  },
  {
    id: "builtin-brief",
    scope: "builtin",
    title: "Delivery brief",
    description: "Verified delivery evidence",
    instructions: "Draft a delivery brief for {{project}}.",
    parameters: [{ name: "project", label: "Project", required: false }],
    tools: [
      "read_workspace",
      "find_todos",
      "find_reports",
      "read_todo",
      "read_report",
      "propose_report",
    ],
    version: 1,
    revision: 1,
    editable: false,
  },
];
const jobs = new Map<string, AIJob>();
const connections = new Map<string, AIMCP>();
function demoNextRun(input: Record<string, unknown>) {
  const zone = String(input.timezone || "");
  const clock = String(input.local_time || "");
  const weekdays = input.weekdays as number[];
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ||
    !Array.isArray(weekdays) ||
    !weekdays.length
  )
    throw Error("时间或工作日无效");
  const now = Date.now();
  const today = civilDay(new Date(now).toISOString(), zone);
  for (let n = 0; n < 10; n++) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    if (!weekdays.includes(d.getUTCDay())) continue;
    const at = wallTimeCandidates(
      `${d.toISOString().slice(0, 10)}T${clock}`,
      zone,
    )[0];
    if (at && Date.parse(at) > now) return at;
  }
  throw Error("无法计算下次运行时间");
}
const conversations = new Map<string, AIConversation>();
const actions = new Map<string, AIAction>();
const turns = new Map<string, { conversation_id: string; turn: AITurn }>();
const config: AIConfig = {
  id: "demo-ai",
  scope: "team",
  name: "CoFlow Demo",
  provider: "compatible",
  protocol: "chat-completions",
  base_url: "",
  model: "Synthetic",
  revision: 1,
  is_default: true,
  verified_at: "2026-11-01T00:00:00Z",
  editable: false,
};
type Call = (path: string, init?: RequestInit) => Promise<unknown>;
export async function assistantDemo(
  path: string,
  method: string,
  input: Record<string, unknown>,
  meta: Meta,
  todos: Todo[],
  reports: Report[],
  call: Call,
): Promise<unknown> {
  const url = new URL(path, "https://offline.invalid");
  path = url.pathname;
  if (path === "/assistant/templates" && method === "GET")
    return { items: structuredClone(templateItems) };
  if (path === "/assistant/templates" && method === "POST") {
    const t = structuredClone(input) as unknown as AITemplate;
    const i = templateItems.findIndex((v) => v.id === t.id);
    if (i >= 0 && templateItems[i].scope === "builtin")
      throw Error("内置模板不可修改");
    t.id = t.id || `demo-template-${crypto.randomUUID()}`;
    t.version = (i >= 0 ? templateItems[i].version : 0) + 1;
    t.revision = t.version;
    t.editable = true;
    if (i >= 0) templateItems[i] = t;
    else templateItems.push(t);
    return t;
  }
  if (path === "/assistant/jobs/preview")
    return {
      next_run_at: demoNextRun({
        timezone: url.searchParams.get("timezone"),
        local_time: url.searchParams.get("local_time"),
        weekdays: (url.searchParams.get("weekdays") || "")
          .split(",")
          .map(Number),
      }),
    };
  if (path === "/assistant/jobs" && method === "GET")
    return { items: [...jobs.values()] };
  if (path === "/assistant/jobs" && method === "POST") {
    const j = structuredClone(input) as unknown as AIJob;
    j.id = j.id || `demo-job-${crypto.randomUUID()}`;
    j.revision = (jobs.get(j.id)?.revision || 0) + 1;
    j.next_run_at = demoNextRun(input);
    jobs.set(j.id, j);
    return structuredClone(j);
  }
  if (path.startsWith("/assistant/jobs/") && method === "PATCH") {
    const j = jobs.get(path.split("/").pop()!);
    if (!j || j.revision !== input.expected_revision)
      throw Error("定时任务已变化");
    j.enabled = false;
    j.revision++;
    return structuredClone(j);
  }
  if (/^\/assistant\/jobs\/[^/]+\/runs$/.test(path)) return { items: [] };
  if (path === "/assistant/mcp" && method === "GET")
    return { items: [...connections.values()] };
  if (path.startsWith("/assistant/mcp") && method === "POST")
    throw Error("离线演示不连接外部 MCP 或保存令牌");
  if (path.startsWith("/assistant/conversations/") && method === "PATCH") {
    const c = conversations.get(path.split("/").pop()!);
    if (!c || c.revision !== input.expected_revision) throw Error("会话已变化");
    if (input.action === "rename") c.title = String(input.title || "");
    if (input.action === "archive") c.archived_at = new Date().toISOString();
    if (input.action === "unarchive") c.archived_at = null;
    if (input.action === "delete") c.deleted_at = new Date().toISOString();
    if (input.action === "restore") c.deleted_at = null;
    c.revision++;
    return { ok: true };
  }
  const en = input.locale !== "zh-CN";
  if (path === "/assistant/preference" && method === "PATCH")
    return { ok: true };
  if (path === "/assistant/configs" && method === "GET")
    return { items: [config], configured: true };
  if (path === "/assistant/conversations" && method === "GET")
    return {
      items: [...conversations.values()]
        .reverse()
        .filter((c) => {
          const state = url.searchParams.get("state") || "active";
          return (
            (state === "deleted"
              ? !!c.deleted_at
              : state === "archived"
                ? !!c.archived_at && !c.deleted_at
                : !c.archived_at && !c.deleted_at) &&
            JSON.stringify(c)
              .toLowerCase()
              .includes((url.searchParams.get("q") || "").toLowerCase())
          );
        })
        .map(({ turns, ...c }) => c),
      next_cursor: "",
    };
  if (path.startsWith("/assistant/conversations/") && method === "GET") {
    const c = conversations.get(path.split("/").pop()!);
    if (!c) throw Error("会话不可用");
    return structuredClone(c);
  }
  if (path === "/assistant/chat" && method === "POST") {
    const rid = String(input.request_id || "");
    const prior = turns.get(rid);
    if (prior) return structuredClone(prior);
    const context = (input.context || {}) as Record<string, string>;
    const project = context.project;
    const tasks = todos.filter(
      (t) =>
        !t.archived &&
        (!project || t.project_id === project) &&
        (!context.domain || t.domains.includes(context.domain)) &&
        (!context.member || t.assignee_id === context.member),
    );
    const items = reports.filter(
      (r) =>
        (!project || r.project_id === project) &&
        (!context.domain || r.domains.includes(context.domain)) &&
        (!context.member || r.author_id === context.member),
    );
    const message = String(input.message || "");
    const id = String(
      input.conversation_id || `demo-chat-${crypto.randomUUID()}`,
    );
    let conversation = conversations.get(id);
    if (!conversation) {
      conversation = {
        id,
        title: message.slice(0, 45),
        config_id: config.id,
        revision: 1,
        updated_at: new Date().toISOString(),
        config_snapshot: config,
        turns: [],
      };
      conversations.set(id, conversation);
    }
    if (input.template_id) {
      const template = templateItems.find(
        (t) =>
          t.id === input.template_id && t.version === input.template_version,
      );
      if (!template) throw Error("模板不可用");
      conversation.template = structuredClone(template);
    }
    const modeText =
      message + " " + (conversation.template?.instructions || "");
    const turn: AITurn = {
      request_id: rid,
      user: message,
      reply: "",
      actions: [],
      links: tasks
        .slice(0, 4)
        .map((t) => ({ title: t.title, url: `/todo?todo=${t.id}` })),
    };
    const propose = (
      kind: string,
      title: string,
      payload: AIAction["payload"],
    ) => {
      const a: AIAction = {
        id: `demo-action-${crypto.randomUUID()}`,
        kind,
        title,
        payload: {
          ...payload,
          project_name: meta.projects.find((p) => p.id === payload.project_id)
            ?.name,
          column_name: kind === "propose_todo" ? "待办" : undefined,
        },
        state: "pending",
      };
      turn.actions.push(a);
      actions.set(a.id, a);
    };
    if (/简报|汇总交付|brief|delivery summary/i.test(modeText)) {
      const body =
        tasks
          .filter((t) => t.completed_at)
          .map((t) => `- ${t.title}`)
          .join("\n") ||
        items
          .slice(0, 3)
          .map((r) => `- ${r.title}`)
          .join("\n");
      const title = en ? "Project delivery summary" : "项目交付简报";
      propose("propose_report", title, {
        title,
        body,
        project_id: project || "",
        ...{
          todo_ids: tasks
            .filter((t) => t.completed_at)
            .slice(0, 20)
            .map((t) => t.id),
        },
      });
      turn.reply = en
        ? "Prepared a draft from the synthetic delivery evidence. Review and confirm to publish in this demo."
        : "已根据合成交付记录整理草稿，请检查后确认发布。";
    } else if (/排期|安排|schedule|时间|\d{4}-\d{2}-\d{2}/i.test(modeText)) {
      const dates = message.match(/\d{4}-\d{2}-\d{2}/g) || [];
      if (
        dates.length < 2 ||
        !dates.every(validCivilDay) ||
        dates[1]! < dates[0]!
      ) {
        turn.reply = en
          ? "Which date range should I use? For this demo, enter two dates, for example 2026-11-09 to 2026-11-13."
          : "希望安排在哪个日期范围？演示可输入两个日期，例如 2026-11-09 至 2026-11-13。";
      } else {
        for (const t of tasks.filter((t) => !t.completed_at).slice(0, 3))
          propose("propose_schedule", t.title, {
            todo_id: t.id,
            project_id: t.project_id,
            original_schedule: t.schedule || undefined,
            ...{ expected_revision: t.revision },
            schedule: {
              kind: "date-range",
              start_date: dates[0],
              end_date: dates[1],
            },
          });
        turn.reply = en
          ? "Prepared schedule changes. Each card needs confirmation; deadlines and completion states stay as they are."
          : "已准备排期草稿。逐项确认后生效，截止日期与完成状态保持。";
      }
    } else if (/创建|新建|create/i.test(modeText)) {
      const title = message
        .replace(/^(创建|新建)(任务)?[：:\s]*/, "")
        .slice(0, 100);
      propose("propose_todo", title, {
        title,
        body: "",
        project_id: project || "",
      });
      turn.reply = en
        ? "Task draft is ready for confirmation."
        : "任务草稿已准备，确认后创建。";
    } else {
      const done = tasks.filter((t) => t.completed_at).length;
      turn.reply = en
        ? `Synthetic overview: ${tasks.length} active tasks, ${done} completed; ${items.length} progress reports. Follow the sources for details. This demo uses scripted responses, not a live model.`
        : `合成项目概览：${tasks.length} 项任务，${done} 项已完成；${items.length} 条进度。可从来源查看细节。演示使用预设回复，不连接真实模型。`;
      turn.links.push(
        ...items
          .slice(0, 2)
          .map((r) => ({ title: r.title, url: `/?report=${r.id}` })),
      );
    }
    conversation.turns!.push(turn);
    conversation.revision++;
    conversation.updated_at = new Date().toISOString();
    const result = { conversation_id: id, turn };
    turns.set(rid, result);
    return structuredClone(result);
  }
  if (path.startsWith("/assistant/actions/")) {
    const a = actions.get(path.split("/").pop()!);
    if (!a) throw Error("草稿不可用");
    if (a.state !== "pending") return structuredClone(a);
    if (method === "PATCH" && a.kind === "propose_report") {
      a.title = String(input.title || "");
      a.payload.title = a.title;
      a.payload.body = String(input.body || "");
      return structuredClone(a);
    }
    if (method !== "POST") throw Error("助手不支持此操作");
    if (input.decision === "cancel") {
      a.state = "cancelled";
      return structuredClone(a);
    }
    if (input.decision !== "confirm") throw Error("请选择确认或取消");
    const json = (body: unknown, method: string) => ({
      method,
      body: JSON.stringify(body),
    });
    try {
      if (a.kind === "propose_schedule")
        a.result = (await call(
          `/todos/${a.payload.todo_id}`,
          json({ ...a.payload, action: "edit", operation_id: a.id }, "PATCH"),
        )) as { id: string };
      else if (a.kind === "propose_todo")
        a.result = (await call(
          "/todos",
          json(
            {
              ...a.payload,
              column_id: "backlog",
              source_id: a.id,
              operation_id: a.id,
            },
            "POST",
          ),
        )) as { id: string };
      else
        a.result = (await call(
          "/reports",
          json(
            {
              ...a.payload,
              status: "progress",
              source_id: a.id,
              agent: "CoFlow Demo",
            },
            "POST",
          ),
        )) as { id: string };
      a.state = "done";
    } catch (e) {
      a.state = "failed";
      a.result = { error: (e as Error).message };
    }
    return structuredClone(a);
  }
  throw Error("演示不保存 AI 配置或 API Key");
}
