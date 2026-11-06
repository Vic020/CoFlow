package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type toolCall struct{ ID, Name, Arguments string }
type tool struct {
	Name, Description string
	Properties        map[string]any
	Required          []string
}

func prop(t string) map[string]any { return map[string]any{"type": t} }
func tools() []tool {
	return []tool{
		{"read_workspace", "Read current team's verified projects, members and Todo columns.", map[string]any{}, nil},
		{"find_todos", "Search active tasks; returns IDs, revisions, schedule, completion and source links. Page with offset; do not claim completeness if truncated.", map[string]any{"project_id": prop("string"), "q": prop("string"), "offset": prop("integer"), "domain": prop("string"), "member_id": prop("string")}, nil},
		{"find_reports", "Search progress reports and delivery evidence, newest first. Page with offset.", map[string]any{"project_id": prop("string"), "q": prop("string"), "offset": prop("integer"), "domain": prop("string"), "member_id": prop("string")}, nil},
		{"read_calendar", "Read schedules, phases and milestones: from inclusive, to exclusive, civil dates, maximum 93 days, selected timezone. For pagination send BOTH next_cursor and revision from the first result until empty.", map[string]any{"from": prop("string"), "to": prop("string"), "timezone": prop("string"), "project_id": prop("string"), "cursor": prop("string"), "revision": prop("string"), "domain": prop("string"), "member_id": prop("string")}, []string{"from", "to", "timezone"}},
		{"read_todo", "Read one verified current-team task by ID, with recent discussion/history. Full details remain available via the source link.", map[string]any{"todo_id": prop("string")}, []string{"todo_id"}},
		{"read_report", "Read one current-team report and recent comments by ID, with original task references.", map[string]any{"report_id": prop("string")}, []string{"report_id"}},
		{"propose_todo", "Prepare a task draft for user confirmation; does not execute. Resolve project and column IDs first. Never invent a person or deadline.", map[string]any{"title": prop("string"), "body": prop("string"), "column_id": prop("string"), "project_id": prop("string")}, []string{"title", "column_id"}},
		{"propose_schedule", "Prepare scheduling ONE existing Todo for confirmation, preserving its deadline and state. Read the task first. Dates YYYY-MM-DD inclusive; timed schedules require RFC3339 offsets and IANA timezone.", map[string]any{"todo_id": prop("string"), "expected_revision": prop("integer"), "schedule": map[string]any{"type": "object", "properties": map[string]any{"kind": map[string]any{"type": "string", "enum": []string{"date-range", "time-range"}}, "start_date": prop("string"), "end_date": prop("string"), "start_at": prop("string"), "end_at": prop("string"), "timezone": prop("string")}, "required": []string{"kind"}}}, []string{"todo_id", "expected_revision", "schedule"}},
		{"propose_report", "Prepare an editable delivery brief for confirmation, linked to verified Todo IDs. Read source evidence first; do not mark unverified work delivered.", map[string]any{"title": prop("string"), "body": prop("string"), "project_id": prop("string"), "todo_ids": map[string]any{"type": "array", "items": prop("string"), "maxItems": 20}}, []string{"title", "body"}},
	}
}
func (s *Service) call(ctx context.Context, c Config, key string, messages []map[string]any, ts []tool) (string, []toolCall, []map[string]any, error) {
	endpointPath := "/chat/completions"
	payload := map[string]any{"model": c.Model, "messages": messages, "max_tokens": 2048, "stream": false}
	schemas := []any{}
	for _, t := range ts {
		required := t.Required
		if required == nil {
			required = []string{}
		}
		parameters := map[string]any{"type": "object", "properties": t.Properties, "required": required, "additionalProperties": false}
		if c.Protocol == "responses" {
			schemas = append(schemas, map[string]any{"type": "function", "name": t.Name, "description": t.Description, "parameters": parameters, "strict": false})
		} else {
			schemas = append(schemas, map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": parameters}})
		}
	}
	if len(schemas) > 0 {
		payload["tools"] = schemas
	}
	if c.Protocol == "responses" {
		endpointPath = "/responses"
		delete(payload, "messages")
		delete(payload, "max_tokens")
		payload["max_output_tokens"] = 2048
		payload["input"] = messages
		payload["store"] = false
		payload["include"] = []string{"reasoning.encrypted_content"}
	}
	if _, ok := ctx.Value(streamContext{}).(func(string)); ok {
		payload["stream"] = true
		if c.Protocol != "responses" {
			payload["stream_options"] = map[string]any{"include_usage": true}
		}
	}
	b, e := json.Marshal(payload)
	if e != nil {
		return "", nil, nil, e
	}
	req, e := http.NewRequestWithContext(ctx, "POST", c.BaseURL+endpointPath, bytes.NewReader(b))
	if e != nil {
		return "", nil, nil, e
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, e := s.client().Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return "", nil, nil, ctx.Err()
		}
		return "", nil, nil, invalid("模型连接失败，请检查服务地址或稍后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", nil, nil, invalid(fmt.Sprintf("模型服务返回 HTTP %d，请检查配置、余额或限流", resp.StatusCode))
	}
	var raw []byte
	if emit, ok := ctx.Value(streamContext{}).(func(string)); ok && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		raw, e = readProviderStream(resp.Body, c.Protocol, key, emit)
	} else {
		raw, e = readBody(resp.Body)
	}
	if e != nil {
		return "", nil, nil, e
	}
	var v map[string]any
	if json.Unmarshal(raw, &v) != nil {
		return "", nil, nil, invalid("模型返回格式无效")
	}
	if u, ok := ctx.Value(usageContext{}).(*Usage); ok {
		if raw, ok := v["usage"].(map[string]any); ok {
			u.Known = true
			input := usageCount(raw["input_tokens"])
			if input == 0 {
				input = usageCount(raw["prompt_tokens"])
			}
			output := usageCount(raw["output_tokens"])
			if output == 0 {
				output = usageCount(raw["completion_tokens"])
			}
			u.Input += input
			u.Output += output
			u.Total += input + output
		}
	}
	text := ""
	calls := []toolCall{}
	continuation := []map[string]any{}
	if c.Protocol == "responses" {
		if status, _ := v["status"].(string); status == "failed" || status == "incomplete" {
			return "", nil, nil, invalid("模型回复未完成，请缩小请求范围后重试")
		}
		items, _ := v["output"].([]any)
		for _, item := range items {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			typ, _ := m["type"].(string)
			if typ == "function_call" {
				calls = append(calls, toolCall{str(m, "call_id"), str(m, "name"), str(m, "arguments")})
				continuation = append(continuation, m)
			} else if typ == "message" {
				parts, _ := m["content"].([]any)
				for _, p := range parts {
					if p, ok := p.(map[string]any); ok && str(p, "type") == "output_text" {
						text += str(p, "text")
					}
				}
				continuation = append(continuation, m)
			} else if typ == "reasoning" {
				continuation = append(continuation, m)
			}
		}
	} else {
		choices, _ := v["choices"].([]any)
		if len(choices) == 0 {
			return "", nil, nil, invalid("模型返回格式无效")
		}
		choice, _ := choices[0].(map[string]any)
		if str(choice, "finish_reason") == "length" {
			return "", nil, nil, invalid("模型回复未完成，请缩小请求范围后重试")
		}
		m, _ := choice["message"].(map[string]any)
		if m == nil {
			return "", nil, nil, invalid("模型返回格式无效")
		}
		text = str(m, "content")
		for _, x := range array(m, "tool_calls") {
			t, _ := x.(map[string]any)
			f, _ := t["function"].(map[string]any)
			calls = append(calls, toolCall{str(t, "id"), str(f, "name"), str(f, "arguments")})
		}
		continuation = append(continuation, m)
	}
	if text == "" && len(calls) == 0 {
		return "", nil, nil, invalid("模型没有返回可用回复")
	}
	if len(calls) > 8 {
		return "", nil, nil, invalid("模型工具请求过多，请缩小范围")
	}
	for _, t := range calls {
		if t.ID == "" || len(t.ID) > 200 || len(t.Arguments) > 20000 {
			return "", nil, nil, invalid("模型工具参数无效")
		}
	}
	for i := range calls {
		var value any
		if json.Unmarshal([]byte(calls[i].Arguments), &value) == nil {
			b, e := json.Marshal(redactModelValue(value, key))
			if e == nil {
				calls[i].Arguments = string(b)
			}
		}
	}
	text = strings.ReplaceAll(text, key, "[redacted]")
	return text, calls, continuation, nil
}
func str(m map[string]any, k string) string  { v, _ := m[k].(string); return v }
func array(m map[string]any, k string) []any { v, _ := m[k].([]any); return v }

func redactModelValue(value any, key string) any {
	switch v := value.(type) {
	case string:
		return strings.ReplaceAll(v, key, "[redacted]")
	case []any:
		for i := range v {
			v[i] = redactModelValue(v[i], key)
		}
		return v
	case map[string]any:
		for k, x := range v {
			v[k] = redactModelValue(x, key)
		}
		return v
	default:
		return value
	}
}
