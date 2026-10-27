"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { useAuth } from "@/components/auth-gate";

import {
  credentialFilePath,
  reportPrompt,
  skillPath,
} from "@/lib/report-prompt";
export { reportPrompt, skillPath } from "@/lib/report-prompt";

/** Shared by the one-click sidebar card and the full integration dialog. */
export function useAgentPrompt(taskAccess = false) {
  const { locale, t } = useI18n();
  const { mode, credential, me, tokenStatus } = useAuth();
  const demo = mode === "local-demo";
  const needsCredential = !demo && !credential && tokenStatus === "missing";
  const checkingCredential = !demo && !credential && tokenStatus === "loading";
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const credentialPath =
    origin && me && !demo
      ? credentialFilePath(origin, {
          team: me.current_team,
          member: me.user.id,
        })
      : null;
  const reportSetup = !origin
    ? "正在生成接入地址…"
    : needsCredential
      ? "请先在 Agent 凭证中安装 CoFlow。"
      : reportPrompt(
          origin,
          credential,
          demo,
          me ? { team: me.current_team, member: me.user.id } : undefined,
          locale,
        );
  const prompt =
    taskAccess && origin && credential && me
      ? locale === "en"
        ? `Install CoFlow Todo for this project. Read ${origin}/agent/coflow/SKILL.md and follow its installation reference. Service: ${origin}; team_id=${me.current_team}; member_id=${me.user.id}. My credential is ${credential}. Verify /health and /meta first; stop on identity mismatch. Save only to ${credentialPath}, directory permissions 700 and file permissions 600. Ask before replacing a different credential. Install the single coflow Skill and its linked reference files into the Agent's user-level skill directory and register the current project binding, reusing matching configuration. Do not modify project files or Git or output the credential. This request only installs; do not create tasks, report or schedule automation. Respect actual token scopes; task-only access does not permit reporting. Confirm installation only after checking the Skill, private credential and binding. Explain unsupported cross-session discovery.`
        : `请为当前项目安装 CoFlow Todo，读取 ${origin}/agent/coflow/SKILL.md，并按链接的安装说明操作。服务 ${origin}；team_id=${me.current_team}；member_id=${me.user.id}。我的凭证是 ${credential}。先验证 /health 和 /meta，身份不一致则停止。凭证只保存到 ${credentialPath}，目录权限 700、文件权限 600；已有不同凭证先确认替换。唯一的 coflow Skill 及其参考文件安装到用户级技能目录，记录当前项目关联并复用匹配配置，不修改项目文件或 Git，不输出凭证。本次仅安装，不建任务、不上报、不创建自动化。遵循实际 scope，任务权限不代表上报权限。检查 Skill、私有凭证和项目关联可用后再确认安装成功，并说明跨会话发现限制。`
      : reportSetup;
  async function copyPrompt() {
    try {
      if (!origin || needsCredential) return;
      await navigator.clipboard.writeText(prompt);
      setCopyError("");
      setCopied(true);
    } catch {
      setCopyError("无法访问剪贴板，请选中提示词手动复制。");
    }
  }
  return {
    origin,
    credentialPath,
    prompt: t(prompt),
    copied,
    copyError,
    copyPrompt,
    demo,
    needsCredential,
    checkingCredential,
  };
}
