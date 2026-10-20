export type Member = { id: string; name: string; role: string; color: string };
export type Project = {
  id: string;
  name: string;
  domains: string[];
  status: string;
};
export type Link = { title: string; url: string };
export type Comment = {
  id: string;
  report_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
export type Report = {
  id: string;
  team_id: string;
  source_id: string;
  author_id: string;
  title: string;
  body: string;
  project_id: string;
  domain: string;
  agent: string;
  model: string;
  status: string;
  links: Link[];
  mentions: string[];
  created_at: string;
  updated_at: string;
  comments: Comment[];
};
export type Meta = {
  members: Member[];
  projects: Project[];
  domains: string[];
  current_user: string;
  mode: string;
  timezone: string;
};
export const statuses: Record<string, { label: string; className: string }> = {
  progress: { label: "进展", className: "neutral" },
  review: { label: "待反馈", className: "amber" },
  blocked: { label: "有阻塞", className: "red" },
  delivered: { label: "已交付", className: "green" },
  resolved: { label: "已解决", className: "green" },
};
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let message = "连接失败，请稍后重试";
    try {
      message = (await res.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}
export function dateKey(time: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
}
export function clock(time: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(time));
}
