"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./ui/button";
import { useI18n } from "./i18n-provider";
import { todoManagementPrompt, type TodoPromptTask } from "@/lib/report-prompt";
import { publicDemo } from "@/lib/runtime";
import type { Meta } from "@/lib/types";

export function TodoAgentAccess({
  meta,
  task,
}: {
  meta: Meta;
  task: TodoPromptTask;
}) {
  const { locale, t: tr } = useI18n();
  const [origin, setOrigin] = useState(""),
    [prompt, setPrompt] = useState(""),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const generated = origin
    ? todoManagementPrompt({
        origin,
        target: { team: meta.team.id, member: meta.current_user },
        locale,
        mode: publicDemo
          ? "offline-demo"
          : meta.mode === "local-demo"
            ? "local-demo"
            : "team",
        task,
      })
    : "";
  useEffect(() => {
    setPrompt(generated);
    setCopied(false);
  }, [generated]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <section className="report-method">
      <div className="report-method-heading">
        <h3>{tr("交给 Agent 创建任务")}</h3>
        <Button
          size="sm"
          disabled={!prompt.trim()}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(prompt);
              setCopied(true);
              setError("");
            } catch {
              setError(tr("请选中内容手动复制。"));
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
          <span aria-live="polite">{tr(copied ? "已复制" : "复制提示词")}</span>
        </Button>
      </div>
      <label className="sr-only" htmlFor="todo-agent-prompt">
        {tr("任务管理 Prompt")}
      </label>
      <textarea
        id="todo-agent-prompt"
        className="agent-prompt"
        rows={10}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setCopied(false);
        }}
      />
      <p className="report-method-note">
        {publicDemo
          ? tr(
              "演示中生成真实服务的提示词模板，复用 Agent 已有项目关联；不连接当前预览。",
            )
          : tr("可编辑提示词后交给 Agent，复用已安装的 CoFlow Skill 与凭证。")}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function TodoAPIAccess({
  meta,
  task,
}: {
  meta: Meta;
  task: TodoPromptTask;
}) {
  const { t: tr } = useI18n();
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const { title, body, source_id, priority, due_date, links } = task;
  const payload = JSON.stringify(
    {
      title,
      body,
      source_id,
      priority,
      due_date,
      links,
      column_id: publicDemo ? "<column-id>" : task.column_id,
      ...(publicDemo
        ? {}
        : {
            assignee_id: task.assignee_id,
            project_id: task.project_id,
            domains: task.domains,
          }),
      operation_id: "<unique-operation-id>",
    },
    null,
    2,
  );
  const auth =
    meta.mode === "local-demo" && !publicDemo
      ? ""
      : ' \\\n  -H "Authorization: Bearer $COFLOW_TOKEN"';
  const command = `curl --fail-with-body "$COFLOW_URL/api/v1/todo-board"${auth}\n\ncurl --fail-with-body "$COFLOW_URL/api/v1/todos"${auth} \\\n  -H 'Content-Type: application/json' \\\n  --data-binary @todo.json`;
  return (
    <section className="report-method">
      <div className="report-method-heading">
        <h3>{tr("创建任务 API")}</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setError("");
            } catch {
              setError(tr("请选中内容手动复制。"));
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
          <span aria-live="polite">{tr(copied ? "已复制" : "复制")}</span>
        </Button>
      </div>
      <p className="report-method-note">
        {tr(
          "设置真实服务的 COFLOW_URL，先读取看板取得列 ID；将草稿保存为 todo.json 后提交。",
        )}
      </p>
      <textarea
        className="agent-prompt"
        aria-label={tr("API 请求")}
        rows={7}
        value={command}
        readOnly
      />
      <label className="report-json-label" htmlFor="todo-json">
        todo.json
      </label>
      <textarea
        id="todo-json"
        className="agent-prompt"
        rows={8}
        value={payload}
        readOnly
      />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
