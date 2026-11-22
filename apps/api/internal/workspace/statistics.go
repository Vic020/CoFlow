package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

// Statistics is read-only. Current snapshots and dated events are deliberately
// separate metrics. Event attribution always uses the historical task snapshot.
type StatisticsQuery struct {
	identity string
	CalendarQuery
	Metric, GroupBy, Group, Revision string
	Offset                           int
	IncludeSources                   bool
}
type StatisticRecord struct {
	ID      string    `json:"id"`
	Title   string    `json:"title"`
	URL     string    `json:"url"`
	At      time.Time `json:"at"`
	Project string    `json:"project"`
	Domains []string  `json:"domains"`
	Member  string    `json:"member"`
	Agent   string    `json:"agent"`
	Model   string    `json:"model"`
	Hours   *float64  `json:"hours,omitempty"`
}
type StatisticMetric struct {
	Key   string `json:"key"`
	Basis string `json:"basis"`
	Count int    `json:"count"`
}
type StatisticDay struct {
	Day    string         `json:"day"`
	Values map[string]int `json:"values"`
}
type StatisticGroup struct {
	Key    string         `json:"key"`
	Values map[string]int `json:"values"`
}
type StatisticsSources struct {
	Agents []string `json:"agents"`
	Models []string `json:"models"`
}

type StatisticsResult struct {
	Sources      *StatisticsSources `json:"sources,omitempty"`
	From         string             `json:"from"`
	To           string             `json:"to"`
	Timezone     string             `json:"timezone"`
	GeneratedAt  time.Time          `json:"generated_at"`
	Revision     string             `json:"revision"`
	Capabilities map[string]bool    `json:"capabilities"`
	Metrics      []StatisticMetric  `json:"metrics"`
	Trend        []StatisticDay     `json:"trend"`
	Groups       []StatisticGroup   `json:"groups"`
	Details      []StatisticRecord  `json:"details"`
	DetailTotal  int                `json:"detail_total"`
	NextOffset   int                `json:"next_offset"`
	HasMore      bool               `json:"has_more"`
	Duration     map[string]int     `json:"duration"`
	Coverage     []string           `json:"coverage"`
}

var statisticDefinitions = []struct{ key, module, basis string }{
	{"reports_created", "reports", "period"}, {"reports_delivered", "reports", "period_current_status"}, {"delivery_links", "reports", "period_current_links"}, {"reporters", "reports", "period"},
	{"todos_open", "todos", "current"}, {"todos_review", "todos", "current"}, {"todos_overdue", "todos", "current"}, {"todos_created", "todos", "period"}, {"todos_completed", "todos", "period_event"}, {"todos_reopened", "todos", "period_event"},
	{"todos_unscheduled", "todos", "current"}, {"calendar_nodes", "calendar", "overlapping_plan"}, {"scheduled_todos", "todos", "overlapping_plan"}, {"scheduled_completed", "todos", "overlapping_plan_current_status"},
	{"collaborations_open", "reports", "current"}, {"collaborations_created", "reports", "period"}, {"collaborations_completed", "reports", "period_event"}, {"collaborations_transferred", "reports", "current"},
}

