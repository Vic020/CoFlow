"use client";

import { Check, Copy, Download, ExternalLink, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { skillPath, useAgentPrompt } from "@/lib/agent-prompt";

export function AgentAccess() {
  const { origin, prompt, copied, copyError, copyPrompt } = useAgentPrompt();
  const skillURL = origin ? `${origin}${skillPath}` : "";

  return (
    <>
      <DialogTitle className="modal-title">
        <Terminal size={22} />
        Agent 接入
      </DialogTitle>
      <DialogDescription className="modal-description">
        把下面这句话交给 Agent，即可读取规范并上报当前进展。
      </DialogDescription>
      <div className="agent-skill-card">
        <div className="agent-skill-heading">
          <span className="agent-file-icon">
            <Terminal size={20} />
          </span>
          <div>
            <strong>CoFlow 上报 Skill</strong>
            <small>SKILL.md · 适用于 Codex、Claude Code 等 Agent</small>
          </div>
        </div>
        <a
          className="agent-skill-url"
          href={skillPath}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{skillURL || skillPath}</span>
          <ExternalLink size={14} />
        </a>
        <div className="agent-download-actions">
          <Button asChild variant="outline" size="sm">
            <a href={skillPath} download="SKILL.md">
              <Download />
              下载 Skill
            </a>
          </Button>
          <a
            href="/agent/openapi.yaml"
            target="_blank"
            rel="noopener noreferrer"
            className="agent-contract-link"
          >
            查看 API 协议
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
      <div className="agent-prompt-heading">
        <h3>一句话让 Agent 上报</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void copyPrompt()}
          disabled={!origin}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "已复制" : "复制 Prompt"}
        </Button>
      </div>
      <label className="sr-only" htmlFor="agent-report-prompt">
        上报 Prompt
      </label>
      <textarea
        id="agent-report-prompt"
        className="agent-prompt"
        readOnly
        value={prompt}
        rows={5}
        onFocus={(e) => e.currentTarget.select()}
      />
      <p className="agent-copy-status" role="status">
        {copyError ||
          (copied
            ? "已复制，可直接粘贴给正在工作的 Agent。"
            : "无需先安装 CLI，Agent 可直接通过 HTTP 上报。")}
      </p>
      <div className="info-callout">
        当前为本地演示，所有上报归属陈一，暂不支持个人凭证。此本机地址仅供能访问当前电脑的
        Agent 使用，团队共享需部署后使用站点地址。
      </div>
      <details className="agent-advanced">
        <summary>其他接入方式：CLI / API</summary>
        <h3>CLI 上报</h3>
        <pre>
          <code>{`COFLOW_URL=${origin || "<站点地址>"} node apps/cli/coflow.mjs report --file report.json`}</code>
        </pre>
        <h3>API 上报</h3>
        <pre>
          <code>{`POST ${origin || "<站点地址>"}/api/v1/reports\nContent-Type: application/json\n\n{\n  "source_id": "stable-work-unit-id",\n  "title": "完成首页移动端适配",\n  "body": "预览已更新，等待设计确认。",\n  "project_id": "website",\n  "domain": "研发",\n  "agent": "Codex",\n  "status": "review",\n  "links": []\n}`}</code>
        </pre>
        <p className="muted text-sm">
          相同 source_id 更新已有简报；新的工作使用新的标识。
        </p>
      </details>
    </>
  );
}
