import commands from "../../cli/commands.json";

type BrowserCommand = { browser?: boolean; method?: string; path?: string; flags: string[] };
const registry: Record<string, BrowserCommand> = commands;

// Limit pasted requests to operations explicitly marked for browser confirmation.
export function browserOperation(commandName: string, method: string, path: string) {
  if (!Object.hasOwn(registry, commandName)) return null;
  const command = registry[commandName];
  if (!command.path || !command.browser || command.method !== method || typeof path !== "string" || /[#\\]/.test(path)) return null;
  const [pathname, query, ...extra] = path.split("?");
  if (extra.length) return null;
  const allowed = new Set(command.flags.map((flag) => flag.slice(2).replaceAll("-", "_")));
  const used = new Set();
  for (const key of new URLSearchParams(query).keys()) {
    if (method !== "GET" || !allowed.has(key) || used.has(key)) return null;
    used.add(key);
  }
  const pattern = command.path.split("/");
  const parts = pathname.split("/");
  if (pattern.length !== parts.length) return null;
  for (const [index, segment] of pattern.entries()) {
    if (!segment.startsWith("{")) {
      if (segment !== parts[index]) return null;
      continue;
    }
    try {
      const id = decodeURIComponent(parts[index]);
      if (!id || id === "." || id === ".." || /[/\\%?#\x00-\x1f]/.test(id)) return null;
    } catch {
      return null;
    }
  }
  return command;
}
