"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listActivityFollows, setActivityFollow, type ActivityFollow } from "@/lib/activity-follows";
import { Bell, Check, Inbox, RefreshCw, Star } from "lucide-react";
import { request, type Meta, type Notification } from "@/lib/types";
import { Button } from "./ui/button";
import { ContentSkeleton, LoadingStatus } from "./ui/loading-status";
import { useI18n } from "./i18n-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

const views = [
  ["recent", "最近动态"],
  ["starred", "星标动态"],
  ["all", "收件箱"],
  ["unread", "未读消息"],
  ["response", "可能需要回应"],
  ["activity", "我的动作"],
] as const;
const labels: Record<string, string> = {
  "todo-assigned": "任务分配",
  "todo-review": "验收更新",
  "todo-comment": "任务评论",
  "todo-updated": "任务更新",
  "todo-report": "关联进展",
  "todo-blocked": "任务受阻",
  "todo-unblocked": "阻塞解除",
  collaboration: "协作更新",
  comment: "简报评论",
  calendar: "排期更新",
  context: "Context 更新",
  "comment-reply": "评论回复",
  "todo-created": "新建任务",
  reply: "回复你的评论",
  report: "简报更新",
  "starred-report": "已星标简报",
};

type Activity = Pick<Notification, "id" | "title" | "kind" | "created_at" | "comment_id" | "todo_id" | "calendar_event_id"> & {
  report_id?: string;
  context_id?: string;
  actor_id?: string;
  project_id?: string;
  starred?: boolean;
};

