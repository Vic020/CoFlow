package assistant

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/workspace"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Job struct {
	LastRunState   string            `json:"last_run_state"`
	Parameters     map[string]string `json:"parameters"`
	ID             string            `json:"id"`
	Title          string            `json:"title"`
	ConfigID       string            `json:"config_id"`
	ConfigRevision int               `json:"config_revision"`
	Template       Template          `json:"template"`
	Context        PageContext       `json:"context"`
	Prompt         string            `json:"prompt"`
	Locale         string            `json:"locale"`
	Timezone       string            `json:"timezone"`
	LocalTime      string            `json:"local_time"`
	Weekdays       []int             `json:"weekdays"`
	Publish        bool              `json:"publish"`
	Enabled        bool              `json:"enabled"`
	Revision       int               `json:"revision"`
	NextRunAt      time.Time         `json:"next_run_at"`
}
type Run struct {
	ID             string     `json:"id"`
	JobID          string     `json:"job_id"`
	ScheduledAt    time.Time  `json:"scheduled_at"`
	State          string     `json:"state"`
	Attempts       int        `json:"attempts"`
	ConversationID *string    `json:"conversation_id"`
	ReportID       *string    `json:"report_id"`
	Message        string     `json:"message"`
	FinishedAt     *time.Time `json:"finished_at"`
}

// Enumerating instants handles skipped wall times and chooses only the first occurrence of a repeated wall time.
func NextRun(after time.Time, zone, clock string, days []int) (time.Time, error) {
	loc, e := time.LoadLocation(zone)
	if e != nil || zone == "Local" {
		return time.Time{}, invalid("时区无效")
	}
	parts := strings.Split(clock, ":")
	if len(parts) != 2 || len(clock) != 5 {
		return time.Time{}, invalid("时间无效")
	}
	h, e := strconv.Atoi(parts[0])
	m, e2 := strconv.Atoi(parts[1])
	if e != nil || e2 != nil || h < 0 || h > 23 || m < 0 || m > 59 || len(days) == 0 || len(days) > 7 {
		return time.Time{}, invalid("时间或工作日无效")
	}
	allowed := map[time.Weekday]bool{}
	for _, d := range days {
		if d < 0 || d > 6 {
			return time.Time{}, invalid("工作日无效")
		}
		allowed[time.Weekday(d)] = true
	}
	// Start two hours before 'after' so a repeated DST minute cannot run twice.
	seen := map[string]bool{}
	start := after.UTC().Truncate(time.Minute).Add(-3 * time.Hour)
	for i := 0; i < 12*24*60; i++ {
		t := start.Add(time.Duration(i) * time.Minute)
		local := t.In(loc)
		if local.Hour() != h || local.Minute() != m || !allowed[local.Weekday()] {
			continue
		}
		day := local.Format("2006-01-02")
		if seen[day] {
			continue
		}
		seen[day] = true
		if t.After(after) {
			return t, nil
		}
	}
	return time.Time{}, invalid("无法计算下次运行时间")
}

const jobColumns = `id,title,config_id,config_revision,template_snapshot,context,parameters,prompt,locale,timezone,local_time,weekdays,publish,enabled,revision,next_run_at`

