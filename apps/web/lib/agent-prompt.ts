"use client";
import { useEffect, useState } from "react";

export const skillPath = "/agent/coflow-report/SKILL.md";
export function reportPrompt(origin: string) {
  return `读一下 ${origin}${skillPath}，服务地址是 ${origin}，按照要求上报一下当前项目的进展、交付链接和阻塞。目前是本地演示模式，无需凭证。`;
}

/** Shared by the one-click sidebar card and the full integration dialog. */
export function useAgentPrompt() {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const prompt = origin ? reportPrompt(origin) : "正在生成接入地址…";
  async function copyPrompt() {
    try {
      if (!origin) return;
      await navigator.clipboard.writeText(prompt);
      setCopyError("");
      setCopied(true);
    } catch {
      setCopyError("无法访问剪贴板，请打开更多接入方式，手动复制 Prompt。");
    }
  }
  return { origin, prompt, copied, copyError, copyPrompt };
}
