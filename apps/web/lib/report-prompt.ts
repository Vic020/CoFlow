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
  locale: "en" | "zh-CN" = "zh-CN",
) {
  const skillURL = `${origin}${skillPath}`;
  if (demo) return locale === "en"
    ? `Read ${skillURL}. The service URL is ${origin}. Report this project's progress, delivery links, and blockers. This is a local demo; no credential is needed.`
    : `读一下 ${skillURL}，服务地址是 ${origin}，按照要求上报当前项目的进展、交付链接和阻塞。目前是本地演示模式，无需凭证。`;
  const path = credentialFilePath(origin, target);
  const identity = target
    ? locale === "en"
      ? `Target team_id=${target.team}, member_id=${target.member}. Verify identity before reporting; stop on a mismatch or invalid credential.`
      : `目标 team_id=${target.team}、member_id=${target.member}，上报前校验身份一致；不一致或凭证失效时停止。`
    : "";
  if (credential) {
    if (!path) return locale === "en"
      ? `Read ${skillURL}. My credential is ${credential}. The target identity is missing; ask me for it before installing, saving, or reporting. Never output the credential.`
      : `读取 ${skillURL}。我的凭证是 ${credential}。目标身份未指定，请先向我确认，再安装、保存或上报。不输出凭证。`;
    return locale === "en"
      ? `Install CoFlow for this project and Agent using ${skillURL}. The service URL is ${origin}. My credential is ${credential}. ${identity} First check service health and verify the team and member identity with /api/v1/meta. After successful verification, save this credential to ${path}; use directory permissions 700 and file permissions 600. If a different credential already exists, ask before replacing it. Install the Skill in this Agent's supported user-level skill directory and register the current project's binding under ~/.coflow/projects/<sha256-of-project-root>/binding.json, following the Skill's installation section. Reuse an existing matching installation; do not modify project files or Git, and never output the credential. Confirm installation only after checking that the Skill, binding, and credential are usable. Do not report during installation. Afterwards I can say “Report to CoFlow” or “上报 CoFlow”; reuse source_id for the same work. If this Agent cannot discover installed Skills in later sessions, explain that limit instead of claiming the short command will work. After installation, recommend a daily task that checks this project for meaningful changes and reports only when something changed; skip reporting when unchanged. Confirm my consent, run time, and time zone before creating the task, and reuse a matching existing task. The task must read the saved local credential, never include the token in its prompt, and reuse source_id for the same work.`
      : `请为当前项目和 Agent 安装 CoFlow，读取 ${skillURL}，服务地址是 ${origin}。我的凭证是 ${credential}。${identity}先校验服务模式，再通过 /api/v1/meta 校验下述团队和成员身份；校验成功后，将凭证保存到 ${path}，目录权限 700、文件权限 600。若已存在不同凭证，先提示我确认替换，不直接覆盖。按 Skill 的安装章节，将 Skill 安装到当前 Agent 支持的用户级技能目录，并在 ~/.coflow/projects/<sha256-of-project-root>/binding.json 记录当前项目关联。匹配的安装直接复用，不修改项目文件或 Git，不输出凭证。检查 Skill、项目关联和凭证可用后再确认安装成功；本次只安装，不上报。以后我说“上报 CoFlow”即可，同一工作沿用 source_id 更新。若当前 Agent 不支持跨会话发现 Skill，请说明限制，不要宣称短口令一定可用。安装完成后，建议创建每天检查当前项目变化的定时任务：有实质变化才上报，没有变化就跳过。先征得我同意并确认执行时间和时区，再创建；已有相同任务则复用。任务读取已保存的本机凭证，不把 token 写进任务提示词，同一工作复用 source_id。`;
  }
  const targetHint = target
    ? `team_id=${target.team}, member_id=${target.member}`
    : locale === "en" ? "confirm the target identity first" : "先确认目标身份";
  return locale === "en"
    ? `Report to CoFlow using the installed coflow-report Skill (fallback: ${skillURL}).
Credential: COFLOW_TOKEN or ${path || "the configured project binding"}. Target: ${targetHint}.
Follow the Skill for identity checks, reporting and recovery; reuse source_id for the same work.`
    : `上报 CoFlow。读取已安装的 coflow-report Skill（备用：${skillURL}）。
凭证：COFLOW_TOKEN 或 ${path || "已配置的项目关联"}；身份：${targetHint}。
按 Skill 校验、上报并处理失败，同一工作复用 source_id。`;
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
