"use client";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Square,
  Check,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";
import { useAssistant } from "./assistant-provider";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { defaultAIConfig } from "@/lib/assistant";
import { request } from "@/lib/types";
import { publicDemo } from "@/lib/runtime";
import type { ContextEntry, ContextNode } from "@/lib/context";
export type ContextAIScope = {
  project?: string;
  domain?: string;
  member?: string;
  source_kind?: string;
  source_id?: string;
  mode?: "extract" | "organize";
};
export function ContextAIAction({
  scope,
  label = "AI 提取",
  size,
  variant = "default",
  onSaved,
  contextIDs,
}: {
  scope: ContextAIScope;
  contextIDs?: string[];
  label?: string;
  size?: "sm" | "icon";
  variant?: "default" | "outline" | "ghost";
  onSaved?: (v: ContextEntry) => void;
}) {
  const ai = useAssistant();
  const { t: tr, locale } = useI18n();
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false),
    [feedback, setFeedback] = useState<
      "" | "organized" | "review" | "stopped" | "empty" | "demo"
    >("");
  const alive = useRef(true),
    stop = useRef(false),
    retry = useRef<{
      fingerprint: string;
      id: string;
      queue: ContextAIScope[];
      index: number;
      items: Map<string, ContextEntry>;
      attempts: Record<number, number>;
    } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);
  useEffect(() => {
    if (!message || failed) return;
    const timer = setTimeout(() => {
      setMessage("");
      setFeedback("");
    }, 2500);
    return () => clearTimeout(timer);
  }, [message, failed]);
  async function run() {
    if (busy) return;
    const config =
      ai.configs.find((c) => c.id === ai.configID && c.verified_at) ||
      defaultAIConfig(ai.configs);
    if (!config) {
      ai.openSettings("personal");
      return;
    }
    stop.current = false;
    setBusy(true);
    setMessage("");
    setFeedback("");
    setFailed(false);
    try {
      const fingerprint = JSON.stringify([scope, contextIDs, config.id]);
      if (retry.current?.fingerprint !== fingerprint) {
        let queue = [scope];
        if (contextIDs) {
          queue = contextIDs.map((id) => ({
            ...scope,
            source_kind: "context",
            source_id: id,
          }));
        } else if (!scope.source_id) {
          const params = new URLSearchParams({
            project: scope.project || "",
            domain: scope.domain || "",
            member: scope.member || "",
          });
          const tree = await request<{ items: ContextNode[] }>(
            "/context-tree?" + params,
          );
          const nodes = tree.items.filter((n) => n.state !== "archived");
          if (nodes.length)
            queue = nodes.map((n) => ({
              ...scope,
              source_kind: "context",
              source_id: n.id,
            }));
        }
        retry.current = {
          fingerprint,
          id: crypto.randomUUID(),
          queue,
          index: 0,
          items: new Map(),
          attempts: {},
        };
      }
      const job = retry.current!;
      while (job.index < job.queue.length && !stop.current) {
        if (alive.current) setProgress(`${job.index + 1}/${job.queue.length}`);
        const result = await request<{
          items: ContextEntry[];
          errors: string[];
          reply: string;
        }>("/assistant/context-auto", {
          method: "POST",
          body: JSON.stringify({
            ...job.queue[job.index],
            config_id: config.id,
            request_id: `${job.id}-${job.index}-${job.attempts[job.index] || 0}`,
            locale,
          }),
        });
        for (const value of result.items) {
          job.items.set(value.id, value);
          if (alive.current) onSaved?.(value);
        }
        window.dispatchEvent(new Event("coflow-knowledge-change"));
        window.dispatchEvent(new Event("coflow:assistant-change"));
        if (result.errors.length) {
          job.attempts[job.index] = (job.attempts[job.index] || 0) + 1;
          throw Error(result.errors.join(" · "));
        }
        job.index++;
      }
      const reviewCount = [...job.items.values()].filter(
        (v) => v.needs_review || v.state === "pending",
      ).length;
      if (alive.current)
        setFeedback(
          stop.current
            ? "stopped"
            : publicDemo
              ? "demo"
              : reviewCount
                ? "review"
                : job.items.size
                  ? "organized"
                  : "empty",
        );
      if (alive.current)
        setMessage(
          stop.current
            ? tr("已停止，已保存的内容保留")
            : publicDemo
              ? tr("离线演示：仅模拟整理，未调用 AI，原文保持不变")
              : reviewCount
                ? tr("已整理 {count} 条，{review} 条待复核", {
                    count: job.items.size,
                    review: reviewCount,
                  })
                : job.items.size
                  ? tr("已整理 {count} 条", { count: job.items.size })
                  : tr("没有需要新增的知识"),
        );
      if (!stop.current) retry.current = null;
    } catch (e) {
      if (alive.current) {
        setFailed(true);
        setMessage(tr((e as Error).message));
      }
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  return (
    <span
      className="context-ai-action"
      data-icon={size === "icon" ? "true" : undefined}
    >
      <Button
        type="button"
        title={message || tr(label)}
        aria-label={tr(label)}
        size={size}
        variant={variant}
        disabled={busy || !ai.ready}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void run();
        }}
      >
        {busy ? (
          <LoaderCircle size={14} className="animate-spin" />
        ) : failed ? (
          <CircleAlert size={14} />
        ) : feedback ? (
          <Check size={14} />
        ) : (
          <Sparkles size={14} />
        )}
        {size !== "icon" && (
          <span className="context-ai-label">
            <span aria-hidden="true" className="context-ai-label-size">
              {tr("整理中…")}
            </span>
            <span>
              {busy
                ? progress || tr("整理中…")
                : feedback
                  ? tr(
                      (
                        {
                          organized: "已整理",
                          review: "需复核",
                          stopped: "已停止",
                          empty: "无新增",
                          demo: "演示完成",
                        } as const
                      )[feedback],
                    )
                  : tr(label)}
            </span>
          </span>
        )}
      </Button>
      <button
        type="button"
        disabled={!busy}
        style={{ visibility: busy ? "visible" : "hidden" }}
        className="context-ai-stop"
        title={tr("停止")}
        aria-label={tr("停止")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          stop.current = true;
        }}
      >
        <Square size={12} />
      </button>
      {(message || (busy && progress)) && (
        <span
          role={failed ? "alert" : "status"}
          className={
            failed || size === "icon" ? "context-ai-result" : "sr-only"
          }
        >
          {busy ? progress : message}
        </span>
      )}
    </span>
  );
}
