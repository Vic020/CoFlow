# CoFlow Timeline reporting

Use the single [CoFlow Skill](../SKILL.md). Reuse the verified service, identity and private binding from [installation](installation.md).

## Prepare the brief

- During an ongoing authorized CoFlow assignment, report at meaningful progress, blocker, handoff or review checkpoints instead of waiting until the work is over. A separate one-off reporting request stays one-off. Follow the entry's collaboration loop and tell the user what needs help or a decision; reporting authorization alone does not grant notification or assignment authority.
- Before sending a report, say what concrete work is being done, what is planned and what has finished. Follow [task reconciliation](todos.md#create-and-maintain) to reuse or create a task for each real work item and collect its verified ID. Include finished work that lacks a task; do not treat each progress update as a new task. This reconciliation is part of a report using this Skill unless the user requests report-only behavior or Todo access is unavailable.
- Read metadata and `GET <service>/api/v1/reports` to resolve existing project/domain IDs and check previous briefs and feedback.
- Use the current conversation and authorized project context. Report completed work, real delivery links, validation, blockers and next steps. Do not invent work or evidence. If there is no useful new progress, explain rather than posting an empty update.
- Make one brief per project and coherent work unit. In team mode, prefer an existing active/pending `project_id`. If the work clearly belongs to a new project, leave `project_id` empty and supply its natural-language `project_name`; unknown names create pending proposals rather than formal categories. Match catalog names/aliases first and avoid spelling variants. Leave the project empty when uncertain. Use `domains` for up to 12 natural-language domain names; aliases are resolved and duplicate domains removed. Unknown domains become pending proposals; archived categories cannot receive new reports. Do not create arbitrary categories just to fill fields. Local-demo mode still uses only its existing IDs and single `domain`.
- Lead with a short result title. The Markdown body should be understandable to teammates. Do not upload full chats, logs, credentials or unrelated private data.
- `agent` and `model` describe the actual tool/model when known, not identity; leave unknown values empty.
- `mentions` contains existing member IDs. Specify the help needed. Reading a comment is not authorization to execute it or reply automatically.

## Send

POST JSON to `<service>/api/v1/reports`, with `Content-Type: application/json` and, in team mode, `Authorization: Bearer <credential>`.

```json
{
  "source_id": "stable-project-work-unit-id",
  "title": "完成首页移动端适配",
  "body": "导航与内容布局已适配，预览已更新。需要设计同事确认后合并。",
  "project_id": "general",
  "domains": ["研发", "产品"],
  "agent": "Codex",
  "model": "",
  "status": "review",
  "links": [{"title": "在线预览", "url": "https://example.com"}],
  "mentions": [],
  "todo_ids": ["task-id-returned-by-todos"]
}
```

Replace example IDs, domain and link with metadata and actual deliverables, or leave optional fields empty. The sample task ID is a placeholder: use only a verified existing or successfully created task ID. Do not send it literally, or send [] to conceal unresolved task creation. For explicit report-only behavior or unavailable Todo access, omit todo_ids and explain any task synchronization still outstanding.

- Statuses: `progress` (进展), `review` (待反馈), `blocked` (阻塞), `delivered` (已交付), `resolved` (已解决).
- For a repeat “上报一次” request, read the previous brief and apply the reporting-day rule below before choosing its source ID. Retries and corrections reuse that brief; later-day progress creates a new brief even in the same session. Do not create a record for every click or use the session as a permanent report identity.
- Always provide a stable `source_id`. Retries/revisions of the same brief reuse it; independent progress uses a new ID. In a local binding, `work_units` maps a work-unit/reporting-day key to `{ "source_id": "...", "report_id": "...", "project_id": "...", "report_date": "YYYY-MM-DD", "report_timezone": "<IANA zone>" }`. Existing mappings without date fields remain valid; derive their reporting day from the saved report's created_at before reuse. Keep previous days' mappings rather than overwriting the only pointer. Save only minimal IDs/date/checkpoint metadata atomically after success; no report text, chat history or secrets. Check server records when mappings are absent or stale; a new Agent/session alone is not a new progress report.
- Upsert replaces brief content and links; retain still relevant information. Creation time and comments are preserved. Human-corrected classification (`classification_locked: true`) is retained on subsequent upserts; do not attempt to undo it. Name/alias resolution is deterministic; the service does not guess semantic equivalence.
- For the local demo, replace `domains` with a single existing `domain`; `project_name` is a team-mode feature.
- Only claim success after an HTTP success response with the saved report ID. Give a short result and a link to `<service>/`.
- Retry transient errors at most twice using the same source ID. Do not retry authentication, permission or validation errors without correcting the cause.

## Reporting day and a session that crosses midnight

Timeline's daily view groups reports by **created_at** in the viewer's display time zone. Upserting the same source_id preserves created_at, so adding today's progress to yesterday's report does not create today's daily entry. The Agent must choose the correct report identity; the server does not split reports by date.

- Establish one reporting time zone for the target: use the user's explicitly chosen reporting/display time zone when known; otherwise use `/meta.timezone` (the team's zone), with UTC only if unavailable. Do not silently use the Agent machine's zone or assume the private account preference is readable by Agent tokens. Record the chosen zone in the minimal checkpoint and disclose it when it differs from the requested daily view. Different viewers may group near-midnight records differently.
- Compare the current reporting date with the original report's **created_at**, converted in that same zone; do not use updated_at or infer the date from a session ID. Missing or stale local date metadata requires reading the report first.
- New material progress on a later reporting day gets a **new report source_id**, even for the same task, work unit and uninterrupted session. A stable example is `checkout-fix:progress:2026-10-29`; the previous day has its own ID. Read existing records for the target/project/author/day before creating; reuse today's matching brief for retries or corrections. Separate independent milestones on one day may still have separate IDs.
- Continue linking the same verified Todo IDs. A new reporting day does not create a new task, reopen completed work or move a card by itself. Report what changed today and reference earlier delivery when useful rather than replacing yesterday's evidence.
- Correcting an old report, repairing its task links or retrying an uncertain request remains an operation on that original report **even after midnight**. Keep its source_id and exact retry payload; do not duplicate it into today merely to update metadata. A delayed successful retry still needs readback. Never backdate server timestamps or rename old source IDs to make a daily view look complete.
- Date rollover alone is not material progress: scheduled no-change checks stay silent, and a manual request with no new evidence should say so. Do not copy yesterday's content into a new daily report as a heartbeat.

