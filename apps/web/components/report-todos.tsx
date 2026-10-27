"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Meta, Report, request } from "@/lib/types";
import { defaultColumnName, Todo, TodoBoardData } from "@/lib/todo";
export function ReportTodos({
  report,
  meta,
  onChange,
}: {
  report: Report;
  meta: Meta;
  onChange: () => void;
}) {
  const { t: tr } = useI18n();
  const [creationSource, setCreationSource] = useState(() =>
    crypto.randomUUID(),
  );
  const [tasks, setTasks] = useState<Todo[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [board, setBoard] = useState<TodoBoardData | null>(null),
    [title, setTitle] = useState(report.title),
    [column, setColumn] = useState(""),
    [assignee, setAssignee] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all(
      (report.todo_ids || []).map((id) => request<Todo>(`/todos/${id}`)),
    )
      .then((ts) => {
        if (active) setTasks(ts);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [report.id, report.updated_at, JSON.stringify(report.todo_ids)]);
  return (
    <section className="todo-reports">
      <h3>{tr("关联任务")}</h3>
      {tasks.map((t) => (
        <Link key={t.id} href={`/todo?todo=${t.id}`}>
          {t.title} ·{" "}
          {tr(t.archived ? "已归档" : t.completed_at ? "已完成" : "未完成")}
        </Link>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const b = await request<TodoBoardData>("/todo-board");
            setBoard(b);
            setColumn(b.columns.find((c) => !c.archived && !c.done)?.id || "");
            setCreationSource(crypto.randomUUID());
            setOpen(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {tr("创建任务")}
      </Button>
      {(report.author_id === meta.current_user || meta.role === "admin") && (
        <p className="muted">{tr("编辑简报可关联已有任务。")}</p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {tr(error)}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="info-dialog">
          <DialogTitle className="modal-title">{tr("创建任务")}</DialogTitle>
          <DialogDescription>
            {tr("保留来源简报，确认负责人和所属列。")}
          </DialogDescription>
          <form
            className="workspace-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const t = await request<Todo>("/todos", {
                  method: "POST",
                  body: JSON.stringify({
                    source_id: `report:${report.id}:${creationSource}`,
                    operation_id: `report-create:${creationSource}`,
                    column_id: column,
                    assignee_id: assignee,
                    title,
                    body: "",
                    project_id: report.project_id,
                    domains: report.domains || [],
                    priority: "none",
                    report_ids: [report.id],
                  }),
                });
                onChange();
                setOpen(false);
                setTasks((ts) =>
                  ts.some((x) => x.id === t.id) ? ts : [...ts, t],
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {tr("标题")}
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              {tr("负责人")}
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">{tr("未分配")}</option>
                {meta.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("所属列")}
              <select
                value={column}
                onChange={(e) => setColumn(e.target.value)}
              >
                {board?.columns
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {defaultColumnName(c) ? tr(c.name) : c.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button disabled={busy}>{tr("创建任务")}</Button>
            {error && (
              <p className="error-text" role="alert">
                {tr(error)}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
