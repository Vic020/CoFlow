import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  selectStages,
  privatePath,
  writePrivate,
  acquireLock,
  validateConfig,
  assertRun,
  workflow,
  Waiting,
  parseJSON,
  requireHookProof,
} from "./release/core.mjs";
const sha = "a".repeat(40);
const complete = {
  id: 12,
  head_sha: sha,
  head_branch: "main",
  event: "workflow_dispatch",
  path: ".github/workflows/images.yml",
  created_at: "2026-11-07T01:00:01Z",
  status: "completed",
  conclusion: "success",
};
function fixture(t) {
  const root = mkdtempSync("/private/tmp/coflow-release-test-");
  mkdirSync(path.join(root, ".local/release"), {
    recursive: true,
    mode: 0o700,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test("stages authorize no implicit write, deployment or double reporting", () => {
  assert.deepEqual(selectStages(new Set()), []);
  assert.deepEqual(selectStages(new Set(["--release"])), ["ci", "release"]);
  assert.deepEqual(selectStages(new Set(["--server"])), ["ci", "server"]);
  assert.deepEqual(selectStages(new Set(["--pages"])), ["ci", "pages"]);
  assert.deepEqual(selectStages(new Set(["--report"])), ["ci", "report"]);
});
test("private state is atomic, permission restricted, locked and refuses symlinks", (t) => {
  const root = fixture(t),
    file = path.join(root, ".local/release/state.json");
  writePrivate(root, file, { sha });
  assert.deepEqual(JSON.parse(readFileSync(file)), { sha });
  const unlock = acquireLock(
    root,
    path.join(root, ".local/release/runner.lock"),
  );
  assert.throws(() =>
    acquireLock(root, path.join(root, ".local/release/runner.lock")),
  );
  unlock();
  assert.throws(
    () => privatePath(root, "public/state.json", { missing: true }),
    /stay under/,
  );
  chmodSync(file, 0o644);
  assert.throws(() => privatePath(root, file), /mode 600/);
  chmodSync(file, 0o600);
  const link = path.join(root, ".local/release/link");
  symlinkSync(file, link);
  assert.throws(() => privatePath(root, link), /symlink/);
  symlinkSync(file, file + ".tmp");
  assert.throws(() => writePrivate(root, file, { sha: "other" }), /symlink/);
  assert.deepEqual(JSON.parse(readFileSync(file)), { sha });
});
test("configuration never accepts a public hook or a shell command string", (t) => {
  const root = fixture(t),
    hook = path.join(root, ".local/release/hook.py");
  writeFileSync(hook, "pass", { mode: 0o600 });
  const cfg = {
    schema_version: 1,
    repository: "example/project",
    branch: "main",
    hooks: { server: ["python3", hook] },
    report_requires: ["server", "pages"],
  };
  assert.equal(validateConfig(root, cfg), cfg);
  assert.throws(() =>
    validateConfig(root, {
      ...cfg,
      hooks: { server: ["sh", "-c do-something"] },
    }),
  );
  assert.throws(() =>
    validateConfig(root, {
      ...cfg,
      hooks: { server: ["python3", "scripts/unsafe.py"] },
    }),
  );
});
test("an uncertain dispatch is discovered on resume and never sent twice", async () => {
  const state = { workflows: {} },
    saves = [];
  let calls = 0,
    dispatched = false;
  const gh = async (args) => {
    if (args[0] === "workflow") {
      calls++;
      dispatched = true;
      throw Error("uncertain network failure");
    }
    if (args[1].includes("/runs?"))
      return { workflow_runs: dispatched ? [complete] : [] };
    return complete;
  };
  const input = {
    name: "images",
    sha,
    repository: "example/project",
    state,
    save: () => saves.push(structuredClone(state)),
    gh,
    now: () => "2026-11-07T01:00:00Z",
  };
  await assert.rejects(workflow(input), Waiting);
  assert.equal(saves[0].workflows.images.after_id, 0);
  const result = await workflow(input);
  assert.equal(result.id, 12);
  assert.equal(calls, 1);
  assert.equal(state.workflows.images.id, 12);
});
test("missing or ambiguous run cannot silently redispatch/adopt another run", async () => {
  const state = {
    workflows: {
      images: { after_id: 10, requested_at: "2026-11-07T01:00:00Z" },
    },
  };
  let dispatches = 0;
  const input = {
    name: "images",
    sha,
    repository: "example/project",
    state,
    save: () => {},
    gh: async (args) => {
      if (args[0] === "workflow") dispatches++;
      return { workflow_runs: [] };
    },
  };
  await assert.rejects(workflow(input), Waiting);
  assert.equal(dispatches, 0);
  input.gh = async () => ({
    workflow_runs: [complete, { ...complete, id: 13 }],
  });
  await assert.rejects(workflow(input), /multiple matching/);
});
test("only exact-source successful workflow and matching hook receipts count as completion", () => {
  assertRun(complete, sha, { workflow: "images.yml" });
  for (const override of [
    { head_sha: "b".repeat(40) },
    { head_branch: "other" },
    { event: "push" },
    { path: ".github/workflows/pages.yml" },
    { conclusion: "failure" },
  ])
    assert.throws(() =>
      assertRun({ ...complete, ...override }, sha, { workflow: "images.yml" }),
    );
  assert.throws(() =>
    requireHookProof(
      { verified: true, sha: "wrong", version: "0.4.1" },
      { sha, version: "0.4.1" },
    ),
  );
  assert.throws(
    () => parseJSON("synthetic-secret-output"),
    (e) => !e.message.includes("synthetic-secret-output"),
  );
});
test("help and invalid flags cannot invoke a release", () => {
  const help = execFileSync(
    process.execPath,
    ["scripts/release/run.mjs", "--help"],
    { encoding: "utf8" },
  );
  assert.match(help, /plan-only/);
  assert.match(help, /--execute/);
  assert.throws(() =>
    execFileSync(process.execPath, ["scripts/release/run.mjs", "--all"], {
      stdio: "pipe",
    }),
  );
});

test("full pipeline and resume use only simulated GitHub/registry/hooks; plan performs no external commands", (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, "scripts/release"), { recursive: true });
  for (const file of [
    "release/core.mjs",
    "release/run.mjs",
    "prepare-image-release.mjs",
  ])
    writeFileSync(
      path.join(root, "scripts", file),
      readFileSync(new URL("./" + file, import.meta.url)),
    );
  for (const [file, text] of Object.entries({
    VERSION: "0.4.1\n",
    ".gitignore": ".local/\n",
    "docs/releases/v0.4.1.md": "# Synthetic release\n",
    "docs/openapi.yaml": "openapi: 3.1.0\n",
    "skills/coflow/SKILL.md": "# Synthetic skill\n",
    ...Object.fromEntries(
      ["installation.md", "reporting.md", "todos.md", "calendar.md"].map(
        (n) => ["skills/coflow/references/" + n, "# " + n + "\n"],
      ),
    ),
  })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const git = (...args) =>
    execFileSync(realGit, args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("remote", "add", "origin", "https://github.com/example/project.git");
  git("add", ".");
  git(
    "-c",
    "user.name=Synthetic QA",
    "-c",
    "user.email=qa@example.test",
    "commit",
    "-m",
    "Synthetic source",
  );
  const pinned = git("rev-parse", "HEAD");
  const bin = path.join(root, ".local/release/bin");
  mkdirSync(bin, { mode: 0o700 });
  const cloud = path.join(root, ".local/release/cloud.json");
  writeFileSync(
    cloud,
    JSON.stringify({ calls: [], tag: false, release: false, runs: {} }),
    { mode: 0o600 },
  );
  const shim = `#!/usr/bin/env node
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2),name=process.argv[1].split('/').at(-1),file=process.env.QA_CLOUD,sha=process.env.QA_SHA;let c=JSON.parse(fs.readFileSync(file));c.calls.push([name,...args]);const save=()=>fs.writeFileSync(file,JSON.stringify(c));save();
const run=n=>({id:n==='ci'?1:n==='images'?2:3,head_sha:sha,head_branch:'main',event:n==='ci'?'push':'workflow_dispatch',path:'.github/workflows/'+n+'.yml',created_at:new Date().toISOString(),status:'completed',conclusion:'success',run_attempt:1,html_url:'https://github.com/example/project/actions/runs/1'});
if(name==='git'){
 if(args[0]==='push'){if(args.at(-1).includes('tags')){c.tag=true;save();}}
 else if(args[0]==='ls-remote'){if(args.includes('refs/heads/main')||c.tag)console.log(sha+'\\t'+args.at(-1));}
 else process.stdout.write(execFileSync(process.env.QA_GIT,args,{encoding:'utf8'}));
}else if(args[0]==='workflow'){const n=args[2].replace('.yml','');c.runs[n]=run(n);save();}
else if(args[0]==='release'){if(args[1]!=='create')throw Error('unexpected release operation');c.release=true;save();}
else if(args[0]==='api'){
 const u=args[1];let result;
 if(u.includes('/ci.yml/runs'))result={workflow_runs:[run('ci')]};
 else if(u.includes('/workflows/')){const n=u.includes('images.yml')?'images':'pages';result={workflow_runs:c.runs[n]?[c.runs[n]]:[]};}
 else if(/\\/actions\\/runs\\//.test(u))result=Object.values(c.runs).find(r=>u.endsWith('/'+r.id));
 else if(u.includes('/releases/tags/')){if(!c.release)throw Error('release missing');result={tag_name:'v0.4.1',draft:false,prerelease:false};}
 else if(u.endsWith('/releases?per_page=100'))result=c.release?[{tag_name:'v0.4.1'}]:[];
 else throw Error('unexpected API request');
 console.log(JSON.stringify(result));
}else throw Error('unexpected command');`;
  for (const name of ["git", "gh"])
    writeFileSync(path.join(bin, name), shim, { mode: 0o700 });
  const loader = path.join(root, ".local/release/network.mjs");
  writeFileSync(
    loader,
    `import {createHash} from 'node:crypto';import fs from 'node:fs';
 globalThis.fetch=async url=>{const u=new URL(url);if(u.hostname==='ghcr.io'){
 if(u.pathname==='/token')return Response.json({token:'synthetic-only'});
 const b=JSON.stringify({manifests:[{platform:{architecture:'amd64',os:'linux'}}]});return new Response(b,{headers:{'docker-content-digest':'sha256:'+createHash('sha256').update(b).digest('hex')}});
 }if(u.hostname==='example.github.io'){
 if(u.pathname.endsWith('/api/v1/meta'))return new Response('',{status:404});
 const relative=u.pathname.replace('/project/agent/coflow/','skills/coflow/').replace('/project/agent/openapi.yaml','docs/openapi.yaml');return new Response(fs.readFileSync(relative));
 }throw Error('Network access forbidden in synthetic release test');};`,
    { mode: 0o600 },
  );
  const hook = path.join(root, ".local/release/hook.mjs");
  writeFileSync(
    hook,
    `let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);if(!v.completed.ci)throw Error('missing CI');if(v.stage==='server'&&!v.images?.api)throw Error('missing image');console.log(JSON.stringify({verified:true,sha:v.sha,version:v.version}));`,
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(root, ".local/release/config.json"),
    JSON.stringify({
      schema_version: 1,
      repository: "example/project",
      branch: "main",
      pages_url: "https://example.github.io/project",
      hooks: { server: ["node", hook], report: ["node", hook] },
      report_requires: ["server", "pages"],
    }),
    { mode: 0o600 },
  );
  const env = {
    ...process.env,
    PATH: bin + ":" + process.env.PATH,
    QA_GIT: realGit,
    QA_CLOUD: cloud,
    QA_SHA: pinned,
  };
  const invoke = (flags) =>
    execFileSync(
      process.execPath,
      ["--import", loader, "scripts/release/run.mjs", ...flags],
      { cwd: root, env, encoding: "utf8" },
    );
  assert.match(
    invoke(["--release", "--images", "--pages", "--server", "--report"]),
    /PLAN ONLY/,
  );
  assert.equal(
    JSON.parse(readFileSync(cloud)).calls.some((c) => c[0] === "gh"),
    false,
  );
  const flags = [
    "--push",
    "--release",
    "--images",
    "--pages",
    "--server",
    "--report",
    "--execute",
  ];
  assert.match(invoke(flags), /Selected stages complete/);
  const stateFile = path.join(
    root,
    ".local/release/runs/v0.4.1-" + pinned.slice(0, 12) + "/state.json",
  );
  const s = JSON.parse(readFileSync(stateFile));
  assert.equal(s.completed.report.verified, true);
  assert.equal(Object.keys(s.images).length, 2);
  assert.match(invoke(flags), /server: previously verified/);
  const calls = JSON.parse(readFileSync(cloud)).calls;
  assert.equal(
    calls.filter((c) => c[0] === "gh" && c[1] === "workflow").length,
    2,
  );
  assert.equal(
    calls.filter((c) => c[0] === "gh" && c[1] === "release").length,
    1,
  );
  assert.equal(
    existsSync(
      path.join(
        root,
        ".local/release/runs/v0.4.1-" + pinned.slice(0, 12) + "/runner.lock",
      ),
    ),
    false,
  );
});
