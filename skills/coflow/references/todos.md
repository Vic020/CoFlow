# CoFlow Todo operations

Use the single [CoFlow Skill](../SKILL.md), with the verified service, identity and private binding from [installation](installation.md).

This reference maintains the shared work record. Under the user's authorization, create and assign tasks to existing team members, read assigned work, record comments and blockers, move or complete tasks, and link delivery reports. An Agent is an operation source, not a separate account or task assignee. CoFlow does not launch other Agents, deliver external messages or dispatch execution. Multiple Agents can maintain the same authorized team work using their owners' scoped credentials; obtain actual execution authorization and tools separately.

## Active delivery follow-through

Apply the entry's collaboration loop during an ongoing authorized assignment: read the current task and relevant feedback, identify the next useful step, do the authorized work, then keep its progress and evidence current. A task retains one accountable assignee; participation by multiple people or Agents does not create additional assignees or identities.

For a blocker or handoff, make the needed contribution clear to the user: what is needed, who can provide it, its effect on delivery and what can continue meanwhile. If the existing mandate covers CoFlow notifications or assignment, record the concrete request using supported comments, mentions or task operations. Otherwise tell the user the proposed handoff and the missing authorization. Do not claim a collaborator accepted, started or finished work without evidence. Before changing a task another participant may have updated, reread its revision and preserve their changes.

When delivery is ready, link its report and validation, state the remaining review or acceptance step, and use completion only within the agreed authority. Moving cards without actual progress is not task advancement.

## Permissions and authorization

- `todos:read` reads board, tasks and necessary metadata, without granting reports:read.
- `todos:write` additionally requires todos:read. It creates, edits, moves, completes, reopens, archives and restores tasks only when the token owner is creator or assignee. Administrator tokens do not gain global task administration.
- Comments require todos:read and comments:write. Agent tokens cannot delete or restore comments, manage shared columns or change credentials and memberships.
- Linking a report requires reports:write and todos:read; reading report contents requires reports:read. Joint report/task movement additionally requires todos:write and object maintenance permission.
- Existing credentials do not gain new scopes. Explain missing access and ask the user to issue a suitable token through the web UI; never escalate scopes yourself.
- Moving a card or reading a comment is not authorization to perform its underlying work. Execute external work only under the user's actual instructions and tool permissions. Never claim delivery without successful results.

## Read first

GET `/todo-board` returns columns, `default_done_id` and board `revision`. GET `/todos` accepts `q`, `project`, `domain`, `assignee`, `column`, `scope` (all/related/todo), `archived`, `limit` (1–200), and `cursor`; follow `next_cursor` until empty. Column IDs are stable, names are user authored. GET `/todos/<id>` includes current revision, comments, history and permitted report references.

Use metadata IDs and existing domain names. Do not invent columns, categories, assignees or duplicate a task just because its title changed. A task has one assignee, one optional project, multiple domains, priority none/low/medium/high, and an optional YYYY-MM-DD due_date. Dates have no implicit UTC midnight timestamp.

## Create and maintain

### Reconcile tasks when reporting

For a reporting request using this Skill, identify each concrete, independently trackable work item and state **what is being done**, its intended result, actual stage, and the next step or completion evidence. Include confirmed future work and work already finished, even if no task was created at the time. A one-off report includes this reconciliation for its work items, without authorizing future execution or ongoing project management. An explicit report-only instruction overrides this default.

| Work described in the report | Task treatment |
| --- | --- |
| Currently doing | Reuse the corresponding task, or create one in the verified in-progress stage; describe actual progress, blockers and next steps. |
| Confirmed future to-do | Reuse or create a pending/backlog task and state the expected outcome. Do not invent an owner, deadline or commitment for a hypothetical suggestion, and do not start the work just because its task exists. |
| Work already finished | Reuse or create its task with the outcome and evidence. Use the completed stage when completion is established and within the user's completion authority; work delivered but still awaiting acceptance belongs in the verified review stage. |

