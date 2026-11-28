"use client";

import { useEffect, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { request } from "@/lib/types";
import type { AIConversation, AITurn } from "@/lib/assistant";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { ContentSkeleton } from "./ui/loading-status";

type Transcript = {
  id: string;
  title: string;
  turns: Pick<AITurn, "user" | "reply">[];
};

export function AssistantShare({
  conversation,
  turns,
}: {
  conversation: AIConversation;
  turns: AITurn[];
}) {
  const { t } = useI18n();
  const { mode } = useAuth();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/assistant/conversations/${encodeURIComponent(conversation.id)}/share`;

  function shareURL(id: string) {
    if (!id) return "";
    const url = new URL("/assistant", window.location.origin);
    url.searchParams.set("share", id);
    return url.href;
  }

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await operation();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && mode === "team")
          void run(async () => {
            const current = await request<{ id: string }>(endpoint);
            setLink(shareURL(current.id));
          });
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ai-share-trigger"
          title={t("分享会话")}
          aria-label={t("分享会话")}
        >
          <Share2 size={16} />
          {t("分享")}
        </Button>
      </DialogTrigger>
      <DialogContent className="ai-confirm-dialog ai-share-dialog">
        <DialogTitle>{t("分享会话")}</DialogTitle>
        <DialogDescription>
          {t(
            "分享固定的文字快照。同空间成员获得链接后可查看。请先检查对话中是否包含敏感内容。",
          )}
        </DialogDescription>
        <div className="ai-manager-row">
          {mode === "team" && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const share = await request<Transcript>(endpoint, {
                    method: "POST",
                    body: JSON.stringify({ revision: conversation.revision }),
                  });
                  setLink(shareURL(share.id));
                })
              }
            >
              {t(link ? "替换分享链接" : "生成分享链接")}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const transcript = turns.map(
                  (turn) =>
                    `**${t("用户")}**\n\n${turn.user}\n\n**CoFlow**\n\n${turn.reply}`,
                );
                await navigator.clipboard.writeText(
                  [`# ${conversation.title}`, ...transcript].join(
                    "\n\n---\n\n",
                  ),
                );
                setFeedback("已复制");
              })
            }
          >
            <Copy size={14} />
            {t("复制 Markdown")}
          </Button>
        </div>
        {link && (
          <label className="ai-share-link">
            {t("分享链接")}
            <input
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(link);
                  setFeedback("已复制");
                })
              }
            >
              {t("复制链接")}
            </Button>
          </label>
        )}
        {mode === "team" && (
          <Button
            variant="ghost"
            disabled={busy || !link}
            onClick={() =>
              void run(async () => {
                await request(endpoint, { method: "DELETE" });
                setLink("");
                setFeedback("已撤销分享");
              })
            }
          >
            {t("撤销分享")}
          </Button>
        )}
        {error && <p className="error-text" role="alert">{t(error)}</p>}
        {feedback && <p role="status">{t(feedback)}</p>}
      </DialogContent>
    </Dialog>
  );
}

export function SharedAssistantConversation({ id }: { id: string }) {
  const { me } = useAuth();
  const { t } = useI18n();
  const identity = me ? `${me.user.id}:${me.current_team}:${id}` : "";
  const [result, setResult] = useState<{
    identity: string;
    value?: Transcript;
    error?: boolean;
  }>();
  useEffect(() => {
    if (!identity) return;
    let active = true;
    void request<Transcript>(`/assistant/shares/${encodeURIComponent(id)}`)
      .then((value) => {
        if (active) setResult({ identity, value });
      })
      .catch(() => {
        if (active) setResult({ identity, error: true });
      });
    return () => {
      active = false;
    };
  }, [identity, id]);
  if (result?.identity === identity && result.error)
    return <p role="alert">{t("会话分享不可用")}</p>;
  const transcript = result?.identity === identity ? result.value : undefined;
  if (!transcript) return <ContentSkeleton />;
  return (
    <section className="ai-shared-transcript">
      <h2>{transcript.title}</h2>
      <p className="muted">{t("只读会话快照")}</p>
      {transcript.turns.map((turn, index) => (
        <div className="ai-turn" key={index}>
          <div className="ai-user-message">{turn.user}</div>
          <div className="ai-assistant-message">
            <span className="ai-speaker">CoFlow</span>
            <div className="ai-answer">{turn.reply}</div>
          </div>
        </div>
      ))}
    </section>
  );
}
