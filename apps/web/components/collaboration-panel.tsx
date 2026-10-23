"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collaboration,
  Meta,
  Report,
  collaborationStatuses,
  request,
  clock,
} from "@/lib/types";

export function CollaborationPanel({
  report,
  meta,
  items,
  onChange,
}: {
  report: Report;
  meta: Meta;
  items: Collaboration[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [assignee, setAssignee] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="collaboration-panel">
      <div className="section-heading">
        <h3>
          协作请求 <small>{items.length}</small>
        </h3>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {open ? "收起" : "提出协作请求"}
        </Button>
      </div>
      {!items.length && !open && (
        <p className="muted">需要谁协助？明确负责人，让后续进展有回音。</p>
      )}
      {items.map((v) => (
        <RequestCard key={v.id} value={v} meta={meta} onChange={onChange} />
      ))}
      {open && (
        <form
          className="workspace-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await request("/collaborations", {
                method: "POST",
                body: JSON.stringify({
                  report_id: report.id,
                  title,
                  body,
                  assignee_id: assignee,
                }),
              });
              setOpen(false);
              setTitle("");
              setBody("");
              onChange();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            需要协助的事情
            <input
              required
              maxLength={150}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：请补录新版产品界面"
            />
          </label>
          <label>
            负责人
            <select
              required
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">选择团队成员</option>
              {meta.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            说明
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              maxLength={3000}
              placeholder="说明交付物、阻塞和期望结果"
            />
          </label>
          <Button disabled={busy}>发起协作</Button>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
function RequestCard({
  value: v,
  meta,
  onChange,
}: {
  value: Collaboration;
  meta: Meta;
  onChange: () => void;
}) {
  const [status, setStatus] = useState(v.status),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setStatus(v.status), [v.status]);
  const name = (id: string) =>
    meta.members.find((m) => m.id === id)?.name || "已离开成员";
  const canUpdate =
    meta.current_user === v.author_id ||
    meta.current_user === v.assignee_id ||
    meta.role === "admin";
  return (
    <article className="request-card">
      <div className="section-heading">
        <strong>{v.title}</strong>
        <span className={`request-status ${v.status}`}>
          {collaborationStatuses[v.status]}
        </span>
      </div>
      <p className="muted">
        {name(v.author_id)} 发起 → {name(v.assignee_id)} 负责
      </p>
      {v.body && <p className="request-body">{v.body}</p>}
      <div className="request-updates">
        {v.updates.map((u) => (
          <div key={u.id}>
            <small>
              {name(u.actor_id)} · {collaborationStatuses[u.status]} ·{" "}
              {new Date(u.created_at).toLocaleDateString("zh-CN")}{" "}
              {clock(u.created_at)}
            </small>
            {u.body && <p>{u.body}</p>}
          </div>
        ))}
      </div>
      {canUpdate && (
        <details>
          <summary>更新进展</summary>
          <form
            className="workspace-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await request(`/collaborations/${v.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ status, body }),
                });
                setBody("");
                onChange();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              处理状态
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {Object.entries(collaborationStatuses).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              后续进展
              <textarea
                rows={2}
                maxLength={3000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="处理结果、阻塞原因或下一步…"
              />
            </label>
            <Button
              size="sm"
              disabled={busy || (status === v.status && !body.trim())}
            >
              更新协作
            </Button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </form>
        </details>
      )}
    </article>
  );
}

export function ReportHistory({
  id,
  meta,
  updatedAt,
}: {
  id: string;
  meta: Meta;
  updatedAt: string;
}) {
  const [items, setItems] = useState<
      {
        id: string;
        actor_id: string;
        action: string;
        created_at: string;
        before: Report;
        after: Report;
      }[]
    >([]),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    request<{ items: typeof items }>(`/reports/${id}/history`)
      .then((v) => {
        if (active) {
          setItems(v.items);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, updatedAt, open]);
  function category(r: Report) {
    return `${meta.projects.find((p) => p.id === r.project_id)?.name || r.project_id || "未归属"} / ${r.domains?.join("、") || r.domain || "未分类"}`;
  }
  return (
    <details
      className="report-history"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>更新与分类记录</summary>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {items.map((v) => (
        <details key={v.id}>
          <summary>
            {v.action} ·{" "}
            {meta.members.find((m) => m.id === v.actor_id)?.name ||
              "已离开成员"}{" "}
            · {new Date(v.created_at).toLocaleString("zh-CN")}
          </summary>
          <p className="muted">
            {category(v.before)} → {category(v.after)}
          </p>
          <div className="history-snapshots">
            <div>
              <small>更新前</small>
              <strong>{v.before.title || "首次上报"}</strong>
              <p>{v.before.body}</p>
            </div>
            <div>
              <small>更新后</small>
              <strong>{v.after.title}</strong>
              <p>{v.after.body}</p>
            </div>
          </div>
        </details>
      ))}
    </details>
  );
}
