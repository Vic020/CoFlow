package assistant

import (
	"coflow/api/internal/identity"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type mcpTransport func(*http.Request) (*http.Response, error)

func (f mcpTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestMCPStreamableSessionHeadersAndSSE(t *testing.T) {
	s := &Service{Key: base64.StdEncoding.EncodeToString(make([]byte, 32))}
	p := identity.Principal{TeamID: "synthetic-team", UserID: "synthetic-owner"}
	owner := p.UserID
	c := MCPConnection{ID: "test-connection", URL: "https://mcp.example.test/mcp", owner: &owner}
	secret, e := s.seal("mcp:"+c.ID, p.TeamID, owner, "synthetic-only-token")
	if e != nil {
		t.Fatal(e)
	}
	c.secret = secret
	called := false
	s.Client = &http.Client{Transport: mcpTransport(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Authorization") != "Bearer synthetic-only-token" {
			t.Fatal("incorrect scoped bearer")
		}
		if req.Method == "DELETE" {
			return &http.Response{StatusCode: 204, Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		var b map[string]any
		if e := json.NewDecoder(req.Body).Decode(&b); e != nil {
			t.Fatal(e)
		}
		method, _ := b["method"].(string)
		headers := http.Header{"Content-Type": []string{"application/json"}}
		body := ""
		status := 200
		switch method {
		case "initialize":
			headers.Set("MCP-Session-Id", "synthetic-session")
			body = `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25"}}`
		case "notifications/initialized":
			if req.Header.Get("MCP-Session-Id") != "synthetic-session" || req.Header.Get("MCP-Protocol-Version") != "2025-11-25" {
				t.Fatal("missing negotiated headers")
			}
			status = 202
		case "tools/list":
			headers.Set("Content-Type", "text/event-stream")
			body = fmt.Sprintf("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":%.0f,\"result\":{\"tools\":[]}}\n\n", b["id"].(float64))
			called = true
		}
		return &http.Response{StatusCode: status, Header: headers, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	session, e := s.mcpSession(context.Background(), p, c)
	if e != nil {
		t.Fatal(e)
	}
	defer session.close()
	list, e := session.list(context.Background())
	if e != nil || len(list) != 0 || !called {
		t.Fatal(list, e)
	}
}
