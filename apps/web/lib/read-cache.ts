// Browser-session memory only. The caller must verify identity before enabling it.
export class ReadCache {
  private scope: string | null = null;
  private generation = 0;
  private identity = 0;
  private entries = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private now: () => number;
  private ttl: number;
  private limit: number;

  constructor(now = Date.now, ttl = 10000, limit = 100) {
    this.now = now;
    this.ttl = ttl;
    this.limit = limit;
  }
  setScope(scope: string | null) {
    if (scope === this.scope) return;
    this.scope = scope;
    this.identity++;
    this.invalidate();
  }
  invalidate() {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }
  async read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const identity = this.identity;
    if (!this.scope) {
      const value = await load();
      if (identity !== this.identity) throw new Error("请求身份已变化，请重试");
      return value;
    }
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now())
      return structuredClone(cached.value) as T;
    this.entries.delete(key);
    const existing = this.pending.get(key);
    if (existing) return structuredClone(await existing) as T;
    const generation = this.generation;
    const pending = load().then((value) => {
      if (this.identity !== identity) throw new Error("请求身份已变化，请重试");
      if (this.generation === generation) {
        if (this.entries.size >= this.limit)
          this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, {
          value: structuredClone(value),
          expires: this.now() + this.ttl,
        });
      }
      return value;
    });
    this.pending.set(key, pending);
    try {
      return structuredClone(await pending);
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }
}

// Only shared list/context reads are cached. Details, auth and credentials stay fresh.
export function cacheableRead(path: string, init?: RequestInit) {
  if (init?.method && init.method.toUpperCase() !== "GET") return false;
  if (
    init?.headers ||
    init?.signal ||
    init?.body ||
    init?.credentials ||
    (init?.cache && init.cache !== "default")
  )
    return false;
  return [
    "/meta",
    "/reports",
    "/todo-board",
    "/todos",
    "/todo-completions",
    "/reads",
    "/collaborations",
  ].includes(path.split("?")[0]);
}

export function readKey(path: string) {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.sort();
  return query ? `${base}?${params}` : base;
}
