export type ContextSource = {
  kind: "todo" | "report" | "calendar" | "context";
  id: string;
  revision: string;
  quote: string;
  url?: string;
  changed?: boolean;
  needs_review?: boolean;
  archived?: boolean;
};
export type ContextEntry = {
  parent_id?: string;
  agent?: string;
  id: string;
  source_id: string;
  creator_id: string;
  title: string;
  body: string;
  kind: string;
  visibility: string;
  project_id: string;
  domains: string[];
  state: string;
  valid_from: string;
  valid_until: string;
  review_on: string;
  superseded_by: string;
  sources: ContextSource[];
  revision: number;
  created_at: string;
  updated_at: string;
  needs_review: boolean;
  history?: {
    actor_kind?: string;
    agent?: string;
    state?: string;
    review_on?: string;
    revision: number;
    actor_id: string;
    action: string;
    at: string;
    title: string;
    body: string;
    unavailable?: boolean;
  }[];
};
export const contextKinds: Record<string, string> = {
  document: "文档",
  index: "目录索引",
  background: "背景",
  decision: "决定",
  rule: "规则与约束",
  conclusion: "结论",
  risk: "风险",
  date: "关键日期",
};
export const contextStates: Record<string, string> = {
  pending: "待确认",
  active: "有效",
  expired: "已过期",
  archived: "已归档",
};
export function blankContext(): ContextEntry {
  return {
    parent_id: "",
    id: "",
    source_id: crypto.randomUUID(),
    creator_id: "",
    title: "",
    body: "",
    kind: "decision",
    visibility: "team",
    project_id: "",
    domains: [],
    state: "pending",
    valid_from: "",
    valid_until: "",
    review_on: "",
    superseded_by: "",
    sources: [],
    revision: 0,
    created_at: "",
    updated_at: "",
    needs_review: false,
  };
}
export type Delegation = {
  id: string;
  grantor_id: string;
  member_id: string;
  todo_id: string;
  project_id: string;
  actions: string[];
  expires_at: string;
  revoked_at?: string;
  revision: number;
  history?: { action: string; created_at: string }[];
};

export function contextExcerpt(value: string, maxBytes: number) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export type ContextNode = { reference_ids?: string[] } & Pick<
  ContextEntry,
  | "id"
  | "parent_id"
  | "title"
  | "kind"
  | "state"
  | "visibility"
  | "project_id"
  | "domains"
  | "creator_id"
  | "revision"
  | "needs_review"
  | "updated_at"
>;
export function wikiIntroduction(
  name: string,
  project = "",
  domains: string[] = [],
  tr: (v: string) => string = (v) => v,
): ContextEntry {
  return {
    ...blankContext(),
    kind: "document",
    project_id: project,
    domains,
    title: name,
    body: `# ${name}\n\n## ${tr("概览")}\n\n## ${tr("目标与范围")}\n\n## ${tr("协作约定")}\n\n## ${tr("参考资料")}\n`,
  };
}
