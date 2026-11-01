package workspace

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

// Dates are floating civil dates; instants are normalized to UTC. Never convert
// an all-day date to UTC and then display it in a different viewer's time zone.
type Schedule struct {
	Kind      string `json:"kind"`
	StartDate string `json:"start_date,omitempty"`
	EndDate   string `json:"end_date,omitempty"`
	StartAt   string `json:"start_at,omitempty"`
	EndAt     string `json:"end_at,omitempty"`
	Timezone  string `json:"timezone,omitempty"`
}

func (s *Schedule) Validate(point bool) error {
	if s == nil {
		return nil
	}
	if s.Kind == "date-range" {
		a, e := time.Parse("2006-01-02", s.StartDate)
		b, f := time.Parse("2006-01-02", s.EndDate)
		if e != nil || f != nil || a.Year() < 1 || b.Year() < 1 || b.Before(a) || s.StartAt != "" || s.EndAt != "" || s.Timezone != "" {
			return identity.Invalid("日期范围无效")
		}
	} else if s.Kind == "time-range" {
		a, e := time.Parse(time.RFC3339, s.StartAt)
		b, f := time.Parse(time.RFC3339, s.EndAt)
		_, z := time.LoadLocation(s.Timezone)
		if e != nil || f != nil || z != nil || s.Timezone == "" || s.Timezone == "Local" || a.UTC().Year() < 1 || b.UTC().Year() > 9999 || b.Before(a) || !point && b.Equal(a) || s.StartDate != "" || s.EndDate != "" {
			return identity.Invalid("时间范围或时区无效")
		}
		s.StartAt = a.UTC().Format(time.RFC3339Nano)
		s.EndAt = b.UTC().Format(time.RFC3339Nano)
	} else {
		return identity.Invalid("排期类型无效")
	}
	return nil
}

type CalendarQuery struct {
	TaskStatus                                                                                        string
	Archived                                                                                          bool
	From, To, Timezone, Day, Project, Domain, Member, Agent, Model, Status, Kind, Q, Cursor, Revision string
	Limit                                                                                             int
	Unscheduled                                                                                       bool
	Start, End                                                                                        time.Time
	Location                                                                                          *time.Location
}

// Find the first instant of a civil date, including zones whose spring
// transition skips midnight. ParseInLocation alone can normalize midnight to
// the previous day. A skipped date (e.g. a date-line jump) has the same boundary
// as its next civil date and legitimately contains no reporting instants.
func civilBoundary(day time.Time, loc *time.Location) time.Time {
	key := day.Format("2006-01-02")
	low, high := day.Unix()-48*3600, day.Unix()+48*3600
	for low < high {
		mid := low + (high-low)/2
		if time.Unix(mid, 0).In(loc).Format("2006-01-02") < key {
			low = mid + 1
		} else {
			high = mid
		}
	}
	return time.Unix(low, 0).In(loc)
}