1. **Reuse first.** Check an explicitly supplied task ID, the report's existing links and stable task source IDs before searching the same project/work scope. Follow pagination and include completed and, when needed to avoid duplication, archived work. Similar titles alone do not prove two tasks are the same. A renamed task, repeat report or different Agent/session does not create a new work item. Do not recreate or reopen archived/completed work merely to make a report; reconcile with the user's intent when unclear.
2. **Resolve real stages.** Read `/todo-board` and use its stable column IDs and actual configuration, not assumed English/Chinese names or hardcoded IDs. Select the team's established pending, doing, review or completed stage. If an incomplete stage is ambiguous, ask for that specific mapping rather than creating columns or guessing. Missing Todo access does not authorize changing credentials or broadening scopes.
3. **Create only the missing tasks.** Use a stable task `source_id` separate from report source IDs and a unique `operation_id` for each intended creation. Keep the returned task ID, revision and actual outcome. With no stated assignee, leave it unassigned rather than assigning another person implicitly; the credential owner remains the creator. For retrospective finished work, note its actual historical date in the description only when known; never backdate server-owned creation/completion timestamps or invent delivery evidence.
4. **Link and update consistently.** Once IDs are verified, submit the report with `todo_ids`. When the reported stage establishes an authorized change to an existing task, use the supported joint `todo_moves` transaction and current revisions; otherwise preserve its state. Do not overwrite human decisions or mark an unaccepted delivery complete. Keep still-relevant links when revising an existing report, and respect the 20-task limit; split coherent reports if necessary rather than truncating task coverage silently.
5. **Report partial outcomes.** Task creation and report submission are separate API calls; only the report/link/move operation is atomic. If tasks are created but reporting fails, retain and reuse those task IDs on retry; do not duplicate or delete them to fake rollback. If reporting succeeds but task tracking is unavailable, clearly say the report is saved and which task records remain unsynced. Continue only the permitted, already authorized reporting operation and omit unsupported Todo fields; do not claim complete synchronization or bypass an identity/authentication failure. Ask for the missing Todo access or decision once, without repeatedly retrying a denied operation.

Group repeated mentions of the same work into one task, while keeping genuinely separate deliverables separate. A report containing only commentary or a no-change check does not justify inventing tasks. Summarize the actual created/reused task IDs and states for the user after successful responses.

Example: a project update says an API fix is in progress, deployment is planned next, and a UI change has passed acceptance. Reconcile three work items in the team's doing, pending and completed stages. A later report about more tests for the same API fix links the existing API task instead of creating a fourth task.

### Supported writes

POST `/todos` with `title`, `column_id`, stable `source_id`, and unique `operation_id`; optional fields are body, assignee_id, project_id, domains, priority, due_date, links (at most 20 HTTP(S) links), agent and model. Optional report_ids may reference at most 20 accessible reports and require reports:read. Creation is deduplicated by team/member/source_id. Retries use exactly the same body and operation_id; a new task uses a new source_id. Keep the returned stable task ID.

PATCH `/todos/<id>` with `operation_id`, `expected_revision`, `action` and necessary fields. Edit action `edit` supports partial fields; omitted fields remain unchanged. For a move use action `move`, `column_id` and `board_revision`, plus at most one `before_id` or `after_id` anchor from the destination column. Without an anchor append at the end. Filtered views never justify submitting an entire reordered column.

Actions `complete` and `reopen` also require board_revision. Complete moves to the configured completed column. Reopen returns to the previous active incomplete column or a valid fallback. `archive` and `restore` change visibility without deleting history. `comment` uses body and optional mentions (team member IDs) with expected_revision. Read a successful response before stating an action succeeded.

On 409, GET the latest task/board and reconcile with the user's intent; do not blindly retry stale revisions or overwrite human changes. A revised payload needs a new operation_id. On an uncertain network outcome, retry the exact request using its original operation_id. On 401/403, stop and explain authentication/authorization requirements. On service failure, preserve the intended update privately and report that it has not been confirmed.

## Timeline integration

POST `/reports` accepts `todo_ids` (at most 20) with the fields in [Timeline reporting](reporting.md). Every independent progress update gets a new report source_id; correcting that progress keeps its report source_id. Task and report source IDs are independent. Leaving todo_ids absent preserves existing references; providing [] unlinks them.

When a session crosses the reporting-day boundary, new progress uses a new daily report as specified in the reporting reference, linked to these same tasks. Do not clone tasks per day. Cross-day correction of an old brief or its missing task links still updates that old brief; a date change alone is not a new delivery.

The reporting workflow above reconciles task records by default; it does not automatically move every linked task. For an authorized stage change, add `operation_id` and `todo_moves: [{id, column_id, expected_revision}]`. Each moved task must also occur in todo_ids. Go validates and commits report, links, task moves, history and notifications together, or rolls everything back. Prior task creation is separate. A delivered report does not imply task acceptance or completion. Do not create a report merely because a card moved.

GET `/reports/<id>` includes todo_ids for a token with todos:read. A task can have many progress reports and a report can cover many tasks. Deleted reports cannot be read through task references. Never copy report contents into another object to bypass access rules.

To take over an existing collaboration, first read it and ask only for information absent from the user's authorization. POST `/collaborations/<id>/todo` with column_id, requiring reports:read and todos:read/write and creator/assignee permission. This operation is idempotent by collaboration ID; original discussion stays in Timeline, while future status is maintained in Todo. Ordinary linking does not transfer state.
