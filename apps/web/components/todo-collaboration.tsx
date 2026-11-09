"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useI18n } from "./i18n-provider";
import { ScheduleEditor } from "./schedule-editor";
import type { Schedule } from "@/lib/calendar";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { LoadingStatus, PageLoading } from "./ui/loading-status";
import { request, type Meta } from "@/lib/types";
import type { Todo } from "@/lib/todo";
import type { Delegation } from "@/lib/context";
const actions: Record<string, string> = {
  edit: "编辑内容",
  move: "推进状态",
  comment: "评论",
  schedule: "调整排期",
};
export function DelegationManager({
  meta,
  todo,
  onClose,
}: {
  meta: Meta;
  todo?: Todo;
  onClose: () => void;
}) {
  const { t: tr, date } = useI18n();
  const [items, setItems] = useState<Delegation[]>([]),
    [loading, setLoading] = useState(true),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [member, setMember] = useState(""),
    [scope, setScope] = useState("todo"),
    [object, setObject] = useState(todo?.id || ""),
    [allowed, setAllowed] = useState<string[]>(["comment"]),
    [expires, setExpires] = useState(
      new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    );
  async function load() {
    setLoading(true);
    try {
      const v = await request<{ items: Delegation[] }>("/delegations");
      setItems(v.items);
      setLoaded(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const grantOperation = useRef({ payload: "", id: "" });
  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        member_id: member,
        todo_id: scope === "todo" ? object : "",
        project_id: scope === "project" ? object : "",
        actions: allowed,
        expires_at: new Date(expires + "T23:59:59").toISOString(),
      };
      const fingerprint = JSON.stringify(payload);
      if (grantOperation.current.payload !== fingerprint)
        grantOperation.current = {
          payload: fingerprint,
          id: crypto.randomUUID(),
        };
      await request("/delegations", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          operation_id: grantOperation.current.id,
        }),
      });
      setMember("");
      grantOperation.current = { payload: "", id: "" };
      await load();
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
        <DialogTitle className="modal-title">{tr("持续委托")}</DialogTitle>
        <DialogDescription className="modal-description">
          {tr("限定对象、动作和有效期；不会启动 Agent，也不扩大凭证权限。")}
        </DialogDescription>
        <LoadingStatus active={loaded && loading} />
        {error && <p role="alert">{tr(error)}</p>}
        {!loaded && loading ? (
          <PageLoading variant="list" />
        ) : (
          <div>
            {items
              .filter(
                (x) =>
                  !todo ||
                  x.todo_id === todo.id ||
                  (!!x.project_id && x.project_id === todo.project_id),
              )
              .map((d) => (
                <div className="context-source" key={d.id}>
                  <strong>
                    {meta.members.find((m) => m.id === d.member_id)?.name ||
                      d.member_id}
                  </strong>
                  <p>
                    {d.todo_id ? (
                      <Link href={"/todo?todo=" + d.todo_id}>{d.todo_id}</Link>
                    ) : (
                      meta.projects.find((p) => p.id === d.project_id)?.name
                    )}{" "}
                    · {d.actions.map((a) => tr(actions[a])).join(" / ")}
                  </p>
                  <small>
                    {date(d.expires_at)} ·{" "}
                    {tr(
                      d.revoked_at
                        ? "已撤销"
                        : Date.parse(d.expires_at) < Date.now()
                          ? "已过期"
                          : "有效",
                    )}
                  </small>
                  {!d.revoked_at &&
                    (d.grantor_id === meta.current_user ||
                      meta.role === "admin") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await request("/delegations/" + d.id, {
                              method: "PATCH",
                              body: JSON.stringify({
                                action: "revoke",
                                expected_revision: d.revision,
                                operation_id: `revoke:${d.id}:${d.revision}`,
                              }),
                            });
                            await load();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {tr("撤销委托")}
                      </Button>
                    )}
                </div>
              ))}
          </div>
        )}
        <form className="workspace-form" onSubmit={grant}>
          <h3>{tr("新建委托")}</h3>
          <div className="context-fields">
            <label>
              {tr("成员")}
              <select
                aria-label={tr("成员")}
                required
                value={member}
                onChange={(e) => setMember(e.target.value)}
              >
                <option value="">{tr("选择成员")}</option>
                {meta.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("范围")}
              <select
                aria-label={tr("范围")}
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setObject("");
                }}
              >
                <option value="todo">Todo</option>
                {meta.role === "admin" && (
                  <option value="project">{tr("项目")}</option>
                )}
              </select>
            </label>
            <label>
              {tr(scope === "todo" ? "任务 ID" : "项目")}
              {scope === "todo" ? (
                <input
                  required
                  value={object}
                  onChange={(e) => setObject(e.target.value)}
                />
              ) : (
                <select
                  required
                  value={object}
                  onChange={(e) => setObject(e.target.value)}
                >
                  <option value="">{tr("选择项目")}</option>
                  {meta.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              {tr("有效截至")}
              <input
                required
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </label>
          </div>
          <div className="context-choices">
            {Object.entries(actions).map(([a, label]) => (
              <label key={a}>
                <input
                  type="checkbox"
                  checked={allowed.includes(a)}
                  onChange={(e) =>
                    setAllowed(
                      e.target.checked
                        ? [...allowed, a]
                        : allowed.filter((x) => x !== a),
                    )
                  }
                />
                {tr(label)}
              </label>
            ))}
          </div>
          <Button disabled={busy || allowed.length === 0}>
            {tr("授权委托")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function TodoCollaboration({
  task,
  tasks,
  meta,
  writable,
  busy,
  onSave,
  onAction,
  columns,
}: {
  task: Todo;
  tasks: Todo[];
  meta: Meta;
  writable: boolean;
  busy: boolean;
  onSave: (v: Record<string, unknown>) => Promise<boolean>;
  onAction: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<boolean>;
  columns: { id: string; name: string; archived: boolean }[];
}) {
  const { t: tr } = useI18n();
  const [delegateBody, setDelegateBody] = useState(task.body),
    [schedule, setSchedule] = useState<Schedule | null | undefined>(
      task.schedule,
    );
  const [editing, setEditing] = useState(false),
    [values, setValues] = useState(task.blockers || []),
    [delegating, setDelegating] = useState(false);
  useEffect(() => {
    setValues(task.blockers || []);
    setEditing(false);
  }, [task.id, task.revision]);
  return (
    <section className="blocker-panel">
      <div className="context-actions">
        <strong>{tr("阻塞与依赖")}</strong>
        <span className={task.blocked ? "context-warning" : "muted"}>
          {tr(task.blocked ? "等待解除阻塞" : "可继续推进")}
        </span>
        {writable && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            {tr(editing ? "取消" : "编辑")}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setDelegating(true)}>
          {tr("持续委托")}
        </Button>
      </div>
      {editing ? (
        <div className="workspace-form">
          {values.map((v, i) => (
            <div className="context-source" key={v.id}>
              <label>
                {tr("前置任务")}
                <input
                  list="dependency-tasks"
                  value={v.todo_id}
                  onChange={(e) =>
                    setValues(
                      values.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              todo_id: e.target.value,
                              resolved_at: undefined,
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                {tr("等待成员")}
                <select
                  value={v.waiting_member_id}
                  onChange={(e) =>
                    setValues(
                      values.map((x, j) =>
                        j === i
                          ? { ...x, waiting_member_id: e.target.value }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="">{tr("无")}</option>
                  {meta.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr("解除条件")}
                <textarea
                  aria-label={tr("解除条件")}
                  maxLength={2000}
                  value={v.condition}
                  onChange={(e) =>
                    setValues(
                      values.map((x, j) =>
                        j === i ? { ...x, condition: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              {!v.todo_id && (
                <label className="blocker-row">
                  <input
                    type="checkbox"
                    checked={!!v.resolved_at}
                    onChange={(e) =>
                      setValues(
                        values.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                resolved_at: e.target.checked
                                  ? new Date().toISOString()
                                  : undefined,
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  {tr("条件已满足")}
                </label>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setValues(values.filter((_, j) => j !== i))}
              >
                {tr("移除")}
              </Button>
            </div>
          ))}
          <datalist id="dependency-tasks">
            {tasks
              .filter((t) => t.id !== task.id && !t.archived)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </datalist>
          <div className="context-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={values.length >= 20}
              onClick={() =>
                setValues([
                  ...values,
                  {
                    id: crypto.randomUUID(),
                    todo_id: "",
                    waiting_member_id: "",
                    condition: "",
                  },
                ])
              }
            >
              + {tr("添加阻塞")}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                if (await onSave({ blockers: values })) setEditing(false);
              }}
            >
              {tr("保存")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          {task.blockers?.map((v) => (
            <div className="context-source" key={v.id}>
              <div className="blocker-row">
                {v.todo_id && (
                  <Link href={"/todo?todo=" + v.todo_id}>
                    {tasks.find((t) => t.id === v.todo_id)?.title || v.todo_id}
                  </Link>
                )}
                {v.waiting_member_id && (
                  <span>
                    {meta.members.find((m) => m.id === v.waiting_member_id)
                      ?.name || v.waiting_member_id}
                  </span>
                )}
                {v.resolved_at && <span>{tr("条件已满足")}</span>}
              </div>
              <p>{v.condition}</p>
            </div>
          ))}
        </div>
      )}
      {!writable && !!task.allowed_actions?.length && (
        <details>
          <summary>{tr("委托范围内推进")}</summary>
          {task.allowed_actions.includes("edit") && (
            <div className="workspace-form">
              <textarea
                aria-label={tr("内容")}
                value={delegateBody}
                onChange={(e) => setDelegateBody(e.target.value)}
              />
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void onSave({ body: delegateBody })}
              >
                {tr("保存")}
              </Button>
            </div>
          )}
          {task.allowed_actions.includes("move") && (
            <select
              aria-label={tr("推进状态")}
              value={task.column_id}
              disabled={busy}
              onChange={(e) =>
                void onAction("move", { column_id: e.target.value })
              }
            >
              {columns
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {tr(c.name)}
                  </option>
                ))}
            </select>
          )}
          {task.allowed_actions.includes("schedule") && (
            <div>
              <ScheduleEditor value={schedule} onChange={setSchedule} />
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void onSave({ schedule })}
              >
                {tr("保存排期")}
              </Button>
            </div>
          )}
        </details>
      )}
      {delegating && (
        <DelegationManager
          meta={meta}
          todo={task}
          onClose={() => setDelegating(false)}
        />
      )}
    </section>
  );
}
