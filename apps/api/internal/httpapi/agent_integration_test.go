package httpapi

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
	"fmt"
	"net/url"
	"testing"
	"time"
)

func TestAgentChangesAndHandoffIsolation(t *testing.T) {
	owner, guest, _ := assistantFixture(t, "read_workspace", nil)
	token := func(c *authClient, scopes ...string) *authClient {
		return &authClient{t: t, h: c.h, token: c.call("POST", "/api/v1/tokens", map[string]any{"name": "Synthetic collaboration", "scopes": scopes}, 201)["credential"].(string)}
	}
	agent := token(owner, "todos:read", "todos:write", "comments:write")
	other := token(guest, "todos:read")
	agent.call("GET", "/api/v1/agent/context", nil, 400)
	baseline := agent.call("GET", "/api/v1/agent/changes", nil, 200)
	cursor := baseline["next_cursor"].(string)
	if len(baseline["items"].([]any)) != 0 || baseline["baseline"] != true {
		t.Fatal("baseline must not replay old history")
	}
	task := agent.call("POST", "/api/v1/todos", map[string]any{"title": "Synthetic resumable work", "body": "Acceptance: reviewed evidence.", "column_id": "backlog", "operation_id": store.ID(), "source_id": "resumable"}, 200)
	id := task["id"].(string)
	report := owner.call("POST", "/api/v1/reports", map[string]any{"source_id": "handoff-evidence", "title": "Synthetic progress", "body": "Evidence", "todo_ids": []string{id}, "status": "progress"}, 200)
	// A todos-only token must not receive report invalidations or linked report content.
	page := agent.call("GET", "/api/v1/agent/changes?limit=1&cursor="+url.QueryEscape(cursor), nil, 200)
	for _, v := range page["items"].([]any) {
		if v.(map[string]any)["kind"] != "todo" {
			t.Fatal("scope leaked")
		}
	}
	h := agent.call("GET", "/api/v1/agent/context?todo="+id, nil, 200)
	if _, ok := h["reports"]; ok {
		t.Fatal("report content leaked")
	}
	items := h["tasks"].(map[string]any)["items"].([]any)
	if len(items) != 1 || len(items[0].(map[string]any)["report_ids"].([]any)) != 0 {
		t.Fatal("handoff task/ref isolation")
	}
	owner.call("POST", "/api/v1/reports/"+report["id"].(string)+"/comments", map[string]any{"body": "Please review this evidence"}, 201)
	full := owner.call("GET", "/api/v1/agent/context?todo="+id, nil, 200)
	if len(full["reports"].(map[string]any)["items"].([]any)) != 1 {
		t.Fatal("linked evidence missing")
	}
	other.call("GET", "/api/v1/agent/changes?cursor="+url.QueryEscape(cursor), nil, 400)
	// Cursor is also bound to permissions and project selection.
	owner.call("GET", "/api/v1/agent/changes?cursor="+url.QueryEscape(cursor), nil, 400)
	agent.call("GET", "/api/v1/agent/changes?project=different&cursor="+url.QueryEscape(cursor), nil, 400)
	agent.call("GET", "/api/v1/agent/changes?limit=oops", nil, 400)
	foreignRepo, foreignIdentity := identityFixture(t)
	foreign := &authClient{t: t, h: NewWithConfig(foreignRepo, Config{Identity: foreignIdentity, BootstrapToken: testBootstrapToken})}
	foreign.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "foreign-agent@example.test", "name": "Foreign", "password": "synthetic-password-123", "team_name": "Other team"}, 201)
	foreign.call("GET", "/api/v1/agent/context?todo="+id, nil, 404)
	// Continue paging until empty; no human inbox acknowledgement is made.
	for page["has_more"] == true {
		page = agent.call("GET", "/api/v1/agent/changes?limit=1&cursor="+url.QueryEscape(page["next_cursor"].(string)), nil, 200)
	}
	empty := agent.call("GET", "/api/v1/agent/changes?cursor="+url.QueryEscape(page["next_cursor"].(string)), nil, 200)
	if len(empty["items"].([]any)) != 0 {
		t.Fatal("unchanged poll produced work")
	}
}

