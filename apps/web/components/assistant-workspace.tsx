"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  ArrowUpRight,
  CalendarClock,
  Plug,
  CheckCheck,
  ListChecks,
  Loader2,
  MessageSquare,
  Plus,
  Settings2,
  Square,
  X,
  History,
  FileText,
  Globe,
} from "lucide-react";
import {
  AssistantHistory,
  AssistantTools,
  type AssistantToolsPage,
} from "./assistant-manager";
import { useAssistant } from "./assistant-provider";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { SelectMenu } from "./ui/select-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  safeAssistantLink,
  safeWebSourceLink,
  webProviders,
  templateTitle,
  type AIAction,
} from "@/lib/assistant";
import { request } from "@/lib/types";
import { publicDemo } from "@/lib/runtime";

export function AssistantWorkspace({ compact = false }: { compact?: boolean }) {
  const ai = useAssistant(),
    { t: tr } = useI18n();
  const [page, setPage] = useState<AssistantToolsPage | "chat">("chat");
  const navigation = [
    { id: "templates", label: "任务模板", Icon: ListChecks },
    { id: "jobs", label: "定时任务", Icon: CalendarClock },
    { id: "mcp", label: "MCP 连接", Icon: Plug },
  ] as const;
  if (compact) return <AssistantChat compact />;
  return (
    <div className="ai-full-layout">
      <aside className="ai-history-sidebar" aria-label={tr("历史对话")}>
        <Button
          className="ai-sidebar-new-chat"
          variant="outline"
          disabled={ai.busy}
          onClick={() => {
            ai.newConversation();
            setPage("chat");
          }}
        >
          <Plus size={14} />
          {tr("新对话")}
        </Button>
        <nav className="ai-sidebar-navigation" aria-label={tr("助手功能")}>
          {navigation.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              disabled={ai.busy}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={15} />
              {tr(label)}
            </button>
          ))}
        </nav>
        <div className="ai-history-sidebar-header">
          <strong>{tr("历史对话")}</strong>
        </div>
        <AssistantHistory
          inline
          highlightCurrent={page === "chat"}
          onClose={() => setPage("chat")}
        />
        <Link
          href="/settings/?tab=ai&scope=personal"
          className="ai-sidebar-settings"
        >
          <Settings2 size={14} />
          {tr("AI 设置")}
        </Link>
      </aside>
      {page === "chat" ? (
        <AssistantChat />
      ) : (
        <section
          className="ai-tools-page"
          aria-label={tr(navigation.find((item) => item.id === page)!.label)}
        >
          <header>
            <h2>{tr(navigation.find((item) => item.id === page)!.label)}</h2>
            <Button size="sm" variant="ghost" onClick={() => setPage("chat")}>
              {tr("返回对话")}
            </Button>
          </header>
          <AssistantTools
            key={page}
            page={page}
            onClose={() => setPage("chat")}
          />
        </section>
      )}
    </div>
  );
}
function AssistantChat({ compact = false }: { compact?: boolean }) {
  const ai = useAssistant(),
    auth = useAuth(),
    { t: tr, date } = useI18n();
  const { input, setInput } = ai;
  const [switchTo, setSwitchTo] = useState<string | null>(null),
    [reset, setReset] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const config = ai.configs.find((c) => c.id === ai.configID);
  const sourceChanged =
    !!ai.current?.config_snapshot?.revision &&
    ai.current.config_snapshot.revision !== config?.revision;
  const enabled =
    ai.configured &&
    !!config?.verified_at &&
    !ai.current?.archived_at &&
    !sourceChanged;
  useEffect(() => {
    end.current?.scrollIntoView({
      block: "nearest",
      behavior: ai.streamed ? "auto" : "smooth",
    });
  }, [ai.turns.length, ai.busy, ai.streamed]);
  const prompts = [
    {
      title: "查看项目进度",
      caption: "任务、进展与阻塞",
      Icon: ListChecks,
      prompt:
        "查看当前项目的进度，汇总任务、最近进展和阻塞，并给出来源链接。没有选中项目时先让我选择。",
    },
    {
      title: "安排任务时间",
      caption: "预览后确认排期",
      Icon: CalendarClock,
      prompt:
        "帮我安排当前项目的任务时间。先读取任务和已有排期，询问我希望安排的日期，再准备变更草稿。",
    },
    {
      title: "整理交付简报",
      caption: "从实际交付生成草稿",
      Icon: FileText,
      prompt:
        "根据当前项目已完成任务和近期进度，整理一份交付简报草稿并关联任务，先让我检查，不直接发布。",
    },
  ];
  return (
    <section
      className={`ai-workspace${compact ? " ai-compact" : ""}`}
      aria-label={tr("AI 助手对话")}
    >
      <div className="ai-chat-toolbar">
        <div className="ai-model-choice">
          <SelectMenu
            label={tr("AI 配置与模型")}
            value={ai.configID}
            disabled={ai.busy}
            options={
              ai.configs.length
                ? ai.configs.map((c) => ({
                    value: c.id,
                    label: `${tr(c.scope === "team" ? "团队共用" : "个人")} · ${c.name} · ${c.model}${c.verified_at ? "" : ` · ${tr("待验证")}`}`,
                  }))
                : [{ value: "", label: tr("配置 AI 服务") }]
            }
            onChange={(v) => {
              if (!v) {
                ai.openSettings("personal");
                return;
              }
              if (ai.turns.length) setSwitchTo(v);
              else ai.setConfig(v);
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr("AI 设置")}
            onClick={() => ai.openSettings(config?.scope || "personal")}
          >
            <Settings2 size={16} />
          </Button>
        </div>
        <div className="ai-toolbar-end">
          {!publicDemo && (
            <button
              type="button"
              className="ai-web-toggle"
              aria-pressed={ai.webEnabled}
              disabled={ai.busy}
              title={tr("搜索词和网址发送至所选联网服务，费用由对应密钥承担")}
              onClick={() => {
                if (
                  !ai.webConfigs.some(
                    (c) => c.id === ai.webConfigID && c.verified_at,
                  )
                ) {
                  ai.openWebSettings("personal");
                  return;
                }
                ai.setWebEnabled(!ai.webEnabled);
              }}
            >
              <Globe size={13} />
              {tr("联网")}
            </button>
          )}

          {!publicDemo && ai.webEnabled && (
            <SelectMenu
              label={tr("联网配置")}
              value={ai.webConfigID}
              onChange={(v) => {
                ai.setWebConfig(v);
                ai.setWebEnabled(true);
              }}
              options={ai.webConfigs
                .filter((c) => c.verified_at)
                .map((c) => ({
                  value: c.id,
                  label: `${tr(c.scope === "team" ? "团队共用" : "个人")} · ${c.name} · ${webProviders.find((p) => p.id === c.provider)?.name || c.provider}`,
                }))}
            />
          )}
          {!publicDemo && (
            <button
              className="ai-stream-toggle"
              type="button"
              aria-pressed={ai.streaming}
              disabled={ai.busy}
              onClick={() => ai.setStreaming(!ai.streaming)}
            >
              {tr("流式")}
            </button>
          )}
          <Button
            size="icon"
            variant="ghost"
            disabled={ai.busy}
            className={compact ? undefined : "ai-history-mobile"}
            aria-label={tr("任务与工具")}
            onClick={() => ai.setManager("templates")}
          >
            <ListChecks size={16} />
          </Button>
          <span className="ai-team-name">
            {auth.me?.teams.find((t) => t.id === auth.me?.current_team)?.name ||
              (publicDemo ? tr("演示团队") : "")}
          </span>
          <Button
            size="icon"
            variant="ghost"
            disabled={ai.busy}
            className={compact ? undefined : "ai-history-mobile"}
            aria-label={tr("历史对话")}
            onClick={() => ai.setManager("history")}
          >
            <History size={16} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={ai.busy}
            className={compact ? undefined : "ai-history-mobile"}
            aria-label={tr("新对话")}
            onClick={() => {
              if (ai.turns.length) setReset(true);
              else ai.newConversation();
            }}
          >
            <Plus size={17} />
          </Button>
        </div>
      </div>
      {ai.template && (
        <div className="ai-template-chip">
          {templateTitle(ai.template, tr)} · v{ai.template.version}
          <button
            type="button"
            disabled={ai.busy}
            onClick={() => ai.setTemplate(null)}
            aria-label={tr("清除模板")}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {ai.current?.config_snapshot?.model && (
        <small className="ai-model-snapshot">
          {ai.current.config_snapshot.provider} ·{" "}
          {ai.current.config_snapshot.model}
        </small>
      )}
      {sourceChanged && (
        <small className="ai-model-snapshot">
          {tr("AI 配置已变化，请开始新对话")}
        </small>
      )}
      {ai.current?.archived_at && (
        <small className="ai-model-snapshot">
          {tr("会话已归档，取消归档后继续。")}
        </small>
      )}
      <div className="ai-messages">
        {!ai.turns.length && !ai.busy && (
          <div className="ai-welcome">
            <div className="ai-welcome-mark">
              <MessageSquare size={25} />
            </div>
            <h2>{tr("一起推进工作")}</h2>
            <p>{tr("查进度、排时间、整理交付。")}</p>
            {!ai.ready ? (
              <Loader2 className="animate-spin" size={18} />
            ) : !enabled ? (
              <div className="ai-connect">
                <p>
                  {tr(
                    ai.configs.length
                      ? "选择已验证的配置，或先验证现有配置。"
                      : "团队尚未提供共用配置，先接入你的 AI 服务。",
                  )}
                </p>
                <Button
                  size="sm"
                  onClick={() => ai.openSettings(config?.scope || "personal")}
                >
                  <Settings2 size={15} />
                  {tr(ai.configs.length ? "管理 AI 配置" : "配置个人 AI 服务")}
                </Button>
              </div>
            ) : (
              <div className="ai-quick-tasks">
                {prompts.map(({ title, caption, Icon, prompt }) => (
                  <button
                    type="button"
                    key={title}
                    onClick={() => {
                      setInput(tr(prompt));
                      textarea.current?.focus();
                    }}
                  >
                    <Icon size={19} />
                    <strong>{tr(title)}</strong>
                    <span>{tr(caption)}</span>
                  </button>
                ))}
              </div>
            )}
            {publicDemo && (
              <small className="ai-demo-note">
                {tr("合成对话演示 · 不连接真实模型")}
              </small>
            )}
          </div>
        )}
        {ai.turns.map((turn) => (
          <div className="ai-turn" key={turn.request_id}>
            <div className="ai-user-message">{turn.user}</div>
            <div className="ai-assistant-message">
              <span className="ai-speaker">CoFlow</span>
              <div className="ai-answer">{turn.reply}</div>
              {turn.links?.length > 0 && (
                <div className="ai-sources">
                  {turn.links
                    .filter((l) => safeAssistantLink(l.url))
                    .slice(0, 8)
                    .map((l) => (
                      <Link
                        href={l.url}
                        key={l.url}
                        onClick={() => compact && ai.setPanel(false)}
                      >
                        <ArrowUpRight size={13} />
                        {l.title}
                      </Link>
                    ))}
                </div>
              )}
              {turn.web_sources?.length ? (
                <div className="ai-sources" aria-label={tr("网页来源")}>
                  {turn.web_sources
                    .filter((l) => safeWebSourceLink(l.url))
                    .slice(0, 10)
                    .map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Globe size={13} />
                        {l.title || l.url}
                      </a>
                    ))}
                </div>
              ) : null}
              {turn.web_enabled && (
                <small className="muted">
                  {turn.web_provider &&
                    `${webProviders.find((p) => p.id === turn.web_provider)?.name || turn.web_provider} · `}
                  {tr("联网请求：{0}", { 0: turn.web_requests ?? 0 })}
                </small>
              )}
              {(turn.trace?.length || turn.usage) && (
                <details className="ai-trace">
                  <summary>
                    {tr("执行记录")}
                    {turn.usage?.known ? ` · ${turn.usage.total} tokens` : ""}
                  </summary>
                  {turn.trace?.map((x, i) => (
                    <p key={i}>
                      {x.name} · {tr(x.state)} · {date(x.at)}
                    </p>
                  ))}
                  {!turn.usage?.known && <small>{tr("用量未知")}</small>}
                </details>
              )}
              {turn.actions?.map((action) => (
                <ActionCard key={action.id} action={action} compact={compact} />
              ))}
            </div>
          </div>
        ))}
        {ai.busy && (
          <div className="ai-turn">
            <div className="ai-user-message">{ai.pending}</div>
            {ai.streamed && (
              <div className="ai-answer" aria-live="off">
                {ai.streamed}
              </div>
            )}
            <p role="status" className="ai-thinking">
              <Loader2 className="animate-spin" size={15} />
              {tr("正在查询并整理…")}
            </p>
          </div>
        )}
        {!ai.busy && ai.pending && (
          <div className="ai-user-message">{ai.pending}</div>
        )}
        {ai.error && (
          <div className="ai-error">
            <p role="alert" className="error-text">
              {tr(ai.error)}
            </p>
            {ai.pending && !ai.busy && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void ai.send(ai.pending)}
              >
                {tr("重试")}
              </Button>
            )}
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || ai.busy) return;
          const v = input;
          setInput("");
          void ai.send(v);
        }}
      >
        <textarea
          ref={textarea}
          aria-label={tr("向 AI 助手提问")}
          placeholder={tr(
            enabled ? "告诉我你想推进什么…" : "接入 AI 服务后开始对话",
          )}
          value={input}
          disabled={!enabled}
          maxLength={2000}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (input.trim() && !ai.busy) {
                const v = input;
                setInput("");
                void ai.send(v);
              }
            }
          }}
        />
        <div className="ai-composer-footer">
          <small>{tr("业务变更先预览，确认后执行")}</small>
          {ai.busy ? (
            <Button
              size="icon"
              variant="outline"
              type="button"
              aria-label={tr("停止生成")}
              onClick={ai.cancel}
            >
              <Square size={14} />
            </Button>
          ) : (
            <Button
              size="icon"
              disabled={!enabled || !input.trim()}
              aria-label={tr("发送")}
            >
              <ArrowUp size={18} />
            </Button>
          )}
        </div>
      </form>
      {(switchTo !== null || reset) && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) {
              setSwitchTo(null);
              setReset(false);
            }
          }}
        >
          <DialogContent className="ai-confirm-dialog">
            <DialogTitle>
              {tr(switchTo !== null ? "切换 AI 配置？" : "开始新对话？")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                switchTo !== null
                  ? "新对话将使用所选服务商；原对话仍保留在历史中，不自动转发。"
                  : "当前对话会保留在历史中。",
              )}
            </DialogDescription>
            <div className="ai-form-actions">
              <Button
                variant="outline"
                onClick={() => {
                  setSwitchTo(null);
                  setReset(false);
                }}
              >
                {tr("取消")}
              </Button>
              <Button
                onClick={() => {
                  if (switchTo !== null) ai.setConfig(switchTo);
                  else ai.newConversation();
                  setInput("");
                  setSwitchTo(null);
                  setReset(false);
                }}
              >
                {tr("确认")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
function ActionCard({
  action,
  compact,
}: {
  action: AIAction;
  compact: boolean;
}) {
  const ai = useAssistant(),
    { t: tr, date } = useI18n();
  const [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(false),
    [title, setTitle] = useState(action.payload.title || action.title),
    [body, setBody] = useState(action.payload.body || ""),
    [error, setError] = useState("");
  const schedule = action.payload.schedule;
  const labels: Record<string, string> = {
    propose_todo: "新建任务",
    propose_schedule: "调整排期",
    propose_report: "发布简报",
    propose_task_change: "推进任务",
  };
  const target = action.result?.id
    ? action.kind === "propose_report"
      ? `/?report=${action.result.id}`
      : `/todo?todo=${action.result.id}`
    : "";
  return (
    <div className="ai-action-card">
      <div className="ai-action-heading">
        <span>{tr(labels[action.kind] || "变更草稿")}</span>
        <small>
          {tr(
            {
              pending: "待确认",
              done: "已执行",
              cancelled: "已取消",
              failed: "执行失败",
            }[action.state],
          )}
        </small>
      </div>
      {edit ? (
        <>
          <input
            aria-label={tr("草稿标题")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
          <textarea
            aria-label={tr("草稿内容")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            maxLength={10000}
          />
          <div className="ai-form-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setEdit(false)}
            >
              {tr("取消")}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await ai.saveDraft(action, title, body);
                  setEdit(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {tr("保存草稿")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <strong>{action.title}</strong>
          <small className="ai-action-context">
            {action.payload.project_name || tr("未归属")}
            {action.kind !== "propose_task_change" && action.payload.column_name
              ? ` · ${action.payload.column_name}`
              : ""}
          </small>
          {action.kind === "propose_task_change" && (
            <p className="ai-draft-body">
              {tr(
                (
                  {
                    move: "移动任务",
                    complete: "完成任务",
                    reopen: "重新打开",
                    assign: "转派任务",
                    comment: "发表评论",
                    "submit-review": "提交验收",
                    "withdraw-review": "撤回验收",
                  } as Record<string, string>
                )[action.payload.change_action || ""] || "推进任务",
              )}
              {["move", "complete", "reopen"].includes(
                action.payload.change_action || "",
              ) &&
                ` · ${action.payload.original_column_name || ""} → ${action.payload.column_name || ""}`}
              {action.payload.change_action === "assign" &&
                ` · ${action.payload.original_assignee_name || tr("未分配")} → ${action.payload.assignee_name || tr("未分配")}`}
            </p>
          )}
          {action.kind === "propose_schedule" &&
            action.payload.original_schedule && (
              <p className="muted ai-original-schedule">
                {tr("原排期")} ·{" "}
                {action.payload.original_schedule.start_date ||
                  action.payload.original_schedule.start_at}{" "}
                →{" "}
                {action.payload.original_schedule.end_date ||
                  action.payload.original_schedule.end_at}
              </p>
            )}
          {action.payload.body && (
            <p className="ai-draft-body">{action.payload.body}</p>
          )}
          {schedule && (
            <p className="ai-schedule-range">
              {schedule.kind === "date-range"
                ? `${schedule.start_date} → ${schedule.end_date}`
                : `${date(schedule.start_at!, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} → ${date(schedule.end_at!, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
            </p>
          )}
          {action.state === "pending" && (
            <div className="ai-action-buttons">
              {action.kind === "propose_report" && (
                <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
                  {tr("编辑草稿")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await ai.act(action, "cancel");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {tr("取消")}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await ai.act(action, "confirm");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CheckCheck size={14} />
                )}{" "}
                {tr("确认执行")}
              </Button>
            </div>
          )}
          {action.decided_at && <small>{date(action.decided_at)}</small>}
          {action.available === false && <small>{tr("原对象已不可用")}</small>}
          {action.state === "done" &&
            action.available !== false &&
            safeAssistantLink(target) && (
              <Link
                className="ai-action-result"
                href={target}
                onClick={() => compact && ai.setPanel(false)}
              >
                {tr("查看结果")}
                <ArrowUpRight size={14} />
              </Link>
            )}
          {action.result?.error && (
            <p className="error-text">{tr(action.result.error)}</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-text">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
export function AssistantPanel() {
  const ai = useAssistant(),
    { t: tr } = useI18n();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ai.panel) return;
    close.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") ai.setPanel(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [ai.panel]);
  if (!ai.panel) return null;
  return (
    <aside
      id="ai-assistant-panel"
      className="ai-side-panel"
      aria-label={tr("AI 助手面板")}
    >
      <header>
        <strong>{tr("AI 助手")}</strong>
        <div>
          <Link
            href="/assistant"
            aria-label={tr("展开助手")}
            onClick={() => ai.setPanel(false)}
          >
            <ArrowUpRight size={17} />
          </Link>
          <Button
            ref={close}
            size="icon"
            variant="ghost"
            aria-label={tr("关闭助手")}
            onClick={() => ai.setPanel(false)}
          >
            <X size={17} />
          </Button>
        </div>
      </header>
      <AssistantWorkspace compact />
    </aside>
  );
}
export function AssistantTrigger() {
  const ai = useAssistant(),
    { t: tr } = useI18n();
  if (ai.panel) return null;
  return (
    <Button
      className="ai-edge-trigger"
      variant="outline"
      onClick={() => ai.setPanel(true)}
      aria-label={tr("打开 AI 助手")}
      title={tr("打开 AI 助手")}
      aria-controls="ai-assistant-panel"
      aria-expanded={false}
    >
      <MessageSquare size={16} />
      <span>{tr("AI 助手")}</span>
    </Button>
  );
}
