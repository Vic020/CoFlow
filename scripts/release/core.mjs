import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  lstatSync,
  realpathSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateTag } from "../prepare-image-release.mjs";
export const stages = [
  "checks",
  "push",
  "ci",
  "release",
  "images",
  "pages",
  "server",
  "report",
];
export class Waiting extends Error {}
export function selectStages(flags) {
  const selected = stages.filter((s) => flags.has("--" + s));
  if (
    selected.some((s) =>
      ["release", "images", "pages", "server", "report"].includes(s),
    ) &&
    !selected.includes("ci")
  )
    selected.push("ci");
  return stages.filter((s) => selected.includes(s));
}
export function privatePath(
  root,
  value,
  { directory = false, missing = false } = {},
) {
  const base = path.join(realpathSync(root), ".local", "release");
  const target = path.resolve(root, value);
  if (!target.startsWith(base + path.sep) && target !== base)
    throw Error("Private release files must stay under .local/release.");
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    if (!existsSync(current)) {
      if (missing) continue;
      throw Error("Private release file is missing.");
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw Error("Private release paths must not contain symlinks.");
  }
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (directory ? !stat.isDirectory() : !stat.isFile())
      throw Error("Unexpected private file type.");
    if ((stat.mode & 0o077) !== 0)
      throw Error("Private release files need mode 600; directories need 700.");
  }
  return target;
}
export function writePrivate(root, file, data) {
  privatePath(root, file, { missing: true });
  const parent = path.dirname(file);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  privatePath(root, parent, { directory: true });
  const tmp = file + ".tmp";
  privatePath(root, tmp, { missing: true });
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2) + "\n");
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}
export function acquireLock(root, file) {
  privatePath(root, file, { missing: true });
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = openSync(file, "wx", 0o600);
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  return () => unlinkSync(file);
}
export function command(
  bin,
  args,
  { input, cwd, timeout = 60000, allowNoMatch = false } = {},
) {
  try {
    return execFileSync(bin, args, {
      cwd,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    if (allowNoMatch && error.status === 1) return "";
    throw Error(
      `${path.basename(bin)} failed; check authentication, permissions or the named stage. Command output is suppressed to protect private data.`,
    );
  }
}
export function validateConfig(root, config) {
  if (
    config.schema_version !== 1 ||
    !/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? "")
  )
    throw Error("Invalid private release configuration.");
  if (config.branch !== "main")
    throw Error("Only main release workflows are supported.");
  for (const name of ["server", "report"]) {
    const hook = config.hooks?.[name];
    if (!hook) continue;
    if (
      !Array.isArray(hook) ||
      hook.length !== 2 ||
      !["python3", "node"].includes(hook[0])
    )
      throw Error("Hook must be [python3|node, private-script-path].");
    privatePath(root, hook[1]);
  }
  if (
    config.report_requires &&
    (!Array.isArray(config.report_requires) ||
      config.report_requires.some((x) => !["server", "pages"].includes(x)))
  )
    throw Error("Invalid report prerequisites.");
  return config;
}
export function assertRun(
  run,
  sha,
  { event = "workflow_dispatch", workflow } = {},
) {
  if (
    run.head_sha !== sha ||
    run.head_branch !== "main" ||
    run.event !== event ||
    run.path !== ".github/workflows/" + workflow
  )
    throw Error("Workflow identity does not match the pinned source.");
  if (run.status === "completed" && run.conclusion !== "success")
    throw Error("Workflow failed; inspect Actions before retrying.");
  return run;
}
// Intent is persisted BEFORE dispatch. An uncertain response never causes an automatic redispatch.
export async function workflow({
  name,
  sha,
  repository,
  state,
  save,
  gh,
  now = () => new Date().toISOString(),
  inputs = {},
}) {
  const workflowName = name + ".yml";
  const api = `repos/${repository}/actions/workflows/${workflowName}/runs?event=workflow_dispatch&branch=main&head_sha=${sha}&per_page=100`;
  let record = state.workflows[name];
  if (!record) {
    const list = await gh(["api", api]);
    record = {
      after_id: Math.max(0, ...list.workflow_runs.map((r) => r.id)),
      requested_at: now(),
    };
    state.workflows[name] = record;
    save();
    try {
      await gh(
        [
          "workflow",
          "run",
          workflowName,
          "--repo",
          repository,
          "--ref",
          "main",
          ...Object.entries(inputs).flatMap(([k, v]) => ["-f", `${k}=${v}`]),
        ],
        false,
      );
    } catch {
      throw new Waiting(
        `${name}: dispatch outcome uncertain. Resume to discover the run; it will not be dispatched again.`,
      );
    }
  }
  if (!record.id) {
    const list = await gh(["api", api]);
    const candidates = list.workflow_runs.filter(
      (r) =>
        r.id > record.after_id &&
        r.head_sha === sha &&
        Date.parse(r.created_at) >= Date.parse(record.requested_at) - 5000,
    );
    if (candidates.length > 1)
      throw Error(
        `${name}: multiple matching runs. Reconcile the private checkpoint with Actions before resuming.`,
      );
    if (!candidates.length)
      throw new Waiting(
        `${name}: waiting for the dispatched run. If it never appears, inspect Actions before clearing this intent.`,
      );
    record.id = candidates[0].id;
    save();
  }
  const run = assertRun(
    await gh(["api", `repos/${repository}/actions/runs/${record.id}`]),
    sha,
    { workflow: workflowName },
  );
  if (run.status !== "completed")
    throw new Waiting(`${name}: run ${run.id} ${run.status}`);
  return run;
}
export function sourceVersion(version) {
  validateTag("v" + version);
  return version;
}
export function requireHookProof(result, context) {
  if (
    result?.verified !== true ||
    result.sha !== context.sha ||
    result.version !== context.version
  )
    throw Error(
      "Private hook did not return verified evidence for the pinned source.",
    );
  return result;
}

export function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw Error("Invalid JSON response; raw output withheld.");
  }
}
