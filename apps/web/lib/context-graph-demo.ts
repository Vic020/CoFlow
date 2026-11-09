import type { ContextEntry } from "./context";
import type { Meta } from "./types";
import type {
  KnowledgeGraph,
  KnowledgeGraphNode,
  GraphKind,
} from "./context-graph";
export async function demoContextGraph(
  entries: ContextEntry[],
  meta: Meta,
  resolve: (path: string) => Promise<unknown>,
): Promise<KnowledgeGraph> {
  const data: KnowledgeGraph = {
    nodes: [],
    edges: [],
    total_contexts: entries.length,
    shown_contexts: Math.min(entries.length, 120),
    truncated: entries.length > 120,
  };
  const nodes = new Map<string, KnowledgeGraphNode>(),
    edges = new Set<string>(),
    objects = new Map<string, any>();
  function add(node: KnowledgeGraphNode) {
    if (nodes.has(node.key)) {
      nodes.get(node.key)!.root ||= node.root;
      return true;
    }
    if (nodes.size >= 600) {
      data.truncated = true;
      return false;
    }
    nodes.set(node.key, node);
    return true;
  }
  function edge(from: string, to: string, kind: string) {
    const k = JSON.stringify([from, to, kind]);
    if (
      !from ||
      !to ||
      !nodes.has(from) ||
      !nodes.has(to) ||
      from === to ||
      edges.has(k)
    )
      return;
    if (data.edges.length >= 2400) {
      data.truncated = true;
      return;
    }
    edges.add(k);
    data.edges.push({ from, to, kind });
  }
  function classify(key: string, project: string, domains: string[]) {
    if (project) {
      const k = "project:" + project;
      add({
        key: k,
        id: project,
        kind: "project",
        title: meta.projects.find((p) => p.id === project)?.name || project,
        url:
          "/context?knowledge_view=graph&filters=1&project=" +
          encodeURIComponent(project),
        root: false,
      });
      edge(key, k, "project");
    }
    for (const domain of domains || []) {
      if (!domain) continue;
      const k = "domain:" + domain;
      add({
        key: k,
        id: domain,
        kind: "domain",
        title: domain,
        url:
          "/context?knowledge_view=graph&filters=1&domain=" +
          encodeURIComponent(domain),
        root: false,
      });
      edge(key, k, "domain");
    }
  }
  async function entity(kind: GraphKind, id: string) {
    const key = kind + ":" + id;
    if (nodes.has(key)) return key;
    try {
      const item = (await resolve(
        (kind === "context"
          ? "/context/"
          : kind === "todo"
            ? "/todos/"
            : kind === "report"
              ? "/reports/"
              : "/calendar/events/") + encodeURIComponent(id),
      )) as any;
      if (
        !add({
          key,
          id,
          kind,
          title: item.title,
          url:
            (kind === "context"
              ? "/context?context="
              : kind === "todo"
                ? "/todo?todo="
                : kind === "report"
                  ? "/?report="
                  : "/calendar?event=") + encodeURIComponent(id),
          root: false,
          state: item.state || item.status,
          needs_review: item.needs_review,
        })
      )
        return "";
      objects.set(key, item);
      classify(key, item.project_id, [
        ...(item.domains || []),
        item.domain || "",
      ]);
      return key;
    } catch {
      return "";
    }
  }
  const roots = entries.slice(0, 120);
  for (const x of roots)
    add({
      key: "context:" + x.id,
      id: x.id,
      kind: "context",
      title: x.title,
      url: "/context?context=" + encodeURIComponent(x.id),
      root: true,
      state: x.state,
      needs_review: x.needs_review,
    });
  for (const x of roots) {
    const key = "context:" + x.id;
    classify(key, x.project_id, x.domains);
    if (x.parent_id) edge(key, await entity("context", x.parent_id), "parent");
    for (const ref of x.sources)
      edge(key, await entity(ref.kind, ref.id), "source");
  }
  for (const node of [...nodes.values()]) {
    const v = objects.get(node.key);
    if (!v) continue;
    if (node.kind === "todo")
      for (const id of v.report_ids || [])
        edge(node.key, await entity("report", id), "todo_report");
    if (node.kind === "report")
      for (const id of v.todo_ids || [])
        edge(await entity("todo", id), node.key, "todo_report");
    if (node.kind === "calendar") {
      for (const id of v.todo_ids || [])
        edge(node.key, await entity("todo", id), "calendar_todo");
      for (const id of v.report_ids || [])
        edge(node.key, await entity("report", id), "calendar_report");
    }
  }
  data.nodes = [...nodes.values()];
  return data;
}
