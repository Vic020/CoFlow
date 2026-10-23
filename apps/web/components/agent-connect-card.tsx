"use client";
import { Check, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentPrompt } from "@/lib/agent-prompt";

export function AgentConnectCard({
  onCredentials,
}: {
  onCredentials: () => void;
}) {
  const {
    origin,
    copied,
    copyError,
    copyPrompt,
    needsCredential,
    checkingCredential,
  } = useAgentPrompt();
  return (
    <section className="connect-card" aria-label="快捷 Agent 接入">
      <div className="connect-card-heading">
        <Terminal size={20} />
        <span>
          让 Agent 同步工作进展<small>复制给 Agent，即可上报当前进展</small>
        </span>
      </div>
      <div className="connect-card-actions">
        <Button
          size="sm"
          disabled={!origin || checkingCredential}
          onClick={() =>
            needsCredential ? onCredentials() : void copyPrompt()
          }
        >
          {copied ? <Check /> : <Copy />}
          {needsCredential ? "创建凭证" : copied ? "已复制" : "复制上报 Prompt"}
        </Button>
      </div>
      {copyError && <p className="connect-card-feedback has-error" role="alert">{copyError}</p>}
    </section>
  );
}
