"use client";
import { Check, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentPrompt } from "@/lib/agent-prompt";

export function AgentConnectCard({ onMore }: { onMore: () => void }) {
  const { origin, copied, copyError, copyPrompt } = useAgentPrompt();
  return (
    <section className="connect-card" aria-label="快捷 Agent 接入">
      <div className="connect-card-heading">
        <Terminal size={20} />
        <span>
          让 Agent 同步工作进展<small>复制给 Agent，即可上报当前进展</small>
        </span>
      </div>
      <div className="connect-card-actions">
        <Button size="sm" disabled={!origin} onClick={() => void copyPrompt()}>
          {copied ? <Check /> : <Copy />}
          {copied ? "已复制" : "复制上报 Prompt"}
        </Button>
        <Button variant="outline" size="sm" onClick={onMore}>
          更多接入方式
        </Button>
      </div>
      <p
        className={`connect-card-feedback ${copyError ? "has-error" : ""}`}
        role="status"
      >
        {copyError ||
          (copied ? "已复制，粘贴给 Agent 即可上报。" : "Skill / CLI / API")}
      </p>
    </section>
  );
}
