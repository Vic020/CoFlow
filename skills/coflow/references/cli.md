# CoFlow CLI

Use the CLI to read and update CoFlow as the authenticated user. It works well for a person in a terminal and for an agent with an existing grant. Use the [command list](cli-commands.md) to find an operation and the installed binary's help to check its exact flags. Read the relevant module reference for the business rules.

## Install or update

1. Try `command -v coflow`, then `$HOME/.coflow/bin/coflow --version`. Reuse an existing binary that supports the operation.
2. If asked to install, download the installer from the verified instance's `/agent/install-cli.sh` or the official CoFlow repository. Review the saved script, then run it. It verifies the official Release archive, installs to `~/.coflow/bin/coflow` by default, and sets up PATH for Bash, Zsh, or Fish. Open a new shell or invoke the binary by its full path. Pass `--no-path` to skip shell configuration.
3. When a matching archive is unavailable, build from the desired CoFlow checkout using `cargo install --path apps/cli --locked --root "$HOME/.coflow"`. Rust is needed for the build.
4. Run `coflow --version` and `coflow help --json`. Use `coflow update check --json` to look up the latest official stable release. Update the binary and the [Skill bundle](installation.md) separately, preserving the current bindings and credentials.

## Connect and check your identity

Use the exact trusted CoFlow origin and the intended space. The examples use placeholders, including the server. Substitute verified values before running them.

```sh
export COFLOW_URL=https://coflow.example.test
coflow auth login --space TEAM_ID
coflow auth status --space TEAM_ID --json
coflow whoami --space TEAM_ID --json
coflow workspace show --space TEAM_ID
```

- **Browser login.** Open the URL printed in your terminal, enter your own pairing code under **Agent credentials → Connect CLI**, and check the account, workspace, scope and validity. Login defaults to read-only for seven days. Request only the additional scopes needed for the job. The person approving the login completes it in their browser.
- **Agent grant.** Ask for a scoped grant with `coflow auth grant --space TEAM_ID --project PROJECT_ID` or with `--todo TODO_ID`. The default is a one-day, read-only Todo grant. The person issuing it reviews the request in their browser.
- **Existing Agent Token.** Use the [verified project binding](installation.md) and inject its existing token into the child process as `COFLOW_TOKEN`. This takes precedence over a saved login for business commands. Keep credentials out of command arguments, logs, prompts and source files.
- **Working in multiple spaces.** Use `space list` and `space use --space TEAM_ID` for saved logins, or `workspace bind --server URL --space TEAM_ID` to bind the current directory. `workspace unbind` removes that binding. Explicit `--server` or `COFLOW_URL` takes precedence over the directory binding. Pin the verified account with `COFLOW_EXPECT_USER` and pass `--space TEAM_ID` on team business commands. Confirm server, team, user and mode with `whoami` before doing work.
- **Sign out.** Use `auth logout --space TEAM_ID` for your saved login. Use the current workspace's credential controls to review or revoke other grants.

## Everyday work

```sh
coflow help todo list --json
coflow todo board
coflow todo list --project PROJECT_ID
coflow todo show --id TODO_ID
coflow handoff read --todo TODO_ID
coflow report list --project PROJECT_ID
coflow context tree --project PROJECT_ID
coflow calendar reports --from 2026-11-01 --to 2026-11-08
coflow data summary --from 2026-11-01 --to 2026-11-08
```

These examples assume the verified team target is already pinned. Use IDs returned by CoFlow, and add `--project` or the supported filter where the user requested a narrower scope. Follow list pagination and use the original objects to verify important details. For incremental handoff, read `coflow help handoff changes`. Save a cursor only after reviewing the page it represents.

To publish progress with an authorized credential, prepare a JSON object such as the one below and run `coflow report upsert --file report.json`. Read the saved record back with `coflow report show --id REPORT_ID`.

```json
{
  "source_id": "example-delivery-20261128",
  "project_id": "PROJECT_ID",
  "todo_ids": ["TODO_ID"],
  "title": "Completed checkout copy review",
  "body": "Reviewed the error messages. The remaining address change is ready for review.",
  "status": "progress"
}
```

Use the same `source_id` for a correction or a retry of that report. Assign a fresh one for a distinct update. For Todo, Calendar and Context changes, read the current record and pass the required revision and operation ID shown in the command help. Keep the same payload and operation ID when retrying an uncertain write. A conflict means something changed in CoFlow. Read the new state, reconcile the differences and submit a revised request. Commands that accept `--file` also accept `--file -` to read a JSON object from standard input.

## When a person must confirm in the browser

Some commands create a draft that must be executed from the web session. The [command list](cli-commands.md) marks these Browser and `coflow help --json` reports `confirmation: "browser"`. For example:

```sh
coflow calendar reschedule --file changes.json --prepare
```

Paste the draft into **Agent credentials → Review CLI request** or open that page through **Account menu → CLI access**. The person reviews the account, space, operation and inputs before execution. Verify the result in CoFlow. A prepared draft alone means no business write has occurred. Keep drafts that include private data on the intended machine and CoFlow instance.

## Use it from an agent

- Start with `coflow whoami --json`. Report the actual workspace and user before acting, and stop if they differ from the user's intended target.
- Use `coflow help COMMAND --json` to discover required inputs, scopes and confirmation. Use `--non-interactive` for automation. If a person must authorize an action, say what they need to approve and where.
- Read successful JSON on stdout and machine-readable errors on stderr. Use the exit status and `code`, then use `next_steps` to recover. For conflicts, refresh the record. For an uncertain write, check whether it already landed before retrying. A missing permission requires the right grant and the underlying object access.
- Explain results in plain language. Tell the user what you read, what CoFlow saved and what still needs a person. For HTTP fallback, use the served OpenAPI contract and the same verified identity and permissions.

Example request to an agent:

> Use the CoFlow Skill and CLI for this project. Check which account and space you are using, then read the task and its handoff. After the work is done, add a progress report linked to the task and read it back. If a newer edit conflicts with yours, show me the difference. If CoFlow asks for browser approval, tell me exactly where to review it.
