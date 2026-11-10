"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Square,
  Check,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";
import { useAssistant } from "./assistant-provider";
import { useI18n } from "./i18n-provider";
import { ActionFeedback } from "./ui/action-feedback";
import { Button } from "./ui/button";
import { request } from "@/lib/types";
import { publicDemo } from "@/lib/runtime";
import { ContentSkeleton } from "./ui/loading-status";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { defaultAIConfig } from "@/lib/assistant";
import {
  contextOperationKey,
  planContextSources,
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
  contextTitles,
}: {
  scope: ContextAIScope;
  contextIDs?: string[];
  contextTitles?: Record<string, string>;
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
  const planGeneration = useRef(0);
  const [plan, setPlan] = useState<{
    fingerprint: string;
    configID: string;
    configRevision: number;
    configName: string;
    model: string;
    sources: ContextAIScope[] | null;
    titles: Record<string, string>;
    retryID?: string;
    error: string;
    unknown?: boolean;
  } | null>(null);
  function closePlan() {
    planGeneration.current++;
    setPlan(null);
  }
  async function prepare() {
    if (!config) {
      ai.openSettings("personal");
      return;
    }
    if (busy || plan) return;
    const generation = ++planGeneration.current;
    const base = {
      fingerprint,
      configID: config.id,
      configRevision: config.revision,
      configName: config.name,
      model: config.model,
      sources: null,
      titles: {},
      error: "",
    };
    const retry =
      job &&
      ["failed", "stopped"].includes(job.status) &&
      ai.canRetryOperation(job.id);
    if (retry) {
      const steps = job.steps.filter((s) => s.state !== "completed");
      setPlan({
        ...base,
        retryID: job.id,
        unknown:
          !job.total || steps.some((step) => step.source_kind === "scope"),
        sources: steps.length
          ? steps.map((s) => ({
              ...scope,
              source_kind:
                s.source_kind === "scope" ? undefined : s.source_kind,
              source_id: s.source_id || undefined,
            }))
          : [scope],
        titles: Object.fromEntries(steps.map((s) => [s.source_id, s.title])),
      });
      return;
    }
    setPlan(base);
    try {
      const prepared = await planContextSources(request, {
        scope,
        contextIDs,
        contextTitles,
      });
      if (alive.current && generation === planGeneration.current)
        setPlan({
          ...base,
          ...prepared,
          unknown: prepared.sources.some((source) => !source.source_id),
        });
    } catch (e) {
      if (alive.current && generation === planGeneration.current)
        setPlan({ ...base, error: (e as Error).message });
    }
  }
  function run() {
    if (!plan || !plan.sources?.length || plan.error || busy || !config) return;
    if (
      currentFingerprint.current !== plan.fingerprint ||
      config.id !== plan.configID ||
      config.revision !== plan.configRevision
    ) {
      setPlan({ ...plan, error: "范围或模型已变化，请重新查看计划" });
      return;
    }
    if (plan.retryID) {
      ai.retryOperation(plan.retryID);
      closePlan();
      return;
    }
    const origin = window.location.pathname + window.location.search;
    setID(
      ai.startOperation({
        scope,
        contextIDs,
        plannedSources: plan.sources,
        contextTitles: plan.titles,
        configID: plan.configID,
        locale,
        origin,
        onSaved: (v) => {
          if (alive.current && currentFingerprint.current === fingerprint)
            onSaved?.(v);
        },
      }),
    );
    closePlan();
  }
  const explanation = tr(
    scope.mode === "organize"
      ? "整理当前范围的知识结构、重复内容和来源，保存到 Context。"
      : "读取当前范围的来源，提炼有依据的知识并保存到 Context。",
  );
  const anchor = useRef<HTMLSpanElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedback, setFeedback] = useState(false);
  const hideFeedback = useCallback(() => setFeedback(false), []);
  function showFeedback() {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback(true);
  }
  function leaveFeedback() {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      if (
        anchor.current?.contains(document.activeElement) ||
        document.activeElement?.closest(".action-feedback")
      )
        return;
      hideFeedback();
    }, 180);
  }
  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const hasFeedback = !!job && (busy || notice);
  function viewTask() {
    setFeedback(false);
    ai.setManager("operations");
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
    : tr(label);
  return (
    <span
      ref={anchor}
      onPointerEnter={showFeedback}
      onPointerLeave={leaveFeedback}
      onFocusCapture={showFeedback}
      onBlurCapture={leaveFeedback}
      className="context-ai-action"
      data-icon={size === "icon" ? "true" : undefined}
      data-busy={busy || undefined}
      data-feedback={hasFeedback || undefined}
      data-failed={failed || undefined}
      data-variant={variant}
    >
      <Button
        type="button"
        title={hasFeedback ? undefined : explanation}
        aria-label={tr(label)}
        size={size}
        variant={variant}
        disabled={busy || !ai.ready || !!plan}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setFeedback(false);
          void prepare();
        }}
      >
        <Sparkles size={14} />
        {size !== "icon" && (
          <span className="context-ai-label">
            <span aria-hidden="true" className="context-ai-label-size">
              {tr("整理中…")}
            </span>
            <span>{text}</span>
          </span>
        )}
      </Button>
      {busy ? (
        <button
          type="button"
          disabled={job?.status === "stopping"}
          style={{ visibility: busy ? "visible" : "hidden" }}
          className="context-ai-control context-ai-stop"
          title={tr("停止")}
          aria-label={tr("停止")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (job) ai.stopOperation(job.id);
          }}
        >
          <LoaderCircle
            size={12}
            className="context-ai-busy-icon animate-spin"
          />
          <Square size={12} className="context-ai-stop-icon" />
        </button>
      ) : hasFeedback ? (
        <button
          type="button"
          className="context-ai-control context-ai-status"
          aria-label={tr("查看任务")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            viewTask();
          }}
        >
          {failed ? (
            <CircleAlert size={13} />
          ) : job?.status === "unconfirmed" ? (
            <CircleAlert size={13} />
          ) : (
            <Check size={13} />
          )}
        </button>
      ) : null}
      {plan && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closePlan();
          }}
        >
          <DialogContent
            className="ai-config-dialog context-ai-plan"
            onClick={(e) => e.stopPropagation()}
          >
            <DialogTitle>
              {tr(scope.mode === "organize" ? "AI 整理计划" : "AI 提取计划")}
            </DialogTitle>
            <DialogDescription>{explanation}</DialogDescription>
            {!plan.sources && !plan.error ? (
              <ContentSkeleton rows={2} />
            ) : (
              <>
                <dl>
                  <div>
                    <dt>{tr("处理范围")}</dt>
                    <dd>{tr(scope.source_id ? "当前记录" : "当前筛选范围")}</dd>
                  </div>
                  <div>
                    <dt>{tr("工作量")}</dt>
                    <dd>
                      {plan.unknown
                        ? tr("先读取范围，再逐项处理")
                        : tr("{count} 项来源，逐项处理", {
                            count: plan.sources?.length || 0,
                          })}
                    </dd>
                  </div>
                  <div>
                    <dt>{tr("使用配置")}</dt>
                    <dd>
                      {plan.configName}
                      {!plan.configName.includes(plan.model) &&
                        ` · ${plan.model}`}
                    </dd>
                  </div>
                </dl>
                {plan.retryID && (
                  <p className="muted">
                    {tr("仅继续未完成部分，已处理项会跳过。")}
                  </p>
                )}
                {!!plan.sources?.length && !plan.unknown && (
                  <ul>
                    {plan.sources.slice(0, 4).map((source, index) => (
                      <li key={index}>
                        {plan.titles[source.source_id || ""] ||
                          (source.source_kind
                            ? tr("{type} · 第 {index} 项", {
                                type:
                                  (
                                    {
                                      context: "Context",
                                      todo: "Todo",
                                      report: "Timeline",
                                      calendar: "Calendar",
                                    } as Record<string, string>
                                  )[source.source_kind] || "Context",
                                index: index + 1,
                              })
                            : tr("范围内的任务、进度和知识"))}
                      </li>
                    ))}
                    {plan.sources.length > 4 && (
                      <li>
                        {tr("另有 {count} 项", {
                          count: plan.sources.length - 4,
                        })}
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}
            <p className="muted">
              {tr("只更新 Context，原任务、进度和排期保持不变。")}
            </p>
            <p className="muted">
              {tr(
                publicDemo
                  ? "离线演示：未调用真实 AI。"
                  : "每项可能多次调用模型，费用由所选配置承担。可停止后续处理，已发出的请求可能继续保存。",
              )}
            </p>
            {plan.sources?.length === 0 && (
              <p>{tr("当前范围没有可处理的文档。")}</p>
            )}
            {plan.error && (
              <p role="alert" className="error-text">
                {tr(plan.error)}
              </p>
            )}
            <div className="ai-form-actions">
              <Button type="button" variant="outline" onClick={closePlan}>
                {tr("取消")}
              </Button>
              <Button
                type="button"
                disabled={!plan.sources?.length || !!plan.error || !ai.ready}
                onClick={run}
              >
                {tr(
                  plan.retryID
                    ? "继续未完成部分"
                    : scope.mode === "organize"
                      ? "开始整理"
                      : "开始提取",
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {hasFeedback && (
        <span className="sr-only" role={failed ? "alert" : "status"}>
          {message}
        </span>
      )}
      {hasFeedback && feedback && !plan && (
        <ActionFeedback
          anchor={anchor}
          message={message}
          onView={viewTask}
          onClose={hideFeedback}
          onEnter={showFeedback}
          onLeave={leaveFeedback}
        />
      )}
    </span>
  );
}