func scanJob(row interface{ Scan(...any) error }) (Job, error) {
	var j Job
	var t, c, params []byte
	e := row.Scan(&j.ID, &j.Title, &j.ConfigID, &j.ConfigRevision, &t, &c, &params, &j.Prompt, &j.Locale, &j.Timezone, &j.LocalTime, &j.Weekdays, &j.Publish, &j.Enabled, &j.Revision, &j.NextRunAt)
	if e == nil {
		e = json.Unmarshal(t, &j.Template)
	}
	if e == nil {
		e = json.Unmarshal(c, &j.Context)
	}
	if e == nil {
		e = json.Unmarshal(params, &j.Parameters)
	}
	return j, e
}
func (s *Service) Jobs(ctx context.Context, p identity.Principal) ([]Job, error) {
	rows, e := s.Pool.Query(ctx, `SELECT `+jobColumns+` FROM assistant_jobs WHERE team_id=$1 AND owner_id=$2 ORDER BY next_run_at,id`, p.TeamID, p.UserID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Job{}
	for rows.Next() {
		j, e := scanJob(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, j)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	rows.Close()
	ids := []string{}
	for _, j := range out {
		ids = append(ids, j.ID)
	}
	if len(ids) > 0 {
		latest, err := s.Pool.Query(ctx, `SELECT DISTINCT ON(job_id) job_id,state FROM assistant_runs WHERE job_id=ANY($1::text[]) ORDER BY job_id,scheduled_at DESC`, ids)
		if err != nil {
			return nil, err
		}
		defer latest.Close()
		for latest.Next() {
			var id, state string
			if err = latest.Scan(&id, &state); err != nil {
				return nil, err
			}
			for i := range out {
				if out[i].ID == id {
					out[i].LastRunState = state
				}
			}
		}
		if err = latest.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}
func (s *Service) SaveJob(ctx context.Context, p identity.Principal, j Job) (Job, error) {
	if j.Parameters == nil {
		j.Parameters = map[string]string{}
	}
	j.Title = strings.TrimSpace(j.Title)
	if j.Title == "" || len(j.Title) > 180 || len(j.Prompt) > 6000 || strings.TrimSpace(j.Prompt) == "" {
		return j, invalid("请填写定时任务名称与请求")
	}
	if j.Locale != "en" && j.Locale != "zh-CN" {
		return j, invalid("语言无效")
	}
	next, e := NextRun(time.Now(), j.Timezone, j.LocalTime, j.Weekdays)
	if e != nil {
		return j, e
	}
	c, e := s.config(ctx, p, j.ConfigID)
	if e != nil {
		return j, e
	}
	if c.VerifiedAt == nil {
		return j, invalid("请先验证 AI 配置")
	}
	if _, err := s.open(c, p.TeamID); err != nil {
		return j, err
	}
	j.ConfigRevision = c.Revision
	t, e := s.Template(ctx, p, j.Template.ID, j.Template.Version)
	if e != nil {
		return j, e
	}
	j.Template = t
	if _, e = renderTemplate(t, j.Parameters); e != nil {
		return j, e
	}
	j.Context.Timezone = j.Timezone
	j.NextRunAt = next
	if j.Context.Project != "" {
		catalog, e := s.Workspace.Catalog(ctx, p)
		if e != nil {
			return j, e
		}
		found := false
		for _, v := range catalog {
			if v.ID == j.Context.Project {
				found = true
			}
		}
		if !found {
			return j, invalid("项目不可用")
		}
	}
	if len(mustJSON(j.Context)) > 1800 {
		return j, invalid("上下文过长")
	}
	if j.ID == "" {
		j.ID = "aj_" + identity.Hash(p.TeamID + p.UserID + time.Now().String())[:32]
		j.Revision = 1
		_, e = s.Pool.Exec(ctx, `INSERT INTO assistant_jobs(id,team_id,owner_id,title,config_id,config_revision,template_snapshot,context,parameters,prompt,locale,timezone,local_time,weekdays,publish,enabled,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, j.ID, p.TeamID, p.UserID, j.Title, j.ConfigID, j.ConfigRevision, mustJSON(j.Template), mustJSON(j.Context), mustJSON(j.Parameters), j.Prompt, j.Locale, j.Timezone, j.LocalTime, j.Weekdays, j.Publish, j.Enabled, next)
	} else {
		tag, err := s.Pool.Exec(ctx, `UPDATE assistant_jobs SET title=$4,config_id=$5,config_revision=$6,template_snapshot=$7,context=$8,parameters=$9,prompt=$10,locale=$11,timezone=$12,local_time=$13,weekdays=$14,publish=$15,enabled=$16,next_run_at=$17,revision=revision+1,updated_at=now() WHERE id=$1 AND team_id=$2 AND owner_id=$3 AND revision=$18`, j.ID, p.TeamID, p.UserID, j.Title, j.ConfigID, j.ConfigRevision, mustJSON(j.Template), mustJSON(j.Context), mustJSON(j.Parameters), j.Prompt, j.Locale, j.Timezone, j.LocalTime, j.Weekdays, j.Publish, j.Enabled, next, j.Revision)
		e = err
		if e == nil && tag.RowsAffected() != 1 {
			e = conflict()
		}
		j.Revision++
	}
	return j, e
}
func (s *Service) JobRuns(ctx context.Context, p identity.Principal, id string) ([]Run, error) {
	rows, e := s.Pool.Query(ctx, `SELECT r.id,r.job_id,r.scheduled_at,r.state,r.attempts,r.conversation_id,r.report_id,r.message,r.finished_at FROM assistant_runs r JOIN assistant_jobs j ON j.id=r.job_id WHERE j.id=$1 AND j.team_id=$2 AND j.owner_id=$3 ORDER BY r.scheduled_at DESC LIMIT 50`, id, p.TeamID, p.UserID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		var r Run
		if e = rows.Scan(&r.ID, &r.JobID, &r.ScheduledAt, &r.State, &r.Attempts, &r.ConversationID, &r.ReportID, &r.Message, &r.FinishedAt); e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Service) RunScheduler(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.Tick(ctx)
		}
	}
}
func (s *Service) Tick(ctx context.Context) {
	_, _ = s.Pool.Exec(ctx, `UPDATE assistant_runs SET state='failed',finished_at=now(),message='运行租约已过期且重试次数已用尽' WHERE state='running' AND attempts>=3 AND lease_until<now()`)
	// A short queue transaction. A missed interval is coalesced to one run; no backlog storm.
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, `SELECT id,next_run_at,timezone,local_time,weekdays,revision FROM assistant_jobs WHERE enabled AND next_run_at<=now() ORDER BY next_run_at LIMIT 10 FOR UPDATE SKIP LOCKED`)
	if e != nil {
		return
	}
	type due struct {
		id          string
		at          time.Time
		zone, clock string
		days        []int
		rev         int
	}
	xs := []due{}
	for rows.Next() {
		var d due
		if rows.Scan(&d.id, &d.at, &d.zone, &d.clock, &d.days, &d.rev) != nil {
			rows.Close()
			return
		}
		xs = append(xs, d)
	}
	rows.Close()
	for _, d := range xs {
		next, err := NextRun(time.Now(), d.zone, d.clock, d.days)
		if err != nil {
			continue
		}
		id := "ar_" + identity.Hash(d.id + d.at.UTC().Format(time.RFC3339Nano))[:32]
		if _, e = tx.Exec(ctx, `INSERT INTO assistant_runs(id,job_id,scheduled_at,job_revision) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, id, d.id, d.at, d.rev); e != nil {
			return
		}
		if _, e = tx.Exec(ctx, `UPDATE assistant_jobs SET next_run_at=$2 WHERE id=$1`, d.id, next); e != nil {
			return
		}
	}
	if tx.Commit(ctx) != nil {
		return
	}
	for i := 0; i < 3; i++ {
		if !s.runOne(ctx) {
			break
		}
	}
}
func (s *Service) runOne(ctx context.Context) bool {
	lease := "al_" + identity.Hash(time.Now().String())[:32]
	var r Run
	var rev int
	e := s.Pool.QueryRow(ctx, `UPDATE assistant_runs SET state='running',attempts=attempts+1,lease_id=$1,lease_until=now()+interval '2 minutes',started_at=COALESCE(started_at,now()) WHERE id=(SELECT id FROM assistant_runs WHERE (state='queued' OR (state='retry' AND retry_at<=now()) OR (state='running' AND lease_until<now())) AND attempts<3 ORDER BY scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,job_id,scheduled_at,attempts,job_revision`, lease).Scan(&r.ID, &r.JobID, &r.ScheduledAt, &r.Attempts, &rev)
	if e != nil {
		return false
	}
	runctx, cancel := context.WithTimeout(ctx, 75*time.Second)
	defer cancel()
	j, e := scanJob(s.Pool.QueryRow(runctx, `SELECT `+jobColumns+` FROM assistant_jobs WHERE id=$1`, r.JobID))
	state := "failed"
	message := ""
	fingerprint := ""
	conversation := ""
	report := ""
	var p identity.Principal
	if e == nil {
		p.Kind = "assistant_job"
		p.Scopes = []string{"reports:read", "todos:read", "calendar:read"}
		if j.Publish {
			p.Scopes = append(p.Scopes, "reports:write")
		}
		e = s.Pool.QueryRow(runctx, `SELECT j.team_id,j.owner_id,m.role FROM assistant_jobs j JOIN memberships m ON m.team_id=j.team_id AND m.user_id=j.owner_id WHERE j.id=$1 AND j.enabled AND j.revision=$2`, j.ID, rev).Scan(&p.TeamID, &p.UserID, &p.Role)
	}
	if e == nil {
		var c Config
		c, e = s.config(runctx, p, j.ConfigID)
		if e == nil && (c.VerifiedAt == nil || c.Revision != j.ConfigRevision) {
			e = invalid("AI 配置已变化，需重新授权定时任务")
		}
	}
	if e == nil {
		fingerprint, e = s.jobFingerprint(runctx, p, j)
	}
	if e == nil {
		var old string
		_ = s.Pool.QueryRow(runctx, `SELECT fingerprint FROM assistant_runs WHERE job_id=$1 AND id<>$2 AND state IN ('done','draft','unchanged') AND fingerprint IS NOT NULL ORDER BY scheduled_at DESC LIMIT 1`, j.ID, r.ID).Scan(&old)
		if old == fingerprint {
			state = "unchanged"
		} else {
			result, err := s.Chat(runctx, p, ChatInput{ConfigID: j.ConfigID, RequestID: r.ID, Message: j.Prompt, Locale: j.Locale, Context: j.Context, JobMode: true, PinnedTemplate: &j.Template, Parameters: j.Parameters})
			e = err
			if e == nil {
				conversation = result.ConversationID
				tag, err := s.Pool.Exec(runctx, `UPDATE assistant_runs SET conversation_id=$3 WHERE id=$1 AND lease_id=$2 AND lease_until>now()`, r.ID, lease, conversation)
				if err != nil {
					e = err
				} else if tag.RowsAffected() != 1 {
					e = conflict()
				}
				state = "done"
				if len(result.Turn.Actions) > 0 {
					state = "draft"
				}
				if j.Publish && e == nil {
					for _, a := range result.Turn.Actions {
						if a.Kind != "propose_report" {
							continue
						} // Recheck job grant and membership at the publish boundary.
						grantTx, err := s.Pool.Begin(runctx)
						if err != nil {
							e = err
							break
						}
						var authorized string
						e = grantTx.QueryRow(runctx, `SELECT j.id FROM assistant_jobs j JOIN memberships m ON m.team_id=j.team_id AND m.user_id=j.owner_id JOIN assistant_configs c ON c.id=j.config_id AND ((c.team_id=j.team_id AND c.owner_id IS NULL) OR (c.team_id IS NULL AND c.owner_id=j.owner_id)) JOIN assistant_runs r ON r.job_id=j.id WHERE j.id=$1 AND j.enabled AND j.publish AND j.revision=$2 AND c.revision=j.config_revision AND c.verified_at IS NOT NULL AND (c.owner_id IS NULL OR c.owner_id=j.owner_id) AND r.id=$3 AND r.lease_id=$4 AND r.lease_until>now() FOR SHARE OF j,m,c,r`, j.ID, rev, r.ID, lease).Scan(&authorized)
						if e != nil {
							grantTx.Rollback(runctx)
							e = invalid("定时授权已撤销")
							break
						}
						done, err := s.Confirm(runctx, p, a.ID, "confirm")
						grantTx.Rollback(runctx)
						e = err
						if e != nil {
							break
						}
						if done.State != "done" {
							e = invalid("发布草稿失败")
							break
						}
						b := mustJSON(done.Result)
						var v struct {
							ID string `json:"id"`
						}
						_ = json.Unmarshal(b, &v)
						report = v.ID
						state = "done"
					}
				}
			}
		}
	}
	if e != nil {
		message = "定时运行失败，请检查成员、授权或服务配置"
		var ie *identity.Error
		if errors.As(e, &ie) {
			message = ie.Message
		}
		if r.Attempts < 3 {
			state = "retry"
		} else {
			state = "failed"
		}
		if errors.Is(e, pgx.ErrNoRows) || (ie != nil && (ie.Status == 403 || ie.Status == 404)) || strings.Contains(message, "授权") || strings.Contains(message, "配置已变化") {
			state = "blocked"
			_, _ = s.Pool.Exec(ctx, `UPDATE assistant_jobs SET enabled=false,revision=revision+1 WHERE id=$1 AND revision=$2`, j.ID, rev)
		}
	}
	_, _ = s.Pool.Exec(ctx, `UPDATE assistant_runs SET state=$3,message=$4,fingerprint=NULLIF($5,''),conversation_id=NULLIF($6,''),report_id=NULLIF($7,''),retry_at=now()+($8*interval '1 minute'),finished_at=CASE WHEN $3='retry' THEN NULL ELSE now() END,lease_until=NULL WHERE id=$1 AND lease_id=$2`, r.ID, lease, state, message, fingerprint, conversation, report, r.Attempts*r.Attempts)
	return true
}
func (s *Service) jobFingerprint(ctx context.Context, p identity.Principal, j Job) (string, error) {
	reports, e := s.Repo.List(ctx, p.TeamID)
	if e != nil {
		return "", e
	}
	scheduledSources := map[string]bool{}
	rows, err := s.Pool.Query(ctx, `SELECT a.id FROM assistant_actions a JOIN assistant_runs r ON r.conversation_id=a.conversation_id WHERE a.team_id=$1 AND a.kind='propose_report'`, p.TeamID)
	if err != nil {
		return "", err
	}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return "", err
		}
		scheduledSources["assistant:"+id] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", err
	}
	var evidence []any
	for _, r := range reports {
		if !scheduledSources[r.SourceID] && (j.Context.Project == "" || r.ProjectID == j.Context.Project) && (j.Context.Member == "" || r.AuthorID == j.Context.Member) && (j.Context.Domain == "" || r.Domain == j.Context.Domain || has(r.Domains, j.Context.Domain)) {
			evidence = append(evidence, r)
		}
	}
	// Full Todo state, not a truncated page, participates in change detection.
	all, e := s.Workspace.Todos(ctx, p)
	if e != nil {
		return "", e
	}
	var taskEvidence []any
	for _, t := range all {
		if !t.Archived && (j.Context.Project == "" || t.ProjectID == j.Context.Project) && (j.Context.Member == "" || t.AssigneeID == j.Context.Member) && (j.Context.Domain == "" || has(t.Domains, j.Context.Domain)) {
			taskEvidence = append(taskEvidence, map[string]any{"id": t.ID, "title": t.Title, "body": t.Body, "column": t.ColumnID, "assignee": t.AssigneeID, "project": t.ProjectID, "domains": t.Domains, "priority": t.Priority, "due": t.DueDate, "schedule": t.Schedule, "completed": t.CompletedAt, "comments": t.Comments})
		}
	}
	loc, _ := time.LoadLocation(j.Timezone)
	now := time.Now().In(loc)
	query, err := workspace.ParseCalendarQuery(url.Values{"from": {now.Format("2006-01-02")}, "to": {now.AddDate(0, 0, 31).Format("2006-01-02")}, "timezone": {j.Timezone}, "project": {j.Context.Project}, "domain": {j.Context.Domain}, "member": {j.Context.Member}, "limit": {"200"}})
	if err != nil {
		return "", err
	}
	var plans []any
	for n := 0; n < 20; n++ {
		page, err := s.Workspace.CalendarSchedule(ctx, p, query)
		if err != nil {
			return "", err
		}
		for _, item := range page.Items {
			if item.Source != "todo" {
				plans = append(plans, item)
			}
		}
		if page.NextCursor == "" {
			break
		}
		if n == 19 {
			return "", invalid("排期范围过大")
		}
		query.Cursor = page.NextCursor
		query.Revision = page.Revision
	}
	evidence = append(evidence, plans)

	return identity.Hash(fmt.Sprintf("%s:%s:%s", mustJSON(taskEvidence), mustJSON(evidence), mustJSON(map[string]any{"template": j.Template, "parameters": j.Parameters, "prompt": j.Prompt, "context": j.Context}))), nil
}

// Revoking a grant never requires an available/decryptable provider configuration.
func (s *Service) PauseJob(ctx context.Context, p identity.Principal, id string, revision int) (Job, error) {
	j, e := scanJob(s.Pool.QueryRow(ctx, `UPDATE assistant_jobs SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1 AND team_id=$2 AND owner_id=$3 AND revision=$4 RETURNING `+jobColumns, id, p.TeamID, p.UserID, revision))
	if errors.Is(e, pgx.ErrNoRows) {
		return j, conflict()
	}
	return j, e
}
