---
name: coflow
description: Connect a project to CoFlow and coordinate delivery when the user requests CoFlow reporting, task management or ongoing project collaboration. Read relevant progress and feedback, maintain authorized Todo work, and report meaningful results to Timeline.
metadata:
  version: "1.1.0"
---

# CoFlow

The Skill version covers this entry and its linked references together. Reuse matching installations; follow the installation reference when updating.

Use this one Skill for CoFlow operations. Read only the reference needed for the user's request; the references are supporting Markdown, not separately installed Skills.

| Request | Read |
| --- | --- |
| Install, update, verify identity, or resolve a missing binding or credential | [Installation and identity](references/installation.md) |
| Report progress, revise a brief, read feedback or request collaboration | [Timeline reporting](references/reporting.md) |
| Read, create, assign, move or maintain Todo tasks and link delivery reports | [Todo operations](references/todos.md) |

Reporting concrete work also needs the task-reconciliation section of [Todo operations](references/todos.md): identify what is being done, planned or already finished, reuse or create the corresponding tasks, and link the report to them. This is part of a reporting request under this Skill, not a mandate to execute future work or coordinate indefinitely. Respect an explicit report-only instruction and the available Todo scopes.

For a new session, reuse the exact current project's validated private binding, service/team/member and credential convention from installation. If those are unknown, read installation before any authenticated request. Never scan other projects or substitute another identity on failure. Entry and references downloaded from a service resolve relative to `/agent/coflow/`; a local installed copy must preserve that layout.

## Agent-led collaboration loop

CoFlow is a shared delivery workflow for people and their Agents. Treat it as working context throughout an authorized assignment, not just a destination for a final report. Todo carries responsibility and current work; Timeline carries progress and delivery evidence. The board is one view of that workflow.

- **Explain the working relationship.** At the start of a CoFlow collaboration assignment, briefly tell the user what relevant work you will read, what you can advance within the existing mandate, and when you will sync progress. Make coordination needs visible to the user; do not wait for them to discover a blocker in the board. An installation-only or one-off reporting request retains its narrower scope.
- **Read before advancing.** On starting or resuming work, verify the binding and identity, then read the relevant tasks, linked reports and permitted feedback. Identify the owner, actual progress, unresolved dependencies and next useful action. Stay within the authorized project and module scopes; do not scan unrelated team work.
- **Advance within the mandate.** When the user has explicitly delegated ongoing CoFlow coordination, use initiative to maintain the covered tasks, reports and follow-up instead of waiting for a fresh instruction at every checkpoint. Reuse existing authorization; ask only for a missing decision, access or action outside it. Multiple Agents use their owners' scoped identities, shared stable work IDs and fresh revisions; do not impersonate a teammate or overwrite concurrent changes.
- **Surface collaboration needs.** Tell the user what help or review is needed, from which known member or role, why it matters, and the next step. When the mandate includes notifying or assigning members through CoFlow, record the request in the appropriate task/comment/report and use verified member IDs. Otherwise propose the concrete request to the user. Starting or messaging external Agents, external messages and new schedules require their own authorization and tools; a task assignment is not evidence that another Agent has received or started it.
- **Sync meaningful checkpoints.** After substantive progress, a blocker, changed scope, handoff or a delivery ready for review, update the authorized shared record with real evidence and what remains. Link tasks to reports rather than duplicating unrelated content. Explain to the user what advanced, what needs collaboration, and what was actually synced. Avoid empty heartbeat reports, duplicate updates and repeated no-change notices.
- **Close the loop honestly.** Verify writes before saying CoFlow is updated, and use the agreed acceptance criteria and completion authority before completing work. If sync fails, distinguish actual work from unsynced records and give the next recovery step. Continue independent authorized work where useful. Contact happens during this run or a later authorized resume; do not promise background monitoring or automatic inter-Agent dispatch that the current tools cannot provide.

These principles apply to future modules such as Calendar only when their actual service contract and module reference are available. Do not invent Calendar endpoints, scheduling or collaboration capabilities before they exist.

## Shared rules

- Verify unauthenticated `/api/v1/health`, then `/api/v1/meta` with the selected credential. Require the configured service mode and exact bound team/member before reading or writing business data. Never send a supplied real credential to demo mode.
- The token determines the member and team; Agent and Model are descriptive sources. Keep credentials in the private configured location and never print them, include them in prompts, or store them in a repository. Reuse existing credentials and bindings when consolidating an older installation.
- Respect module scopes and object permissions. Installing this Skill does not grant reporting or Todo access, broaden a token, authorize a business write, or create a schedule. Web-only administrative actions stay web-only.
- Todo is the ongoing work item; Timeline is progress and delivery evidence. Link them using stable IDs. Each independent progress report has its own report source_id; correcting that progress reuses it. Task and report source IDs are independent.
- A concrete reported work item should have a corresponding task, including work in progress, confirmed future work and finished work. Reconcile existing tasks first; do not create one task per sentence, report or session. Use the actual stage and evidence, distinguish delivery from acceptance, and make any task/report partial failure visible to the user.
- Writes need successful API evidence before claiming success. Use stable source IDs, operation IDs and revisions as specified in the relevant reference. Retry uncertain writes with the identical payload; on a conflict reread and reconcile rather than overwriting human changes.
- Assignment, a card move, a comment or a report is not execution authorization. CoFlow records coordination and progress; it does not automatically start or orchestrate external Agents. Carry out actual work only with the user's authorization and the appropriate tools.
- Report only real changes and deliverables. A delivered report does not imply task acceptance or completion. No meaningful change means no fabricated report or automatic status change.

Read the detailed API contract from the configured service's `/agent/openapi.yaml` when needed. CLI, MCP, built-in execution dispatch and future modules must not be presented as available capabilities.