func TestAssistantTaskProgressConfirmation(t *testing.T) {
	for _, action := range []string{"move", "complete", "reopen", "assign", "comment"} {
		t.Run(action, func(t *testing.T) {
			args := map[string]any{"change_action": action, "column_id": "doing", "body": "Reviewed synthetic evidence"}
			owner, guest, repo := assistantFixture(t, "propose_task_change", args)
			gid := guest.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"]
			task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Progress QA", "column_id": "backlog", "operation_id": store.ID(), "source_id": "task-progress"}, 200)
			id := task["id"].(string)
			if action == "reopen" {
				b := owner.call("GET", "/api/v1/todo-board", nil, 200)
				task = owner.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "complete", "expected_revision": task["revision"], "board_revision": b["revision"], "operation_id": store.ID()}, 200)
			}
			b := owner.call("GET", "/api/v1/todo-board", nil, 200)
			args["todo_id"] = id
			args["expected_revision"] = task["revision"]
			args["board_revision"] = b["revision"]
			args["assignee_id"] = gid
			config := configureAI(owner, "personal")
			v := proposal(owner, config)
			card := v["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)
			unchanged := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
			if unchanged["revision"] != task["revision"] {
				t.Fatal("proposal executed before confirmation")
			}
			endpoint := "/api/v1/assistant/actions/" + card["id"].(string)
			result := owner.call("POST", endpoint, map[string]any{"decision": "confirm"}, 200)
			if result["state"] != "done" {
				t.Fatalf("confirmation failed: %v", result)
			}
			// Simulate a lost response after the business write committed but before action state persisted.
			if action == "comment" {
				if _, e := repo.Pool().Exec(t.Context(), `UPDATE assistant_actions SET state='pending',result=NULL WHERE id=$1`, card["id"]); e != nil {
					t.Fatal(e)
				}
			}
			owner.call("POST", endpoint, map[string]any{"decision": "confirm"}, 200)
			after := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
			history := after["history"].([]any)
			if history[len(history)-1].(map[string]any)["agent"] != "CoFlow Assistant" {
				t.Fatal("trusted assistant source missing from original history")
			}
			if after["revision"].(float64) != task["revision"].(float64)+1 {
				t.Fatal("retry duplicated task operation")
			}
			switch action {
			case "move":
				if after["column_id"] != "doing" {
					t.Fatal("move")
				}
			case "complete":
				if after["completed_at"] == nil {
					t.Fatal("complete")
				}
			case "reopen":
				if after["completed_at"] != nil {
					t.Fatal("reopen")
				}
			case "assign":
				if after["assignee_id"] != gid {
					t.Fatal("assign")
				}
			case "comment":
				if len(after["comments"].([]any)) != 1 {
					t.Fatal("comment")
				}
			}
		})
	}
}

func TestAssistantTaskChangeRejectsHumanConflict(t *testing.T) {
	args := map[string]any{"change_action": "complete"}
	owner, _, _ := assistantFixture(t, "propose_task_change", args)
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Conflict QA", "column_id": "backlog", "source_id": "conflict-progress", "operation_id": store.ID()}, 200)
	id := task["id"].(string)
	b := owner.call("GET", "/api/v1/todo-board", nil, 200)
	args["todo_id"] = id
	args["expected_revision"] = task["revision"]
	args["board_revision"] = b["revision"]
	result := proposal(owner, configureAI(owner, "personal"))
	card := result["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)
	owner.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "edit", "title": "Human revised", "expected_revision": task["revision"], "operation_id": store.ID()}, 200)
	result = owner.call("POST", "/api/v1/assistant/actions/"+card["id"].(string), map[string]any{"decision": "confirm"}, 200)
	if result["state"] != "failed" {
		t.Fatal("stale proposal overwrote human update")
	}
	after := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
	if after["completed_at"] != nil || after["title"] != "Human revised" {
		t.Fatal("human state lost")
	}
}

func TestAgentFeedWaitsForBusinessCommit(t *testing.T) {
	owner, _, repo := assistantFixture(t, "read_workspace", nil)
	meta := owner.call("GET", "/api/v1/meta", nil, 200)
	team := meta["team"].(map[string]any)["id"].(string)
	uid := meta["current_user"].(string)
	baseline := owner.call("GET", "/api/v1/agent/changes", nil, 200)
	tx, e := repo.Pool().Begin(t.Context())
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(t.Context())
	if _, e = tx.Exec(t.Context(), `SELECT coflow_emit_change($1,'todo','synthetic-commit','','')`, team); e != nil {
		t.Fatal(e)
	}
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		ws := workspace.Service{Pool: repo.Pool()}
		out, e := ws.AgentChanges(t.Context(), identity.Principal{TeamID: team, UserID: uid, Kind: "session"}, "", baseline["next_cursor"].(string), 100)
		if e == nil && (len(out.Items) != 1 || out.Items[0].ObjectID != "synthetic-commit") {
			e = fmt.Errorf("committed event missing: %+v", out)
		}
		done <- e
	}()
	<-started
	select {
	case e := <-done:
		t.Fatalf("feed advanced past uncommitted transaction: %v", e)
	case <-time.After(40 * time.Millisecond):
	}
	if e = tx.Commit(t.Context()); e != nil {
		t.Fatal(e)
	}
	select {
	case e := <-done:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("feed did not resume after commit")
	}
}
