package assistant

import (
	"bufio"
	"bytes"
	"coflow/api/internal/identity"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"io"
	"net/http"
	"reflect"
	"strings"
	"time"
)

type MCPTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations struct {
		ReadOnly    bool  `json:"readOnlyHint"`
		Destructive *bool `json:"destructiveHint,omitempty"`
	} `json:"annotations"`
}
type MCPConnection struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Scope         string     `json:"scope"`
	URL           string     `json:"url"`
	Revision      int        `json:"revision"`
	Tools         []MCPTool  `json:"tools"`
	ApprovedTools []MCPTool  `json:"approved_tools"`
	VerifiedAt    *time.Time `json:"verified_at"`
	Editable      bool       `json:"editable"`
	Token         string     `json:"token,omitempty"`
	secret        []byte
	owner         *string
}

const mcpColumns = `id,name,url,revision,tools,approved_tools,verified_at,secret,owner_id`

func scanMCP(row interface{ Scan(...any) error }, p identity.Principal) (MCPConnection, error) {
	var c MCPConnection
	var ts, ap []byte
	e := row.Scan(&c.ID, &c.Name, &c.URL, &c.Revision, &ts, &ap, &c.VerifiedAt, &c.secret, &c.owner)
	c.Scope = "personal"
	if c.owner == nil {
		c.Scope = "team"
	}
	c.Editable = c.owner != nil || p.Role == "admin"
	if e == nil {
		e = json.Unmarshal(ts, &c.Tools)
	}
	if e == nil {
		e = json.Unmarshal(ap, &c.ApprovedTools)
	}
	return c, e
}
func (s *Service) MCPConnections(ctx context.Context, p identity.Principal) ([]MCPConnection, error) {
	rows, e := s.Pool.Query(ctx, `SELECT `+mcpColumns+` FROM assistant_mcp_connections WHERE team_id=$1 AND (owner_id IS NULL OR owner_id=$2) ORDER BY updated_at DESC`, p.TeamID, p.UserID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []MCPConnection{}
	for rows.Next() {
		c, e := scanMCP(rows, p)
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Service) mcp(ctx context.Context, p identity.Principal, id string) (MCPConnection, error) {
	c, e := scanMCP(s.Pool.QueryRow(ctx, `SELECT `+mcpColumns+` FROM assistant_mcp_connections WHERE id=$1 AND team_id=$2 AND (owner_id IS NULL OR owner_id=$3)`, id, p.TeamID, p.UserID), p)
	if e == pgx.ErrNoRows {
		e = invalid("MCP 连接不可用")
	}
	return c, e
}
func (s *Service) SaveMCP(ctx context.Context, p identity.Principal, c MCPConnection) (MCPConnection, error) {
	if c.Scope != "team" && c.Scope != "personal" {
		return c, invalid("连接范围无效")
	}
	if c.Scope == "team" && p.Role != "admin" {
		return c, identity.Denied("仅管理员可管理团队连接")
	}
	var e error
	c.URL, e = endpoint(c.URL)
	if e != nil {
		return c, e
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" || len(c.Name) > 120 || len(c.Token) > 6000 || strings.ContainsAny(c.Token, "\r\n") {
		return c, invalid("MCP 配置无效")
	}
	var owner *string
	if c.Scope == "personal" {
		owner = &p.UserID
	}
	var secret []byte
	if c.ID == "" {
		c.ID = "am_" + identity.Hash(time.Now().String() + p.TeamID + p.UserID)[:32]
		c.Revision = 1
	} else {
		old, err := s.mcp(ctx, p, c.ID)
		if err != nil {
			return c, err
		}
		if !old.Editable || old.Scope != c.Scope || old.Revision != c.Revision {
			return c, conflict()
		}
		secret = old.secret
		c.Revision++
	}
	if c.Token != "" || secret == nil {
		who := ""
		if owner != nil {
			who = *owner
		}
		secret, e = s.seal("mcp:"+c.ID, p.TeamID, who, c.Token)
		if e != nil {
			return c, e
		}
	}
	if c.Revision == 1 {
		_, e = s.Pool.Exec(ctx, `INSERT INTO assistant_mcp_connections(id,team_id,owner_id,name,url,secret) VALUES($1,$2,$3,$4,$5,$6)`, c.ID, p.TeamID, owner, c.Name, c.URL, secret)
	} else {
		tag, err := s.Pool.Exec(ctx, `UPDATE assistant_mcp_connections SET name=$4,url=$5,secret=$6,revision=revision+1,tools='[]',approved_tools='[]',verified_at=NULL,updated_at=now() WHERE id=$1 AND team_id=$2 AND (owner_id=$3 OR (owner_id IS NULL AND $8='admin')) AND revision=$7`, c.ID, p.TeamID, p.UserID, c.Name, c.URL, secret, c.Revision-1, p.Role)
		e = err
		if e == nil && tag.RowsAffected() != 1 {
			e = conflict()
		}
	}
	if e != nil {
		return c, e
	}
	return s.mcp(ctx, p, c.ID)
}

type mcpSession struct {
	s                     *Service
	c                     MCPConnection
	key, session, version string
	seq                   int
}

func (s *Service) mcpSession(ctx context.Context, p identity.Principal, c MCPConnection) (*mcpSession, error) {
	key, e := s.open(Config{ID: "mcp:" + c.ID, secret: c.secret, owner: c.owner}, p.TeamID)
	if e != nil {
		return nil, e
	}
	m := &mcpSession{s: s, c: c, key: key}
	var result struct {
		Protocol string `json:"protocolVersion"`
	}
	e = m.rpc(ctx, "initialize", map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "CoFlow", "version": "1"}}, &result)
	if e != nil {
		return nil, e
	}
	switch result.Protocol {
	case "2025-11-25", "2025-06-18", "2025-03-26":
		m.version = result.Protocol
	default:
		return nil, invalid("MCP 协议版本不受支持")
	}
	if e = m.rpc(ctx, "notifications/initialized", map[string]any{}, nil); e != nil {
		return nil, e
	}
	return m, nil
}
func (m *mcpSession) close() {
	if m.session == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, "DELETE", m.c.URL, nil)
	if e != nil {
		return
	}
	m.headers(req)
	resp, e := m.s.client().Do(req)
	if e == nil {
		resp.Body.Close()
	}
}
func (m *mcpSession) headers(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if m.key != "" {
		req.Header.Set("Authorization", "Bearer "+m.key)
	}
	if m.session != "" {
		req.Header.Set("MCP-Session-Id", m.session)
	}
	if m.version != "" {
		req.Header.Set("MCP-Protocol-Version", m.version)
	}
}
func (m *mcpSession) rpc(ctx context.Context, method string, params any, out any) error {
	m.seq++
	body := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
	if out != nil {
		body["id"] = m.seq
	}
	req, e := http.NewRequestWithContext(ctx, "POST", m.c.URL, bytes.NewReader(mustJSON(body)))
	if e != nil {
		return e
	}
	m.headers(req)
	resp, e := m.s.client().Do(req)
	if e != nil {
		return invalid("MCP 连接失败或超时")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return invalid(fmt.Sprintf("MCP 返回 HTTP %d", resp.StatusCode))
	}
	if method == "initialize" {
		session := resp.Header.Get("MCP-Session-Id")
		validSession := len(session) <= 1024
		for _, r := range session {
			if r < 0x21 || r > 0x7e {
				validSession = false
			}
		}
		if !validSession {
			return invalid("MCP 会话无效")
		}
		m.session = session
	}
	if out == nil {
		return nil
	}
	var raw []byte
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		scanner := bufio.NewScanner(io.LimitReader(resp.Body, 2<<20))
		scanner.Buffer(make([]byte, 4096), 1<<20)
		data := ""
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data:") {
				data += strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ") + "\n"
			}
			if line == "" && data != "" {
				var v map[string]any
				if json.Unmarshal([]byte(data), &v) == nil && v["id"] == float64(m.seq) {
					raw = []byte(data)
					break
				}
				data = ""
			}
		}
		if len(raw) == 0 {
			return invalid("MCP 流已中断，请重试")
		}
	} else {
		raw, e = readBody(resp.Body)
		if e != nil {
			return invalid("MCP 回复过大或无效")
		}
	}
	var envelope struct {
		ID     int             `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if json.Unmarshal(raw, &envelope) != nil || envelope.ID != m.seq || len(envelope.Error) > 0 && string(envelope.Error) != "null" {
		return invalid("MCP 请求失败")
	}
	if len(envelope.Result) == 0 {
		return invalid("MCP 返回格式无效")
	}
	if e = json.Unmarshal(envelope.Result, out); e != nil {
		return invalid("MCP 返回格式无效")
	}
	return nil
}
func (m *mcpSession) list(ctx context.Context) ([]MCPTool, error) {
	out := []MCPTool{}
	cursor := ""
	for i := 0; i < 5; i++ {
		var v struct {
			Tools  []MCPTool `json:"tools"`
			Cursor string    `json:"nextCursor"`
		}
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		if e := m.rpc(ctx, "tools/list", params, &v); e != nil {
			return nil, e
		}
		out = append(out, v.Tools...)
		if len(out) > 100 {
			return nil, invalid("MCP 工具过多")
		}
		if v.Cursor == "" {
			return out, nil
		}
		cursor = v.Cursor
	}
	return nil, invalid("MCP 工具列表未完成")
}
func (s *Service) VerifyMCP(ctx context.Context, p identity.Principal, id string) (MCPConnection, error) {
	c, e := s.mcp(ctx, p, id)
	if e != nil {
		return c, e
	}
	if !c.Editable {
		return c, identity.Denied("无权管理此连接")
	}
	m, e := s.mcpSession(ctx, p, c)
	if e != nil {
		return c, e
	}
	defer m.close()
	ts, e := m.list(ctx)
	if e != nil {
		return c, e
	}
	safe := []MCPTool{}
	for _, t := range ts {
		if t.Annotations.ReadOnly && (t.Annotations.Destructive == nil || !*t.Annotations.Destructive) && t.Name != "" && len(t.Name) <= 120 && len(t.Description) <= 2000 && t.InputSchema["type"] == "object" {
			safe = append(safe, t)
		}
	}
	tag, e := s.Pool.Exec(ctx, `UPDATE assistant_mcp_connections SET tools=$4,verified_at=now(),approved_tools=CASE WHEN tools=$4::jsonb THEN approved_tools ELSE '[]'::jsonb END,revision=revision+1 WHERE id=$1 AND team_id=$2 AND revision=$3`, id, p.TeamID, c.Revision, mustJSON(safe))
	if e == nil && tag.RowsAffected() != 1 {
		e = conflict()
	}
	if e != nil {
		return c, e
	}
	return s.mcp(ctx, p, id)
}
func (s *Service) ApproveMCP(ctx context.Context, p identity.Principal, id string, revision int, names []string) (MCPConnection, error) {
	c, e := s.mcp(ctx, p, id)
	if e != nil {
		return c, e
	}
	if !c.Editable || c.Revision != revision || c.VerifiedAt == nil {
		return c, conflict()
	}
	selected := []MCPTool{}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			return c, invalid("MCP 工具重复")
		}
		seen[name] = true
		found := false
		for _, t := range c.Tools {
			if t.Name == name {
				selected = append(selected, t)
				found = true
				break
			}
		}
		if !found {
			return c, invalid("工具不可用")
		}
	}
	tag, e := s.Pool.Exec(ctx, `UPDATE assistant_mcp_connections SET approved_tools=$4,revision=revision+1 WHERE id=$1 AND team_id=$2 AND revision=$3`, id, p.TeamID, revision, mustJSON(selected))
	if e == nil && tag.RowsAffected() != 1 {
		e = conflict()
	}
	if e != nil {
		return c, e
	}
	return s.mcp(ctx, p, id)
}

type remoteTool struct {
	Connection MCPConnection
	Tool       MCPTool
}

func (s *Service) mcpTools(ctx context.Context, p identity.Principal, ids []string) ([]tool, map[string]remoteTool, error) {
	if len(ids) > 3 {
		return nil, nil, invalid("最多选择三个 MCP 连接")
	}
	out := []tool{}
	mapping := map[string]remoteTool{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			return nil, nil, invalid("MCP 连接重复")
		}
		seen[id] = true
		c, e := s.mcp(ctx, p, id)
		if e != nil {
			return nil, nil, e
		}
		if c.VerifiedAt == nil {
			return nil, nil, invalid("请先验证 MCP 连接")
		}
		for _, t := range c.ApprovedTools {
			name := "mcp_" + identity.Hash(id + ":" + t.Name)[:24]
			props, _ := t.InputSchema["properties"].(map[string]any)
			required := []string{}
			if values, ok := t.InputSchema["required"].([]any); ok {
				for _, v := range values {
					if v, ok := v.(string); ok {
						required = append(required, v)
					}
				}
			}
			out = append(out, tool{name, "External read-only reference data from " + c.Name + ": " + t.Description, props, required})
			mapping[name] = remoteTool{c, t}
		}
	}
	if len(out) > 30 {
		return nil, nil, invalid("启用的外部工具过多")
	}
	return out, mapping, nil
}
func (s *Service) callMCP(ctx context.Context, p identity.Principal, r remoteTool, args string) (any, error) {
	c, e := s.mcp(ctx, p, r.Connection.ID)
	if e != nil {
		return nil, e
	}
	if c.Revision != r.Connection.Revision || c.VerifiedAt == nil {
		return nil, conflict()
	}
	m, e := s.mcpSession(ctx, p, c)
	if e != nil {
		return nil, e
	}
	defer m.close()
	ts, e := m.list(ctx)
	if e != nil {
		return nil, e
	}
	matching := false
	for _, t := range ts {
		if t.Name == r.Tool.Name && reflect.DeepEqual(t, r.Tool) {
			matching = true
		}
	}
	if !matching {
		_, _ = s.Pool.Exec(ctx, `UPDATE assistant_mcp_connections SET verified_at=NULL,approved_tools='[]',revision=revision+1 WHERE id=$1 AND revision=$2`, c.ID, c.Revision)
		return nil, invalid("MCP 工具已变化，请重新验证并授权")
	}
	var input map[string]any
	if json.Unmarshal([]byte(args), &input) != nil {
		return nil, invalid("MCP 参数无效")
	}
	if e = validateMCPValue(input, r.Tool.InputSchema, 0); e != nil {
		return nil, e
	}
	var result map[string]any
	e = m.rpc(ctx, "tools/call", map[string]any{"name": r.Tool.Name, "arguments": input}, &result)
	if e != nil {
		return nil, e
	}
	if result["isError"] == true {
		return nil, invalid("MCP 工具返回执行错误")
	}
	if m.key != "" {
		return redactModelValue(result, m.key), nil
	}
	return result, nil
}

// Constrained JSON Schema validation. Reject unsupported constraints instead of silently skipping them.
func validateMCPValue(v any, schema map[string]any, depth int) error {
	if depth > 12 {
		return invalid("MCP 参数嵌套过深")
	}
	allowed := map[string]bool{"type": true, "properties": true, "required": true, "additionalProperties": true, "items": true, "enum": true, "description": true, "title": true, "default": true, "$schema": true}
	for k := range schema {
		if !allowed[k] {
			return invalid("MCP 参数约束暂不支持")
		}
	}
	if values, ok := schema["enum"].([]any); ok {
		match := false
		for _, x := range values {
			if reflect.DeepEqual(v, x) {
				match = true
			}
		}
		if !match {
			return invalid("MCP 参数值无效")
		}
	}
	switch schema["type"] {
	case "object":
		m, ok := v.(map[string]any)
		if !ok {
			return invalid("MCP 参数类型无效")
		}
		props, _ := schema["properties"].(map[string]any)
		for _, x := range array(schema, "required") {
			name, _ := x.(string)
			if _, ok := m[name]; !ok {
				return invalid("MCP 缺少必要参数")
			}
		}
		for k, x := range m {
			if sub, ok := props[k].(map[string]any); ok {
				if e := validateMCPValue(x, sub, depth+1); e != nil {
					return e
				}
			} else {
				if sub, ok := schema["additionalProperties"].(map[string]any); ok {
					if e := validateMCPValue(x, sub, depth+1); e != nil {
						return e
					}
				} else if allow, ok := schema["additionalProperties"].(bool); ok && !allow {
					return invalid("MCP 包含未知参数")
				}
			}
		}
	case "string":
		if _, ok := v.(string); !ok {
			return invalid("MCP 参数类型无效")
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return invalid("MCP 参数类型无效")
		}
	case "number", "integer":
		n, ok := v.(float64)
		if !ok || schema["type"] == "integer" && n != float64(int64(n)) {
			return invalid("MCP 参数类型无效")
		}
	case "array":
		a, ok := v.([]any)
		if !ok {
			return invalid("MCP 参数类型无效")
		}
		sub, ok := schema["items"].(map[string]any)
		if !ok {
			return invalid("MCP 数组约束无效")
		}
		for _, x := range a {
			if e := validateMCPValue(x, sub, depth+1); e != nil {
				return e
			}
		}
	case "null":
		if v != nil {
			return invalid("MCP 参数类型无效")
		}
	default:
		return invalid("MCP 参数约束暂不支持")
	}
	return nil
}
