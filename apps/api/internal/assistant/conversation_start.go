package assistant

import (
	"coflow/api/internal/identity"
	"context"
	"strings"
)

// BeginConversation persists only the private conversation header, before any
// model request. Model results and action drafts still commit atomically in Chat.
func (s *Service) BeginConversation(ctx context.Context, p identity.Principal, in ChatInput) (Conversation, error) {
	var empty Conversation
	message := strings.TrimSpace(in.Message)
	if message == "" || len(message) > 6000 || in.RequestID == "" || len(in.RequestID) > 120 {
		return empty, invalid("请输入简短的请求")
	}
	in.Message = message
	if !in.WebEnabled {
		in.WebConfigID = ""
	}
	config, err := s.config(ctx, p, in.ConfigID)
	if err != nil {
		return empty, err
	}
	if config.VerifiedAt == nil {
		return empty, invalid("请先验证 AI 配置")
	}
	doc := Document{Turns: []Turn{}, Parameters: in.Parameters, InitialRequest: &in}
	if in.PinnedTemplate != nil {
		doc.Template = in.PinnedTemplate
	} else if in.TemplateID != "" {
		template, e := s.Template(ctx, p, in.TemplateID, in.TemplateVersion)
		if e != nil {
			return empty, e
		}
		doc.Template = &template
	}
	if doc.Template != nil {
		if _, err = renderTemplate(*doc.Template, in.Parameters); err != nil {
			return empty, err
		}
	}
	id := "ac_" + identity.Hash(p.TeamID + ":" + p.UserID + ":" + in.RequestID)[:32]
	title := []rune(message)
	if len(title) > 45 {
		title = title[:45]
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO assistant_conversations(id,team_id,owner_id,config_id,title,config_snapshot,document) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`, id, p.TeamID, p.UserID, config.ID, string(title), mustJSON(config), mustJSON(doc))
	if err != nil {
		return empty, err
	}
	c, err := s.Conversation(ctx, p, id)
	if err != nil {
		return empty, err
	}
	if c.ConfigID != config.ID || c.ArchivedAt != nil {
		return empty, conflict()
	}
	if c.Unanswered != nil && (c.Unanswered.RequestID != in.RequestID || c.Unanswered.Message != message) {
		return empty, conflict()
	}
	for _, turn := range c.Turns {
		if turn.RequestID == in.RequestID && turn.User != message {
			return empty, conflict()
		}
	}
	return c, nil
}
