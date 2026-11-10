import type { ContextEntry, ContextNode } from "./context";
export type ContextAIScope = {
  project?: string;
  domain?: string;
  member?: string;
  source_kind?: string;
  source_id?: string;
  mode?: "extract" | "organize";
};
export type OperationStatus =
  "running" | "stopping" | "completed" | "failed" | "stopped" | "unconfirmed";
export type AIOperation = {
  id: string;
  fingerprint: string;
  kind: "extract" | "organize";
  status: OperationStatus;
  origin: string;
  started_at: string;
  updated_at: string;
  total: number;
  completed: number;
  saved: number;
  review: number;
  results: string[];
  conversations: string[];
  error: string;
  reply: string;
  demo: boolean;
};
export type ContextOperationInput = {
  scope: ContextAIScope;
  contextIDs?: string[];
  configID: string;
  locale: string;
  origin: string;
  onSaved?: (v: ContextEntry) => void;
};
type Client = <T>(
  path: string,
  options?: { method?: string; body?: string },
) => Promise<T>;
type Runtime = {
  input: ContextOperationInput;
  queue: ContextAIScope[] | null;
  index: number;
  items: Map<string, ContextEntry>;
  attempts: Record<number, number>;
  stop: boolean;
  executing: boolean;
};
export const operationActive = (v: AIOperation) =>
  v.status === "running" || v.status === "stopping";
