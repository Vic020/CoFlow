# CoFlow CLI command list

<!-- Generated from apps/cli/commands.json. Run node scripts/sync-cli-reference.mjs. -->

This table lists all 110 registered commands. See the [CLI guide](cli.md) for workflows and `coflow help COMMAND --json` for flags and examples in your installed version.

Commands marked Browser use `--prepare` followed by **Agent credentials → Review CLI request**. Device login and grant instead use a browser pairing code. Scope cells show the scopes declared for the command. Identity, workspace and object permissions still apply.

| Usage | Purpose | Effect | Declared scopes |
| --- | --- | --- | --- |
| `coflow account preferences` | Read your language and display preferences. | read · Browser | — |
| `coflow account show` | Read your account and workspace memberships. | read · Browser | — |
| `coflow account update-preferences --file input.json` | Change your language or display preferences. | write · Browser | — |
| `coflow account update-profile --file input.json` | Edit your user profile. | write · Browser | — |
| `coflow ai action-confirm --id ID --file input.json` | Confirm a reviewed assistant proposal. | write · Browser | — |
| `coflow ai action-edit --id ID --file input.json` | Edit a pending assistant proposal. | write · Browser | — |
| `coflow ai chat --file input.json` | Send a message to the assistant. | write · Browser | — |
| `coflow ai config-change --id ID --file input.json` | Update a model configuration. | write · Browser | — |
| `coflow ai config-create --file input.json` | Save a model configuration. | write · Browser | — |
| `coflow ai config-delete --id ID --file input.json` | Remove a model configuration. | write · Browser | — |
| `coflow ai config-list` | List model configurations. | read · Browser | — |
| `coflow ai config-verify --file input.json` | Check a draft model configuration before saving. | write · Browser | — |
| `coflow ai config-verify-saved --id ID` | Check a saved model configuration. | write · Browser | — |
| `coflow ai context-organize --file input.json` | Run the assistant's Context organization flow. | write · Browser | — |
| `coflow ai conversation-change --id ID --file input.json` | Edit, archive or restore a conversation. | write · Browser | — |
| `coflow ai conversation-create --file input.json` | Start a conversation. | write · Browser | — |
| `coflow ai conversation-list` | Find conversations. | read · Browser | — |
| `coflow ai conversation-show --id ID` | Read a conversation. | read · Browser | — |
| `coflow ai job-change --id ID --file input.json` | Update a scheduled job. | write · Browser | — |
| `coflow ai job-create --file input.json` | Create a scheduled job. | write · Browser | — |
| `coflow ai job-list` | Read scheduled jobs. | read · Browser | — |
| `coflow ai job-preview --timezone TIMEZONE --local-time LOCAL-TIME --weekdays WEEKDAYS` | Preview the next scheduled run. | read · Browser | — |
| `coflow ai job-runs --id ID` | Read scheduled job runs. | read · Browser | — |
| `coflow ai mcp-approve --id ID --file input.json` | Approve reviewed MCP tools. | write · Browser | — |
| `coflow ai mcp-create --file input.json` | Add an MCP connection for review. | write · Browser | — |
| `coflow ai mcp-list` | List configured MCP connections. | read · Browser | — |
| `coflow ai mcp-verify --id ID` | Verify an MCP connection. | write · Browser | — |
| `coflow ai models --file input.json` | Read model IDs offered by a provider. | write · Browser | — |
| `coflow ai preference --file input.json` | Choose your default assistant configuration. | write · Browser | — |
| `coflow ai template-create --file input.json` | Save a task template. | write · Browser | — |
| `coflow ai template-list` | List task templates. | read · Browser | — |
| `coflow ai web-config-change --id ID --file input.json` | Update a web search configuration. | write · Browser | — |
| `coflow ai web-config-create --file input.json` | Save a web search configuration. | write · Browser | — |
| `coflow ai web-config-delete --id ID --file input.json` | Remove a web search configuration. | write · Browser | — |
| `coflow ai web-config-list` | List web search configurations. | read · Browser | — |
| `coflow ai web-config-verify --file input.json` | Check a draft web search configuration. | write · Browser | — |
| `coflow auth grant --space TEAM_ID --todo TODO_ID [--days 1] [--scope SCOPES]` | Ask a person to allow this CLI to work on one task or one project's tasks. | write | — |
| `coflow auth list` | List issued credentials in this space. | read · Browser | — |
| `coflow auth login [--space TEAM_ID] [--days 7] [--scope SCOPES]` | Sign in to CoFlow from a browser, even when the CLI runs on another machine. | write | — |
| `coflow auth logout` | Revoke this CLI login and remove its local credential. | write | — |
| `coflow auth revoke --id ID` | Revoke a credential from your account. | write · Browser | — |
| `coflow auth status` | Check the saved CLI login online and see when it expires. | read | — |
| `coflow calendar change --id EVENT_ID --file change.json` | Edit or archive a calendar node. | write | `calendar:read`, `calendar:write` |
| `coflow calendar create --file event.json` | Create a calendar node. | write | `calendar:read`, `calendar:write` |
| `coflow calendar list --from 2026-11-01 --to 2026-11-08` | Read planned work and calendar nodes. | read | — |
| `coflow calendar reports --from FROM --to TO` | Read progress reports by calendar date. | read | `reports:read` |
| `coflow calendar reschedule --file input.json` | Change the planned dates for several tasks together. | write · Browser | — |
| `coflow calendar show --id EVENT_ID` | Read the details of a calendar node. | read | `calendar:read` |
| `coflow catalog change --kind KIND --id ID --file input.json` | Rename or archive a project or domain. | write · Browser | — |
| `coflow catalog create --kind KIND --file input.json` | Create a project or domain. | write · Browser | — |
| `coflow catalog list` | List project and domain IDs. | read | `reports:read` |
| `coflow catalog merge --kind KIND --id ID --file input.json` | Merge a project or domain into another. | write · Browser | — |
| `coflow catalog order --kind KIND --file input.json` | Reorder projects or domains. | write · Browser | — |
| `coflow collaboration change --id ID --file input.json` | Respond to or close a collaboration request. | write | `comments:write` |
| `coflow collaboration convert --id ID --file input.json` | Turn a collaboration request into a task. | write | `todos:read`, `todos:write`, `reports:read` |
| `coflow collaboration create --file input.json` | Ask a teammate for help. | write | `comments:write` |
| `coflow collaboration list` | Read active collaboration requests. | read | `reports:read` |
| `coflow comment --id REPORT_ID --body "Thanks for the update"` | Reply to an existing report. | write | `comments:write` |
| `coflow context change --id CONTEXT_ID --file change.json` | Update knowledge using the latest record. | write | `context:read`, `context:write` |
| `coflow context create --file context.json` | Save knowledge for review. | write | `context:read`, `context:write` |
| `coflow context graph` | Read the links between knowledge and its sources. | read | `context:read` |
| `coflow context search --project PROJECT_ID` | Find knowledge by project or keyword. | read | `context:read` |
| `coflow context show --id CONTEXT_ID` | Read a knowledge entry and the records behind it. | read | `context:read` |
| `coflow context tree --project PROJECT_ID` | Read the project knowledge directory. | read | `context:read` |
| `coflow data detail --metric todos_completed --from 2026-11-01 --to 2026-11-08` | Read the original links behind one count. | read | — |
| `coflow data summary --from 2026-11-01 --to 2026-11-08` | Read progress and task counts. | read | — |
| `coflow delegation change --id ID --file input.json` | Respond to or end a work delegation. | write · Browser | — |
| `coflow delegation create --file input.json` | Start an ongoing work delegation. | write · Browser | — |
| `coflow delegation list` | Read ongoing work delegations. | read | `todos:read` |
| `coflow handoff changes --project PROJECT_ID` | Check for updates after your last read. | read | — |
| `coflow handoff read --todo TODO_ID` | Read the facts needed to pick up existing work. | read | — |
| `coflow inbox list` | Read your workspace notifications. | read · Browser | — |
| `coflow inbox read --file input.json` | Mark a notification as read. | write · Browser | — |
| `coflow invite create --file input.json` | Invite a person to the selected space. | write · Browser | — |
| `coflow invite list` | Read pending invitations. | read · Browser | — |
| `coflow invite revoke --id ID` | Revoke a pending invitation. | write · Browser | — |
| `coflow list` | Read reports and find the report IDs you need. | read | `reports:read` |
| `coflow member remove --id ID` | Remove a member and revoke their access to the space. | write · Browser | — |
| `coflow member role --id ID --file input.json` | Change a workspace member's role. | write · Browser | — |
| `coflow report --file report.json` | Send a progress report from a JSON file. | write | `reports:write` |
| `coflow report classify --id ID --file input.json` | Change a report's project and domains. | write · Browser | — |
| `coflow report comment --id REPORT_ID --body TEXT` | Reply to an existing report. | write | `comments:write` |
| `coflow report comment-delete --id ID --comment COMMENT` | Move a comment to the trash. | write · Browser | — |
| `coflow report comment-restore --id ID --comment COMMENT` | Restore a deleted comment. | write · Browser | — |
| `coflow report comment-trash --id ID` | Find deleted comments for a report. | read · Browser | — |
| `coflow report delete --id ID --file input.json` | Move a report to the trash. | write · Browser | — |
| `coflow report edit --id ID --file input.json` | Edit a report by its record ID. | write · Browser | `reports:write` |
| `coflow report history --id ID` | Read report revisions. | read | `reports:read` |
| `coflow report list --project PROJECT_ID` | Read recent reports and find their IDs. | read | `reports:read` |
| `coflow report restore --id ID` | Restore a deleted report. | write · Browser | — |
| `coflow report show --id REPORT_ID` | Read a report and its links. | read | `reports:read` |
| `coflow report status --id ID --file input.json` | Change a report status. | write | `reports:write` |
| `coflow report trash` | Find deleted reports. | read · Browser | — |
| `coflow report upsert --file report.json` | Send or correct a progress report. | write | `reports:write` |
| `coflow space create --file input.json` | Create a workspace. | write · Browser | — |
| `coflow space list` | List spaces with a saved CLI login on this server. | read | — |
| `coflow space use --space TEAM_ID` | Select which saved space the CLI should use by default. | local | — |
| `coflow todo board` | Find column IDs and the latest board revision. | read | `todos:read` |
| `coflow todo change --id TODO_ID --file change.json` | Edit, move, submit or reopen a task using its current revision. | write | `todos:read`, `todos:write` |
| `coflow todo column-change --id ID --file input.json` | Edit, move or archive a board column. | write | `todos:read`, `todos:write` |
| `coflow todo column-create --file input.json` | Add a board column. | write | `todos:read`, `todos:write` |
| `coflow todo completions` | Read recorded task completions. | read | `todos:read` |
| `coflow todo create --file todo.json` | Create a task using a stable work ID. | write | `todos:read`, `todos:write` |
| `coflow todo list --project PROJECT_ID` | Find tasks in a project. | read | `todos:read` |
| `coflow todo show --id TODO_ID` | Read a task, its current revision and related records. | read | `todos:read` |
| `coflow update check [--json]` | Find out if a newer stable CoFlow release is available. | read | — |
| `coflow whoami` | Check which user and space your credential belongs to. | read | — |
| `coflow workspace bind --server URL --space TEAM_ID` | Remember this server and space for commands run from this directory. | local | — |
| `coflow workspace show` | Find the project, domain and member values you can use. | read | — |
| `coflow workspace unbind` | Clear the server and space selected for this directory. | local | — |

Built-in entry points: `coflow help [COMMAND]`, `coflow --help`, and `coflow --version` (alias `coflow version`).
