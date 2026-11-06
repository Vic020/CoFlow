package assistant

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestStreamingAdaptersAndSecretBoundaries(t *testing.T) {
	key := "synthetic-secret-key"
	var shown strings.Builder
	textChunk := func(text string) string {
		b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": text}}}})
		return "data: " + string(b) + "\n\n"
	}
	stream := textChunk("结果 synthetic-") + textChunk("secret-key 完成") + `data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}` + "\n\ndata: [DONE]\n\n"
	body, e := readProviderStream(strings.NewReader(stream), "chat-completions", key, func(s string) { shown.WriteString(s) })
	if e != nil || strings.Contains(shown.String(), key) || shown.String() != "结果 [redacted] 完成" {
		t.Fatal(shown.String(), e)
	}
	var value map[string]any
	if json.Unmarshal(body, &value) != nil || value["usage"] == nil {
		t.Fatal(string(body))
	}
	response := `data: {"type":"response.output_text.delta","delta":"Hello"}` + "\n\n" + `data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}],"usage":{"input_tokens":4,"output_tokens":1}}}` + "\n\n"
	shown.Reset()
	if _, e = readProviderStream(strings.NewReader(response), "responses", key, func(s string) { shown.WriteString(s) }); e != nil || shown.String() != "Hello" {
		t.Fatal(shown.String(), e)
	}
	for _, raw := range []string{textChunk("partial"), "data: {bad json}\n\n", `data: {"type":"response.failed"}` + "\n\n"} {
		if _, e = readProviderStream(strings.NewReader(raw), "responses", key, func(string) {}); e == nil {
			t.Fatal("accepted interrupted stream")
		}
	}
	// Fragmented tool arguments are reconstructed before validation/execution; no hidden reasoning is forwarded.
	raw := `data: {"choices":[{"index":0,"delta":{"reasoning_content":"hidden","tool_calls":[{"index":0,"id":"call-1","function":{"name":"find_todos","arguments":"{"}}]}}]}` + "\n\n" + `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}` + "\n\ndata: [DONE]\n\n"
	shown.Reset()
	body, e = readProviderStream(strings.NewReader(raw), "chat-completions", key, func(s string) { shown.WriteString(s) })
	if e != nil || shown.Len() != 0 || !strings.Contains(string(body), fmt.Sprintf("%q", "{}")) {
		t.Fatal(string(body), shown.String(), e)
	}
}
