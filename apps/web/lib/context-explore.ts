import type { ContextNode } from "./context";
import type { Meta } from "./types";
export type ExploreTopic = {
  key: string;
  title: string;
  kind: "project" | "domain" | "team";
  project: string;
  domain: string;
  nodes: ContextNode[];
  matches: Set<string>;
};
export function exploreTopics(
  nodes: ContextNode[],
  meta: Meta,
  matchingIDs: string[] | null = null,
): ExploreTopic[] {
  const all = new Map(nodes.map((n) => [n.id, n]));
  const matches = new Set(
    matchingIDs === null
      ? nodes.filter((n) => n.state !== "archived").map((n) => n.id)
      : matchingIDs.filter((id) => all.has(id)),
  );
  const keep = new Set(matches);
  for (const id of matches) {
    let n = all.get(id);
    const seen = new Set<string>();
    while (
      n?.parent_id &&
      all.has(n.parent_id) &&
      !seen.has(n.parent_id) &&
      seen.size < 12
    ) {
      seen.add(n.parent_id);
      keep.add(n.parent_id);
      n = all.get(n.parent_id);
    }
  }
  const relevant = nodes.filter((n) => keep.has(n.id));
  const topics: ExploreTopic[] = [];
  for (const project of meta.projects) {
    const xs = relevant.filter((n) => n.project_id === project.id);
    if (xs.some((n) => matches.has(n.id)))
      topics.push({
        key: "project:" + project.id,
        title: project.name,
        kind: "project",
        project: project.id,
        domain: "",
        nodes: xs,
        matches: new Set(xs.filter((n) => matches.has(n.id)).map((n) => n.id)),
      });
  }
  // Preserve authorized entries even when a catalog item was archived or omitted from current metadata.
  for (const id of new Set(relevant.map((n) => n.project_id).filter(Boolean))) {
    if (topics.some((t) => t.project === id)) continue;
    const xs = relevant.filter((n) => n.project_id === id);
    topics.push({
      key: "project:" + id,
      title: id,
      kind: "project",
      project: id,
      domain: "",
      nodes: xs,
      matches: new Set(xs.filter((n) => matches.has(n.id)).map((n) => n.id)),
    });
  }
  for (const domain of new Set(
    relevant.filter((n) => !n.project_id).flatMap((n) => n.domains),
  )) {
    const xs = relevant.filter(
      (n) => !n.project_id && n.domains.includes(domain),
    );
    if (!xs.some((n) => matches.has(n.id))) continue;
    const ids = new Set(xs.map((n) => n.id));
    for (const id of [...ids]) {
      let n = all.get(id);
      const seen = new Set<string>();
      while (
        n?.parent_id &&
        all.has(n.parent_id) &&
        !seen.has(n.parent_id) &&
        seen.size < 12
      ) {
        seen.add(n.parent_id);
        ids.add(n.parent_id);
        n = all.get(n.parent_id);
      }
    }
    const group = nodes.filter((n) => ids.has(n.id));
    topics.push({
      key: "domain:" + domain,
      title: domain,
      kind: "domain",
      project: "",
      domain,
      nodes: group,
      matches: new Set(
        group
          .filter((n) => matches.has(n.id) && n.domains.includes(domain))
          .map((n) => n.id),
      ),
    });
  }
  const team = relevant.filter((n) => !n.project_id && !n.domains.length);
  if (team.some((n) => matches.has(n.id)))
    topics.push({
      key: "team",
      title: "",
      kind: "team",
      project: "",
      domain: "",
      nodes: team,
      matches: new Set(team.filter((n) => matches.has(n.id)).map((n) => n.id)),
    });
  return topics;
}
export function explorePath(topic: ExploreTopic, id: string): ContextNode[] {
  const all = new Map(topic.nodes.map((n) => [n.id, n]));
  const path: ContextNode[] = [];
  const seen = new Set<string>();
  let node = all.get(id);
  while (node && !seen.has(node.id) && path.length < 12) {
    path.unshift(node);
    seen.add(node.id);
    node = node.parent_id ? all.get(node.parent_id) : undefined;
  }
  return path;
}
type ExploreIndex = {
  children: Map<string, ContextNode[]>;
  counts: Map<string, number>;
};
const indexes = new WeakMap<ExploreTopic, ExploreIndex>();
function exploreIndex(topic: ExploreTopic): ExploreIndex {
  const old = indexes.get(topic);
  if (old) return old;
  const children = new Map<string, ContextNode[]>(),
    ids = new Set(topic.nodes.map((n) => n.id)),
    counts = new Map<string, number>();
  for (const n of topic.nodes) {
    const parent = n.parent_id && ids.has(n.parent_id) ? n.parent_id : "";
    const xs = children.get(parent) || [];
    xs.push(n);
    children.set(parent, xs);
  }
  function count(id: string, seen: Set<string>): number {
    if (seen.has(id) || seen.size >= 12) return 0;
    const old = counts.get(id);
    if (old !== undefined) return old;
    const next = new Set(seen).add(id);
    const size =
      1 +
      (children.get(id) || []).reduce((sum, n) => sum + count(n.id, next), 0);
    counts.set(id, size);
    return size;
  }
  for (const n of topic.nodes) count(n.id, new Set());
  const value = { children, counts };
  indexes.set(topic, value);
  return value;
}
export function exploreDescendants(
  topic: ExploreTopic,
  id: string,
): Set<string> {
  const visited = new Set<string>(),
    stack = [id],
    index = exploreIndex(topic);
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const n of index.children.get(current) || []) stack.push(n.id);
  }
  return visited;
}
export function exploreChildren(topic: ExploreTopic, id = ""): ContextNode[] {
  const index = exploreIndex(topic);
  return [...(index.children.get(id) || [])].sort(
    (a, b) =>
      (index.counts.get(b.id) || 0) - (index.counts.get(a.id) || 0) ||
      a.title.localeCompare(b.title),
  );
}