func ParseStatisticsQuery(v url.Values) (StatisticsQuery, error) {
	c, e := ParseCalendarQuery(v)
	q := StatisticsQuery{CalendarQuery: c, Metric: v.Get("metric"), GroupBy: v.Get("group_by"), Group: v.Get("group"), Revision: v.Get("revision"), IncludeSources: v.Get("include_sources") == "true"}
	if e != nil {
		return q, e
	}
	if q.GroupBy == "" {
		q.GroupBy = "project"
	}
	if !strings.Contains("|project|domain|member|agent|model|", "|"+q.GroupBy+"|") {
		return q, identity.Invalid("统计分组无效")
	}
	if q.Metric != "" {
		found := false
		for _, d := range statisticDefinitions {
			found = found || d.key == q.Metric
		}
		if !found {
			return q, identity.Invalid("统计指标无效")
		}
	}
	if v.Get("offset") != "" {
		q.Offset, e = strconv.Atoi(v.Get("offset"))
		if e != nil || q.Offset < 0 || q.Offset > 100000 {
			return q, identity.Invalid("统计分页无效")
		}
	}
	if q.Offset > 0 && q.Revision == "" {
		return q, identity.Invalid("统计分页需要 revision")
	}
	for _, x := range []string{q.Project, q.Domain, q.Member, q.Agent, q.Model, q.Group} {
		if len(x) > 160 {
			return q, identity.Invalid("统计筛选过长")
		}
	}
	return q, nil
}
func statisticMatch(q StatisticsQuery, r StatisticRecord) bool {
	if q.Project != "" && r.Project != q.Project || q.Member != "" && r.Member != q.Member || q.Agent != "" && r.Agent != q.Agent || q.Model != "" && r.Model != q.Model {
		return false
	}
	if q.Domain != "" {
		for _, d := range r.Domains {
			if d == q.Domain {
				return true
			}
		}
		return false
	}
	return true
}
func statisticGroupKeys(q StatisticsQuery, r StatisticRecord) []string {
	switch q.GroupBy {
	case "domain":
		if len(r.Domains) > 0 {
			return r.Domains
		}
	case "member":
		return []string{r.Member}
	case "agent":
		return []string{r.Agent}
	case "model":
		return []string{r.Model}
	default:
		return []string{r.Project}
	}
	return []string{""}
}
func (s *Service) Statistics(ctx context.Context, p identity.Principal, q StatisticsQuery) (StatisticsResult, error) {
	caps := map[string]bool{"reports": p.Can("reports:read"), "todos": p.Can("todos:read"), "calendar": p.Can("calendar:read")}
	if !caps["reports"] && !caps["todos"] && !caps["calendar"] {
		return StatisticsResult{}, identity.Denied("需要模块读取权限")
	}
	// Parse at this boundary too: internal tools cannot bypass the HTTP validator.
	v := url.Values{"from": {q.From}, "to": {q.To}, "timezone": {q.Timezone}, "project": {q.Project}, "domain": {q.Domain}, "member": {q.Member}, "agent": {q.Agent}, "model": {q.Model}, "metric": {q.Metric}, "group_by": {q.GroupBy}, "group": {q.Group}, "offset": {strconv.Itoa(q.Offset)}, "revision": {q.Revision}, "include_sources": {strconv.FormatBool(q.IncludeSources)}}
	parsed, e := ParseStatisticsQuery(v)
	if e != nil {
		return StatisticsResult{}, e
	}
	q = parsed
	q.identity = p.TeamID + ":" + p.UserID
	var b TodoBoard
	reports := []store.Report{}
	events := []CalendarEvent{}
	collabs := []statisticCollaboration{}
	if s.TodoDemo != nil {
		s.TodoDemo.mu.Lock()
		if s.TodoDemo.board != nil {
			raw, _ := json.Marshal(s.TodoDemo.board)
			e = json.Unmarshal(raw, &b)
		}
		s.TodoDemo.mu.Unlock()
		if e != nil {
			return StatisticsResult{}, e
		}
		events = b.CalendarEvents
		if caps["reports"] && s.SourceReports != nil {
			reports, e = s.SourceReports.List(ctx, p.TeamID)
		}
	} else {
		// No catalog seeding, board initialization, locks or writes on this read path.
		tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
		if err != nil {
			return StatisticsResult{}, err
		}
		defer tx.Rollback(ctx)
		if caps["todos"] {
			var raw []byte
			err = tx.QueryRow(ctx, `SELECT document - 'operations' - 'calendar_operations' - 'contexts' - 'delegations' - 'calendar_events' - 'history' FROM todo_boards WHERE team_id=$1`, p.TeamID).Scan(&raw)
			if err == nil {
				err = json.Unmarshal(raw, &b)
			}
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return StatisticsResult{}, err
			}
		}
		if caps["reports"] {
			agent, model := q.Agent, q.Model
			if q.IncludeSources {
				agent, model = "", ""
			}
			rows, err := tx.Query(ctx, `SELECT id,title,project_id,domains,author_id,agent,model,status,links,created_at FROM reports WHERE team_id=$1 AND deleted_at IS NULL AND created_at >= $2 AND created_at < $3 AND ($4='' OR project_id=$4) AND ($5='' OR $5=ANY(domains)) AND ($6='' OR author_id=$6) AND ($7='' OR agent=$7) AND ($8='' OR model=$8) ORDER BY created_at,id LIMIT 100001`, p.TeamID, q.Start, q.End, q.Project, q.Domain, q.Member, agent, model)
			if err != nil {
				return StatisticsResult{}, err
			}
			for rows.Next() {
				var r store.Report
				var raw []byte
				if err = rows.Scan(&r.ID, &r.Title, &r.ProjectID, &r.Domains, &r.AuthorID, &r.Agent, &r.Model, &r.Status, &raw, &r.CreatedAt); err != nil {
					rows.Close()
					return StatisticsResult{}, err
				}
				if err = json.Unmarshal(raw, &r.Links); err != nil {
					rows.Close()
					return StatisticsResult{}, err
				}
				reports = append(reports, r)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return StatisticsResult{}, err
			}
			rows, err = tx.Query(ctx, `SELECT c.id,c.title,c.report_id,c.assignee_id,c.status,c.todo_id,c.created_at,r.project_id,r.domains,COALESCE((SELECT jsonb_agg(jsonb_build_object('status',u.status,'created_at',u.created_at) ORDER BY u.created_at,u.id) FROM collaboration_updates u WHERE u.request_id=c.id),'[]') FROM collaboration_requests c JOIN reports r ON r.id=c.report_id AND r.team_id=c.team_id WHERE c.team_id=$1 AND r.deleted_at IS NULL AND ($2='' OR r.project_id=$2) AND ($3='' OR $3=ANY(r.domains)) AND ($4='' OR c.assignee_id=$4) ORDER BY c.id LIMIT 100001`, p.TeamID, q.Project, q.Domain, q.Member)
			if err != nil {
				return StatisticsResult{}, err
			}
			for rows.Next() {
				var c statisticCollaboration
				var raw []byte
				if err = rows.Scan(&c.ID, &c.Title, &c.ReportID, &c.Member, &c.Status, &c.TodoID, &c.At, &c.Project, &c.Domains, &raw); err != nil {
					rows.Close()
					return StatisticsResult{}, err
				}
				if err = json.Unmarshal(raw, &c.Updates); err != nil {
					rows.Close()
					return StatisticsResult{}, err
				}
				collabs = append(collabs, c)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return StatisticsResult{}, err
			}
		}
		if caps["calendar"] {
			rows, err := tx.Query(ctx, `SELECT document - 'history' - 'body' - 'links' - 'report_ids' FROM calendar_events WHERE team_id=$1 ORDER BY id LIMIT 100001`, p.TeamID)
			if err != nil {
				return StatisticsResult{}, err
			}
			for rows.Next() {
				var raw []byte
				var x CalendarEvent
				if err = rows.Scan(&raw); err == nil {
					err = json.Unmarshal(raw, &x)
				}
				if err != nil {
					rows.Close()
					return StatisticsResult{}, err
				}
				events = append(events, x)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return StatisticsResult{}, err
			}
		}
		e = tx.Commit(ctx)
	}
	if e != nil {
		return StatisticsResult{}, e
	}
	if len(reports) > 100000 || len(events) > 100000 || len(collabs) > 100000 || len(b.Tasks) > 100000 {
		return StatisticsResult{}, identity.Invalid("统计范围过大，请缩小范围")
	}
	result, err := buildStatistics(q, caps, b, reports, events, collabs, time.Now().UTC())
	return result, err
}

