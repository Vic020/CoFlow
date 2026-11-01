package httpapi

import (
	"strings"
	"testing"
	"time"
)

func TestCalendarPermissionsScheduleAndReportProjection(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s, BootstrapToken: testBootstrapToken})
	owner := &authClient{t: t, h: h}
	guest := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "calendar-owner@example.test", "name": "Owner", "password": "synthetic-owner-password", "team_name": "Synthetic Calendar"}, 201)
	inv := owner.call("POST", "/api/v1/invites", map[string]any{"email": "calendar-guest@example.test"}, 201)
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": inv["token"], "name": "Guest", "password": "synthetic-guest-password"}, 200)
	token := func(c *authClient, scopes ...string) *authClient {
		return &authClient{t: t, h: h, token: c.call("POST", "/api/v1/tokens", map[string]any{"name": "Calendar synthetic agent", "scopes": scopes}, 201)["credential"].(string)}
	}
	reports := token(owner, "reports:read", "reports:write")
	tasks := token(owner, "todos:read", "todos:write")
	cal := token(owner, "calendar:read", "calendar:write")
	other := token(guest, "calendar:read", "calendar:write")
	all := token(owner, "reports:read", "reports:write", "todos:read", "todos:write", "calendar:read", "calendar:write")
	cal.call("GET", "/api/v1/meta", nil, 200)
	from := time.Now().UTC().AddDate(0, 0, -2).Format("2006-01-02")
	to := time.Now().UTC().AddDate(0, 0, 3).Format("2006-01-02")
	query := "?from=" + from + "&to=" + to + "&timezone=UTC&limit=1"
	reports.call("GET", "/api/v1/calendar/schedule"+query, nil, 403)
	tasks.call("GET", "/api/v1/calendar/reports"+query, nil, 403)
	reports.call("GET", "/api/v1/calendar/events/missing", nil, 403)
	task := tasks.call("POST", "/api/v1/todos", map[string]any{"source_id": "calendar-task", "operation_id": "task-create", "title": "Synthetic scheduled task", "column_id": "backlog", "schedule": map[string]any{"kind": "date-range", "start_date": from, "end_date": to}, "due_date": to}, 200)
	tid := task["id"].(string)
	report := all.call("POST", "/api/v1/reports", map[string]any{"source_id": "calendar-report", "title": "Synthetic progress", "todo_ids": []any{tid}}, 200)
	rid := report["id"].(string)
	readOnly := token(owner, "reports:read")
	readOnly.call("GET", "/api/v1/calendar/reports"+query, nil, 200)
	readOnly.call("GET", "/api/v1/calendar/schedule"+query, nil, 403)
	cal.call("POST", "/api/v1/calendar/events", map[string]any{"title": "Forbidden references", "source_id": "forbidden-refs", "operation_id": "forbidden-refs", "kind": "big_day", "schedule": map[string]any{"kind": "date-range", "start_date": from, "end_date": from}, "report_ids": []any{rid}}, 403)
	tasks.call("POST", "/api/v1/calendar/events", map[string]any{}, 403)
	p := reports.call("GET", "/api/v1/calendar/reports"+query, nil, 200)
	if p["total"] != float64(1) || len(p["days"].(map[string]any)) != 1 {
		t.Fatal("projection counts", p)
	}
	// Editing preserves the actual creation day and updates the visible title.
	report = owner.call("PUT", "/api/v1/reports/"+rid, map[string]any{"title": "Updated progress", "expected_updated_at": report["updated_at"]}, 200)
	p = reports.call("GET", "/api/v1/calendar/reports"+query, nil, 200)
	if p["items"].([]any)[0].(map[string]any)["title"] != "Updated progress" {
		t.Fatal(p)
	}
	if len(p["previews"].(map[string]any)) != 1 {
		t.Fatal("day previews missing")
	}
	create := map[string]any{"title": "Synthetic phase", "kind": "phase", "source_id": "calendar-phase", "operation_id": "event-create", "schedule": map[string]any{"kind": "date-range", "start_date": from, "end_date": to}, "todo_ids": []any{tid}, "report_ids": []any{rid}}
	event := all.call("POST", "/api/v1/calendar/events", create, 200)
	id := event["id"].(string)
	if all.call("POST", "/api/v1/calendar/events", create, 200)["revision"] != event["revision"] {
		t.Fatal("replay changed event")
	}
	create["title"] = "Different"
	all.call("POST", "/api/v1/calendar/events", create, 409)
	only := cal.call("GET", "/api/v1/calendar/events/"+id, nil, 200)
	if len(only["todo_ids"].([]any)) != 0 || len(only["report_ids"].([]any)) != 0 {
		t.Fatal("cross-scope references leaked")
	}
	history := only["history"].([]any)[0].(map[string]any)["after"].(map[string]any)
	if len(history["todo_ids"].([]any)) != 0 || len(history["report_ids"].([]any)) != 0 {
		t.Fatal("history leaked references")
	}
	other.call("PATCH", "/api/v1/calendar/events/"+id, map[string]any{"title": "Unauthorized", "operation_id": "forbidden", "expected_revision": 1}, 403)
	patch := map[string]any{"title": "Replanned phase", "operation_id": "event-edit", "expected_revision": 1}
	event = cal.call("PATCH", "/api/v1/calendar/events/"+id, patch, 200)
	all.call("PATCH", "/api/v1/calendar/events/"+id, map[string]any{"title": "Stale", "operation_id": "stale", "expected_revision": 1}, 409)
	// A calendar-only metadata edit preserves existing references for readers with scopes.
	full := all.call("GET", "/api/v1/calendar/events/"+id, nil, 200)
	if len(full["todo_ids"].([]any)) != 1 || len(full["report_ids"].([]any)) != 1 {
		t.Fatal("metadata edit lost references")
	}
	pg := all.call("GET", "/api/v1/calendar/schedule"+query, nil, 200)
	if pg["total"] != float64(2) || pg["next_cursor"] == "" {
		t.Fatal("schedule pagination", pg)
	}
	task = tasks.call("GET", "/api/v1/todos/"+tid, nil, 200)
	tasks.call("PATCH", "/api/v1/todos/"+tid, map[string]any{"schedule": nil, "operation_id": "unschedule", "expected_revision": task["revision"]}, 200)
	after := tasks.call("GET", "/api/v1/todos/"+tid, nil, 200)
	if after["completed_at"] != nil || after["due_date"] != to || after["column_id"] != "backlog" {
		t.Fatal("planning changed workflow", after)
	}
	all.call("GET", "/api/v1/calendar/schedule"+query+"&cursor="+pg["next_cursor"].(string)+"&revision="+pg["revision"].(string), nil, 409)
	event = cal.call("PATCH", "/api/v1/calendar/events/"+id, map[string]any{"action": "archive", "operation_id": "archive", "expected_revision": event["revision"]}, 200)
	cal.call("PATCH", "/api/v1/calendar/events/"+id, map[string]any{"action": "restore", "operation_id": "restore", "expected_revision": event["revision"]}, 200)
	owner.call("DELETE", "/api/v1/reports/"+rid, map[string]any{"expected_updated_at": report["updated_at"]}, 200)
	if reports.call("GET", "/api/v1/calendar/reports"+query, nil, 200)["total"] != float64(0) {
		t.Fatal("deleted report projected")
	}
	if len(all.call("GET", "/api/v1/calendar/events/"+id, nil, 200)["report_ids"].([]any)) != 0 {
		t.Fatal("deleted report exposed")
	}
	// Exercise more than the maximum page size with equal timestamps: keyset
	// pagination must use IDs as the tie-breaker and keep daily totals intact.
	meta := owner.call("GET", "/api/v1/meta", nil, 200)
	teamID := meta["team"].(map[string]any)["id"].(string)
	_, err := repo.Pool().Exec(t.Context(), `INSERT INTO reports(id,team_id,author_id,source_id,title,created_at,updated_at) SELECT md5($1||g::text),$1,$2,'calendar-bulk-'||g::text,'Synthetic bulk '||g::text,now(),now() FROM generate_series(1,205) g`, teamID, meta["current_user"])
	if err != nil {
		t.Fatal(err)
	}
	largeQuery := strings.Replace(query, "limit=1", "limit=200", 1)
	first := readOnly.call("GET", "/api/v1/calendar/reports"+largeQuery, nil, 200)
	last := readOnly.call("GET", "/api/v1/calendar/reports"+largeQuery+"&cursor="+first["next_cursor"].(string)+"&revision="+first["revision"].(string), nil, 200)
	if first["total"] != float64(205) || len(first["items"].([]any)) != 200 || len(last["items"].([]any)) != 5 || last["next_cursor"] != "" {
		t.Fatal("large page truncated or duplicated")
	}
	seen := map[string]bool{}
	for _, page := range []map[string]any{first, last} {
		for _, r := range page["items"].([]any) {
			key := r.(map[string]any)["id"].(string)
			if seen[key] {
				t.Fatal("duplicate cursor boundary", key)
			}
			seen[key] = true
		}
	}
	// A different team gets a not-found result for both node IDs and source links.
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Separate synthetic team"}, 201)
	owner.call("GET", "/api/v1/calendar/events/"+id, nil, 404)
}
