package assistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestDeepseekWebRoutingBudgetAndSources(t *testing.T) {
	calls := 0
	body := `{"results":[{"title":"Official docs","url":"https://docs.example.com/guide","summary":"Public facts"},{"title":"unsafe","url":"https://127.0.0.1/private"}]}`
	s := &Service{Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.deepseek.com" || r.Header.Get("Authorization") != "Bearer synthetic-key" {
			t.Fatal("credential sent elsewhere")
		}
		var input map[string]any
		json.NewDecoder(r.Body).Decode(&input)
		if r.URL.Path == "/v1/tools/search" {
			if input["need_content"] != false || input["count"] != float64(5) || input["ori_question"] != nil || input["localization"] != nil {
				t.Fatal("search contract/privacy lost")
			}
		} else if r.URL.Path != "/v1/tools/fetch" || input["url"] != "https://docs.example.com/guide" {
			t.Fatal("unexpected fetch")
		}
		return response(body), nil
	})}}
	w := newDeepseekWeb("")
	result, e := s.webTool(context.Background(), w, "web_search", `{"query":"public release"}`, "synthetic-key")
	if e != nil || len(w.sources) != 1 {
		t.Fatal(e)
	}
	if _, e = s.webTool(context.Background(), w, "web_search", `{"query":"public release"}`, "synthetic-key"); e != nil || calls != 1 {
		t.Fatal("duplicate search billed")
	}
	if _, e = s.webTool(context.Background(), w, "web_fetch", `{"url":"https://other.example.com"}`, "synthetic-key"); e == nil || calls != 1 {
		t.Fatal("unapproved URL fetched")
	}
	body = `{"title":"Docs","content":"` + strings.Repeat("x", 9000) + ` synthetic-key"}`
	result, e = s.webTool(context.Background(), w, "web_fetch", `{"url":"https://docs.example.com/guide"}`, "synthetic-key")
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "synthetic-key") || result.(map[string]any)["truncated"] != true {
		t.Fatal("fetch not bounded/redacted")
	}
	body = `{"results":[]}`
	if _, e = s.webTool(context.Background(), w, "web_search", `{"query":"another"}`, "synthetic-key"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.webTool(context.Background(), w, "web_search", `{"query":"fourth"}`, "synthetic-key"); e == nil || calls != 3 {
		t.Fatal("request budget bypassed")
	}
}
func TestDeepseekWebFailureAndURLGuards(t *testing.T) {
	c := Config{Provider: "deepseek", Protocol: "chat-completions", BaseURL: "https://api.deepseek.com/v1"}
	if !deepseekWebSupported(c) {
		t.Fatal("official API rejected")
	}
	for _, base := range []string{"http://api.deepseek.com", "https://api.deepseek.com.evil.example", "https://proxy.example.com/v1", "https://api.deepseek.com/other"} {
		c.BaseURL = base
		if deepseekWebSupported(c) {
			t.Fatal("unapproved base accepted")
		}
	}
	for _, raw := range []string{"javascript:alert(1)", "http://example.com", "https://localhost./secret", "https://127.1/secret", "https://10.0.0.1", "https://u:p@example.com", "https://internal.local/", "https://2130706433"} {
		if safeWebURL(raw) != "" {
			t.Fatal("unsafe URL accepted")
		}
	}
	w := newDeepseekWeb("Read https://docs.example.com/guide")
	if !w.allowed["https://docs.example.com/guide"] {
		t.Fatal("explicit URL lost")
	}
	calls := 0
	s := &Service{Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 402, Body: io.NopCloser(strings.NewReader("synthetic-key private error"))}, nil
	})}}
	for i := 0; i < 2; i++ {
		_, e := s.webTool(context.Background(), w, "web_search", `{"query":"public"}`, "synthetic-key")
		if e == nil || strings.Contains(e.Error(), "synthetic-key") {
			t.Fatal("error leaked or swallowed")
		}
	}
	if calls != 1 {
		t.Fatal("failed provider retried automatically")
	}
	if _, e := s.webTool(context.Background(), newDeepseekWeb(""), "web_search", `{"query":"synthetic-key"}`, "synthetic-key"); e == nil || calls != 1 {
		t.Fatal("credential query sent")
	}
}
