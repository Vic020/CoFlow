import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const registryPath = "apps/cli/commands.json";
const referencePath = "skills/coflow/references/cli-commands.md";

const cell = (value) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const code = (value) => `\`${cell(value)}\``;

export async function syncCLIReference(root, { check = false } = {}) {
  const registry = JSON.parse(await readFile(path.join(root, registryPath), "utf8"));
  const commands = Object.keys(registry).sort();
  const lines = [
    "# CoFlow CLI command list",
    "",
    "<!-- Generated from apps/cli/commands.json. Run node scripts/sync-cli-reference.mjs. -->",
    "",
    `This table lists all ${commands.length} registered commands. See the [CLI guide](cli.md) for workflows and \`coflow help COMMAND --json\` for flags and examples in your installed version.`,
    "",
    "Commands marked Browser use `--prepare` followed by **Agent credentials → Review CLI request**. Device login and grant instead use a browser pairing code. Scope cells show the scopes declared for the command. Identity, workspace and object permissions still apply.",
    "",
    "| Usage | Purpose | Effect | Declared scopes |",
    "| --- | --- | --- | --- |",
    ...commands.map((name) => {
      const command = registry[name];
      const effect = command.browser ? `${command.effect} · Browser` : command.effect;
      return `| ${code(command.usage)} | ${cell(command.description)} | ${effect} | ${command.scopes.map(code).join(", ") || "—"} |`;
    }),
    "",
    "Built-in entry points: `coflow help [COMMAND]`, `coflow --help`, and `coflow --version` (alias `coflow version`).",
    "",
  ];
  const file = path.join(root, referencePath);
  const content = lines.join("\n");
  if (check) {
    if (content !== await readFile(file, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    })) {
      throw new Error(`${referencePath} is stale. Run node scripts/sync-cli-reference.mjs and include the result.`);
    }
  } else {
    await writeFile(file, content);
  }
  return commands.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const check = process.argv.includes("--check");
  const count = await syncCLIReference(root, { check });
  console.log(`CoFlow CLI reference ${check ? "verified" : "generated"} for ${count} commands.`);
}
