"use client";
import { Check, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicDemo, repositoryURL } from "@/lib/runtime";
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
  if (publicDemo) return (
    <section className="connect-card" aria-label="部署自己的 CoFlow">
      <div className="connect-card-heading"><Terminal size={20} /><span>让 Agent 加入协作<small>在自有实例中配置 Skill 与 API</small></span></div>
      <Button size="sm" asChild><a href={`${repositoryURL}/wiki/Agent-Reporting`} target="_blank" rel="noopener noreferrer">查看接入指南 ↗</a></Button>
    </section>
  );
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
