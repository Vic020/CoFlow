package httpapi

import (
	"bytes"
	"coflow/api/internal/assistant"
	"coflow/api/internal/identity"
	"coflow/api/internal/workspace"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestAssistantHistoryTemplatesAndIsolation(t *testing.T) {
	owner, guest, repo := assistantFixture(t, "find_todos", map[string]any{})
	config := configureAI(owner, "personal")
	ctx := context.Background()
	var team, user string
	repo.Pool().QueryRow(ctx, `SELECT team_id,owner_id FROM assistant_configs WHERE id=$1`, config).Scan(&team, &user)
	for i := 0; i < 35; i++ {
		_, e := repo.Pool().Exec(ctx, `INSERT INTO assistant_conversations(id,team_id,owner_id,config_id,title) VALUES($1,$2,$3,$4,$5)`, fmt.Sprintf("history_%02d", i), team, user, config, fmt.Sprintf("Searchable synthetic %02d", i))
		if e != nil {
			t.Fatal(e)
		}
	}
	page := owner.call("GET", "/api/v1/assistant/conversations?limit=30", nil, 200)
	if len(page["items"].([]any)) != 30 || page["next_cursor"] == "" {
		t.Fatal(page)
	}
	second := owner.call("GET", "/api/v1/assistant/conversations?limit=30&cursor="+page["next_cursor"].(string), nil, 200)
	if len(second["items"].([]any)) != 5 {
		t.Fatal(second)
	}
	owner.call("GET", "/api/v1/assistant/conversations?cursor=invalid", nil, 400)
	guest.call("PATCH", "/api/v1/assistant/conversations/history_00", map[string]any{"action": "rename", "title": "foreign", "expected_revision": 1}, 409)
	owner.call("PATCH", "/api/v1/assistant/conversations/history_00", map[string]any{"action": "rename", "title": "Renamed evidence", "expected_revision": 1}, 200)
	owner.call("PATCH", "/api/v1/assistant/conversations/history_00", map[string]any{"action": "archive", "expected_revision": 1}, 409)
	owner.call("PATCH", "/api/v1/assistant/conversations/history_00", map[string]any{"action": "archive", "expected_revision": 2}, 200)
	archived := owner.call("GET", "/api/v1/assistant/conversations?state=archived", nil, 200)
	if len(archived["items"].([]any)) != 1 {
		t.Fatal(archived)
	}
	owner.call("PATCH", "/api/v1/assistant/conversations/history_00", map[string]any{"action": "delete", "expected_revision": 3}, 200)
	owner.call("GET", "/api/v1/assistant/conversations/history_00", nil, 404)
	owner.call("PATCH", "/api/v1/assistant/conversations/history_00", map[string]any{"action": "restore", "expected_revision": 4}, 200)
	tmpl := map[string]any{"scope": "personal", "title": "Evidence review", "instructions": "Read {{project}}", "parameters": []any{map[string]any{"name": "project", "label": "Project", "required": true}}, "tools": []string{"find_todos"}}
	saved := owner.call("POST", "/api/v1/assistant/templates", tmpl, 200)
	tmpl["id"] = saved["id"]
	tmpl["revision"] = 1
	tmpl["instructions"] = "Second version {{project}}"
	owner.call("POST", "/api/v1/assistant/templates", tmpl, 200)
	svc := &assistant.Service{Pool: repo.Pool()}
	p := identity.Principal{TeamID: team, UserID: user, Kind: "session", Role: "admin"}
	old, e := svc.Template(ctx, p, saved["id"].(string), 1)
	if e != nil || old.Instructions != "Read {{project}}" {
		t.Fatal(old, e)
	}
	guest.call("POST", "/api/v1/assistant/templates", tmpl, 404) // no ownership; no mutation
	tmpl["id"] = ""
	tmpl["scope"] = "team"
	guest.call("POST", "/api/v1/assistant/templates", tmpl, 403)
	// Rendering requirements and tool policy are enforced by Go, not model text.
	owner.call("POST", "/api/v1/assistant/chat", map[string]any{"config_id": config, "request_id": "template-required", "message": "review", "template_id": saved["id"], "template_version": 1}, 400)
	turn := owner.call("POST", "/api/v1/assistant/chat", map[string]any{"config_id": config, "request_id": "template-pinned", "message": "review", "template_id": saved["id"], "template_version": 1, "parameters": map[string]string{"project": "Synthetic"}}, 200)
	_, e = repo.Pool().Exec(ctx, `UPDATE assistant_configs SET revision=revision+1 WHERE id=$1`, config)
	if e != nil {
		t.Fatal(e)
	}
	owner.call("POST", "/api/v1/assistant/chat", map[string]any{"config_id": config, "conversation_id": turn["conversation_id"], "request_id": "source-changed", "message": "Continue"}, 400)

}
func TestAssistantSchedulerDraftQuietRetriesAndRevocation(t *testing.T) {
	owner, _, repo := assistantFixture(t, "propose_report", map[string]any{"title": "Scheduled evidence", "body": "Synthetic only."})
	config := configureAI(owner, "personal")
	ctx := context.Background()
	var team, user string
	repo.Pool().QueryRow(ctx, `SELECT team_id,owner_id FROM assistant_configs WHERE id=$1`, config).Scan(&team, &user)
	p := identity.Principal{TeamID: team, UserID: user, Kind: "session", Role: "admin"}
	svc := &assistant.Service{Pool: repo.Pool(), Identity: identity.New(repo.Pool()), Workspace: &workspace.Service{Pool: repo.Pool()}, Repo: repo, Key: base64.StdEncoding.EncodeToString(make([]byte, 32)), Client: fakeModel("propose_report", map[string]any{"title": "Scheduled evidence", "body": "Synthetic only."}), Slots: make(chan struct{}, 3)}
	tmpl, e := svc.Template(ctx, p, "builtin-brief", 1)
	if e != nil {
		t.Fatal(e)
	}
	j, e := svc.SaveJob(ctx, p, assistant.Job{Title: "Weekday review", ConfigID: config, Template: tmpl, Context: assistant.PageContext{}, Prompt: "Review verified delivery", Locale: "en", Timezone: "UTC", LocalTime: "09:00", Weekdays: []int{1, 2, 3, 4, 5}, Enabled: true})
	if e != nil {
		t.Fatal(e)
	}
	due := func() {
		_, e = repo.Pool().Exec(ctx, `UPDATE assistant_jobs SET next_run_at=now()-interval '1 minute' WHERE id=$1`, j.ID)
		if e != nil {
			t.Fatal(e)
		}
		svc.Tick(ctx)
	}
	due()
	runs, e := svc.JobRuns(ctx, p, j.ID)
	if e != nil || len(runs) != 1 || runs[0].State != "draft" || runs[0].ConversationID == nil {
		t.Fatal(runs, e)
	}
	reports, _ := repo.List(ctx, team)
	if len(reports) != 0 {
		t.Fatal("draft auto published")
	}
	due()
	runs, _ = svc.JobRuns(ctx, p, j.ID)
	if len(runs) != 2 || runs[0].State != "unchanged" {
		t.Fatal(runs)
	}
	// Explicit publication is separately authorized, queue claims are safe across workers.
	publishJob, err := svc.SaveJob(ctx, p, assistant.Job{Title: "Authorized publishing", ConfigID: config, Template: tmpl, Prompt: "Review verified delivery", Locale: "en", Timezone: "UTC", LocalTime: "09:00", Weekdays: []int{1, 2, 3, 4, 5}, Enabled: true, Publish: true})
	if err != nil {
		t.Fatal(err)
	}
	_, e = repo.Pool().Exec(ctx, `UPDATE assistant_jobs SET next_run_at=now()-interval '1 minute' WHERE id=$1`, publishJob.ID)
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); svc.Tick(ctx) }()
	}
	wg.Wait()
	pubRuns, _ := svc.JobRuns(ctx, p, publishJob.ID)
	reports, _ = repo.List(ctx, team)
	if len(pubRuns) != 1 || pubRuns[0].State != "done" || len(reports) != 1 {
		t.Fatal(pubRuns, reports)
	}
	// Replaying a finished run cannot create another report.
	svc.Tick(ctx)
	reports, _ = repo.List(ctx, team)
	if len(reports) != 1 {
		t.Fatal("duplicate scheduled report")
	}

	// Config revision revokes the fixed source rather than choosing another key.
	_, e = repo.Pool().Exec(ctx, `UPDATE assistant_configs SET revision=revision+1 WHERE id=$1`, config)
	if e != nil {
		t.Fatal(e)
	}
	due()
	runs, _ = svc.JobRuns(ctx, p, j.ID)
	if runs[0].State != "blocked" {
		t.Fatal(runs)
	}
	jobs, _ := svc.Jobs(ctx, p)
	for _, job := range jobs {
		if job.ID == j.ID && job.Enabled {
			t.Fatal("revoked job remained enabled")
		}
	}
	// Revocation remains available when the source is no longer usable.
	if _, e = repo.Pool().Exec(ctx, `DELETE FROM assistant_configs WHERE id=$1`, config); e != nil {
		t.Fatal(e)
	}
	owner.call("PATCH", "/api/v1/assistant/jobs/"+publishJob.ID, map[string]any{"expected_revision": publishJob.Revision}, 200)

}
func TestAssistantMCPVerificationApprovalAndManifestChanges(t *testing.T) {
	owner, _, repo := assistantFixture(t, "find_todos", map[string]any{})
	config := configureAI(owner, "personal")
	ctx := context.Background()
	var team, user string
	repo.Pool().QueryRow(ctx, `SELECT team_id,owner_id FROM assistant_configs WHERE id=$1`, config).Scan(&team, &user)
	p := identity.Principal{TeamID: team, UserID: user, Kind: "session", Role: "admin"}
	changed := false
	client := &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
		raw, _ := io.ReadAll(r.Body)
		body := string(raw)
		result := `{}`
		if strings.Contains(body, `"initialize"`) {
			result = `{"protocolVersion":"2025-11-25"}`
		} else if strings.Contains(body, `"tools/list"`) {
			description := "Read issues"
			if changed {
				description = "Changed permission"
			}
			result = fmt.Sprintf(`{"tools":[{"name":"issues","description":%q,"inputSchema":{"type":"object","properties":{},"additionalProperties":false},"annotations":{"readOnlyHint":true}},{"name":"delete","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":false}}]}`, description)
		}
		id := 1
		if strings.Contains(body, `"id":3`) {
			id = 3
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":%s}`, id, result)))}, nil
	})}
	svc := &assistant.Service{Pool: repo.Pool(), Key: base64.StdEncoding.EncodeToString(make([]byte, 32)), Client: client}
	c, e := svc.SaveMCP(ctx, p, assistant.MCPConnection{Name: "Issues", Scope: "personal", URL: "https://mcp.example.test/mcp", Token: "synthetic-mcp-only"})
	if e != nil {
		t.Fatal(e)
	}
	c, e = svc.VerifyMCP(ctx, p, c.ID)
	if e != nil || len(c.Tools) != 1 || len(c.ApprovedTools) != 0 {
		t.Fatal(c, e)
	}
	c, e = svc.ApproveMCP(ctx, p, c.ID, c.Revision, []string{"issues"})
	if e != nil || len(c.ApprovedTools) != 1 {
		t.Fatal(c, e)
	}
	changed = true
	c, e = svc.VerifyMCP(ctx, p, c.ID)
	if e != nil || len(c.ApprovedTools) != 0 {
		t.Fatal(c, e)
	}
}

