#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import metadata from "./package.json" with { type: "json" };
const [command, ...args] = process.argv.slice(2);
const base = (process.env.COFLOW_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
async function main() {
  if (command === "--version" || command === "version") {
    console.log(metadata.version);
    return;
  }
  if (!command || command === "help") {
    console.log(
      "CoFlow CLI\n\n  report --file report.json    Create/update a report using a stable source_id\n  list                         List reports and comments\n  comment --id ID --body TEXT   Reply to a report\n\nEnvironment: COFLOW_URL (default http://127.0.0.1:8080), COFLOW_TOKEN (personal Agent credential in team mode).",
    );
    return;
  }
  let path = "/api/v1/reports",
    method = "GET",
    body;
  if (command === "report") {
    const file = flag("--file");
    if (!file) throw new Error("Missing --file report.json");
    body = JSON.parse(await readFile(file, "utf8"));
    if (!body.source_id)
      throw new Error(
        "source_id is required by CLI to make retries idempotent",
      );
    method = "POST";
  } else if (command === "comment") {
    const id = flag("--id"),
      text = flag("--body");
    if (!id || !text) throw new Error("Expected --id ID --body TEXT");
    path += `/${encodeURIComponent(id)}/comments`;
    method = "POST";
    body = { body: text };
  } else if (command !== "list") throw new Error(`Unknown command: ${command}`);
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(process.env.COFLOW_TOKEN
        ? { Authorization: `Bearer ${process.env.COFLOW_TOKEN}` }
        : {}),
    },
    redirect: "error",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  console.log(JSON.stringify(data, null, 2));
}
main().catch((e) => {
  console.error(`coflow: ${e.message}`);
  process.exitCode = 1;
});
