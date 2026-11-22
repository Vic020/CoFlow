package httpapi

import (
	"bytes"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestStatisticsDeliveryLoopAndIsolation(t *testing.T) {
	args := map[string]any{}
	owner, guest, repo := assistantFixture(t, "propose_context", args)
	project := owner.call("POST", "/api/v1/catalog/project", map[string]any{"name": "Synthetic acceptance project", "state": "active"}, 201)["id"].(string)
	domain := owner.call("POST", "/api/v1/catalog/domain", map[string]any{"name": "Synthetic delivery", "state": "active"}, 201)["name"].(string)
	member := guest.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"].(string)
	taskInput := map[string]any{"title": "Synthetic reviewed delivery", "column_id": "doing", "project_id": project, "domains": []string{domain}, "assignee_id": member, "source_id": "acceptance-loop", "operation_id": store.ID()}
	task := owner.call("POST", "/api/v1/todos", taskInput, 200)
	id := task["id"].(string)
	if owner.call("POST", "/api/v1/todos", taskInput, 200)["id"] != id {
		t.Fatal("duplicate task")
	}
	report := owner.call("POST", "/api/v1/reports", map[string]any{"title": "Synthetic delivery evidence", "body": "Reviewed acceptance criteria and implementation.", "source_id": "acceptance-report", "status": "delivered", "project_id": project, "domains": []string{domain}, "todo_ids": []string{id}}, 200)
	task = owner.call("GET", "/api/v1/todos/"+id, nil, 200)
	schedule := map[string]any{"kind": "date-range", "start_date": time.Now().UTC().Format("2006-01-02"), "end_date": time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02")}
	task = guest.call("PATCH", "/api/v1/todos/"+id, map[string]any{"schedule": schedule, "expected_revision": task["revision"], "operation_id": store.ID()}, 200)
	owner.call("PATCH", "/api/v1/todos/"+id, map[string]any{"title": "Conflicting stale update", "expected_revision": 1, "operation_id": store.ID()}, 409)
	board := owner.call("GET", "/api/v1/todo-board", nil, 200)
	task = guest.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "complete", "expected_revision": task["revision"], "board_revision": board["revision"], "operation_id": store.ID()}, 200)
	args["knowledge"] = map[string]any{"title": "Synthetic verified delivery rule", "body": "Read evidence before accepting a delivery.", "kind": "rule", "visibility": "team", "project_id": project, "domains": []string{domain}, "sources": []any{map[string]any{"kind": "todo", "id": id, "revision": strconv.Itoa(int(task["revision"].(float64))), "quote": "Reviewed delivery"}, map[string]any{"kind": "report", "id": report["id"], "quote": "Acceptance evidence"}}}
	config := configureAI(owner, "personal")
	response := owner.call("POST", "/api/v1/assistant/chat", map[string]any{"config_id": config, "request_id": store.ID(), "message": "Remember this delivery rule"}, 200)
	actions := response["turn"].(map[string]any)["actions"].([]any)
	if len(actions) != 1 {
		t.Fatal(response)
	}
	actionID := actions[0].(map[string]any)["id"].(string)
	result := owner.call("POST", "/api/v1/assistant/actions/"+actionID, map[string]any{"decision": "confirm"}, 200)["result"].(map[string]any)
	entry := owner.call("GET", "/api/v1/context/"+result["id"].(string), nil, 200)
	confirm := knowledgePatch(entry, "confirm")
	confirm["state"] = "active"
	entry = owner.call("PATCH", "/api/v1/context/"+entry["id"].(string), confirm, 200)
	if entry["state"] != "active" || len(entry["sources"].([]any)) != 2 {
		t.Fatal("knowledge confirmation/source chain", entry)
	}
	// A new assistant conversation must retrieve the same confirmed knowledge.
	toolOutput := ""
	changeModel := func(name string, arguments map[string]any) {
		owner.h = NewWithConfig(repo, Config{Identity: identity.New(repo.Pool()), AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
			body, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(body))
			var payload struct {
				Messages []struct{ Role, Content string }
			}
			_ = json.Unmarshal(body, &payload)
			if len(payload.Messages) > 0 {
				last := payload.Messages[len(payload.Messages)-1]
				if last.Role == "tool" {
					toolOutput = last.Content
				}
			}
			return fakeModel(name, arguments).Transport.RoundTrip(r)
		})}})
		guest.h = owner.h
	}
	changeModel("find_context", map[string]any{"project_id": project, "q": "Synthetic verified"})
	read := owner.call("POST", "/api/v1/assistant/chat", map[string]any{"config_id": config, "request_id": store.ID(), "message": "Recall the confirmed rule in a new conversation"}, 200)
	raw, _ := json.Marshal(read)
	if !strings.Contains(string(raw), entry["id"].(string)) {
		t.Fatal("new conversation lost sourced knowledge", read)
	}
	now := time.Now().UTC()
	query := url.Values{"from": {now.AddDate(0, 0, -6).Format("2006-01-02")}, "to": {now.AddDate(0, 0, 1).Format("2006-01-02")}, "timezone": {"UTC"}, "project": {project}, "domain": {domain}, "metric": {"todos_completed"}}
	path := "/api/v1/statistics?" + query.Encode()
	stats := owner.call("GET", path, nil, 200)
	count := func(v map[string]any, k string) float64 {
		for _, m := range v["metrics"].([]any) {
			x := m.(map[string]any)
			if x["key"] == k {
				return x["count"].(float64)
			}
		}
		return -1
	}
	if count(stats, "todos_completed") != 1 || count(stats, "reports_created") != 1 || len(stats["details"].([]any)) != 1 {
		t.Fatal("ledger mismatch", stats)
	}
	// Model and web use the same service and exact scope; no extra action is created.
	changeModel("read_statistics", map[string]any{"from": query.Get("from"), "to": query.Get("to"), "timezone": "UTC", "project_id": project, "domain": domain, "metric": "todos_completed"})
	ai := owner.call("POST", "/api/v1/assistant/chat", map[string]any{"config_id": config, "request_id": store.ID(), "message": "Read the actual delivery statistics"}, 200)
	raw, _ = json.Marshal(ai)
	if !strings.Contains(string(raw), "read_statistics") || !strings.Contains(toolOutput, id) {
		t.Fatal("assistant stats sources", ai)
	}
	if len(ai["turn"].(map[string]any)["actions"].([]any)) != 0 {
		t.Fatal("statistics produced write")
	}
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Synthetic stats reader", "scopes": []string{"todos:read"}}, 201)["credential"].(string)
	agent := &authClient{t: t, h: owner.h, token: token}
	limited := agent.call("GET", path, nil, 200)
	raw, _ = json.Marshal(limited)
	if count(limited, "reports_created") != -1 || strings.Contains(string(raw), report["id"].(string)) {
		t.Fatal("read scope leak", limited)
	}
	guest.call("GET", path, nil, 200)
	// Switching to an independently bootstrapped team cannot see rows or totals.
	otherRepo, otherIdentity := identityFixture(t)
	other := &authClient{t: t, h: NewWithConfig(otherRepo, Config{Identity: otherIdentity, BootstrapToken: testBootstrapToken})}
	other.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "stats-other@example.test", "name": "Other", "password": "synthetic-password-123", "team_name": "Other team"}, 201)
	foreign := other.call("GET", path, nil, 200)
	if count(foreign, "todos_completed") != 0 || count(foreign, "reports_created") != 0 {
		t.Fatal("cross team aggregate leak")
	}
	// Paging rejects stale data rather than silently combining snapshots.
	query.Set("revision", stats["revision"].(string))
	owner.call("POST", "/api/v1/todos", map[string]any{"source_id": store.ID(), "title": "New synthetic task", "column_id": "backlog", "project_id": project, "domains": []string{domain}, "operation_id": store.ID()}, 200)
	owner.call("GET", "/api/v1/statistics?"+query.Encode(), nil, 409)
	// Source deletion is reflected consistently in counts and detail.
	owner.call("DELETE", "/api/v1/reports/"+report["id"].(string), map[string]any{"expected_updated_at": report["updated_at"]}, 200)
	query.Del("revision")
	gone := owner.call("GET", "/api/v1/statistics?"+query.Encode(), nil, 200)
	if count(gone, "reports_created") != 0 {
		t.Fatal("deleted source counted")
	}
}

