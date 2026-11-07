package assistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"coflow/api/internal/identity"
)

func TestModelsDiscovery(t *testing.T) {
	p := identity.Principal{Kind: "session"}
	in := ModelsInput{Provider: "openai", BaseURL: "https://models.example.com/v1/", APIKey: "synthetic-key"}
	s := &Service{Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != "GET" || r.URL.String() != "https://models.example.com/v1/models" || r.Header.Get("Authorization") != "Bearer synthetic-key" || r.Body != nil {
			t.Fatal("incorrect discovery request")
		}
		return response(`{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"a-model"},{"id":""},{"id":"synthetic-key"},{"id":"bad\nmodel"}],"has_more":true}`), nil
	})}}
	v, e := s.Models(context.Background(), p, in)
	if e != nil || strings.Join(v.Items, ",") != "a-model,z-model" || !v.Truncated {
		t.Fatalf("models: %+v, %v", v, e)
	}
	for _, status := range []int{401, 403, 404, 405, 429, 500, 501, 302} {
		s.Client.Transport = transportFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("synthetic-key upstream private detail"))}, nil
		})
		_, e := s.Models(context.Background(), p, in)
		if e == nil || strings.Contains(e.Error(), "synthetic-key") || strings.Contains(e.Error(), "private detail") {
			t.Fatalf("unsafe status %d: %v", status, e)
		}
	}
}

func TestModelsLimitsAndValidation(t *testing.T) {
	calls := 0
	body := `{"data":[]}`
	s := &Service{Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) { calls++; return response(body), nil })}}
	p := identity.Principal{Kind: "session"}
	in := ModelsInput{Provider: "compatible", BaseURL: "https://models.example.com/v1", APIKey: "synthetic-key"}
	for _, bad := range []ModelsInput{{Provider: "unknown", BaseURL: in.BaseURL, APIKey: in.APIKey}, {Provider: in.Provider, BaseURL: "https://127.0.0.1", APIKey: in.APIKey}, {Provider: in.Provider, BaseURL: in.BaseURL}, {Provider: in.Provider, BaseURL: in.BaseURL, APIKey: "key\ninvalid"}} {
		if _, e := s.Models(context.Background(), p, bad); e == nil {
			t.Fatal("invalid request accepted")
		}
	}
	if _, e := s.Models(context.Background(), identity.Principal{Kind: "agent"}, in); e == nil {
		t.Fatal("agent accepted")
	}
	if calls != 0 {
		t.Fatal("invalid request reached provider")
	}
	items := []map[string]string{}
	for i := 0; i < 510; i++ {
		items = append(items, map[string]string{"id": strings.Repeat("x", i%140+1) + string(rune('a'+i/140))})
	}
	raw, _ := json.Marshal(map[string]any{"data": items})
	body = string(raw)
	v, e := s.Models(context.Background(), p, in)
	if e != nil || len(v.Items) != 500 || !v.Truncated {
		t.Fatalf("limit: %d %v", len(v.Items), e)
	}
	for _, bad := range []string{`{"error":"synthetic-key"}`, `not json`, strings.Repeat("x", (1<<20)+1)} {
		body = bad
		if _, e = s.Models(context.Background(), p, in); e == nil || strings.Contains(e.Error(), "synthetic-key") {
			t.Fatal("invalid response accepted or leaked")
		}
	}
}
