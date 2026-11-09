export const graphKinds = {
  context: { label: "知识", color: "#08775c" },
  project: { label: "项目", color: "#4b67c8" },
  domain: { label: "领域", color: "#9c62b6" },
  report: { label: "进度", color: "#c2872b" },
  todo: { label: "Todo", color: "#3396aa" },
  calendar: { label: "Calendar", color: "#c57081" },
} as const;
export type GraphKind = keyof typeof graphKinds;
export type KnowledgeGraphNode = {
  key: string;
  id: string;
  kind: GraphKind;
  title: string;
  url: string;
  state?: string;
  needs_review?: boolean;
  root: boolean;
};
export type KnowledgeGraphEdge = { from: string; to: string; kind: string };
export type KnowledgeGraph = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  total_contexts: number;
  shown_contexts: number;
  truncated: boolean;
};
export type GraphPoint = { x: number; y: number };
export const graphEdgeLabels: Record<string, string> = {
  project: "所属项目",
  domain: "所属领域",
  source: "引用来源",
  parent: "上级文档",
  todo_report: "交付进度",
  calendar_todo: "关联任务",
  calendar_report: "关联进度",
};
const hash = (s: string) => {
  let n = 2166136261;
  for (const c of s) {
    n ^= c.codePointAt(0)!;
    n = Math.imul(n, 16777619);
  }
  return n >>> 0;
};
/** Deterministic, bounded layout. No network, physics timer or invented relationships. */
export function layoutKnowledgeGraph(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
): Record<string, GraphPoint> {
  const centers: Record<GraphKind, GraphPoint> = {
    context: { x: 600, y: 400 },
    project: { x: 260, y: 190 },
    domain: { x: 950, y: 200 },
    report: { x: 980, y: 590 },
    todo: { x: 250, y: 610 },
    calendar: { x: 620, y: 670 },
  };
  const sorted = [...nodes].sort((a, b) => a.key.localeCompare(b.key));
  const points = sorted.map((n) => {
    const seed = hash(n.key),
      a = (seed % 6283) / 1000,
      r = 35 + (seed % 150),
      c = centers[n.kind] || centers.context;
    return {
      key: n.key,
      x: c.x + Math.cos(a) * r,
      y: c.y + Math.sin(a) * r,
      dx: 0,
      dy: 0,
    };
  });
  const index = new Map(points.map((p, i) => [p.key, i]));
  const links = edges
    .map((e) => [index.get(e.from), index.get(e.to)])
    .filter(
      (e): e is [number, number] => e[0] !== undefined && e[1] !== undefined,
    )
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const steps = points.length > 250 ? 24 : 60;
  for (let step = 0; step < steps; step++) {
    for (const p of points) {
      p.dx = (600 - p.x) * 0.0015;
      p.dy = (400 - p.y) * 0.0015;
    }
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i],
          b = points[j];
        let dx = a.x - b.x,
          dy = a.y - b.y;
        const d2 = Math.max(40, dx * dx + dy * dy);
        const f = Math.min(10, 65000 / d2);
        const d = Math.sqrt(d2);
        dx = (dx / d) * f;
        dy = (dy / d) * f;
        a.dx += dx;
        a.dy += dy;
        b.dx -= dx;
        b.dy -= dy;
      }
    for (const [i, j] of links) {
      const a = points[i],
        b = points[j],
        dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.max(1, Math.hypot(dx, dy)),
        f = (d - 190) * 0.012;
      a.dx += (dx / d) * f;
      a.dy += (dy / d) * f;
      b.dx -= (dx / d) * f;
      b.dy -= (dy / d) * f;
    }
    for (const p of points) {
      p.x = Math.max(45, Math.min(1155, p.x + Math.max(-9, Math.min(9, p.dx))));
      p.y = Math.max(45, Math.min(755, p.y + Math.max(-9, Math.min(9, p.dy))));
    }
  }
  return Object.fromEntries(points.map((p) => [p.key, { x: p.x, y: p.y }]));
}
export function visibleKnowledgeGraph(
  data: KnowledgeGraph,
  types: Set<GraphKind>,
) {
  const nodes = data.nodes.filter((n) => types.has(n.kind)),
    ids = new Set(nodes.map((n) => n.key));
  return {
    nodes,
    edges: data.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

export function graphRelationLabel(edge: KnowledgeGraphEdge, selected: string) {
  if (edge.from === selected) return graphEdgeLabels[edge.kind] || edge.kind;
  return (
    (
      {
        project: "项目内容",
        domain: "领域内容",
        source: "被知识引用",
        parent: "子文档",
        todo_report: "关联任务",
        calendar_todo: "关联日历",
        calendar_report: "关联日历",
      } as Record<string, string>
    )[edge.kind] || edge.kind
  );
}
