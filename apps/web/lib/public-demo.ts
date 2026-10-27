import type { Todo, TodoBoardData } from "./todo";
import type { Meta, Report } from "./types";
const repositoryURL = "https://github.com/Vic020/CoFlow";
const ago = (hours: number) =>
  new Date(Date.now() - hours * 3600000).toISOString();
const members = [
  {
    id: "demo-alice",
    name: "Alice",
    role: "产品",
    color: "mint",
  },
  {
    id: "demo-bob",
    name: "Bob",
    role: "研发",
    color: "blue",
  },
  {
    id: "demo-carol",
    name: "Carol",
    role: "设计",
    color: "rose",
  },
  {
    id: "demo-dan",
    name: "Dan",
    role: "运营",
    color: "lime",
  },
];
const projects = [
  {
    id: "demo-launch",
    name: "产品发布",
    domains: ["产品", "研发", "设计"],
    status: "active",
  },
  {
    id: "demo-guide",
    name: "使用指南",
    domains: ["内容", "运营"],
    status: "active",
  },
];
export const demoMeta: Meta = {
  members,
  projects,
  domains: ["产品", "研发", "设计", "内容", "运营"],
  current_user: "demo-alice",
  mode: "local-demo",
  timezone: "Asia/Shanghai",
  role: "member",
  team: {
    id: "demo-team",
    name: "Flow Studio · 演示",
  },
};
const examples = [
  [
    "demo-alice",
    "发布计划已确认，交付进入最后一轮验收",
    "本轮聚焦三个结果：完成交付清单、对齐发布节奏、明确每个环节的负责人。\n\n**下一步**：请大家在对应简报中补充验收反馈，让讨论留在工作现场。",
    "demo-launch",
    "产品",
    "Codex",
    "progress",
    0.5,
  ],
  [
    "demo-bob",
    "多链接交付与编辑冲突校验已完成",
    "支持在同一简报中附上设计、代码和验证记录。更新前检查修订时间，避免覆盖伙伴刚刚补充的内容。\n\n- 多链接表单完成\n- 保留原始来源与讨论\n- 并发修改提示重新读取",
    "demo-launch",
    "研发",
    "Claude Code",
    "delivered",
    1.5,
  ],
  [
    "demo-carol",
    "移动端方案待反馈",
    "已收紧筛选区与卡片间距，突出标题、状态和交付链接。请 Alice 看一下手机端的信息优先级。\n\n需要确认：筛选面板是否保留上次选择。",
    "demo-launch",
    "设计",
    "Codex",
    "review",
    3,
  ],
  [
    "demo-dan",
    "新成员指南补齐首次上报流程",
    "将团队加入、个人凭证配置、首次上报和日常跟进串成一条简短路径。文档链接在下方，可直接查看公开指南。",
    "demo-guide",
    "内容",
    "Claude Code",
    "delivered",
    5,
  ],
  [
    "demo-bob",
    "示例部署等待资源确认",
    "部署清单已准备，等待选择演示用资源。这里是虚构的阻塞示例，用来展示团队如何集中发现需要协助的进展。",
    "demo-launch",
    "研发",
    "Codex",
    "blocked",
    22,
  ],
  [
    "demo-alice",
    "团队协作流程完成首轮走查",
    "Agent 上报简报和链接 → 团队浏览 → 评论或提出协作请求 → 后续进展持续更新。\n\n这条演示简报把工作主线保留在一个地方。",
    "demo-launch",
    "产品",
    "手动上报",
    "resolved",
    27,
  ],
] as const;
let reports: Report[] = examples.map(
  ([author, title, body, project, domain, agent, status, hours], i) => ({
    id: `demo-report-${i + 1}`,
    team_id: "demo-team",
    source_id: `demo-source-${i + 1}`,
    author_id: author,
    title,
    body,
    project_id: project,
    domain,
    domains: [domain],
    agent,
    model: "",
    status,
    links: [
      {
        title: "公开使用指南",
        url: `${repositoryURL}/wiki`,
      },
      ...(i === 1
        ? [
            {
              title: "开源代码",
              url: repositoryURL,
            },
          ]
        : []),
    ],
    mentions: i === 2 ? ["demo-alice"] : [],
    created_at: ago(hours),
    updated_at: ago(hours),
    comments:
      i === 1
        ? [
            {
              id: "demo-comment-1",
              report_id: "demo-report-2",
              author_id: "demo-alice",
              body: "已检查交付清单，链接和说明都很清楚。",
              created_at: ago(1),
            },
          ]
        : [],
  }),
);

