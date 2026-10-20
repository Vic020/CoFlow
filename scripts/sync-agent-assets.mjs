import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Keep published instructions derived from their canonical sources.
const root = new URL("../", import.meta.url);
const assets = [
  [
    "skills/coflow-report/SKILL.md",
    "apps/web/public/agent/coflow-report/SKILL.md",
  ],
  ["docs/openapi.yaml", "apps/web/public/agent/openapi.yaml"],
];
for (const [source, target] of assets) {
  const destination = new URL(target, root);
  await mkdir(new URL("./", destination), { recursive: true });
  await copyFile(new URL(source, root), destination);
  console.log(
    `Published ${fileURLToPath(destination).replace(fileURLToPath(root), "")}`,
  );
}
