package workspace

import (
	"coflow/api/internal/store"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"
)

func statQuery(t *testing.T, extra url.Values) StatisticsQuery {
	t.Helper()
	v := url.Values{"from": {"2026-11-01"}, "to": {"2026-11-08"}, "timezone": {"Asia/Shanghai"}}
	for k, x := range extra {
		v[k] = x
	}
	q, e := ParseStatisticsQuery(v)
	if e != nil {
		t.Fatal(e)
	}
	return q
}
func statTime(s string) time.Time {
	v, e := time.Parse(time.RFC3339, s)
	if e != nil {
		panic(e)
	}
	return v
}
func metricCount(r StatisticsResult, k string) int {
	for _, m := range r.Metrics {
		if m.Key == k {
			return m.Count
		}
	}
	return -1
}
func TestStatisticsManualLedger(t *testing.T) {
	start := statTime("2026-11-01T01:00:00Z")
	complete := start.Add(25 * time.Hour)
	reopen := complete.Add(time.Hour)
	again := reopen.Add(time.Hour)
	first := Todo{ID: "task", Title: "Original", CreatedAt: start, AssigneeID: "alice", ProjectID: "one", Domains: []string{"design", "code"}}
	done := first
	done.CompletedAt = &complete
	reopened := done
	reopened.CompletedAt = nil
	reopened.AssigneeID = "bob"
	reopened.ProjectID = "two"
	final := reopened
	final.CompletedAt = &again
	final.Archived = true
	event := func(before, after Todo, at time.Time) TodoEvent {
		return TodoEvent{Before: todoSnapshot(before), After: todoSnapshot(after), CreatedAt: at, Agent: "Synthetic agent"}
	}
	final.History = []TodoEvent{event(Todo{}, first, start), event(first, done, complete), event(done, reopened, reopen), event(reopened, final, again)}
	missing := Todo{ID: "legacy", Title: "Unknown cycle", CreatedAt: start}
	legacyDone := missing
	legacyDone.CompletedAt = &complete
	legacyDone.History = []TodoEvent{event(missing, legacyDone, complete)}
	overdue := Todo{ID: "open", Title: "Late", DueDate: "2026-11-07", CreatedAt: start, Domains: []string{"design"}, Schedule: &Schedule{Kind: "date-range", StartDate: "2026-11-02", EndDate: "2026-11-03"}}
	reports := []store.Report{{ID: "a", AuthorID: "alice", Title: "A", ProjectID: "one", Domains: []string{"design", "code", "design"}, Status: "delivered", CreatedAt: start, Links: []store.Link{{URL: "https://EXAMPLE.test/result#one"}, {URL: "https://example.test/result#two"}}}, {ID: "b", AuthorID: "alice", Title: "B", ProjectID: "two", Domains: []string{"code"}, CreatedAt: complete}, {ID: "outside", AuthorID: "other", CreatedAt: statTime("2026-11-07T16:00:00Z")}}
	caps := map[string]bool{"reports": true, "todos": true, "calendar": true}
	q := statQuery(t, url.Values{"metric": {"todos_completed"}})
	r, e := buildStatistics(q, caps, TodoBoard{Tasks: []Todo{final, legacyDone, overdue}}, reports, nil, nil, statTime("2026-11-08T01:00:00Z"))
	if e != nil {
		t.Fatal(e)
	}
	for k, want := range map[string]int{"reports_created": 2, "reports_delivered": 1, "reporters": 1, "delivery_links": 1, "todos_completed": 2, "todos_reopened": 1, "todos_open": 1, "todos_overdue": 1, "todos_created": 3, "scheduled_todos": 1} {
		if got := metricCount(r, k); got != want {
			t.Errorf("%s got %d want %d", k, got, want)
		}
	}
	if r.Duration["one_to_seven_days"] != 1 || r.Duration["missing"] != 1 || r.Duration["under_day"] != 0 {
		t.Fatal("completion cycle dedup", r.Duration)
	}
	if len(r.Details) != 2 || r.DetailTotal != 2 {
		t.Fatal("details count")
	}
	linkQ := statQuery(t, url.Values{"metric": {"delivery_links"}})
	linkResult, _ := buildStatistics(linkQ, caps, TodoBoard{}, reports, nil, nil, start)
	linkJSON, _ := json.Marshal(linkResult.Details)
	if strings.Contains(string(linkJSON), "example.test") {
		t.Fatal("external link text leaked through count IDs")
	}
	q = statQuery(t, url.Values{"project": {"two"}, "metric": {"todos_completed"}})
	r, e = buildStatistics(q, caps, TodoBoard{Tasks: []Todo{final}}, reports, nil, nil, start)
	if e != nil || metricCount(r, "todos_completed") != 1 || r.Duration["under_day"] != 1 {
		t.Fatal("event snapshot after reassignment", e, r)
	}
	q = statQuery(t, url.Values{"group_by": {"domain"}})
	r, _ = buildStatistics(q, caps, TodoBoard{}, reports, nil, nil, start)
	if len(r.Groups) != 2 || metricCount(r, "reports_created") != 2 {
		t.Fatal("multi-domain total")
	}
	for _, g := range r.Groups {
		if g.Values["reporters"] != 1 {
			t.Fatal("group distinct member", g)
		}
	}
	q = statQuery(t, nil)
	r, _ = buildStatistics(q, caps, TodoBoard{}, reports, nil, nil, start)
	if len(r.Groups) != 2 || r.Groups[0].Values["reporters"] != 1 || r.Groups[1].Values["reporters"] != 1 {
		t.Fatal("member counts across projects")
	}
	q = statQuery(t, url.Values{"metric": {"reports_created"}, "revision": {r.Revision}})
	reports[0].Title = "changed"
	if _, e = buildStatistics(q, caps, TodoBoard{}, reports, nil, nil, start); e == nil {
		t.Fatal("mixed pagination snapshots")
	}
}
func TestStatisticsDatePermissionPaginationAndTransferred(t *testing.T) {
	for _, v := range []url.Values{{"timezone": {"Local"}}, {"to": {"2027-11-08"}}, {"group_by": {"private"}}, {"offset": {"-1"}}, {"metric": {"invented"}}} {
		base := url.Values{"from": {"2026-11-01"}, "to": {"2026-11-08"}, "timezone": {"UTC"}}
		for k, x := range v {
			base[k] = x
		}
		if _, e := ParseStatisticsQuery(base); e == nil {
			t.Fatal("invalid query", v)
		}
	}
	q := statQuery(t, url.Values{"from": {"2026-03-08"}, "to": {"2026-03-09"}, "timezone": {"America/New_York"}})
	if q.End.Sub(q.Start) != 23*time.Hour {
		t.Fatal("DST")
	}
	at := statTime("2026-11-02T12:00:00Z")
	q = statQuery(t, url.Values{"metric": {"reports_created"}})
	reports := []store.Report{}
	for i := 0; i < 65; i++ {
		reports = append(reports, store.Report{ID: fmt.Sprint(i), Title: "Synthetic", AuthorID: "alice", CreatedAt: at})
	}
	collabs := []statisticCollaboration{{StatisticRecord: StatisticRecord{ID: "c", Title: "Transferred", At: at}, TodoID: "task", Status: "open", Updates: []Update{{Status: "done", CreatedAt: at}}}}
	r, e := buildStatistics(q, map[string]bool{"reports": true}, TodoBoard{}, reports, nil, collabs, at)
	if e != nil || r.DetailTotal != 65 || len(r.Details) != 50 || !r.HasMore || metricCount(r, "collaborations_open") != 0 || metricCount(r, "collaborations_transferred") != 1 {
		t.Fatal(e, r)
	}
	q.Offset = r.NextOffset
	q.Revision = r.Revision
	r, e = buildStatistics(q, map[string]bool{"reports": true}, TodoBoard{}, reports, nil, collabs, at)
	if e != nil || len(r.Details) != 15 || r.HasMore {
		t.Fatal("page", e, r)
	}
	q.Revision = ""
	r, _ = buildStatistics(q, map[string]bool{"todos": true}, TodoBoard{}, reports, nil, collabs, at)
	raw, _ := json.Marshal(r)
	if metricCount(r, "reports_created") != -1 || len(r.Groups) != 0 || len(r.Details) != 0 {
		t.Fatal("scope leaked", string(raw))
	}
}
func BenchmarkStatisticsLedger(b *testing.B) {
	q, _ := ParseStatisticsQuery(url.Values{"from": {"2026-11-01"}, "to": {"2026-11-08"}, "timezone": {"UTC"}})
	tasks := make([]Todo, 10000)
	at := statTime("2026-11-02T01:00:00Z")
	for i := range tasks {
		tasks[i] = Todo{ID: fmt.Sprint(i), Title: "Synthetic", ProjectID: "one", CreatedAt: at}
	}
	for b.Loop() {
		_, e := buildStatistics(q, map[string]bool{"todos": true}, TodoBoard{Tasks: tasks}, nil, nil, nil, at)
		if e != nil {
			b.Fatal(e)
		}
	}
}

