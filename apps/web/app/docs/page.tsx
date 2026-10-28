import { readFile } from "node:fs/promises";
import path from "node:path";
import { CollaborationDocs } from "@/components/collaboration-docs";

export const dynamic = "force-static";

export default async function DocsPage() {
  const markdown = await readFile(
    path.join(process.cwd(), "../../docs/COLLABORATION_GUIDE.md"),
    "utf8",
  );
  const files = [
    "SKILL.md",
    "references/installation.md",
    "references/reporting.md",
    "references/todos.md",
  ];
  const skillFiles = await Promise.all(
    files.map(async (name) => ({
      name,
      content: await readFile(
        path.join(process.cwd(), "../../skills/coflow", name),
        "utf8",
      ),
    })),
  );
  return <CollaborationDocs markdown={markdown} skillFiles={skillFiles} />;
}
