"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { publicDemo } from "@/lib/runtime";
import {
  Plus,
  Search,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
} from "lucide-react";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { SelectMenu } from "./ui/select-menu";
import { ActionMenu } from "./ui/action-menu";
import { AgentAccess } from "./agent-access";
import { todoManagementPrompt } from "@/lib/report-prompt";
import { TodoAgentAccess, TodoAPIAccess } from "./todo-agent-access";
import { TodoDetailFields } from "./todo-detail-fields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { ReportCompose } from "./report-compose";
import { NotificationCenter } from "./notification-center";
import { ApiError, Meta, Report, request, dateKey } from "@/lib/types";
import {
  defaultColumnName,
  emptyTodo,
  Todo,
  TodoBoardData,
  TodoColumn,
} from "@/lib/todo";
function ManualTaskPanel({
  detail,
  children,
}: {
  detail: boolean;
  children: ReactNode;
}) {
  return detail ? (
    <>{children}</>
  ) : (
    <TabsContent value="manual">{children}</TabsContent>
  );
}

export function TodoBoard({ meta }: { meta: Meta }) {
  const { t: tr, locale, timeZone, date } = useI18n();
  const [board, setBoard] = useState<TodoBoardData | null>(null),
    [tasks, setTasks] = useState<Todo[]>([]),
    [query, setQuery] = useState(""),
    [project, setProject] = useState(""),
    [domain, setDomain] = useState(""),
    [assignee, setAssignee] = useState(""),
    [scope, setScope] = useState("all"),
    [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<Todo | null>(null),
    [draft, setDraft] = useState<Todo | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("discussion"),
    [comment, setComment] = useState(""),
    [mentions, setMentions] = useState<string[]>([]),
    [reporting, setReporting] = useState(false),
    [column, setColumn] = useState<TodoColumn | null>(null),
    [target, setTarget] = useState(""),
    [drag, setDrag] = useState<{
      kind: string;
      id: string;
    } | null>(null),
    [notice, setNotice] = useState("");
  const [creationTab, setCreationTab] = useState("manual");
  const [detailEditing, setDetailEditing] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<{
    target: string;
    time: number;
  } | null>(null);
  useEffect(() => {
    if (!copiedTarget) return;
    const timer = setTimeout(() => setCopiedTarget(null), 2500);
    return () => clearTimeout(timer);
  }, [copiedTarget]);
  const [reports, setReports] = useState<Report[]>([]);
  const version = useRef(0),
    mounted = useRef(true),
    pending = useRef({
      hash: "",
      id: "",
    });
  const admin = meta.role === "admin" || meta.mode === "local-demo";
  const name = (id: string) =>
    meta.members.find((m) => m.id === id)?.name || tr("已离开成员");
  const columnName = (c: TodoColumn) =>
    defaultColumnName(c) ? tr(c.name) : c.name;
  const canWrite = (t: Todo) =>
    admin ||
    t.creator_id === meta.current_user ||
    t.assignee_id === meta.current_user;
  const load = useCallback(async () => {
    const v = ++version.current;
    try {
      const b = await request<TodoBoardData>("/todo-board");
      const params = new URLSearchParams({
        q: query,
        project,
        domain,
        assignee,
        scope,
        archived: String(archived),
        limit: "200",
      });
      const all: Todo[] = [];
      for (const c of b.columns.filter((c) => !c.archived)) {
        params.set("column", c.id);
        params.delete("cursor");
        for (;;) {
          const page = await request<{
            items: Todo[];
            next_cursor: string;
          }>(`/todos?${params}`);
          all.push(...page.items);
          if (!page.next_cursor) break;
          params.set("cursor", page.next_cursor);
        }
      }
      if (v !== version.current || !mounted.current) return;
      setBoard(b);
      setTasks(all);
    } catch (e) {
      if (v === version.current && mounted.current)
        setError((e as Error).message);
    }
  }, [query, project, domain, assignee, scope, archived]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      mounted.current = false;
      version.current++;
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("todo");
    if (id) void open(id);
  }, []);
  async function open(id: string) {
    setError("");
    try {
      const t = await request<Todo>(`/todos/${id}`);
      if (!mounted.current) return;
      setSelected(t);
      setDraft(structuredClone(t));
      setCreationTab("manual");
      setTab("discussion");
      const rs = await request<{
        items: Report[];
      }>("/reports");
      if (mounted.current) setReports(rs.items);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }
  function operation(payload: unknown) {
    const hash = JSON.stringify(payload);
    if (pending.current.hash !== hash)
      pending.current = {
        hash,
        id: crypto.randomUUID(),
      };
    return pending.current.id;
  }
  async function change(
    t: Todo,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    const data = {
      ...extra,
      action,
      expected_revision: t.revision,
      board_revision: board?.revision,
    };
    try {
      const updated = await request<Todo>(`/todos/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...data,
          operation_id: operation({
            id: t.id,
            ...data,
          }),
        }),
      });
      pending.current = {
        hash: "",
        id: "",
      };
      if (!mounted.current) return false;
      if (selected?.id === t.id) {
        setSelected(updated);
        setDraft(structuredClone(updated));
      }
      if (action === "comment") {
        setComment("");
        setMentions([]);
      }
      await load();
      if (action === "move") setNotice(tr("任务已移动"));
      return true;
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) await load();
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = {
        title: draft.title,
        body: draft.body,
        column_id: draft.column_id,
        assignee_id: draft.assignee_id,
        project_id: draft.project_id,
        domains: draft.domains,
        priority: draft.priority,
        due_date: draft.due_date,
        links: draft.links,
        source_id: draft.source_id,
        action: "edit",
        expected_revision: draft.revision,
      };
      const t = await request<Todo>(
        draft.id ? `/todos/${draft.id}` : "/todos",
        {
          method: draft.id ? "PATCH" : "POST",
          body: JSON.stringify({
            ...data,
            operation_id: operation(data),
          }),
        },
      );
      pending.current = {
        hash: "",
        id: "",
      };
      if (!mounted.current) return;
      if (!draft.id) {
        setSelected(null);
        setDraft(null);
      } else {
        setSelected(t);
        setDraft(structuredClone(t));
      }
      await load();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) await load();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function changeColumn(id: string, data: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        ...data,
        board_revision: board?.revision,
      };
      await request(id ? `/todo-columns/${id}` : "/todo-columns", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify({
          ...body,
          operation_id: operation({
            id,
            ...body,
          }),
        }),
      });
      pending.current = {
        hash: "",
        id: "",
      };
      if (!mounted.current) return;
      setColumn(null);
      await load();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) await load();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function create(col: string) {
    const t = {
      ...emptyTodo(col),
      source_id: crypto.randomUUID(),
      project_id: project,
      domains: domain ? [domain] : [],
    };
    setCreationTab("manual");
    setDraft(t);
    setSelected(null);
    setError("");
    setTab("discussion");
  }
  function orderColumn(id: string, delta: number) {
    if (!board) return;
    const ids = board.columns.map((c) => c.id),
      i = ids.indexOf(id),
      j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void changeColumn(id, {
      action: "order",
      ids,
    });
  }
  const set = (key: keyof Todo, value: unknown) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            [key]: value,
          }
        : d,
    );
  async function copyTodoPrompt() {
    setError("");
    setCopiedTarget(null);
    try {
      const prompt = todoManagementPrompt({
        origin: window.location.origin,
        target: { team: meta.team.id, member: meta.current_user },
        locale,
        mode: publicDemo
          ? "offline-demo"
          : meta.mode === "local-demo"
            ? "local-demo"
            : "team",
      });
      await navigator.clipboard.writeText(prompt);
      if (mounted.current)
        setCopiedTarget({ target: "management", time: Date.now() });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const priorities: Record<string, string> = {
    none: "无优先级",
    low: "低",
    medium: "中",
    high: "高",
  };
  const actions: Record<string, string> = {
    created: "创建任务",
    edit: "编辑任务",
    move: "移动任务",
    complete: "完成任务",
    reopen: "重新打开",
    archive: "归档",
    restore: "恢复",
    comment: "发表评论",
    "report-link": "关联简报",
    "report-move": "上报并移动",
    "collaboration-transfer": "协作转交",
    "column-migration": "列归档迁移",
    "column-completion": "列完成属性变更",
    classification: "整理分类",
    "delete-comment": "删除评论",
    "restore-comment": "恢复评论",
  };
  return (
    <section className="todo-workspace">
      <div className="todo-toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label={tr("搜索任务")}
            placeholder={tr("搜索任务")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="todo-actions">
          {meta.mode !== "local-demo" && (
            <NotificationCenter
              team={meta.team.id}
              onSelect={(id) =>
                window.location.assign(`/?report=${encodeURIComponent(id)}`)
              }
              onTodo={(id) => void open(id)}
            />
          )}
          <Button
            variant="outline"
            className="todo-agent-quick"
            onClick={() => void copyTodoPrompt()}
          >
            {copiedTarget?.target === "management" ? (
              <Check size={15} />
            ) : (
              <Copy size={15} />
            )}
            <span aria-live="polite">
              {tr(
                copiedTarget?.target === "management"
                  ? "已复制"
                  : "Agent 一键管理",
              )}
            </span>
          </Button>
          <Button
            onClick={() =>
              create(
                board?.columns.find((c) => !c.archived && !c.done)?.id || "",
              )
            }
            disabled={!board}
          >
            <Plus size={16} />
            {tr("新建任务")}
          </Button>
        </div>
      </div>
      <div className="todo-filters">
        <div className="todo-scopes">
          {[
            ["all", "全部"],
            ["related", "与我相关"],
            ["todo", "待我处理"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={scope === value}
              className={scope === value ? "active" : ""}
              onClick={() => setScope(value)}
            >
              {tr(label)}
            </button>
          ))}
        </div>
        <SelectMenu
          label={tr("项目")}
          value={project}
          onChange={setProject}
          options={[
            { value: "", label: tr("全部项目") },
            ...meta.projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <SelectMenu
          label={tr("领域")}
          value={domain}
          onChange={setDomain}
          options={[
            { value: "", label: tr("全部领域") },
            ...meta.domains.map((d) => ({ value: d, label: d })),
          ]}
        />
        <SelectMenu
          label={tr("负责人")}
          value={assignee}
          onChange={setAssignee}
          options={[
            { value: "", label: tr("全部负责人") },
            ...meta.members.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
        <button
          aria-pressed={archived}
          className={archived ? "active" : ""}
          onClick={() => setArchived(!archived)}
        >
          {tr("已归档")}
        </button>
        <button
          onClick={() => {
            setQuery("");
            setProject("");
            setDomain("");
            setAssignee("");
            setScope("all");
            setArchived(false);
          }}
        >
          {tr("重置")}
        </button>
        {admin && (
          <ActionMenu label={tr("更多操作")}>
            {admin && (
              <>
                <button
                  onClick={() => {
                    setColumn({
                      id: "",
                      name: "",
                      done: false,
                      archived: false,
                      revision: 0,
                    });
                    setTarget("");
                  }}
                >
                  {tr("新增列")}
                </button>
                {board?.columns
                  .filter((c) => c.archived)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() =>
                        void changeColumn(c.id, {
                          action: "restore",
                          expected_revision: c.revision,
                        })
                      }
                    >
                      {tr("恢复")} · {columnName(c)}
                    </button>
                  ))}
              </>
            )}
          </ActionMenu>
        )}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {tr(error)}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!board ? (
        <p className="muted">{tr("加载中…")}</p>
      ) : (
        <div className="todo-lanes">
          {board.columns
            .filter((c) => !c.archived)
            .map((c) => {
              const cards = tasks.filter((t) => t.column_id === c.id);
              return (
                <section
                  key={c.id}
                  className="todo-lane"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag?.kind === "task") {
                      const t = tasks.find((t) => t.id === drag.id);
                      if (t)
                        void change(t, "move", {
                          column_id: c.id,
                        });
                    } else if (drag?.kind === "column" && admin) {
                      const ids = board.columns
                        .map((c) => c.id)
                        .filter((id) => id !== drag.id);
                      ids.splice(ids.indexOf(c.id), 0, drag.id);
                      void changeColumn(c.id, {
                        action: "order",
                        ids,
                      });
                    }
                    setDrag(null);
                  }}
                >
                  <header className="todo-lane-header">
                    <h2
                      draggable={admin && !busy}
                      onDragStart={() =>
                        setDrag({
                          kind: "column",
                          id: c.id,
                        })
                      }
                    >
                      <GripVertical size={14} />
                      {columnName(c)}{" "}
                      <small>
                        {new Intl.NumberFormat(locale).format(cards.length)}
                      </small>
                    </h2>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("新建任务")}
                      onClick={() => create(c.id)}
                    >
                      <Plus size={15} />
                    </Button>
                    {admin && (
                      <ActionMenu label={tr("管理列")}>
                        <button
                          onClick={() => {
                            setColumn({
                              ...c,
                            });
                            setTarget("");
                          }}
                        >
                          {tr("管理列")}
                        </button>
                        <button onClick={() => orderColumn(c.id, -1)}>
                          {tr("向左移动")}
                        </button>
                        <button onClick={() => orderColumn(c.id, 1)}>
                          {tr("向右移动")}
                        </button>
                        {c.done && (
                          <button
                            onClick={() =>
                              void changeColumn(c.id, {
                                action: "default",
                              })
                            }
                          >
                            {tr("设为默认完成列")}
                          </button>
                        )}
                      </ActionMenu>
                    )}
                  </header>
                  <div className="todo-cards">
                    {cards.map((t) => (
                      <article
                        key={t.id}
                        className={`todo-card priority-${t.priority}`}
                        tabIndex={canWrite(t) ? 0 : undefined}
                        aria-label={t.title}
                        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                        title={tr("聚焦卡片后，Alt 加左右方向键移动列")}
                        onKeyDown={(e) => {
                          if (
                            e.target !== e.currentTarget ||
                            !e.altKey ||
                            busy ||
                            !canWrite(t)
                          )
                            return;
                          const delta =
                            e.key === "ArrowRight"
                              ? 1
                              : e.key === "ArrowLeft"
                                ? -1
                                : 0;
                          if (!delta) return;
                          e.preventDefault();
                          const cols = board.columns.filter((c) => !c.archived),
                            dest =
                              cols[
                                cols.findIndex((c) => c.id === t.column_id) +
                                  delta
                              ];
                          if (dest)
                            void change(t, "move", { column_id: dest.id });
                        }}
                        draggable={canWrite(t) && !busy}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setDrag({
                            kind: "task",
                            id: t.id,
                          });
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          if (drag?.kind !== "task") return;
                          e.preventDefault();
                          e.stopPropagation();
                          const moved = tasks.find((x) => x.id === drag.id);
                          if (moved && moved.id !== t.id)
                            void change(moved, "move", {
                              column_id: c.id,
                              before_id: t.id,
                            });
                          setDrag(null);
                        }}
                      >
                        <button
                          className="todo-card-open"
                          onClick={() => void open(t.id)}
                        >
                          <strong>{t.title}</strong>
                          <span className="todo-card-meta">
                            {t.assignee_id ? (
                              <span>{name(t.assignee_id)}</span>
                            ) : (
                              <span>{tr("未分配")}</span>
                            )}
                            {t.priority !== "none" && (
                              <span>{tr(priorities[t.priority])}</span>
                            )}
                          </span>
                          <span className="todo-card-tags">
                            {t.project_id && (
                              <span>
                                {meta.projects.find(
                                  (p) => p.id === t.project_id,
                                )?.name || t.project_id}
                              </span>
                            )}
                            {t.domains.map((d) => (
                              <span key={d}>{d}</span>
                            ))}
                          </span>
                          {t.due_date && (
                            <time
                              className={
                                !t.completed_at &&
                                !t.archived &&
                                t.due_date <
                                  dateKey(new Date().toISOString(), timeZone)
                                  ? "todo-overdue"
                                  : ""
                              }
                            >
                              {date(`${t.due_date}T12:00:00Z`, {
                                timeZone: "UTC",
                                month: "short",
                                day: "numeric",
                              })}
                            </time>
                          )}
                        </button>
                        {canWrite(t) && (
                          <div className="todo-card-moves">
                            <select
                              aria-label={tr("移动任务")}
                              value={t.column_id}
                              disabled={busy}
                              onChange={(e) =>
                                void change(t, "move", {
                                  column_id: e.target.value,
                                })
                              }
                            >
                              {board.columns
                                .filter((c) => !c.archived)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {columnName(c)}
                                  </option>
                                ))}
                            </select>
                            <button
                              aria-label={tr("置顶")}
                              disabled={busy || cards[0].id === t.id}
                              onClick={() =>
                                void change(t, "move", {
                                  column_id: c.id,
                                  before_id: cards[0].id,
                                })
                              }
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              aria-label={tr("置底")}
                              disabled={busy || cards.at(-1)?.id === t.id}
                              onClick={() =>
                                void change(t, "move", {
                                  column_id: c.id,
                                  after_id: cards.at(-1)?.id,
                                })
                              }
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                    {!cards.length && (
                      <button
                        className="todo-empty"
                        onClick={() => create(c.id)}
                      >
                        {tr("添加任务")}
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
        </div>
      )}
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setSelected(null);
            setError("");
          }
        }}
      >
        <DialogContent
          className={`info-dialog report-hub-dialog ${draft?.id ? "todo-detail-dialog" : "todo-create-dialog"}`}
          onEscapeKeyDown={(event) => {
            if (detailEditing) event.preventDefault();
          }}
        >
          <DialogTitle className="modal-title">
            {tr(draft?.id ? "任务详情" : "新建任务")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {tr("安排工作、记录进展与交付")}
          </DialogDescription>
          {draft && (
            <Tabs
              value={creationTab}
              onValueChange={setCreationTab}
              className={draft.id ? "" : "report-hub-tabs"}
            >
              {!draft.id && (
                <TabsList aria-label={tr("任务创建方式")}>
                  {[
                    ["manual", "手动创建"],
                    ["agent", "Agent"],
                    ["skill", "Skill"],
                    ["api", "API"],
                  ].map(([value, label]) => (
                    <TabsTrigger key={value} value={value}>
                      {tr(label)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}
              <ManualTaskPanel detail={!!draft.id}>
                {selected && (
                  <>
                    <div className="todo-detail-status">
                      <span>
                        {board?.columns.find((c) => c.id === selected.column_id)
                          ? columnName(
                              board.columns.find(
                                (c) => c.id === selected.column_id,
                              )!,
                            )
                          : "—"}
                      </span>
                      {selected.archived && <span>{tr("已归档")}</span>}
                    </div>
                    <TodoDetailFields
                      task={selected}
                      meta={meta}
                      writable={canWrite(selected)}
                      busy={busy}
                      onSave={(patch) => change(selected, "edit", patch)}
                      onEditingChange={setDetailEditing}
                    />
                  </>
                )}
                {!draft.id && (
                  <form className="workspace-form" onSubmit={save}>
                    <label>
                      {tr("标题")}
                      <input
                        autoFocus
                        required
                        maxLength={500}
                        value={draft.title}
                        disabled={!!draft.id && !canWrite(draft)}
                        onChange={(e) => set("title", e.target.value)}
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        {tr("负责人")}
                        <select
                          value={draft.assignee_id}
                          onChange={(e) => set("assignee_id", e.target.value)}
                        >
                          <option value="">{tr("未分配")}</option>
                          {draft.assignee_id &&
                            !meta.members.some(
                              (m) => m.id === draft.assignee_id,
                            ) && (
                              <option value={draft.assignee_id}>
                                {tr("已离开成员")}
                              </option>
                            )}
                          {meta.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {tr("优先级")}
                        <select
                          value={draft.priority}
                          onChange={(e) => set("priority", e.target.value)}
                        >
                          {Object.entries(priorities).map(([v, l]) => (
                            <option key={v} value={v}>
                              {tr(l)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {tr("项目")}
                        <select
                          value={draft.project_id}
                          onChange={(e) => set("project_id", e.target.value)}
                        >
                          <option value="">{tr("未归属")}</option>
                          {meta.projects
                            .filter(
                              (p) =>
                                p.status !== "archived" ||
                                p.id === draft.project_id,
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        {tr("截止日期")}
                        <input
                          type="date"
                          value={draft.due_date}
                          onChange={(e) => set("due_date", e.target.value)}
                        />
                      </label>
                    </div>
                    <fieldset>
                      <legend>{tr("领域")}</legend>
                      <div className="todo-domains">
                        {meta.domains.map((d) => (
                          <label key={d}>
                            <input
                              type="checkbox"
                              checked={draft.domains.includes(d)}
                              onChange={(e) =>
                                set(
                                  "domains",
                                  e.target.checked
                                    ? [...draft.domains, d]
                                    : draft.domains.filter((x) => x !== d),
                                )
                              }
                            />
                            {d}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {!draft.id && (
                      <label>
                        {tr("所属列")}
                        <select
                          value={draft.column_id}
                          onChange={(e) => set("column_id", e.target.value)}
                        >
                          {board?.columns
                            .filter((c) => !c.archived)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {columnName(c)}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {tr("描述")}
                      <textarea
                        rows={5}
                        maxLength={50000}
                        value={draft.body}
                        onChange={(e) => set("body", e.target.value)}
                      />
                    </label>
                    <fieldset>
                      <legend>{tr("交付链接")}</legend>
                      {draft.links.map((l, i) => (
                        <div className="todo-link-edit" key={i}>
                          <input
                            aria-label={tr("链接名称")}
                            placeholder={tr("链接名称")}
                            value={l.title}
                            onChange={(e) =>
                              set(
                                "links",
                                draft.links.map((x, j) =>
                                  i === j
                                    ? {
                                        ...x,
                                        title: e.target.value,
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                          <input
                            type="url"
                            required
                            aria-label={tr("链接地址")}
                            placeholder="https://"
                            value={l.url}
                            onChange={(e) =>
                              set(
                                "links",
                                draft.links.map((x, j) =>
                                  i === j
                                    ? {
                                        ...x,
                                        url: e.target.value,
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              set(
                                "links",
                                draft.links.filter((_, j) => i !== j),
                              )
                            }
                          >
                            {tr("移除")}
                          </button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={draft.links.length >= 20}
                        onClick={() =>
                          set("links", [
                            ...draft.links,
                            {
                              title: "",
                              url: "",
                            },
                          ])
                        }
                      >
                        {tr("添加链接")}
                      </Button>
                    </fieldset>
                    {(!draft.id || canWrite(draft)) && (
                      <Button disabled={busy}>{tr("保存")}</Button>
                    )}
                  </form>
                )}
                {selected && (
                  <>
                    <div className="todo-detail-actions">
                      {canWrite(selected) && (
                        <>
                          <Button
                            variant="outline"
                            disabled={busy || detailEditing}
                            onClick={() =>
                              void change(
                                selected,
                                selected.completed_at ? "reopen" : "complete",
                              )
                            }
                          >
                            {tr(
                              selected.completed_at ? "重新打开" : "完成任务",
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy || detailEditing}
                            onClick={() =>
                              void change(
                                selected,
                                selected.archived ? "restore" : "archive",
                              )
                            }
                          >
                            {tr(selected.archived ? "恢复" : "归档")}
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        disabled={detailEditing}
                        onClick={() => setReporting(true)}
                      >
                        {tr("上报进展")}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              `${window.location.origin}${window.location.pathname}?todo=${selected.id}`,
                            );
                            setCopiedTarget({
                              target: "link",
                              time: Date.now(),
                            });
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        {tr(
                          copiedTarget?.target === "link"
                            ? "已复制"
                            : "复制链接",
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void open(selected.id)}
                      >
                        {tr("重新读取")}
                      </Button>
                    </div>
                    <section className="todo-reports">
                      <h3>{tr("关联简报")}</h3>
                      {selected.report_ids.map((id) => (
                        <Link
                          key={id}
                          href={`/?report=${encodeURIComponent(id)}`}
                        >
                          {reports.find((r) => r.id === id)?.title ||
                            tr("查看简报")}
                        </Link>
                      ))}
                      {!!selected.unavailable_reports && (
                        <p className="muted">
                          {tr("{count} 条关联简报不可用", {
                            count: selected.unavailable_reports,
                          })}
                        </p>
                      )}
                      {!selected.report_ids.length &&
                        !selected.unavailable_reports && (
                          <p className="muted">{tr("暂无关联简报")}</p>
                        )}
                    </section>
                    <div className="todo-scopes" role="tablist">
                      {[
                        ["discussion", "讨论"],
                        ["history", "历史"],
                      ].map(([id, label]) => (
                        <button
                          role="tab"
                          aria-selected={tab === id}
                          key={id}
                          className={tab === id ? "active" : ""}
                          onClick={() => setTab(id)}
                        >
                          {tr(label)}
                        </button>
                      ))}
                    </div>
                    {tab === "discussion" ? (
                      <section>
                        {selected.comments.map((c) => (
                          <article className="todo-comment" key={c.id}>
                            <small>
                              {name(c.author_id)} ·{" "}
                              {date(c.created_at, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </small>
                            <p>{c.deleted ? tr("评论已删除") : c.body}</p>
                            {(c.author_id === meta.current_user || admin) && (
                              <button
                                disabled={busy || detailEditing}
                                onClick={() =>
                                  void change(
                                    selected,
                                    c.deleted
                                      ? "restore-comment"
                                      : "delete-comment",
                                    {
                                      comment_id: c.id,
                                    },
                                  )
                                }
                              >
                                {tr(c.deleted ? "恢复" : "删除")}
                              </button>
                            )}
                          </article>
                        ))}
                        <form
                          className="workspace-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void change(selected, "comment", {
                              body: comment,
                              mentions,
                            });
                          }}
                        >
                          <textarea
                            required
                            rows={3}
                            maxLength={10000}
                            aria-label={tr("评论")}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                          />
                          <div className="todo-domains">
                            {meta.members
                              .filter((m) => m.id !== meta.current_user)
                              .map((m) => (
                                <label key={m.id}>
                                  <input
                                    type="checkbox"
                                    checked={mentions.includes(m.id)}
                                    onChange={(e) =>
                                      setMentions(
                                        e.target.checked
                                          ? [...mentions, m.id]
                                          : mentions.filter(
                                              (id) => id !== m.id,
                                            ),
                                      )
                                    }
                                  />
                                  @{m.name}
                                </label>
                              ))}
                          </div>
                          <Button
                            disabled={busy || detailEditing || !comment.trim()}
                          >
                            {tr("发表评论")}
                          </Button>
                        </form>
                      </section>
                    ) : (
                      <section>
                        {[...selected.history].reverse().map((h) => (
                          <details className="todo-history" key={h.id}>
                            <summary>
                              {tr(actions[h.action] || h.action)} ·{" "}
                              {name(h.actor_id)} ·{" "}
                              {date(h.created_at, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </summary>
                            <p>
                              {h.agent} {h.model}
                            </p>
                            <div className="history-snapshots">
                              {(
                                [
                                  ["更新前", h.before],
                                  ["更新后", h.after],
                                ] as [string, Partial<Todo>][]
                              ).map(([label, v]) => (
                                <div key={label}>
                                  <small>{tr(label)}</small>
                                  <strong>{v.title || "—"}</strong>
                                  <p>{v.body}</p>
                                  <p>
                                    {board?.columns.find(
                                      (c) => c.id === v.column_id,
                                    )?.name || "—"}{" "}
                                    ·{" "}
                                    {v.assignee_id
                                      ? name(v.assignee_id)
                                      : tr("未分配")}
                                  </p>
                                  <p>
                                    {meta.projects.find(
                                      (p) => p.id === v.project_id,
                                    )?.name || tr("未归属")}{" "}
                                    · {v.domains?.join(" / ")}
                                  </p>
                                  <p>
                                    {v.due_date} ·{" "}
                                    {tr(priorities[v.priority || "none"])}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </section>
                    )}
                  </>
                )}
              </ManualTaskPanel>
              {!draft.id && (
                <>
                  <TabsContent value="agent">
                    <TodoAgentAccess meta={meta} task={draft} />
                  </TabsContent>
                  <TabsContent value="skill">
                    {creationTab === "skill" && (
                      <AgentAccess
                        method="skill"
                        meta={meta}
                        onSelect={() => {}}
                        onClose={() => setDraft(null)}
                      />
                    )}
                  </TabsContent>
                  <TabsContent value="api">
                    <TodoAPIAccess meta={meta} task={draft} />
                  </TabsContent>
                </>
              )}
              {error && (
                <p className="error-text" role="alert">
                  {tr(error)}
                </p>
              )}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!column}
        onOpenChange={(open) => {
          if (!open) setColumn(null);
        }}
      >
        <DialogContent className="info-dialog column-dialog">
          <DialogTitle className="modal-title">
            {tr(column?.id ? "管理列" : "新增列")}
          </DialogTitle>
          <DialogDescription className="modal-description">
            {column?.id
              ? tr("{count} 项任务", { count: column.task_count || 0 })
              : tr("用列划分任务的推进阶段。")}
          </DialogDescription>
          {column && (
            <form
              className="workspace-form"
              onSubmit={(e) => {
                e.preventDefault();
                void changeColumn(column.id, {
                  name: column.name,
                  done: column.done,
                  expected_revision: column.revision,
                });
              }}
            >
              <label>
                {tr("名称")}
                <input
                  required
                  maxLength={160}
                  value={column.name}
                  onChange={(e) =>
                    setColumn({
                      ...column,
                      name: e.target.value,
                    })
                  }
                />
              </label>
              <label className="column-completion-row">
                <input
                  type="checkbox"
                  checked={column.done}
                  onChange={(e) =>
                    setColumn({ ...column, done: e.target.checked })
                  }
                />
                <span>
                  <strong>{tr("完成列")}</strong>
                  <small>
                    {tr("移入此列的任务视为已完成，不再计入待处理。")}
                  </small>
                </span>
              </label>
              <div className="column-dialog-actions">
                <Button disabled={busy}>{tr("保存")}</Button>
              </div>
              {column.id && (
                <>
                  <label>
                    {tr("归档迁移目标")}
                    <SelectMenu
                      label={tr("归档迁移目标")}
                      value={target}
                      onChange={setTarget}
                      options={[
                        { value: "", label: tr("选择目标列") },
                        ...(board?.columns || [])
                          .filter((c) => !c.archived && c.id !== column.id)
                          .map((c) => ({ value: c.id, label: columnName(c) })),
                      ]}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void changeColumn(column.id, {
                        action: "archive",
                        target_id: target,
                        expected_revision: column.revision,
                      })
                    }
                  >
                    {tr("归档列")}
                  </Button>
                </>
              )}
              {error && (
                <p className="error-text" role="alert">
                  {tr(error)}
                </p>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={reporting} onOpenChange={setReporting}>
        <DialogContent className="info-dialog report-hub-dialog">
          <DialogTitle className="modal-title">{tr("上报进展")}</DialogTitle>
          <DialogDescription className="sr-only">
            {tr("关联任务并记录本次成果")}
          </DialogDescription>
          {selected && (
            <ReportCompose
              meta={meta}
              initialTodo={selected}
              onDone={() => {
                setReporting(false);
                void open(selected.id);
                void load();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
