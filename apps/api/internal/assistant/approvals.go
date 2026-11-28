package assistant

import (
	"context"
	"encoding/json"

	"coflow/api/internal/identity"
)

type Approval struct {
	ConversationScope string `json:"conversation_scope"`
	Capability        string `json:"capability"`
	TargetID          string `json:"target_id"`
}

func approvalTarget(kind string, args ToolArgs) (string, string) {
	switch kind {
	case "propose_todo":
		return kind, args.ProjectID
	case "propose_schedule":
		return kind, args.TodoID
	case "propose_context":
		if args.Knowledge != nil && args.ContextID == "" {
			return kind, args.Knowledge.ProjectID
		}
	}
	return "", ""
}

func (s *Service) Approvals(ctx context.Context, p identity.Principal) ([]Approval, error) {
	rows, err := s.Pool.Query(ctx, `SELECT a.conversation_scope,a.capability,a.target_id FROM assistant_approvals a
		WHERE a.team_id=$1 AND a.owner_id=$2 AND (a.conversation_scope='' OR EXISTS (
		  SELECT 1 FROM assistant_conversations c WHERE c.id=a.conversation_scope AND c.deleted_at IS NULL AND c.archived_at IS NULL))
		ORDER BY a.granted_at DESC`, p.TeamID, p.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Approval{}
	for rows.Next() {
		var a Approval
		if err = rows.Scan(&a.ConversationScope, &a.Capability, &a.TargetID); err != nil {
			return nil, err
		}
		items = append(items, a)
	}
	return items, rows.Err()
}

func (s *Service) RevokeApproval(ctx context.Context, p identity.Principal, a Approval) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM assistant_approvals WHERE team_id=$1 AND owner_id=$2
		AND conversation_scope=$3 AND capability=$4 AND target_id=$5`, p.TeamID, p.UserID, a.ConversationScope, a.Capability, a.TargetID)
	return err
}

func (s *Service) applyApprovedActions(ctx context.Context, p identity.Principal, turn Turn) Turn {
	if len(turn.Actions) == 0 {
		turn.Actions = []Action{}
		return turn
	}
	if p.Kind != "session" || !turn.ApprovalEligible {
		return turn
	}
	turn.Actions = append([]Action(nil), turn.Actions...)
	for i, action := range turn.Actions {
		var args ToolArgs
		if json.Unmarshal(action.Payload, &args) != nil {
			continue
		}
		_, target := approvalTarget(action.Kind, args)
		if target == "" {
			continue
		}
		result, err := s.confirm(ctx, p, action.ID, "auto")
		if err == nil {
			turn.Actions[i] = result
		}
	}
	return turn
}