const taskExamples = [
  [
    "确认发布验收清单",
    "doing",
    "demo-alice",
    "high",
    "核对各项交付与负责人，在关联简报中记录验收结论。",
  ],
  [
    "交付多链接与冲突校验",
    "done",
    "demo-bob",
    "high",
    "代码与验证记录已交付，验收完成。关联简报保留交付证据。",
  ],
  [
    "验收移动端信息层级",
    "review",
    "demo-carol",
    "medium",
    "设计方案已提交，等待 Alice 确认筛选与卡片的信息优先级；简报待反馈不等于任务完成。",
  ],
  [
    "补齐新成员首次上报指南",
    "done",
    "demo-dan",
    "medium",
    "已补齐团队加入、凭证配置与首次上报说明，并完成走查。",
  ],
  [
    "确认演示部署资源",
    "backlog",
    "demo-alice",
    "high",
    "虚构的阻塞示例：先确认演示资源，再由研发继续部署；关联 Timeline 简报记录阻塞。",
  ],
  [
    "跟进首轮协作反馈",
    "doing",
    "demo-alice",
    "medium",
    "协作流程走查已完成，继续整理反馈。单条简报结束后，任务仍可持续跟进。",
  ],
] as const;
const demoTasks: Todo[] = taskExamples.map(
  ([title, column, assignee, priority, body], i) => {
    const report = reports[i];
    const completed = column === "done" ? ago(i === 1 ? 1 : 4) : null;
    const created = ago(48 + i);
    const snapshot = {
      title,
      column_id: column,
      assignee_id: assignee,
      creator_id: "demo-alice",
      project_id: report.project_id,
      domains: report.domains || [report.domain],
      completed_at: completed,
    };
    return {
      ...snapshot,
      id: `demo-todo-${i + 1}`,
      source_id: `demo-todo-source-${i + 1}`,
      body,
      previous_column_id: column === "done" ? "review" : "backlog",
      priority,
      due_date: column === "done" ? "" : ago(-24 * (i + 1)).slice(0, 10),
      links: structuredClone(report.links),
      report_ids: [report.id],
      collaboration_id: "",
      agent: report.agent,
      model: "",
      revision: 2,
      archived: false,
      position: i * 1024,
      created_at: created,
      updated_at: completed || report.updated_at,
      comments:
        i === 2
          ? [
              {
                id: "demo-todo-comment-1",
                author_id: "demo-carol",
                body: "请 Alice 确认筛选面板是否保留上次选择，方案见关联简报。",
                mentions: ["demo-alice"],
                created_at: ago(2),
                deleted: false,
              },
            ]
          : [],
      history: [
        {
          id: `demo-todo-created-${i}`,
          actor_id: "demo-alice",
          agent: "",
          model: "",
          action: "create",
          created_at: created,
          before: {},
          after: { ...snapshot, column_id: "backlog", completed_at: null },
        },
        {
          id: `demo-todo-linked-${i}`,
          actor_id: assignee,
          agent: report.agent,
          model: "",
          action: completed ? "report-move" : "report-link",
          created_at: completed || report.updated_at,
          before: { column_id: "backlog", completed_at: null, report_ids: [] },
          after: { ...snapshot, report_ids: [report.id] },
        },
      ],
    };
  },
);

