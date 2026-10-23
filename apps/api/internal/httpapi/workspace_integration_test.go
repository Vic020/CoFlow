package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestWorkspaceClassificationAndCollaboration(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s})
	owner := &authClient{t: t, h: h}
	guest := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "owner@example.test", "name": "Owner", "password": "workspace-test-owner-password", "team_name": "Team A"}, 201)
	me := owner.call("GET", "/api/v1/auth/me", nil, 200)
	ownerID := me["user"].(map[string]any)["id"].(string)
	team := me["current_team"].(string)
	inv := owner.call("POST", "/api/v1/invites", map[string]any{"email": "guest@example.test"}, 201)
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": inv["token"], "name": "Guest", "password": "workspace-test-guest-password"}, 200)
	guestID := guest.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"].(string)
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Agent"}, 201)["credential"].(string)
	agent := &authClient{t: t, h: h, token: token}
	brief := map[string]any{"source_id": "source-one", "title": "完成官网预览", "body": "原始简报内容", "project_name": " 官网改版 ", "domains": []string{"技术开发", "产品"}, "agent": "Codex", "classification_locked": true, "mentions": []string{guestID}}
	saved := agent.call("POST", "/api/v1/reports", brief, 200)
	id := saved["id"].(string)
	project := saved["project_id"].(string)
	if saved["classification_locked"] == true {
		t.Fatal("agent set browser-only classification lock")
	}
	if len(saved["domains"].([]any)) != 2 {
		t.Fatal("multiple domains not preserved")
	}
	if repeat := agent.call("POST", "/api/v1/reports", brief, 200); repeat["id"] != id {
		t.Fatal("source upsert duplicated")
	}
	catalog := owner.call("GET", "/api/v1/catalog", nil, 200)["items"].([]any)
	var pending, dev string
	for _, raw := range catalog {
		c := raw.(map[string]any)
		if c["name"] == "技术开发" {
			pending = c["id"].(string)
			if c["state"] != "pending" {
				t.Fatal("unknown domain promoted automatically")
			}
		}
		if c["name"] == "研发" {
			dev = c["id"].(string)
		}
	}
	agent.call("POST", "/api/v1/catalog/project", map[string]any{"name": "cannot-manage"}, 403)
	owner.call("POST", "/api/v1/catalog/domain/"+pending+"/merge", map[string]any{"target_id": dev}, 200)
	rows := owner.call("GET", "/api/v1/reports?domain=研发", nil, 200)["items"].([]any)
	if len(rows) != 1 {
		t.Fatal("merge did not reclassify historical brief")
	}
	raw := rows[0].(map[string]any)
	if raw["body"] != "原始简报内容" || raw["classification_input"].(map[string]any)["project_name"] != " 官网改版 " {
		t.Fatal("merge lost original input")
	}
	owner.call("PATCH", "/api/v1/catalog/project/"+project, map[string]any{"name": "官网改版一期", "state": "active", "aliases": []string{}}, 200)
	updated := agent.call("POST", "/api/v1/reports", brief, 200)
	if updated["project_id"] != project || updated["domain"] != "研发" {
		t.Fatal("aliases did not resolve")
	}
	owner.call("PATCH", "/api/v1/reports/"+id+"/classification", map[string]any{"project_id": "", "domains": []string{"运营"}}, 200)
	brief["project_name"] = "新的错误猜测"
	brief["body"] = "新增进展，分类应保留"
	updated = agent.call("POST", "/api/v1/reports", brief, 200)
	if updated["project_id"] != "" || updated["domain"] != "运营" || updated["classification_locked"] != true {
		t.Fatal("agent overwrote human classification")
	}
	owner.call("PATCH", "/api/v1/catalog/domain/"+dev, map[string]any{"name": "研发", "aliases": []string{"开发"}, "state": "archived"}, 200)
	invalid := map[string]any{"source_id": "bad", "title": "invalid", "project_name": "should-rollback", "domains": []string{"开发"}}
	agent.call("POST", "/api/v1/reports", invalid, 400)
	for _, v := range owner.call("GET", "/api/v1/catalog", nil, 200)["items"].([]any) {
		if v.(map[string]any)["name"] == "should-rollback" {
			t.Fatal("failed report left a category behind")
		}
	}
	guest.call("POST", "/api/v1/reports/"+id+"/comments", map[string]any{"body": "请确认下一步", "mentions": []string{ownerID}}, 201)
	task := owner.call("POST", "/api/v1/collaborations", map[string]any{"report_id": id, "title": "确认上线文案", "assignee_id": guestID}, 201)
	taskID := task["id"].(string)
	guest.call("PATCH", "/api/v1/collaborations/"+taskID, map[string]any{"status": "in_progress", "body": "正在确认"}, 200)
	guest.call("PATCH", "/api/v1/collaborations/"+taskID, map[string]any{"status": "done", "body": "文案已确认"}, 200)
	tasks := owner.call("GET", "/api/v1/collaborations", nil, 200)["items"].([]any)
	if len(tasks) != 1 || len(tasks[0].(map[string]any)["updates"].([]any)) != 2 {
		t.Fatal("collaboration updates missing")
	}
	owner.call("POST", "/api/v1/collaborations", map[string]any{"report_id": id, "title": "bad owner", "assignee_id": "not-a-member"}, 400)
	messages := owner.call("GET", "/api/v1/notifications", nil, 200)["items"].([]any)
	if len(messages) < 3 {
		t.Fatal("comment or collaboration notifications missing")
	}
	owner.call("POST", "/api/v1/notifications/read", map[string]any{}, 200)
	for _, v := range owner.call("GET", "/api/v1/notifications", nil, 200)["items"].([]any) {
		if v.(map[string]any)["read_at"] == nil {
			t.Fatal("notification read not persisted")
		}
	}
	agent.call("GET", "/api/v1/notifications", nil, 403)
	guest.call("POST", "/api/v1/reports/"+id+"/read", map[string]any{"seen_at": updated["updated_at"]}, 200)
	if guest.call("GET", "/api/v1/reads", nil, 200)["items"].(map[string]any)[id] == nil {
		t.Fatal("read state missing")
	}
	history := owner.call("GET", "/api/v1/reports/"+id+"/history", nil, 200)["items"].([]any)
	if len(history) < 4 {
		t.Fatal("report history missing")
	}
	owner.call("PATCH", "/api/v1/reports/"+id, map[string]any{"status": "resolved"}, 200)
	// Another team cannot see or mutate the first team's reports, categories, requests, reads, or inbox.
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Invalid", "display_name": "  "}, 400)
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Team B", "display_name": "Captain B"}, 201)
	if owner.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["name"] != "Captain B" {
		t.Fatal("team nickname not returned by current identity")
	}
	secondMeta := owner.call("GET", "/api/v1/meta", nil, 200)
	if secondMeta["members"].([]any)[0].(map[string]any)["name"] != "Captain B" {
		t.Fatal("team metadata did not use membership nickname")
	}
	agent.call("POST", "/api/v1/teams", map[string]any{"name": "No token teams"}, 403)
	if agent.call("GET", "/api/v1/meta", nil, 200)["members"].([]any)[0].(map[string]any)["name"] != "Owner" {
		t.Fatal("new team changed original team nickname")
	}
	for _, path := range []string{"reports", "collaborations", "notifications"} {
		if len(owner.call("GET", "/api/v1/"+path, nil, 200)["items"].([]any)) != 0 {
			t.Fatal("cross-team leak", path)
		}
	}
	owner.call("GET", "/api/v1/reports/"+id+"/history", nil, 404)
	owner.call("PATCH", "/api/v1/collaborations/"+taskID, map[string]any{"status": "done"}, 404)
	owner.call("POST", "/api/v1/reports/"+id+"/read", map[string]any{"seen_at": updated["updated_at"]}, 404)
	owner.call("PATCH", "/api/v1/reports/"+id+"/classification", map[string]any{"domains": []string{"研发"}}, 404)
	owner.call("PATCH", "/api/v1/catalog/project/"+project, map[string]any{"name": "cross team", "state": "active"}, 404)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": team}, 200)
	if owner.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["name"] != "Owner" {
		t.Fatal("switch back did not restore original nickname")
	}
	if len(owner.call("GET", "/api/v1/collaborations", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("switching team lost data")
	}
	_ = repo
}

