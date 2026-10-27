---
name: coflow
description: Connect a project to CoFlow, report progress and deliverables to Timeline, or create, assign and maintain Todo tasks when the user requests CoFlow reporting or task management.
metadata:
  version: "1.0.0"
---

# CoFlow

The Skill version covers this entry and its linked references together. Reuse matching installations; follow the installation reference when updating.

Use this one Skill for CoFlow operations. Read only the reference needed for the user's request; the references are supporting Markdown, not separately installed Skills.

| Request | Read |
| --- | --- |
| Install, update, verify identity, or resolve a missing binding or credential | [Installation and identity](references/installation.md) |
| Report progress, revise a brief, read feedback or request collaboration | [Timeline reporting](references/reporting.md) |
| Read, create, assign, move or maintain Todo tasks and link delivery reports | [Todo operations](references/todos.md) |

For a new session, reuse the exact current project's validated private binding, service/team/member and credential convention from installation. If those are unknown, read installation before any authenticated request. Never scan other projects or substitute another identity on failure. Entry and references downloaded from a service resolve relative to `/agent/coflow/`; a local installed copy must preserve that layout.

## Shared rules

- Verify unauthenticated `/api/v1/health`, then `/api/v1/meta` with the selected credential. Require the configured service mode and exact bound team/member before reading or writing business data. Never send a supplied real credential to demo mode.
- The token determines the member and team; Agent and Model are descriptive sources. Keep credentials in the private configured location and never print them, include them in prompts, or store them in a repository. Reuse existing credentials and bindings when consolidating an older installation.
- Respect module scopes and object permissions. Installing this Skill does not grant reporting or Todo access, broaden a token, authorize a business write, or create a schedule. Web-only administrative actions stay web-only.
- Todo is the ongoing work item; Timeline is progress and delivery evidence. Link them using stable IDs. Each independent progress report has its own report source_id; correcting that progress reuses it. Task and report source IDs are independent.
- Writes need successful API evidence before claiming success. Use stable source IDs, operation IDs and revisions as specified in the relevant reference. Retry uncertain writes with the identical payload; on a conflict reread and reconcile rather than overwriting human changes.
- Assignment, a card move, a comment or a report is not execution authorization. CoFlow records coordination and progress; it does not automatically start or orchestrate external Agents. Carry out actual work only with the user's authorization and the appropriate tools.
- Report only real changes and deliverables. A delivered report does not imply task acceptance or completion. No meaningful change means no fabricated report or automatic status change.

Read the detailed API contract from the configured service's `/agent/openapi.yaml` when needed. CLI, MCP, built-in execution dispatch and future modules must not be presented as available capabilities.
