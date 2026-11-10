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
import {
  contextOperationKey,
  operationActive,
  type ContextAIScope,
} from "@/lib/ai-operations";
import type { ContextEntry } from "@/lib/context";
export type { ContextAIScope } from "@/lib/ai-operations";
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
  const ai = useAssistant(),
    { t: tr, locale } = useI18n();
  const config =
    ai.configs.find((c) => c.id === ai.configID && c.verified_at) ||
    defaultAIConfig(ai.configs);
  const fingerprint = contextOperationKey({
    scope,
    contextIDs,
    configID: config?.id || "",
    locale,
  });
  const currentFingerprint = useRef(fingerprint);
  currentFingerprint.current = fingerprint;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [id, setID] = useState(""),
    [notice, setNotice] = useState(false);
  const job = ai.operations.find(
    (v) => v.fingerprint === fingerprint && (v.id === id || operationActive(v)),
  );
  const busy = !!job && operationActive(job);
  const failed = job?.status === "failed";
  useEffect(() => {
    if (!job) return;
    setNotice(true);
    if (operationActive(job) || job.status === "failed") return;
    const timer = setTimeout(() => setNotice(false), 2500);
    return () => clearTimeout(timer);
  }, [job?.id, job?.status]);
  function run() {
    if (!config) {
      ai.openSettings("personal");
      return;
    }
    if (busy) return;
    if (
      job &&
      ["failed", "stopped"].includes(job.status) &&
      ai.canRetryOperation(job.id)
    ) {
      ai.retryOperation(job.id);
      return;
    }
    const origin = window.location.pathname + window.location.search;
    setID(
      ai.startOperation({
        scope,
        contextIDs,
        configID: config.id,
        locale,
        origin,
        onSaved: (v) => {
          if (alive.current && currentFingerprint.current === fingerprint)
            onSaved?.(v);
        },
      }),
    );
  }
  const message = job
    ? failed
      ? tr(job.error || "AI 操作失败")
      : job.status === "stopping"
        ? tr("停止后不再处理后续文档；当前请求可能继续保存。")
        : busy
          ? tr("已处理 {done}/{total}", {
              done: job.completed,
              total: job.total,
            })
          : job.status === "stopped"
            ? tr("已停止，已保存的内容保留")
            : job.demo
              ? tr("离线演示：仅模拟整理，未调用 AI，原文保持不变")
              : tr("已保存 {count} 条，待复核 {review} 条", {
                  count: job.saved,
                  review: job.review,
                })
    : "";
  const text = busy
    ? job!.total
      ? `${job!.completed}/${job!.total}`
      : tr("整理中…")
    : notice && job
      ? tr(
          failed
            ? "失败"
            : job.status === "stopped"
              ? "已停止"
              : job.demo
                ? "演示完成"
                : job.review
                  ? "需复核"
                  : job.saved
                    ? "已整理"
                    : "无新增",
        )
      : tr(label);
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
          run();
        }}
      >
        {busy ? (
          <LoaderCircle size={14} className="animate-spin" />
        ) : failed ? (
          <CircleAlert size={14} />
        ) : notice && job ? (
          <Check size={14} />
        ) : (
          <Sparkles size={14} />
        )}
        {size !== "icon" && (
          <span className="context-ai-label">
            <span aria-hidden="true" className="context-ai-label-size">
              {tr("整理中…")}
            </span>
            <span>{text}</span>
          </span>
        )}
      </Button>
      <button
        type="button"
        disabled={!busy || job?.status === "stopping"}
        style={{ visibility: busy ? "visible" : "hidden" }}
        className="context-ai-stop"
        title={tr("停止")}
        aria-label={tr("停止")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (job) ai.stopOperation(job.id);
        }}
      >
        <Square size={12} />
      </button>
      {job && (busy || notice) && (
        <span className="context-ai-result context-ai-task-feedback">
          <span
            role={failed ? "alert" : "status"}
            className={size === "icon" || failed ? "" : "sr-only"}
          >
            {message}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ai.setManager("operations");
            }}
          >
            {tr("查看任务")}
          </button>
        </span>
      )}
    </span>
  );
}
