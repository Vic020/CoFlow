export const skillPath = "/agent/coflow-report/SKILL.md";
export function reportPrompt(
  origin: string,
  credential = "",
  demo = true,
  target?: { team: string; member: string },
) {
  if (!demo) {
    const auth = credential
      ? `我的凭证是 ${credential}`
      : "沿用你已为此站点配置的凭证（COFLOW_TOKEN 或此前提供的凭证），缺少时请提示我配置";
    const identity = target
      ? `目标 team_id=${target.team}、member_id=${target.member}，上报前校验身份一致。`
      : "";
    return `读一下 ${origin}${skillPath}，服务地址是 ${origin}，${auth}。${identity}按照要求上报一次当前项目的进展、交付链接和阻塞，同一工作沿用 source_id 更新原简报。`;
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