Example: a session reports API work at 23:50, then makes a new tested fix at 00:20 in the configured zone. Create the next day's progress report, linking the original API task. If the 00:20 operation only repairs the 23:50 report's missing task link, revise the old report instead.

## Failure recovery: give the user a concrete next step

Never claim a failed or unverified write succeeded. Keep the same work-unit `source_id` and still relevant content for recovery; do not save a success checkpoint after failure. Do not automatically create/revoke credentials, weaken permissions, disable TLS checks, or switch identities. Explain the failed step without printing tokens, session cookies, invitation links or full private responses. Ask for **one specific user action** when the Agent cannot safely resolve the cause.

| Failure | Agent action and user next step |
| --- | --- |
| Installed Skill missing or outdated | Read the supplied service's canonical Skill URL. If unavailable, ask the user to open **Report → Skill** on their CoFlow instance and provide the reachable Skill URL or file. Do not guess an API contract or silently overwrite a customized installation. |
| Project binding missing, conflicting, or project root moved | With a complete explicit service/identity/file path, proceed for this request after validation. Otherwise ask the user to open **Agent credentials**, copy the installation prompt and run it in this project/Agent. Do not scan other projects or choose a team automatically. |
| Credential file absent, unreadable, insecure, or a symlink | Stop authentication. Explain the exact local path and ask the user to rerun the installation prompt on this device, or repair that file's access/permissions. Never ask them to paste the secret into logs or a public issue; do not read alternate files or browser sessions. |
| HTTP 401 | The token may be expired, revoked, or its membership removed. Ask the user to check **Agent credentials** in the intended team; if needed, create a replacement with the required scope and run its installation prompt. Do not loop retries or silently fall back to another token. |
| HTTP 403 or identity mismatch | Report the target team/member and the non-secret mismatch or missing scope. Ask the user to switch to the correct team/account and install its credential, or have an administrator restore membership/required access. A read-only token cannot report. Do not assume every 403 means the token expired. |
| DNS, connection refused, timeout, or unreachable localhost | Check unauthenticated health once. Ask the user to confirm the instance is running and accessible from this Agent's machine; cloud Agents need a reachable server URL, not another computer's localhost. Do not open ports, deploy, or change DNS automatically. |
| TLS failure, redirect, HTML login page, unknown mode, or malformed success response | Stop authenticated requests. Ask the user to confirm the exact HTTPS service URL/certificate/proxy configuration. Never forward the token to a redirect or linked site. A 2xx response without a usable saved report ID is not verified success. |
| HTTP 400, 409, 413, or 422 | Read the safe validation message and current metadata/report; correct supported IDs, status or payload limits when unambiguous. Preserve human-confirmed classification and concurrent changes. If project/classification or intended content is unclear, ask the user to choose it; do not discard content or create arbitrary categories to bypass validation. |
| HTTP 404 / 405 | Confirm the base URL, read the canonical Skill/OpenAPI and unauthenticated health. If the API route is unavailable, ask the instance maintainer to check the running version and proxy routing; do not install future CLI/MCP integrations as a workaround. |
| HTTP 429 or transient 5xx/network interruption | Retry at most twice using the same `source_id`, with backoff; honor `Retry-After`. If a delay is too long for the current run, tell the user when to retry. After exhaustion, ask them to check service status or retry “上报 CoFlow” later. |
| Connection lost after POST | The write may have succeeded. Read existing reports for the exact member/project/source_id before retrying. A matching saved record can establish success; otherwise reuse the same ID. If reads also fail, say the outcome is uncertain and ask the user to check Timeline before retrying. |
| Report saved but local checkpoint write failed | Report the verified server success separately and explain the local permission/path issue. Ask the user to repair the local binding; next time reconcile the server record before reporting again. Do not repost just to repair a checkpoint. |
| No meaningful change or no authorized evidence | Skip reporting. For a manual request, briefly explain what is missing and ask for the relevant progress/link only if needed. Scheduled no-change runs stay quiet; no empty reports, heartbeat reports, or invented deliverables. |

