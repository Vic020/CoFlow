package workspace

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strings"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

type CalendarEvent struct {
	ID         string       `json:"id"`
	SourceID   string       `json:"source_id"`
	CreatorID  string       `json:"creator_id"`
	AssigneeID string       `json:"assignee_id"`
	ProjectID  string       `json:"project_id"`
	Domains    []string     `json:"domains"`
	Kind       string       `json:"kind"`
	Title      string       `json:"title"`
	Body       string       `json:"body"`
	Schedule   *Schedule    `json:"schedule"`
	TodoIDs    []string     `json:"todo_ids"`
	ReportIDs  []string     `json:"report_ids"`
	Links      []store.Link `json:"links"`
	Agent      string       `json:"agent"`
	Model      string       `json:"model"`
	Revision   int          `json:"revision"`
	Archived   bool         `json:"archived"`
	CreatedAt  time.Time    `json:"created_at"`
	UpdatedAt  time.Time    `json:"updated_at"`
	History    []TodoEvent  `json:"history"`
}
type CalendarEventInput struct {
	CalendarEvent
	Action           string                     `json:"action"`
	OperationID      string                     `json:"operation_id"`
	ExpectedRevision int                        `json:"expected_revision"`
	Fields           map[string]json.RawMessage `json:"-"`
}

