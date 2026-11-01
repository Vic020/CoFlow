# Calendar operations

Read this reference for date-based report review, Todo scheduling, project phases, Big Days or business version milestones. Reuse the validated current-project binding and credential from [installation](installation.md). Verify `/health` and `/meta` before authenticated work. These operations require a service build that actually exposes the Calendar endpoints in its `/agent/openapi.yaml`; an older service returning 404 is not permission to invent another endpoint or write duplicate reports.

## Sources and permissions

- **Actual progress:** `GET /calendar/reports` requires only `reports:read`. It projects original reports by `created_at` in the requested display time zone. Reporting automatically makes a brief appear; do not create an event or submit a second report to link it to a day. Corrections remain on the original date. Follow [reporting](reporting.md) for new progress on another reporting day.
- **Task plans and deadlines:** `GET /calendar/schedule` includes Todo data with `todos:read`. Change the original Todo through `PATCH /todos/{id}` with `todos:read/write`, creator/assignee permission, `operation_id` and `expected_revision`. Read [Todo operations](todos.md) when maintaining its workflow or reporting task progress.
- **Independent plans:** `calendar:read` reads phase/Big Day/version events. `calendar:read/write` plus creator/assignee authority permits writes; browser admins retain team management. Existing tokens are not automatically expanded. A Todo grant is not a Calendar or reporting grant. An explicit `todo_ids`/`report_ids` change additionally needs the source read scope and accessible same-team objects; references never confer that access.

A date, phase or milestone is a plan, not proof of completion, an execution mandate or an automatic Agent dispatch. A business version milestone never changes repository versions or authorizes releases/deployments. No report on a day does not establish inactivity or lateness.

## Bounded reads

Both `GET /calendar/reports` and `GET /calendar/schedule` require `from=YYYY-MM-DD` (inclusive), `to=YYYY-MM-DD` (exclusive), and accept `timezone=IANA` (default UTC), with at most 93 civil days. Use the user's display/reporting time zone; resolve it from their context rather than inferring a fixed UTC offset. DST days can be 23 or 25 hours.

Use `limit` 1–200. Follow `next_cursor` with the returned `revision` and identical filters; stop at an empty cursor. On 409, reread the range and reconcile instead of mixing pages. Counts and lists share a source revision. A missing capability is not a zero count.

Report filters: `project`, `domain`, `member` (author), `agent`, `model`, `status`, `q` (title/body). Optional `day` selects an in-range day's detail page while `days` and `previews` still describe the full visible range. Count unique report IDs; do not sum domain/task associations as reports. Read original report details for body, feedback and delivery links.

Schedule filters: `project`, `domain`, `member` (assignee), `kind=todo|phase|big_day|version`, `q` (title), `task_status=open|completed` (tasks only), and `archived=true` (archived sources instead of active ones). `capabilities` identifies readable Todos, events and reports. `unscheduled=true` lists tasks with neither schedule nor deadline and needs `todos:read`. `key` is only a display projection key; mutate the original `id` through its source endpoint.

## Write time deliberately

Use one complete `schedule` representation:

```json
{"kind":"date-range","start_date":"2026-11-02","end_date":"2026-11-04"}
```

Both civil dates are inclusive. They are floating dates, never converted into midnight UTC or shifted by viewer time zones.

```json
{"kind":"time-range","start_at":"2026-11-02T09:00:00+08:00","end_at":"2026-11-02T11:00:00+08:00","timezone":"Asia/Shanghai"}
```

Time intervals are `[start_at,end_at)`, normalized to UTC, retaining an IANA planning time zone. Require explicit offsets; resolve ambiguous/nonexistent local DST times with the user/context instead of silently normalizing them. End must follow start for tasks/phases. A Big Day or version milestone uses one date (`start_date=end_date`) or one instant (`start_at=end_at`). Incomplete ranges are invalid; do not invent a duration.

Todo `schedule:null` clears only its plan. Missing schedule preserves it. `due_date` remains an independent deadline; changing plans never moves the deadline, completes/reopens the task, creates a report or rewrites historical progress. If a plan extends past a deadline, surface the risk and keep the user's explicit choice.

## Independent event lifecycle

- `POST /calendar/events`: `title`, `kind`, complete `schedule`, stable `source_id`, unique `operation_id`; optional `body`, `project_id`, `domains`, `assignee_id`, `todo_ids`, `report_ids`, HTTP(S) `links`, `agent`, `model`. Source deduplication is scoped to team/creator. Use an independent event only when it is a real plan distinct from an existing Todo.
- `GET /calendar/events/{id}`: original event, including archived state and audited changes. References/history are source-scope filtered; deleted reports are omitted. An unavailable reference is not permission to switch identities or query another team.
- `PATCH /calendar/events/{id}`: partial fields plus current `expected_revision` and unique `operation_id`; `action=archive|restore` maintains lifecycle. Omitted references preserve links; explicit empty arrays clear them. Archived events need restoration before editing.

Retry an uncertain write with the same operation ID and identical payload; changed payload requires a new operation. A stale revision requires rereading and reconciling the current event with the intended change. Keep the draft and explain a conflict; do not blindly overwrite another person or Agent. Report only meaningful actual progress through the original Timeline flow, within its distinct reporting authorization.