/** No fetch, cookies, tokens, database, or browser persistence. State lives in this page only. */
export async function publicDemoRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const method = init?.method?.toUpperCase() || "GET";
  const clone = <T>(value: T): T => structuredClone(value);
  if (path.startsWith("/todo") && path !== "/todo-completions")
    return demoTodoChange(
      path,
      method,
      typeof init?.body === "string" ? JSON.parse(init.body) : {},
    );
  if (method === "GET" && path === "/todo-completions")
    return {
      items: todoBoard.tasks.flatMap((t) =>
        t.history
          .filter((e) => !e.before.completed_at && e.after.completed_at)
          .map((e) => ({
            todo_id: t.id,
            completed_at: e.created_at,
            assignee_id: e.after.assignee_id || "",
            project_id: e.after.project_id || "",
            domains: e.after.domains || [],
            creator_id: e.after.creator_id || "",
            agent: e.agent,
          })),
      ),
    };
  if (method === "GET") {
    if (path === "/auth/status")
      return {
        mode: "local-demo",
        initialized: true,
      };
    if (path === "/meta") return clone(demoMeta);
    if (path === "/reports")
      return {
        items: clone(
          reports.map((r) => ({
            ...r,
            todo_ids: todoBoard.tasks
              .filter((t) => t.report_ids.includes(r.id))
              .map((t) => t.id),
          })),
        ),
      };
    if (path === "/tokens")
      return {
        items: [],
      };
  }
  const payload = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  const match = path.match(/^\/reports\/(demo-report-[\w-]+)(\/comments)?$/);
  if (method === "POST" && path === "/reports") {
    if (!payload.title?.trim()) throw new Error("请填写标题");
    const now = new Date().toISOString();
    const report: Report = {
      id: `demo-report-${crypto.randomUUID()}`,
      team_id: "demo-team",
      source_id: payload.source_id,
      author_id: "demo-alice",
      title: payload.title,
      body: payload.body || "",
      project_id: projects.some((p) => p.id === payload.project_id)
        ? payload.project_id
        : "",
      domain: payload.domain || "",
      domains: payload.domain ? [payload.domain] : [],
      agent: payload.agent || "手动上报",
      model: "",
      status: payload.status || "progress",
      links: payload.links || [],
      mentions: payload.mentions || [],
      comments: [],
      created_at: now,
      updated_at: now,
    };
    report.links.forEach((link) => {
      if (!["http:", "https:"].includes(new URL(link.url).protocol))
        throw new Error("请使用 HTTP 或 HTTPS 链接");
    });
    const existing = reports.find(
      (r) =>
        r.source_id === payload.source_id &&
        r.author_id === demoMeta.current_user,
    );
    if (existing) report.id = existing.id;
    const prior =
      payload.operation_id &&
      demoOperations.get("report:" + payload.operation_id);
    if (prior) {
      if (prior.hash !== JSON.stringify(payload))
        throw new Error("操作标识已使用");
      return clone(prior.result);
    }
    demoReportTodos(report, payload);
    if (existing) Object.assign(existing, report);
    else reports.unshift(report);
    return clone(report);
  }
  const report = match && reports.find((r) => r.id === match[1]);
  if (report && method === "POST" && match[2]) {
    if (!payload.body?.trim()) throw new Error("请填写评论");
    const comment = {
      id: `demo-comment-${crypto.randomUUID()}`,
      report_id: report.id,
      author_id: "demo-alice",
      body: payload.body,
      created_at: new Date().toISOString(),
    };
    report.comments.push(comment);
    report.updated_at = comment.created_at;
    return clone(comment);
  }
  if (report && (method === "PUT" || method === "PATCH") && !match[2]) {
    if (report.author_id !== "demo-alice")
      throw new Error("只能编辑自己的演示简报");
    const fields =
      method === "PATCH"
        ? ["status"]
        : [
            "title",
            "body",
            "project_id",
            "domain",
            "status",
            "links",
            "mentions",
          ];
    const next = clone(report);
    for (const key of fields)
      if (payload[key] !== undefined)
        Object.assign(next, {
          [key]: payload[key],
        });
    next.links.forEach((link) => {
      if (!["http:", "https:"].includes(new URL(link.url).protocol))
        throw new Error("请使用 HTTP 或 HTTPS 链接");
    });
    next.domains = next.domain ? [next.domain] : [];
    next.updated_at = new Date().toISOString();
    demoReportTodos(next, payload);
    Object.assign(report, next);
    return clone(report);
  }
  throw new Error("公开演示不连接真实服务，请在自有实例中使用此功能。");
}

// Offline Todo state belongs only to this module instance; never persisted or sent to a backend.
let todoBoard: TodoBoardData & {
  tasks: Todo[];
} = {
  revision: 1,
  default_done_id: "done",
  columns: [
    {
      id: "backlog",
      name: "待办",
      done: false,
      archived: false,
      revision: 1,
    },
    {
      id: "doing",
      name: "进行中",
      done: false,
      archived: false,
      revision: 1,
    },
    {
      id: "review",
      name: "待确认",
      done: false,
      archived: false,
      revision: 1,
    },
    {
      id: "done",
      name: "已完成",
      done: true,
      archived: false,
      revision: 1,
    },
  ],
  tasks: demoTasks,
};
const demoOperations = new Map<
  string,
  {
    hash: string;
    result: unknown;
  }