export function InboxWorkspace({ meta }: { meta: Meta }) {
  const demo = meta.mode === "local-demo";
  const { t, date } = useI18n();
  const [view, setView] = useState<(typeof views)[number][0]>("recent");
  const [incoming, setIncoming] = useState<Notification[]>();
  const [activity, setActivity] = useState<Partial<Record<string, Activity[]>>>({});
  const [follows, setFollows] = useState<ActivityFollow[]>();
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const [manage, setManage] = useState(false);
  const [followError, setFollowError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setHeaderTarget(document.getElementById("activity-header-actions")), []);
  const feedView = view === "activity" ? "mine" : view === "recent" || view === "starred" ? view : "";
  useEffect(() => {
    if (demo) return;
    let active = true;
    setLoading(true);
    setError("");
    const read = feedView
      ? request<{ items: Activity[] }>(`/activity?view=${feedView}`).then(({ items }) => {
          if (active) setActivity((current) => ({ ...current, [feedView]: items }));
        })
      : request<{ items: Notification[] }>("/notifications").then(({ items }) => {
          if (active) setIncoming(items);
        });
    void read.catch((failure: Error) => {
      if (active) setError(failure.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [feedView, refresh, demo]);

  useEffect(() => {
    if (!manage) return;
    let active = true;
    setFollowError("");
    void listActivityFollows()
      .then(({ items }) => { if (active) setFollows(items); })
      .catch((failure: Error) => { if (active) setFollowError(failure.message); });
    return () => { active = false; };
  }, [manage]);

  async function toggleFollow(kind: ActivityFollow["kind"], id: string) {
    if (!follows || busy) return;
    const following = !follows.some((item) => item.kind === kind && item.target_id === id);
    setBusy(true);
    setFollowError("");
    try {
      await setActivityFollow(kind, id, following);
      setFollows((items) => following
        ? [...(items ?? []), { kind, target_id: id }]
        : items?.filter((item) => item.kind !== kind || item.target_id !== id));
      setRefresh((value) => value + 1);
    } catch (failure) {
      setFollowError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function mark(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request("/notifications/read", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      const now = new Date().toISOString();
      setIncoming((items) =>
        items?.map((item) =>
          (!id || item.id === id) && !item.read_at
            ? { ...item, read_at: now }
            : item,
        ),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const items = feedView
    ? activity[feedView]
    : incoming?.filter((item) =>
        view === "unread" ? !item.read_at : view === "response" ? item.needs_response && !item.read_at : true,
      );
  return (
    <section className="personal-inbox" aria-label="Activity">
      <Dialog open={manage} onOpenChange={setManage}>
        {headerTarget && createPortal(
          <>
            <LoadingStatus active={!demo && loading && items !== undefined} />
            <Button variant="ghost" size="icon" disabled={demo || loading}
              aria-label={t("刷新")} title={t("刷新")} onClick={() => setRefresh((value) => value + 1)}>
              <RefreshCw size={15} />
            </Button>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={demo} aria-label={t("管理星标")}>
                <Star size={14} /> <span>{t("管理星标")}</span>
              </Button>
            </DialogTrigger>
          </>,
          headerTarget,
        )}
        <DialogContent className="info-dialog activity-follows-dialog">
          <DialogTitle className="modal-title">{t("管理星标")}</DialogTitle>
          <DialogDescription className="modal-description">{t("星标项目、成员或简报后，可集中查看相关动态。")}</DialogDescription>
          {followError && <p className="error-text" role="alert">{t(followError)}</p>}
          {!follows && !followError && <ContentSkeleton variant="list" />}
          {follows && (
            <div className="activity-follows">
              {([
                ["project", "项目", meta.projects],
                ["member", "成员", meta.members.filter((member) => member.id !== meta.current_user)],
                ["report", "简报", follows.filter((item) => item.kind === "report").map((item) => ({
                  id: item.target_id, name: item.title ?? item.target_id,
                }))],
              ] as const).map(([kind, label, choices]) => (
                <section key={kind} aria-label={t(label)}>
                  <h3>{t(label)}</h3>
                  {choices.length === 0 && (
                    <p className="muted">{t(kind === "report" ? "可在简报详情中添加星标。" : "暂无可星标的项目或成员。")}</p>
                  )}
                  {choices.map(({ id, name }) => {
                    const selected = follows.some((item) => item.kind === kind && item.target_id === id);
                    return (
                      <Button key={id} variant="ghost" size="sm" aria-pressed={selected} disabled={busy} onClick={() => void toggleFollow(kind, id)}>
                        <Star size={15} fill={selected ? "currentColor" : "none"} /> {name}
                      </Button>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <div className="viewbar activity-viewbar">
        <div className="view-tabs" role="group" aria-label={t("筛选动态")}>
          {views.map(([id, label]) => (
            <button key={id} type="button" className={view === id ? "active" : ""}
              aria-pressed={view === id} onClick={() => setView(id)}>
              {t(label)}
            </button>
          ))}
        </div>
        {!feedView && (
          <button className="trash-toggle" type="button" disabled={demo || busy || !incoming?.some((item) => !item.read_at)} onClick={() => void mark("")}>
            {t("全部标为已读")}
          </button>
        )}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {t(error)}
        </p>
      )}
      {demo ? (
        <p className="muted">{t("在团队空间查看自己的通知和动作。")}</p>
      ) : !items && !error ? (
        <ContentSkeleton variant="list" />
      ) : items?.length ? (
        <ul className="personal-inbox-list">
          {items.map((item) => {
            const kind = item.kind.replace(/^own-/, "");
            const title = labels[kind];
            const entry: Activity = item;
            const unread = "read_at" in item && !item.read_at;
            const actor = meta.members.find((member) => member.id === entry.actor_id)?.name;
            const project = meta.projects.find((project) => project.id === entry.project_id)?.name;
            const href = entry.context_id
              ? `/context?context=${encodeURIComponent(entry.context_id)}`
              : item.todo_id
              ? `/todo?todo=${encodeURIComponent(item.todo_id)}`
              : item.calendar_event_id
                ? `/calendar?mode=schedule&event=${encodeURIComponent(item.calendar_event_id)}`
                : `/?${new URLSearchParams({ report: item.report_id ?? "", ...(item.comment_id ? { comment: item.comment_id } : {}) })}`;
            return (
              <li key={item.id} className={unread ? "unread" : ""}>
                <Link href={href}>
                  {entry.starred ? <Star size={16} /> : unread ? <Bell size={16} /> : <Inbox size={16} />}
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {[actor, project, title ? t(title) : kind].filter(Boolean).join(" · ")} ·{" "}
                      {date(item.created_at, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </small>
                  </span>
                </Link>
                {unread && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("标为已读")}
                    disabled={busy}
                    onClick={() => void mark(item.id)}
                  >
                    <Check size={15} />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        items && <p className="muted">{t(view === "starred" ? "星标项目、成员或简报后，这里会显示相关动态。" : feedView ? "最近没有符合条件的动态。" : "这个列表暂时没有消息。")}</p>
      )}
    </section>
  );
}