func (in *CalendarEventInput) UnmarshalJSON(raw []byte) error {
	type plain CalendarEventInput
	var v plain
	if e := json.Unmarshal(raw, &v); e != nil {
		return e
	}
	*in = CalendarEventInput(v)
	return json.Unmarshal(raw, &in.Fields)
}
func (s *Service) eventTransaction(ctx context.Context, p identity.Principal, fn func(pgx.Tx, *TodoBoard) error) error {
	if s.TodoDemo != nil {
		return s.todoTransaction(ctx, p, fn)
	}
	return s.transaction(ctx, p, func(tx pgx.Tx) error { return fn(tx, nil) })
}
func loadEvent(ctx context.Context, tx pgx.Tx, b *TodoBoard, p identity.Principal, id, source string) (CalendarEvent, error) {
	var v CalendarEvent
	if tx == nil {
		for _, x := range b.CalendarEvents {
			if id != "" && x.ID == id || id == "" && x.SourceID == source && x.CreatorID == p.UserID {
				return x, nil
			}
		}
		return v, store.ErrNotFound
	}
	var raw []byte
	e := tx.QueryRow(ctx, `SELECT document FROM calendar_events WHERE team_id=$1 AND (($2<>'' AND id=$2) OR ($2='' AND creator_id=$3 AND source_id=$4))`, p.TeamID, id, p.UserID, source).Scan(&raw)
	if errors.Is(e, pgx.ErrNoRows) {
		return v, store.ErrNotFound
	}
	if e != nil {
		return v, e
	}
	e = json.Unmarshal(raw, &v)
	return v, e
}
func eventSnapshot(v CalendarEvent) json.RawMessage {
	v.History = nil
	b, _ := json.Marshal(v)
	return b
}
func (s *Service) safeEvent(ctx context.Context, tx pgx.Tx, b *TodoBoard, p identity.Principal, v CalendarEvent) (CalendarEvent, error) {
	v.TodoIDs = append([]string{}, v.TodoIDs...)
	v.ReportIDs = append([]string{}, v.ReportIDs...)
	v.History = append([]TodoEvent{}, v.History...)
	clean := func(x *CalendarEvent) error {
		x.Links = append([]store.Link{}, x.Links...)
		x.Domains = append([]string{}, x.Domains...)
		if !p.Can("todos:read") {
			x.TodoIDs = []string{}
		}
		if !p.Can("reports:read") {
			x.ReportIDs = []string{}
		} else if tx != nil {
			ids := []string{}
			for _, id := range x.ReportIDs {
				var ok bool
				e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND id=$2 AND deleted_at IS NULL)`, p.TeamID, id).Scan(&ok)
				if e != nil {
					return e
				}
				if ok {
					ids = append(ids, id)
				}
			}
			x.ReportIDs = ids
		}
		return nil
	}
	if e := clean(&v); e != nil {
		return v, e
	}
	for i := range v.History {
		for _, raw := range []*json.RawMessage{&v.History[i].Before, &v.History[i].After} {
			var x CalendarEvent
			if len(*raw) > 0 && json.Unmarshal(*raw, &x) == nil {
				if e := clean(&x); e != nil {
					return v, e
				}
				*raw = eventSnapshot(x)
			}
		}
	}
	return v, nil
}
func (s *Service) GetCalendarEvent(ctx context.Context, p identity.Principal, id string) (CalendarEvent, error) {
	var out CalendarEvent
	if !p.Can("calendar:read") {
		return out, identity.Denied("需要 calendar:read 权限")
	}
	e := s.eventTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		v, e := loadEvent(ctx, tx, b, p, id, "")
		if e != nil {
			return e
		}
		out, e = s.safeEvent(ctx, tx, b, p, v)
		return e
	})
	return out, e
}
func validateCalendarEvent(ctx context.Context, tx pgx.Tx, b *TodoBoard, p identity.Principal, v *CalendarEvent, in CalendarEventInput, old *CalendarEvent) error {
	v.Title = strings.TrimSpace(v.Title)
	if v.Title == "" || len(v.Title) > 500 || len(v.Body) > 50000 || v.SourceID == "" || len(v.SourceID) > 160 || len(v.Agent) > 160 || len(v.Model) > 160 {
		return identity.Invalid("日历标题或字段长度无效")
	}
	if v.Kind != "phase" && v.Kind != "big_day" && v.Kind != "version" {
		return identity.Invalid("日历事件类型无效")
	}
	if v.Schedule == nil {
		return identity.Invalid("请设置排期")
	}
	if e := v.Schedule.Validate(v.Kind != "phase"); e != nil {
		return e
	}
	if v.Kind != "phase" && (v.Schedule.Kind == "date-range" && v.Schedule.StartDate != v.Schedule.EndDate || v.Schedule.Kind == "time-range" && v.Schedule.StartAt != v.Schedule.EndAt) {
		return identity.Invalid("里程碑需要单日或单个时刻")
	}
	if len(v.TodoIDs) > 20 || len(v.ReportIDs) > 20 || len(v.Links) > 20 || len(v.Domains) > 20 {
		return identity.Invalid("关联数量过多")
	}
	for _, l := range v.Links {
		u, e := url.Parse(l.URL)
		if e != nil || u.Host == "" || u.Scheme != "https" && u.Scheme != "http" {
			return identity.Invalid("请使用 HTTP 或 HTTPS 链接")
		}
	}
	if tx != nil {
		if v.AssigneeID != "" && (old == nil || old.AssigneeID != v.AssigneeID) {
			var ok bool
			if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2)`, p.TeamID, v.AssigneeID).Scan(&ok); e != nil {
				return e
			}
			if !ok {
				return identity.Invalid("负责人不在当前团队")
			}
		}
		list, e := categories(ctx, tx, p.TeamID)
		if e != nil {
			return e
		}
		if v.ProjectID != "" {
			x, ok := find(list, "project", v.ProjectID, "")
			if !ok || x.State != "active" && (old == nil || old.ProjectID != v.ProjectID) {
				return identity.Invalid("请选择有效项目")
			}
		}
		for _, d := range v.Domains {
			x, ok := find(list, "domain", "", d)
			if !ok || x.State != "active" && (old == nil || !stringIn(old.Domains, d)) {
				return identity.Invalid("请选择有效领域")
			}
		}
	}
	if _, changed := in.Fields["todo_ids"]; changed {
		if len(v.TodoIDs) > 0 && !p.Can("todos:read") {
			return identity.Denied("需要 todos:read 权限")
		}
		tasks := b
		if tx != nil {
			var e error
			tasks, e = loadTodoBoard(ctx, tx, p.TeamID)
			if e != nil {
				return e
			}
		}
		for _, id := range v.TodoIDs {
			if tasks.task(id) == nil {
				return store.ErrNotFound
			}
		}
	}
	if _, changed := in.Fields["report_ids"]; changed {
		if len(v.ReportIDs) > 0 && !p.Can("reports:read") {
			return identity.Denied("需要 reports:read 权限")
		}
		if tx != nil {
			for _, id := range v.ReportIDs {
				var ok bool
				if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND id=$2 AND deleted_at IS NULL)`, p.TeamID, id).Scan(&ok); e != nil {
					return e
				}
				if !ok {
					return store.ErrNotFound
				}
			}
		}
	}
	return nil
}
func (s *Service) ChangeCalendarEvent(ctx context.Context, p identity.Principal, id string, in CalendarEventInput) (CalendarEvent, error) {
	var out CalendarEvent
	if !p.Can("calendar:read") || !p.Can("calendar:write") {
		return out, identity.Denied("需要日历读取和写入权限")
	}
	if in.OperationID == "" || len(in.OperationID) > 160 {
		return out, identity.Invalid("请提供有效 operation_id")
	}
	e := s.eventTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		hash := calendarRevision([]any{id, in.Fields})
		var replay TodoReplay
		var e error
		if tx != nil {
			e = tx.QueryRow(ctx, `SELECT hash,result FROM calendar_operations WHERE team_id=$1 AND actor_id=$2 AND operation_id=$3`, p.TeamID, p.UserID, in.OperationID).Scan(&replay.Hash, &replay.Result)
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return e
			}
		} else {
			if b.CalendarOperations == nil {
				b.CalendarOperations = map[string]TodoReplay{}
			}
			replay = b.CalendarOperations[p.UserID+":"+in.OperationID]
		}
		if replay.Hash != "" {
			if replay.Hash != hash {
				return calendarChanged()
			}
			if e = json.Unmarshal(replay.Result, &out); e != nil {
				return e
			}
			out, e = s.safeEvent(ctx, tx, b, p, out)
			return e
		}
		v, err := loadEvent(ctx, tx, b, p, id, in.SourceID)
		if id == "" && err == nil {
			out = v
		} else {
			if id != "" && err != nil {
				return err
			}
			if id == "" && err != nil && !errors.Is(err, store.ErrNotFound) {
				return err
			}
			if id == "" {
				v = in.CalendarEvent
				v.ID = store.ID()
				v.CreatorID = p.UserID
				v.Revision = 0
				v.Archived = false
				v.CreatedAt = time.Now().UTC()
				v.History = nil
				if e = validateCalendarEvent(ctx, tx, b, p, &v, in, nil); e != nil {
					return e
				}
			} else {
				if !todoAdmin(p) && v.CreatorID != p.UserID && v.AssigneeID != p.UserID {
					return identity.Denied("只有创建人或负责人可以修改")
				}
				if v.Revision != in.ExpectedRevision {
					return calendarChanged()
				}
			}
			before := v
			if id != "" {
				switch in.Action {
				case "archive":
					v.Archived = true
				case "restore":
					v.Archived = false
				case "", "edit":
					if v.Archived {
						return identity.Invalid("请先恢复归档事件")
					}
					raw, _ := json.Marshal(v)
					var fields map[string]json.RawMessage
					_ = json.Unmarshal(raw, &fields)
					for _, k := range []string{"title", "body", "kind", "schedule", "assignee_id", "project_id", "domains", "todo_ids", "report_ids", "links", "agent", "model"} {
						if x, ok := in.Fields[k]; ok {
							fields[k] = x
						}
					}
					raw, _ = json.Marshal(fields)
					if e = json.Unmarshal(raw, &v); e != nil {
						return identity.Invalid("日历字段无效")
					}
					if e = validateCalendarEvent(ctx, tx, b, p, &v, in, &before); e != nil {
						return e
					}
				default:
					return identity.Invalid("日历操作无效")
				}
			}
			v.Revision++
			v.UpdatedAt = time.Now().UTC()
			v.History = append(v.History, TodoEvent{ID: store.ID(), ActorID: p.UserID, ActorKind: p.Kind, Agent: in.Agent, Model: in.Model, Action: in.Action, CreatedAt: v.UpdatedAt, Before: eventSnapshot(before), After: eventSnapshot(v)})
			if tx != nil {
				var sd, ed, sa, ea any
				if v.Schedule.Kind == "date-range" {
					sd = v.Schedule.StartDate
					ed = v.Schedule.EndDate
				} else {
					sa = v.Schedule.StartAt
					ea = v.Schedule.EndAt
				}
				raw, _ := json.Marshal(v)
				_, e = tx.Exec(ctx, `INSERT INTO calendar_events(team_id,id,creator_id,source_id,start_date,end_date,start_at,end_at,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(team_id,id) DO UPDATE SET start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,start_at=EXCLUDED.start_at,end_at=EXCLUDED.end_at,document=EXCLUDED.document`, p.TeamID, v.ID, v.CreatorID, v.SourceID, sd, ed, sa, ea, raw)
				if e != nil {
					return e
				}
			} else {
				found := false
				for i := range b.CalendarEvents {
					if b.CalendarEvents[i].ID == v.ID {
						b.CalendarEvents[i] = v
						found = true
						break
					}
				}
				if !found {
					b.CalendarEvents = append(b.CalendarEvents, v)
				}
			}
			out = v
		}
		raw, _ := json.Marshal(out)
		if tx != nil {
			_, e = tx.Exec(ctx, `INSERT INTO calendar_operations(team_id,actor_id,operation_id,hash,result) VALUES($1,$2,$3,$4,$5)`, p.TeamID, p.UserID, in.OperationID, hash, raw)
			if e != nil {
				return e
			}
		} else {
			b.CalendarOperations[p.UserID+":"+in.OperationID] = TodoReplay{Hash: hash, Result: raw}
		}
		out, e = s.safeEvent(ctx, tx, b, p, out)
		return e
	})
	return out, e
}

// Classification edits migrate planning nodes in the same team transaction as
// reports and tasks, preserving their references and recording the actor.
func reclassifyCalendarEvents(ctx context.Context, tx pgx.Tx, p identity.Principal, kind string, old, target Category) error {
	rows, err := tx.Query(ctx, `SELECT document FROM calendar_events WHERE team_id=$1`, p.TeamID)
	if err != nil {
		return err
	}
	events := []CalendarEvent{}
	for rows.Next() {
		var raw []byte
		var v CalendarEvent
		if err = rows.Scan(&raw); err == nil {
			err = json.Unmarshal(raw, &v)
		}
		if err != nil {
			rows.Close()
			return err
		}
		events = append(events, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, v := range events {
		before := v
		changed := false
		if kind == "project" && v.ProjectID == old.ID {
			v.ProjectID = target.ID
			changed = true
		}
		if kind == "domain" {
			ds := []string{}
			for _, d := range v.Domains {
				if d == old.Name {
					d = target.Name
					changed = true
				}
				if !stringIn(ds, d) {
					ds = append(ds, d)
				}
			}
			v.Domains = ds
		}
		if !changed {
			continue
		}
		v.Revision++
		v.UpdatedAt = time.Now().UTC()
		v.History = append(v.History, TodoEvent{ID: store.ID(), ActorID: p.UserID, ActorKind: p.Kind, Action: "classification", CreatedAt: v.UpdatedAt, Before: eventSnapshot(before), After: eventSnapshot(v)})
		raw, _ := json.Marshal(v)
		if _, err = tx.Exec(ctx, `UPDATE calendar_events SET document=$3 WHERE team_id=$1 AND id=$2`, p.TeamID, v.ID, raw); err != nil {
			return err
		}
	}
	return nil
}

type CalendarItem struct {
	Blocked   bool      `json:"blocked"`
	CreatorID string    `json:"creator_id"`
	ID        string    `json:"id"`
	Key       string    `json:"key"`
	Source    string    `json:"source"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	ProjectID string    `json:"project_id"`
	Domains   []string  `json:"domains"`
	MemberID  string    `json:"member_id"`
	Schedule  *Schedule `json:"schedule"`
	DueDate   string    `json:"due_date,omitempty"`
	Completed bool      `json:"completed"`
	Revision  int       `json:"revision"`
}
type CalendarSchedulePage struct {
	Items        []CalendarItem  `json:"items"`
	Capabilities map[string]bool `json:"capabilities"`
	Total        int             `json:"total"`
	Revision     string          `json:"revision"`
	NextCursor   string          `json:"next_cursor"`
}

func (s *Service) CalendarSchedule(ctx context.Context, p identity.Principal, q CalendarQuery) (CalendarSchedulePage, error) {
	out := CalendarSchedulePage{Items: []CalendarItem{}, Capabilities: map[string]bool{"todos": p.Can("todos:read"), "events": p.Can("calendar:read"), "reports": p.Can("reports:read")}}
	if !out.Capabilities["todos"] && !out.Capabilities["events"] || q.Unscheduled && !out.Capabilities["todos"] {
		return out, identity.Denied("需要任务或日历读取权限")
	}
	xs := []CalendarItem{}
	e := s.eventTransaction(ctx, p, func(tx pgx.Tx, board *TodoBoard) error {
		if board == nil && out.Capabilities["todos"] {
			var err error
			board, err = loadTodoBoard(ctx, tx, p.TeamID)
			if err != nil {
				return err
			}
		}
		if out.Capabilities["todos"] && (q.Kind == "" || q.Kind == "todo") {
			for _, t := range board.Tasks {
				if t.Archived != q.Archived || q.TaskStatus == "open" && t.CompletedAt != nil || q.TaskStatus == "completed" && t.CompletedAt == nil {
					continue
				}
				unscheduled := t.Schedule == nil && t.DueDate == ""
				match := t.Schedule.Overlaps(q) || t.DueDate != "" && t.DueDate >= q.From && t.DueDate < q.To
				if q.Unscheduled {
					match = unscheduled
				}
				if !match {
					continue
				}
				xs = append(xs, CalendarItem{Blocked: blocked(board, t), CreatorID: t.CreatorID, ID: t.ID, Key: "todo:" + t.ID, Source: "todo", Kind: "todo", Title: t.Title, ProjectID: t.ProjectID, Domains: t.Domains, MemberID: t.AssigneeID, Schedule: t.Schedule, DueDate: t.DueDate, Completed: t.CompletedAt != nil, Revision: t.Revision})
			}
		}
		if out.Capabilities["events"] && !q.Unscheduled && q.Kind != "todo" {
			events := []CalendarEvent{}
			if tx == nil {
				events = append(events, board.CalendarEvents...)
			} else {
				rows, e := tx.Query(ctx, `SELECT document FROM calendar_events WHERE team_id=$1 AND ((start_date<$3::date AND end_date>=$2::date) OR (start_at<$5 AND (end_at>$4 OR start_at=end_at AND start_at>=$4)))`, p.TeamID, q.From, q.To, q.Start, q.End)
				if e != nil {
					return e
				}
				for rows.Next() {
					var raw []byte
					var v CalendarEvent
					if e = rows.Scan(&raw); e == nil {
						e = json.Unmarshal(raw, &v)
					}
					if e != nil {
						rows.Close()
						return e
					}
					events = append(events, v)
				}
				e = rows.Err()
				rows.Close()
				if e != nil {
					return e
				}
			}
			for _, v := range events {
				if v.Archived != q.Archived || !v.Schedule.Overlaps(q) {
					continue
				}
				xs = append(xs, CalendarItem{CreatorID: v.CreatorID, ID: v.ID, Key: "event:" + v.ID, Source: "event", Kind: v.Kind, Title: v.Title, ProjectID: v.ProjectID, Domains: v.Domains, MemberID: v.AssigneeID, Schedule: v.Schedule, Revision: v.Revision})
			}
		}
		return nil
	})
	if e != nil {
		return out, e
	}
	filtered := []CalendarItem{}
	for _, v := range xs {
		if q.Project != "" && v.ProjectID != q.Project || q.Domain != "" && !stringIn(v.Domains, q.Domain) || q.Member != "" && v.MemberID != q.Member || q.Kind != "" && v.Kind != q.Kind || !strings.Contains(strings.ToLower(v.Title), strings.ToLower(q.Q)) {
			continue
		}
		filtered = append(filtered, v)
	}
	sort.Slice(filtered, func(i, j int) bool { return filtered[i].Key < filtered[j].Key })
	out.Total = len(filtered)
	signature := q
	signature.Cursor = ""
	signature.Revision = ""
	signature.Limit = 0
	out.Revision = calendarRevision([]any{signature, filtered})
	if q.Revision != "" && q.Revision != out.Revision {
		return out, calendarChanged()
	}
	start := 0
	if q.Cursor != "" {
		if q.Revision == "" {
			return out, identity.Invalid("分页需要日历修订号")
		}
		raw, e := base64.RawURLEncoding.DecodeString(q.Cursor)
		if e != nil {
			return out, identity.Invalid("分页标识无效")
		}
		start = -1
		for i, v := range filtered {
			if v.Key == string(raw) {
				start = i + 1
				break
			}
		}
		if start < 0 {
			return out, calendarChanged()
		}
	}
	end := start + q.Limit
	if end > len(filtered) {
		end = len(filtered)
	}
	out.Items = filtered[start:end]
	if end < len(filtered) {
		out.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(filtered[end-1].Key))
	}
	return out, nil
}
