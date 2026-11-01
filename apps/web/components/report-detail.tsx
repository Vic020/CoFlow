"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MessageCircle,
  Pencil,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { DialogTitle, DialogDescription } from "./ui/dialog";
import { DeleteAction, TrashList } from "./content-actions";
import { ReportTodos } from "./report-todos";
import { ReportCompose } from "./report-compose";
import { ClassificationEditor } from "./catalog-manager";
import { CollaborationPanel, ReportHistory } from "./collaboration-panel";
import { publicDemo } from "@/lib/runtime";
import {
  reportDomains,
  clock,
  dateKey,
  request,
  statuses,
  type Meta,
  type Member,
  type Report,
  type Collaboration,
} from "@/lib/types";

export function Avatar({
  member,
  small = false,
}: {
  member?: Member;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${member?.color || "mint"} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {member?.avatar_data ? (
        <img src={member.avatar_data} alt="" />
      ) : (
        member?.name.slice(0, 1) || "?"
      )}
    </span>
  );
}
export function Agent({ name }: { name: string }) {
  const { t: tr } = useI18n();
  return (
    <span className="agent">
      <span className={name.includes("Claude") ? "claude-mark" : "codex-mark"}>
        {name.includes("Claude") ? "✳" : "◉"}
      </span>
      {["手动上报", "其他 Agent"].includes(name)
        ? tr(name)
        : name || tr("手动上报")}
    </span>
  );
}
export function Status({ value }: { value: string }) {
  const { t: tr } = useI18n();
  const s = statuses[value] || statuses.progress;
  return (
    <span className={`status ${s.className}`}>
      <i />
      {tr(s.label)}
    </span>
  );
}
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
export function ReportDetail({
  report: r,
  collaborations,
  meta,
  onChange,
  onSaved,
  onDeleted,
}: {
  report: Report;
  collaborations: Collaboration[];
  meta: Meta;
  onChange: () => void;
  onSaved: (s: string) => void;
  onDeleted: () => void;
}) {
  const { t: tr, locale, timeZone } = useI18n();
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const canEdit =
    r.author_id === meta.current_user ||
    (meta.mode !== "local-demo" && meta.role === "admin");
  const author = meta.members.find((m) => m.id === r.author_id);
  async function comment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await request(`/reports/${r.id}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body,
          mentions,
        }),
      });
      setBody("");
      setMentions([]);
      onChange();
      onSaved("评论已发布");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resolve() {
    setBusy(true);
    setError("");
    try {
      await request(`/reports/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "resolved",
        }),
      });
      onChange();
      onSaved("已标记解决");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <div className="detail-body report-edit-body">
        <DialogTitle className="modal-title">{tr("编辑简报")}</DialogTitle>
        <DialogDescription className="sr-only">
          {tr("修改标题、内容、分类和交付链接，保留原始来源与讨论。")}
        </DialogDescription>
        <ReportCompose
          meta={meta}
          report={r}
          onStale={onChange}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onChange();
            onSaved("简报已更新");
          }}
        />
      </div>
    );
  return (
    <>
      <div className="detail-body">
        <div className="detail-source">
          <Avatar member={author} small />
          <strong>{author?.name}</strong>
          <Agent name={r.agent} />
          <time>{clock(r.created_at, locale, timeZone)}</time>
        </div>
        <DialogTitle className="detail-title">{r.title}</DialogTitle>
        <DialogDescription className="detail-description">
          {meta.projects.find((p) => p.id === r.project_id)?.name ||
            tr("未归属")}{" "}
          / {reportDomains(r).join(" · ") || tr("未分类")} ·{" "}
          {dateKey(r.created_at, timeZone)}
        </DialogDescription>
        <div className="detail-status">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil />
              {tr("编辑")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                const url = new URL(window.location.href);
                if (!url.pathname.replace(/\/$/, "").endsWith("/calendar"))
                  url.search = "";
                url.hash = "";
                url.searchParams.set("report", r.id);
                await navigator.clipboard.writeText(url.toString());
                onSaved("链接已复制");
              } catch {
                setError("复制失败，请重试");
              }
            }}
          >
            <Link2 size={14} />
            {tr("复制链接")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(r.source_id);
                onSaved("source_id 已复制");
              } catch {
                setError("复制失败，请重试");
              }
            }}
          >
            <Copy size={14} />
            {tr("复制 source_id")}
          </Button>
          {meta.mode !== "local-demo" && canEdit && (
            <DeleteAction
              path={`/reports/${r.id}`}
              updatedAt={r.updated_at}
              onDeleted={onDeleted}
            />
          )}
          <Status value={r.status} />
          {(r.author_id === meta.current_user ||
            (meta.mode !== "local-demo" && meta.role === "admin")) &&
            ["blocked", "review"].includes(r.status) && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void resolve()}
              >
                <Check />
                {tr("标记解决")}
              </Button>
            )}
        </div>
        {meta.mode !== "local-demo" && (
          <ClassificationEditor
            key={r.id + String(r.classification_locked)}
            report={r}
            meta={meta}
            onChange={onChange}
          />
        )}
        <Markdown>{r.body}</Markdown>
        <div className="detail-links">
          {r.links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} />
              <span>
                {l.title || tr("交付链接")}
                <small>{new URL(l.url).hostname}</small>
              </span>
              <ArrowUpRight size={16} />
            </a>
          ))}
        </div>
        {r.model && (
          <p className="source-note">
            {tr("来源 Model：")}
            {r.model}
          </p>
        )}
        {(meta.mode !== "local-demo" || publicDemo) && (
          <ReportTodos report={r} meta={meta} onChange={onChange} />
        )}
        {meta.mode !== "local-demo" && (
          <>
            <CollaborationPanel
              report={r}
              meta={meta}
              items={collaborations}
              onChange={onChange}
            />
            <ReportHistory id={r.id} meta={meta} updatedAt={r.updated_at} />
          </>
        )}
        <div className="discussion-heading">
          <h3>{tr("讨论")}</h3>
          <span>{r.comments.length}</span>
        </div>
        {r.comments.length ? (
          r.comments.map((c) => {
            const m = meta.members.find((m) => m.id === c.author_id);
            return (
              <div className="comment" key={c.id}>
                <Avatar member={m} small />
                <div>
                  <div className="comment-source">
                    <strong>{m?.name}</strong>
                    <time>{clock(c.created_at, locale, timeZone)}</time>
                    {meta.mode !== "local-demo" &&
                      (c.author_id === meta.current_user ||
                        meta.role === "admin") && (
                        <DeleteAction
                          path={`/reports/${r.id}/comments/${c.id}`}
                          onDeleted={() => {
                            onChange();
                            onSaved("评论已移至回收站");
                          }}
                        />
                      )}
                  </div>
                  <Markdown>{c.body}</Markdown>
                </div>
              </div>
            );
          })
        ) : (
          <p className="discussion-empty">
            {tr("还没有评论。可以补充反馈，或讨论下一步。")}
          </p>
        )}
      </div>
      {meta.mode !== "local-demo" && (
        <details className="deleted-comments">
          <summary>{tr("已删除评论")}</summary>
          <TrashList
            key={r.updated_at}
            reportId={r.id}
            onRestored={() => {
              onChange();
              onSaved("评论已恢复");
            }}
          />
        </details>
      )}
      <form className="comment-form" onSubmit={comment}>
        <label htmlFor="comment-body">
          {tr("以")}
          {meta.members.find((m) => m.id === meta.current_user)?.name ||
            tr("当前成员")}
          {tr("的身份回复")}
        </label>
        <textarea
          id="comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={tr("分享反馈或协作建议，支持 Markdown…")}
          rows={3}
          maxLength={4000}
        />
        {meta.mode !== "local-demo" && (
          <div className="mention-picker" aria-label={tr("提醒成员")}>
            {meta.members
              .filter((m) => m.id !== meta.current_user)
              .map((m) => (
                <label key={m.id}>
                  <input
                    type="checkbox"
                    checked={mentions.includes(m.id)}
                    onChange={(e) =>
                      setMentions((old) =>
                        e.target.checked
                          ? [...old, m.id]
                          : old.filter((id) => id !== m.id),
                      )
                    }
                  />
                  @{m.name}
                </label>
              ))}
          </div>
        )}
        <div className="comment-form-footer">
          <span className="error-text" role="alert">
            {tr(error)}
          </span>
          <Button type="submit" disabled={busy || !body.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <MessageCircle />}
            {tr("发布评论")}
          </Button>
        </div>
      </form>
    </>
  );
}
