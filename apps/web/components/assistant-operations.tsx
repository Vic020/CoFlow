"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/types";
import { publicDemo } from "@/lib/runtime";
import {
  AIOperationStore,
  operationActive,
  type ContextOperationInput,
} from "@/lib/ai-operations";
import { useAssistant } from "./assistant-provider";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
export function useAIOperations(identity: string) {
  const [, render] = useState(0);
  const store = useRef<AIOperationStore | null>(null);
  if (!store.current)
    store.current = new AIOperationStore(
      request,
      () => render((v) => v + 1),
      () => {
        window.dispatchEvent(new Event("coflow-knowledge-change"));
        window.dispatchEvent(new Event("coflow:assistant-change"));
      },
      publicDemo,
    );
  const current = store.current;
  useEffect(() => {
    current.alive = true;
    const key = "coflow:ai-operations:" + identity;
    try {
      current.restore(JSON.parse(sessionStorage.getItem(key) || "[]"));
    } catch {}
    current.changed = () => {
      render((v) => v + 1);
      try {
        sessionStorage.setItem(key, JSON.stringify(current.snapshot()));
      } catch {}
    };
    return () => current.dispose();
  }, [current, identity]);
  return {
    operations: current.records,
    startOperation: (v: ContextOperationInput) => current.start(v),
    stopOperation: (id: string) => current.stop(id),
    retryOperation: (id: string) => current.retry(id),
    canRetryOperation: (id: string) => current.runtimes.has(id),
  };
}
const statuses = {
  running: "运行中",
  stopping: "正在停止",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  unconfirmed: "状态待确认",
} as const;
export function AssistantOperations({ onOpen }: { onOpen: () => void }) {
  const ai = useAssistant(),
    { t: tr, date } = useI18n();
  return (
    <section
      className="ai-manager-body ai-operations"
      aria-label={tr("运行任务")}
    >
      <p className="muted">
        {tr(
          "这里显示本次浏览器会话发起的 AI 操作；切换页面继续执行。刷新不会自动重跑，已保存的助手记录可继续查看。",
        )}
      </p>
      {!ai.operations.length && (
        <p className="empty-state">
          {tr(
            "还没有 AI 操作。从 Context、Todo 或 Calendar 发起后会显示在这里。",
          )}
        </p>
      )}
      {ai.operations.map((v) => (
        <article key={v.id} className="ai-operation" data-state={v.status}>
          <header>
            <strong>{tr(v.kind === "organize" ? "AI 整理" : "AI 提取")}</strong>
            <span role={operationActive(v) ? "status" : undefined}>
              {tr(statuses[v.status])}
            </span>
            <time dateTime={v.started_at}>
              {date(v.started_at, { hour: "2-digit", minute: "2-digit" })}
            </time>
          </header>
          <small className="muted">
            {tr("来自 {module}", {
              module: v.origin.split("?")[0].includes("/todo")
                ? "Todo"
                : v.origin.split("?")[0].includes("/calendar")
                  ? "Calendar"
                  : v.origin.split("?")[0].includes("/context")
                    ? "Context"
                    : "Timeline",
            })}
          </small>
          <div className="ai-operation-progress">
            <span>
              {v.total
                ? tr("已处理 {done}/{total}", {
                    done: v.completed,
                    total: v.total,
                  })
                : tr(v.status === "running" ? "正在读取范围" : "未处理文档")}
            </span>
            <span>
              {tr("已保存 {count} 条，待复核 {review} 条", {
                count: v.saved,
                review: v.review,
              })}
            </span>
          </div>
          {!!v.total && (
            <progress
              aria-label={tr("任务进度")}
              value={v.completed}
              max={v.total}
            />
          )}
          {v.status === "completed" && v.total === 0 && (
            <p>{tr("当前范围没有可处理的文档。")}</p>
          )}
          {v.status === "unconfirmed" && (
            <p>
              {tr(
                "页面刷新或身份切换后无法确认在途请求；已发出的请求可能仍保存结果。先查看助手记录和原页面，再决定是否重新发起。",
              )}
            </p>
          )}
          {v.status === "stopping" && (
            <p>{tr("停止后不再处理后续文档；当前请求可能继续保存。")}</p>
          )}
          {v.error && <p role="alert">{tr(v.error)}</p>}
          {v.demo && <p className="muted">{tr("离线演示：未调用真实 AI。")}</p>}
          {v.reply && (
            <details>
              <summary>{tr("处理说明")}</summary>
              <p className="ai-operation-reply">{v.reply}</p>
            </details>
          )}
          <div className="ai-operation-actions">
            {operationActive(v) && (
              <Button
                size="sm"
                variant="outline"
                disabled={v.status === "stopping"}
                onClick={() => ai.stopOperation(v.id)}
              >
                {tr("停止")}
              </Button>
            )}
            {["failed", "stopped"].includes(v.status) &&
              ai.canRetryOperation(v.id) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => ai.retryOperation(v.id)}
                >
                  {tr("继续未完成部分")}
                </Button>
              )}
            <Link href={v.origin} onClick={onOpen}>
              {tr("返回原页面")}
            </Link>
            {v.status === "unconfirmed" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => ai.setManager("history")}
              >
                {tr("查看历史对话")}
              </Button>
            )}
            {v.conversations.map((id, i) => (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                disabled={ai.busy}
                onClick={() => {
                  void ai.openConversation(id).then(onOpen);
                }}
              >
                {tr("助手记录 {index}", { index: i + 1 })}
              </Button>
            ))}
          </div>
          {!!v.results.length && (
            <details>
              <summary>
                {tr("查看已保存内容（{count}）", { count: v.saved })}
              </summary>
              <div className="ai-operation-results">
                {v.results.map((id, i) => (
                  <Link
                    key={id}
                    href={"/context/?context=" + encodeURIComponent(id)}
                    onClick={onOpen}
                  >
                    {tr("Context {index}", { index: i + 1 })}
                  </Link>
                ))}
              </div>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
