package assistant

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"

	"coflow/api/internal/identity"
)

type ModelsInput struct {
	Provider         string `json:"provider"`
	BaseURL          string `json:"base_url"`
	APIKey           string `json:"api_key"`
	ConfigID         string `json:"config_id"`
	ExpectedRevision int    `json:"expected_revision"`
}
type ModelsResult struct {
	Items     []string `json:"items"`
	Truncated bool     `json:"truncated"`
}

// Models only discovers IDs; it neither saves configuration nor verifies tool support.
func (s *Service) Models(ctx context.Context, p identity.Principal, in ModelsInput) (ModelsResult, error) {
	if p.Kind != "session" {
		return ModelsResult{}, identity.Denied("仅网页登录可管理 AI 配置")
	}
	if in.Provider != "deepseek" && in.Provider != "glm" && in.Provider != "openai" && in.Provider != "compatible" {
		return ModelsResult{}, invalid("服务商尚未适配")
	}
	base, e := endpoint(in.BaseURL)
	if e != nil {
		return ModelsResult{}, e
	}
	key := strings.TrimSpace(in.APIKey)
	if in.ConfigID != "" {
		c, err := s.config(ctx, p, in.ConfigID)
		if err != nil {
			return ModelsResult{}, err
		}
		if !c.Editable {
			return ModelsResult{}, identity.Denied("无权编辑此 AI 配置")
		}
		if c.Revision != in.ExpectedRevision {
			return ModelsResult{}, conflict()
		}
		if key == "" {
			// Never send an existing secret to an edited endpoint or provider.
			if base != c.BaseURL || in.Provider != c.Provider {
				return ModelsResult{}, invalid("服务商或地址已更改，请重新填写 API Key")
			}
			key, e = s.open(c, p.TeamID)
			if e != nil {
				return ModelsResult{}, e
			}
		}
	}
	if key == "" || len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
		return ModelsResult{}, invalid("请填写 API Key 后获取模型")
	}
	leave, e := s.enter()
	if e != nil {
		return ModelsResult{}, e
	}
	defer leave()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	r, e := http.NewRequestWithContext(ctx, "GET", base+"/models", nil)
	if e != nil {
		return ModelsResult{}, invalid("无法获取模型列表，请重试或手动填写")
	}
	r.Header.Set("Authorization", "Bearer "+key)
	r.Header.Set("Accept", "application/json")
	resp, e := s.client().Do(r)
	if e != nil {
		return ModelsResult{}, invalid("无法获取模型列表，请重试或手动填写")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return ModelsResult{}, invalid("模型列表访问被拒绝，请检查密钥及权限")
	}
	if resp.StatusCode == 404 || resp.StatusCode == 405 || resp.StatusCode == 501 {
		return ModelsResult{}, invalid("服务不支持模型列表，请使用建议或手动填写")
	}
	if resp.StatusCode != 200 {
		return ModelsResult{}, invalid("无法获取模型列表，请重试或手动填写")
	}
	body, e := readBody(resp.Body)
	if e != nil {
		return ModelsResult{}, invalid("无法获取模型列表，请重试或手动填写")
	}
	var list struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		HasMore bool `json:"has_more"`
	}
	if json.Unmarshal(body, &list) != nil || list.Data == nil {
		return ModelsResult{}, invalid("服务不支持模型列表，请使用建议或手动填写")
	}
	out := ModelsResult{Items: []string{}, Truncated: list.HasMore}
	seen := map[string]bool{}
	for _, m := range list.Data {
		id := strings.TrimSpace(m.ID)
		if id == "" || len(id) > 150 || strings.Contains(id, key) || strings.IndexFunc(id, func(r rune) bool { return unicode.IsControl(r) }) >= 0 || seen[id] {
			continue
		}
		seen[id] = true
		if len(out.Items) == 500 {
			out.Truncated = true
			continue
		}
		out.Items = append(out.Items, id)
	}
	sort.Strings(out.Items)
	return out, nil
}
