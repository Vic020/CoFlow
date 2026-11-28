package httpapi

import (
	"context"
	"testing"

	"coflow/api/internal/store"
)

func TestPersonalInboxFollowReplyAndActivity(t *testing.T) {
	owner, guest, repo := assistantFixture(t, "read_workspace", nil)
	todo := owner.call("POST", "/api/v1/todos", map[string]any{
		"title": "Synthetic watched task", "operation_id": store.ID(), "source_id": "watch-test", "column_id": "backlog",
	}, 200)
	todoID := todo["id"].(string)
	todoPath := "/api/v1/todos/" + todoID
	guest.call("PUT", todoPath+"/follow", map[string]any{"following": true}, 200)
	update := map[string]any{"action": "edit", "title": "Changed watched task", "operation_id": store.ID(), "expected_revision": todo["revision"]}
	owner.call("PATCH", todoPath, update, 200)
	owner.call("PATCH", todoPath, update, 200)
	items := func(c *authClient, query string) []any {
		return c.call("GET", "/api/v1/notifications"+query, nil, 200)["items"].([]any)
	}
	if got := items(guest, ""); len(got) != 1 || got[0].(map[string]any)["todo_id"] != todoID {
		t.Fatal("missing or duplicated follow notification", got)
	}
	if len(items(owner, "")) != 0 || len(items(owner, "?view=activity")) != 2 {
		t.Fatal("personal activity mixed into received notifications")
	}
	guest.call("POST", "/api/v1/notifications/read", map[string]any{}, 200)
	if items(guest, "")[0].(map[string]any)["read_at"] == nil {
		t.Fatal("notification was not marked read")
	}
	guest.call("PUT", todoPath+"/follow", map[string]any{"following": false}, 200)
	update["expected_revision"] = todo["revision"].(float64) + 1
	update["operation_id"] = store.ID()
	update["title"] = "Unwatched"
	owner.call("PATCH", todoPath, update, 200)
	if len(items(guest, "")) != 1 {
		t.Fatal("unfollow did not stop future notifications")
	}
	report := owner.call("POST", "/api/v1/reports", map[string]any{"source_id": "inbox-report", "title": "Synthetic report", "body": "Synthetic progress"}, 200)
	comments := "/api/v1/reports/" + report["id"].(string) + "/comments"
	comment := guest.call("POST", comments, map[string]any{"body": "Synthetic feedback"}, 201)
	reply := owner.call("POST", comments, map[string]any{"body": "Synthetic reply", "parent_id": comment["id"]}, 201)
	owner.call("POST", comments, map[string]any{"body": "Invalid parent", "parent_id": "missing"}, 404)
	found := false
	for _, raw := range items(guest, "") {
		item := raw.(map[string]any)
		if item["kind"] == "reply" && item["comment_id"] == reply["id"] && item["needs_response"] == true {
			found = true
		}
	}
	if !found {
		t.Fatal("direct reply notification missing")
	}
	guestID := guest.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"]
	event := owner.call("POST", "/api/v1/calendar/events", map[string]any{
		"title": "Synthetic milestone", "kind": "big_day", "source_id": "inbox-event", "operation_id": store.ID(),
		"assignee_id": guestID, "schedule": map[string]any{"kind": "date-range", "start_date": "2026-11-28", "end_date": "2026-11-28"},
	}, 200)
	found = false
	for _, raw := range items(guest, "") {
		item := raw.(map[string]any)
		if item["kind"] == "calendar" && item["calendar_event_id"] == event["id"] {
			found = true
		}
	}
	if !found {
		t.Fatal("calendar notification missing")
	}
	feed := func(client *authClient, view string) []any {
		return client.call("GET", "/api/v1/activity?view="+view, nil, 200)["items"].([]any)
	}
	if got := feed(guest, "recent"); len(got) != 7 {
		t.Fatal("activity should include each tracked workspace change once", got)
	}
	if got := feed(guest, "mine"); len(got) != 1 || got[0].(map[string]any)["comment_id"] != comment["id"] {
		t.Fatal("personal activity did not include the comment", got)
	}
	projectFollow := "/api/v1/activity/follows/project/general"
	ownerID := owner.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"].(string)
	guest.call("PUT", projectFollow, map[string]any{}, 400)
	guest.call("PUT", projectFollow, map[string]any{"following": true}, 200)
	guest.call("PUT", "/api/v1/activity/follows/member/"+ownerID, map[string]any{"following": true}, 200)
	if len(guest.call("GET", "/api/v1/activity/follows", nil, 200)["items"].([]any)) != 2 ||
		len(owner.call("GET", "/api/v1/activity/follows", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("activity stars were not isolated by person")
	}
	found = false
	for _, raw := range feed(guest, "starred") {
		item := raw.(map[string]any)
		if item["comment_id"] == reply["id"] && item["kind"] == "comment-reply" {
			found = true
		}
	}
	if !found {
		t.Fatal("reply to comment missing from starred feed")
	}
	guest.call("PUT", projectFollow, map[string]any{"following": false}, 200)
	if got := feed(guest, "starred"); len(got) != 6 {
		t.Fatal("member star should only include the followed member's activity", got)
	}
	private := owner.call("POST", "/api/v1/context", map[string]any{
		"title": "Synthetic private Context", "body": "Private test content", "kind": "document",
		"state": "pending", "visibility": "personal", "project_id": "general", "operation_id": store.ID(), "source_id": "private-activity-test",
	}, 200)
	shared := owner.call("POST", "/api/v1/context", map[string]any{
		"title": "Synthetic shared Context", "body": "Shared test content", "kind": "document",
		"state": "pending", "visibility": "team", "project_id": "general", "operation_id": store.ID(), "source_id": "shared-activity-test",
	}, 200)
	found = false
	for _, raw := range feed(guest, "starred") {
		item := raw.(map[string]any)
		if item["context_id"] == private["id"] {
			t.Fatal("another member's private Context was visible")
		}
		found = found || item["context_id"] == shared["id"]
	}
	if !found {
		t.Fatal("shared Context change missing from starred feed")
	}
	guest.call("PUT", "/api/v1/activity/follows/member/"+ownerID, map[string]any{"following": false}, 200)
	reportFollow := "/api/v1/activity/follows/report/" + report["id"].(string)
	guest.call("PUT", reportFollow, map[string]any{"following": true}, 200)
	if got := feed(guest, "starred"); len(got) != 3 {
		t.Fatal("report star should surface the report, comment and reply", got)
	}
	if got := feed(owner, "starred"); len(got) != 0 {
		t.Fatal("report star leaked to another member", got)
	}
	if _, err := repo.Pool().Exec(context.Background(), "UPDATE notifications SET created_at=now()-interval '31 days' WHERE report_id=$1", report["id"]); err != nil {
		t.Fatal(err)
	}
	if got := feed(guest, "starred"); len(got) != 1 || got[0].(map[string]any)["kind"] != "starred-report" {
		t.Fatal("older starred report was omitted", got)
	}
	guest.call("PUT", reportFollow, map[string]any{"following": false}, 200)
	if got := feed(guest, "starred"); len(got) != 0 {
		t.Fatal("unstarred report remained in starred view", got)
	}
	guest.call("POST", "/api/v1/teams", map[string]any{"name": "Other inbox space"}, 201)
	guest.call("PUT", reportFollow, map[string]any{"following": true}, 404)
	if len(items(guest, "")) != 0 || len(items(guest, "?view=activity")) != 0 {
		t.Fatal("inbox data leaked across spaces")
	}
	if len(feed(guest, "recent")) != 0 || len(guest.call("GET", "/api/v1/activity/follows", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("feed or stars leaked across spaces")
	}
}