func TestAssistantStreamCompletionAndRetry(t *testing.T) {
	owner, _, repo := assistantFixture(t, "propose_todo", map[string]any{"title": "Streamed draft", "column_id": "backlog"})
	config := configureAI(owner, "personal")
	send := func() string {
		raw, _ := json.Marshal(map[string]any{"config_id": config, "request_id": "synthetic-stream-retry", "message": "Prepare task"})
		req := httptest.NewRequest("POST", "/api/v1/assistant/chat", bytes.NewReader(raw))
		req.AddCookie(owner.cookie)
		req.Header.Set("Accept", "text/event-stream")
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		owner.h.ServeHTTP(res, req)
		if res.Code != 200 || res.Header().Get("Content-Type") != "text/event-stream" {
			t.Fatal(res.Code, res.Body.String())
		}
		return res.Body.String()
	}
	first := send()
	second := send()
	if !strings.Contains(first, "event: delta") || !strings.Contains(first, "event: done") || !strings.Contains(second, "event: done") || strings.Contains(first, "synthetic-qa-key") {
		t.Fatal(first, second)
	}
	var n int
	if e := repo.Pool().QueryRow(context.Background(), `SELECT count(*) FROM assistant_actions`).Scan(&n); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	tasks := owner.call("GET", "/api/v1/todos", nil, 200)
	if len(tasks["items"].([]any)) != 0 {
		t.Fatal("stream executed an unconfirmed draft")
	}
}
