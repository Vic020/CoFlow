#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { validateBuildPaths } from "../prepare-image-release.mjs";
import {
  stages,
  selectStages,
  privatePath,
  writePrivate,
  acquireLock,
  command,
  validateConfig,
  assertRun,
  workflow,
  Waiting,
  sourceVersion,
  requireHookProof,
  parseJSON,
} from "./core.mjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const args = process.argv.slice(2),
  flags = new Set(),
  values = {};
const help = `CoFlow release runner (plan-only by default)
  npm run release -- --checks --push --release --images --pages --server --report
  Add --execute only after authorizing those actions. No version changes or commits.
  --ci             wait for exact-source main push CI
  --status         read local checkpoint only
  --config PATH    private config under .local/release (default: config.json)
  --source SHA     resume a pinned commit; defaults to HEAD
  --wait-seconds N wait budget (default 45); exit 2 means waiting, resume same command
  --help           show this help
Never pass a token, hostname or private connection settings as CLI arguments.`;
let unlock;
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--config", "--source", "--wait-seconds"].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw Error("Missing option value.");
      values[arg] = args[++i];
    } else if (
      [
        "--execute",
        "--status",
        "--help",
        ...stages.map((s) => "--" + s),
      ].includes(arg)
    )
      flags.add(arg);
    else throw Error("Unknown release option. Use --help.");
  }
  if (flags.has("--help")) {
    console.log(help);
    process.exit(0);
  }
  const selected = selectStages(flags);
  const git = (...a) => command("git", a, { cwd: root }).trim();
  const source = values["--source"] ?? "HEAD";
  if (source !== "HEAD" && !/^[a-f0-9]{40}$/.test(source))
    throw Error("Source must be a complete commit SHA.");
  const sha = git("rev-parse", "--verify", source + "^{commit}");
  const version = sourceVersion(git("show", sha + ":VERSION"));
  const tag = "v" + version;
  const configPath = privatePath(
    root,
    values["--config"] ?? ".local/release/config.json",
  );
  const configText = readFileSync(configPath, "utf8");
  const config = validateConfig(root, parseJSON(configText));
  const directory = path.join(
    root,
    ".local/release/runs",
    tag + "-" + sha.slice(0, 12),
  );
  const stateFile = path.join(directory, "state.json");
  privatePath(root, stateFile, { missing: true });
  const fingerprint = createHash("sha256").update(configText).digest("hex");
  const state = existsSync(stateFile)
    ? parseJSON(readFileSync(stateFile, "utf8"))
    : {
        schema_version: 1,
        sha,
        version,
        repository: config.repository,
        config_hash: fingerprint,
        completed: {},
        workflows: {},
      };
  if (
    state.schema_version !== 1 ||
    state.sha !== sha ||
    state.config_hash !== fingerprint
  )
    throw Error(
      "Checkpoint identity/configuration changed; reconcile locally before proceeding.",
    );
  if (flags.has("--status")) {
    console.log(
      JSON.stringify(
        {
          version,
          sha,
          completed: Object.keys(state.completed),
          workflows: state.workflows,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  console.log(
    `${tag} ${sha.slice(0, 12)}: ${selected.join(" → ") || "no stages selected"}`,
  );
  if (!flags.has("--execute")) {
    console.log(
      "PLAN ONLY. No writes, network requests, release, deployment or report.",
    );
    process.exit(0);
  }
  if (!selected.length) throw Error("Choose explicit stages.");
  const origin = git("remote", "get-url", "origin");
  const repository = origin.match(
    /^(?:git@github\.com:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
  )?.[1];
  if (repository?.toLowerCase() !== config.repository.toLowerCase())
    throw Error("Git origin and configured GitHub repository differ.");
  if (git("status", "--porcelain"))
    throw Error(
      "Commit reviewed public changes first; the runner never stages or commits files.",
    );
  if (selected.some((s) => ["release", "images", "pages", "server", "report"].includes(s))) {
    const existing = git("ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`);
    if (existing && !existing.split("\n").some((line) => line.split(/\s/)[0] === sha)) {
      throw Error("Version already labels another source. Choose the next version explicitly before publication.");
    }
  }
  const paths = git("ls-tree", "-rz", "--name-only", sha)
    .split("\0")
    .filter(Boolean);
  validateBuildPaths(paths);
  const publicText = command(
    "git",
    [
      "grep",
      "-I",
      "-h",
      "-e",
      "cf_",
      "-e",
      "github_pat_",
      "-e",
      "PRIVATE KEY",
      sha,
      "--",
    ],
    { cwd: root, allowNoMatch: true },
  );
  if (
    /cf_[A-Za-z0-9_-]{25,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/.test(
      publicText,
    )
  )
    throw Error(
      "Possible credential in public source; inspect before publication.",
    );
  const save = () => writePrivate(root, stateFile, state);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  unlock = acquireLock(root, path.join(directory, "runner.lock"));
  save();
  const gh = async (a, json = true) => {
    const v = command("gh", a, { cwd: root });
    return json ? parseJSON(v) : v;
  };
  const remoteSHA = () =>
    git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0];
  async function releaseExists() {
    const r = await gh([
      "api",
      `repos/${config.repository}/releases/tags/${tag}`,
    ]);
    if (r.draft || r.prerelease || r.tag_name !== tag)
      throw Error("A published stable Release is required.");
    const ref = git(
      "ls-remote",
      "origin",
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    );
    if (!ref.split("\n").some((x) => x.split(/\s/)[0] === sha))
      throw Error("Remote tag does not resolve to the pinned source.");
    return r;
  }
  async function verifyImages(run) {
    const repo = config.repository.toLowerCase(),
      refs = {};
    async function fetchChecked(url, headers = {}) {
      const r = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error("Anonymous registry verification failed.");
      return r;
    }
    for (const service of ["api", "web"]) {
      const image = `${repo}-${service}`,
        imageTag = `${version}-${sha.slice(0, 12)}-${run.id}.${run.run_attempt}`;
      const token = await (
        await fetchChecked(
          `https://ghcr.io/token?service=ghcr.io&scope=repository:${image}:pull`,
        )
      ).json();
      const r = await fetchChecked(
        `https://ghcr.io/v2/${image}/manifests/${imageTag}`,
        {
          Authorization: `Bearer ${token.token}`,
          Accept:
            "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
        },
      );
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > 1048576)
        throw Error("Registry manifest is too large.");
      const digest =
        "sha256:" + createHash("sha256").update(bytes).digest("hex");
      const manifest = JSON.parse(bytes);
      if (
        r.headers.get("docker-content-digest") !== digest ||
        !manifest.manifests?.some(
          (x) =>
            x.platform?.architecture === "amd64" && x.platform.os === "linux",
        )
      )
        throw Error("Image digest/platform mismatch.");
      refs[service] = `ghcr.io/${image}@${digest}`;
    }
    return refs;
  }
  const deadline = Date.now() + Number(values["--wait-seconds"] ?? 45) * 1000;
  if (
    !Number.isFinite(deadline) ||
    deadline < Date.now() ||
    deadline > Date.now() + 3601000
  )
    throw Error("Wait budget must be between 1 and 3600 seconds.");
  for (const stage of selected) {
    if (state.completed[stage] && !["ci", "push"].includes(stage)) {
      console.log(`${stage}: previously verified`);
      continue;
    }
    let result;
    do {
      try {
        if (stage === "checks") {
          if (git("rev-parse", "HEAD") !== sha)
            throw Error(
              "Local checks require HEAD; pinned older sources use their exact CI.",
            );
          for (const name of ["version:check", "docs:check", "typecheck"])
            command("npm", ["run", name], { cwd: root, timeout: 180000 });
          command(
            process.execPath,
            [
              "--test",
              ...paths.filter((p) => /^scripts\/[^/]+\.test\.mjs$/.test(p)),
            ],
            { cwd: root, timeout: 180000 },
          );
          result = { verified: true };
        } else if (stage === "push") {
          git("push", "origin", sha + ":refs/heads/main");
          result = { verified: remoteSHA() === sha };
          if (!result.verified) throw Error("Remote main differs.");
        } else if (stage === "ci") {
          const data = await gh([
            "api",
            `repos/${config.repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
          ]);
          const run = data.workflow_runs.find(
            (r) =>
              r.head_sha === sha &&
              r.head_branch === "main" &&
              r.event === "push",
          );
          if (!run)
            throw new Waiting("ci: waiting for the exact main push run.");
          assertRun(run, sha, { event: "push", workflow: "ci.yml" });
          if (run.status !== "completed")
            throw new Waiting(`ci: run ${run.id} ${run.status}`);
          result = run;
        } else if (stage === "release") {
          // Resolve the remote ref first. Existing matching releases are adopted, never recreated.
          const remoteRef = git(
            "ls-remote",
            "origin",
            `refs/tags/${tag}`,
            `refs/tags/${tag}^{}`,
          );
          if (!remoteRef) {
            const localRefs = git("tag", "--list", tag);
            if (localRefs && git("rev-parse", tag + "^{commit}") !== sha)
              throw Error("Local tag conflicts with source.");
            if (!localRefs)
              git("tag", "-a", tag, sha, "-m", `CoFlow ${version}`);
            git("push", "origin", "refs/tags/" + tag);
          } else if (
            !remoteRef.split("\n").some((x) => x.split(/\s/)[0] === sha)
          )
            throw Error("Remote tag conflicts with source.");
          const notes = git("show", `${sha}:docs/releases/${tag}.md`);
          if (!notes) throw Error("Versioned release notes are missing.");
          const listing = await gh([
            "api",
            `repos/${config.repository}/releases?per_page=100`,
          ]);
          if (!listing.some((r) => r.tag_name === tag)) {
            command(
              "gh",
              [
                "release",
                "create",
                tag,
                "--repo",
                config.repository,
                "--verify-tag",
                "--title",
                `CoFlow ${version}`,
                "--notes-file",
                "-",
              ],
              { cwd: root, input: notes },
            );
          }
          result = await releaseExists();
        } else if (["images", "pages"].includes(stage)) {
          await releaseExists();
          if (!state.workflows[stage] && remoteSHA() !== sha)
            throw Error(
              "Dispatch requires remote main to equal the pinned source.",
            );
          result = await workflow({
            name: stage,
            sha,
            repository: config.repository,
            state,
            save,
            gh,
            inputs: stage === "images" ? { tag } : {},
          });
          if (stage === "images") state.images = await verifyImages(result);
          if (stage === "pages") {
            const base = config.pages_url;
            if (
              !base ||
              new URL(base).protocol !== "https:" ||
              new URL(base).hostname !==
                config.repository.split("/")[0].toLowerCase() + ".github.io"
            )
              throw Error("Configure the public github.io Pages URL.");
            const files = [
              ["/agent/coflow/SKILL.md", "skills/coflow/SKILL.md"],
              ["/agent/openapi.yaml", "docs/openapi.yaml"],
              ...[
                "installation.md",
                "reporting.md",
                "todos.md",
                "calendar.md",
              ].map((n) => [
                "/agent/coflow/references/" + n,
                "skills/coflow/references/" + n,
              ]),
            ];
            for (const [url, file] of files) {
              const r = await fetch(
                base.replace(/\/$/, "") + url + "?verify=" + version,
                { redirect: "error", signal: AbortSignal.timeout(20000) },
              );
              if (
                !r.ok ||
                (await r.text()) !==
                  command("git", ["show", sha + ":" + file], { cwd: root })
              )
                throw Error(
                  "Pages canonical download differs from pinned source.",
                );
            }
            const r = await fetch(base.replace(/\/$/, "") + "/api/v1/meta", {
              redirect: "error",
              signal: AbortSignal.timeout(20000),
            });
            if (r.status !== 404)
              throw Error("Public demo must not have a real API backend.");
          }
        } else {
          await releaseExists();
          if (stage === "server" && (!state.images || !state.completed.images))
            throw Error(
              "Verify images first with --images; server selection does not implicitly publish images.",
            );
          if (
            stage === "report" &&
            (config.report_requires ?? []).some((s) => !state.completed[s])
          )
            throw Error("Requested reporting prerequisites are not verified.");
          const hook = config.hooks?.[stage];
          if (!hook) throw Error(`Configure the private ${stage} hook first.`);
          const context = {
            schema_version: 1,
            stage,
            sha,
            version,
            tag,
            repository: config.repository,
            images: state.images,
            completed: state.completed,
            run_directory: directory,
          };
          result = requireHookProof(
            parseJSON(
              command(hook[0], [path.resolve(root, hook[1])], {
                cwd: root,
                input: JSON.stringify(context),
                timeout: 1200000,
              }),
            ),
            context,
          );
        }
        state.completed[stage] = {
          ...result,
          verified_at: new Date().toISOString(),
        };
        save();
        console.log(`${stage}: verified`);
        break;
      } catch (error) {
        if (!(error instanceof Waiting)) throw error;
        console.log(error.message);
        if (Date.now() + 15000 > deadline) throw error;
        await sleep(15000);
      }
    } while (true);
  }
  console.log(
    "Selected stages complete. Checkpoints stay private; no automatic version bump, commit or follow-up deployment.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = error instanceof Waiting ? 2 : 1;
} finally {
  unlock?.();
}
