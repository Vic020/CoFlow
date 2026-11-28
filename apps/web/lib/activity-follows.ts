import { request } from "./types";

export type ActivityFollow = { kind: "project" | "member" | "report"; target_id: string; title?: string };

export function listActivityFollows() {
  return request<{ items: ActivityFollow[] }>("/activity/follows");
}

export function setActivityFollow(kind: ActivityFollow["kind"], id: string, following: boolean) {
  return request<{ following: boolean }>(`/activity/follows/${kind}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ following }),
  });
}
