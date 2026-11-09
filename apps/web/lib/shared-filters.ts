export type SharedFilters = { project: string; domain: string; member: string };
export const emptySharedFilters: SharedFilters = {
  project: "",
  domain: "",
  member: "",
};
export const sharedFilterKeys = ["project", "domain", "member"] as const;
export function restoreSharedFilters(
  identity: string,
  previous: string | null,
  stored: SharedFilters,
  incoming: SharedFilters | null,
) {
  return !previous || previous === identity ? incoming || stored : stored;
}
export function sharedFilterPage(path: string) {
  return ["/", "/todo", "/calendar", "/assistant", "/context"].includes(
    path.replace(/\/$/, "") || "/",
  );
}
export function readSharedFilters(
  params: URLSearchParams,
): SharedFilters | null {
  if (
    !params.has("filters") &&
    !sharedFilterKeys.some((key) => params.has(key))
  )
    return null;
  return Object.fromEntries(
    sharedFilterKeys.map((key) => [key, (params.get(key) || "").slice(0, 160)]),
  ) as SharedFilters;
}
export function sharedFilterURL(href: string, filters: SharedFilters) {
  const url = new URL(href, "https://coflow.invalid");
  url.searchParams.set("filters", "1"); // Explicitly distinguishes reset from inheriting context.
  for (const key of sharedFilterKeys)
    filters[key]
      ? url.searchParams.set(key, filters[key])
      : url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function storedSharedFilters(raw: string | null): SharedFilters {
  try {
    const data = JSON.parse(raw || "null");
    if (!data || typeof data !== "object") return { ...emptySharedFilters };
    return Object.fromEntries(
      sharedFilterKeys.map((key) => [
        key,
        typeof data[key] === "string" ? data[key].slice(0, 160) : "",
      ]),
    ) as SharedFilters;
  } catch {
    return { ...emptySharedFilters };
  }
}
