"use client";

import { useI18n } from "@/components/i18n-provider";
import { useEffect, useId, useState } from "react";
import { Check, Copy, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { skillPath, useAgentPrompt } from "@/lib/agent-prompt";
import { publicDemo, repositoryURL, publicBasePath } from "@/lib/runtime";
import { Meta } from "@/lib/types";
import { coflowSkillVersion } from "@/lib/skill-version";
import type { ReportTab } from "@/components/report-hub";
function CopyBlock({
  value,
  label,
  rows = 4,
}: {
  value: string;
  label: string;
  rows?: number;
}) {
  const { t: tr } = useI18n();
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="report-copy-block">
      <div className="report-copy-heading">
        <label htmlFor={id}>{tr(label)}</label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setError("");
            } catch {
              setError("请选中内容手动复制。");
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? tr("已复制") : tr("复制")}
        </Button>
      </div>
      <textarea
        id={id}
        readOnly
        rows={rows}
        spellCheck={false}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
      />
      {error && (
        <p className="error-text" role="alert">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export function AgentAccess({
  method,
  meta,
  onSelect,
  onClose,
}: {
  method: Exclude<ReportTab, "manual">;
  meta: Meta;
  onSelect: (tab: ReportTab) => void;
  onClose: () => void;
}) {
  const { t: tr } = useI18n();
  const {
    origin,
    prompt,
    copied,
    copyError,
    copyPrompt,
    demo,
    needsCredential,
    checkingCredential,
  } = useAgentPrompt();
  const service = origin || tr("<服务地址>");
  const skillURL = `${service}${publicBasePath}${skillPath}`;
  const project = meta.projects.find((p) => p.status !== "archived")?.id || "";
  const domain = meta.domains.includes("研发") ? "研发" : meta.domains[0] || "";
  const sample = JSON.stringify(
    {
      source_id: "project-work-unit-id",
      title: tr("完成本轮工作"),
      body: tr("结果、交付链接和下一步。"),
      project_id: project,
      ...(demo
        ? {
            domain,
          }
        : {
            domains: domain ? [domain] : [],
          }),
      agent: tr("你的 Agent"),
      status: "progress",
      links: [],
    },
    null,
    2,
  );
  const apiCommand = `export COFLOW_URL=${shellQuote(service)}\ncurl --fail-with-body "$COFLOW_URL/api/v1/reports" \\\n  -H 'Content-Type: application/json' \\\n${demo ? "" : '  -H "Authorization: Bearer $COFLOW_TOKEN" \\\n'}  --data-binary @report.json`;
  if (publicDemo && method !== "skill")
    return (
      <section className="report-method">
        <h3>
          {method === "cli" || method === "mcp"
            ? tr("未来支持")
            : tr("在自有实例中接入 Agent")}
        </h3>
        <p className="muted">{tr("公开演示没有上报接口，也不接收凭证。")}</p>
        <Button variant="outline" asChild>
          <a
            href={`${repositoryURL}/wiki/Agent-Reporting`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {tr("查看接入指南 ↗")}
          </a>
        </Button>
      </section>
    );
  if (method === "agent")
    return (
      <section className="report-method">
        <div className="report-method-heading">
          <h3>{tr("对 Agent 说：上报 CoFlow")}</h3>
          <Button
            size="sm"
            onClick={() => void copyPrompt()}
            disabled={!origin || needsCredential || checkingCredential}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? tr("已复制") : tr("复制提示词")}
          </Button>
        </div>
        <label className="sr-only" htmlFor="agent-report-prompt">
          {tr("上报 Prompt")}
        </label>
        <textarea
          id="agent-report-prompt"
          className="agent-prompt"
          readOnly
          rows={7}
          value={prompt}
          onFocus={(e) => e.currentTarget.select()}
        />
        <p className="report-method-note" role="status">
          {copyError ||
            (copied
              ? tr("已复制，粘贴给 Agent 即可上报。")
              : demo
                ? tr("演示模式无需凭证。")
                : tr(
                    "先在 Agent 凭证中完成安装；已安装可直接说「上报 CoFlow」。",
                  ))}
        </p>
        {!demo && (
          <Link
            href="/credentials"
            className="report-text-link"
            onClick={onClose}
          >
            {needsCredential ? tr("创建 Agent 凭证") : tr("管理 Agent 凭证")}
            <ExternalLink size={12} />
          </Link>
        )}
      </section>
    );
  if (method === "skill")
    return (
      <section className="report-method">
        <h3>
          {tr("CoFlow Skill")}{" "}
          <span className="muted">v{coflowSkillVersion}</span>
        </h3>
        <p className="report-method-note">
          {tr("一个入口管理任务与上报，按需读取具体说明。")}
        </p>
        <CopyBlock value={skillURL} label={tr("Skill 链接")} rows={2} />
        <div className="report-method-actions">
          <Button asChild size="sm" variant="outline">
            <a href={`${publicBasePath}${skillPath}`} download="SKILL.md">
              <Download />
              {tr("下载 SKILL.md")}
            </a>
          </Button>
          <a
            href={`${publicBasePath}${skillPath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="report-text-link"
          >
            {tr("查看规范")}
            <ExternalLink size={12} />
          </a>
        </div>
      </section>
    );
  if (method === "mcp" || method === "cli")
    return (
      <section className="report-method report-mcp-state">
        <h3>
          {method === "mcp" ? "MCP" : "CLI"}
          {tr("暂未提供")}
        </h3>
        <p className="report-method-note">
          {tr("未来支持。目前可通过 Skill 或 API 上报。")}
        </p>
        <Button size="sm" variant="outline" onClick={() => onSelect("skill")}>
          {tr("使用 Skill 上报")}
        </Button>
      </section>
    );
  return (
    <section className="report-method">
      <h3>HTTP API</h3>
      <p className="report-method-note">
        {tr("将示例保存为 report.json，再发送请求。")}
        {!demo && tr("凭证从环境变量 COFLOW_TOKEN 读取。")}
      </p>
      <CopyBlock label={tr("API 请求")} rows={5} value={apiCommand} />
      <details className="report-json-example">
        <summary>{tr("report.json 示例")}</summary>
        <CopyBlock label={tr("上报 JSON")} value={sample} rows={12} />
      </details>
      <p className="report-method-note">
        {tr("同一工作沿用 source_id 更新，新工作使用新的标识。")}
      </p>
      <a
        href="/agent/openapi.yaml"
        target="_blank"
        rel="noopener noreferrer"
        className="report-text-link"
      >
        {tr("查看 API 协议")}
        <ExternalLink size={12} />
      </a>
    </section>
  );
}