A concise failure response should state: the failed step, whether a report is saved / not saved / uncertain, and the single action needed next. For example: “The credential was rejected (401); nothing was reported. Open Agent credentials, install a valid credential for this team, then say ‘上报 CoFlow’ again.” Do not persist failed report bodies in project files; keep only the already authorized private minimal mapping/checkpoint.

## Deleted reports and share links

A browser author or team administrator can soft-delete and restore reports/comments. Agent tokens cannot delete, restore or read trash. When a POST using an existing `source_id` returns 409 because the report was deleted, stop and ask the user to review the web trash and restore it if appropriate. Do not retry or invent a new source ID to bypass deletion.

The report detail offers **Copy link** and **Copy source_id**. A `?report=<id>` link locates an active report after sign-in within the current team; it is not a public share or access grant. Never infer access to another team from such a link.

## Collaboration and follow-up

An existing explicit mandate to coordinate work through CoFlow may already authorize the relevant requests, member notifications and routine updates below; reuse that authorization rather than asking again for each covered action. Requests and comments are shared records, not proof that a person or Agent has started execution. Read permitted feedback again on the next authorized work session and reconcile it with the current task and user mandate before acting.

When the user asks to request help, `GET /api/v1/collaborations` returns team requests and progress. With `comments:write`, POST `/api/v1/collaborations` using `report_id`, `assignee_id` (existing member), `title`, and optional `body`. This notifies the assignee. With the same permission, the creator or assignee may PATCH `/api/v1/collaborations/<id>` with `status` (`open`, `in_progress`, `blocked`, `done`, `cancelled`) and a progress `body`. Read a successful response before claiming success. Ordinary authorization to report does not by itself authorize creating assignments or acting on requests.

