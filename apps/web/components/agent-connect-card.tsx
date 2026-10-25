"use client";

import { useI18n } from "@/components/i18n-provider";
import { Check, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicDemo, repositoryURL } from "@/lib/runtime";
import { useAgentPrompt } from "@/lib/agent-prompt";
export function AgentConnectCard({
  onCredentials,
}: {
  onCredentials: () => void;
}) {
  const { t: tr } = useI18n();
  const {
    origin,
    copied,
    copyError,
    copyPrompt,
    needsCredential,
    checkingCredential,
  } = useAgentPrompt();
  if (publicDemo)
    return (
      <section className="connect-card" aria-label={tr("部署自己的 CoFlow")}>
        <div className="connect-card-heading">
          <Terminal size={20} />
          <span>
            {tr("让 Agent 加入协作")}
            <small>{tr("在自有实例中配置 Skill 与 API")}</small>
          </span>
        </div>
        <Button size="sm" asChild>
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
  return (
    <section className="connect-card" aria-label={tr("快捷 Agent 接入")}>
      <div className="connect-card-heading">
        <Terminal size={20} />
        <span>
          {tr("让 Agent 同步工作进展")}
          <small>{tr("安装一次，之后说「上报 CoFlow」")}</small>
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
          {needsCredential
            ? tr("安装到 Agent")
            : copied
              ? tr("已复制")
              : tr("复制上报指令")}
        </Button>
      </div>
      {copyError && (
        <p className="connect-card-feedback has-error" role="alert">
          {tr(copyError)}
        </p>
      )}
    </section>
  );
}
