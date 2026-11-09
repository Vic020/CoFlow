"use client";
import { contextStates } from "@/lib/context";
import { statuses } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus, X, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { useI18n } from "./i18n-provider";
import { useSharedFilters } from "./shared-filters";
import {
  graphKinds,
  graphEdgeLabels,
  graphRelationLabel,
  layoutKnowledgeGraph,
  visibleKnowledgeGraph,
  type KnowledgeGraph,
  type KnowledgeGraphNode,
  type GraphKind,
  type GraphPoint,
} from "@/lib/context-graph";

export function ContextGraphView({
  data,
  onOpen,
}: {
  data: KnowledgeGraph;
  onOpen: (id: string) => void;
}) {
  const { t: tr } = useI18n(),
    shared = useSharedFilters();
  const router = useRouter();
  const [types, setTypes] = useState(
    new Set<GraphKind>(Object.keys(graphKinds) as GraphKind[]),
  );
  const [selected, setSelected] = useState(""),
    [labels, setLabels] = useState(true),
    [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const visible = useMemo(
    () => visibleKnowledgeGraph(data, types),
    [data, types],
  );
  const layoutKey = JSON.stringify([
    visible.nodes.map((n) => [n.key, n.kind]).sort(),
    visible.edges.map((e) => [e.from, e.to, e.kind]).sort(),
  ]);
  const initial = useMemo(
    () => layoutKnowledgeGraph(visible.nodes, visible.edges),
    [layoutKey],
  );
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });
  const [moved, setMoved] = useState<Record<string, GraphPoint>>({});
  const points = useMemo(() => ({ ...initial, ...moved }), [initial, moved]);
  const svg = useRef<SVGSVGElement>(null);
  const lastClick = useRef({ key: "", at: 0 });
  const drag = useRef<{
    key?: string;
    start: GraphPoint;
    last: GraphPoint;
    moved: boolean;
  } | null>(null);
  const node = visible.nodes.find((n) => n.key === selected);
  const neighbors = useMemo(
    () =>
      new Set(
        visible.edges
          .filter((e) => e.from === selected || e.to === selected)
          .flatMap((e) => [e.from, e.to]),
      ),
    [visible.edges, selected],
  );
  const degrees = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of visible.edges) {
      map.set(e.from, (map.get(e.from) || 0) + 1);
      map.set(e.to, (map.get(e.to) || 0) + 1);
    }
    return map;
  }, [visible.edges]);
  useEffect(() => {
    setMoved({});
  }, [initial]);
  useEffect(() => {
    if (selected && !visible.nodes.some((n) => n.key === selected))
      setSelected("");
  }, [visible.nodes, selected]);
  function local(clientX: number, clientY: number) {
    const matrix = svg.current?.getScreenCTM();
    return matrix
      ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
      : { x: clientX, y: clientY };
  }
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const zoom = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      setView((v) => {
        const k = Math.max(
            0.2,
            Math.min(4, v.k * Math.exp(-e.deltaY * 0.0015)),
          ),
          ratio = k / v.k;
        return {
          k,
          x: p.x - (p.x - v.x) * ratio,
          y: p.y - (p.y - v.y) * ratio,
        };
      });
    };
    el.addEventListener("wheel", zoom, { passive: false });
    return () => el.removeEventListener("wheel", zoom);
  }, [data.nodes.length]);
  function zoom(factor: number) {
    setView((v) => {
      const k = Math.max(0.2, Math.min(4, v.k * factor)),
        ratio = k / v.k,
        cx = canvasSize.width / 2,
        cy = canvasSize.height / 2;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }
  function fit() {
    setView(fitted(points));
  }
  function fitted(values: Record<string, GraphPoint>) {
    const xs = Object.values(values);
    if (!xs.length) return { x: 0, y: 0, k: 1 };
    const minX = Math.min(...xs.map((p) => p.x)),
      maxX = Math.max(...xs.map((p) => p.x)),
      minY = Math.min(...xs.map((p) => p.y)),
      maxY = Math.max(...xs.map((p) => p.y));
    const k = Math.max(
      0.2,
      Math.min(
        2,
        (canvasSize.width - 90) / Math.max(160, maxX - minX + 80),
        (canvasSize.height - 90) / Math.max(160, maxY - minY + 80),
      ),
    );
    return {
      k,
      x: canvasSize.width / 2 - ((minX + maxX) / 2) * k,
      y: canvasSize.height / 2 - ((minY + maxY) / 2) * k,
    };
  }
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setCanvasSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setView(fitted(initial));
  }, [initial, canvasSize.width, canvasSize.height]);
  const labelKeys = useMemo(() => {
    const boxes: {
        left: number;
        right: number;
        top: number;
        bottom: number;
      }[] = [],
      keys = new Set<string>();
    const candidates = [...visible.nodes].sort(
      (a, b) =>
        (a.key === selected
          ? -1000
          : neighbors.has(a.key)
            ? -500
            : -(degrees.get(a.key) || 0)) -
        (b.key === selected
          ? -1000
          : neighbors.has(b.key)
            ? -500
            : -(degrees.get(b.key) || 0)),
    );
    for (const n of candidates) {
      if (
        !labels ||
        (visible.nodes.length >= 90 &&
          n.key !== selected &&
          !neighbors.has(n.key) &&
          (degrees.get(n.key) || 0) <= 3)
      )
        continue;
      const p = points[n.key],
        title = n.title.length > 26 ? n.title.slice(0, 25) + "…" : n.title;
      const width = [...title].reduce(
          (v, c) => v + (c.codePointAt(0)! > 255 ? 11 : 6),
          0,
        ),
        x = p.x * view.k + view.x,
        y = p.y * view.k + view.y;
      const box = {
        left: x - width / 2 - 4,
        right: x + width / 2 + 4,
        top: y + 12,
        bottom: y + 27,
      };
      if (
        n.key !== selected &&
        boxes.some(
          (b) =>
            box.left < b.right &&
            box.right > b.left &&
            box.top < b.bottom &&
            box.bottom > b.top,
        )
      )
        continue;
      boxes.push(box);
      keys.add(n.key);
    }
    return keys;
  }, [visible, points, view, selected, labels, neighbors, degrees]);
  function open(n: KnowledgeGraphNode) {
    if (n.kind === "context") onOpen(n.id);
    else if (n.kind === "project") shared.update({ project: n.id });
    else if (n.kind === "domain") shared.update({ domain: n.id });
    else router.push(shared.href(n.url));
  }
  function keyMove(e: React.KeyboardEvent, key: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelected(key);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
      return;
    e.preventDefault();
    const p = points[key];
    const candidates = visible.nodes
      .filter(
        (n) =>
          n.key !== key &&
          ((e.key === "ArrowLeft" && points[n.key].x < p.x) ||
            (e.key === "ArrowRight" && points[n.key].x > p.x) ||
            (e.key === "ArrowUp" && points[n.key].y < p.y) ||
            (e.key === "ArrowDown" && points[n.key].y > p.y)),
      )
      .sort(
        (a, b) =>
          Math.hypot(points[a.key].x - p.x, points[a.key].y - p.y) -
          Math.hypot(points[b.key].x - p.x, points[b.key].y - p.y),
      );
    if (candidates[0]) {
      setSelected(candidates[0].key);
      svg.current
        ?.querySelector<SVGGElement>(
          `[data-graph-node="${CSS.escape(candidates[0].key)}"]`,
        )
        ?.focus();
    }
  }
  return (
    <section className="context-graph" aria-label={tr("知识关系图谱")}>
      <div className="context-graph-toolbar">
        <div className="context-graph-legend">
          {(
            Object.entries(graphKinds) as [
              GraphKind,
              { label: string; color: string },
            ][]
          ).map(([kind, v]) => (
            <button
              key={kind}
              aria-pressed={types.has(kind)}
              onClick={() =>
                setTypes((old) => {
                  const next = new Set(old);
                  next.has(kind) ? next.delete(kind) : next.add(kind);
                  return next;
                })
              }
            >
              <i style={{ background: v.color }} />
              {tr(v.label)}
              <small>{data.nodes.filter((n) => n.kind === kind).length}</small>
            </button>
          ))}
        </div>
        <div className="context-graph-controls">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={labels}
            onClick={() => setLabels(!labels)}
          >
            {tr("标签")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={tr("缩小")}
            onClick={() => zoom(0.8)}
          >
            <Minus size={14} />
          </Button>
          <span>{Math.round(view.k * 100)}%</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={tr("放大")}
            onClick={() => zoom(1.25)}
          >
            <Plus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={tr("适应画布")}
            onClick={fit}
          >
            <Maximize size={14} />
          </Button>
        </div>
      </div>
      <div className="context-graph-canvas">
        {!visible.nodes.length && (
          <p className="context-graph-empty">
            {tr(
              data.nodes.length ? "当前类型下没有节点" : "暂无可展示的知识关联",
            )}
          </p>
        )}
        <svg
          ref={svg}
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
          role="group"
          aria-label={tr("拖动画布，滚轮缩放；选择节点查看关联")}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const start = local(e.clientX, e.clientY);
            drag.current = { start, last: start, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const p = local(e.clientX, e.clientY),
              dx = p.x - d.last.x,
              dy = p.y - d.last.y;
            if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 3)
              d.moved = true;
            if (d.key) {
              const key = d.key;
              setMoved((old) => ({
                ...old,
                [key]: {
                  x: (old[key] || points[key]).x + dx / view.k,
                  y: (old[key] || points[key]).y + dy / view.k,
                },
              }));
            } else setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
            d.last = p;
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            if (d?.key && !d.moved) {
              const now = performance.now();
              if (
                lastClick.current.key === d.key &&
                now - lastClick.current.at < 400
              ) {
                const n = visible.nodes.find((n) => n.key === d.key);
                lastClick.current = { key: "", at: 0 };
                if (n) open(n);
              } else {
                setSelected(d.key);
                lastClick.current = { key: d.key, at: now };
              }
            } else {
              lastClick.current = { key: "", at: 0 };
              if (d && !d.moved) setSelected("");
            }

            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {visible.edges.map((e) => {
              const a = points[e.from],
                b = points[e.to],
                active = !!node && (e.from === selected || e.to === selected);
              return (
                <line
                  key={`${e.from}|${e.to}|${e.kind}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`${active ? "active" : ""} ${node && !active ? "dimmed" : ""}`}
                  strokeDasharray={e.kind === "source" ? "4 4" : undefined}
                >
                  <title>{tr(graphEdgeLabels[e.kind] || e.kind)}</title>
                </line>
              );
            })}
            {visible.nodes.map((n, i) => {
              const p = points[n.key],
                active = !!node && (n.key === selected || neighbors.has(n.key)),
                r =
                  ((n.kind === "context" ? 6 : 8) +
                    Math.min(3, (degrees.get(n.key) || 0) / 4)) /
                  view.k,
                show = labelKeys.has(n.key);
              return (
                <g
                  key={n.key}
                  data-graph-node={n.key}
                  role="button"
                  tabIndex={
                    selected === n.key || (!selected && i === 0) ? 0 : -1
                  }
                  aria-label={`${tr(graphKinds[n.kind].label)}: ${n.title}`}
                  aria-pressed={selected === n.key}
                  transform={`translate(${p.x} ${p.y})`}
                  className={`context-graph-node ${node && !active ? "dimmed" : ""} ${selected === n.key ? "selected" : ""}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const start = local(e.clientX, e.clientY);
                    drag.current = {
                      key: n.key,
                      start,
                      last: start,
                      moved: false,
                    };
                    svg.current?.setPointerCapture(e.pointerId);
                  }}
                  onKeyDown={(e) => keyMove(e, n.key)}
                >
                  <title>{n.title}</title>
                  <circle r={Math.max(r, 16 / view.k)} fill="transparent" />
                  {selected === n.key && (
                    <circle
                      r={r + 6 / view.k}
                      fill="none"
                      stroke={graphKinds[n.kind].color}
                      opacity=".3"
                    />
                  )}
                  <circle
                    r={r}
                    fill={graphKinds[n.kind].color}
                    stroke={n.needs_review ? "#b77a20" : "white"}
                    strokeWidth={n.needs_review ? 3 : 1.5}
                  />
                  {show && (
                    <text
                      y={r + 15 / view.k}
                      style={{ fontSize: 11 / view.k, strokeWidth: 3 / view.k }}
                      textAnchor="middle"
                    >
                      {n.title.length > 26
                        ? n.title.slice(0, 25) + "…"
                        : n.title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {node && (
          <aside className="context-graph-detail">
            <button
              className="context-graph-close"
              aria-label={tr("关闭关联详情")}
              onClick={() => setSelected("")}
            >
              <X size={14} />
            </button>
            <small>
              {tr(graphKinds[node.kind].label)}
              {node.state &&
                " · " +
                  tr(
                    node.kind === "context"
                      ? contextStates[node.state] || node.state
                      : node.kind === "report"
                        ? statuses[node.state]?.label || node.state
                        : node.state === "archived"
                          ? "已归档"
                          : node.state,
                  )}
            </small>
            <h3>{node.title}</h3>
            {node.needs_review && (
              <p className="context-warning">{tr("需复核")}</p>
            )}
            <Button variant="outline" size="sm" onClick={() => open(node)}>
              <ExternalLink size={13} />
              {tr(
                node.kind === "project" || node.kind === "domain"
                  ? "按此范围筛选"
                  : "打开记录",
              )}
            </Button>
            <ul>
              {visible.edges
                .filter((e) => e.from === selected || e.to === selected)
                .map((e) => {
                  const other = visible.nodes.find(
                    (n) => n.key === (e.from === selected ? e.to : e.from),
                  )!;
                  return (
                    <li key={`${e.from}|${e.to}|${e.kind}`}>
                      <small>{tr(graphRelationLabel(e, selected))}</small>
                      <button onClick={() => setSelected(other.key)}>
                        {other.title}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </aside>
        )}
      </div>
      <div className="context-graph-footer">
        <span>
          {tr("{nodes} 个节点 · {edges} 条关联", {
            nodes: visible.nodes.length,
            edges: visible.edges.length,
          })}
        </span>
        <span>{tr("拖动画布，滚轮缩放；选择节点查看关联")}</span>
      </div>
      {data.truncated && (
        <p className="muted context-graph-limit">
          {tr("已展示 {count}/{total} 条知识，请缩小筛选范围查看其余关联", {
            count: data.shown_contexts,
            total: data.total_contexts,
          })}
        </p>
      )}
      <details className="context-graph-accessible-list">
        <summary>{tr("节点列表")}</summary>
        <ul>
          {visible.nodes.map((n) => (
            <li key={n.key}>
              <button onClick={() => setSelected(n.key)}>
                {tr(graphKinds[n.kind].label)} · {n.title}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
