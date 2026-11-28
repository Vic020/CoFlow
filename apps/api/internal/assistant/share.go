package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

type TranscriptTurn struct {
	User  string `json:"user"`
	Reply string `json:"reply"`
}
type Transcript struct {
	Title string           `json:"title"`
	Turns []TranscriptTurn `json:"turns"`
}
type ConversationShare struct {
	Transcript
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
}

func shareMissing() error {
	return &identity.Error{Status: 404, Message: "会话分享不可用"}
}
func (s *Service) ShareConversation(ctx context.Context, p identity.Principal, id string, revision int) (ConversationShare, error) {
	var out ConversationShare
	var raw []byte
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `SELECT title,document FROM assistant_conversations
		WHERE id=$1 AND team_id=$2 AND owner_id=$3 AND deleted_at IS NULL AND revision=$4 FOR UPDATE`, id, p.TeamID, p.UserID, revision).
		Scan(&out.Title, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, conflict()
	}
	if err != nil {
		return out, err
	}
	var document Document
	if err = json.Unmarshal(raw, &document); err != nil {
		return out, err
	}
	for _, turn := range document.Turns {
		out.Turns = append(out.Turns, TranscriptTurn{turn.User, turn.Reply})
	}
	if len(out.Turns) == 0 {
		return out, invalid("完成一轮对话后才可分享")
	}
	// Only visible text is shared. Executable proposals, tools and configuration stay private.
	doc, err := json.Marshal(out.Transcript)
	if err != nil {
		return out, err
	}
	err = tx.QueryRow(ctx, `INSERT INTO assistant_conversation_shares (id,conversation_id,document)
		SELECT $5,id,$6 FROM assistant_conversations WHERE id=$1 AND team_id=$2 AND owner_id=$3 AND revision=$4 AND deleted_at IS NULL
		ON CONFLICT (conversation_id) DO UPDATE SET id=excluded.id,document=excluded.document,created_at=now()
		RETURNING id,created_at`, id, p.TeamID, p.UserID, revision, store.ID(), doc).Scan(&out.ID, &out.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, conflict()
	}
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}
func (s *Service) SharedConversation(ctx context.Context, p identity.Principal, id string) (ConversationShare, error) {
	var out ConversationShare
	var raw []byte
	err := s.Pool.QueryRow(ctx, `SELECT sh.id,sh.created_at,sh.document FROM assistant_conversation_shares sh
		JOIN assistant_conversations c ON c.id=sh.conversation_id WHERE sh.id=$1 AND c.team_id=$2 AND c.deleted_at IS NULL`, id, p.TeamID).
		Scan(&out.ID, &out.CreatedAt, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, shareMissing()
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out.Transcript)
	return out, err
}
func (s *Service) ConversationShareID(ctx context.Context, p identity.Principal, id string) (string, error) {
	var shareID string
	err := s.Pool.QueryRow(ctx, `SELECT sh.id FROM assistant_conversation_shares sh JOIN assistant_conversations c ON c.id=sh.conversation_id
		WHERE c.id=$1 AND c.team_id=$2 AND c.owner_id=$3 AND c.deleted_at IS NULL`, id, p.TeamID, p.UserID).Scan(&shareID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return shareID, err
}

func (s *Service) RevokeConversationShare(ctx context.Context, p identity.Principal, id string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM assistant_conversation_shares sh USING assistant_conversations c
		WHERE sh.conversation_id=c.id AND c.id=$1 AND c.team_id=$2 AND c.owner_id=$3`, id, p.TeamID, p.UserID)
	return err
}
