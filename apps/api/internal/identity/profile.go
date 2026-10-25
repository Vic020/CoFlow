package identity

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

type ProfileInput struct {
	Name       string  `json:"name"`
	AvatarData *string `json:"avatar_data"`
}

func validateAvatar(value string) error {
	if value == "" {
		return nil
	}
	var format string
	switch {
	case strings.HasPrefix(value, "data:image/png;base64,"):
		format = "png"
	case strings.HasPrefix(value, "data:image/jpeg;base64,"):
		format = "jpeg"
	default:
		return Invalid("头像需为 PNG 或 JPEG 图片")
	}
	if len(value) > 90000 {
		return Invalid("头像过大，请重新选择图片")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.SplitN(value, ",", 2)[1])
	if err != nil || len(raw) > 65536 {
		return Invalid("头像过大或图片无效")
	}
	cfg, decodedFormat, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || decodedFormat != format || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 256 || cfg.Height > 256 {
		return Invalid("头像需为不超过 256 像素的有效图片")
	}
	if _, _, err = image.Decode(bytes.NewReader(raw)); err != nil {
		return Invalid("头像图片无效")
	}
	return nil
}

func (s *Service) UpdateProfile(ctx context.Context, p Principal, in ProfileInput) error {
	name, err := cleanName(in.Name)
	if err != nil {
		return err
	}
	if in.AvatarData != nil {
		if err = validateAvatar(*in.AvatarData); err != nil {
			return err
		}
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, "UPDATE memberships SET display_name=$1 WHERE team_id=$2 AND user_id=$3", name, p.TeamID, p.UserID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return Unauthorized()
	}
	if in.AvatarData != nil {
		if _, err = tx.Exec(ctx, "UPDATE users SET avatar_data=$1 WHERE id=$2", *in.AvatarData, p.UserID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) ChangePassword(ctx context.Context, p Principal, session, current, next string) error {
	if len(current) > 72 {
		return &Error{400, "当前密码不正确"}
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var oldHash string
	if err = tx.QueryRow(ctx, "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", p.UserID).Scan(&oldHash); err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(oldHash), []byte(current)) != nil {
		return &Error{400, "当前密码不正确"}
	}
	if next == current {
		return Invalid("新密码需与当前密码不同")
	}
	hash, err := passwordHash(next)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET password_hash=$1 WHERE id=$2", hash, p.UserID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", p.UserID, Hash(session)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
