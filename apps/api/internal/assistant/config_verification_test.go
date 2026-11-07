package assistant

import (
	"coflow/api/internal/identity"
	"encoding/base64"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestVerificationProofBindsConnectionAndIdentity(t *testing.T) {
	s := &Service{Key: base64.StdEncoding.EncodeToString(make([]byte, 32))}
	now := time.Now()
	p := identity.Principal{UserID: "member", TeamID: "team"}
	in := ConfigInput{Config: Config{Scope: "personal", Provider: "compatible", Protocol: "chat-completions", BaseURL: "https://models.example.test/v1", Model: "qa"}, ExpectedRevision: 3}
	raw := strconv.FormatInt(now.Add(10*time.Minute).Unix(), 10) + "." + verificationFingerprint(p, "config", in, "synthetic-key")
	token := raw + "." + s.signVerification(raw)
	if !s.validVerification(p, "config", in, "synthetic-key", token, now) || strings.Contains(token, "synthetic-key") {
		t.Fatal("proof invalid or leaked key")
	}
	for _, change := range []func(*ConfigInput){func(v *ConfigInput) { v.Model = "other" }, func(v *ConfigInput) { v.Provider = "deepseek" }, func(v *ConfigInput) { v.Protocol = "responses" }, func(v *ConfigInput) { v.BaseURL = "https://other.example.test" }, func(v *ConfigInput) { v.Scope = "team" }, func(v *ConfigInput) { v.ExpectedRevision++ }} {
		changed := in
		change(&changed)
		if s.validVerification(p, "config", changed, "synthetic-key", token, now) {
			t.Fatal("changed connection accepted")
		}
	}
	changed := in
	changed.Name = "Renamed"
	changed.Default = true
	if !s.validVerification(p, "config", changed, "synthetic-key", token, now) {
		t.Fatal("non-connection change invalidated verification")
	}
	for _, bad := range []string{token + "x", "forged", token[:len(token)-2]} {
		if s.validVerification(p, "config", in, "synthetic-key", bad, now) {
			t.Fatal("tampering accepted")
		}
	}
	if s.validVerification(p, "different", in, "synthetic-key", token, now) || s.validVerification(p, "config", in, "other-key", token, now) || s.validVerification(identity.Principal{UserID: "other", TeamID: p.TeamID}, "config", in, "synthetic-key", token, now) || s.validVerification(p, "config", in, "synthetic-key", token, now.Add(11*time.Minute)) {
		t.Fatal("proof binding/expiry failed")
	}
	otherTeam := identity.Principal{UserID: p.UserID, TeamID: "other"}
	if !s.validVerification(otherTeam, "config", in, "synthetic-key", token, now) {
		t.Fatal("account proof depends on active workspace")
	}
	in.Scope = "team"
	raw = strconv.FormatInt(now.Add(10*time.Minute).Unix(), 10) + "." + verificationFingerprint(p, "config", in, "synthetic-key")
	token = raw + "." + s.signVerification(raw)
	if s.validVerification(otherTeam, "config", in, "synthetic-key", token, now) {
		t.Fatal("team proof crossed workspace")
	}
}
