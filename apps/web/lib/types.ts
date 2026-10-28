import { calendarDateKey, formatDate } from "./i18n/core";
import { publicDemo } from "./runtime";
import { ReadCache, cacheableRead, readKey } from "./read-cache";
export type InvitationInfo = {
  email: string;
  email_domain: string;
  inviter_name: string;
  team_name: string;
};
export type Member = {
  avatar_data?: string;
  id: string;
  name: string;
  role: string;
  color: string;
};
export type Project = {
  id: string;
  name: string;
  domains: string[];
  status: string;
};
export type Category = {
  id: string;
  kind: "project" | "domain";
  name: string;
  aliases: string[];
  state: "active" | "pending" | "archived" | "merged";
  merged_into: string;
};
export type Collaboration = {
  todo_id?: string;
  id: string;
  report_id: string;
  author_id: string;
  assignee_id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
  updates: {
    id: string;
    actor_id: string;
    status: string;
    body: string;
    created_at: string;
  }[];
};
export type Notification = {
  todo_id?: string;
  id: string;
  report_id: string;
  request_id: string;
  title: string;
  kind: string;
  created_at: string;
  read_at: string | null;
};
export type Link = { title: string; url: string };
export type Comment = {
  deleted_at?: string;
  id: string;
  report_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
export type Report = {
  todo_ids?: string[];
  deleted_at?: string;
  id: string;
  team_id: string;
  source_id: string;
  author_id: string;
  title: string;
  body: string;
  project_id: string;
  domain: string;
  domains: string[];
  classification_input?: {
    project_id?: string;
    project_name?: string;
    domain?: string;
    domains?: string[];
  };
  classification_locked?: boolean;
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
  role: string;
  team: { id: string; name: string };
  catalog?: Category[];
};
export const collaborationStatuses: Record<string, string> = {
  open: "待接手",
  in_progress: "进行中",
  blocked: "有阻塞",
  done: "已完成",
  cancelled: "已取消",
};
export function reportDomains(r: Report) {
  return r.domains?.length ? r.domains : r.domain ? [r.domain] : [];
}
export const statuses: Record<string, { label: string; className: string }> = {
  progress: { label: "进展", className: "neutral" },
  review: { label: "待反馈", className: "amber" },
  blocked: { label: "有阻塞", className: "red" },
  delivered: { label: "已交付", className: "green" },
  resolved: { label: "已解决", className: "green" },
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const reads = new ReadCache();
let channel: BroadcastChannel | null = null;
let channelReady = false;
function cacheChannel() {
  if (typeof window === "undefined" || channelReady) return channel;
  channelReady = true;
  try {
    channel = new BroadcastChannel("coflow-cache");
    channel.onmessage = (event) => {
      reads.invalidate();
      if (event.data === "session") {
        reads.setScope(null);
        window.dispatchEvent(new Event("coflow:session-changed"));
      }
    };
  } catch {
    /* Some browsers disable cross-tab channels. Focus revalidates too. */
  }
  return channel;
}
export function setReadCacheScope(scope: string | null) {
  cacheChannel();
  reads.setScope(scope);
}
export function invalidateReadCache() {
  reads.invalidate();
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const mutation =
    !!init?.method && !["GET", "HEAD"].includes(init.method.toUpperCase());
  if (mutation) {
    const sessionMutation = [
      "/auth/login",
      "/auth/logout",
      "/auth/team",
      "/auth/bootstrap",
      "/auth/accept-invite",
    ].includes(path);
    reads.invalidate();
    if (sessionMutation) reads.setScope(null);
    try {
      return await transport<T>(path, init);
    } finally {
      reads.invalidate();
      cacheChannel()?.postMessage(sessionMutation ? "session" : "data");
    }
  }
  if (typeof window !== "undefined" && cacheableRead(path, init))
    return reads.read(readKey(path), () => transport<T>(path, init));
  return transport<T>(path, init);
}

async function transport<T>(path: string, init?: RequestInit): Promise<T> {
  if (publicDemo) {
    const { publicDemoRequest } = await import("./public-demo");
    return (await publicDemoRequest(path, init)) as T;
  }
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let message = "连接失败，请稍后重试";
    try {
      message = (await res.json()).error || message;
    } catch {}
    if (
      res.status === 401 &&
      !path.startsWith("/auth/") &&
      !init?.headers &&
      typeof window !== "undefined"
    ) {
      setReadCacheScope(null);
      window.dispatchEvent(new Event("coflow:unauthorized"));
    }
    throw new ApiError(message, res.status);
  }
  return res.json();
}
export function dateKey(time: string, timeZone = "Asia/Shanghai") {
  return calendarDateKey(time, timeZone);
}
export function clock(time: string, locale = "en", timeZone = "Asia/Shanghai") {
  return formatDate(locale, time, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}
