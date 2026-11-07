export type AIConfig = {
  id: string;
  name: string;
  scope: "team" | "personal";
  provider: string;
  protocol: string;
  base_url: string;
  model: string;
  revision: number;
  is_default: boolean;
  verified_at: string | null;
  editable: boolean;
};
export type AIAction = {
  available?: boolean;
  decided_at?: string;
  id: string;
  kind: string;
  title: string;
  payload: {
    board_revision?: number;
    expected_revision?: number;
    column_id?: string;
    change_action?: string;
    assignee_id?: string;
    assignee_name?: string;
    original_column_name?: string;
    original_assignee_name?: string;
    project_name?: string;
    column_name?: string;
    original_schedule?: {
      kind: string;
      start_date?: string;
      end_date?: string;
      start_at?: string;
      end_at?: string;
      timezone?: string;
    };
    title?: string;
    body?: string;
    todo_id?: string;
    project_id?: string;
    schedule?: {
      kind: string;
      start_date?: string;
      end_date?: string;
      start_at?: string;
      end_at?: string;
      timezone?: string;
    };
  };
  state: "pending" | "done" | "failed" | "cancelled";
  result?: { id?: string; error?: string };
};
export type AITurn = {
  web_enabled?: boolean;
  web_requests?: number;
  web_sources?: { title: string; url: string }[];
  usage?: { input: number; output: number; total: number; known: boolean };
  trace?: { name: string; state: string; at: string }[];
  request_id: string;
  user: string;
  reply: string;
  actions: AIAction[];
  links: { title: string; url: string }[];
};
export type AIConversation = {
  revision: number;
  updated_at: string;
  archived_at?: string | null;
  deleted_at?: string | null;
  config_snapshot?: AIConfig;
  template?: AITemplate;
  id: string;
  title: string;
  config_id: string;
  turns?: AITurn[];
};
export const aiProviders = [
  {
    id: "deepseek",
    name: "DeepSeek",
    base: "https://api.deepseek.com",
    protocol: "chat-completions",
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
  {
    id: "glm",
    name: "智谱 / GLM",
    base: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "chat-completions",
    models: ["glm-5.3"],
  },
  {
    id: "openai",
    name: "OpenAI / Codex",
    base: "https://api.openai.com/v1",
    protocol: "responses",
    models: ["gpt-5.4", "gpt-5.4-mini"],
  },
  {
    id: "compatible",
    name: "兼容 API",
    base: "",
    protocol: "chat-completions",
    models: [],
  },
];
export const aiQuickTasks = [
  "查看项目进度",
  "安排任务时间",
  "整理交付简报",
] as const;
export function defaultAIConfig(configs: AIConfig[]) {
  const ready = configs.filter((c) => c.verified_at);
  return (
    ready.find((c) => c.scope === "team" && c.is_default) ||
    ready.find((c) => c.scope === "personal" && c.is_default) ||
    ready.find((c) => c.scope === "team") ||
    ready[0]
  );
}
// Only Go-generated object links are navigable; model text stays plain text.
export function safeAssistantLink(url: string) {
  return /^\/(?:\?(?:report)=[a-zA-Z0-9_-]+|todo\?todo=[a-zA-Z0-9_-]+|calendar\?(?:mode=schedule&date=\d{4}-\d{2}-\d{2}|event=[a-zA-Z0-9_-]+))$/.test(
    url,
  );
}

export type AITemplate = {
  id: string;
  scope: "builtin" | "personal" | "team";
  title: string;
  description: string;
  instructions: string;
  parameters: { name: string; label: string; required: boolean }[];
  tools: string[];
  version: number;
  revision: number;
  editable: boolean;
};
export type AIJob = {
  last_run_state?: string;
  parameters: Record<string, string>;
  id: string;
  title: string;
  config_id: string;
  config_revision: number;
  template: AITemplate;
  context: Record<string, string>;
  prompt: string;
  locale: string;
  timezone: string;
  local_time: string;
  weekdays: number[];
  publish: boolean;
  enabled: boolean;
  revision: number;
  next_run_at: string;
};
export type AIRun = {
  id: string;
  job_id: string;
  scheduled_at: string;
  state: string;
  attempts: number;
  conversation_id: string | null;
  report_id: string | null;
  message: string;
  finished_at: string | null;
};
export type AIMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
export type AIMCP = {
  id: string;
  name: string;
  scope: "personal" | "team";
  url: string;
  revision: number;
  tools: AIMCPTool[];
  approved_tools: AIMCPTool[];
  verified_at: string | null;
  editable: boolean;
  token?: string;
};
export function templateTitle(
  t: AITemplate,
  tr: (s: string) => string = (s) => s,
) {
  if (t.scope !== "builtin") return t.title;
  return tr(
    (
      {
        "builtin-progress": "查看项目进度",
        "builtin-schedule": "安排任务时间",
        "builtin-brief": "整理交付简报",
      } as Record<string, string>
    )[t.id] || t.title,
  );
}
export function templateDescription(
  t: AITemplate,
  tr: (s: string) => string = (s) => s,
) {
  if (t.scope !== "builtin") return t.description;
  return tr(
    (
      {
        "builtin-progress": "任务、进展与阻塞",
        "builtin-schedule": "预览后确认排期",
        "builtin-brief": "从实际交付生成草稿",
      } as Record<string, string>
    )[t.id] || t.description,
  );
}
export function templateParameterLabel(
  t: AITemplate,
  p: { name: string; label: string },
  tr: (s: string) => string = (s) => s,
) {
  if (t.scope !== "builtin") return p.label;
  return tr(
    (
      { project: "项目", period: "时间范围", dates: "日期" } as Record<
        string,
        string
      >
    )[p.name] || p.label,
  );
}

export function supportsDeepseekWeb(config?: AIConfig) {
  if (
    !config ||
    config.provider !== "deepseek" ||
    config.protocol !== "chat-completions" ||
    !config.verified_at
  )
    return false;
  try {
    const u = new URL(config.base_url);
    return (
      u.protocol === "https:" &&
      u.hostname === "api.deepseek.com" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      ["/", "/v1", "/v1/"].includes(u.pathname)
    );
  } catch {
    return false;
  }
}
export function safeWebSourceLink(raw: string) {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase().replace(/\.$/, "");
    if (
      [...u.searchParams.keys()].some(
        (k) =>
          [
            "token",
            "access_token",
            "api_key",
            "password",
            "secret",
            "authorization",
          ].includes(k.toLowerCase()) && u.searchParams.get(k),
      )
    )
      return false;
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      !h.includes(".") ||
      h === "localhost" ||
      /\.(localhost|local|internal)$/.test(h)
    )
      return false;
    if (/^\d+(\.\d+){3}$/.test(h)) {
      const [a, b] = h.split(".").map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
