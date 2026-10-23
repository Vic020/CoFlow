"use client";
import { useEffect, useRef, useState } from "react";
import { GripVertical, ArrowUp, ArrowDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Category, Meta, Report, reportDomains, request } from "@/lib/types";

const stateNames = {
  active: "正式",
  pending: "待整理",
  archived: "已归档",
  merged: "已合并",
};
export function CatalogManager({
  meta,
  onChange,
  onClose,
  categoryKind,
}: {
  meta: Meta;
  onChange: () => void;
  onClose?: () => void;
  categoryKind?: "project" | "domain";
}) {
  const [selectedKind, setKind] = useState<"project" | "domain">("project"),
    [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState(""),
    [aliases, setAliases] = useState(""),
    [state, setState] = useState("active"),
    [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const kind = categoryKind || selectedKind;
  const items = (meta.catalog || []).filter(
    (x) => x.kind === kind && x.state !== "merged",
  );
  const dragged = useRef<string | null>(null);
  const dragTarget = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  useEffect(() => {
    setOrderedIds(null);
  }, [meta.catalog]);
  const visibleItems = orderedIds
    ? [...items].sort(
        (a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id),
      )
    : items;
  async function reorder(from: string, to: string) {
    if (busy || from === to || meta.mode === "local-demo") return;
    const ids = visibleItems.map((x) => x.id);
    const start = ids.indexOf(from),
      end = ids.indexOf(to);
    if (start < 0 || end < 0) return;
    ids.splice(start, 1);
    ids.splice(end, 0, from);
    setOrderedIds(ids);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(`/catalog/${kind}/order`, {
        method: "PUT",
        body: JSON.stringify({ ids }),
      });
      setMessage("顺序已保存");
      onChange();
    } catch (e) {
      setOrderedIds(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function choose(v: Category | null) {
    setEditing(v);
    setName(v?.name || "");
    setAliases(v?.aliases.join("，") || "");
    setState(v?.state || "active");
    setTarget("");
    setError("");
    setMessage("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await mutate(
      `/catalog/${kind}${editing ? `/${editing.id}` : ""}`,
      editing ? "PATCH" : "POST",
      {
        name,
        aliases: aliases
          .split(/[,，\n]/)
          .map((x) => x.trim())
          .filter(Boolean),
        state,
      },
      "分类已保存",
    );
  }
  async function mutate(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) {
    setBusy(true);
    setError("");
    try {
      await request(path, { method, body: JSON.stringify(body) });
      choose(null);
      setOrderedIds(null);
      setMessage(success);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`catalog-manager${categoryKind ? " catalog-single-kind" : ""}`}
    >
      <div className="section-heading">
        <h3>
          {categoryKind ? (kind === "project" ? "项目" : "领域") : "项目与领域"}
        </h3>
        <span>
          {
            (meta.catalog || []).filter(
              (x) =>
                x.state === "pending" && (!categoryKind || x.kind === kind),
            ).length
          }{" "}
          项待整理
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => choose(null)}
        >
          <Plus />
          新建{kind === "project" ? "项目" : "领域"}
        </Button>
        {onClose && (
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            完成
          </Button>
        )}
      </div>

      {!categoryKind && (
        <div className="catalog-tabs" role="tablist" aria-label="分类类型">
          {(["project", "domain"] as const).map((k) => (
            <button
              role="tab"
              aria-selected={kind === k}
              key={k}
              onClick={() => {
                setKind(k);
                setOrderedIds(null);
                choose(null);
              }}
            >
              {k === "project" ? "项目" : "领域"}
            </button>
          ))}
        </div>
      )}
      <div
        className="catalog-list"
        aria-label={kind === "project" ? "项目列表" : "领域列表"}
      >
        {visibleItems.length === 0 && (
          <p className="catalog-empty">
            暂无{kind === "project" ? "项目" : "领域"}
          </p>
        )}
        {visibleItems.map((v, index) => (
          <div
            key={v.id}
            className={`catalog-row ${editing?.id === v.id ? "selected" : ""} ${dropTarget === v.id ? "drop-target" : ""}`}
            data-category-id={v.id}
          >
            <button
              type="button"
              className="catalog-drag"
              aria-label={`拖动排序 ${v.name}`}
              title="拖拽排序，也可使用 Alt + ↑ / ↓"
              disabled={busy || meta.mode === "local-demo"}
              onPointerDown={(e) => {
                if (e.button !== 0 || busy) return;
                dragged.current = v.id;
                dragTarget.current = null;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!dragged.current) return;
                const row = document
                  .elementFromPoint(e.clientX, e.clientY)
                  ?.closest<HTMLElement>("[data-category-id]");
                const id =
                  row?.closest(".catalog-list") ===
                  e.currentTarget.closest(".catalog-list")
                    ? row?.dataset.categoryId || null
                    : null;
                dragTarget.current = id;
                setDropTarget(id);
                if (id) row?.scrollIntoView({ block: "nearest" });
              }}
              onPointerUp={(e) => {
                const from = dragged.current,
                  to = dragTarget.current;
                dragged.current = null;
                dragTarget.current = null;
                setDropTarget(null);
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
                if (from && to) void reorder(from, to);
              }}
              onPointerCancel={() => {
                dragged.current = null;
                dragTarget.current = null;
                setDropTarget(null);
              }}
              onKeyDown={(e) => {
                if (
                  e.altKey &&
                  (e.key === "ArrowUp" || e.key === "ArrowDown")
                ) {
                  e.preventDefault();
                  const next =
                    visibleItems[index + (e.key === "ArrowUp" ? -1 : 1)];
                  if (next) void reorder(v.id, next.id);
                }
              }}
            >
              <GripVertical size={14} />
            </button>
            <button
              type="button"
              className="catalog-select"
              aria-pressed={editing?.id === v.id}
              onClick={() => choose(v)}
            >
              <span>
                <strong>{v.name}</strong>
                {v.aliases.length > 0 && <small>{v.aliases.join(" · ")}</small>}
              </span>
              {v.state !== "active" && (
                <span className={`category-state ${v.state}`}>
                  {stateNames[v.state]}
                </span>
              )}
            </button>
            <div className="catalog-move">
              <button
                type="button"
                aria-label={`上移 ${v.name}`}
                disabled={busy || index === 0 || meta.mode === "local-demo"}
                onClick={() => void reorder(v.id, visibleItems[index - 1].id)}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                aria-label={`下移 ${v.name}`}
                disabled={
                  busy ||
                  index === visibleItems.length - 1 ||
                  meta.mode === "local-demo"
                }
                onClick={() => void reorder(v.id, visibleItems[index + 1].id)}
              >
                <ArrowDown size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <form className="workspace-form" onSubmit={save}>
        <div className="section-heading">
          <h4>
            {editing
              ? `整理「${editing.name}」`
              : `新建${kind === "project" ? "项目" : "领域"}`}
          </h4>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => choose(null)}
            >
              取消
            </Button>
          )}
        </div>
        <label>
          名称
          <input
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              kind === "project" ? "如：CoFlow 首版开发" : "如：视频制作"
            }
          />
        </label>
        <label>
          别名
          <input
            value={aliases}
            maxLength={1500}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="多个别名用逗号分隔"
          />
        </label>
        <label>
          状态
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="active">正式</option>
            <option value="pending">待整理</option>
            <option value="archived">已归档</option>
          </select>
        </label>
        <Button disabled={busy} type="submit">
          {editing ? "保存分类" : "创建分类"}
        </Button>
      </form>
      {editing && (
        <div className="merge-box">
          <label>
            合并到另一个正式分类
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">选择目标</option>
              {items
                .filter((x) => x.id !== editing.id && x.state === "active")
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted">
            历史简报将归入目标分类，旧名称继续作为别名匹配。
          </p>
          <Button
            variant="outline"
            disabled={busy || !target}
            onClick={() =>
              void mutate(
                `/catalog/${kind}/${editing.id}/merge`,
                "POST",
                { target_id: target },
                "已合并分类及历史简报",
              )
            }
          >
            合并并归并历史简报
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success-text">
          {message}
        </p>
      )}
    </section>
  );
}

export function ClassificationEditor({
  report: r,
  meta,
  onChange,
}: {
  report: Report;
  meta: Meta;
  onChange: () => void;
}) {
  const [project, setProject] = useState(r.project_id),
    [domains, setDomains] = useState(reportDomains(r).join("，")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details className="classification-editor">
      <summary>
        调整分类{r.classification_locked ? " · 已人工确认" : ""}
      </summary>
      <form
        className="workspace-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await request(`/reports/${r.id}/classification`, {
              method: "PATCH",
              body: JSON.stringify({
                project_id: project,
                domains: domains
                  .split(/[,，]/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              }),
            });
            onChange();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          所属项目
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">未归属项目</option>
            {meta.projects
              .filter((p) => p.status !== "archived" || p.id === r.project_id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          工作领域
          <input
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="研发，产品"
            maxLength={500}
          />
        </label>
        <p className="muted">保存后，Agent 更新简报时保留你确认的分类。</p>
        <Button size="sm" disabled={busy}>
          保存归属
        </Button>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
