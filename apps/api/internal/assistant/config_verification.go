package assistant

import (
	"coflow/api/internal/identity"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

type ConfigVerification struct {
	VerificationToken string    `json:"verification_token"`
	ExpiresAt         time.Time `json:"expires_at"`
}

func verificationFingerprint(p identity.Principal, id string, in ConfigInput, key string) string {
	b, _ := json.Marshal([]any{"ai-config-verify-v1", p.TeamID, p.UserID, id, in.Scope, in.ExpectedRevision, in.Provider, in.Protocol, in.BaseURL, in.Model, key})
	sum := sha256.Sum256(b)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
func (s *Service) signVerification(value string) string {
	key, _ := base64.StdEncoding.DecodeString(s.Key)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("ai-config-verification:" + value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Service) validVerification(p identity.Principal, id string, in ConfigInput, key, token string, now time.Time) bool {
	if len(token) > 512 {
		return false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	expiry, e := strconv.ParseInt(parts[0], 10, 64)
	if e != nil || expiry <= now.Unix() || expiry > now.Add(10*time.Minute+5*time.Second).Unix() {
		return false
	}
	if !hmac.Equal([]byte(parts[1]), []byte(verificationFingerprint(p, id, in, key))) {
		return false
	}
	return hmac.Equal([]byte(parts[2]), []byte(s.signVerification(parts[0]+"."+parts[1])))
}

// Verification is transient: no draft configuration or API key is persisted.
func (s *Service) VerifyConfigDraft(ctx context.Context, p identity.Principal, in ConfigInput) (ConfigVerification, error) {
	if p.Kind != "session" {
		return ConfigVerification{}, identity.Denied("仅网页登录可管理 AI 配置")
	}
	in, _, key, e := s.prepareConfig(ctx, p, in.ID, in)
	if e != nil {
		return ConfigVerification{}, e
	}
	leave, e := s.enter()
	if e != nil {
		return ConfigVerification{}, e
	}
	defer leave()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	text, _, _, e := s.call(ctx, in.Config, key, []map[string]any{{"role": "user", "content": "Reply with OK."}}, nil)
	if e != nil {
		return ConfigVerification{}, e
	}
	if strings.TrimSpace(text) == "" {
		return ConfigVerification{}, invalid("模型返回格式无效")
	}
	expiry := time.Now().Add(10 * time.Minute).Truncate(time.Second)
	value := strconv.FormatInt(expiry.Unix(), 10) + "." + verificationFingerprint(p, in.ID, in, key)
	return ConfigVerification{VerificationToken: value + "." + s.signVerification(value), ExpiresAt: expiry}, nil
}
