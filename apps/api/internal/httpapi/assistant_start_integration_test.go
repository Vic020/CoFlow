package httpapi

import (
	"bytes"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestAssistantConversationVisibleBeforeFirstReply(t *testing.T) {
	owner, guest, repo := assistantFixture(t, "read_workspace", map[string]any{})
	config := configureAI(owner, "personal")
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	var calls atomic.Int32
	client := &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		close(entered)
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"Synthetic reply"}}]}`))}, nil
	})}
	owner.h = NewWithConfig(repo, Config{Identity: identity.New(repo.Pool()), AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: client})
	guest.h = owner.h
	in := map[string]any{"config_id": config, "request_id": store.ID(), "message": "Synthetic newly started conversation"}
	c := owner.call("POST", "/api/v1/assistant/conversations", in, 200)
	id := c["id"].(string)
	if calls.Load() != 0 || c["unanswered"] == nil {
		t.Fatal("creation called model or lost initial request")
	}
	if owner.call("POST", "/api/v1/assistant/conversations", in, 200)["id"] != id {
		t.Fatal("duplicate reservation")
	}
	guest.call("GET", "/api/v1/assistant/conversations/"+id, nil, 404)
	in["conversation_id"] = id
	body, _ := json.Marshal(in)
	r := httptest.NewRequest("POST", "/api/v1/assistant/chat", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(owner.cookie)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { w := httptest.NewRecorder(); owner.h.ServeHTTP(w, r); done <- w }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("model did not start")
	}
	history := owner.call("GET", "/api/v1/assistant/conversations", nil, 200)
	if len(history["items"].([]any)) != 1 || history["items"].([]any)[0].(map[string]any)["id"] != id {
		t.Fatal("in-flight conversation missing")
	}
	pending := owner.call("GET", "/api/v1/assistant/conversations/"+id, nil, 200)
	if pending["unanswered"] == nil {
		t.Fatal("pending incorrectly complete")
	}
	once.Do(func() { close(release) })
	select {
	case w := <-done:
		if w.Code != 200 {
			t.Fatal("chat failed", w.Code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("reply did not finish")
	}
	saved := owner.call("GET", "/api/v1/assistant/conversations/"+id, nil, 200)
	if saved["unanswered"] != nil || len(saved["turns"].([]any)) != 1 {
		t.Fatal("completion state wrong")
	}
	owner.call("POST", "/api/v1/assistant/chat", in, 200)
	if calls.Load() != 1 {
		t.Fatal("replay called model twice")
	}
	owner.h = NewWithConfig(repo, Config{Identity: identity.New(repo.Pool()), AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: &http.Client{Transport: modelTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("synthetic connection failure") })}})
	failed := map[string]any{"config_id": config, "request_id": store.ID(), "message": "Synthetic interrupted first turn"}
	owner.call("POST", "/api/v1/assistant/chat", failed, 400)
	reserved := owner.call("POST", "/api/v1/assistant/conversations", failed, 200)
	if reserved["unanswered"] == nil {
		t.Fatal("failure lost unanswered input")
	}
	owner.call("PATCH", "/api/v1/assistant/conversations/"+reserved["id"].(string), map[string]any{"action": "archive", "expected_revision": reserved["revision"]}, 200)
	owner.call("POST", "/api/v1/assistant/conversations", failed, 409)
	changed := map[string]any{"config_id": config, "request_id": store.ID(), "message": "Synthetic pending configuration change"}
	header := owner.call("POST", "/api/v1/assistant/conversations", changed, 200)
	if _, err := repo.Pool().Exec(t.Context(), "UPDATE assistant_configs SET revision=revision+1 WHERE id=$1", config); err != nil {
		t.Fatal(err)
	}
	changed["conversation_id"] = header["id"]
	if owner.call("POST", "/api/v1/assistant/chat", changed, 400)["error"] != "AI 配置已变化，请开始新对话" {
		t.Fatal("pending snapshot change was not rejected before model call")
	}
	var count int
	if err := repo.Pool().QueryRow(t.Context(), "SELECT count(*) FROM assistant_actions").Scan(&count); err != nil || count != 0 {
		t.Fatal("unexpected action writes")
	}
}
