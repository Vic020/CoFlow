package assistant

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(body string) *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}
}
func TestSecretsAndEndpoints(t *testing.T) {
	s := &Service{Key: base64.StdEncoding.EncodeToString(make([]byte, 32))}
	cipher, e := s.seal("id", "team", "owner", "synthetic-key")
	if e != nil {
		t.Fatal(e)
	}
	owner := "owner"
	c := Config{ID: "id", owner: &owner, secret: cipher}
	key, e := s.open(c, "team")
	if e != nil || key != "synthetic-key" {
		t.Fatal("roundtrip failed")
	}
	if _, e = s.open(c, "other-team"); e == nil {
		t.Fatal("cipher must bind team")
	}
	if strings.Contains(string(cipher), key) {
		t.Fatal("plaintext persisted")
	}
	for _, v := range []string{"http://models.example.com", "https://127.0.0.1", "https://[::1]", "https://169.254.169.254/latest", "https://10.0.0.2", "https://100.64.0.1", "https://localhost", "https://foo.local", "https://u:p@models.example.com", "https://models.example.com?token=abc", "https://models.example.com:8443"} {
		if _, e := endpoint(v); e == nil {
			t.Errorf("accepted %s", v)
		}
	}
	if _, e = endpoint("https://api.deepseek.com/"); e != nil {
		t.Fatal(e)
	}
	for _, v := range []string{"10.0.0.1", "127.0.0.1", "::1", "fc00::1", "169.254.169.254", "100.127.255.254", "198.18.0.1"} {
		if publicIP(net.ParseIP(v)) {
			t.Errorf("private address %s accepted", v)
		}
	}
}
func TestProviderProtocolAdapters(t *testing.T) {
	for _, protocol := range []string{"chat-completions", "responses"} {
		t.Run(protocol, func(t *testing.T) {
			s := &Service{Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				if r.Header.Get("Authorization") != "Bearer synthetic-key" {
					t.Fatal("missing authentication")
				}
				var b map[string]any
				if e := json.NewDecoder(r.Body).Decode(&b); e != nil {
					t.Fatal(e)
				}
				if b["model"] != "test-model" {
					t.Fatal("model selection lost")
				}
				if protocol == "responses" {
					if r.URL.Path != "/v1/responses" || b["store"] != false || b["messages"] != nil || len(b["include"].([]any)) != 1 {
						t.Fatal("Responses contract lost")
					}
					return response(`{"status":"completed","output":[{"type":"reasoning","id":"reasoning","encrypted_content":"synthetic-reasoning-ciphertext"},{"type":"function_call","call_id":"call-1","name":"find_todos","arguments":"{}"}]}`), nil
				}
				if r.URL.Path != "/v1/chat/completions" {
					t.Fatal("chat path")
				}
				return response(`{"choices":[{"message":{"role":"assistant","reasoning_content":"preserve me","tool_calls":[{"id":"call-1","function":{"name":"find_todos","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`), nil
			})}}
			_, calls, continuation, e := s.call(context.Background(), Config{Model: "test-model", Protocol: protocol, BaseURL: "https://models.example.com/v1"}, "synthetic-key", []map[string]any{{"role": "user", "content": "test"}}, tools())
			if e != nil || len(calls) != 1 || calls[0].Name != "find_todos" || len(continuation) == 0 {
				t.Fatalf("invalid response: %v", e)
			}
			if protocol == "responses" && continuation[0]["encrypted_content"] != "synthetic-reasoning-ciphertext" {
				t.Fatal("encrypted reasoning continuation lost")
			}
			if protocol == "chat-completions" && continuation[0]["reasoning_content"] != "preserve me" {
				t.Fatal("reasoning context lost")
			}
		})
	}
}
func TestProviderErrorDoesNotExposeSecret(t *testing.T) {
	s := &Service{Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader(`{"error":"synthetic-key"}`))}, nil
	})}}
	_, _, _, e := s.call(context.Background(), Config{BaseURL: "https://models.example.com", Model: "x"}, "synthetic-key", nil, nil)
	if e == nil || strings.Contains(e.Error(), "synthetic-key") {
		t.Fatal("upstream error leak")
	}
}

func TestModelEchoAndNetworkGuards(t *testing.T) {
	value := map[string]any{"title": "echo synthetic-key", "ids": []any{"synthetic-key"}}
	b, _ := json.Marshal(redactModelValue(value, "synthetic-key"))
	if strings.Contains(string(b), "synthetic-key") {
		t.Fatal("model tool arguments echoed a configured key")
	}
	c := secureClient()
	req, _ := http.NewRequest("GET", "https://other.example.com", nil)
	if c.CheckRedirect(req, nil) == nil {
		t.Fatal("redirect accepted")
	}
	tr := c.Transport.(*http.Transport)
	if tr.Proxy != nil {
		t.Fatal("environment proxy must not bypass destination checks")
	}
	if conn, e := tr.DialContext(context.Background(), "tcp", "127.0.0.1:443"); e == nil {
		conn.Close()
		t.Fatal("private address dial was accepted")
	}
}

func TestContextOutputBudgetAndTruncation(t *testing.T) {
	for _, protocol := range []string{"chat-completions", "responses"} {
		for _, auto := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/auto=%t", protocol, auto), func(t *testing.T) {
				requests := 0
				s := &Service{Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
					requests++
					var b map[string]any
					if e := json.NewDecoder(r.Body).Decode(&b); e != nil {
						t.Fatal(e)
					}
					field := "max_tokens"
					if protocol == "responses" {
						field = "max_output_tokens"
					}
					want := float64(2048)
					if auto {
						want = 8192
					}
					if b[field] != want {
						t.Fatalf("budget %v, want %v", b[field], want)
					}
					if protocol == "responses" {
						return response(`{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"type":"function_call","call_id":"partial","name":"propose_context","arguments":"{}"}]}`), nil
					}
					return response(`{"choices":[{"finish_reason":"length","message":{"tool_calls":[{"id":"partial","function":{"name":"propose_context","arguments":"{}"}}]}}]}`), nil
				})}}
				ctx := context.Background()
				if auto {
					ctx = context.WithValue(ctx, contextOutputBudget{}, true)
				}
				_, calls, continuation, e := s.call(ctx, Config{Protocol: protocol, Model: "synthetic", BaseURL: "https://models.example.com"}, "synthetic-key", nil, tools())
				if e == nil || e.Error() != outputLimitMessage || len(calls) != 0 || len(continuation) != 0 {
					t.Fatalf("truncated output escaped: %v %v", e, calls)
				}
				if requests != 1 {
					t.Fatal("must not silently retry a paid request")
				}
			})
		}
	}
}

func TestProviderNetworkDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		cause error
		want  string
	}{
		{errAIEndpointNotPublic, "模型域名解析到非公网地址，请检查服务器或本地代理的 Fake-IP／DNS 设置"},
		{errAIDNSLookup, "模型域名解析失败，请检查服务器 DNS 设置"},
		{&net.DNSError{IsTimeout: true}, "模型连接超时，请检查服务器网络或稍后重试"},
	} {
		s := &Service{Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			return nil, tc.cause
		})}}
		_, calls, _, err := s.call(context.Background(), Config{BaseURL: "https://models.example.com", Model: "synthetic"}, "synthetic-secret", nil, nil)
		if err == nil || err.Error() != tc.want || len(calls) != 0 || strings.Contains(err.Error(), "synthetic-secret") {
			t.Fatalf("incorrect sanitized diagnosis: %v", err)
		}
	}
}
