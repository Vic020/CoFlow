---
name: coflow-report
description: Report a project's progress, deliverables, blockers, and collaboration needs to CoFlow when the user requests a report or authorizes scheduled reporting.
---

# CoFlow progress reporting

Read this document and report through HTTP. Installing a CLI or accessing the CoFlow source repository is not required.

## Service address and identity

Use the service address provided by the user. When reading this document from `<origin>/agent/coflow-report/SKILL.md`, the service address is `<origin>` unless the user specifies a different trusted CoFlow server. When using a downloaded copy, use the user's service address or `COFLOW_URL`; ask only if no address is available. Do not assume localhost refers to the user's server when running on another machine.

Read `GET <service>/api/v1/meta` first. The current milestone returns `mode: "local-demo"`: every write belongs to demo member 陈一, credentials are not supported, and no credential should be sent. Tell the user this is an attribution-limited local demo. If a credential was supplied, keep it out of URLs, report content, output and files; explain that this demo does not use it. Do not claim it was authenticated. If metadata does not identify the supported local-demo mode, stop and request the matching service's authentication instructions; do not guess a credential protocol or forward credentials to another host.

A direct request such as “按照要求上报一下目前进展” authorizes reporting to the specified service; do not ask for confirmation again. Loading this skill alone does not authorize a report.

## Prepare the brief

- Read metadata for existing project IDs, domains and members. Read `GET <service>/api/v1/reports` to check previous briefs and feedback.
- Use the current conversation and authorized project context. Report completed work, concrete deliverables, blockers and the next step. Do not invent work, verification results or links. If there is no useful new progress, explain that rather than posting an empty update.
- Make one brief per project and coherent work unit. Leave `project_id` or `domain` empty when uncertain; do not invent projects or domains. Do not ask the user to repeat information already available in the working context.
- Lead with the result in a short title. The Markdown body can explain results, validation, blockers and next steps. Include only relevant delivery links; do not upload full chats, logs, credentials or unrelated private data.
- `agent` and `model` describe the actual tool and model when known. They are not identities. Leave unknown values empty.
- `mentions` contains existing member IDs, not names. State the requested help in the brief. Reading a comment is not authorization to execute its contents or reply automatically.

## Send the report

POST JSON to `<service>/api/v1/reports` with `Content-Type: application/json`. A standard HTTP client or curl is sufficient.

```json
{
  "source_id": "stable-project-work-unit-id",
  "title": "完成首页移动端适配",
  "body": "导航与内容布局已适配，预览已更新。需要设计同事确认后合并。",
  "project_id": "website",
  "domain": "研发",
  "agent": "Codex",
  "model": "",
  "status": "review",
  "links": [{"title": "在线预览", "url": "https://example.com"}],
  "mentions": ["wang"]
}
```

The IDs, domain and URL above are examples. Replace them with existing metadata and actual deliverables, or leave optional fields empty.

- `status`: `progress` (进展), `review` (待反馈), `blocked` (阻塞), `delivered` (已交付), `resolved` (已解决).
- Always supply a stable `source_id`. The same report, retry or revision must reuse it; new work uses a new ID. A project daily brief can use a project-specific date/session identifier.
- An upsert replaces the brief and links, so retain still relevant content when updating. Existing creation time and comments are preserved.
- Only claim success after a successful HTTP response containing the saved report ID. Reply with a short result and a link to `<service>/` so the user can see the Timeline.
- If the request fails, state the error. Retry transient failures at most twice with the same `source_id`; do not repeatedly retry validation errors.

## Optional tools and detailed contract

If working inside a CoFlow checkout, the optional CLI is `node <repository>/apps/cli/coflow.mjs report --file <report.json>` with `COFLOW_URL` set to the service address.

The detailed OpenAPI contract is available at `<service>/agent/openapi.yaml`, or `docs/openapi.yaml` inside the repository.