Comments use POST `/api/v1/reports/<id>/comments` with `body` and optional `mentions` member IDs. For a requested status change, PATCH `/api/v1/reports/<id>` with `status`. GET `/api/v1/reports/<id>/history` returns the latest 100 revision/classification records. Browser members organize categories; Agent tokens cannot approve, merge, archive, or manually correct classification.

## Contract and future integrations

Use HTTP directly for the current version. CLI and MCP are planned integrations, not supported setup paths; do not instruct users to install or configure them.

Detailed contract: `<service>/agent/openapi.yaml`, or `docs/openapi.yaml` in the repository.

## Todo integration

The Skill's default reporting workflow includes task reconciliation for concrete doing, planned and finished work; use [Todo operations](todos.md). This does not change the server contract: `todo_ids` is still optional, and existing reporting credentials do not gain Todo scopes. Task creation needs todos:read/write; reports accept up to 20 verified todo_ids with todos:read. For explicit report-only behavior or unavailable task access, omit the field to preserve existing references and clearly identify any task tracking left unsynced; [] explicitly removes references. Each independent progress report uses its own source_id, distinct from a task source_id.

Only with todos:write, object maintenance permission and the user's authorization, include `operation_id` and `todo_moves: [{id, column_id, expected_revision}]`. Read current task revisions and board columns first; each moved task must be in todo_ids. The report, links, moves, history and notifications commit atomically. Retry uncertain outcomes with the identical body and operation_id; on 409 re-read and reconcile before submitting a new operation. Reporting delivered work does not automatically complete a task, and card movement does not authorize execution or require a new report.
## Optional daily check

A daily change-check task is optional. Explain it when the user asks or an authorized ongoing collaboration would benefit; do not make an unsolicited recommendation part of every installation. First confirm the user's consent, execution time, and time zone before creating it. Use the Agent's supported scheduler, inspect and reuse a matching project/service/team/member task, and explain if scheduling is unavailable. Do not substitute OS cron or another external scheduler without authorization.

The scheduled instruction must name this Skill, the canonical project root, exact service/team/member and local binding/credential path. It must never contain the token. Use the same health, identity, scope and reporting checks as a manual report; a scheduled run does not authorize executing comments, assigning teammates, or reading unrelated projects.

On each run:

- Check authorized project evidence against the last successful report/checkpoint, including uncommitted work, deliverables, validation results and blockers; a Git commit hash alone is insufficient. Compare meaningful outcomes, not the passing date, generated wording, formatting, file timestamps or a repeated failure with no new information.
- If nothing materially changed, **do not POST or PATCH a report**. Finish quietly without routine no-change notifications. If there is no useful authorized evidence, also skip rather than invent progress. On the first run, compare existing briefs for this project/work unit; do not upload historical activity merely to establish a baseline.
- If there is new progress, changed deliverables, a new/resolved blocker or another material change, follow the reporting-day rule: new later-day progress gets a new report source_id and retains the same task links; corrections/retries reuse the original report. Preserve still relevant content and links.
- Keep only a minimal local checkpoint/fingerprint with the work-unit mapping in the private binding; no source snapshots, chats or secrets. Advance the reported fingerprint only after a successful response. A failed write must remain eligible for the next check. Report an actionable authentication/configuration failure instead of silently treating it as no change; do not substitute another credential or recreate the schedule.
