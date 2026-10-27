# CoFlow Todo operations

Use the single [CoFlow Skill](../SKILL.md), with the verified service, identity and private binding from [installation](installation.md).

This reference maintains the shared work record. Under the user's authorization, create and assign tasks to existing team members, read assigned work, record comments and blockers, move or complete tasks, and link delivery reports. An Agent is an operation source, not a separate account or task assignee. CoFlow does not launch other Agents, deliver external messages or dispatch execution. Multiple Agents can maintain the same authorized team work using their owners' scoped credentials; obtain actual execution authorization and tools separately.

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

POST `/todos` with `title`, `column_id`, stable `source_id`, and unique `operation_id`; optional fields are body, assignee_id, project_id, domains, priority, due_date, links (at most 20 HTTP(S) links), agent and model. Optional report_ids may reference at most 20 accessible reports and require reports:read. Creation is deduplicated by team/member/source_id. Retries use exactly the same body and operation_id; a new task uses a new source_id. Keep the returned stable task ID.

PATCH `/todos/<id>` with `operation_id`, `expected_revision`, `action` and necessary fields. Edit action `edit` supports partial fields; omitted fields remain unchanged. For a move use action `move`, `column_id` and `board_revision`, plus at most one `before_id` or `after_id` anchor from the destination column. Without an anchor append at the end. Filtered views never justify submitting an entire reordered column.

Actions `complete` and `reopen` also require board_revision. Complete moves to the configured completed column. Reopen returns to the previous active incomplete column or a valid fallback. `archive` and `restore` change visibility without deleting history. `comment` uses body and optional mentions (team member IDs) with expected_revision. Read a successful response before stating an action succeeded.

On 409, GET the latest task/board and reconcile with the user's intent; do not blindly retry stale revisions or overwrite human changes. A revised payload needs a new operation_id. On an uncertain network outcome, retry the exact request using its original operation_id. On 401/403, stop and explain authentication/authorization requirements. On service failure, preserve the intended update privately and report that it has not been confirmed.

## Timeline integration

POST `/reports` accepts `todo_ids` (at most 20) with the fields in [Timeline reporting](reporting.md). Every independent progress update gets a new report source_id; correcting that progress keeps its report source_id. Task and report source IDs are independent. Leaving todo_ids absent preserves existing references; providing [] unlinks them.

Default: report progress without changing a task. Only when authorized, add `operation_id` and `todo_moves: [{id, column_id, expected_revision}]`. Each moved task must also occur in todo_ids. Go validates and commits report, links, task moves, history and notifications together, or rolls everything back. A delivered report does not imply task acceptance or completion. Do not create a report merely because a card moved.

GET `/reports/<id>` includes todo_ids for a token with todos:read. A task can have many progress reports and a report can cover many tasks. Deleted reports cannot be read through task references. Never copy report contents into another object to bypass access rules.

To take over an existing collaboration, first read it and ask only for information absent from the user's authorization. POST `/collaborations/<id>/todo` with column_id, requiring reports:read and todos:read/write and creator/assignee permission. This operation is idempotent by collaboration ID; original discussion stays in Timeline, while future status is maintained in Todo. Ordinary linking does not transfer state.