func ParseCalendarQuery(v url.Values) (CalendarQuery, error) {
	q := CalendarQuery{From: v.Get("from"), To: v.Get("to"), Timezone: v.Get("timezone"), Day: v.Get("day"), Project: v.Get("project"), Domain: v.Get("domain"), Member: v.Get("member"), Agent: v.Get("agent"), Model: v.Get("model"), Status: v.Get("status"), Kind: v.Get("kind"), Q: v.Get("q"), Cursor: v.Get("cursor"), Revision: v.Get("revision"), Unscheduled: v.Get("unscheduled") == "true", Limit: 100}
	q.TaskStatus = v.Get("task_status")
	q.Archived = v.Get("archived") == "true"
	if q.TaskStatus != "" && q.TaskStatus != "open" && q.TaskStatus != "completed" || q.Kind != "" && q.Kind != "todo" && q.Kind != "phase" && q.Kind != "big_day" && q.Kind != "version" {
		return q, identity.Invalid("日历筛选无效")
	}
	if q.Timezone == "" {
		q.Timezone = "UTC"
	}
	loc, e := time.LoadLocation(q.Timezone)
	if e != nil || q.Timezone == "Local" {
		return q, identity.Invalid("时区无效")
	}
	q.Location = loc
	from, e := time.Parse("2006-01-02", q.From)
	if e != nil {
		return q, identity.Invalid("日期范围无效")
	}
	to, e := time.Parse("2006-01-02", q.To)
	if e != nil || from.Year() < 1 || to.Year() < 1 || !to.After(from) || to.After(from.AddDate(0, 0, 93)) {
		return q, identity.Invalid("日期范围需为 1–93 天")
	}
	q.Start = civilBoundary(from, loc)
	q.End = civilBoundary(to, loc)
	if q.Day != "" {
		d, e := time.Parse("2006-01-02", q.Day)
		if e != nil || d.Before(from) || !d.Before(to) {
			return q, identity.Invalid("日期不在查询范围内")
		}
	}
	if x := v.Get("limit"); x != "" {
		q.Limit, e = strconv.Atoi(x)
		if e != nil || q.Limit < 1 || q.Limit > 200 {
			return q, identity.Invalid("分页数量无效")
		}
	}
	if len(q.Q) > 500 || len(q.Cursor) > 1000 || len(q.Revision) > 160 {
		return q, identity.Invalid("查询字段过长")
	}
	if q.Status != "" && !strings.Contains("|progress|review|blocked|delivered|resolved|", "|"+q.Status+"|") {
		return q, identity.Invalid("简报状态无效")
	}
	return q, nil
}
func (s *Schedule) Overlaps(q CalendarQuery) bool {
	if s == nil {
		return false
	}
	if s.Kind == "date-range" {
		return s.StartDate < q.To && s.EndDate >= q.From
	}
	if !q.End.After(q.Start) { return false }
	a, e := time.Parse(time.RFC3339, s.StartAt)
	b, f := time.Parse(time.RFC3339, s.EndAt)
	return e == nil && f == nil && a.Before(q.End) && (b.After(q.Start) || a.Equal(b) && !a.Before(q.Start))
}
func calendarRevision(v any) string {
	b, _ := json.Marshal(v)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
func calendarChanged() error {
	return &identity.Error{Status: 409, Message: "日历数据已变化，请刷新后重试"}
}

type CalendarReportPage struct {
	Items      []store.Report            `json:"items"`
	Days       map[string]int            `json:"days"`
	Previews   map[string][]store.Report `json:"previews"`
	Total      int                       `json:"total"`
	Revision   string                    `json:"revision"`
	NextCursor string                    `json:"next_cursor"`
	Timezone   string                    `json:"timezone"`
}

// Calendar reads only bounded rows from PostgreSQL, never the repository's full
// team history. Counts and page data share one repeatable-read snapshot.
func (s *Service) CalendarReports(ctx context.Context, p identity.Principal, repo store.Repository, q CalendarQuery) (CalendarReportPage, error) {
	out := CalendarReportPage{Items: []store.Report{}, Days: map[string]int{}, Previews: map[string][]store.Report{}, Timezone: q.Timezone}
	if !p.Can("reports:read") {
		return out, identity.Denied("需要 reports:read 权限")
	}
	if s.Pool == nil {
		rows, e := repo.List(ctx, p.TeamID)
		if e != nil {
			return out, e
		}
		return ReportCalendar(rows, q)
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return out, e
	}
	defer tx.Rollback(ctx)
	where := ` FROM reports WHERE team_id=$1 AND deleted_at IS NULL AND created_at >= $2 AND created_at < $3
 AND ($4='' OR project_id=$4) AND ($5='' OR domain=$5 OR $5=ANY(domains))
 AND ($6='' OR author_id=$6) AND ($7='' OR agent=$7) AND ($8='' OR model=$8) AND ($9='' OR status=$9)
 AND ($10='' OR strpos(lower(title||' '||body),lower($10))>0)`
	args := []any{p.TeamID, q.Start, q.End, q.Project, q.Domain, q.Member, q.Agent, q.Model, q.Status, q.Q}
	// Include the query itself so a cursor cannot be replayed under other filters.
	var stamp string
	e = tx.QueryRow(ctx, `SELECT coalesce(md5(string_agg(id||updated_at::text,',' ORDER BY id)),'empty')`+where, args...).Scan(&stamp)
	if e != nil {
		return out, e
	}
	out.Revision = calendarRevision([]string{q.From, q.To, q.Timezone, q.Day, q.Project, q.Domain, q.Member, q.Agent, q.Model, q.Status, q.Q, stamp})
	if q.Revision != "" && q.Revision != out.Revision {
		return out, calendarChanged()
	}
	rows, e := tx.Query(ctx, `SELECT to_char(created_at AT TIME ZONE $11,'YYYY-MM-DD'),count(*)`+where+` GROUP BY 1`, append(args, q.Timezone)...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var d string
		var n int
		if e = rows.Scan(&d, &n); e != nil {
			rows.Close()
			return out, e
		}
		out.Days[d] = n
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	for d, n := range out.Days {
		if q.Day == "" || q.Day == d {
			out.Total += n
		}
	}
	// At most three title previews per day, independent of the selected day's
	// detail page. The window query stays inside the same bounded snapshot.
	rows, e = tx.Query(ctx, `WITH ranked AS (SELECT id,title,created_at,to_char(created_at AT TIME ZONE $11,'YYYY-MM-DD') AS day,row_number() OVER(PARTITION BY to_char(created_at AT TIME ZONE $11,'YYYY-MM-DD') ORDER BY created_at DESC,id DESC) AS rank`+where+`) SELECT day,id,title FROM ranked WHERE rank<=3 ORDER BY created_at DESC,id DESC`, append(args, q.Timezone)...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var day string
		var report store.Report
		if e = rows.Scan(&day, &report.ID, &report.Title); e != nil {
			rows.Close()
			return out, e
		}
		out.Previews[day] = append(out.Previews[day], report)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	cursorTime, cursorID, e := decodeReportCursor(q)
	if e != nil {
		return out, e
	}
	// A timestamp cast must never receive the empty sentinel.
	after := cursorTime
	if after == "" {
		after = "9999-12-31T23:59:59Z"
	}
	more := ` AND ($11='' OR to_char(created_at AT TIME ZONE $12,'YYYY-MM-DD')=$11) AND (created_at,id)<($13::timestamptz,$14) ORDER BY created_at DESC,id DESC LIMIT $15`
	rows, e = tx.Query(ctx, `SELECT jsonb_build_object('id',id,'title',title,'author_id',author_id,'project_id',project_id,'domains',domains,'domain',domain,'status',status,'agent',agent,'model',model,'links',links,'created_at',created_at,'updated_at',updated_at)`+where+more, append(args, q.Day, q.Timezone, after, cursorID, q.Limit+1)...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var raw []byte
		var r store.Report
		if e = rows.Scan(&raw); e == nil {
			e = json.Unmarshal(raw, &r)
		}
		if e != nil {
			rows.Close()
			return out, e
		}
		out.Items = append(out.Items, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	finishReportPage(&out, q.Limit)
	return out, tx.Commit(ctx)
}
func decodeReportCursor(q CalendarQuery) (string, string, error) {
	if q.Cursor == "" {
		return "", "", nil
	}
	if q.Revision == "" {
		return "", "", identity.Invalid("分页需要日历修订号")
	}
	b, e := base64.RawURLEncoding.DecodeString(q.Cursor)
	var v []string
	if e != nil || json.Unmarshal(b, &v) != nil || len(v) != 2 {
		return "", "", identity.Invalid("分页标识无效")
	}
	if _, e = time.Parse(time.RFC3339Nano, v[0]); e != nil || len(v[1]) > 160 {
		return "", "", identity.Invalid("分页标识无效")
	}
	return v[0], v[1], nil
}
func finishReportPage(out *CalendarReportPage, limit int) {
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[limit-1]
		b, _ := json.Marshal([]string{last.CreatedAt.Format(time.RFC3339Nano), last.ID})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
}

// Shared by local API demo and deterministic tests. Production uses the bounded
// SQL path above; the demo intentionally holds only synthetic reports in memory.
func ReportCalendar(rows []store.Report, q CalendarQuery) (CalendarReportPage, error) {
	out := CalendarReportPage{Items: []store.Report{}, Days: map[string]int{}, Previews: map[string][]store.Report{}, Timezone: q.Timezone}
	filtered := []store.Report{}
	for _, r := range rows {
		if r.DeletedAt != nil || r.CreatedAt.Before(q.Start) || !r.CreatedAt.Before(q.End) || q.Project != "" && q.Project != r.ProjectID || q.Domain != "" && q.Domain != r.Domain && !stringIn(r.Domains, q.Domain) || q.Member != "" && r.AuthorID != q.Member || q.Agent != "" && r.Agent != q.Agent || q.Model != "" && r.Model != q.Model || q.Status != "" && r.Status != q.Status || !strings.Contains(strings.ToLower(r.Title+" "+r.Body), strings.ToLower(q.Q)) {
			continue
		}
		filtered = append(filtered, r)
		out.Days[r.CreatedAt.In(q.Location).Format("2006-01-02")]++
	}
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].CreatedAt.Equal(filtered[j].CreatedAt) {
			return filtered[i].ID > filtered[j].ID
		}
		return filtered[i].CreatedAt.After(filtered[j].CreatedAt)
	})
	signature := q
	signature.Cursor = ""
	signature.Revision = ""
	signature.Limit = 0
	out.Revision = calendarRevision([]any{signature, filtered})
	if q.Revision != "" && q.Revision != out.Revision {
		return out, calendarChanged()
	}
	ct, ci, e := decodeReportCursor(q)
	if e != nil {
		return out, e
	}
	var at time.Time
	if ct != "" {
		at, _ = time.Parse(time.RFC3339Nano, ct)
	}
	for _, r := range filtered {
		day := r.CreatedAt.In(q.Location).Format("2006-01-02")
		if len(out.Previews[day]) < 3 {
			out.Previews[day] = append(out.Previews[day], store.Report{ID: r.ID, Title: r.Title})
		}
		if q.Day != "" && q.Day != r.CreatedAt.In(q.Location).Format("2006-01-02") {
			continue
		}
		out.Total++
		if ct != "" && (r.CreatedAt.After(at) || r.CreatedAt.Equal(at) && r.ID >= ci) {
			continue
		}
		r.Body = ""
		r.Comments = nil
		r.TodoIDs = nil
		out.Items = append(out.Items, r)
	}
	finishReportPage(&out, q.Limit)
	return out, nil
}