func TestStatisticsRepeatedCollaborationStatusIsNotCompletion(t *testing.T) {
	q := statQuery(t, nil)
	before := q.Start.Add(-time.Hour)
	inside := q.Start.Add(time.Hour)
	c := statisticCollaboration{StatisticRecord: StatisticRecord{ID: "collaboration", At: before}, Status: "done", Updates: []Update{{Status: "done", CreatedAt: before}, {Status: "done", CreatedAt: inside}}}
	r, e := buildStatistics(q, map[string]bool{"reports": true}, TodoBoard{}, nil, nil, []statisticCollaboration{c}, inside)
	if e != nil || metricCount(r, "collaborations_completed") != 0 {
		t.Fatal("repeated done comment counted as a new completion", e)
	}
	c.Updates = append(c.Updates, Update{Status: "in_progress", CreatedAt: inside.Add(time.Hour)}, Update{Status: "done", CreatedAt: inside.Add(2 * time.Hour)})
	r, e = buildStatistics(q, map[string]bool{"reports": true}, TodoBoard{}, nil, nil, []statisticCollaboration{c}, inside)
	if e != nil || metricCount(r, "collaborations_completed") != 1 {
		t.Fatal("actual reopened collaboration completion missing", e)
	}
}

func TestStatisticsSourceOptionsRespectScope(t *testing.T) {
	q := statQuery(t, url.Values{"include_sources": {"true"}, "project": {"one"}, "agent": {"Codex"}})
	reports := []store.Report{
		{ID: "1", ProjectID: "one", Agent: "Codex", Model: "model-a", CreatedAt: q.Start},
		{ID: "2", ProjectID: "one", Agent: "Claude Code", Model: "model-b", CreatedAt: q.Start},
		{ID: "3", ProjectID: "other", Agent: "Outside", Model: "outside", CreatedAt: q.Start},
	}
	caps := map[string]bool{"reports": true}
	result, err := buildStatistics(q, caps, TodoBoard{}, reports, nil, nil, q.Start)
	if err != nil {
		t.Fatal(err)
	}
	if result.Sources == nil || !slices.Equal(result.Sources.Agents, []string{"Claude Code", "Codex"}) ||
		!slices.Equal(result.Sources.Models, []string{"model-a", "model-b"}) || metricCount(result, "reports_created") != 1 {
		t.Fatalf("unexpected options or counts: %+v, %+v", result.Sources, result.Metrics)
	}
	caps["reports"] = false
	result, err = buildStatistics(q, caps, TodoBoard{}, reports, nil, nil, q.Start)
	if err != nil || result.Sources == nil || len(result.Sources.Agents) != 0 || len(result.Sources.Models) != 0 {
		t.Fatalf("unreadable sources appeared: %+v (%v)", result.Sources, err)
	}
}
