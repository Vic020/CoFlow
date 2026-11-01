package workspace

import (
	"coflow/api/internal/store"
	"net/url"
	"testing"
	"time"
)

func calendarQuery(t *testing.T, values string) CalendarQuery {
	t.Helper()
	v, _ := url.ParseQuery(values)
	q, e := ParseCalendarQuery(v)
	if e != nil {
		t.Fatal(e)
	}
	return q
}
func TestCalendarCivilDatesAndDST(t *testing.T) {
	gap := calendarQuery(t, "from=2018-11-04&to=2018-11-05&day=2018-11-04&timezone=America%2FSao_Paulo")
	if gap.Start.Format("2006-01-02") != "2018-11-04" || gap.Start.Hour() != 1 || gap.End.Sub(gap.Start) != 23*time.Hour {
		t.Fatal("midnight gap included previous day", gap.Start, gap.End)
	}
	skipped := calendarQuery(t, "from=2011-12-30&to=2011-12-31&timezone=Pacific%2FApia")
	if !skipped.Start.Equal(skipped.End) {
		t.Fatal("skipped civil day gained reporting instants", skipped)
	}
	precise := &Schedule{Kind: "time-range", StartAt: "2026-10-31T12:00:00.1Z", EndAt: "2026-10-31T12:00:00.2Z", Timezone: "UTC"}
	if precise.Validate(false) != nil || precise.StartAt == precise.EndAt {
		t.Fatal("subsecond range collapsed", precise)
	}
	q := calendarQuery(t, "from=2026-03-08&to=2026-03-09&timezone=America%2FNew_York")
	if q.End.Sub(q.Start) != 23*time.Hour {
		t.Fatal("spring transition must be a 23-hour civil day")
	}
	q = calendarQuery(t, "from=2026-11-01&to=2026-11-02&timezone=America%2FNew_York")
	if q.End.Sub(q.Start) != 25*time.Hour {
		t.Fatal("fall transition must be a 25-hour civil day")
	}
	for _, zone := range []string{"Pacific/Kiritimati", "America/Los_Angeles", "Asia/Shanghai"} {
		q = calendarQuery(t, "from=2026-10-31&to=2026-11-01&timezone="+url.QueryEscape(zone))
		s := &Schedule{Kind: "date-range", StartDate: "2026-10-31", EndDate: "2026-10-31"}
		if s.Validate(false) != nil || !s.Overlaps(q) {
			t.Fatal("floating date moved with zone", zone)
		}
	}
	for _, s := range []*Schedule{{Kind: "date-range", StartDate: "2026-02-30", EndDate: "2026-03-01"}, {Kind: "time-range", StartAt: "2026-10-31T12:00:00Z", EndAt: "2026-10-31T12:00:00Z", Timezone: "UTC"}, {Kind: "time-range", StartAt: "2026-10-31T12:00:00Z", EndAt: "2026-10-31T13:00:00Z", Timezone: "invalid"}} {
		if s.Validate(false) == nil {
			t.Fatal("accepted invalid schedule", s)
		}
	}
	point := &Schedule{Kind: "time-range", StartAt: "2026-10-31T08:00:00+08:00", EndAt: "2026-10-31T08:00:00+08:00", Timezone: "Asia/Shanghai"}
	if point.Validate(true) != nil || point.StartAt != "2026-10-31T00:00:00Z" {
		t.Fatal("point normalization", point)
	}
	q = calendarQuery(t, "from=2026-10-31&to=2026-11-01")
	if !point.Overlaps(q) {
		t.Fatal("point at start must be visible")
	}
	interval := &Schedule{Kind: "time-range", StartAt: "2026-10-30T23:00:00Z", EndAt: "2026-10-31T00:00:00Z", Timezone: "UTC"}
	if interval.Overlaps(q) {
		t.Fatal("exclusive interval end leaked into next day")
	}
}
func TestReportCalendarCountsPaginationAndChanges(t *testing.T) {
	q := calendarQuery(t, "from=2026-10-30&to=2026-11-02&timezone=Asia%2FShanghai&limit=1&day=2026-10-31&domain=engineering")
	at, _ := time.Parse(time.RFC3339, "2026-10-30T17:00:00Z")
	rows := []store.Report{{ID: "a", Title: "A", Domains: []string{"engineering", "design"}, CreatedAt: at, UpdatedAt: at}, {ID: "b", Title: "B", Domain: "engineering", CreatedAt: at, UpdatedAt: at}, {ID: "outside", CreatedAt: at.Add(-48 * time.Hour)}}
	first, e := ReportCalendar(rows, q)
	if e != nil {
		t.Fatal(e)
	}
	if first.Total != 2 || first.Days["2026-10-31"] != 2 || len(first.Items) != 1 || first.NextCursor == "" {
		t.Fatal(first)
	}
	q.Cursor = first.NextCursor
	q.Revision = first.Revision
	second, e := ReportCalendar(rows, q)
	if e != nil || len(second.Items) != 1 || second.Items[0].ID == first.Items[0].ID {
		t.Fatal(second, e)
	}
	rows[0].UpdatedAt = at.Add(time.Minute)
	if _, e = ReportCalendar(rows, q); e == nil {
		t.Fatal("stale revision accepted")
	}
	q.Revision = ""
	if _, e = ReportCalendar(rows, q); e == nil {
		t.Fatal("cursor without revision accepted")
	}
}
