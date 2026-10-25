package identity

import (
	"context"
	"time"
	_ "time/tzdata"
)

type Preferences struct {
	Locale          string `json:"locale"`
	DisplayTimezone string `json:"display_timezone"`
}
type PreferencesInput struct {
	Locale          *string `json:"locale"`
	DisplayTimezone *string `json:"display_timezone"`
}

func (s *Service) Preferences(ctx context.Context, p Principal) (Preferences, error) {
	var v Preferences
	err := s.Pool.QueryRow(ctx, `SELECT COALESCE((SELECT locale FROM user_preferences WHERE user_id=$1),'en'), COALESCE((SELECT display_timezone FROM user_preferences WHERE user_id=$1),'Asia/Shanghai')`, p.UserID).Scan(&v.Locale, &v.DisplayTimezone)
	return v, err
}

func (s *Service) SetPreferences(ctx context.Context, p Principal, v PreferencesInput) error {
	if v.Locale == nil && v.DisplayTimezone == nil {
		return Invalid("请选择语言或展示时区")
	}
	locale, zone := "en", "Asia/Shanghai"
	if v.Locale != nil {
		locale = *v.Locale
		if locale != "en" && locale != "zh-CN" {
			return Invalid("不支持的语言")
		}
	}
	if v.DisplayTimezone != nil {
		zone = *v.DisplayTimezone
		if zone == "" || zone == "Local" || len(zone) > 100 {
			return Invalid("无效的展示时区")
		}
		if _, err := time.LoadLocation(zone); err != nil {
			return Invalid("无效的展示时区")
		}
	}
	_, err := s.Pool.Exec(ctx, `INSERT INTO user_preferences(user_id,locale,display_timezone) VALUES($1,$2,$3)
 ON CONFLICT(user_id) DO UPDATE SET locale=CASE WHEN $4 THEN EXCLUDED.locale ELSE user_preferences.locale END,
 display_timezone=CASE WHEN $5 THEN EXCLUDED.display_timezone ELSE user_preferences.display_timezone END,updated_at=now()`, p.UserID, locale, zone, v.Locale != nil, v.DisplayTimezone != nil)
	return err
}