func TestConcurrentClassificationNames(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s})
	owner := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "concurrent@example.test", "name": "Owner", "password": "workspace-test-owner-password", "team_name": "Concurrent Team"}, 201)
	var wg sync.WaitGroup
	codes := make(chan int, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body, _ := json.Marshal(map[string]any{"source_id": fmt.Sprint(i), "title": "并发上报", "project_name": " CoFlow ", "domains": []string{"技术 开发"}})
			req := httptest.NewRequest("POST", "/api/v1/reports", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.AddCookie(owner.cookie)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			codes <- w.Code
		}(i)
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatal("concurrent save failed", code)
		}
	}
	items := owner.call("GET", "/api/v1/catalog", nil, 200)["items"].([]any)
	count := 0
	for _, v := range items {
		if v.(map[string]any)["state"] == "pending" {
			count++
		}
	}
	if count != 2 {
		t.Fatal("duplicate pending categories", count)
	}
	if len(owner.call("GET", "/api/v1/reports", nil, 200)["items"].([]any)) != 8 {
		t.Fatal("lost concurrent reports")
	}
}

func TestCatalogOrdering(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s})
	owner := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "order@example.test", "name": "Owner", "password": "ordering-test-password", "team_name": "Ordering"}, 201)
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Agent"}, 201)["credential"].(string)
	agent := &authClient{t: t, h: h, token: token}
	first := owner.call("POST", "/api/v1/catalog/project", map[string]any{"name": "First"}, 201)["id"].(string)
	second := owner.call("POST", "/api/v1/catalog/project", map[string]any{"name": "Second"}, 201)["id"].(string)
	ids := []string{second, first}
	// Include seeded projects, if any, so a complete team list is submitted.
	for _, raw := range owner.call("GET", "/api/v1/catalog", nil, 200)["items"].([]any) {
		c := raw.(map[string]any)
		id := c["id"].(string)
		if c["kind"] == "project" && id != first && id != second && c["state"] != "merged" {
			ids = append(ids, id)
		}
	}
	body := map[string]any{"ids": ids}
	agent.call("PUT", "/api/v1/catalog/project/order", body, 403)
	owner.call("PUT", "/api/v1/catalog/project/order", body, 200)
	projects := owner.call("GET", "/api/v1/meta", nil, 200)["projects"].([]any)
	if projects[0].(map[string]any)["id"] != second || projects[1].(map[string]any)["id"] != first {
		t.Fatal("catalog order not reflected in metadata")
	}
	invalid := append([]string{}, ids...)
	invalid[0] = first
	owner.call("PUT", "/api/v1/catalog/project/order", map[string]any{"ids": invalid}, 400)
	owner.call("PUT", "/api/v1/catalog/project/order", map[string]any{"ids": ids[:1]}, 400)
	owner.call("PUT", "/api/v1/catalog/invalid/order", body, 400)
	// A foreign team's IDs cannot be used even with a valid web session.
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Other", "display_name": "Other Owner"}, 201)
	owner.call("PUT", "/api/v1/catalog/project/order", body, 400)
}

