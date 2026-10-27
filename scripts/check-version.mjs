import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");
const expected = (await text("VERSION")).trim();
const skillVersion = (await text("skills/coflow/SKILL.md")).match(
  /^  version: "(\d+\.\d+\.\d+)"$/m,
)?.[1];
if (!skillVersion)
  throw new Error(
    "CoFlow Skill metadata.version must be a stable semantic version",
  );
if (
  !(await text("apps/web/lib/skill-version.ts")).includes(
    `export const coflowSkillVersion = "${skillVersion}";`,
  )
)
  throw new Error(
    "Skill display version is stale; run node scripts/sync-agent-assets.mjs",
  );
if (!/^\d+\.\d+\.\d+$/.test(expected))
  throw new Error("VERSION must contain a semantic version");
const records = [];
for (const path of [
  "package.json",
  "apps/web/package.json",
  "apps/cli/package.json",
]) {
  records.push([path, JSON.parse(await text(path)).version]);
}
const lock = JSON.parse(await text("package-lock.json"));
records.push(["package-lock.json", lock.version]);
for (const key of ["", "apps/web", "apps/cli"])
  records.push([
    `package-lock.json:${key || "root"}`,
    lock.packages[key].version,
  ]);
records.push([
  "Go API",
  (await text("apps/api/internal/version/version.go")).match(
    /const Current = "([^"]+)"/,
  )?.[1],
]);
records.push([
  "OpenAPI",
  (await text("docs/openapi.yaml")).match(/^  version: (.+)$/m)?.[1]?.trim(),
]);
for (const [path, value] of records)
  if (value !== expected)
    throw new Error(`${path}: expected ${expected}, found ${value}`);
if (!(await text("CHANGELOG.md")).includes(`## [${expected}]`))
  throw new Error(`Missing CHANGELOG entry for ${expected}`);
for (const [path, label] of [
  ["README.md", "Current version: "],
  ["README.zh-CN.md", "当前版本："],
]) {
  const readme = await text(path);
  if (!readme.includes(`**v${skillVersion}**`))
    throw new Error(`${path} Skill version display must match ${skillVersion}`);
  if (
    !readme.includes(`version-${expected}-`) ||
    !readme.includes(`${label}${expected}`)
  ) {
    throw new Error(`${path} version display must match ${expected}`);
  }
}

console.log(
  `Version records consistent: app ${expected}, Skill ${skillVersion}. No version changes made.`,
);
