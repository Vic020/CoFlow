package httpapi

import (
	"context"
	"testing"
)

func TestContentDeletionAndRestoration(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s, BootstrapToken: testBootstrapToken})
	owner := &authClient{t: t, h: h}
	guest := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "owner@example.test", "name": "Owner", "password": "synthetic-deletion-owner", "team_name": "Team"}, 201)
	me := owner.call("GET", "/api/v1/auth/me", nil, 200)
	ownerID := me["user"].(map[string]any)["id"].(string)
	inv := owner.call("POST", "/api/v1/invites", map[string]any{"email": "guest@example.test"}, 201)
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": inv["token"], "name": "Guest", "password": "synthetic-deletion-guest"}, 200)
	guestID := guest.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"].(string)
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Agent", "scopes": []string{"reports:read", "reports:write", "comments:write"}}, 201)["credential"].(string)
	agent := &authClient{t: t, h: h, token: token}
	input := map[string]any{"source_id": "stable-work", "title": "Synthetic deliverable", "body": "Evidence retained", "mentions": []string{guestID}}
	saved := agent.call("POST", "/api/v1/reports", input, 200)
	id := saved["id"].(string)
	comment := guest.call("POST", "/api/v1/reports/"+id+"/comments", map[string]any{"body": "Synthetic feedback", "mentions": []string{ownerID}}, 201)
	cid := comment["id"].(string)
	cp := "/api/v1/reports/" + id + "/comments/" + cid
	// Tokens, including an admin's own token, cannot delete, restore or inspect trash.
	agent.call("DELETE", cp, nil, 403)
	agent.call("POST", cp+"/restore", nil, 403)
	agent.call("GET", "/api/v1/reports/trash", nil, 403)
	agent.call("GET", "/api/v1/reports/"+id+"/comments/trash", nil, 403)
	// A commenter can delete/restore their own comment; notifications and normal reads hide it.
	guest.call("DELETE", cp, nil, 200)
	guest.call("DELETE", cp, nil, 200)
	if len(owner.call("GET", "/api/v1/reports/"+id, nil, 200)["comments"].([]any)) != 0 {
		t.Fatal("deleted comment leaked")
	}
	if len(owner.call("GET", "/api/v1/notifications", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("deleted comment notification leaked")
	}
	if len(guest.call("GET", "/api/v1/reports/"+id+"/comments/trash", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("own deleted comment missing")
	}
	guest.call("POST", cp+"/restore", nil, 200)
	if len(owner.call("GET", "/api/v1/reports/"+id, nil, 200)["comments"].([]any)) != 1 {
		t.Fatal("comment not restored")
	}
	ownComment := owner.call("POST", "/api/v1/reports/"+id+"/comments", map[string]any{"body": "Owner feedback"}, 201)
	guest.call("DELETE", "/api/v1/reports/"+id+"/comments/"+ownComment["id"].(string), nil, 403)
	task := owner.call("POST", "/api/v1/collaborations", map[string]any{"report_id": id, "title": "Synthetic task", "assignee_id": guestID}, 201)
	// Stale deletion must not hide newer changes.
	owner.call("DELETE", "/api/v1/reports/"+id, map[string]any{"expected_updated_at": saved["updated_at"]}, 409)
	current := owner.call("GET", "/api/v1/reports/"+id, nil, 200)
	guest.call("DELETE", "/api/v1/reports/"+id, map[string]any{"expected_updated_at": current["updated_at"]}, 403)
	agent.call("DELETE", "/api/v1/reports/"+id, map[string]any{"expected_updated_at": current["updated_at"]}, 403)
	owner.call("DELETE", "/api/v1/reports/"+id, map[string]any{"expected_updated_at": current["updated_at"]}, 200)
	owner.call("DELETE", "/api/v1/reports/"+id, map[string]any{"expected_updated_at": current["updated_at"]}, 200)
	owner.call("GET", "/api/v1/reports/"+id, nil, 404)
	if len(guest.call("GET", "/api/v1/reports", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("deleted report leaked")
	}
	if len(guest.call("GET", "/api/v1/reports/trash", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("another author's trash leaked")
	}
	if len(owner.call("GET", "/api/v1/reports/trash", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("own trash missing")
	}
	if len(guest.call("GET", "/api/v1/collaborations", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("deleted report collaboration leaked")
	}
	if len(guest.call("GET", "/api/v1/notifications", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("deleted report notifications leaked")
	}
	guest.call("GET", "/api/v1/reports/"+id+"/history", nil, 404)
	agent.call("POST", "/api/v1/reports", input, 409)
	owner.call("POST", "/api/v1/reports/"+id+"/comments", map[string]any{"body": "Cannot comment"}, 404)
	owner.call("PATCH", "/api/v1/reports/"+id, map[string]any{"status": "resolved"}, 404)
	guest.call("PATCH", "/api/v1/collaborations/"+task["id"].(string), map[string]any{"status": "done"}, 404)
	guest.call("POST", "/api/v1/reports/"+id+"/restore", nil, 403)
	agent.call("POST", "/api/v1/reports/"+id+"/restore", nil, 403)
	owner.call("POST", "/api/v1/reports/"+id+"/restore", nil, 200)
	owner.call("POST", "/api/v1/reports/"+id+"/restore", nil, 200)
	restored := owner.call("GET", "/api/v1/reports/"+id, nil, 200)
	if restored["source_id"] != "stable-work" || len(restored["comments"].([]any)) != 2 {
		t.Fatal("restore lost source or discussion")
	}
	agent.call("POST", "/api/v1/reports", input, 200)
	// Team administrator can manage another author's records; a different team cannot access them.
	other := guest.call("POST", "/api/v1/reports", map[string]any{"source_id": "other-work", "title": "Guest report"}, 200)
	otherID := other["id"].(string)
	owner.call("DELETE", "/api/v1/reports/"+otherID, map[string]any{"expected_updated_at": other["updated_at"]}, 200)
	owner.call("POST", "/api/v1/reports/"+otherID+"/restore", nil, 200)
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Other team", "display_name": "Other"}, 201)
	owner.call("DELETE", "/api/v1/reports/"+id, map[string]any{"expected_updated_at": restored["updated_at"]}, 404)
	owner.call("POST", "/api/v1/reports/"+id+"/restore", nil, 404)
	owner.call("DELETE", cp, nil, 404)
	owner.call("GET", "/api/v1/reports/"+id, nil, 404)
	if len(owner.call("GET", "/api/v1/reports/trash", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("cross-team trash leaked")
	}
	var count int
	if err := repo.Pool().QueryRow(context.Background(), `SELECT count(*) FROM report_history WHERE report_id=$1 AND action IN ('删除简报','恢复简报')`, id).Scan(&count); err != nil || count != 2 {
		t.Fatalf("audit missing or duplicate: %d %v", count, err)
	}
}
