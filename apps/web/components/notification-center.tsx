"use client";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Bell } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { Notification, request } from "@/lib/types";
export function NotificationCenter({
  team,
  onSelect,
}: {
  team: string;
  onSelect: (id: string) => void;
}) {
  const { t: tr, date: formatDate } = useI18n();
  const [items, setItems] = useState<Notification[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setItems(
        (
          await request<{
            items: Notification[];
          }>("/notifications")
        ).items,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    setItems([]);
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load, team]);
  async function read(id: string) {
    try {
      await request("/notifications/read", {
        method: "POST",
        body: JSON.stringify({
          id,
        }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={tr("消息通知")}
        className="bell"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Bell />
        {items.some((x) => !x.read_at) && <i />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="info-dialog">
          <DialogTitle className="modal-title">{tr("消息通知")}</DialogTitle>
          <DialogDescription className="modal-description">
            {tr("关注你的简报、评论与协作进展。")}
          </DialogDescription>
          <Button size="sm" variant="outline" onClick={() => void read("")}>
            {tr("全部标为已读")}
          </Button>
          <div className="notification-list">
            {items.map((v) => (
              <button
                key={v.id}
                className={v.read_at ? "" : "unread"}
                onClick={() => {
                  void read(v.id);
                  setOpen(false);
                  onSelect(v.report_id);
                }}
              >
                <strong>{tr(v.title)}</strong>
                <small>
                  {formatDate(v.created_at, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {!v.read_at ? tr(" · 未读") : ""}
                </small>
              </button>
            ))}
            {!items.length && (
              <p className="muted">
                {tr("暂无消息，有新的协作进展时会出现在这里。")}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="error-text">
              {tr(error)}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
