import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function validateTag(tag) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag ?? '')) throw new Error('Select an existing stable tag such as v0.1.4.');
  return tag.slice(1);
}
export function validateBuildPaths(paths) {
  const examples = new Set(['.env.example', 'deploy/production.env.example']);
  const previews = new Set(['timeline-desktop.png', 'logo-preview.png', 'public-preview.png']);
  for (const file of paths) {
    if (examples.has(file)) continue;
    const parts = file.split('/');
    if (parts.some(p => ['.local', '.data', 'backups', 'test-results', 'playwright-report'].includes(p.toLowerCase())) ||
        /\.env(?:\.|$)/i.test(file) || /\.(?:dump|har|token|pem|key|p12|sql\.gz|trace\.zip)$/i.test(file) ||
        (file.startsWith('docs/design/') && !previews.has(parts.at(-1)))) throw new Error(`Refusing private/local build input: ${file}`);
  }
}
export function resolveRelease(tag, repository, runId, attempt, git = args => execFileSync('git', args, {encoding:'utf8'})) {
  const version = validateTag(tag);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^\d+$/.test(runId ?? '') || !/^\d+$/.test(attempt ?? '')) throw new Error('Invalid repository or build run identity.');
  const sha = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Tag did not resolve to a commit.');
  git(['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']);
  if (git(['show', `${sha}:VERSION`]).trim() !== version) throw new Error('Tag and VERSION do not match.');
  validateBuildPaths(git(['ls-tree', '-rz', '--name-only', sha]).split('\0').filter(Boolean));
  return {sha, version, registry: `ghcr.io/${repository.toLowerCase()}`, image_tag: `${version}-${sha.slice(0,12)}-${runId}.${attempt}`};
}
export function requireSuccessfulCI(runs, sha) {
  if (!runs.some(run => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push' && run.status === 'completed' && run.conclusion === 'success')) throw new Error('This source commit has no successful main-branch CI run.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.GH_TOKEN) throw new Error('Run manually from main with the read-only workflow token.');
    const release = resolveRelease(process.env.COFLOW_TAG, process.env.GITHUB_REPOSITORY, process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT);
    const url = new URL(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs`);
    url.search = new URLSearchParams({head_sha:release.sha, branch:'main', event:'push', status:'success', per_page:'100'}).toString();
    const response = await fetch(url, {headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`, Accept:'application/vnd.github+json'}, signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Unable to verify CI (HTTP ${response.status}).`);
    const data = await response.json();
    requireSuccessfulCI(data.workflow_runs ?? [], release.sha);
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(release).map(([k,v])=>`${k}=${v}\n`).join(''));
    console.log(`Verified ${process.env.COFLOW_TAG} at ${release.sha}; CI succeeded. No production configuration is used.`);
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
