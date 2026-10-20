package httpapi

import (
	"bytes"
	"coflow/api/internal/store"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func call(t *testing.T, h interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, method, path, body, origin string) (int, []byte) {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w.Code, w.Body.Bytes()
}
func TestReportIdempotencyAndDiscussion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "demo.json")
	m, err := store.NewMemory(path)
	if err != nil {
		t.Fatal(err)
	}
	h := New(m)
	payload := `{"source_id":"unique-job","author_id":"lin","team_id":"forged","title":"完成开发","domain":"研发","project_id":"website","links":[{"title":"预览","url":"https://example.com"}]}`
	code, b := call(t, h, "POST", "/api/v1/reports", payload, "http://127.0.0.1:3000")
	if code != 200 {
		t.Fatalf("create %d %s", code, b)
	}
	var first store.Report
	_ = json.Unmarshal(b, &first)
	if first.AuthorID != "chen" || first.TeamID != "demo" {
		t.Fatal("client-controlled identity accepted")
	}
	code, b = call(t, h, "POST", "/api/v1/reports/"+first.ID+"/comments", `{"body":"请补充预览"}`, "")
	if code != 201 {
		t.Fatalf("comment %d %s", code, b)
	}
	code, b = call(t, h, "POST", "/api/v1/reports", payload, "")
	var second store.Report
	_ = json.Unmarshal(b, &second)
	if code != 200 || first.ID != second.ID || !first.CreatedAt.Equal(second.CreatedAt) || len(second.Comments) != 1 {
		t.Fatalf("retry lost identity or comments: %d %s", code, b)
	}
	reloaded, err := store.NewMemory(path)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := reloaded.Get(t.Context(), "demo", first.ID)
	if err != nil || len(saved.Comments) != 1 {
		t.Fatal("discussion not persisted")
	}
	if _, err = reloaded.Get(t.Context(), "other-team", first.ID); err != store.ErrNotFound {
		t.Fatal("team boundary not enforced")
	}
}
func TestInputValidationAndOwnership(t *testing.T) {
	m, _ := store.NewMemory("")
	h := New(m)
	for _, body := range []string{`{"title":""}`, `{"title":"x","links":[{"url":"javascript:alert(1)"}]}`, `{"title":"x","domain":"new category"}`, `{"title":"x","project_id":"missing"}`, `{"title":"x","status":"wrong"}`} {
		code, b := call(t, h, "POST", "/api/v1/reports", body, "")
		if code != 400 {
			t.Fatalf("expected invalid input, got %d %s", code, b)
		}
	}
	code, _ := call(t, h, "PATCH", "/api/v1/reports/demo-video", `{"status":"resolved"}`, "")
	if code != 403 {
		t.Fatal("another author's update allowed")
	}
	code, _ = call(t, h, "POST", "/api/v1/reports", `{"title":"x"}`, "https://evil.example")
	if code != 403 {
		t.Fatal("cross-site write allowed")
	}
	code, _ = call(t, h, "POST", "/api/v1/reports/missing/comments", `{"body":"x"}`, "")
	if code != 404 {
		t.Fatal("orphan comment allowed")
	}
}
