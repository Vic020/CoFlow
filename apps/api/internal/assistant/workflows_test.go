package assistant

import (
	"testing"
	"time"
)

func TestNextRunDSTAndWeekdays(t *testing.T) {
	cases := []struct {
		after, zone, clock, want string
		days                     []int
	}{
		{"2026-11-06T08:59:00Z", "UTC", "09:00", "2026-11-06T09:00:00Z", []int{1, 2, 3, 4, 5}},
		{"2026-11-06T09:00:00Z", "UTC", "09:00", "2026-11-09T09:00:00Z", []int{1, 2, 3, 4, 5}},
		{"2026-03-08T06:00:00Z", "America/New_York", "02:30", "2026-03-09T06:30:00Z", []int{0, 1, 2, 3, 4, 5, 6}},
		{"2026-11-01T04:00:00Z", "America/New_York", "01:30", "2026-11-01T05:30:00Z", []int{0, 1, 2, 3, 4, 5, 6}},
		{"2026-11-01T05:31:00Z", "America/New_York", "01:30", "2026-11-02T06:30:00Z", []int{0, 1, 2, 3, 4, 5, 6}},
	}
	for _, c := range cases {
		after, _ := time.Parse(time.RFC3339, c.after)
		got, e := NextRun(after, c.zone, c.clock, c.days)
		if e != nil || got.Format(time.RFC3339) != c.want {
			t.Errorf("%+v got %v %v", c, got, e)
		}
	}
	for _, clock := range []string{"25:00", "09:60", "9:00", "aa:00"} {
		if _, e := NextRun(time.Now(), "UTC", clock, []int{1}); e == nil {
			t.Errorf("accepted %s", clock)
		}
	}
}
func TestTemplateParametersAndMCPValidation(t *testing.T) {
	tmpl := Template{Instructions: "Read {{project}}", Parameters: []Parameter{{"project", "Project", true}}}
	if _, e := renderTemplate(tmpl, nil); e == nil {
		t.Fatal("missing required parameter")
	}
	if _, e := renderTemplate(tmpl, map[string]string{"unknown": "x"}); e == nil {
		t.Fatal("unknown parameter")
	}
	if got, e := renderTemplate(tmpl, map[string]string{"project": "Synthetic"}); e != nil || got != "Read Synthetic" {
		t.Fatal(got, e)
	}
	schema := map[string]any{"type": "object", "properties": map[string]any{"q": map[string]any{"type": "string"}}, "required": []any{"q"}, "additionalProperties": false}
	if e := validateMCPValue(map[string]any{"q": "issue"}, schema, 0); e != nil {
		t.Fatal(e)
	}
	for _, v := range []any{map[string]any{}, map[string]any{"q": false}, map[string]any{"q": "x", "token": "y"}} {
		if e := validateMCPValue(v, schema, 0); e == nil {
			t.Fatalf("accepted %#v", v)
		}
	}
}
