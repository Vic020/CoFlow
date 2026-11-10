package httpapi

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func knowledgeInput(title string) map[string]any {
	return map[string]any{"title": title, "body": "Synthetic reviewed decision", "kind": "decision", "visibility": "team", "state": "pending", "source_id": store.ID(), "operation_id": store.ID(), "sources": []any{}, "domains": []string{}}
}
func knowledgePatch(v map[string]any, action string) map[string]any {
	out := map[string]any{}
	for _, key := range []string{"parent_id", "title", "body", "kind", "visibility", "state", "project_id", "domains", "valid_from", "valid_until", "review_on", "sources"} {
		out[key] = v[key]
	}
	out["action"] = action
	out["expected_revision"] = v["revision"]
	out["operation_id"] = store.ID()
	return out
}
func TestKnowledgeVisibilitySourcesAndLifecycle(t *testing.T) {
	owner, guest, _ := assistantFixture(t, "read_workspace", nil)
	create := func(in map[string]any) map[string]any { return owner.call("POST", "/api/v1/context", in, 200) }
	input := knowledgeInput("Synthetic private rule")
	input["visibility"] = "personal"
	input["body"] = "Private original body"
	input["review_on"] = "2020-02-01"
	private := create(input)
	id := private["id"].(string)
	guest.call("GET", "/api/v1/context/"+id, nil, 404)
	if n := guest.call("GET", "/api/v1/context", nil, 200)["total"].(float64); n != 0 {
		t.Fatal("private list leaked")
	}
	board := guest.call("GET", "/api/v1/todo-board", nil, 200)
	if board["contexts"] != nil || board["delegations"] != nil {
		t.Fatal("board leaked private storage")
	}
	patch := knowledgePatch(private, "edit")
	patch["visibility"] = "team"
	patch["body"] = "Explicitly shared new body"
	patch["review_on"] = ""
	shared := owner.call("PATCH", "/api/v1/context/"+id, patch, 200)
	visible := guest.call("GET", "/api/v1/context/"+id, nil, 200)
	raw, _ := json.Marshal(visible)
	if strings.Contains(string(raw), "Private original body") || strings.Contains(string(raw), "2020-02-01") {
		t.Fatal("private historical body leaked after sharing")
	}
	guest.call("PATCH", "/api/v1/context/"+id, knowledgePatch(shared, "archive"), 403)
	owner.call("PATCH", "/api/v1/context/"+id, knowledgePatch(private, "edit"), 409)
	expired := knowledgeInput("Expired rule")
	expired["state"] = "active"
	expired["valid_until"] = "2020-01-01"
	v := create(expired)
	if v["state"] != "expired" {
		t.Fatal("expiry not derived")
	}
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Source task", "column_id": "backlog", "source_id": store.ID(), "operation_id": store.ID()}, 200)
	tid := task["id"].(string)
	linkedInput := knowledgeInput("From original task")
	linkedInput["sources"] = []any{map[string]any{"kind": "todo", "id": tid, "quote": "Reviewed excerpt"}}
	linked := create(linkedInput)
	lid := linked["id"].(string)
	replay := owner.call("POST", "/api/v1/context", linkedInput, 200)
	if replay["id"] != lid {
		t.Fatal("retry duplicated context")
	}
	linkedInput["operation_id"] = store.ID()
	again := owner.call("POST", "/api/v1/context", linkedInput, 200)
	if again["id"] != lid {
		t.Fatal("repeated extraction duplicated context")
	}
	owner.call("PATCH", "/api/v1/todos/"+tid, map[string]any{"title": "Changed source", "expected_revision": task["revision"], "operation_id": store.ID()}, 200)
	linked = owner.call("GET", "/api/v1/context/"+lid, nil, 200)
	if linked["needs_review"] != true {
		t.Fatal("source change unmarked")
	}
	owner.call("PATCH", "/api/v1/context/"+lid, knowledgePatch(linked, "confirm"), 409)
	patch = knowledgePatch(linked, "review")
	src := linked["sources"].([]any)[0].(map[string]any)
	src["revision"] = ""
	patch["sources"] = []any{src}
	linked = owner.call("PATCH", "/api/v1/context/"+lid, patch, 200)
	if linked["needs_review"] != false {
		t.Fatal("explicit review failed")
	}
	token := func(scopes []string) *authClient {
		return &authClient{t: t, h: owner.h, token: owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Knowledge synthetic", "scopes": scopes}, 201)["credential"].(string)}
	}
	read := token([]string{"context:read"})
	read.call("GET", "/api/v1/meta", nil, 200)
	read.call("GET", "/api/v1/context/"+lid, nil, 404)
	read.call("GET", "/api/v1/context/"+id, nil, 200)
	writer := token([]string{"context:read", "context:write"})
	x := knowledgeInput("Token inference")
	x["state"] = "active"
	writer.call("POST", "/api/v1/context", x, 403)
	x["state"] = "pending"
	x["operation_id"] = store.ID()
	writer.call("POST", "/api/v1/context", x, 200)
	owner.call("POST", "/api/v1/tokens", map[string]any{"name": "No read", "scopes": []string{"context:write"}}, 400)
	owner.call("POST", "/api/v1/tokens", map[string]any{"name": "No calendar read", "scopes": []string{"calendar:write", "context:read"}}, 400)
	x = knowledgeInput("Credential rejection")
	x["body"] = "Bearer " + strings.Repeat("x", 30)
	owner.call("POST", "/api/v1/context", x, 400)
	target := create(knowledgeInput("Canonical decision"))
	patch = knowledgePatch(shared, "merge")
	patch["superseded_by"] = target["id"]
	patch["target_revision"] = target["revision"]
	merged := owner.call("PATCH", "/api/v1/context/"+id, patch, 200)
	if merged["state"] != "archived" || merged["superseded_by"] != target["id"] {
		t.Fatal("merge did not preserve replacement")
	}
	originalTeam := owner.call("GET", "/api/v1/meta", nil, 200)["team"].(map[string]any)["id"]
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Isolated other team", "display_name": "Synthetic"}, 201)
	owner.call("GET", "/api/v1/context/"+id, nil, 404)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": originalTeam}, 200)
}
func TestTaskBlockersAndScopedRevocableDelegation(t *testing.T) {
	owner, member, repo := assistantFixture(t, "read_workspace", nil)
	uid := member.call("GET", "/api/v1/meta", nil, 200)["current_user"].(string)
	create := func(title string) map[string]any {
		return owner.call("POST", "/api/v1/todos", map[string]any{"title": title, "column_id": "backlog", "source_id": store.ID(), "operation_id": store.ID()}, 200)
	}
	first, second := create("Prerequisite"), create("Dependent")
	fid, sid := first["id"].(string), second["id"].(string)
	second = owner.call("PATCH", "/api/v1/todos/"+sid, map[string]any{"blockers": []any{map[string]any{"todo_id": fid, "condition": "Reviewed deliverable"}}, "expected_revision": second["revision"], "operation_id": store.ID()}, 200)
	if second["blocked"] != true {
		t.Fatal("dependency status missing")
	}
	change := func(c *authClient, id, action string, status int) map[string]any {
		x := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
		board := owner.call("GET", "/api/v1/todo-board", nil, 200)
		return c.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": action, "expected_revision": x["revision"], "board_revision": board["revision"], "operation_id": store.ID()}, status)
	}
	change(owner, sid, "complete", 400)
	owner.call("PATCH", "/api/v1/todos/"+fid, map[string]any{"blockers": []any{map[string]any{"todo_id": sid}}, "expected_revision": first["revision"], "operation_id": store.ID()}, 400)
	first = change(owner, fid, "complete", 200)
	change(owner, sid, "complete", 200)
	change(owner, fid, "reopen", 200)
	second = change(owner, sid, "reopen", 200)
	member.call("PATCH", "/api/v1/todos/"+sid, map[string]any{"body": "Unauthorized", "expected_revision": second["revision"], "operation_id": store.ID()}, 403)
	grant := map[string]any{"member_id": uid, "todo_id": sid, "actions": []string{"edit", "move"}, "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "operation_id": store.ID()}
	delegation := owner.call("POST", "/api/v1/delegations", grant, 200)
	visible := member.call("GET", "/api/v1/delegations", nil, 200)["items"].([]any)
	if len(visible) != 1 || visible[0].(map[string]any)["id"] != delegation["id"] {
		t.Fatal("grantee cannot discover their own delegation")
	}
	replay := owner.call("POST", "/api/v1/delegations", grant, 200)
	if replay["id"] != delegation["id"] {
		t.Fatal("delegation retry duplicated")
	}
	token := &authClient{t: t, h: member.h, token: member.call("POST", "/api/v1/tokens", map[string]any{"name": "Second Agent", "scopes": []string{"todos:read", "todos:write"}}, 201)["credential"].(string)}
	token.call("POST", "/api/v1/delegations", grant, 403)
	second = token.call("PATCH", "/api/v1/todos/"+sid, map[string]any{"body": "Delegated progress", "expected_revision": second["revision"], "operation_id": store.ID()}, 200)
	token.call("PATCH", "/api/v1/todos/"+sid, map[string]any{"assignee_id": uid, "expected_revision": second["revision"], "operation_id": store.ID()}, 403)
	change(token, sid, "complete", 400)
	owner.call("PATCH", "/api/v1/delegations/"+delegation["id"].(string), map[string]any{"action": "revoke", "expected_revision": delegation["revision"], "operation_id": store.ID()}, 200)
	token.call("PATCH", "/api/v1/todos/"+sid, map[string]any{"body": "After revocation", "expected_revision": second["revision"], "operation_id": store.ID()}, 403)
	grant["operation_id"] = store.ID()
	grant["actions"] = []string{"schedule"}
	delegation = owner.call("POST", "/api/v1/delegations", grant, 200)
	token.call("PATCH", "/api/v1/todos/"+sid, map[string]any{"body": "Must not piggyback", "schedule": nil, "expected_revision": second["revision"], "operation_id": store.ID()}, 403)
	board := owner.call("GET", "/api/v1/todo-board", nil, 200)
	second = token.call("PATCH", "/api/v1/todos/"+sid, map[string]any{"schedule": nil, "action": "edit", "expected_revision": second["revision"], "board_revision": board["revision"], "operation_id": store.ID()}, 200)
	// Expire only this disposable schema's grant, then verify it cannot authorize work.
	_, e := repo.Pool().Exec(t.Context(), `UPDATE todo_boards SET document=jsonb_set(document,'{delegations}',(SELECT jsonb_agg(CASE WHEN d->>'id'=$1 THEN jsonb_set(d,'{expires_at}',to_jsonb('2020-01-01T00:00:00Z'::text)) ELSE d END) FROM jsonb_array_elements(document->'delegations') d))`, delegation["id"])
	if e != nil {
		t.Fatal(e)
	}
	token.call("PATCH", "/api/v1/todos/"+sid, map[string]any{"schedule": nil, "expected_revision": second["revision"], "operation_id": store.ID()}, 403)
}

func TestTwoAgentSessionHandoffWithKnowledge(t *testing.T) {
	owner, member, _ := assistantFixture(t, "read_workspace", nil)
	token := func(c *authClient) *authClient {
		return &authClient{t: t, h: c.h, token: c.call("POST", "/api/v1/tokens", map[string]any{"name": "Disposable Agent identity", "scopes": []string{"todos:read", "todos:write", "reports:read", "context:read", "context:write"}}, 201)["credential"].(string)}
	}
	agentA, agentB := token(owner), token(member)
	uid := member.call("GET", "/api/v1/meta", nil, 200)["current_user"]
	todo := agentA.call("POST", "/api/v1/todos", map[string]any{"title": "Cross-session delivery", "column_id": "backlog", "operation_id": store.ID(), "source_id": "stable-work"}, 200)
	id := todo["id"].(string)
	owner.call("POST", "/api/v1/delegations", map[string]any{"member_id": uid, "todo_id": id, "actions": []string{"edit"}, "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "operation_id": store.ID()}, 200)
	baseline := agentB.call("GET", "/api/v1/agent/changes", nil, 200)
	agentA.call("PATCH", "/api/v1/todos/"+id, map[string]any{"body": "Agent A committed progress", "expected_revision": todo["revision"], "operation_id": store.ID()}, 200)
	agentB.call("PATCH", "/api/v1/todos/"+id, map[string]any{"body": "Stale Agent B write", "expected_revision": todo["revision"], "operation_id": store.ID()}, 409)
	next := agentB.call("GET", "/api/v1/agent/changes?cursor="+baseline["next_cursor"].(string), nil, 200)
	if len(next["items"].([]any)) == 0 {
		t.Fatal("missed resumed change")
	}
	latest := agentB.call("GET", "/api/v1/todos/"+id, nil, 200)
	agentB.call("PATCH", "/api/v1/todos/"+id, map[string]any{"body": "Agent B resumed using latest revision", "expected_revision": latest["revision"], "operation_id": store.ID()}, 200)
	input := knowledgeInput("Decision with shared provenance")
	input["sources"] = []any{map[string]any{"kind": "todo", "id": id, "quote": "Only actual reviewed facts"}}
	entry := agentB.call("POST", "/api/v1/context", input, 200)
	confirmed := knowledgePatch(entry, "confirm")
	confirmed["state"] = "active"
	entry = owner.call("PATCH", "/api/v1/context/"+entry["id"].(string), confirmed, 200)
	// A new client reuses the same credential and stable task, without shared process memory.
	resumed := &authClient{t: t, h: agentA.h, token: agentA.token}
	h := resumed.call("GET", "/api/v1/agent/context?todo="+id, nil, 200)
	if len(h["knowledge"].(map[string]any)["items"].([]any)) != 1 {
		t.Fatal("confirmed scoped knowledge missing from handoff")
	}
	if len(resumed.call("GET", "/api/v1/todos", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("handoff duplicated task")
	}
}

func TestAssistantKnowledgeDraftRequiresConfirmation(t *testing.T) {
	owner, _, _ := assistantFixture(t, "propose_context", map[string]any{"knowledge": map[string]any{"title": "Model inferred decision", "body": "Synthetic source-free proposal; not established fact", "kind": "decision", "visibility": "team", "state": "active"}})
	config := configureAI(owner, "personal")
	turn := proposal(owner, config)
	actions := turn["turn"].(map[string]any)["actions"].([]any)
	if len(actions) != 1 {
		t.Fatal(turn)
	}
	if owner.call("GET", "/api/v1/context", nil, 200)["total"].(float64) != 0 {
		t.Fatal("model wrote before confirmation")
	}
	action := actions[0].(map[string]any)
	out := owner.call("POST", "/api/v1/assistant/actions/"+action["id"].(string), map[string]any{"decision": "confirm"}, 200)
	if out["state"] != "done" {
		t.Fatal(out)
	}
	xs := owner.call("GET", "/api/v1/context", nil, 200)["items"].([]any)
	if len(xs) != 1 || xs[0].(map[string]any)["state"] != "pending" {
		t.Fatal("model inference falsely established as fact")
	}
	owner.call("POST", "/api/v1/assistant/actions/"+action["id"].(string), map[string]any{"decision": "confirm"}, 200)
	if owner.call("GET", "/api/v1/context", nil, 200)["total"].(float64) != 1 {
		t.Fatal("confirmation duplicated knowledge")
	}
}

func TestKnowledgeReportRevisionAndDeletedSourceReplay(t *testing.T) {
	owner, _, _ := assistantFixture(t, "read_workspace", nil)
	r := owner.call("POST", "/api/v1/reports", map[string]any{"title": "Synthetic source", "body": "Original evidence", "source_id": store.ID(), "status": "progress"}, 200)
	at, e := time.Parse(time.RFC3339Nano, r["updated_at"].(string))
	if e != nil {
		t.Fatal(e)
	}
	input := knowledgeInput("Equivalent timestamp source")
	input["sources"] = []any{map[string]any{"kind": "report", "id": r["id"], "revision": at.In(time.FixedZone("QA offset", 8*3600)).Format(time.RFC3339Nano), "quote": "Read original evidence"}}
	x := owner.call("POST", "/api/v1/context", input, 200)
	if x["needs_review"] != false {
		t.Fatal("time-zone equivalent revision treated as a source change")
	}
	owner.call("DELETE", "/api/v1/reports/"+r["id"].(string), map[string]any{"expected_updated_at": r["updated_at"]}, 200)
	owner.call("GET", "/api/v1/context/"+x["id"].(string), nil, 404)
	owner.call("POST", "/api/v1/context", input, 404)
}
func TestTaskBlockersCompletionAcrossRoutes(t *testing.T) {
	owner, reviewer, _ := assistantFixture(t, "read_workspace", nil)
	rid := reviewer.call("GET", "/api/v1/meta", nil, 200)["current_user"]
	up := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Unfinished prerequisite", "column_id": "doing", "operation_id": store.ID(), "source_id": store.ID()}, 200)
	down := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Blocked acceptance", "column_id": "backlog", "operation_id": store.ID(), "source_id": store.ID(), "blockers": []any{map[string]any{"todo_id": up["id"], "condition": "Complete original work"}}, "review": map[string]any{"criteria": "Reviewed evidence", "reviewer_id": rid}}, 200)
	id := down["id"].(string)
	board := owner.call("GET", "/api/v1/todo-board", nil, 200)
	var col map[string]any
	for _, v := range board["columns"].([]any) {
		x := v.(map[string]any)
		if x["id"] == "backlog" {
			col = x
		}
	}
	owner.call("PATCH", "/api/v1/todo-columns/backlog", map[string]any{"name": "Backlog", "done": true, "expected_revision": col["revision"], "board_revision": board["revision"], "operation_id": store.ID()}, 400)
	owner.call("POST", "/api/v1/reports", map[string]any{"title": "Must roll back", "body": "No implicit completion", "source_id": store.ID(), "todo_ids": []string{id}, "todo_moves": []any{map[string]any{"id": id, "column_id": "done", "expected_revision": down["revision"]}}}, 400)
	down = owner.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "submit-review", "body": "Evidence prepared, prerequisite unfinished", "expected_revision": down["revision"], "operation_id": store.ID()}, 200)
	board = owner.call("GET", "/api/v1/todo-board", nil, 200)
	reviewer.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "approve-review", "expected_revision": down["revision"], "board_revision": board["revision"], "operation_id": store.ID()}, 400)
	latest := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
	if latest["completed_at"] != nil || latest["review"].(map[string]any)["state"] != "pending" {
		t.Fatal("failed completion partially committed")
	}
}
func TestProjectDelegationRevokesOnMergeAndGrantorRoleLoss(t *testing.T) {
	owner, guest, _ := assistantFixture(t, "read_workspace", nil)
	uid := guest.call("GET", "/api/v1/meta", nil, 200)["current_user"].(string)
	a := owner.call("POST", "/api/v1/catalog/project", map[string]any{"name": "Synthetic A", "state": "active"}, 201)
	b := owner.call("POST", "/api/v1/catalog/project", map[string]any{"name": "Synthetic B", "state": "active"}, 201)
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Scoped task", "column_id": "backlog", "project_id": a["id"], "operation_id": store.ID(), "source_id": store.ID()}, 200)
	id := task["id"].(string)
	in := knowledgeInput("Project scoped knowledge")
	in["project_id"] = a["id"]
	entry := owner.call("POST", "/api/v1/context", in, 200)
	grant := map[string]any{"member_id": uid, "project_id": a["id"], "actions": []string{"edit"}, "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "operation_id": store.ID()}
	delegation := owner.call("POST", "/api/v1/delegations", grant, 200)
	task = guest.call("PATCH", "/api/v1/todos/"+id, map[string]any{"body": "Within scope", "expected_revision": task["revision"], "operation_id": store.ID()}, 200)
	owner.call("POST", "/api/v1/catalog/project/"+a["id"].(string)+"/merge", map[string]any{"target_id": b["id"]}, 200)
	migrated := owner.call("GET", "/api/v1/context/"+entry["id"].(string), nil, 200)
	if migrated["project_id"] != b["id"] {
		t.Fatal("Context classification did not follow merge")
	}
	grants := guest.call("GET", "/api/v1/delegations", nil, 200)["items"].([]any)
	found := false
	for _, v := range grants {
		x := v.(map[string]any)
		if x["id"] == delegation["id"] {
			found = x["revoked_at"] != nil
		}
	}
	if !found {
		t.Fatal("project merge broadened old grant")
	}
	task = owner.call("GET", "/api/v1/todos/"+id, nil, 200)
	guest.call("PATCH", "/api/v1/todos/"+id, map[string]any{"body": "Outside old grant", "expected_revision": task["revision"], "operation_id": store.ID()}, 403)
	// A project grant depends on the grantor remaining an administrator, even for
	// a task they created themselves. Use a non-admin grantee to avoid role bypass.
	owner.call("PATCH", "/api/v1/members/"+uid, map[string]any{"role": "admin"}, 200)
	invite := owner.call("POST", "/api/v1/invites", map[string]any{"email": "delegated-third@example.test"}, 201)
	third := &authClient{t: t, h: owner.h}
	third.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": invite["token"], "name": "Third", "password": "synthetic-third-password"}, 200)
	thirdID := third.call("GET", "/api/v1/meta", nil, 200)["current_user"]
	if len(third.call("GET", "/api/v1/delegations", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("unrelated member can read another member's delegation")
	}
	ownerID := owner.call("GET", "/api/v1/meta", nil, 200)["current_user"].(string)
	owner.call("POST", "/api/v1/delegations", map[string]any{"member_id": thirdID, "project_id": b["id"], "actions": []string{"edit"}, "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "operation_id": store.ID()}, 200)
	guest.call("PATCH", "/api/v1/members/"+ownerID, map[string]any{"role": "member"}, 200)
	third.call("PATCH", "/api/v1/todos/"+id, map[string]any{"body": "Grantor lost admin role", "expected_revision": task["revision"], "operation_id": store.ID()}, 403)
}

func TestWikiHTTPDirectoryScopeAndIndirectReadPermissions(t *testing.T) {
	owner, guest, _ := assistantFixture(t, "read_workspace", nil)
	rootInput := knowledgeInput("Synthetic Wiki introduction")
	rootInput["kind"] = "document"
	rootInput["state"] = "active"
	root := owner.call("POST", "/api/v1/context", rootInput, 200)
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Wiki source task", "column_id": "backlog", "source_id": store.ID(), "operation_id": store.ID()}, 200)
	evidenceInput := knowledgeInput("Source-backed fact")
	evidenceInput["parent_id"] = root["id"]
	evidenceInput["state"] = "active"
	evidenceInput["sources"] = []any{map[string]any{"kind": "todo", "id": task["id"], "quote": "Synthetic source excerpt"}}
	evidence := owner.call("POST", "/api/v1/context", evidenceInput, 200)
	guideInput := knowledgeInput("Compiled Wiki guide")
	guideInput["kind"] = "document"
	guideInput["parent_id"] = root["id"]
	guideInput["sources"] = []any{map[string]any{"kind": "context", "id": evidence["id"], "revision": "1", "quote": "Source-backed fact"}}
	guide := owner.call("POST", "/api/v1/context", guideInput, 200)
	tree := guest.call("GET", "/api/v1/context-tree", nil, 200)
	raw, _ := json.Marshal(tree)
	if strings.Contains(string(raw), "Synthetic source excerpt") || strings.Contains(string(raw), "Synthetic reviewed decision") {
		t.Fatal("directory includes document body")
	}
	if len(tree["items"].([]any)) != 3 {
		t.Fatal(tree)
	}
	token := &authClient{t: t, h: guest.h, token: guest.call("POST", "/api/v1/tokens", map[string]any{"name": "Context-only Wiki reader", "scopes": []string{"context:read"}}, 201)["credential"].(string)}
	token.call("GET", "/api/v1/context/"+guide["id"].(string), nil, 404)
	if len(token.call("GET", "/api/v1/context-tree", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("indirect Todo scope bypass")
	}
	filtered := guest.call("GET", "/api/v1/context-tree?kind=document&q=Compiled", nil, 200)
	if len(filtered["items"].([]any)) != 1 || filtered["items"].([]any)[0].(map[string]any)["id"] != guide["id"] {
		t.Fatal("exploration metadata filters ignored", filtered)
	}
	if len(token.call("GET", "/api/v1/context-tree?kind=document&q=Compiled", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("filtered exploration exposes unreadable source metadata")
	}
	if len(guest.call("GET", "/api/v1/context-tree?source=todo", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("exploration source filter ignored")
	}

	cycle := knowledgePatch(root, "edit")
	cycle["parent_id"] = guide["id"]
	owner.call("PATCH", "/api/v1/context/"+root["id"].(string), cycle, 400)
	changed := knowledgePatch(evidence, "edit")
	changed["body"] = "Updated source decision"
	evidence = owner.call("PATCH", "/api/v1/context/"+evidence["id"].(string), changed, 200)
	if guest.call("GET", "/api/v1/context/"+guide["id"].(string), nil, 200)["needs_review"] != true {
		t.Fatal("source revision change not surfaced")
	}
	changed = knowledgePatch(evidence, "edit")
	changed["parent_id"] = ""
	changed["visibility"] = "personal"
	owner.call("PATCH", "/api/v1/context/"+evidence["id"].(string), changed, 200)
	guest.call("GET", "/api/v1/context/"+guide["id"].(string), nil, 404)
	if len(guest.call("GET", "/api/v1/context-tree", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("private evidence leaked into Wiki tree")
	}
}

func TestAssistantWikiTemplatePreservesParentSourcesAndConfirmation(t *testing.T) {
	args := map[string]any{}
	owner, _, _ := assistantFixture(t, "propose_context", args)
	rootInput := knowledgeInput("Synthetic Wiki root")
	rootInput["kind"] = "document"
	rootInput["state"] = "active"
	root := owner.call("POST", "/api/v1/context", rootInput, 200)
	args["knowledge"] = map[string]any{"title": "Synthetic organized guide", "body": "# Guide\n\nSourced synthetic summary.", "kind": "document", "visibility": "team", "parent_id": root["id"], "sources": []any{map[string]any{"kind": "context", "id": root["id"], "revision": "1", "quote": "Synthetic reviewed decision"}}}
	config := configureAI(owner, "personal")
	response := owner.call("POST", "/api/v1/assistant/chat", map[string]any{"request_id": store.ID(), "config_id": config, "message": "Organize all permitted Context into a guide", "template_id": "builtin-wiki", "template_version": 1, "parameters": map[string]any{"project": "All permitted Context"}, "locale": "en"}, 200)
	actions := response["turn"].(map[string]any)["actions"].([]any)
	if len(actions) != 1 {
		t.Fatal(response)
	}
	if owner.call("GET", "/api/v1/context", nil, 200)["total"].(float64) != 1 {
		t.Fatal("Wiki template wrote before confirmation")
	}
	id := actions[0].(map[string]any)["id"].(string)
	action := owner.call("POST", "/api/v1/assistant/actions/"+id, map[string]any{"decision": "confirm"}, 200)
	receipt := action["result"].(map[string]any)
	result := owner.call("GET", "/api/v1/context/"+receipt["id"].(string), nil, 200)
	if result["state"] != "pending" || result["parent_id"] != root["id"] || len(result["sources"].([]any)) != 1 {
		t.Fatal(result)
	}
	owner.call("POST", "/api/v1/assistant/actions/"+id, map[string]any{"decision": "confirm"}, 200)
	if owner.call("GET", "/api/v1/context", nil, 200)["total"].(float64) != 2 {
		t.Fatal("Wiki confirmation replay duplicated document")
	}
}

func TestContextOneClickAutomaticallySavesActivatesAndReplays(t *testing.T) {
	args := map[string]any{}
	owner, guest, _ := assistantFixture(t, "propose_context", args)
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Synthetic source for automatic extraction", "body": "A reviewed delivery rule", "column_id": "backlog", "source_id": store.ID(), "operation_id": store.ID()}, 200)
	args["knowledge"] = map[string]any{"title": "Synthetic automatic guide", "body": "# Guide\n\nA source-backed rule.", "kind": "document", "visibility": "team", "project_id": "", "sources": []any{map[string]any{"kind": "todo", "id": task["id"], "revision": "1", "quote": "A reviewed delivery rule"}}}
	config := configureAI(owner, "personal")
	in := map[string]any{"config_id": config, "request_id": "auto-test-" + store.ID(), "source_kind": "todo", "source_id": task["id"], "mode": "extract", "locale": "en"}
	result := owner.call("POST", "/api/v1/assistant/context-auto", in, 200)
	if len(result["errors"].([]any)) != 0 || len(result["items"].([]any)) != 1 {
		t.Fatal(result)
	}
	item := result["items"].([]any)[0].(map[string]any)
	if item["state"] != "active" {
		t.Fatal("one-click extraction still requires routine confirmation:", item)
	}
	again := owner.call("POST", "/api/v1/assistant/context-auto", in, 200)
	if len(again["errors"].([]any)) != 0 || again["items"].([]any)[0].(map[string]any)["id"] != item["id"] {
		t.Fatal("automatic replay failed", again)
	}
	in["request_id"] = "auto-second-" + store.ID()
	owner.call("POST", "/api/v1/assistant/context-auto", in, 200)
	if owner.call("GET", "/api/v1/context", nil, 200)["total"].(float64) != 1 {
		t.Fatal("same subject duplicated on repeated extraction")
	}
	token := &authClient{t: t, h: guest.h, token: guest.call("POST", "/api/v1/tokens", map[string]any{"name": "Token cannot self-authorize automatic execution", "scopes": []string{"context:read", "context:write", "todos:read"}}, 201)["credential"].(string)}
	token.call("POST", "/api/v1/assistant/context-auto", in, 403)
}

func TestContextOneClickCannotWriteOtherModulesOrIgnoreSourceRevision(t *testing.T) {
	args := map[string]any{"title": "Must not create a task", "column_id": "backlog"}
	owner, _, _ := assistantFixture(t, "propose_todo", args)
	config := configureAI(owner, "personal")
	result := owner.call("POST", "/api/v1/assistant/context-auto", map[string]any{"config_id": config, "request_id": "auto-denied-" + store.ID(), "mode": "organize"}, 200)
	if len(result["items"].([]any)) != 0 || len(result["errors"].([]any)) == 0 {
		t.Fatal(result)
	}
	if len(owner.call("GET", "/api/v1/todos", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("Context mandate created a task")
	}
}

func TestContextOneClickRejectsChangedSourceAndRetainsUnconfirmedSourceState(t *testing.T) {
	args := map[string]any{}
	owner, _, _ := assistantFixture(t, "propose_context", args)
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Synthetic revision source", "column_id": "backlog", "source_id": store.ID(), "operation_id": store.ID()}, 200)
	args["knowledge"] = map[string]any{"title": "Stale automatic document", "body": "A sourced summary", "kind": "document", "visibility": "team", "sources": []any{map[string]any{"kind": "todo", "id": task["id"], "revision": "999", "quote": "Source"}}}
	config := configureAI(owner, "personal")
	result := owner.call("POST", "/api/v1/assistant/context-auto", map[string]any{"config_id": config, "request_id": "stale-auto-" + store.ID(), "source_kind": "todo", "source_id": task["id"]}, 200)
	if len(result["errors"].([]any)) == 0 || owner.call("GET", "/api/v1/context", nil, 200)["total"].(float64) != 0 {
		t.Fatal("stale source was published", result)
	}
	pending := owner.call("POST", "/api/v1/context", knowledgeInput("Unconfirmed original"), 200)
	args["knowledge"] = map[string]any{"title": "Unconfirmed derived document", "body": "An unresolved proposal, not a confirmed decision.", "kind": "document", "visibility": "team", "sources": []any{map[string]any{"kind": "context", "id": pending["id"], "revision": "1", "quote": "Unconfirmed original"}}}
	result = owner.call("POST", "/api/v1/assistant/context-auto", map[string]any{"config_id": config, "request_id": "pending-auto-" + store.ID(), "source_kind": "context", "source_id": pending["id"]}, 200)
	if len(result["items"].([]any)) != 1 {
		t.Fatal(result)
	}
	item := result["items"].([]any)[0].(map[string]any)
	if item["state"] != "pending" || item["needs_review"] != true {
		t.Fatal("unconfirmed source automatically established as fact", item)
	}
}

func TestKnowledgeGraphModuleLinksAndScopePrivacy(t *testing.T) {
	owner, guest, _ := assistantFixture(t, "read_workspace", nil)
	project := owner.call("POST", "/api/v1/catalog/project", map[string]any{"name": "Synthetic graph project", "state": "active"}, 201)
	owner.call("POST", "/api/v1/catalog/domain", map[string]any{"name": "Graph delivery", "state": "active"}, 201)
	pid := project["id"]
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Graph source task", "body": "DO NOT RETURN ORIGINAL TASK BODY", "project_id": pid, "domains": []string{"Graph delivery"}, "column_id": "backlog", "source_id": store.ID(), "operation_id": store.ID()}, 200)
	report := owner.call("POST", "/api/v1/reports", map[string]any{"title": "Graph progress evidence", "body": "DO NOT RETURN ORIGINAL REPORT BODY", "status": "progress", "project_id": pid, "domains": []string{"Graph delivery"}, "source_id": store.ID()}, 200)
	event := owner.call("POST", "/api/v1/calendar/events", map[string]any{"title": "Graph Calendar phase", "kind": "phase", "project_id": pid, "domains": []string{"Graph delivery"}, "schedule": map[string]any{"kind": "date-range", "start_date": "2030-01-01", "end_date": "2030-01-05"}, "todo_ids": []any{task["id"]}, "report_ids": []any{report["id"]}, "source_id": store.ID(), "operation_id": store.ID()}, 200)
	rootInput := knowledgeInput("Graph project introduction")
	rootInput["kind"] = "document"
	rootInput["project_id"] = pid
	rootInput["domains"] = []string{"Graph delivery"}
	root := owner.call("POST", "/api/v1/context", rootInput, 200)
	child := knowledgeInput("Graph derived guide")
	child["kind"] = "document"
	child["project_id"] = pid
	child["domains"] = []string{"Graph delivery"}
	child["parent_id"] = root["id"]
	child["sources"] = []any{map[string]any{"kind": "todo", "id": task["id"]}, map[string]any{"kind": "report", "id": report["id"]}, map[string]any{"kind": "calendar", "id": event["id"]}}
	owner.call("POST", "/api/v1/context", child, 200)
	private := knowledgeInput("PRIVATE GRAPH RECORD")
	private["visibility"] = "personal"
	owner.call("POST", "/api/v1/context", private, 200)
	graph := guest.call("GET", "/api/v1/context-graph", nil, 200)
	raw, _ := json.Marshal(graph)
	if strings.Contains(string(raw), "DO NOT RETURN") || strings.Contains(string(raw), "PRIVATE GRAPH") {
		t.Fatal("graph returned private content")
	}
	kinds := map[string]bool{}
	ids := map[string]bool{}
	for _, raw := range graph["nodes"].([]any) {
		n := raw.(map[string]any)
		kinds[n["kind"].(string)] = true
		ids[n["key"].(string)] = true
	}
	for _, k := range []string{"context", "project", "domain", "todo", "report", "calendar"} {
		if !kinds[k] {
			t.Fatal("missing node type", k, graph)
		}
	}
	relation := map[string]bool{}
	for _, raw := range graph["edges"].([]any) {
		edge := raw.(map[string]any)
		if !ids[edge["from"].(string)] || !ids[edge["to"].(string)] {
			t.Fatal("dangling relation")
		}
		relation[edge["kind"].(string)] = true
	}
	if !relation["parent"] || !relation["source"] || !relation["calendar_todo"] || !relation["calendar_report"] {
		t.Fatal(graph)
	}
	token := &authClient{t: t, h: guest.h, token: guest.call("POST", "/api/v1/tokens", map[string]any{"name": "Graph knowledge-only reader", "scopes": []string{"context:read"}}, 201)["credential"].(string)}
	limited := token.call("GET", "/api/v1/context-graph", nil, 200)
	if limited["total_contexts"].(float64) != 1 {
		t.Fatal("unreadable sources leaked into count", limited)
	}
	for _, raw := range limited["nodes"].([]any) {
		kind := raw.(map[string]any)["kind"]
		if kind == "todo" || kind == "report" || kind == "calendar" {
			t.Fatal("indirect scope bypass")
		}
	}
	if len(guest.call("GET", "/api/v1/context-graph?project=unrelated", nil, 200)["nodes"].([]any)) != 0 {
		t.Fatal("project scope ignored")
	}
	owner.call("DELETE", "/api/v1/reports/"+report["id"].(string), map[string]any{"expected_updated_at": report["updated_at"]}, 200)
	if guest.call("GET", "/api/v1/context-graph", nil, 200)["total_contexts"].(float64) != 1 {
		t.Fatal("deleted source derived node retained")
	}
}

func TestContextOneClickCommitsProposalWithoutExtraNarrationRound(t *testing.T) {
	owner, _, repo := assistantFixture(t, "propose_context", map[string]any{})
	config := configureAI(owner, "personal")
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Synthetic bounded extraction source", "column_id": "backlog", "source_id": store.ID(), "operation_id": store.ID()}, 200)
	for _, proposalRound := range []int{5, 6} {
		calls := 0
		client := &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
			calls++
			name, args := "read_workspace", map[string]any{}
			if calls == proposalRound {
				name = "propose_context"
				args["knowledge"] = map[string]any{"title": fmt.Sprintf("Synthetic bounded proposal %d", proposalRound), "body": "A source-backed extraction.", "kind": "document", "visibility": "team", "sources": []any{map[string]any{"kind": "todo", "id": task["id"], "revision": "1"}}}
			}
			if calls > proposalRound {
				t.Fatal("an unnecessary narration request discarded valid work")
			}
			arguments, _ := json.Marshal(args)
			body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": "tool_calls", "message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": fmt.Sprintf("call-%d", calls), "type": "function", "function": map[string]any{"name": name, "arguments": string(arguments)}}}}}}})
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(string(body)))}, nil
		})}
		owner.h = NewWithConfig(repo, Config{Identity: identity.New(repo.Pool()), BootstrapToken: testBootstrapToken, AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: client})
		in := map[string]any{"config_id": config, "request_id": "bounded-" + store.ID(), "source_kind": "todo", "source_id": task["id"], "mode": "extract"}
		result := owner.call("POST", "/api/v1/assistant/context-auto", in, 200)
		if len(result["errors"].([]any)) != 0 || len(result["items"].([]any)) != 1 || calls != proposalRound {
			t.Fatal("bounded proposal was not saved", calls, result["errors"])
		}
		item := result["items"].([]any)[0].(map[string]any)
		saved := owner.call("GET", "/api/v1/context/"+item["id"].(string), nil, 200)
		if saved["state"] != "active" {
			t.Fatal("proposal did not activate")
		}
		owner.call("POST", "/api/v1/assistant/context-auto", in, 200)
		if calls != proposalRound {
			t.Fatal("replay invoked model again")
		}
	}
}
