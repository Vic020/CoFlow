package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"coflow/api/internal/identity"
)

func TestCLIDeviceAuthorization(t *testing.T) {
	repo, service := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: service, BootstrapToken: testBootstrapToken})
	owner := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{
		"email": "cli-owner@example.test", "name": "CLI Owner",
		"password": "synthetic-test-password", "team_name": "CLI Test",
	}, 201)
	form := func(path string, values url.Values, status int) map[string]any {
		t.Helper()
		r := httptest.NewRequest(http.MethodPost, "/api/v1/oauth/"+path, strings.NewReader(values.Encode()))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s returned %d, want %d", path, w.Code, status)
		}
		var out map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	start := func() (code, device string) {
		r := form("device", url.Values{"client_id": {"coflow-cli"}, "scope": {"todos:read"}, "days": {"2"}}, 200)
		return r["user_code"].(string), r["device_code"].(string)
	}
	poll := func(device, expected string, status int) map[string]any {
		t.Helper()
		out := form("token", url.Values{"client_id": {"coflow-cli"}, "grant_type": {deviceGrant}, "device_code": {device}}, status)
		if expected != "" && out["error"] != expected {
			t.Fatalf("want %s, got %v", expected, out["error"])
		}
		return out
	}
	review := func(code string) map[string]any {
		return owner.call("POST", "/api/v1/cli/device/review", map[string]any{"code": code}, 200)
	}
	decision := func(code string, review map[string]any, approve bool, status int) {
		owner.call("POST", "/api/v1/cli/device/decision", map[string]any{
			"code": code, "user_id": review["user_id"], "team_id": review["team_id"], "approve": approve,
		}, status)
	}
	updateClock := func(device, sql string) {
		t.Helper()
		if _, err := repo.Pool().Exec(t.Context(), "UPDATE cli_device_requests SET "+sql+" WHERE device_hash=$1", identity.Hash(device)); err != nil {
			t.Fatal(err)
		}
	}

	code, device := start()
	poll(device, "authorization_pending", 400)
	poll(device, "slow_down", 400)
	pending := review(code)
	otherTeam := owner.call("POST", "/api/v1/teams", map[string]any{"name": "Other CLI Space"}, 201)["id"]
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": otherTeam}, 200)
	decision(code, pending, true, 409)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": pending["team_id"]}, 200)
	decision(code, pending, true, 200)
	updateClock(device, "next_poll_at=now()")
	out := poll(device, "", 200)
	if out["team_id"] != pending["team_id"] || out["user_id"] != pending["user_id"] || out["scope"] != "todos:read" {
		t.Fatal("grant changed identity or scope")
	}
	poll(device, "expired_token", 400)
	cli := &authClient{t: t, h: h, token: out["access_token"].(string)}
	cli.call("GET", "/api/v1/todos", nil, 200)
	cli.call("GET", "/api/v1/reports", nil, 403)
	cli.call("POST", "/api/v1/cli/device/review", map[string]any{"code": code}, 403)
	cli.call("POST", "/api/v1/cli/revoke", nil, 200)
	cli.call("GET", "/api/v1/todos", nil, 401)

	code, device = start()
	decision(code, review(code), false, 200)
	poll(device, "access_denied", 400)
	code, device = start()
	updateClock(device, "expires_at=now()")
	owner.call("POST", "/api/v1/cli/device/review", map[string]any{"code": code}, 404)
	poll(device, "expired_token", 400)

	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Scoped CLI task", "column_id": "backlog", "source_id": "scope-task", "operation_id": "create-scope-task", "project_id": "general"}, 200)
	other := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Another task", "column_id": "backlog", "source_id": "outside-task", "operation_id": "create-outside-task"}, 200)
	grant := form("device", url.Values{"client_id": {"coflow-cli"}, "scope": {"todos:read todos:write"}, "team_id": {pending["team_id"].(string)}, "todo_id": {task["id"].(string)}}, 200)
	code, device = grant["user_code"].(string), grant["device_code"].(string)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": otherTeam}, 200)
	owner.call("POST", "/api/v1/cli/device/review", map[string]any{"code": code}, 404)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": pending["team_id"]}, 200)
	scoped := review(code)
	if scoped["todo_id"] != task["id"] {
		t.Fatal("scope was not shown for review")
	}
	decision(code, scoped, true, 200)
	out = poll(device, "", 200)
	cli.token = out["access_token"].(string)
	items := cli.call("GET", "/api/v1/todos", nil, 200)["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["id"] != task["id"] {
		t.Fatal("task scope was not enforced on list")
	}
	taskPath := "/api/v1/todos/" + task["id"].(string)
	otherPath := "/api/v1/todos/" + other["id"].(string)
	update := map[string]any{"action": "edit", "title": "Updated by CLI", "operation_id": "scoped-edit", "expected_revision": task["revision"]}
	cli.call("PATCH", otherPath, update, 404)
	cli.call("GET", otherPath, nil, 404)
	cli.call("GET", "/api/v1/calendar/schedule", nil, 403)
	update["project_id"] = "general"
	cli.call("PATCH", taskPath, update, 403)
	delete(update, "project_id")
	cli.call("PATCH", taskPath, update, 200)
	events := owner.call("GET", taskPath, nil, 200)["history"].([]any)
	if events[len(events)-1].(map[string]any)["grant_id"] != out["grant_id"] {
		t.Fatal("CLI grant was not recorded in task history")
	}
	r := httptest.NewRequest("GET", "/api/v1/auth/preferences", nil)
	r.AddCookie(owner.cookie)
	r.Header.Set("X-CoFlow-CLI-User", pending["user_id"].(string))
	r.Header.Set("X-CoFlow-CLI-Team", otherTeam.(string))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 409 {
		t.Fatal("browser review did not check the expected identity")
	}

	batchPath := "/api/v1/todo-schedules/batch"
	batch := map[string]any{"operation_id": "batch-1", "changes": []map[string]any{
		{"id": task["id"], "expected_revision": events[len(events)-1].(map[string]any)["after"].(map[string]any)["revision"],
			"schedule": map[string]any{"kind": "date-range", "start_date": "2026-11-28", "end_date": "2026-11-29"}},
		{"id": other["id"], "expected_revision": 999, "schedule": nil},
	}}
	cli.call("POST", batchPath, batch, 403)
	owner.call("POST", batchPath, batch, 409)
	if got := owner.call("GET", taskPath, nil, 200)["schedule"]; got != nil {
		t.Fatal("failed batch left a task changed")
	}
	batch["changes"].([]map[string]any)[1]["expected_revision"] = other["revision"]
	firstBatch := owner.call("POST", batchPath, batch, 200)
	replayBatch := owner.call("POST", batchPath, batch, 200)
	if len(firstBatch["items"].([]any)) != 2 || len(replayBatch["items"].([]any)) != 2 {
		t.Fatal("batch did not update both tasks")
	}

	projectGrant := form("device", url.Values{"client_id": {"coflow-cli"}, "scope": {"todos:read"}, "team_id": {pending["team_id"].(string)}, "project_id": {"general"}}, 200)
	code, device = projectGrant["user_code"].(string), projectGrant["device_code"].(string)
	projectReview := review(code)
	if projectReview["project_id"] != "general" {
		t.Fatal("project scope was not shown for review")
	}
	decision(code, projectReview, true, 200)
	cli.token = poll(device, "", 200)["access_token"].(string)
	cli.call("GET", taskPath, nil, 200)
	cli.call("GET", otherPath, nil, 404)
	cli.call("PATCH", taskPath, update, 403)

}