type statisticCollaboration struct {
	StatisticRecord
	ReportID, Status, TodoID string
	Updates                  []Update
}

func buildStatistics(q StatisticsQuery, caps map[string]bool, b TodoBoard, reports []store.Report, events []CalendarEvent, collabs []statisticCollaboration, now time.Time) (StatisticsResult, error) {
	out := StatisticsResult{From: q.From, To: q.To, Timezone: q.Timezone, GeneratedAt: now, Capabilities: caps, Metrics: []StatisticMetric{}, Trend: []StatisticDay{}, Groups: []StatisticGroup{}, Details: []StatisticRecord{}, Duration: map[string]int{"under_day": 0, "one_to_seven_days": 0, "over_seven_days": 0, "missing": 0}, Coverage: []string{"current_status_is_not_historical_delivery", "multi_domain_groups_are_not_additive", "activity_is_not_quality_or_work_hours", "missing_task_cycles_are_excluded", "collaboration_history_has_no_assignment_snapshot", "report_periods_use_current_classification", "legacy_task_creation_may_use_current_attribution"}}
	records := map[string][]StatisticRecord{}
	seen := map[string]map[string]bool{}
	days := map[string]map[string]int{}
	daySeen := map[string]bool{}
	for d, _ := time.Parse("2006-01-02", q.From); d.Format("2006-01-02") < q.To; d = d.AddDate(0, 0, 1) {
		days[d.Format("2006-01-02")] = map[string]int{}
	}
	scope := q
	scope.Agent, scope.Model = "", ""
	agents, models := map[string]struct{}{}, map[string]struct{}{}
	add := func(metric string, r StatisticRecord) {
		if q.IncludeSources && statisticMatch(scope, r) {
			if r.Agent != "" && len(r.Agent) <= 160 {
				agents[r.Agent] = struct{}{}
			}
			if r.Model != "" && len(r.Model) <= 160 {
				models[r.Model] = struct{}{}
			}
		}
		if !statisticMatch(q, r) {
			return
		}
		if seen[metric] == nil {
			seen[metric] = map[string]bool{}
		}
		if seen[metric][r.ID] && metric != "reporters" {
			return
		}
		seen[metric][r.ID] = true
		records[metric] = append(records[metric], r)
		if v := days[r.At.In(q.Location).Format("2006-01-02")]; v != nil && (metric == "reports_created" || metric == "todos_created" || metric == "todos_completed" || metric == "todos_reopened" || metric == "collaborations_created" || metric == "collaborations_completed" || metric == "reporters") {
			key := metric + ":" + r.At.In(q.Location).Format("2006-01-02") + ":" + r.ID
			if !daySeen[key] {
				v[metric]++
				daySeen[key] = true
			}
		}
	}
	inRange := func(t time.Time) bool { return !t.Before(q.Start) && t.Before(q.End) }
	if !caps["reports"] {
		reports = nil
		collabs = nil
	}
	for _, r := range reports {
		if len(r.Domains) == 0 && r.Domain != "" {
			r.Domains = []string{r.Domain}
		}
		if r.DeletedAt != nil || !inRange(r.CreatedAt) {
			continue
		}
		x := StatisticRecord{ID: r.ID, Title: r.Title, URL: "/?report=" + url.QueryEscape(r.ID), At: r.CreatedAt, Project: r.ProjectID, Domains: r.Domains, Member: r.AuthorID, Agent: r.Agent, Model: r.Model}
		add("reports_created", x)
		if r.Status == "delivered" {
			add("reports_delivered", x)
		}
		author := x
		author.ID = r.AuthorID
		add("reporters", author)
		for _, l := range r.Links {
			u, err := url.Parse(strings.TrimSpace(l.URL))
			if err == nil {
				u.Scheme = strings.ToLower(u.Scheme)
			}
			if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
				continue
			}
			u.Fragment = ""
			u.Host = strings.ToLower(u.Host)
			if u.Path == "" {
				u.Path = "/"
			}
			link := x
			link.ID = r.ID + ":" + identity.Hash(u.String())
			add("delivery_links", link)
		}
	}
	if caps["todos"] {
		for _, t := range b.Tasks {
			x := statisticTodoRecord(t, t.CreatedAt)
			if !t.Archived {
				if t.CompletedAt == nil {
					add("todos_open", x)
					if t.ColumnID == "review" || t.Review != nil && t.Review.State == "pending" {
						add("todos_review", x)
					}
					if t.DueDate != "" && t.DueDate < now.In(q.Location).Format("2006-01-02") {
						add("todos_overdue", x)
					}
					if t.Schedule == nil && t.DueDate == "" {
						add("todos_unscheduled", x)
					}
				}
				if t.Schedule != nil && t.Schedule.Overlaps(q.CalendarQuery) || t.Schedule == nil && t.DueDate != "" && t.DueDate >= q.From && t.DueDate < q.To {
					add("scheduled_todos", x)
					if t.CompletedAt != nil {
						add("scheduled_completed", x)
					}
				}
			}
			if inRange(t.CreatedAt) {
				created := x
				for _, h := range t.History {
					var before, after Todo
					if json.Unmarshal(h.Before, &before) == nil && json.Unmarshal(h.After, &after) == nil && before.ID == "" && after.ID == t.ID {
						created = statisticTodoRecord(after, t.CreatedAt)
						created.Agent = h.Agent
						created.Model = h.Model
						break
					}
				}
				add("todos_created", created)
			}
			history := append([]TodoEvent{}, t.History...)
			sort.SliceStable(history, func(i, j int) bool { return history[i].CreatedAt.Before(history[j].CreatedAt) })
			var cycle *time.Time
			for _, h := range history {
				var before, after Todo
				if json.Unmarshal(h.Before, &before) != nil || json.Unmarshal(h.After, &after) != nil {
					continue
				}
				if after.ID == "" {
					continue
				}
				if before.ID == "" && after.CompletedAt == nil && !after.CreatedAt.IsZero() {
					v := after.CreatedAt
					cycle = &v
				}
				if before.CompletedAt != nil && after.CompletedAt == nil {
					v := h.CreatedAt
					cycle = &v
					if inRange(h.CreatedAt) {
						r := statisticTodoRecord(after, h.CreatedAt)
						r.Agent = h.Agent
						r.Model = h.Model
						add("todos_reopened", r)
					}
				}
				if before.CompletedAt == nil && after.CompletedAt != nil {
					if inRange(h.CreatedAt) {
						r := statisticTodoRecord(after, h.CreatedAt)
						r.Agent = h.Agent
						r.Model = h.Model
						if cycle != nil && !cycle.After(h.CreatedAt) {
							hours := h.CreatedAt.Sub(*cycle).Hours()
							r.Hours = &hours
						}
						add("todos_completed", r)
					}
					cycle = nil
				}
			}
		}
	}
	if caps["calendar"] {
		for _, e := range events {
			if !e.Archived && e.Schedule != nil && e.Schedule.Overlaps(q.CalendarQuery) {
				add("calendar_nodes", StatisticRecord{ID: e.ID, Title: e.Title, URL: "/calendar?mode=schedule&event=" + url.QueryEscape(e.ID), At: e.CreatedAt, Project: e.ProjectID, Domains: e.Domains, Member: e.AssigneeID, Agent: e.Agent, Model: e.Model})
			}
		}
	}
	for _, c := range collabs {
		r := c.StatisticRecord
		r.URL = "/?report=" + url.QueryEscape(c.ReportID)
		if c.TodoID != "" {
			add("collaborations_transferred", r)
		} else if c.Status != "done" && c.Status != "cancelled" {
			add("collaborations_open", r)
		}
		if inRange(r.At) {
			add("collaborations_created", r)
		}
		previousStatus := "open"
		for _, u := range c.Updates {
			if previousStatus != "done" && u.Status == "done" && inRange(u.CreatedAt) && q.Project == "" && q.Domain == "" && q.Member == "" {
				v := r
				v.At = u.CreatedAt
				v.Project = ""
				v.Domains = nil
				v.Member = ""
				add("collaborations_completed", v)
			}
			if u.Status != "" {
				previousStatus = u.Status
			}
		}
	}
	if q.IncludeSources {
		out.Sources = &StatisticsSources{Agents: append([]string{}, slices.Sorted(maps.Keys(agents))...), Models: append([]string{}, slices.Sorted(maps.Keys(models))...)}
	}
	// Revisions bind pagination to the exact filtered inputs, permissions, identity,
	// query and current civil day; callers restart rather than combine snapshots.
	out.Revision = calendarRevision([]any{q.identity, q.From, q.To, q.Timezone, q.Project, q.Domain, q.Member, q.Agent, q.Model, q.GroupBy, caps, records, now.In(q.Location).Format("2006-01-02")})
	if q.Revision != "" && q.Revision != out.Revision {
		return out, &identity.Error{Status: 409, Message: "统计数据已变化，请刷新后重试"}
	}
	groups := map[string]map[string]int{}
	groupSeen := map[string]map[string]map[string]bool{}
	for _, d := range statisticDefinitions {
		if !caps[d.module] || d.key == "collaborations_completed" && (q.Project != "" || q.Domain != "" || q.Member != "") {
			continue
		}
		xs := records[d.key]
		out.Metrics = append(out.Metrics, StatisticMetric{d.key, d.basis, len(seen[d.key])})
		for _, r := range xs {
			keys := statisticGroupKeys(q, r)
			unique := map[string]bool{}
			for _, k := range keys {
				if unique[k] {
					continue
				}
				unique[k] = true
				if groups[k] == nil {
					groups[k] = map[string]int{}
				}
				if groupSeen[k] == nil {
					groupSeen[k] = map[string]map[string]bool{}
				}
				if groupSeen[k][d.key] == nil {
					groupSeen[k][d.key] = map[string]bool{}
				}
				if !groupSeen[k][d.key][r.ID] {
					groups[k][d.key]++
					groupSeen[k][d.key][r.ID] = true
				}
			}
		}
	}
	if len(groups) > 1000 {
		return out, identity.Invalid("统计分组过多，请缩小范围")
	}
	for k, v := range days {
		out.Trend = append(out.Trend, StatisticDay{k, v})
	}
	sort.Slice(out.Trend, func(i, j int) bool { return out.Trend[i].Day < out.Trend[j].Day })
	for k, v := range groups {
		out.Groups = append(out.Groups, StatisticGroup{k, v})
	}
	sort.Slice(out.Groups, func(i, j int) bool { return out.Groups[i].Key < out.Groups[j].Key })
	for _, r := range records["todos_completed"] {
		if r.Hours == nil {
			out.Duration["missing"]++
		} else if *r.Hours < 24 {
			out.Duration["under_day"]++
		} else if *r.Hours <= 168 {
			out.Duration["one_to_seven_days"]++
		} else {
			out.Duration["over_seven_days"]++
		}
	}
	if q.Metric != "" {
		xs := []StatisticRecord{}
		detailSeen := map[string]bool{}
		for _, r := range records[q.Metric] {
			match := q.Group == ""
			for _, g := range statisticGroupKeys(q, r) {
				if g == q.Group || g == "" && q.Group == "__unassigned__" {
					match = true
				}
			}
			if match && !detailSeen[r.ID] {
				detailSeen[r.ID] = true
				xs = append(xs, r)
			}
		}
		sort.Slice(xs, func(i, j int) bool {
			if xs[i].At.Equal(xs[j].At) {
				return xs[i].ID < xs[j].ID
			}
			return xs[i].At.After(xs[j].At)
		})
		out.DetailTotal = len(xs)
		start := q.Offset
		if start > len(xs) {
			start = len(xs)
		}
		end := start + 50
		if end > len(xs) {
			end = len(xs)
		}
		out.Details = xs[start:end]
		out.NextOffset = end
		out.HasMore = end < len(xs)
	}
	return out, nil
}
func statisticTodoRecord(t Todo, at time.Time) StatisticRecord {
	return StatisticRecord{ID: t.ID, Title: t.Title, URL: "/todo?todo=" + url.QueryEscape(t.ID), At: at, Project: t.ProjectID, Domains: t.Domains, Member: t.AssigneeID, Agent: t.Agent, Model: t.Model}
}