export function contextOperationKey(
  v: Pick<
    ContextOperationInput,
    "scope" | "contextIDs" | "configID" | "locale"
  >,
) {
  const s = v.scope;
  return JSON.stringify([
    v.configID,
    s.project || "",
    s.domain || "",
    s.member || "",
    s.source_kind || "",
    s.source_id || "",
    s.mode || "extract",
    v.contextIDs ? [...v.contextIDs].sort() : null,
  ]);
}
function safeOperationOrigin(value: string) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x1f]/.test(value)
  )
    return "/context/";
  const url = new URL(value, "https://coflow.invalid");
  const allowed = new Set([
    "project",
    "domain",
    "member",
    "assignee",
    "todo",
    "report",
    "event",
    "context",
    "knowledge_view",
    "explore_topic",
    "explore_node",
    "filters",
    "date",
    "view",
    "mode",
    "source",
    "tab",
    "group",
  ]);
  for (const key of [...url.searchParams.keys()])
    if (!allowed.has(key)) url.searchParams.delete(key);
  return url.pathname + url.search;
}
export class AIOperationStore {
  records: AIOperation[] = [];
  runtimes = new Map<string, Runtime>();
  alive = true;
  client: Client;
  changed: () => void;
  notify: () => void;
  demo: boolean;
  constructor(
    client: Client,
    changed: () => void,
    notify: () => void,
    demo = false,
  ) {
    this.client = client;
    this.changed = changed;
    this.notify = notify;
    this.demo = demo;
  }
  private publish(id: string, patch: Partial<AIOperation>) {
    if (!this.alive) return;
    this.records = this.records.map((v) =>
      v.id === id
        ? { ...v, ...patch, updated_at: new Date().toISOString() }
        : v,
    );
    this.changed();
  }
  start(input: ContextOperationInput) {
    if (!this.alive) return "";
    input = {
      ...input,
      scope: { ...input.scope },
      contextIDs: input.contextIDs ? [...input.contextIDs] : undefined,
    };
    const fingerprint = contextOperationKey(input);
    const running = this.records.find(
      (v) => v.fingerprint === fingerprint && operationActive(v),
    );
    if (running) return running.id;
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    this.records = [
      {
        id,
        fingerprint,
        kind: input.scope.mode === "organize" ? "organize" : "extract",
        status: "running",
        origin: safeOperationOrigin(input.origin),
        started_at: now,
        updated_at: now,
        total: 0,
        completed: 0,
        saved: 0,
        review: 0,
        results: [],
        conversations: [],
        error: "",
        reply: "",
        demo: this.demo,
      },
      ...this.records.filter(operationActive),
      ...this.records.filter((v) => !operationActive(v)).slice(0, 29),
    ];
    const retained = new Set(this.records.map((v) => v.id));
    for (const key of this.runtimes.keys())
      if (!retained.has(key)) this.runtimes.delete(key);
    this.runtimes.set(id, {
      input,
      queue: null,
      index: 0,
      items: new Map(),
      attempts: {},
      stop: false,
      executing: false,
    });
    this.changed();
    void this.execute(id);
    return id;
  }
  stop(id: string) {
    const r = this.runtimes.get(id);
    if (r?.executing) {
      r.stop = true;
      this.publish(id, { status: "stopping" });
    }
  }
  retry(id: string) {
    const r = this.runtimes.get(id),
      v = this.records.find((x) => x.id === id);
    if (
      !this.alive ||
      !r ||
      r.executing ||
      !v ||
      !["failed", "stopped"].includes(v.status)
    )
      return;
    r.stop = false;
    this.publish(id, { status: "running", error: "" });
    void this.execute(id);
  }
  dispose() {
    this.alive = false;
    for (const r of this.runtimes.values()) r.stop = true;
    this.runtimes.clear();
  }
  private async execute(id: string) {
    const r = this.runtimes.get(id);
    if (!r || r.executing || !this.alive) return;
    r.executing = true;
    const { scope, contextIDs, configID, locale } = r.input;
    try {
      if (!r.queue) {
        let queue = [scope];
        if (contextIDs)
          queue = contextIDs.map((source_id) => ({
            ...scope,
            source_kind: "context",
            source_id,
          }));
        else if (!scope.source_id) {
          const params = new URLSearchParams({
            project: scope.project || "",
            domain: scope.domain || "",
            member: scope.member || "",
          });
          const tree = await this.client<{ items: ContextNode[] }>(
            "/context-tree?" + params,
          );
          const nodes = tree.items.filter((n) => n.state !== "archived");
          if (nodes.length)
            queue = nodes.map((n) => ({
              ...scope,
              source_kind: "context",
              source_id: n.id,
            }));
        }
        r.queue = queue;
        this.publish(id, { total: queue.length });
      }
      while (this.alive && !r.stop && r.index < r.queue.length) {
        const result = await this.client<{
          items: ContextEntry[];
          errors: string[];
          reply: string;
          conversation_id?: string;
        }>("/assistant/context-auto", {
          method: "POST",
          body: JSON.stringify({
            ...r.queue[r.index],
            config_id: configID,
            request_id: `${id}-${r.index}-${r.attempts[r.index] || 0}`,
            locale,
          }),
        });
        if (!this.alive) return;
        for (const item of result.items) {
          r.items.set(item.id, item);
          r.input.onSaved?.(item);
        }
        const v = this.records.find((x) => x.id === id)!;
        this.publish(id, {
          saved: r.items.size,
          review: [...r.items.values()].filter(
            (x) => x.needs_review || x.state === "pending",
          ).length,
          results: [...r.items.keys()],
          conversations: result.conversation_id
            ? [...new Set([...v.conversations, result.conversation_id])]
            : v.conversations,
          reply: result.reply.slice(0, 2000),
        });
        this.notify();
        if (result.errors.length) {
          r.attempts[r.index] = (r.attempts[r.index] || 0) + 1;
          throw Error(result.errors.join(" · "));
        }
        r.index++;
        this.publish(id, { completed: r.index });
      }
      this.publish(id, { status: r.stop ? "stopped" : "completed" });
    } catch (e) {
      this.publish(id, {
        status: "failed",
        error: e instanceof Error ? e.message : "AI 操作失败",
      });
    } finally {
      r.executing = false;
      if (this.records.find((v) => v.id === id)?.status === "completed")
        this.runtimes.delete(id);
    }
  }
  // Persist only scoped identifiers/counts; never bodies, replies, errors, keys or executable callbacks.
  snapshot() {
    return this.records.map(({ error, reply, ...v }) => v);
  }
  restore(value: unknown) {
    if (!Array.isArray(value)) return;
    const states = [
      "running",
      "stopping",
      "completed",
      "failed",
      "stopped",
      "unconfirmed",
    ];
    this.records = value.slice(0, 30).flatMap((v) => {
      if (
        !v ||
        typeof v.id !== "string" ||
        !/^[\w-]{1,100}$/.test(v.id) ||
        !states.includes(v.status) ||
        !["extract", "organize"].includes(v.kind) ||
        typeof v.fingerprint !== "string" ||
        v.fingerprint.length > 200000 ||
        typeof v.origin !== "string" ||
        safeOperationOrigin(v.origin) !== v.origin ||
        v.origin.length > 3000 ||
        !Number.isFinite(Date.parse(v.started_at)) ||
        !Number.isFinite(Date.parse(v.updated_at))
      )
        return [];
      const ids = (xs: unknown) =>
        Array.isArray(xs)
          ? xs
              .filter(
                (x): x is string =>
                  typeof x === "string" && /^[\w-]{1,160}$/.test(x),
              )
              .slice(0, 1000)
          : [];
      const count = (x: unknown) =>
        typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 5000
          ? x
          : 0;
      return [
        {
          id: v.id,
          fingerprint: v.fingerprint,
          kind: v.kind,
          status: ["running", "stopping"].includes(v.status)
            ? "unconfirmed"
            : v.status,
          origin: v.origin,
          started_at: v.started_at,
          updated_at: v.updated_at,
          total: count(v.total),
          completed: count(v.completed),
          saved: count(v.saved),
          review: count(v.review),
          results: ids(v.results),
          conversations: ids(v.conversations),
          error: "",
          reply: "",
          demo: !!v.demo,
        } as AIOperation,
      ];
    });
    this.changed();
  }
}
