import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");
const expected = (await text("VERSION")).trim();
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
const readme = await text("README.md");
if (!readme.includes(`version-${expected}-`) || !readme.includes(`当前版本：${expected}`)) {
  throw new Error(`README version display must match ${expected}`);
}

console.log(
  `Version records consistent: ${expected}. No version changes made.`,
);
