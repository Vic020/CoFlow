package assistant

import (
	"bufio"
	"encoding/json"
	"io"
	"sort"
	"strings"
	"unicode/utf8"
)

type streamContext struct{}

// Hold a key-length suffix so a credential split across upstream chunks is never emitted.
func redactedStream(key string, emit func(string)) (func(string), func()) {
	if key == "" {
		return emit, func() {}
	}
	buffer := ""
	send := func(final bool) {
		buffer = strings.ReplaceAll(buffer, key, "[redacted]")
		n := len(buffer)
		if !final {
			n -= len(key)
			if n <= 0 {
				return
			}
			for n > 0 && !utf8.RuneStart(buffer[n]) {
				n--
			}
		}
		if n > 0 {
			emit(buffer[:n])
			buffer = buffer[n:]
		}
	}
	return func(s string) { buffer += s; send(false) }, func() { send(true) }
}
func readProviderStream(r io.Reader, protocol, key string, emit func(string)) ([]byte, error) {
	scanner := bufio.NewScanner(io.LimitReader(r, 2<<20))
	scanner.Buffer(make([]byte, 4096), 1<<20)
	data := ""
	text := ""
	reasoningText := ""
	calls := map[int]map[string]any{}
	finish := ""
	var usage any
	var response map[string]any
	done := false
	send, flush := redactedStream(key, emit)
	process := func(raw string) error {
		if strings.TrimSpace(raw) == "[DONE]" {
			done = true
			return nil
		}
		var event map[string]any
		if json.Unmarshal([]byte(raw), &event) != nil {
			return invalid("模型流格式无效")
		}
		if event["error"] != nil || event["type"] == "error" || event["type"] == "response.failed" || event["type"] == "response.incomplete" {
			return invalid("模型流返回错误或未完成")
		}
		if protocol == "responses" {
			if event["type"] == "response.output_text.delta" {
				send(str(event, "delta"))
			}
			if event["type"] == "response.completed" {
				response, _ = event["response"].(map[string]any)
				done = response != nil
			}
			return nil
		}
		if event["usage"] != nil {
			usage = event["usage"]
		}
		for _, choice := range array(event, "choices") {
			c, _ := choice.(map[string]any)
			if c == nil {
				continue
			}
			if index, ok := c["index"].(float64); ok && index != 0 {
				continue
			}
			if f := str(c, "finish_reason"); f != "" {
				finish = f
			}
			delta, _ := c["delta"].(map[string]any)
			reasoningText += str(delta, "reasoning_content")
			part := str(delta, "content")
			text += part
			send(part)
			for _, v := range array(delta, "tool_calls") {
				x, _ := v.(map[string]any)
				index, _ := x["index"].(float64)
				i := int(index)
				if i < 0 || i >= 8 {
					return invalid("模型工具请求过多")
				}
				if calls[i] == nil {
					calls[i] = map[string]any{"id": "", "type": "function", "function": map[string]any{"name": "", "arguments": ""}}
				}
				t := calls[i]
				t["id"] = str(t, "id") + str(x, "id")
				f, _ := x["function"].(map[string]any)
				target := t["function"].(map[string]any)
				target["name"] = str(target, "name") + str(f, "name")
				target["arguments"] = str(target, "arguments") + str(f, "arguments")
				if len(str(target, "arguments")) > 20000 {
					return invalid("模型工具参数过长")
				}
			}
		}
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			data += strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ") + "\n"
		}
		if line == "" && data != "" {
			if e := process(data); e != nil {
				return nil, e
			}
			data = ""
			if done {
				break
			}
		}
	}
	if !done && data != "" {
		if e := process(data); e != nil {
			return nil, e
		}
	}
	if scanner.Err() != nil || !done {
		return nil, invalid("模型流已中断，请重试同一请求")
	}
	flush()
	if protocol == "responses" {
		return json.Marshal(response)
	}
	if finish == "length" {
		return nil, invalid(outputLimitMessage)
	}
	if finish == "" || finish == "content_filter" {
		return nil, invalid("模型回复未完成")
	}
	items := []any{}
	indexes := []int{}
	for i := range calls {
		indexes = append(indexes, i)
	}
	sort.Ints(indexes)
	for _, i := range indexes {
		items = append(items, calls[i])
	}
	message := map[string]any{"role": "assistant", "content": text, "tool_calls": items}
	if reasoningText != "" {
		message["reasoning_content"] = reasoningText
	}
	return json.Marshal(map[string]any{"usage": usage, "choices": []any{map[string]any{"finish_reason": finish, "message": message}}})
}