>();
function demoTodoChange(
  path: string,
  method: string,
  payload: Record<string, any>,
): unknown {
  const clone = <T>(v: T): T => structuredClone(v);
  const parsed = new URL(path, "https://demo.invalid"),
    id = parsed.pathname.split("/")[2],
    params = parsed.searchParams;
  const board = clone(todoBoard);
  const result = () => {
    const { tasks, ...b } = board;
    void tasks;
    return {
      ...b,
      columns: b.columns.map((c) => ({
        ...c,
        task_count: board.tasks.filter((t) => t.column_id === c.id).length,
      })),
    };
  };
  if (method === "GET") {
    if (parsed.pathname === "/todo-board") return result();
    if (id) {
      const task = board.tasks.find((t) => t.id === id);
      if (!task) throw new Error("任务不存在");
      return task;
    }
    const items = board.tasks
      .filter(
        (t) =>
          t.archived === (params.get("archived") === "true") &&
          (!params.get("column") || t.column_id === params.get("column")) &&
          (!params.get("project") || t.project_id === params.get("project")) &&
          (!params.get("domain") ||
            t.domains.includes(params.get("domain")!)) &&
          (!params.get("assignee") ||
            t.assignee_id === params.get("assignee")) &&
          (!params.get("q") ||
            (t.title + " " + t.body)
              .toLowerCase()
              .includes(params.get("q")!.toLowerCase())) &&
          (params.get("scope") !== "todo" ||
            (t.assignee_id === demoMeta.current_user && !t.completed_at)) &&
          (params.get("scope") !== "related" ||
            t.creator_id === demoMeta.current_user ||
            t.assignee_id === demoMeta.current_user ||
            t.comments.some(
              (c) =>
                !c.deleted &&
                (c.author_id === demoMeta.current_user ||
                  c.mentions.includes(demoMeta.current_user)),
            )),
      )
      .sort(
        (a, b) =>
          a.column_id.localeCompare(b.column_id) || a.position - b.position,
      );
    const start = params.get("cursor")
        ? items.findIndex((t) => t.id === params.get("cursor")) + 1
        : 0,
      limit = Number(params.get("limit")) || 100,
      end = Math.min(start + limit, items.length);
    return {
      items: items.slice(start, end).map((t) => ({
        ...t,
        history: [],
        comments: [],
      })),
      total: items.length,
      next_cursor: end < items.length ? items[end - 1].id : "",
    };
  }
  const hash = JSON.stringify({
      path,
      method,
      payload,
    }),
    op = payload.operation_id;
  if (!op) throw new Error("请提供 operation_id");
  const prev = demoOperations.get(op);
  if (prev) {
    if (prev.hash !== hash) throw new Error("操作标识已使用");
    return clone(prev.result);
  }
  const now = new Date().toISOString();
  const event = (t: Todo, before: Partial<Todo>, action: string) => {
    const snapshot = (v: Partial<Todo>) => ({
      ...v,
      history: undefined,
      comments: undefined,
    });
    t.revision++;
    t.updated_at = now;
    t.history.push({
      id: crypto.randomUUID(),
      actor_id: demoMeta.current_user,
      agent: "",
      model: "",
      action,
      created_at: now,
      before: snapshot(before),
      after: snapshot(t),
    });
  };
  const move = (t: Todo, col: string) => {
    const c = board.columns.find((c) => c.id === col && !c.archived);
    if (!c) throw new Error("请选择有效任务列");
    if (
      t.column_id !== col &&
      !board.columns.find((c) => c.id === t.column_id)?.done
    )
      t.previous_column_id = t.column_id;
    t.column_id = col;
    t.completed_at = c.done ? t.completed_at || now : null;
    const ts = board.tasks
      .filter((x) => x.column_id === col && x.id !== t.id)
      .sort((a, b) => a.position - b.position);
    const anchor = payload.before_id || payload.after_id;
    let idx = ts.length;
    if (anchor) {
      idx = ts.findIndex((x) => x.id === anchor);
      if (idx < 0) throw new Error("任务或看板已更新，请刷新后重试");
      if (payload.after_id) idx++;
    }
    ts.splice(idx, 0, t);
    ts.forEach((x, i) => (x.position = i + 1));
  };
  let output: unknown;
  if (parsed.pathname.startsWith("/todo-columns")) {
    if (payload.board_revision !== board.revision)
      throw new Error("任务或看板已更新，请刷新后重试");
    if (payload.action === "order") {
      if (
        payload.ids.length !== board.columns.length ||
        new Set(payload.ids).size !== board.columns.length
      )
        throw new Error("列顺序无效");
      board.columns = payload.ids.map((cid: string) => {
        const c = board.columns.find((c) => c.id === cid);
        if (!c) throw new Error("列顺序无效");
        return c;
      });
    } else if (!id) {
      if (!payload.name?.trim()) throw new Error("列名称无效");
      board.columns.push({
        id: crypto.randomUUID(),
        name: payload.name,
        done: !!payload.done,
        archived: false,
        revision: 1,
      });
    } else {
      const c = board.columns.find((c) => c.id === id);
      if (!c) throw new Error("列不存在");
      if (payload.action === "default") {
        if (!c.done || c.archived) throw new Error("请选择完成列");
        board.default_done_id = id;
      } else {
        if (payload.expected_revision !== c.revision)
          throw new Error("任务或看板已更新，请刷新后重试");
        if (payload.action === "archive") {
          if (id === board.default_done_id)
            throw new Error("请先设置另一个默认完成列");
          const tasks = board.tasks
            .filter((t) => t.column_id === id)
            .sort((a, b) => a.position - b.position);
          for (const t of tasks) {
            const before = clone(t);
            move(t, payload.target_id);
            event(t, before, "column-migration");
          }
          c.archived = true;
        } else if (payload.action === "restore") c.archived = false;
        else {
          if (!payload.name?.trim()) throw new Error("列名称无效");
          if (id === board.default_done_id && !payload.done)
            throw new Error("请先设置另一个默认完成列");
          c.name = payload.name;
          if (c.done !== payload.done) {
            c.done = payload.done;
            for (const t of board.tasks.filter((t) => t.column_id === id)) {
              const before = clone(t);
              t.completed_at = c.done ? now : null;
              event(t, before, "column-completion");
            }
          }
        }
        c.revision++;
      }
    }
    if (
      !board.columns.some((c) => !c.archived && c.done) ||
      !board.columns.some((c) => !c.archived && !c.done)
    )
      throw new Error("至少保留一个未完成列和一个完成列");
    board.revision++;
    output = result();
  } else {
    let task = board.tasks.find((t) => t.id === id);
    if (!id) {
      const existing = board.tasks.find(
        (t) =>
          t.source_id === payload.source_id &&
          t.creator_id === demoMeta.current_user,
      );
      if (existing) {
        demoOperations.set(op, { hash, result: clone(existing) });
        return clone(existing);
      }
      if (!payload.source_id) throw new Error("请提供 source_id");
      task = {
        id: crypto.randomUUID(),
        source_id: payload.source_id,
        creator_id: demoMeta.current_user,
        title: payload.title || "",
        body: payload.body || "",
        column_id: payload.column_id,
        previous_column_id: "",
        assignee_id: payload.assignee_id || "",
        project_id: payload.project_id || "",
        domains: payload.domains || [],
        priority: payload.priority || "none",
        due_date: payload.due_date || "",
        links: payload.links || [],
        report_ids: payload.report_ids || [],
        collaboration_id: "",
        agent: "",
        model: "",
        revision: 0,
        archived: false,
        position: 0,
        completed_at: null,
        created_at: now,
        updated_at: now,
        comments: [],
        history: [],
      };
      board.tasks.push(task);
      move(task, task.column_id);
      event(task, {}, "created");
      board.revision++;
    } else {
      if (!task) throw new Error("任务不存在");
      if (task.revision !== payload.expected_revision)
        throw new Error("任务或看板已更新，请刷新后重试");
      const before = clone(task);
      switch (payload.action) {
        case "move":
        case "complete":
        case "reopen":
          if (payload.board_revision !== board.revision)
            throw new Error("任务或看板已更新，请刷新后重试");
          move(
            task,
            payload.action === "complete"
              ? board.default_done_id
              : payload.action === "reopen"
                ? task.previous_column_id ||
                  board.columns.find((c) => !c.done && !c.archived)!.id
                : payload.column_id,
          );
          board.revision++;
          break;
        case "archive":
          task.archived = true;
          break;
        case "restore":
          task.archived = false;
          break;
        case "comment":
          if (!payload.body?.trim()) throw new Error("评论长度无效");
          task.comments.push({
            id: crypto.randomUUID(),
            author_id: demoMeta.current_user,
            body: payload.body,
            mentions: payload.mentions || [],
            created_at: now,
            deleted: false,
          });
          break;
        case "delete-comment":
        case "restore-comment": {
          const c = task.comments.find((c) => c.id === payload.comment_id);
          if (!c) throw new Error("评论不存在");
          c.deleted = payload.action === "delete-comment";
          break;
        }
        default:
          for (const key of [
            "title",
            "body",
            "assignee_id",
            "project_id",
            "domains",
            "priority",
            "due_date",
            "links",
          ] as const)
            if (payload[key] !== undefined)
              Object.assign(task, {
                [key]: payload[key],
              });
      }
      event(task, before, payload.action || "edit");
    }
    if (!task.title.trim()) throw new Error("请填写标题");
    if (!["none", "low", "medium", "high"].includes(task.priority))
      throw new Error("优先级无效");
    if (task.links.length > 20) throw new Error("最多 20 个交付链接");
    for (const l of task.links)
      if (!["http:", "https:"].includes(new URL(l.url).protocol))
        throw new Error("请使用 HTTP 或 HTTPS 链接");
    output = task;
  }
  todoBoard = board;
  demoOperations.set(op, {
    hash,
    result: clone(output),
  });
  return clone(output);
}
function demoReportTodos(report: Report, payload: Record<string, any>) {
  const tasks = structuredClone(todoBoard.tasks);
  const ids: string[] | undefined = payload.todo_ids;
  if (!ids) return;
  for (const id of ids)
    if (!tasks.some((t) => t.id === id)) throw new Error("任务不存在");
  for (const m of payload.todo_moves || []) {
    const t = tasks.find((t) => t.id === m.id);
    if (!t || !ids.includes(m.id) || t.revision !== m.expected_revision)
      throw new Error("任务或看板已更新，请刷新后重试");
    if (!todoBoard.columns.some((c) => c.id === m.column_id && !c.archived))
      throw new Error("请选择有效任务列");
  }
  const op = payload.operation_id,
    hash = JSON.stringify(payload),
    prev = op && demoOperations.get("report:" + op);
  if (prev) {
    if (prev.hash !== hash) throw new Error("操作标识已使用");
    return;
  }
  for (const t of tasks) {
    const before = structuredClone(t);
    const had = t.report_ids.includes(report.id),
      want = ids.includes(t.id);
    t.report_ids = t.report_ids.filter((id) => id !== report.id);
    if (want) t.report_ids.push(report.id);
    const m = (payload.todo_moves || []).find(
      (m: { id: string }) => m.id === t.id,
    );
    if (m) {
      if (!todoBoard.columns.find((c) => c.id === t.column_id)?.done)
        t.previous_column_id = t.column_id;
      t.column_id = m.column_id;
      t.position =
        1 +
        Math.max(
          0,
          ...tasks
            .filter((x) => x.column_id === m.column_id)
            .map((x) => x.position),
        );
      t.completed_at = todoBoard.columns.find((c) => c.id === m.column_id)?.done
        ? new Date().toISOString()
        : null;
      todoBoard.revision++;
    }
    if (had !== want || m) {
      t.revision++;
      t.updated_at = new Date().toISOString();
      t.history.push({
        id: crypto.randomUUID(),
        actor_id: demoMeta.current_user,
        agent: "",
        model: "",
        action: m ? "report-move" : "report-link",
        created_at: t.updated_at,
        before: {
          ...before,
          history: undefined,
          comments: undefined,
        },
        after: {
          ...t,
          history: undefined,
          comments: undefined,
        },
      });
    }
  }
  todoBoard.tasks = tasks;
  report.todo_ids = ids;
  if (op)
    demoOperations.set("report:" + op, {
      hash,
      result: report,
    });
}
