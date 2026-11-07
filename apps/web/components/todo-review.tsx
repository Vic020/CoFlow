"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { SelectMenu } from "./ui/select-menu";
import type { Todo } from "@/lib/todo";
import type { Meta } from "@/lib/types";

export const reviewLabels: Record<string, string> = {
  draft: "待提交验收",
  pending: "待验收",
  changes_requested: "已退回",
  approved: "已通过验收",
};
export function TodoReviewPanel({
  task,
  meta,
  writable,
  busy,
  onAction,
  onSave,
  onEditingChange,
}: {
  task: Todo;
  meta: Meta;
  writable: boolean;
  busy: boolean;
  onAction: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<boolean>;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
  onEditingChange: (editing: boolean) => void;
}) {
  const { t: tr, date } = useI18n();
  const [editing, setEditing] = useState(false),
    [criteria, setCriteria] = useState(task.review?.criteria || ""),
    [reviewer, setReviewer] = useState(task.review?.reviewer_id || ""),
    [note, setNote] = useState("");
  useEffect(() => {
    setCriteria(task.review?.criteria || "");
    setReviewer(task.review?.reviewer_id || "");
    setEditing(false);
    setNote("");
    onEditingChange(false);
  }, [task.id, task.revision]);
  const r = task.review,
    canConfigure =
      writable &&
      !task.archived &&
      !task.completed_at &&
      r?.state !== "pending",
    canDecide =
      r?.state === "pending" &&
      r.reviewer_id === meta.current_user &&
      !task.archived;
  function edit(value: boolean) {
    setEditing(value);
    onEditingChange(value);
  }
  const member = (id: string) =>
    meta.members.find((m) => m.id === id)?.name || tr("已离开成员");
  async function act(action: string) {
    if (await onAction(action, { body: note })) {
      setNote("");
      edit(false);
    }
  }
  return (
    <section className="todo-review-panel" aria-label={tr("任务验收")}>
      <div className="todo-review-heading">
        <strong>{tr("任务验收")}</strong>
        {r && (
          <span className="muted">
            {tr(reviewLabels[r.state] || "待提交验收")}
          </span>
        )}
        {canConfigure && !editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => edit(true)}
            aria-label={tr("配置验收")}
          >
            <Pencil size={14} />
            {r ? tr("编辑") : tr("配置验收")}
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="workspace-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSave({ review: { criteria, reviewer_id: reviewer } }))
              edit(false);
          }}
        >
          <label>
            {tr("验收标准")}
            <textarea
              required
              maxLength={8000}
              rows={3}
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            {tr("验收人")}
            <SelectMenu
              label={tr("验收人")}
              value={reviewer}
              onChange={setReviewer}
              options={[
                { value: "", label: tr("请选择验收人") },
                ...meta.members.map((m) => ({ value: m.id, label: m.name })),
              ]}
              disabled={busy}
            />
          </label>
          <div className="todo-review-actions">
            <Button size="sm" disabled={busy || !criteria.trim() || !reviewer}>
              {tr("保存")}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => edit(false)}
            >
              {tr("取消")}
            </Button>
            {r && (
              <Button
                size="sm"
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (await onSave({ review: null })) edit(false);
                }}
              >
                {tr("移除验收设置")}
              </Button>
            )}
          </div>
        </form>
      ) : r ? (
        <>
          <p className="todo-review-criteria">{r.criteria}</p>
          <small className="muted">
            {tr("验收人")} · {member(r.reviewer_id)}
          </small>
          {r.evidence && (
            <div>
              <span className="todo-field-label">{tr("交付依据")}</span>
              <p className="todo-review-criteria">{r.evidence}</p>
              {r.submitted_at && (
                <small className="muted">
                  {member(r.submitted_by || "")} ·{" "}
                  {date(r.submitted_at, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              )}
            </div>
          )}
          {r.decision_by && (
            <div>
              <small className="muted">
                {tr(reviewLabels[r.state] || "验收意见")} ·{" "}
                {member(r.decision_by)}
                {r.decided_at &&
                  ` · ${date(r.decided_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
              </small>
              {r.decision_note && (
                <p className="todo-review-criteria">{r.decision_note}</p>
              )}
            </div>
          )}
          {!task.archived &&
            !task.completed_at &&
            (canDecide || (writable && r.state !== "pending")) && (
              <label className="todo-review-note">
                {canDecide ? tr("验收意见（退回时必填）") : tr("交付依据")}
                <textarea
                  aria-label={
                    canDecide ? tr("验收意见（退回时必填）") : tr("交付依据")
                  }
                  maxLength={12000}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
          <div className="todo-review-actions">
            {!task.archived &&
              !task.completed_at &&
              writable &&
              r.state !== "pending" && (
                <Button
                  size="sm"
                  disabled={busy || !note.trim()}
                  onClick={() => void act("submit-review")}
                >
                  {tr("提交验收")}
                </Button>
              )}
            {canDecide && (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void act("approve-review")}
                >
                  {tr("通过并完成")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !note.trim()}
                  onClick={() => void act("request-changes")}
                >
                  {tr("退回修改")}
                </Button>
              </>
            )}
            {writable && r.state === "pending" && !task.archived && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void act("withdraw-review")}
              >
                {tr("撤回验收")}
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="muted">{tr("可配置验收标准与验收人")}</p>
      )}
    </section>
  );
}
