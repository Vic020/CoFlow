export const skillPath = "/agent/coflow-report/SKILL.md";
export type ReportTarget = { team: string; member: string };

/** A deterministic, portable filename; never use raw URLs or identity IDs as paths. */
export function credentialFilePath(origin: string, target?: ReportTarget) {
  if (!target?.team || !target.member) return null;
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid CoFlow service origin");
  const segment = (value: string) =>
    encodeURIComponent(value).replace(/\./g, "%2E");
  return `~/.coflow/credentials/${encodeURIComponent(url.origin)}/${segment(target.team)}/${segment(target.member)}.token`;
}

export function reportPrompt(
  origin: string,
  credential = "",
  demo = true,
  target?: ReportTarget,
) {
  if (!demo) {
    const path = credentialFilePath(origin, target);
    const auth = credential
      ? `我的凭证是 ${credential}。${
          path
            ? `先校验下述团队和成员身份；校验成功后，请将此凭证保存到本机用户目录 ${path}，文件只包含 token，目录权限 700、文件权限 600。若已存在不同凭证，先提示我确认替换，不直接覆盖。不要写入项目目录或 Git。`
            : "仅在本次请求内存中使用，不知道目标身份时不要保存到文件。"
        }`
      : `优先读取 COFLOW_TOKEN，否则只读取本机凭证文件 ${path || "（目标身份未指定，请先配置）"}；缺少时提示我完成首次配置，不搜索其他目录或聊天记录。`;
    const identity = target
      ? `目标 team_id=${target.team}、member_id=${target.member}，上报前校验身份一致；不一致或凭证失效时停止。`
      : "";
    return `读一下 ${origin}${skillPath}，服务地址是 ${origin}，${auth}${identity}按照要求上报一次当前项目的进展、交付链接和阻塞，同一工作沿用 source_id 更新原简报，不输出凭证。`;
  }
  return `读一下 ${origin}${skillPath}，服务地址是 ${origin}，按照要求上报一下当前项目的进展、交付链接和阻塞。目前是本地演示模式，无需凭证。`;
}

export type AgentTokenMetadata = {
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
};
export function hasActiveReportToken(
  tokens: AgentTokenMetadata[],
  now = Date.now(),
) {
  return tokens.some(
    (t) =>
      !t.revoked_at &&
      Date.parse(t.expires_at) > now &&
      t.scopes.includes("reports:write"),
  );
}
