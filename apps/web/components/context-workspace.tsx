"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ContextExploreView } from "./context-explore";
import { ContextGraphView } from "./context-graph";
import type { KnowledgeGraph } from "@/lib/context-graph";
import { Plus, Search, RotateCw } from "lucide-react";
import { ContextAIAction } from "./context-ai-action";
import { ContextDirectory, ContextDocument } from "./context-wiki";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SelectMenu } from "./ui/select-menu";
import { useI18n } from "./i18n-provider";
import { useSharedFilters } from "./shared-filters";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { LoadingStatus, PageLoading } from "./ui/loading-status";
import { request, ApiError, type Meta } from "@/lib/types";
import {
  blankContext,
  contextExcerpt,
  contextKinds,
  contextStates,
  type ContextEntry,
  type ContextSource,
  type ContextNode,
} from "@/lib/context";

export function ContextDialog({
  initial,
  meta,
  onClose,
  onSaved,
  capture = false,
  initialEditing = false,
  nodes = [],
}: {
  initial: ContextEntry;
  meta: Meta;
  onClose: () => void;
  onSaved?: (v: ContextEntry) => void;
  capture?: boolean;
  initialEditing?: boolean;
  nodes?: ContextNode[];
}) {
  const { t: tr, date } = useI18n();
  const [available, setAvailable] = useState(true);
  const [value, setValue] = useState(initial),
    [editing, setEditing] = useState(!initial.id || initialEditing),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [target, setTarget] = useState(""),
    [targets, setTargets] = useState<ContextEntry[]>([]);
  const operation = useRef({ fingerprint: "", id: "" });
  useEffect(() => {
    if (!value.id) return;
    let active = true;
    const refresh = async () => {
      try {
        const v = await request<ContextEntry>("/context/" + value.id);
        if (!active) return;
        setAvailable(true);
        if (editing) {
          if (v.revision !== value.revision)
            setError("Context 或来源已更新，请重新读取");
        } else {
          setValue(v);
          setAvailable(true);
          setError("");
        }
      } catch (e) {
        if (!active) return;
        setError((e as Error).message);
        if (e instanceof ApiError && (e.status === 403 || e.status === 404))
          setAvailable(false);
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("coflow:assistant-change", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("coflow:assistant-change", refresh);
    };
  }, [value.id, value.revision, editing]);

  const writable =
    !value.id ||
    value.creator_id === meta.current_user ||
    (value.visibility === "team" && meta.role === "admin");
  const set = <K extends keyof ContextEntry>(key: K, v: ContextEntry[K]) =>
    setValue((x) => ({ ...x, [key]: v }));
  async function save(action = "edit") {
    setBusy(true);
    setError("");
    try {
      const candidate = {
        parent_id: value.parent_id || "",
        source_id: value.source_id,
        title: value.title,
        body: value.body,
        kind: value.kind,
        visibility: value.visibility,
        project_id: value.project_id,
        domains: value.domains,
        state: value.state,
        valid_from: value.valid_from,
        valid_until: value.valid_until,
        review_on: value.review_on,
        sources: value.sources,
        action,
        expected_revision: value.revision,
        ...(action === "confirm" ? { state: "active" } : {}),
        ...(action === "review"
          ? { sources: value.sources.map((s) => ({ ...s, revision: "" })) }
          : {}),
        ...(action === "merge"
          ? {
              superseded_by: target,
              target_revision: targets.find((x) => x.id === target)?.revision,
            }
          : {}),
      };
      if (capture && !value.id) {
        const fact = JSON.stringify([
          candidate.title.trim(),
          candidate.body.trim(),
          candidate.kind,
          candidate.parent_id,
          candidate.visibility,
          candidate.project_id,
          candidate.domains,
          candidate.valid_from,
          candidate.valid_until,
          candidate.review_on,
          candidate.sources.map((s) => [s.kind, s.id, s.quote]).sort(),
        ]);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(fact),
        );
        candidate.source_id =
          "capture:" +
          Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
      }
      const fingerprint = JSON.stringify(candidate);
      if (operation.current.fingerprint !== fingerprint)
        operation.current = { fingerprint, id: crypto.randomUUID() };
      const v = await request<ContextEntry>(
        `/context${value.id ? "/" + value.id : ""}`,
        {
          method: value.id ? "PATCH" : "POST",
          body: JSON.stringify({
            ...candidate,
            operation_id: operation.current.id,
          }),
        },
      );
      setValue(v);
      setEditing(false);
      onSaved?.(v);
      window.dispatchEvent(new Event("coflow-knowledge-change"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="info-dialog context-dialog">
        <DialogTitle className="modal-title">
          {!available
            ? tr("Context 不可用")
            : value.id
              ? value.title
              : tr("新建 Context")}
        </DialogTitle>
        <DialogDescription className="modal-description">
          {tr("可追溯的背景、决定与约束")}
        </DialogDescription>
        {error && (
          <div role="alert">
            <p>{tr(error)}</p>
            {value.id && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  try {
                    const v = await request<ContextEntry>(
                      "/context/" + value.id,
                    );
                    setValue(v);
                    setEditing(false);
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {tr("重新读取")}
              </Button>
            )}
          </div>
        )}
        {!available ? (
          <p>{tr("Context 不可用")}</p>
        ) : editing ? (
          <form
            className="workspace-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              {tr("标题")}
              <input
                aria-label={tr("标题")}
                autoFocus
                required
                maxLength={500}
                value={value.title}
                onChange={(e) =>
                  set("title", contextExcerpt(e.target.value, 500))
                }
              />
            </label>
            <label>
              {tr("内容")}
              <textarea
                aria-label={tr("内容")}
                required
                rows={7}
                maxLength={20000}
                value={value.body}
                onChange={(e) =>
                  set("body", contextExcerpt(e.target.value, 20000))
                }
              />
            </label>
            <div className="context-fields">
              <label>
                {tr("类型")}
                <select
                  aria-label={tr("类型")}
                  value={value.kind}
                  onChange={(e) => set("kind", e.target.value)}
                >
                  {Object.entries(contextKinds).map(([id, label]) => (
                    <option key={id} value={id}>
                      {tr(label)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr("可见范围")}
                <select
                  aria-label={tr("可见范围")}
                  value={value.visibility}
                  onChange={(e) => set("visibility", e.target.value)}
                >
                  <option value="team">{tr("团队")}</option>
                  <option value="personal">{tr("仅自己")}</option>
                </select>
              </label>
              <label>
                {tr("状态")}
                <select
                  aria-label={tr("状态")}
                  value={value.state}
                  onChange={(e) => set("state", e.target.value)}
                >
                  {Object.entries(contextStates).map(([id, label]) => (
                    <option key={id} value={id}>
                      {tr(label)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr("项目")}
                <select
                  aria-label={tr("项目")}
                  value={value.project_id}
                  onChange={(e) => set("project_id", e.target.value)}
                >
                  <option value="">{tr("未归属")}</option>
                  {meta.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              {tr("上级文档")}
              <SelectMenu
                label={tr("上级文档")}
                value={value.parent_id || ""}
                onChange={(v) => set("parent_id", v)}
                options={[
                  { value: "", label: tr("顶层目录") },
                  ...nodes
                    .filter(
                      (n) =>
                        n.id !== value.id &&
                        ["document", "index"].includes(n.kind) &&
                        n.state !== "archived" &&
                        n.project_id === value.project_id &&
                        n.visibility === value.visibility &&
                        (n.visibility !== "personal" ||
                          n.creator_id === value.creator_id ||
                          (!value.id && n.creator_id === meta.current_user)),
                    )
                    .map((n) => ({ value: n.id, label: n.title })),
                ]}
              />
            </label>
            <fieldset>
              <legend>{tr("领域")}</legend>
              <div className="context-choices">
                {meta.domains.map((d) => (
                  <label key={d}>
                    <input
                      type="checkbox"
                      checked={value.domains.includes(d)}
                      onChange={(e) =>
                        set(
                          "domains",
                          e.target.checked
                            ? [...value.domains, d]
                            : value.domains.filter((x) => x !== d),
                        )
                      }
                    />
                    {d}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="context-fields">
              {(
                [
                  ["valid_from", "生效日期"],
                  ["valid_until", "有效截至"],
                  ["review_on", "复核日期"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {tr(label)}
                  <input
                    type="date"
                    value={value[key]}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <fieldset>
              <legend>{tr("来源")}</legend>
              {value.sources.map((s, i) => (
                <div className="context-source-edit" key={i}>
                  <select
                    aria-label={tr("来源类型")}
                    value={s.kind}
                    onChange={(e) =>
                      set(
                        "sources",
                        value.sources.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                kind: e.target.value as ContextSource["kind"],
                                revision: "",
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="todo">Todo</option>
                    <option value="report">Timeline</option>
                    <option value="calendar">Calendar</option>
                    <option value="context">Context</option>
                  </select>
                  <input
                    aria-label={tr("来源 ID")}
                    required
                    value={s.id}
                    onChange={(e) =>
                      set(
                        "sources",
                        value.sources.map((x, j) =>
                          j === i
                            ? { ...x, id: e.target.value, revision: "" }
                            : x,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      set(
                        "sources",
                        value.sources.filter((_, j) => j !== i),
                      )
                    }
                  >
                    {tr("移除")}
                  </Button>
                  <div
                    className="context-actions"
                    style={{ gridColumn: "1/-1" }}
                  >
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={
                        s.url ||
                        (s.kind === "todo"
                          ? "/todo?todo="
                          : s.kind === "report"
                            ? "/?report="
                            : s.kind === "context"
                              ? "/context?context="
                              : "/calendar?event=") + encodeURIComponent(s.id)
                      }
                    >
                      {tr("查看来源")}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          const path =
                            (s.kind === "todo"
                              ? "/todos/"
                              : s.kind === "report"
                                ? "/reports/"
                                : s.kind === "context"
                                  ? "/context/"
                                  : "/calendar/events/") +
                            encodeURIComponent(s.id);
                          const v = await request<{
                            revision?: number;
                            updated_at?: string;
                          }>(path);
                          set(
                            "sources",
                            value.sources.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    revision: String(
                                      v.revision ?? v.updated_at,
                                    ),
                                  }
                                : x,
                            ),
                          );
                          setError("");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      {tr("已核对，更新来源版本")}
                    </Button>
                  </div>
                  <textarea
                    aria-label={tr("引用片段")}
                    maxLength={2000}
                    value={s.quote}
                    onChange={(e) =>
                      set(
                        "sources",
                        value.sources.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                quote: contextExcerpt(e.target.value, 2000),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                disabled={value.sources.length >= 20}
                onClick={() =>
                  set("sources", [
                    ...value.sources,
                    { kind: "todo", id: "", revision: "", quote: "" },
                  ])
                }
              >
                + {tr("关联来源")}
              </Button>
            </fieldset>
            <div className="context-actions">
              <Button disabled={busy}>{tr(busy ? "保存中…" : "保存")}</Button>
              {value.id && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setValue(initial);
                    setEditing(false);
                  }}
                >
                  {tr("取消")}
                </Button>
              )}
            </div>
          </form>
        ) : (
          <>
            <div className="context-meta">
              <span>{tr(contextKinds[value.kind])}</span>
              <span>{tr(contextStates[value.state])}</span>
              <span>
                {tr(value.visibility === "personal" ? "仅自己" : "团队")}
              </span>
              {value.needs_review && (
                <strong className="context-warning">
                  {tr("来源变化或到期，需复核")}
                </strong>
              )}
            </div>
            <div className="markdown-body context-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {value.body}
              </ReactMarkdown>
            </div>
            <div className="context-meta">
              {value.valid_from && (
                <span>
                  {tr("生效日期")} {value.valid_from}
                </span>
              )}
              {value.valid_until && (
                <span>
                  {tr("有效截至")} {value.valid_until}
                </span>
              )}
              {value.review_on && (
                <span>
                  {tr("复核日期")} {value.review_on}
                </span>
              )}
            </div>
            {value.sources.length > 0 && (
              <section>
                <h3>{tr("来源")}</h3>
                {value.sources.map((s) => (
                  <div className="context-source" key={s.kind + s.id}>
                    <Link
                      href={
                        s.url ||
                        `/${s.kind === "todo" ? "todo?todo=" : s.kind === "report" ? "?report=" : s.kind === "context" ? "context?context=" : "calendar?event="}${encodeURIComponent(s.id)}`
                      }
                    >
                      {s.kind} · {s.id.slice(0, 12)}
                    </Link>
                    <small>{s.revision}</small>
                    {(s.changed || s.archived || s.needs_review) && (
                      <span className="context-warning">{tr("需复核")}</span>
                    )}
                    {s.quote && <blockquote>{s.quote}</blockquote>}
                  </div>
                ))}
              </section>
            )}
            {value.superseded_by && (
              <Link
                href={`/context?context=${encodeURIComponent(value.superseded_by)}`}
              >
                {tr("查看替代内容")}
              </Link>
            )}
            {writable && (
              <div className="context-actions">
                <ContextAIAction
                  label="AI 整理"
                  variant="outline"
                  size="sm"
                  scope={{
                    source_kind: "context",
                    source_id: value.id,
                    mode: "organize",
                  }}
                  onSaved={(v) => {
                    if (v.id === value.id) {
                      setValue(v);
                      onSaved?.(v);
                    }
                  }}
                />

                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  {tr("编辑")}
                </Button>
                {value.state === "pending" && (
                  <Button disabled={busy} onClick={() => void save("confirm")}>
                    {tr("确认有效")}
                  </Button>
                )}
                {value.needs_review && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void save("review")}
                  >
                    {tr("已核对来源，完成复核")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void save(
                      value.state === "archived" ? "restore" : "archive",
                    )
                  }
                >
                  {tr(value.state === "archived" ? "恢复" : "归档")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const v = await request<{ items: ContextEntry[] }>(
                        "/context?limit=100",
                      );
                      setTargets(
                        v.items.filter(
                          (x) =>
                            x.id !== value.id &&
                            x.state !== "archived" &&
                            x.visibility === value.visibility,
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {tr("合并重复内容")}
                </Button>
              </div>
            )}
            {targets.length > 0 && (
              <div className="context-actions">
                <select
                  aria-label={tr("保留的 Context")}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">{tr("选择保留的 Context")}</option>
                  {targets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={!target || busy}
                  onClick={() => void save("merge")}
                >
                  {tr("合并")}
                </Button>
                <small>{tr("保留目标正文，合并来源并归档当前记录。")}</small>
              </div>
            )}
            <details>
              <summary>{tr("变更历史")}</summary>
              {value.history?.map((h) => (
                <div className="context-source" key={h.revision}>
                  <small>
                    {date(h.at)} ·{" "}
                    {tr(
                      h.agent === "CoFlow Assistant"
                        ? "AI 助手"
                        : h.actor_kind === "token"
                          ? "Agent"
                          : "人工",
                    )}{" "}
                    ·{" "}
                    {meta.members.find((m) => m.id === h.actor_id)?.name ||
                      h.actor_id}{" "}
                    · r{h.revision}
                  </small>
                  <p>
                    {h.unavailable ? tr("来源不可用，历史内容已隐藏") : h.body}
                  </p>
                </div>
              ))}
            </details>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RememberContext({
  meta,
  kind,
  id,
  title,
  body,
  project = "",
  domains = [],
  revision = "",
}: {
  meta: Meta;
  kind: ContextSource["kind"];
  id: string;
  title: string;
  body: string;
  project?: string;
  domains?: string[];
  revision?: string;
}) {
  return (
    <ContextAIAction
      label="AI 提取"
      variant="ghost"
      size="sm"
      scope={{ project, source_kind: kind, source_id: id, mode: "extract" }}
    />
  );
}
export function ContextWorkspace({ meta }: { meta: Meta }) {
  const { t: tr } = useI18n(),
    shared = useSharedFilters();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"directory" | "graph" | "explore">(() =>
    searchParams.get("knowledge_view") === "explore"
      ? "explore"
      : searchParams.get("knowledge_view") === "graph"
        ? "graph"
        : "directory",
  );
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderActions(window.document.getElementById("context-header-actions"));
  }, []);
  const [exploreMatches, setExploreMatches] = useState<string[] | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  function changeView(next: "directory" | "graph" | "explore") {
    setView(next);
    if (next === "directory") {
      openSeq.current++;
      setOpening(false);
      setDocument(null);
    }
    const url = new URL(window.location.href);
    next !== "directory"
      ? url.searchParams.set("knowledge_view", next)
      : url.searchParams.delete("knowledge_view");
    if (next === "directory") url.searchParams.delete("context");
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  useEffect(() => {
    setView(
      searchParams.get("knowledge_view") === "explore"
        ? "explore"
        : searchParams.get("knowledge_view") === "graph"
          ? "graph"
          : "directory",
    );
  }, [searchParams]);
  const [items, setItems] = useState<ContextEntry[]>([]),
    [tree, setTree] = useState<ContextNode[]>([]),
    [document, setDocument] = useState<ContextEntry | null>(null),
    [editDetail, setEditDetail] = useState(false),
    [total, setTotal] = useState(0),
    [loaded, setLoaded] = useState(false),
    [listLoaded, setListLoaded] = useState(false),
    [loading, setLoading] = useState(true),
    [opening, setOpening] = useState(false),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [state, setState] = useState(""),
    [kind, setKind] = useState(""),
    [source, setSource] = useState(""),
    [offset, setOffset] = useState(0),
    [detail, setDetail] = useState<ContextEntry | null>(null);
  const seq = useRef(0);
  const openSeq = useRef(0);
  const { project, domain, member } = shared.filters;
  const load = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        project,
        domain,
        member,
        q: query,
        state,
        kind,
        source,
        offset: String(offset),
        limit: "40",
      });
      const [v, directory, relationship, exploration] = await Promise.all([
        view === "directory"
          ? request<{ items: ContextEntry[]; total: number }>(
              `/context?${params}`,
            )
          : Promise.resolve(null),
        request<{ items: ContextNode[] }>(
          `/context-tree?${new URLSearchParams({ project, domain, member })}`,
        ),
        view === "graph"
          ? request<KnowledgeGraph>(`/context-graph?${params}`)
          : Promise.resolve(null),
        view === "explore" && (query || state || kind || source)
          ? request<{ items: ContextNode[] }>(`/context-tree?${params}`)
          : Promise.resolve(null),
      ]);
      if (n !== seq.current) return;
      if (relationship) setGraph(relationship);
      setExploreMatches(
        exploration ? exploration.items.map((x) => x.id) : null,
      );
      if (v) {
        setListLoaded(true);
        setItems(v.items);
        setTotal(v.total);
      }
      setTree(directory.items);
      setError("");
      setLoaded(true);
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [project, domain, member, query, state, kind, source, offset, view]);
  useEffect(() => {
    void load();
    const f = () => void load();
    window.addEventListener("coflow-knowledge-change", f);
    window.addEventListener("focus", f);
    window.addEventListener("coflow:assistant-change", f);
    return () => {
      seq.current++;
      window.removeEventListener("coflow-knowledge-change", f);
      window.removeEventListener("focus", f);
      window.removeEventListener("coflow:assistant-change", f);
    };
  }, [load]);
  useEffect(() => {
    openSeq.current++;
    setOpening(false);
    setDocument(null);
  }, [project, domain, member]);
  useEffect(() => {
    if (!document) return;
    let active = true;
    const refresh = () =>
      request<ContextEntry>("/context/" + document.id)
        .then((v) => {
          if (active) setDocument(v);
        })
        .catch((e) => {
          if (active) {
            setError((e as Error).message);
            if (e instanceof ApiError && (e.status === 403 || e.status === 404))
              setDocument(null);
          }
        });
    window.addEventListener("focus", refresh);
    window.addEventListener("coflow-knowledge-change", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("coflow-knowledge-change", refresh);
    };
  }, [document?.id]);
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("context");
    let active = true;
    if (id)
      request<ContextEntry>("/context/" + encodeURIComponent(id))
        .then((x) => {
          if (active) setDetail(x);
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        });
    return () => {
      active = false;
    };
  }, [meta.team.id]);
  async function open(x: { id: string }, inDialog = false) {
    const n = ++openSeq.current;
    setOpening(true);
    try {
      const value = await request<ContextEntry>("/context/" + x.id);
      if (n === openSeq.current) {
        if (inDialog) {
          setEditDetail(false);
          setDetail(value);
        } else setDocument(value);
        setError("");
      }
    } catch (e) {
      if (n === openSeq.current) setError((e as Error).message);
    } finally {
      if (n === openSeq.current) setOpening(false);
    }
  }
  return (
    <section className="knowledge-workspace" aria-busy={loading || opening}>
      {headerActions &&
        createPortal(
          <>
            <label className="search context-search context-header-search">
              <Search size={15} />
              <input
                aria-label={tr("搜索 Context")}
                placeholder={tr("搜索 Context")}
                value={query}
                onChange={(e) => {
                  openSeq.current++;
                  setOpening(false);
                  setDocument(null);
                  setQuery(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <div className="context-create-actions">
              <ContextAIAction
                size="sm"
                key={`${project}:${domain}:${member}`}
                scope={{ project, domain, member, mode: "extract" }}
                onSaved={(v) => {
                  setDocument((current) =>
                    current?.id === v.id ? v : current,
                  );
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditDetail(false);
                  setDetail({
                    ...blankContext(),
                    project_id: project,
                    domains: domain ? [domain] : [],
                  });
                }}
              >
                <Plus size={15} />
                {tr("新建 Context")}
              </Button>
            </div>
          </>,
          headerActions,
        )}
      <div className="context-filters">
        <div
          className="todo-scopes context-view-switch"
          role="group"
          aria-label={tr("Context 视图")}
        >
          <button
            className={view === "explore" ? "active" : ""}
            aria-pressed={view === "explore"}
            onClick={() => changeView("explore")}
          >
            {tr("探索")}
          </button>
          <button
            className={view === "directory" ? "active" : ""}
            aria-pressed={view === "directory"}
            onClick={() => changeView("directory")}
          >
            {tr("列表")}
          </button>
          <button
            className={view === "graph" ? "active" : ""}
            aria-pressed={view === "graph"}
            onClick={() => changeView("graph")}
          >
            {tr("图谱")}
          </button>
        </div>
        {(
          [
            [state, setState, contextStates, "全部状态"],
            [kind, setKind, contextKinds, "全部类型"],
            [
              source,
              setSource,
              {
                todo: "Todo",
                report: "Timeline",
                calendar: "Calendar",
                context: "Context",
              },
              "全部来源",
            ],
          ] as const
        ).map(([value, set, choices, label]) => (
          <SelectMenu
            key={label}
            label={tr(label)}
            value={value}
            onChange={(next) => {
              openSeq.current++;
              setOpening(false);
              setDocument(null);
              set(next);
              setOffset(0);
            }}
            options={[
              { value: "", label: tr(label) },
              ...Object.entries(choices).map(([key, v]) => ({
                value: key,
                label: tr(v),
              })),
            ]}
          />
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            openSeq.current++;
            setOpening(false);
            setDocument(null);
            setQuery("");
            setState("");
            setKind("");
            setSource("");
            setOffset(0);
          }}
        >
          {tr("重置本页")}
        </Button>
        <Button
          className="context-refresh-button"
          size="sm"
          variant="ghost"
          aria-label={tr("刷新")}
          title={tr("刷新")}
          disabled={loading}
          onClick={() => void load()}
        >
          <RotateCw size={14} />
        </Button>
        <LoadingStatus
          className="context-filter-progress"
          active={loaded && (loading || opening)}
        />
      </div>
      {error && <p role="alert">{tr(error)}</p>}
      {view === "explore" ? (
        loaded ? (
          <ContextExploreView
            nodes={tree}
            matchingIDs={exploreMatches}
            meta={meta}
            onRead={(id) => void open({ id }, true)}
            onCreate={(v) => {
              setEditDetail(false);
              setDetail(v);
            }}
          />
        ) : (
          <PageLoading variant="list" />
        )
      ) : view === "graph" ? (
        graph ? (
          <ContextGraphView
            data={graph}
            onOpen={(id) => {
              changeView("directory");
              void open({ id });
            }}
          />
        ) : (
          <PageLoading variant="list" />
        )
      ) : (
        <div className="context-wiki-layout">
          <ContextDirectory
            nodes={tree}
            loading={!loaded}
            meta={meta}
            project={project}
            domain={domain}
            selected={document?.id || ""}
            onOpen={(id) => void open({ id })}
            onCreate={(v) => {
              setEditDetail(false);
              setDetail(v);
            }}
          />
          <div className="context-wiki-content">
            {document ? (
              <ContextDocument
                value={document}
                nodes={tree}
                meta={meta}
                onBack={() => changeView("directory")}
                onManage={(edit) => {
                  setEditDetail(edit);
                  setDetail(document);
                }}
                onOpen={(id) => void open({ id })}
                onChild={() => {
                  setEditDetail(false);
                  setDetail({
                    ...blankContext(),
                    kind: "document",
                    parent_id: document.id,
                    project_id: document.project_id,
                    domains: document.domains,
                    visibility: document.visibility,
                  });
                }}
              />
            ) : !listLoaded && loading ? (
              <PageLoading variant="list" />
            ) : (
              <div className="context-list">
                {items.map((x) => (
                  <article key={x.id} className="context-card">
                    <button
                      className="context-card-open"
                      onClick={() => void open(x)}
                    >
                      <div className="context-card-heading">
                        <strong>{x.title}</strong>
                        <span className="context-state" data-state={x.state}>
                          {tr(contextStates[x.state])}
                        </span>
                      </div>
                      <p className="context-excerpt">{x.body.slice(0, 200)}</p>
                      <small>
                        {tr(contextKinds[x.kind])} ·{" "}
                        {tr("{count} 个来源", { count: x.sources.length })}
                        {x.visibility === "personal"
                          ? " · " + tr("仅自己")
                          : ""}
                      </small>
                      {x.needs_review && (
                        <em className="context-warning">{tr("需复核")}</em>
                      )}
                      {items.some(
                        (y) =>
                          y.id !== x.id &&
                          y.title === x.title &&
                          y.project_id === x.project_id &&
                          y.body !== x.body,
                      ) && (
                        <em className="context-warning">
                          {tr("同名结论不同，请核对")}
                        </em>
                      )}
                    </button>
                  </article>
                ))}
                {!items.length && !loading && !error && (
                  <p className="muted">{tr("暂无 Context")}</p>
                )}
              </div>
            )}
            {!document && total > 40 && (
              <div className="context-actions">
                <Button
                  variant="ghost"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - 40))}
                >
                  {tr("上一页")}
                </Button>
                <span>
                  {offset + 1}–{Math.min(offset + 40, total)} / {total}
                </span>
                <Button
                  variant="ghost"
                  disabled={offset + 40 >= total || loading}
                  onClick={() => setOffset(offset + 40)}
                >
                  {tr("下一页")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {detail && (
        <ContextDialog
          key={detail.id || detail.source_id}
          initial={detail}
          initialEditing={editDetail}
          nodes={tree}
          meta={meta}
          onClose={() => setDetail(null)}
          onSaved={(v) => {
            setDetail(v);
            setDocument((current) => (current?.id === v.id ? v : current));
            void load();
          }}
        />
      )}
    </section>
  );
}
