import { demoContextGraph } from "./context-graph-demo.ts";
import { blankContext } from "./context.ts";
import type { ContextEntry, Delegation } from "./context";
import type { Meta } from "./types";
// Synthetic in-memory demo only; never performs network or provider requests.
const entries: ContextEntry[] = [
  {
    id: "demo-context-1",
    source_id: "synthetic-decision",
    creator_id: "demo-alice",
    title: "发布前保留验收依据",
    body: "重要交付先关联 Todo 与进度记录，由指定验收人确认后完成。",
    kind: "rule",
    visibility: "team",
    project_id: "demo-launch",
    domains: ["产品"],
    state: "active",
    valid_from: "",
    valid_until: "",
    review_on: "",
    superseded_by: "",
    sources: [],
    revision: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    needs_review: false,
    history: [],
  },
];
// Synthetic introductions illustrate structure, never real team knowledge.
for (const doc of [
  {
    id: "demo-wiki-project",
    title: "协作交付 · 项目介绍",
    project_id: "demo-launch",
    domains: ["产品"],
    parent_id: "",
    body: "# 协作交付\n\n## 项目目标\n展示多人、多 Agent 如何共同交付。\n\n## 工作方式\nTodo 管理行动，Timeline 保留进度，Calendar 安排时间，Context 沉淀知识。\n\n## 导航\n- [交付规则](/context?context=demo-context-1)\n- [验收指南](/context?context=demo-wiki-guide)",
  },
  {
    id: "demo-wiki-guide",
    title: "验收指南",
    project_id: "demo-launch",
    domains: ["产品"],
    parent_id: "demo-wiki-project",
    body: "# 验收指南\n\n1. 任务关联交付依据。\n2. 指定验收人核对结果。\n3. 决定与长期规则沉淀到 Context。\n\n这是合成演示文档。",
  },
  {
    id: "demo-wiki-domain",
    title: "产品 · 领域介绍",
    project_id: "",
    domains: ["产品"],
    parent_id: "",
    body: "# 产品领域\n\n## 范围\n整理目标、使用方案与验收规则。\n\n## 协作约定\n区分待确认想法和已确认决定，重要结论保留来源。\n\n这是合成演示文档。",
  },
])
  entries.push({
    ...blankContext(),
    ...doc,
    kind: "document",
    creator_id: "demo-alice",
    state: "active",
    revision: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    history: [],
  });
