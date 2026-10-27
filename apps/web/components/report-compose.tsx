"use client";

import { useI18n } from "@/components/i18n-provider";
import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { publicDemo } from "@/lib/runtime";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  Meta,
  Report,
  reportDomains,
  request,
  statuses,
} from "@/lib/types";
import type { Todo, TodoBoardData } from "@/lib/todo";
export function ReportCompose({
  meta,
  onDone,
  report,
  onCancel,
  onStale,
  initialTodo,
}: {
  meta: Meta;
  onDone: () => void;
  report?: Report;
  onCancel?: () => void;
  onStale?: () => void;
  initialTodo?: Todo;
}) {
  const { t: tr } = useI18n();
  const [title, setTitle] = useState(report?.title || ""),
    [body, setBody] = useState(report?.body || ""),
    [project, setProject] = useState(
      report
        ? meta.mode === "local-demo"
          ? report.project_id
          : meta.projects.find((p) => p.id === report.project_id)?.name ||
            report.project_id
        : initialTodo?.project_id || "",
    ),
    [domain, setDomain] = useState(
      report
        ? reportDomains(report).join("，")
        : initialTodo?.domains.join("，") || "",
    ),
    [agent, setAgent] = useState(report?.agent || "手动上报"),
    [status, setStatus] = useState(report?.status || "progress"),
    [mentions, setMentions] = useState<string[]>(report?.mentions || []),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [expectedUpdatedAt] = useState(report?.updated_at);
  const [links, setLinks] = useState(() =>
    (report?.links.length
      ? report.links
      : [
          {
            title: "",
            url: "",
          },
        ]
    ).map((l) => ({
      ...l,
      key: crypto.randomUUID(),
    })),
  );
  const [todoIds, setTodoIds] = useState<string[]>(
    report?.todo_ids || (initialTodo ? [initialTodo.id] : []),
  );
  const [todos, setTodos] = useState<Todo[]>(initialTodo ? [initialTodo] : []),
    [todoBoard, setTodoBoard] = useState<TodoBoardData | null>(null),
    [moves, setMoves] = useState<Record<string, string>>({}),
    [todoQuery, setTodoQuery] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const b = await request<TodoBoardData>("/todo-board");
        let all: Todo[] = [];
        let cursor = "";
        do {
          const page = await request<{
            items: Todo[];
            next_cursor: string;
          }>(`/todos?limit=200&cursor=${cursor}`);
          all = all.concat(page.items);
          cursor = page.next_cursor;
        } while (cursor);
        for (const id of todoIds) {
          if (!all.some((t) => t.id === id))
            all.push(await request<Todo>(`/todos/${id}`));
        }
        if (active) {
          setTodoBoard(b);
          setTodos(all);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  const [sourceId] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(report ? `/reports/${report.id}` : "/reports", {
        method: report ? "PUT" : "POST",
        body: JSON.stringify({
          source_id: report?.source_id || sourceId,
          todo_ids: todoIds,
          operation_id: operationId,
          todo_moves: todoIds
            .filter((id) => moves[id])
            .map((id) => ({
              id,
              column_id: moves[id],
              expected_revision: todos.find((t) => t.id === id)?.revision,
            })),
          expected_updated_at: expectedUpdatedAt,
          title,
          body,
          project_id:
            meta.mode === "local-demo"
              ? project
              : meta.projects.find(
                  (p) => p.id === project || p.name === project,
                )?.id || "",
          project_name:
            meta.mode !== "local-demo" &&
            !meta.projects.some((p) => p.id === project || p.name === project)
              ? project
              : undefined,
          domain: meta.mode === "local-demo" ? domain : undefined,
          domains:
            meta.mode !== "local-demo"
              ? domain
                  .split(/[,，]/)
                  .map((x) => x.trim())
                  .filter(Boolean)
              : undefined,
          agent,
          status,
          links: links
            .filter((l) => l.url.trim() || l.title.trim())
            .map((l) => ({
              title: l.title.trim() || "交付链接",
              url: l.url.trim(),
            })),
          mentions,
        }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) {
        onStale?.();
        try {
          const fresh = await Promise.all(
            todos.map((t) => request<Todo>(`/todos/${t.id}`)),
          );
          setTodos(fresh);
          setOperationId(crypto.randomUUID());
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="compose-fields">
        <fieldset className="todo-report-picker">
          <legend>{tr("关联任务")}</legend>
          <input
            aria-label={tr("搜索任务")}
            placeholder={tr("搜索任务")}
            value={todoQuery}
            onChange={(e) => setTodoQuery(e.target.value)}
          />
          {[...todos]
            .sort(
              (a, b) =>
                Number(b.project_id === project) -
                Number(a.project_id === project),
            )
            .filter(
              (t) =>
                todoIds.includes(t.id) ||
                !todoQuery ||
                t.title.toLowerCase().includes(todoQuery.toLowerCase()),
            )
            .map((t) => (
              <div key={t.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={todoIds.includes(t.id)}
                    onChange={(e) => {
                      setTodoIds(
                        e.target.checked
                          ? [...todoIds, t.id]
                          : todoIds.filter((id) => id !== t.id),
                      );
                      setOperationId(crypto.randomUUID());
                    }}
                  />
                  {t.title}
                </label>
                {todoIds.includes(t.id) && (
                  <select
                    aria-label={tr("上报后移动到")}
                    value={moves[t.id] || ""}
                    onChange={(e) => {
                      setMoves({
                        ...moves,
                        [t.id]: e.target.value,
                      });
                      setOperationId(crypto.randomUUID());
                    }}
                  >
                    <option value="">{tr("保持任务状态")}</option>
                    {todoBoard?.columns
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.revision === 1 &&
                          ["backlog", "doing", "review", "done"].includes(c.id)
                            ? tr(c.name)
                            : c.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            ))}
        </fieldset>
        <label>
          <span className="compose-field-title">
            {tr("简报标题")}
            <span aria-hidden="true">*</span>
          </span>
          <input
            autoFocus
            required
            maxLength={150}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tr("这次完成了什么？")}
          />
        </label>
        <label>
          {tr("进展说明")}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={15000}
            placeholder={tr(
              "结果、关键变化，以及需要团队协助的地方… 支持 Markdown",
            )}
          />
        </label>
        <div className="form-grid">
          <label>
            {tr("所属项目")}
            {meta.mode === "local-demo" ? (
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">{tr("未归属")}</option>
                {meta.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  list="compose-projects"
                  placeholder={tr("选择或输入新项目，可留空")}
                  maxLength={40}
                />
                <datalist id="compose-projects">
                  {meta.projects
                    .filter((p) => p.status !== "archived")
                    .map((p) => (
                      <option key={p.id} value={p.name} />
                    ))}
                </datalist>
              </>
            )}
          </label>
          <label>
            {tr("工作领域")}
            {meta.mode === "local-demo" ? (
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              >
                <option value="">{tr("未分类")}</option>
                {meta.domains.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            ) : (
              <>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  list="compose-domains"
                  placeholder={tr("如：研发，产品")}
                  maxLength={500}
                />
                <datalist id="compose-domains">
                  {meta.domains.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </>
            )}
          </label>
          <label>
            {tr("进展状态")}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(statuses).map(([s, o]) => (
                <option key={s} value={s}>
                  {tr(o.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr("来源 Agent")}
            <select
              disabled={!!report}
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
            >
              {Array.from(
                new Set([
                  agent,
                  "手动上报",
                  "Codex",
                  "Claude Code",
                  "其他 Agent",
                ]),
              ).map((a) => (
                <option key={a} value={a}>
                  {["手动上报", "其他 Agent"].includes(a) ? tr(a) : a}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="report-links-editor">
          <legend>{tr("交付链接")}</legend>
          {links.map((entry, index) => (
            <div className="report-link-row" key={entry.key}>
              <div className="report-link-fields">
                <input
                  type="url"
                  aria-label={tr("链接 {0} 地址", {
                    0: index + 1,
                  })}
                  placeholder="https://…"
                  value={entry.url}
                  required={!!entry.title.trim()}
                  onChange={(e) =>
                    setLinks(
                      links.map((l) =>
                        l.key === entry.key
                          ? {
                              ...l,
                              url: e.target.value,
                            }
                          : l,
                      ),
                    )
                  }
                />
                <input
                  aria-label={tr("链接 {0} 名称", {
                    0: index + 1,
                  })}
                  placeholder={tr("链接名称（可选）")}
                  maxLength={100}
                  value={entry.title}
                  onChange={(e) =>
                    setLinks(
                      links.map((l) =>
                        l.key === entry.key
                          ? {
                              ...l,
                              title: e.target.value,
                            }
                          : l,
                      ),
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={tr("移除链接 {0}", {
                  0: index + 1,
                })}
                onClick={() =>
                  setLinks(links.filter((l) => l.key !== entry.key))
                }
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={links.length >= 20}
            onClick={() =>
              setLinks([
                ...links,
                {
                  key: crypto.randomUUID(),
                  title: "",
                  url: "",
                },
              ])
            }
          >
            <Plus />
            {tr("添加链接")}
            {links.length >= 20 ? tr("（最多 20 个）") : ""}
          </Button>
        </fieldset>
        {meta.members.some(
          (m) => m.id !== meta.current_user || mentions.includes(m.id),
        ) && (
          <fieldset className="report-mentions-editor">
            <legend>{tr("需要谁关注")}</legend>
            <div className="report-mention-options">
              {meta.members
                .filter(
                  (m) => m.id !== meta.current_user || mentions.includes(m.id),
                )
                .map((m) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      checked={mentions.includes(m.id)}
                      onChange={(e) =>
                        setMentions(
                          e.target.checked
                            ? [...mentions, m.id]
                            : mentions.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.name}
                  </label>
                ))}
            </div>
          </fieldset>
        )}
      </div>
      <div className="compose-footer">
        <span
          className={error ? "error-text" : "compose-author"}
          role={error ? "alert" : undefined}
        >
          {tr(error) ||
            tr("以{0}的身份{1}{2}", {
              0:
                meta.members.find((m) => m.id === meta.current_user)?.name ||
                tr("当前成员"),
              1: report ? tr("保存") : tr("发布"),
              2: publicDemo
                ? tr(" · 仅当前页面")
                : meta.mode === "local-demo"
                  ? tr(" · 本地演示")
                  : "",
            })}
        </span>
        <div className="compose-submit-actions">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
            >
              {tr("取消")}
            </Button>
          )}
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {report ? tr("保存修改") : tr("发布进展")}
          </Button>
        </div>
      </div>
    </form>
  );
}
