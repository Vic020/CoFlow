package httpapi

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/json"
	"strings"
	"testing"
)

func TestAssistantAccountConfigAcrossWorkspaces(t *testing.T) {
	owner, guest, repo := assistantFixture(t, "find_todos", map[string]any{})
	ctx := t.Context()
	me := owner.call("GET", "/api/v1/auth/me", nil, 200)
	teamA := me["current_team"].(string)
	user := me["user"].(map[string]any)["id"].(string)
	shared := configureAI(owner, "team")
	personal := configureAI(owner, "personal")
	guestID := guest.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"].(string)
	owner.call("PATCH", "/api/v1/members/"+guestID, map[string]any{"role": "admin"}, 200)
	guest.call("POST", "/api/v1/assistant/configs/"+personal+"/verify", nil, 404)
	guest.call("POST", "/api/v1/assistant/chat", map[string]any{"config_id": personal, "request_id": "foreign-account", "message": "Read"}, 404)
	first := proposal(owner, personal)
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Account AI second workspace", "display_name": "Owner"}, 201)
	teamB := owner.call("GET", "/api/v1/auth/me", nil, 200)["current_team"].(string)
	items := owner.call("GET", "/api/v1/assistant/configs", nil, 200)["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["id"] != personal {
		t.Fatal("account config missing or team config crossed workspace", items)
	}
	owner.call("GET", "/api/v1/assistant/conversations/"+first["conversation_id"].(string), nil, 404)
	owner.call("POST", "/api/v1/assistant/chat", map[string]any{"config_id": shared, "request_id": "wrong-team", "message": "Read"}, 404)
	proposal(owner, personal)
	block, _ := aes.NewCipher(make([]byte, 32))
	aead, _ := cipher.NewGCM(block)
	nonce := make([]byte, aead.NonceSize())
	legacy := "synthetic_legacy_account"
	sealed := aead.Seal(nonce, nonce, []byte("synthetic-legacy-key"), []byte(legacy+":"+teamA+":"+user))
	_, e := repo.Pool().Exec(ctx, `INSERT INTO assistant_configs(id,team_id,owner_id,name,provider,protocol,base_url,model,secret,secret_context) VALUES($1,NULL,$2,'Legacy','compatible','chat-completions','https://models.example.test/v1','test-model',$3,$4)`, legacy, user, sealed, teamA)
	if e != nil {
		t.Fatal(e)
	}
	owner.call("POST", "/api/v1/assistant/configs/"+legacy+"/verify", nil, 200)
	update := map[string]any{"scope": "personal", "name": "Renamed account model", "provider": "compatible", "protocol": "chat-completions", "base_url": "https://models.example.test/v1", "model": "test-model", "expected_revision": 1, "is_default": true}
	saved := owner.call("PUT", "/api/v1/assistant/configs/"+legacy, update, 200)
	if saved["verified_at"] == nil {
		t.Fatal("renaming invalidated legacy verification")
	}
	var cryptoContext string
	if e = repo.Pool().QueryRow(ctx, `SELECT secret_context FROM assistant_configs WHERE id=$1`, legacy).Scan(&cryptoContext); e != nil || cryptoContext != "" {
		t.Fatal("legacy context not normalized on edit", e)
	}
	proposal(owner, legacy)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": teamA}, 200)
	result := owner.call("GET", "/api/v1/assistant/configs", nil, 200)
	defaultCount := 0
	for _, item := range result["items"].([]any) {
		v := item.(map[string]any)
		if v["scope"] == "personal" && v["is_default"] == true {
			defaultCount++
			if v["id"] != legacy {
				t.Fatal("account default differs by workspace")
			}
		}
	}
	if defaultCount != 1 {
		t.Fatal("account defaults not unique")
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "synthetic-legacy-key") || strings.Contains(string(raw), "secret_context") {
		t.Fatal("private encryption metadata leaked")
	}
	guest.call("PUT", "/api/v1/assistant/configs/"+legacy, update, 404)
	guest.call("DELETE", "/api/v1/assistant/configs/"+legacy, map[string]any{"expected_revision": 2}, 404)
	owner.call("DELETE", "/api/v1/assistant/configs/"+legacy, map[string]any{"expected_revision": 2}, 200)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": teamB}, 200)
	owner.call("POST", "/api/v1/assistant/configs/"+legacy+"/verify", nil, 404)
	proposal(owner, personal)
}
