import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Read-only and offline: a successful check says nothing about remote Wiki content.
export async function checkDocs(root) {
  const errors = [];
  const exists = async (file) => {
    try { return (await stat(file)).isFile(); } catch { return false; }
  };
  const inside = (file) => {
    const relative = path.relative(root, file);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const markdown = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) markdown.push(file);
    }
  }
  await walk(path.join(root, "docs"));
  for (const entry of await readdir(root)) {
    if (entry.endsWith(".md") && await exists(path.join(root, entry))) markdown.push(path.join(root, entry));
  }
  for (const file of markdown) {
    // Inline destinations only; code examples and external URLs are not link targets.
    const text = (await readFile(file, "utf8")).replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
    const destinations = [
      ...Array.from(text.matchAll(/\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g), (match) => match[1].replace(/^<|>$/g, "")),
      ...Array.from(text.matchAll(/<(?:a|img)\b[^>]*?\b(?:href|src)=["']([^"']+)["'][^>]*>/gi), (match) => match[1]),
    ];
    for (const target of destinations) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      let decoded;
      try { decoded = decodeURIComponent(target.split(/[?#]/)[0]); }
      catch { errors.push(`${path.relative(root, file)}: invalid link encoding: ${target}`); continue; }
      if (!decoded) continue;
      const resolved = path.resolve(path.dirname(file), decoded);
      if (!inside(resolved) || !await exists(resolved)) errors.push(`${path.relative(root, file)}: missing local link: ${target}`);
    }
  }
  for (const dir of ["", "docs"]) {
    for (const [file, other] of [["README.md", "README.zh-CN.md"], ["README.zh-CN.md", "README.md"]]) {
      const relative = path.join(dir, file);
      const text = await readFile(path.join(root, relative), "utf8");
      if (!text.includes(`](${other})`) && !new RegExp(`href=["']${other.replaceAll(".", "\\.")}["']`, "i").test(text)) errors.push(`${relative}: missing language-switch link to ${other}`);
    }
  }
  const mapping = JSON.parse(await readFile(path.join(root, "docs/wiki-map.json"), "utf8"));
  if (!Array.isArray(mapping.pages) || !mapping.pages.length) errors.push("wiki-map: pages must be a nonempty array");
  const slugs = new Set();
  for (const page of mapping.pages ?? []) {
    for (const locale of ["en", "zh-CN"]) {
      const slug = page[locale];
      if (typeof slug !== "string" || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(slug)) errors.push(`wiki-map: invalid ${locale} page slug`);
      else if (slugs.has(slug)) errors.push(`wiki-map: duplicate page: ${slug}`);
      else slugs.add(slug);
    }
    if (page["zh-CN"] !== `${page.en}-zh-CN`) errors.push(`wiki-map: translation slug must match ${page.en}-zh-CN`);
    if (!Array.isArray(page.sources) || !page.sources.length) errors.push(`wiki-map: missing sources for ${page.en}`);
    for (const source of page.sources ?? []) {
      if (typeof source !== "string") { errors.push("wiki-map: source must be a repository path"); continue; }
      const file = path.resolve(root, source);
      if (!inside(file) || !await exists(file)) errors.push(`wiki-map: missing source: ${source}`);
    }
  }
  return { errors, files: markdown.length, pages: mapping.pages?.length ?? 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const result = await checkDocs(root);
    if (result.errors.length) {
      console.error(result.errors.join("\n"));
      process.exitCode = 1;
    } else console.log(`Documentation checks passed: ${result.files} Markdown files, ${result.pages} Wiki mappings. Offline only; remote synchronization is not verified.`);
  } catch (error) {
    console.error(`Documentation check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