func TestBrowserReportEditing(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s})
	owner := &authClient{t: t, h: h}
	member := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "editor@example.test", "name": "Editor", "password": "editing-test-password", "team_name": "Editing"}, 201)
	invitation := owner.call("POST", "/api/v1/invites", map[string]any{"email": "member@example.test"}, 201)
	member.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": invitation["token"], "name": "Member", "password": "editing-member-password"}, 200)
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Agent"}, 201)["credential"].(string)
	agent := &authClient{t: t, h: h, token: token}
	saved := agent.call("POST", "/api/v1/reports", map[string]any{"source_id": "edit-source", "title": "Original", "body": "Original body", "agent": "Codex", "model": "original-model", "domains": []string{"研发"}}, 200)
	id := saved["id"].(string)
	input := map[string]any{"title": "Edited", "body": "New body", "status": "delivered", "expected_updated_at": saved["updated_at"], "project_id": saved["project_id"], "domains": saved["domains"], "links": []any{map[string]any{"title": "Preview", "url": "https://example.test/preview"}, map[string]any{"title": "PR", "url": "https://example.test/pr"}}, "mentions": []string{}, "author_id": "forged", "source_id": "forged", "agent": "forged", "model": "forged"}
	agent.call("PUT", "/api/v1/reports/"+id, input, 403)
	member.call("PUT", "/api/v1/reports/"+id, input, 403)
	edited := owner.call("PUT", "/api/v1/reports/"+id, input, 200)
	for _, field := range []string{"id", "author_id", "source_id", "agent", "model", "created_at"} {
		if edited[field] != saved[field] {
			t.Fatalf("editing changed %s", field)
		}
	}
	if edited["title"] != "Edited" || len(edited["links"].([]any)) != 2 || edited["classification_locked"] == true {
		t.Fatal("content edit failed or locked unchanged classification")
	}
	owner.call("PUT", "/api/v1/reports/"+id, input, 409)
	input["expected_updated_at"] = edited["updated_at"]
	input["links"] = []any{map[string]any{"url": "javascript:alert(1)"}}
	owner.call("PUT", "/api/v1/reports/"+id, input, 400)
	input["links"] = []any{}
	input["domains"] = []string{"运营"}
	edited = owner.call("PUT", "/api/v1/reports/"+id, input, 200)
	if len(edited["links"].([]any)) != 0 || edited["classification_locked"] != true || edited["domain"] != "运营" {
		t.Fatal("removing links or manual classification failed")
	}
	history := owner.call("GET", "/api/v1/reports/"+id+"/history", nil, 200)["items"].([]any)
	if len(history) != 3 {
		t.Fatalf("expected initial and two edit histories, got %d", len(history))
	}
	// Browser admins may edit a member's report without changing its attribution.
	guestReport := member.call("POST", "/api/v1/reports", map[string]any{"title": "Member report", "source_id": "member-source"}, 200)
	input["expected_updated_at"] = guestReport["updated_at"]
	input["domains"] = []string{}
	edited = owner.call("PUT", "/api/v1/reports/"+guestReport["id"].(string), input, 200)
	if edited["author_id"] != guestReport["author_id"] {
		t.Fatal("admin edit changed author")
	}
	// New comments invalidate stale content edits and survive the editing workflow.
	member.call("POST", "/api/v1/reports/"+id+"/comments", map[string]any{"body": "Keep discussion"}, 201)
	input["expected_updated_at"] = saved["updated_at"]
	owner.call("PUT", "/api/v1/reports/"+id, input, 409)
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Isolated"}, 201)
	owner.call("PUT", "/api/v1/reports/"+id, input, 404)
}
