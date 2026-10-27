package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestTodoTeamLifecycleAndReportTransaction(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s, BootstrapToken: testBootstrapToken})
	owner := &authClient{t: t, h: h}
	guest := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "todo-owner@example.test", "name": "Owner", "password": "synthetic-owner-password", "team_name": "Synthetic Todo"}, 201)
	inv := owner.call("POST", "/api/v1/invites", map[string]any{"email": "todo-guest@example.test"}, 201)
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": inv["token"], "name": "Guest", "password": "synthetic-guest-password"}, 200)
	gid := guest.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"]
	token := func(scopes []string) *authClient {
		return &authClient{t: t, h: h, token: owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Synthetic Agent", "scopes": scopes}, 201)["credential"].(string)}
	}
	old := token([]string{"reports:read", "reports:write"})
	old.call("GET", "/api/v1/todo-board", nil, 403)
	agent := token([]string{"todos:read", "todos:write", "comments:write"})
	agent.call("GET", "/api/v1/meta", nil, 200)
	agent.call("GET", "/api/v1/reports", nil, 403)
	agent.call("POST", "/api/v1/todo-columns", map[string]any{"name": "Forbidden"}, 403)
	b := owner.call("GET", "/api/v1/todo-board", nil, 200)
	if len(b["columns"].([]any)) != 4 {
		t.Fatal("default columns")
	}
	create := map[string]any{"title": "Synthetic task", "column_id": "backlog", "source_id": "task-1", "operation_id": "create-1", "assignee_id": gid, "domains": []string{"研发"}, "due_date": "2026-10-27"}
	task := agent.call("POST", "/api/v1/todos", create, 200)
	id := task["id"].(string)
	again := agent.call("POST", "/api/v1/todos", create, 200)
	if again["id"] != id || again["revision"] != task["revision"] {
		t.Fatal("create replay")
	}
	create["title"] = "Different payload"
	agent.call("POST", "/api/v1/todos", create, 409)
	create["operation_id"] = "other-create"
	if v := agent.call("POST", "/api/v1/todos", create, 200); v["id"] != id {
		t.Fatal("source dedupe")
	}
	create["source_id"] = "different-source"
	agent.call("POST", "/api/v1/todos", create, 409)
	// Assignee may edit and comment; a stale request cannot overwrite their change.
	edit := map[string]any{"title": "Guest revision", "priority": "high", "operation_id": "edit-guest", "expected_revision": task["revision"]}
	task = guest.call("PATCH", "/api/v1/todos/"+id, edit, 200)
	agent.call("PATCH", "/api/v1/todos/"+id, map[string]any{"title": "stale", "operation_id": "stale", "expected_revision": 1}, 409)
	task = guest.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "comment", "body": "Synthetic comment", "mentions": []any{gid}, "operation_id": "comment", "expected_revision": task["revision"]}, 200)
	comment := task["comments"].([]any)[0].(map[string]any)
	agent.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "delete-comment", "comment_id": comment["id"], "expected_revision": task["revision"], "operation_id": "delete-agent"}, 403)
	both := token([]string{"reports:read", "reports:write", "todos:read", "todos:write", "comments:write"})
	brief := map[string]any{"source_id": "joint-report", "title": "Synthetic progress", "agent": "Codex", "todo_ids": []string{id}, "todo_moves": []any{map[string]any{"id": id, "column_id": "review", "expected_revision": 1}}, "operation_id": "joint-1", "mentions": []any{gid}}
	both.call("POST", "/api/v1/reports", brief, 409)
	if n := len(owner.call("GET", "/api/v1/reports", nil, 200)["items"].([]any)); n != 0 {
		t.Fatal("failed joint write committed report")
	}
	brief["todo_moves"] = []any{map[string]any{"id": id, "column_id": "review", "expected_revision": task["revision"]}}
	report := both.call("POST", "/api/v1/reports", brief, 200)
	rid := report["id"].(string)
	updated := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
	if updated["column_id"] != "review" {
		t.Fatal("joint move")
	}
	repeated := both.call("POST", "/api/v1/reports", brief, 200)
	if repeated["id"] != rid {
		t.Fatal("report retry duplicated")
	}
	if owner.call("GET", "/api/v1/todos/"+id, nil, 200)["revision"] != updated["revision"] {
		t.Fatal("joint retry moved again")
	}
	if len(owner.call("GET", "/api/v1/reports/"+rid, nil, 200)["todo_ids"].([]any)) != 1 {
		t.Fatal("reverse link")
	}
	// Author-only report writes must not grant task scope.
	old.call("POST", "/api/v1/reports", brief, 403)
	b = owner.call("GET", "/api/v1/todo-board", nil, 200)
	complete := map[string]any{"action": "complete", "operation_id": "complete", "expected_revision": updated["revision"], "board_revision": b["revision"]}
	updated = guest.call("PATCH", "/api/v1/todos/"+id, complete, 200)
	if updated["completed_at"] == nil {
		t.Fatal("completion missing")
	}
	b = owner.call("GET", "/api/v1/todo-board", nil, 200)
	updated = guest.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "reopen", "operation_id": "reopen", "expected_revision": updated["revision"], "board_revision": b["revision"]}, 200)
	if updated["completed_at"] != nil || updated["column_id"] != "review" {
		t.Fatal("reopen")
	}
	owner.call("DELETE", "/api/v1/reports/"+rid, map[string]any{"expected_updated_at": repeated["updated_at"]}, 200)
	if refs := owner.call("GET", "/api/v1/todos/"+id, nil, 200)["report_ids"].([]any); len(refs) != 0 {
		t.Fatal("deleted report reference exposed")
	}
	if owner.call("GET", "/api/v1/todos/"+id, nil, 200)["unavailable_reports"] != float64(1) {
		t.Fatal("deleted report placeholder missing")
	}
	owner.call("POST", "/api/v1/reports/"+rid+"/restore", map[string]any{}, 200)
	coll := owner.call("POST", "/api/v1/collaborations", map[string]any{"report_id": rid, "assignee_id": gid, "title": "Synthetic follow-up"}, 201)
	cid := coll["id"].(string)
	transferred := guest.call("POST", "/api/v1/collaborations/"+cid+"/todo", map[string]any{"column_id": "backlog"}, 200)
	if guest.call("POST", "/api/v1/collaborations/"+cid+"/todo", map[string]any{"column_id": "backlog"}, 200)["id"] != transferred["id"] {
		t.Fatal("transfer duplicate")
	}
	guest.call("PATCH", "/api/v1/collaborations/"+cid, map[string]any{"status": "done"}, 404)
	linked := map[string]any{"source_id": "linked-only", "title": "Linked-only progress", "todo_ids": []string{id}}
	both.call("POST", "/api/v1/reports", linked, 200)
	taskBefore := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
	both.call("POST", "/api/v1/reports", linked, 200)
	if owner.call("GET", "/api/v1/todos/"+id, nil, 200)["revision"] != taskBefore["revision"] {
		t.Fatal("identical linked report changed task history")
	}
	// Another team cannot read the task, move its columns or reference its report.
	other := owner.call("POST", "/api/v1/teams", map[string]any{"name": "Other synthetic team"}, 201)
	_ = other
	owner.call("GET", "/api/v1/todos/"+id, nil, 404)
	owner.call("POST", "/api/v1/reports", map[string]any{"source_id": "foreign", "title": "Foreign link", "todo_ids": []string{id}}, 404)
}
func TestTodoOrderingMigrationAndConcurrentEdits(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s, BootstrapToken: testBootstrapToken})
	a := &authClient{t: t, h: h}
	a.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "sort@example.test", "name": "Sort", "password": "synthetic-sort-password", "team_name": "Sorting"}, 201)
	ids := []string{}
	for i := 0; i < 3; i++ {
		v := a.call("POST", "/api/v1/todos", map[string]any{"title": fmt.Sprint(i), "column_id": "backlog", "source_id": fmt.Sprint(i), "operation_id": fmt.Sprint(i)}, 200)
		ids = append(ids, v["id"].(string))
	}
	b := a.call("GET", "/api/v1/todo-board", nil, 200)
	a.call("PATCH", "/api/v1/todos/"+ids[2], map[string]any{"action": "move", "column_id": "backlog", "before_id": ids[0], "expected_revision": 1, "board_revision": b["revision"], "operation_id": "filtered-move"}, 200)
	xs := a.call("GET", "/api/v1/todos?column=backlog&limit=1", nil, 200)
	if xs["items"].([]any)[0].(map[string]any)["id"] != ids[2] || xs["total"] != float64(3) {
		t.Fatal("anchor ordering or pagination")
	}
	next := a.call("GET", "/api/v1/todos?column=backlog&cursor="+xs["next_cursor"].(string), nil, 200)
	if next["items"].([]any)[0].(map[string]any)["id"] != ids[0] {
		t.Fatal("hidden task order changed")
	}
	b = a.call("GET", "/api/v1/todo-board", nil, 200)
	a.call("PATCH", "/api/v1/todo-columns/backlog", map[string]any{"action": "archive", "target_id": "doing", "expected_revision": 1, "board_revision": b["revision"], "operation_id": "archive-column"}, 200)
	for _, id := range ids {
		if a.call("GET", "/api/v1/todos/"+id, nil, 200)["column_id"] != "doing" {
			t.Fatal("archive migration lost task")
		}
	}
	// Exactly one same-revision edit wins. Use raw requests to keep test goroutines independent.
	task := a.call("GET", "/api/v1/todos/"+ids[0], nil, 200)
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			raw, _ := json.Marshal(map[string]any{"title": fmt.Sprintf("Concurrent %d", i), "expected_revision": task["revision"], "operation_id": fmt.Sprintf("concurrent-%d", i)})
			r := httptest.NewRequest("PATCH", "/api/v1/todos/"+ids[0], bytes.NewReader(raw))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(a.cookie)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			codes <- w.Code
		}(i)
	}
	wg.Wait()
	close(codes)
	success, conflicts := 0, 0
	for code := range codes {
		if code == 200 {
			success++
		} else if code == 409 {
			conflicts++
		} else {
			t.Fatalf("unexpected status %d", code)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal("concurrent updates silently overwrote")
	}
}
