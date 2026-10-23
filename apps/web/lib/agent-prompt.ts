"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-gate";

import {
  credentialFilePath,
  reportPrompt,
  skillPath,
} from "@/lib/report-prompt";
export { reportPrompt, skillPath } from "@/lib/report-prompt";

/** Shared by the one-click sidebar card and the full integration dialog. */
export function useAgentPrompt() {
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
  const prompt = !origin
    ? "正在生成接入地址…"
    : needsCredential
      ? "请先创建或选择自己的 Agent 凭证，再复制上报 Prompt。"
      : reportPrompt(
          origin,
          credential,
          demo,
          me ? { team: me.current_team, member: me.user.id } : undefined,
        );
  async function copyPrompt() {
    try {
      if (!origin || needsCredential) return;
      await navigator.clipboard.writeText(prompt);
      setCopyError("");
      setCopied(true);
    } catch {
      setCopyError(
        "无法访问剪贴板，请打开顶部上报的 Agent 页签手动复制 Prompt。",
      );
    }
  }
  return {
    origin,
    credentialPath,
    prompt,
    copied,
    copyError,
    copyPrompt,
    demo,
    needsCredential,
    checkingCredential,
  };
}