entries[0].parent_id = "demo-wiki-project";
entries.find((x) => x.id === "demo-wiki-guide")!.sources = [
  {
    kind: "todo",
    id: "demo-todo-1",
    revision: "",
    quote: "Synthetic delivery task",
  },
  {
    kind: "report",
    id: "demo-report-1",
    revision: "",
    quote: "Synthetic progress evidence",
  },
  {
    kind: "calendar",
    id: "demo-event-1",
    revision: "",
    quote: "Synthetic acceptance schedule",
  },
];
const delegations: Delegation[] = [];
const replay = new Map<string, { input: string; value: unknown }>();
export async function knowledgeDemo(
  path: string,
  method: string,
  body: Record<string, any>,
  meta: Meta,
  resolve: (path: string) => Promise<unknown>,
) {
  const url = new URL(path, "https://example.invalid"),
    id = url.pathname.split("/")[2] || "",
    params = url.searchParams,
    isContext = url.pathname.startsWith("/context");
  const clone = <T>(v: T): T => structuredClone(v);
  async function currentSource(
    source: { kind: string; id: string },
    seen = new Set<string>(),
  ): Promise<{
    revision?: number;
    updated_at?: string;
    archived?: boolean;
    needs_review?: boolean;
  }> {
    if (source.kind !== "context")
      return resolve(
        (source.kind === "todo"
          ? "/todos/"
          : source.kind === "report"
            ? "/reports/"
            : "/calendar/events/") + source.id,
      ) as Promise<{
        revision?: number;
        updated_at?: string;
        archived?: boolean;
      }>;
    const v = entries.find(
      (x) =>
        x.id === source.id &&
        (x.visibility === "team" || x.creator_id === meta.current_user),
    );
    if (!v || seen.has(v.id) || seen.size >= 12) throw Error("Context 不可用");
    const next = new Set(seen);
    next.add(v.id);
    let stale =
      v.state !== "active" ||
      (!!v.valid_from &&
        v.valid_from > new Date().toISOString().slice(0, 10)) ||
      (!!v.review_on && v.review_on <= new Date().toISOString().slice(0, 10)) ||
      (!!v.valid_until &&
        v.valid_until < new Date().toISOString().slice(0, 10));
    for (const ref of v.sources) {
      const current = await currentSource(ref, next);
      stale =
        stale ||
        !!current.archived ||
        !!current.needs_review ||
        (!!ref.revision &&
          ref.revision !== String(current.revision || current.updated_at));
    }
    return {
      revision: v.revision,
      archived: v.state === "archived",
      needs_review: stale,
    };
  }
  let list = entries
    .filter(
      (x) => x.visibility === "team" || x.creator_id === meta.current_user,
    )
    .map((x) => ({
      ...clone(x),
      state:
        x.state === "active" &&
        x.valid_until &&
        x.valid_until < new Date().toISOString().slice(0, 10)
          ? "expired"
          : x.state,
    }));

  list = (
    await Promise.all(
      list.map(async (x) => {
        try {
          for (const source of x.sources) {
            const current = await currentSource(source);
            source.changed =
              !!source.revision &&
              source.revision !==
                String(current.revision || current.updated_at);
            source.archived = !!current.archived || !!current.needs_review;
            x.needs_review =
              x.needs_review || source.changed || source.archived;
          }
          x.needs_review =
            x.needs_review ||
            (!!x.review_on &&
              x.review_on <= new Date().toISOString().slice(0, 10));
          return x;
        } catch {
          return null;
        }
      }),
    )
  ).filter((x): x is ContextEntry => x !== null);
  if (method === "GET") {
    if (!isContext) return { items: clone(delegations) };
    if (url.pathname === "/context-graph") {
      const selected = list.filter(
        (x) =>
          (!params.get("project") || x.project_id === params.get("project")) &&
          (!params.get("domain") ||
            x.domains.includes(params.get("domain")!)) &&
          (!params.get("member") || x.creator_id === params.get("member")) &&
          (!params.get("state")
            ? x.state !== "archived"
            : x.state === params.get("state")) &&
          (!params.get("kind") || x.kind === params.get("kind")) &&
          (!params.get("source") ||
            x.sources.some((s) => s.kind === params.get("source"))) &&
          (!params.get("q") ||
            (x.title + " " + x.body)
              .toLowerCase()
              .includes(params.get("q")!.toLowerCase())),
      );
      return demoContextGraph(selected, meta, resolve);
    }
    if (url.pathname === "/context-tree") {
      const xs = list.filter(
        (x) =>
          (!params.get("project") || x.project_id === params.get("project")) &&
          (!params.get("domain") ||
            x.domains.includes(params.get("domain")!)) &&
          (!params.get("member") || x.creator_id === params.get("member")) &&
          (!params.get("state") || x.state === params.get("state")) &&
          (!params.get("kind") || x.kind === params.get("kind")) &&
          (!params.get("source") ||
            x.sources.some((s) => s.kind === params.get("source"))) &&
          (!params.get("q") ||
            (x.title + " " + x.body)
              .toLowerCase()
              .includes(params.get("q")!.toLowerCase())),
      );
      const ids = new Set(xs.map((x) => x.id));
      return {
        items: xs.map((x) => ({
          id: x.id,
          reference_ids: x.sources
            .filter((s) => s.kind === "context")
            .map((s) => s.id),
          parent_id: ids.has(x.parent_id || "") ? x.parent_id : "",
          title: x.title,
          kind: x.kind,
          state: x.state,
          visibility: x.visibility,
          project_id: x.project_id,
          domains: x.domains,
          creator_id: x.creator_id,
          revision: x.revision,
          needs_review: x.needs_review,
          updated_at: x.updated_at,
        })),
        total: xs.length,
      };
    }
    if (id) {
      const v = list.find((x) => x.id === id);
      if (!v) throw Error("Context 不可用");
      return v;
    }
    const xs = list.filter(
      (x) =>
        (!params.get("project") || x.project_id === params.get("project")) &&
        (!params.get("domain") || x.domains.includes(params.get("domain")!)) &&
        (!params.get("member") || x.creator_id === params.get("member")) &&
        (!params.get("state") || x.state === params.get("state")) &&
        (!params.get("kind") || x.kind === params.get("kind")) &&
        (!params.get("source") ||
          x.sources.some((s) => s.kind === params.get("source"))) &&
        (!params.get("q") ||
          (x.title + " " + x.body)
            .toLowerCase()
            .includes(params.get("q")!.toLowerCase())),
    );
    const offset = Math.max(0, Number(params.get("offset")) || 0),
      limit = Math.min(100, Number(params.get("limit")) || 40);
    return {
      items: xs.slice(offset, offset + limit),
      total: xs.length,
      next_offset: offset + limit,
    };
  }
  if (!body.operation_id) throw Error("请提供 operation_id");
  const serialized = JSON.stringify({ path, body });
  const prior = replay.get(body.operation_id);
  if (prior) {
    if (prior.input !== serialized) throw Error("操作冲突");
    return clone(prior.value);
  }
  let result: unknown;
  if (isContext) {
    if (!id && body.source_id) {
      const prior = entries.find(
        (x) =>
          x.creator_id === meta.current_user && x.source_id === body.source_id,
      );
      if (prior) {
        const keys = [
          "parent_id",
          "title",
          "body",
          "kind",
          "visibility",
          "project_id",
          "domains",
          "valid_from",
          "valid_until",
          "review_on",
        ];
        if (
          keys.some(
            (k) =>
              JSON.stringify(
                prior[k as keyof ContextEntry] ??
                  (k === "parent_id" ? "" : undefined),
              ) !==
              JSON.stringify(body[k] ?? (k === "parent_id" ? "" : undefined)),
          )
        )
          throw Error("Context 已变化，请重新读取");
        const result = clone(prior);
        replay.set(body.operation_id, { input: serialized, value: result });
        return result;
      }
    }
    const old = entries.find((x) => x.id === id);
    if (id && (!old || old.revision !== body.expected_revision))
      throw Error("Context 已变化，请重新读取");
    const value: ContextEntry = clone(
      old || {
        ...blankContext(),
        ...body,
        id: crypto.randomUUID(),
        creator_id: meta.current_user,
        revision: 0,
        created_at: new Date().toISOString(),
        history: [],
      },
    );
    if (body.action === "archive") value.state = "archived";
    else if (body.action === "restore") value.state = "pending";
    else if (body.action === "merge") {
      const target = entries.find((x) => x.id === body.superseded_by);
      if (
        !target ||
        target.id === id ||
        target.revision !== body.target_revision ||
        target.visibility !== value.visibility
      )
        throw Error("合并目标无效");
      target.sources = [
        ...target.sources,
        ...value.sources.filter(
          (s) =>
            !target.sources.some((t) => s.id === t.id && s.kind === t.kind),
        ),
      ];
      target.revision++;
      value.state = "archived";
      value.superseded_by = target.id;
    } else {
      if (!body.title?.trim() || !body.body?.trim())
        throw Error("标题与内容不能为空");
      Object.assign(value, clone(body), {
        id: value.id,
        creator_id: value.creator_id,
        revision: value.revision,
        history: value.history,
        created_at: value.created_at,
      });
      if (body.action === "confirm") value.state = "active";
      if (
        body.action === "review" &&
        value.review_on &&
        value.review_on <= new Date().toISOString().slice(0, 10)
      )
        value.review_on = "";
      for (const source of value.sources) {
        const current = await currentSource(source);
        const revision = String(current.revision || current.updated_at);
        if (
          source.revision &&
          source.revision !== revision &&
          body.action !== "review"
        )
          throw Error("来源变化，请复核");
        source.revision = revision;
        source.url =
          source.kind === "todo"
            ? "/todo?todo=" + source.id
            : source.kind === "report"
              ? "/?report=" + source.id
              : source.kind === "context"
                ? "/context?context=" + source.id
                : "/calendar?event=" + source.id;
      }
    }
    if (value.parent_id) {
      const parent = entries.find((x) => x.id === value.parent_id);
      if (
        !parent ||
        !["document", "index"].includes(parent.kind) ||
        parent.state === "archived" ||
        parent.project_id !== value.project_id ||
        parent.visibility !== value.visibility ||
        (value.visibility === "personal" &&
          parent.creator_id !== value.creator_id)
      )
        throw Error("目录与文档范围不一致");
      const seen = new Set([value.id]);
      let node: ContextEntry | undefined = parent;
      while (node) {
        if (seen.has(node.id) || seen.size >= 12)
          throw Error("目录不可循环或超过 12 层");
        seen.add(node.id);
        node = entries.find((x) => x.id === node!.parent_id);
      }
    }
    const walk = (x: ContextEntry, seen: Set<string>) => {
      if (seen.has(x.id) || seen.size >= 12)
        throw Error("Context 引用不可循环或超过 12 层");
      const next = new Set(seen);
      next.add(x.id);
      for (const source of x.sources) {
        if (source.kind === "context") {
          const target =
            source.id === value.id
              ? value
              : entries.find((x) => x.id === source.id);
          if (!target) throw Error("Context 不可用");
          if (value.visibility === "team" && target.visibility !== "team")
            throw Error("团队文档不可引用个人 Context");
          walk(target, next);
        }
      }
    };
    walk(value, new Set());
    value.revision++;
    value.updated_at = new Date().toISOString();
    value.history = [
      ...(value.history || []),
      {
        revision: value.revision,
        actor_id: meta.current_user,
        action: body.action || "edit",
        at: value.updated_at,
        title: value.title,
        body: value.body,
      },
    ];
    if (old) entries[entries.indexOf(old)] = value;
    else entries.push(value);
    result = value;
  } else if (id) {
    const d = delegations.find((x) => x.id === id);
    if (!d || d.revision !== body.expected_revision || body.action !== "revoke")
      throw Error("委托已变化");
    d.revoked_at = new Date().toISOString();
    d.revision++;
    result = d;
  } else {
    if (
      !body.member_id ||
      (!body.todo_id && !body.project_id) ||
      !body.actions?.length ||
      Date.parse(body.expires_at) <= Date.now()
    )
      throw Error("委托范围无效");
    const d = {
      ...body,
      id: crypto.randomUUID(),
      grantor_id: meta.current_user,
      revision: 1,
    } as Delegation;
    delegations.push(d);
    result = d;
  }
  replay.set(body.operation_id, { input: serialized, value: clone(result) });
  return clone(result);
}
