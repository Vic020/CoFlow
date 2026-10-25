package httpapi

import (
	"coflow/api/internal/identity"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBootstrapRequiresServerSecret(t *testing.T) {
	for _, tc := range []struct {
		name, configured, supplied string
		want                       int
	}{
		{"unconfigured", "", testBootstrapToken, 503},
		{"weak configuration", "too-short", "too-short", 503},
		{"missing", testBootstrapToken, "", 403},
		{"incorrect", testBootstrapToken, "wrong-token", 403},
		{"correct reaches payload validation", testBootstrapToken, testBootstrapToken, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// No identity/database is provided: rejected requests must never touch either.
			h := gin.New()
			registerIdentity(h, Config{BootstrapToken: tc.configured})
			paths := []string{"/api/v1/auth/bootstrap"}
			if tc.want != 400 {
				paths = append(paths, "/api/v1/auth/bootstrap/check")
			}
			for _, path := range paths {
				r := httptest.NewRequest("POST", path, strings.NewReader("{"))
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("X-CoFlow-Setup-Token", tc.supplied)
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				if w.Code != tc.want {
					t.Fatalf("expected %d, got %d", tc.want, w.Code)
				}
				if strings.Contains(w.Body.String(), testBootstrapToken) {
					t.Fatal("response leaked token")
				}
			}
		})
	}
}

func TestBootstrapTokenOnlyInitializesOnce(t *testing.T) {
	repo, service := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: service, BootstrapToken: testBootstrapToken})
	client := &authClient{t: t, h: h}
	client.call("POST", "/api/v1/auth/bootstrap/check", nil, 200)
	codes := make(chan int, 2)
	for range 2 {
		go func() {
			r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/bootstrap", strings.NewReader(`{"email":"setup@example.test","name":"Owner","password":"synthetic-password-123","team_name":"Test Team"}`))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-CoFlow-Setup-Token", testBootstrapToken)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			codes <- w.Code
		}()
	}
	a, b := <-codes, <-codes
	if !((a == 201 && b == 409) || (a == 409 && b == 201)) {
		t.Fatalf("concurrent bootstrap results %d, %d", a, b)
	}
	// Recreating the service/router simulates a restart: consuming setup is persistent.
	restarted := NewWithConfig(repo, Config{Identity: identity.New(repo.Pool()), BootstrapToken: testBootstrapToken})
	client = &authClient{t: t, h: restarted}
	client.call("POST", "/api/v1/auth/bootstrap/check", nil, 409)
	client.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "second@example.test", "name": "Second", "password": "synthetic-password-456", "team_name": "Second"}, 409)
}
