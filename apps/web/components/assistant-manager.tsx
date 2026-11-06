"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAssistant } from "./assistant-provider";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { SelectMenu } from "./ui/select-menu";
import { civilDay } from "@/lib/calendar";
import { request } from "@/lib/types";
import { publicDemo } from "@/lib/runtime";
import {
  templateTitle,
  templateDescription,
  templateParameterLabel,
} from "@/lib/assistant";
import type {
  AIConversation,
  AITemplate,
  AIJob,
  AIRun,
  AIMCP,
} from "@/lib/assistant";
import { Loader2, Plus, Search } from "lucide-react";

type Page = "history" | "templates" | "jobs" | "mcp";
export type AssistantToolsPage = Exclude<Page, "history">;
export function AssistantTools({
  page,
  onClose,
}: {
  page: AssistantToolsPage;
  onClose: () => void;
}) {
  return page === "templates" ? (
    <TemplateManager onClose={onClose} />
  ) : page === "jobs" ? (
    <JobsManager onClose={onClose} />
  ) : (
    <MCPManager />
  );
}
const tools = [
  "read_workspace",
  "find_todos",
  "find_reports",
  "read_calendar",
  "read_todo",
  "read_report",
  "propose_todo",
  "propose_schedule",
  "propose_report",
];
export function AssistantManager({
  page,
  onClose,
}: {
  page: Page;
  onClose: () => void;
}) {
  const ai = useAssistant(),
    { t: tr } = useI18n();
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="ai-manager">
        <DialogTitle>{tr("任务与工具")}</DialogTitle>
        <DialogDescription>
          {tr("历史、模板和授权执行统一管理。")}
        </DialogDescription>
        <div className="ai-manager-tabs">
          {(
            [
              ["history", "历史对话"],
              ["templates", "任务模板"],
              ["jobs", "定时任务"],
              ["mcp", "MCP 连接"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={page === id}
              onClick={() => ai.setManager(id)}
            >
              {tr(label)}
            </button>
          ))}
        </div>
        {page === "history" ? (
          <AssistantHistory onClose={onClose} />
        ) : page === "templates" ? (
          <TemplateManager onClose={onClose} />
        ) : page === "jobs" ? (
          <JobsManager onClose={onClose} />
        ) : (
          <MCPManager />
        )}
      </DialogContent>
    </Dialog>
  );
}
function useOperation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
function Feedback({ busy, error }: { busy: boolean; error: string }) {
  return (
    <>
      {busy && (
        <Loader2 className="animate-spin" size={16} aria-label="Loading" />
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function AssistantHistory({
  onClose = () => {},
  inline = false,
  highlightCurrent = true,
}: {
  onClose?: () => void;
  inline?: boolean;
  highlightCurrent?: boolean;
}) {
  const ai = useAssistant(),
    { t: tr, locale, timeZone } = useI18n(),
    op = useOperation();
  const [q, setQ] = useState(""),
    [state, setState] = useState("active"),
    [items, setItems] = useState<AIConversation[]>(() => ai.conversations),
    [cursor, setCursor] = useState(""),
    [edit, setEdit] = useState<AIConversation | null>(null),
    [action, setAction] = useState(""),
    [title, setTitle] = useState("");
  const searchSequence = useRef(0);
  const load = useCallback(
    async (more = "") => {
      const sequence = ++searchSequence.current;
      const v = await request<{ items: AIConversation[]; next_cursor: string }>(
        `/assistant/conversations?${new URLSearchParams({ q, state, cursor: more })}`,
      );
      if (sequence !== searchSequence.current) return;
      setItems((xs) => (more ? [...xs, ...v.items] : v.items));
      setCursor(v.next_cursor || "");
    },
    [q, state],
  );
  useEffect(() => {
    if (!q) {
      void op.run(() => load());
      return;
    }
    const t = setTimeout(() => void op.run(() => load()), 250);
    return () => clearTimeout(t);
  }, [load, ai.conversations]);
  function group(c: AIConversation) {
    const day = civilDay(c.updated_at, timeZone),
      today = civilDay(new Date(), timeZone);
    if (day === today) return tr("今天");
    const yesterday = new Date(`${today}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return day === yesterday.toISOString().slice(0, 10)
      ? tr("昨天")
      : tr("更早");
  }

  return (
    <div className="ai-manager-body">
      <div className="ai-manager-row">
        <label className="ai-search">
          <Search size={14} />
          <input
            aria-label={tr("搜索会话")}
            placeholder={tr("搜索会话")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <SelectMenu
          label={tr("历史状态")}
          value={state}
          onChange={(v) => {
            setState(v);
            setItems([]);
            setCursor("");
          }}
          options={[
            { value: "active", label: tr("进行中") },
            { value: "archived", label: tr("已归档") },
            { value: "deleted", label: tr("回收站") },
          ]}
        />
      </div>
      <Feedback {...op} />
      {!items.length && !op.busy && <p className="muted">{tr("还没有对话")}</p>}
      {items.map((c, i) => (
        <div key={c.id}>
          {(i === 0 || group(c) !== group(items[i - 1])) && (
            <h4 className="ai-history-group">{group(c)}</h4>
          )}
          <div
            className={`ai-management-item${highlightCurrent && ai.current?.id === c.id ? " is-current" : ""}`}
          >
            <button
              aria-current={
                highlightCurrent && ai.current?.id === c.id ? "page" : undefined
              }
              type="button"
              disabled={op.busy || ai.busy || state === "deleted"}
              onClick={() =>
                void op.run(async () => {
                  await ai.openConversation(c.id);
                  onClose();
                })
              }
            >
              <strong>{c.title}</strong>
              {!inline && (
                <small>
                  {new Date(c.updated_at).toLocaleString(locale, { timeZone })}
                </small>
              )}
            </button>
            <div className="ai-item-actions">
              {(state === "deleted"
                ? [["restore", "恢复"]]
                : state === "archived"
                  ? [
                      ["unarchive", "取消归档"],
                      ["delete", "删除"],
                    ]
                  : [
                      ["rename", "重命名"],
                      ["archive", "归档"],
                      ["delete", "删除"],
                    ]
              ).map(([a, label]) => (
                <button
                  key={a}
                  type="button"
                  disabled={op.busy}
                  onClick={() => {
                    setEdit(c);
                    setAction(a);
                    setTitle(c.title);
                  }}
                >
                  {tr(label)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
      {cursor && (
        <Button
          variant="ghost"
          disabled={op.busy}
          onClick={() => void op.run(() => load(cursor))}
        >
          {tr("加载更多")}
        </Button>
      )}
      {edit && (
        <div className="ai-inline-confirm">
          <strong>
            {tr(
              action === "rename"
                ? "重命名"
                : action === "delete"
                  ? "移入回收站？"
                  : "确认更改会话状态？",
            )}
          </strong>
          {action === "rename" && (
            <input
              aria-label={tr("会话标题")}
              value={title}
              maxLength={180}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
          <div>
            <Button
              size="sm"
              disabled={op.busy}
              onClick={() =>
                void op.run(async () => {
                  await request(`/assistant/conversations/${edit.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      action,
                      title,
                      expected_revision: edit.revision,
                    }),
                  });
                  if (ai.current?.id === edit.id) {
                    if (action === "rename") await ai.openConversation(edit.id);
                    else if (action === "archive" || action === "delete")
                      ai.newConversation();
                  }
                  setEdit(null);
                  await load();
                })
              }
            >
              {tr("确认")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {tr("取消")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
function TemplateManager({ onClose }: { onClose: () => void }) {
  const ai = useAssistant(),
    { t: tr } = useI18n(),
    auth = useAuth(),
    op = useOperation();
  const [items, setItems] = useState<AITemplate[]>([]),
    [edit, setEdit] = useState<AITemplate | null>(null),
    [selected, setSelected] = useState<AITemplate | null>(null),
    [parameters, setParameters] = useState<Record<string, string>>({}),
    [parameterText, setParameterText] = useState("");
  const admin = auth.me?.role === "admin";
  async function load() {
    const v = await request<{ items: AITemplate[] }>("/assistant/templates");
    setItems(v.items);
  }
  useEffect(() => {
    void op.run(load);
  }, []);
  const fresh = (): AITemplate => ({
    id: "",
    scope: "personal",
    title: "",
    description: "",
    instructions: "",
    parameters: [],
    tools: tools.slice(0, 6),
    version: 0,
    revision: 0,
    editable: true,
  });
  return (
    <div className="ai-manager-body">
      <Feedback {...op} />
      {!edit && !selected && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEdit(fresh());
              setParameterText("");
            }}
          >
            <Plus size={14} />
            {tr("新建模板")}
          </Button>
          {items.map((t) => (
            <div className="ai-management-item" key={t.id}>
              <button
                type="button"
                onClick={() => {
                  setSelected(t);
                  setParameters({});
                }}
              >
                <strong>
                  {templateTitle(t, tr)}{" "}
                  <small>
                    v{t.version} ·{" "}
                    {tr(
                      t.scope === "builtin"
                        ? "内置"
                        : t.scope === "team"
                          ? "团队共用"
                          : "个人",
                    )}
                  </small>
                </strong>
                <small>{templateDescription(t, tr)}</small>
              </button>
              {t.editable && (
                <button
                  type="button"
                  onClick={() => {
                    setEdit({ ...t });
                    setParameterText(
                      t.parameters.map((p) => p.name).join(", "),
                    );
                  }}
                >
                  {tr("编辑")}
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {selected && (
        <>
          <h3>
            {templateTitle(selected, tr)} · v{selected.version}
          </h3>
          <p className="ai-template-preview">{selected.instructions}</p>
          {selected.parameters.map((p) => (
            <label key={p.name}>
              {templateParameterLabel(selected, p, tr)}
              {p.required ? " *" : ""}
              <input
                value={parameters[p.name] || ""}
                maxLength={1000}
                onChange={(e) =>
                  setParameters({ ...parameters, [p.name]: e.target.value })
                }
              />
            </label>
          ))}
          <small>
            {tr("工具范围")}: {selected.tools.join(", ")}
          </small>
          <div className="ai-manager-row">
            <Button
              size="sm"
              disabled={
                ai.busy ||
                selected.parameters.some(
                  (p) => p.required && !parameters[p.name]?.trim(),
                )
              }
              onClick={() => {
                ai.setTemplate(selected, parameters);
                ai.setInput(
                  tr("按所选模板执行，先读取真实数据，准备结果供我确认。"),
                );
                onClose();
              }}
            >
              {tr("使用此版本")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              {tr("返回")}
            </Button>
          </div>
        </>
      )}
      {edit && (
        <form
          className="ai-manager-form"
          onSubmit={(e) => {
            e.preventDefault();
            void op.run(async () => {
              const params = parameterText
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
                .map((name) => ({
                  name,
                  label:
                    edit.parameters.find((p) => p.name === name)?.label || name,
                  required:
                    edit.parameters.find((p) => p.name === name)?.required ||
                    false,
                }));
              await request("/assistant/templates", {
                method: "POST",
                body: JSON.stringify({ ...edit, parameters: params }),
              });
              setEdit(null);
              await load();
            });
          }}
        >
          <label>
            {tr("名称")}
            <input
              required
              value={edit.title}
              maxLength={180}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
            />
          </label>
          <SelectMenu
            label={tr("范围")}
            value={edit.scope}
            disabled={!!edit.id}
            options={[
              { value: "personal", label: tr("个人") },
              ...(admin ? [{ value: "team", label: tr("团队共用") }] : []),
            ]}
            onChange={(v) =>
              setEdit({ ...edit, scope: v as AITemplate["scope"] })
            }
          />
          <label>
            {tr("说明")}
            <input
              value={edit.description}
              maxLength={500}
              onChange={(e) =>
                setEdit({ ...edit, description: e.target.value })
              }
            />
          </label>
          <label>
            {tr("参数名（逗号分隔）")}
            <input
              value={parameterText}
              placeholder="project, period"
              onChange={(e) => setParameterText(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>{tr("必填参数")}</legend>
            {parameterText
              .split(",")
              .map((n) => n.trim())
              .filter(Boolean)
              .map((name) => (
                <label key={name} className="ai-check">
                  <input
                    type="checkbox"
                    checked={
                      edit.parameters.find((p) => p.name === name)?.required ||
                      false
                    }
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        parameters: [
                          ...edit.parameters.filter((p) => p.name !== name),
                          { name, label: name, required: e.target.checked },
                        ],
                      })
                    }
                  />
                  {name}
                </label>
              ))}
          </fieldset>
          <label>
            {tr("模板指令")}
            <textarea
              required
              rows={6}
              maxLength={12000}
              value={edit.instructions}
              onChange={(e) =>
                setEdit({ ...edit, instructions: e.target.value })
              }
              placeholder={tr("使用 {{project}} 引用参数")}
            />
          </label>
          <fieldset>
            <legend>{tr("工具范围")}</legend>
            {tools.map((t) => (
              <label className="ai-check" key={t}>
                <input
                  type="checkbox"
                  checked={edit.tools.includes(t)}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      tools: e.target.checked
                        ? [...edit.tools, t]
                        : edit.tools.filter((v) => v !== t),
                    })
                  }
                />
                {t}
              </label>
            ))}
          </fieldset>
          <small>{tr("保存生成新版本，旧会话与定时任务保持原版本。")}</small>
          <div className="ai-manager-row">
            <Button size="sm" disabled={op.busy} type="submit">
              {tr("保存新版本")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {tr("取消")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
function JobsManager({ onClose }: { onClose: () => void }) {
  const ai = useAssistant(),
    { t: tr, locale, timeZone } = useI18n(),
    params = useSearchParams(),
    op = useOperation();
  const [items, setItems] = useState<AIJob[]>([]),
    [templates, setTemplates] = useState<AITemplate[]>([]),
    [edit, setEdit] = useState<AIJob | null>(null),
    [runs, setRuns] = useState<AIRun[] | null>(null),
    [runTitle, setRunTitle] = useState(""),
    [preview, setPreview] = useState("");
  useEffect(() => {
    let alive = true;
    setPreview("");
    if (!edit) return;
    const t = setTimeout(() => {
      void request<{ next_run_at: string }>(
        `/assistant/jobs/preview?${new URLSearchParams({ timezone: edit.timezone, local_time: edit.local_time, weekdays: edit.weekdays.join(",") })}`,
      )
        .then((v) => {
          if (alive) setPreview(v.next_run_at);
        })
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [edit?.timezone, edit?.local_time, JSON.stringify(edit?.weekdays)]);
  async function load() {
    const [j, t] = await Promise.all([
      request<{ items: AIJob[] }>("/assistant/jobs"),
      request<{ items: AITemplate[] }>("/assistant/templates"),
    ]);
    setItems(j.items);
    setTemplates(t.items);
  }
  useEffect(() => {
    void op.run(load);
  }, []);
  function fresh(): AIJob {
    return {
      id: "",
      title: "",
      config_id: ai.configID,
      config_revision: 0,
      template: ai.template || templates[0],
      parameters: ai.parameters,
      context: {
        page: "/assistant",
        project: params.get("project") || "",
        domain: params.get("domain") || "",
        member: params.get("member") || "",
        timezone: timeZone,
      },
      prompt:
        ai.input ||
        tr("检查所选范围的进度和阻塞，引用来源，有交付时准备简报草稿。"),
      locale,
      timezone: timeZone,
      local_time: "09:00",
      weekdays: [1, 2, 3, 4, 5],
      publish: false,
      enabled: true,
      revision: 0,
      next_run_at: "",
    };
  }
  return (
    <div className="ai-manager-body">
      <Feedback {...op} />
      {publicDemo && (
        <p className="muted">{tr("演示仅保存配置，不执行定时任务。")}</p>
      )}
      {!edit && runs === null && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={!ai.configured || !templates.length || !ai.configID}
            onClick={() => setEdit(fresh())}
          >
            <Plus size={14} />
            {tr("新建定时任务")}
          </Button>
          {items.length === 0 && <p className="muted">{tr("尚无定时任务")}</p>}
          {items.map((j) => (
            <div className="ai-management-item" key={j.id}>
              <button type="button" onClick={() => setEdit(j)}>
                <strong>
                  {j.title} · {tr(j.enabled ? "已启用" : "已暂停")}
                  {j.last_run_state && ` · ${tr(j.last_run_state)}`}
                </strong>
                <small>
                  {new Date(j.next_run_at).toLocaleString(locale, {
                    timeZone: j.timezone,
                  })}{" "}
                  · {j.timezone} · {templateTitle(j.template, tr)} v
                  {j.template.version}
                </small>
              </button>
              <div className="ai-item-actions">
                <button
                  type="button"
                  disabled={op.busy}
                  onClick={() =>
                    void op.run(async () => {
                      const v = await request<{ items: AIRun[] }>(
                        `/assistant/jobs/${j.id}/runs`,
                      );
                      setRuns(v.items);
                      setRunTitle(j.title);
                    })
                  }
                >
                  {tr("执行记录")}
                </button>
                <button
                  type="button"
                  disabled={op.busy}
                  onClick={() =>
                    void op.run(async () => {
                      if (j.enabled)
                        await request(`/assistant/jobs/${j.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            expected_revision: j.revision,
                          }),
                        });
                      else
                        await request("/assistant/jobs", {
                          method: "POST",
                          body: JSON.stringify({ ...j, enabled: true }),
                        });
                      await load();
                    })
                  }
                >
                  {tr(j.enabled ? "暂停" : "恢复")}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {runs !== null && (
        <>
          <h3>{runTitle}</h3>
          {!runs.length && <p>{tr("暂无执行记录")}</p>}
          {runs.map((r) => (
            <div className="ai-management-item" key={r.id}>
              <div>
                <strong>
                  {tr(r.state)} ·{" "}
                  {new Date(r.scheduled_at).toLocaleString(locale, {
                    timeZone,
                  })}
                </strong>
                <small>{r.message}</small>
              </div>
              {r.conversation_id && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void op.run(async () => {
                      await ai.openConversation(r.conversation_id!);
                      onClose();
                    })
                  }
                >
                  {tr("查看结果")}
                </Button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setRuns(null)}>
            {tr("返回")}
          </Button>
        </>
      )}
      {edit && (
        <form
          className="ai-manager-form"
          onSubmit={(e) => {
            e.preventDefault();
            void op.run(async () => {
              await request("/assistant/jobs", {
                method: "POST",
                body: JSON.stringify(edit),
              });
              setEdit(null);
              await load();
            });
          }}
        >
          <label>
            {tr("名称")}
            <input
              required
              value={edit.title}
              maxLength={180}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
            />
          </label>
          <SelectMenu
            label={tr("AI 配置与模型")}
            value={edit.config_id}
            options={ai.configs
              .filter((c) => c.verified_at)
              .map((c) => ({ value: c.id, label: `${c.name} · ${c.model}` }))}
            onChange={(v) => setEdit({ ...edit, config_id: v })}
          />
          <SelectMenu
            label={tr("任务模板")}
            value={`${edit.template.id}:${edit.template.version}`}
            options={[
              edit.template,
              ...templates.filter(
                (t) =>
                  t.id !== edit.template.id ||
                  t.version !== edit.template.version,
              ),
            ].map((t) => ({
              value: `${t.id}:${t.version}`,
              label: `${templateTitle(t, tr)} · v${t.version}`,
            }))}
            onChange={(v) => {
              const t = templates.find((t) => `${t.id}:${t.version}` === v);
              if (t) setEdit({ ...edit, template: t, parameters: {} });
            }}
          />
          {edit.template.parameters.map((p) => (
            <label key={p.name}>
              {templateParameterLabel(edit.template, p, tr)}
              {p.required ? " *" : ""}
              <input
                required={p.required}
                maxLength={1000}
                value={edit.parameters?.[p.name] || ""}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    parameters: {
                      ...edit.parameters,
                      [p.name]: e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
          <label>
            {tr("请求")}
            <textarea
              required
              maxLength={6000}
              rows={4}
              value={edit.prompt}
              onChange={(e) => setEdit({ ...edit, prompt: e.target.value })}
            />
          </label>
          <div className="ai-manager-row">
            <label>
              {tr("运行时间")}
              <input
                type="time"
                required
                value={edit.local_time}
                onChange={(e) =>
                  setEdit({ ...edit, local_time: e.target.value })
                }
              />
            </label>
            <label>
              {tr("时区")}
              <input
                required
                value={edit.timezone}
                onChange={(e) => setEdit({ ...edit, timezone: e.target.value })}
              />
            </label>
          </div>
          <div className="ai-weekdays">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <label className="ai-check" key={d}>
                <input
                  type="checkbox"
                  checked={edit.weekdays.includes(d)}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      weekdays: e.target.checked
                        ? [...edit.weekdays, d]
                        : edit.weekdays.filter((x) => x !== d),
                    })
                  }
                />
                {new Intl.DateTimeFormat(locale, {
                  weekday: "short",
                  timeZone: "UTC",
                }).format(new Date(Date.UTC(2026, 10, 1 + d)))}
              </label>
            ))}
          </div>
          <small>
            {tr(
              "范围沿用创建时的项目、领域和负责人筛选。无变化不重复产出；默认只读和草稿。",
            )}
          </small>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={edit.publish}
              onChange={(e) => setEdit({ ...edit, publish: e.target.checked })}
            />
            {tr("授权自动发布简报到本团队 Timeline")}
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={edit.enabled}
              onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
            />
            {tr("启用定时任务")}
          </label>
          <small>
            {tr("保存即确认所选模型、数据范围、模板版本与授权。")}
            {preview && (
              <span>
                {tr("下次运行")}:{" "}
                {new Date(preview).toLocaleString(locale, {
                  timeZone: edit.timezone,
                })}{" "}
                · {edit.timezone}
              </span>
            )}
          </small>
          <div className="ai-manager-row">
            <Button
              size="sm"
              disabled={op.busy || !edit.weekdays.length}
              type="submit"
            >
              {tr("确认保存")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {tr("取消")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
function MCPManager() {
  const ai = useAssistant(),
    auth = useAuth(),
    { t: tr } = useI18n(),
    op = useOperation();
  const [items, setItems] = useState<AIMCP[]>([]),
    [edit, setEdit] = useState<AIMCP | null>(null),
    [approval, setApproval] = useState<AIMCP | null>(null),
    [names, setNames] = useState<string[]>([]);
  const admin = auth.me?.role === "admin";
  async function load() {
    const v = await request<{ items: AIMCP[] }>("/assistant/mcp");
    setItems(v.items);
  }
  useEffect(() => {
    void op.run(load);
  }, []);
  return (
    <div className="ai-manager-body">
      <Feedback {...op} />
      <p className="muted">
        {tr("远程 HTTPS 只读工具；先验证，再选择授权工具。外部结果仅作参考。")}
      </p>
      {publicDemo && (
        <p className="muted">{tr("离线演示不连接外部 MCP 或保存令牌")}</p>
      )}
      {!edit && !approval && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={publicDemo}
            onClick={() =>
              setEdit({
                id: "",
                name: "",
                scope: "personal",
                url: "",
                revision: 0,
                tools: [],
                approved_tools: [],
                verified_at: null,
                editable: true,
                token: "",
              })
            }
          >
            <Plus size={14} />
            {tr("新建连接")}
          </Button>
          {items.map((c) => (
            <div className="ai-management-item" key={c.id}>
              <label className="ai-check">
                <input
                  type="checkbox"
                  disabled={
                    !c.verified_at || !c.approved_tools.length || ai.busy
                  }
                  checked={ai.mcpIDs.includes(c.id)}
                  onChange={(e) =>
                    ai.setMCPIDs(
                      e.target.checked
                        ? [...ai.mcpIDs, c.id]
                        : ai.mcpIDs.filter((id) => id !== c.id),
                    )
                  }
                />
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.url} · {c.approved_tools.length} {tr("已授权工具")}
                  </small>
                </span>
              </label>
              {c.editable && (
                <div className="ai-item-actions">
                  <button
                    type="button"
                    onClick={() => setEdit({ ...c, token: "" })}
                  >
                    {tr("编辑")}
                  </button>
                  <button
                    type="button"
                    disabled={op.busy}
                    onClick={() =>
                      void op.run(async () => {
                        const v = await request<AIMCP>(
                          `/assistant/mcp/${c.id}/verify`,
                          { method: "POST", body: "{}" },
                        );
                        setApproval(v);
                        setNames(v.approved_tools.map((t) => t.name));
                        await load();
                      })
                    }
                  >
                    {tr("验证与授权")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {edit && (
        <form
          className="ai-manager-form"
          onSubmit={(e) => {
            e.preventDefault();
            void op.run(async () => {
              await request("/assistant/mcp", {
                method: "POST",
                body: JSON.stringify(edit),
              });
              setEdit(null);
              await load();
            });
          }}
        >
          <label>
            {tr("名称")}
            <input
              required
              maxLength={120}
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </label>
          <SelectMenu
            label={tr("范围")}
            disabled={!!edit.id}
            value={edit.scope}
            options={[
              { value: "personal", label: tr("个人") },
              ...(admin ? [{ value: "team", label: tr("团队共用") }] : []),
            ]}
            onChange={(v) =>
              setEdit({ ...edit, scope: v as "personal" | "team" })
            }
          />
          <label>
            {tr("MCP 服务地址")}
            <input
              required
              type="url"
              value={edit.url}
              placeholder="https://example.com/mcp"
              onChange={(e) => setEdit({ ...edit, url: e.target.value })}
            />
          </label>
          <label>
            {tr("访问令牌（可选）")}
            <input
              type="password"
              autoComplete="new-password"
              value={edit.token || ""}
              onChange={(e) => setEdit({ ...edit, token: e.target.value })}
            />
          </label>
          <small>
            {tr("使用服务商签发的 Bearer Token。修改连接会清除原工具授权。")}
          </small>
          <div className="ai-manager-row">
            <Button size="sm" disabled={op.busy} type="submit">
              {tr("保存")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {tr("取消")}
            </Button>
          </div>
        </form>
      )}
      {approval && (
        <>
          <h3>{approval.name}</h3>
          {approval.tools.length === 0 && (
            <p>{tr("该服务未声明可用的只读工具。")}</p>
          )}
          {approval.tools.map((t) => (
            <label className="ai-check" key={t.name}>
              <input
                type="checkbox"
                checked={names.includes(t.name)}
                onChange={(e) =>
                  setNames(
                    e.target.checked
                      ? [...names, t.name]
                      : names.filter((n) => n !== t.name),
                  )
                }
              />
              <span>
                <strong>{t.name}</strong>
                <small>{t.description}</small>
              </span>
            </label>
          ))}
          <div className="ai-manager-row">
            <Button
              size="sm"
              disabled={op.busy}
              onClick={() =>
                void op.run(async () => {
                  await request(`/assistant/mcp/${approval.id}/approve`, {
                    method: "POST",
                    body: JSON.stringify({
                      expected_revision: approval.revision,
                      tools: names,
                    }),
                  });
                  setApproval(null);
                  await load();
                })
              }
            >
              {tr("确认授权")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setApproval(null)}>
              {tr("取消")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
export function AssistantCalendarPlans() {
  const params = useSearchParams();
  const ai = useAssistant(),
    { t: tr, locale } = useI18n();
  const [jobs, setJobs] = useState<AIJob[]>([]);
  useEffect(() => {
    let alive = true;
    void request<{ items: AIJob[] }>("/assistant/jobs")
      .then(
        (v) =>
          alive &&
          setJobs(
            v.items.filter(
              (j) =>
                j.enabled &&
                ["project", "domain", "member"].every(
                  (k) =>
                    !params.get(k) ||
                    !j.context[k] ||
                    j.context[k] === params.get(k),
                ),
            ),
          ),
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [
    ai.manager,
    params.get("project"),
    params.get("domain"),
    params.get("member"),
  ]);
  if (!jobs.length) return null;
  return (
    <div className="ai-calendar-plans">
      <span>{tr("定时计划")}</span>
      {jobs.slice(0, 3).map((j) => (
        <button key={j.id} type="button" onClick={() => ai.setManager("jobs")}>
          {j.title}
          {j.last_run_state && ` · ${tr(j.last_run_state)}`} ·{" "}
          {new Date(j.next_run_at).toLocaleString(locale, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: j.timezone,
          })}
        </button>
      ))}
    </div>
  );
}