func TestStatisticsLargeBoardReadOnly(t *testing.T) {
	owner, _, repo := assistantFixture(t, "read_workspace", nil)
	meta := owner.call("GET", "/api/v1/meta", nil, 200)
	team := meta["team"].(map[string]any)["id"].(string)
	now := time.Now().UTC()
	started := now.Add(-48 * time.Hour)
	finished := now.Add(-24 * time.Hour)
	board := workspace.TodoBoard{Revision: 1, Columns: []workspace.TodoColumn{{ID: "backlog"}, {ID: "done", Done: true}}, Tasks: []workspace.Todo{}}
	for i := 0; i < 5000; i++ {
		first := workspace.Todo{ID: fmt.Sprintf("synthetic-%05d", i), Title: "Synthetic capacity sample", CreatedAt: started, ColumnID: "backlog", ProjectID: "sample", AssigneeID: "synthetic-member", Domains: []string{"code", "design"}}
		done := first
		done.ColumnID = "done"
		done.CompletedAt = &finished
		rawFirst, _ := json.Marshal(first)
		rawDone, _ := json.Marshal(done)
		done.History = []workspace.TodoEvent{{CreatedAt: started, Before: json.RawMessage(`{}`), After: rawFirst}, {CreatedAt: finished, Before: rawFirst, After: rawDone}}
		board.Tasks = append(board.Tasks, done)
	}
	raw, _ := json.Marshal(board)
	if _, e := repo.Pool().Exec(t.Context(), `INSERT INTO todo_boards(team_id,document) VALUES($1,$2) ON CONFLICT(team_id) DO UPDATE SET document=EXCLUDED.document`, team, raw); e != nil {
		t.Fatal(e)
	}
	var before string
	if e := repo.Pool().QueryRow(t.Context(), `SELECT md5(document::text) FROM todo_boards WHERE team_id=$1`, team).Scan(&before); e != nil {
		t.Fatal(e)
	}
	query := url.Values{"from": {now.AddDate(0, 0, -6).Format("2006-01-02")}, "to": {now.AddDate(0, 0, 1).Format("2006-01-02")}, "timezone": {"UTC"}, "metric": {"todos_completed"}}
	at := time.Now()
	v := owner.call("GET", "/api/v1/statistics?"+query.Encode(), nil, 200)
	elapsed := time.Since(at)
	if v["detail_total"].(float64) != 5000 || len(v["details"].([]any)) != 50 || v["has_more"] != true || v["duration"].(map[string]any)["one_to_seven_days"].(float64) != 5000 {
		t.Fatal("large sample count/page/cycle mismatch")
	}
	var after string
	if e := repo.Pool().QueryRow(t.Context(), `SELECT md5(document::text) FROM todo_boards WHERE team_id=$1`, team).Scan(&after); e != nil || before != after {
		t.Fatal("statistics mutated board", e)
	}
	t.Logf("5000 tasks / 10000 snapshots, board JSON %.2f MiB, complete HTTP read %.3f seconds (local isolated PostgreSQL; instrumentation follows test command)", float64(len(raw))/(1024*1024), elapsed.Seconds())
}
