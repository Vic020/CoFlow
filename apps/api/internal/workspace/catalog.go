package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"coflow/api/internal/db"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ Pool *pgxpool.Pool }
type Category struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Name       string   `json:"name"`
	Aliases    []string `json:"aliases"`
	State      string   `json:"state"`
	MergedInto string   `json:"merged_into"`
}

func key(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, strings.TrimSpace(s))
}
func validName(s string) bool { return key(s) != "" && len(s) <= 160 }
func (s *Service) transaction(ctx context.Context, p identity.Principal, fn func(pgx.Tx) error) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Serialize catalog changes and report writes per team, including first-use seeding.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,37))`, p.TeamID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO classifications(team_id,kind,id,name,normalized,state)
 SELECT team_id,'project',id,name,lower(regexp_replace(name,'\s','','g')),'active' FROM projects WHERE team_id=$1
 ON CONFLICT DO NOTHING`, p.TeamID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO classifications(team_id,kind,id,name,normalized,state)
 SELECT team_id,'domain',md5(team_id||':'||name),name,lower(regexp_replace(name,'\s','','g')),'active' FROM domains WHERE team_id=$1
 ON CONFLICT DO NOTHING`, p.TeamID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `WITH appended AS (
 SELECT team_id,kind,id,COALESCE((SELECT max(c2.sort_order) FROM classifications c2 WHERE c2.team_id=c.team_id AND c2.kind=c.kind),0)+row_number() OVER(PARTITION BY kind ORDER BY state,name,id)::integer AS position
 FROM classifications c WHERE team_id=$1 AND sort_order=0
) UPDATE classifications c SET sort_order=a.position FROM appended a WHERE c.team_id=a.team_id AND c.kind=a.kind AND c.id=a.id`, p.TeamID); err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func categories(ctx context.Context, tx pgx.Tx, team string) ([]Category, error) {
	rows, err := tx.Query(ctx, `SELECT id,kind,name,aliases,state,merged_into FROM classifications WHERE team_id=$1 ORDER BY kind,sort_order,state,name,id`, team)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Category{}
	for rows.Next() {
		var v Category
		if err = rows.Scan(&v.ID, &v.Kind, &v.Name, &v.Aliases, &v.State, &v.MergedInto); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Service) Catalog(ctx context.Context, p identity.Principal) ([]Category, error) {
	var out []Category
	err := s.transaction(ctx, p, func(tx pgx.Tx) error { var err error; out, err = categories(ctx, tx, p.TeamID); return err })
	return out, err
}
func find(list []Category, kind, id, name string) (Category, bool) {
	for _, v := range list {
		if v.Kind != kind {
			continue
		}
		if id != "" {
			if v.ID == id {
				return v, true
			}
			continue
		}
		if key(v.Name) == key(name) {
			return v, true
		}
		for _, a := range v.Aliases {
			if key(a) == key(name) {
				return v, true
			}
		}
	}
	return Category{}, false
}
func canonical(list []Category, v Category) (Category, error) {
	for n := 0; n <= len(list); n++ {
		if v.State != "merged" {
			return v, nil
		}
		next, ok := find(list, v.Kind, v.MergedInto, "")
		if !ok {
			return v, identity.Invalid("合并分类不存在")
		}
		v = next
	}
	return v, identity.Invalid("分类合并循环")
}
func resolve(ctx context.Context, tx pgx.Tx, p identity.Principal, list *[]Category, kind, id, name string) (Category, error) {
	if id == "" && strings.TrimSpace(name) == "" {
		return Category{}, nil
	}
	if id != "" && len(id) > 160 {
		return Category{}, identity.Invalid("分类 ID 过长")
	}
	v, ok := find(*list, kind, id, name)
	if !ok {
		if id != "" {
			return v, identity.Invalid("分类 ID 不存在，请先读取 /meta")
		}
		if !validName(name) {
			return v, identity.Invalid("分类名称需为 1–160 字节")
		}
		v = Category{ID: store.ID(), Kind: kind, Name: strings.TrimSpace(name), Aliases: []string{}, State: "pending"}
		_, err := tx.Exec(ctx, `INSERT INTO classifications(team_id,kind,id,name,normalized,aliases,state,created_by) VALUES($1,$2,$3,$4,$5,'{}','pending',$6)`, p.TeamID, kind, v.ID, v.Name, key(v.Name), p.UserID)
		if err != nil {
			return v, err
		}
		*list = append(*list, v)
	}
	v, err := canonical(*list, v)
	if err != nil {
		return v, err
	}
	if v.State == "archived" {
		return v, identity.Invalid("分类已归档，请选择其他分类或留空")
	}
	return v, nil
}
func resolveReport(ctx context.Context, tx pgx.Tx, p identity.Principal, r *store.Report) error {
	list, err := categories(ctx, tx, p.TeamID)
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(map[string]any{"project_id": r.ProjectID, "project_name": r.ProjectName, "domain": r.Domain, "domains": r.Domains})
	v, err := resolve(ctx, tx, p, &list, "project", r.ProjectID, r.ProjectName)
	if err != nil {
		return err
	}
	r.ProjectID = v.ID
	r.ProjectName = ""
	names := r.Domains
	if r.Domain != "" {
		names = append([]string{r.Domain}, names...)
	}
	if len(names) > 12 {
		return identity.Invalid("一条简报最多 12 个领域")
	}
	r.Domains = []string{}
	seen := map[string]bool{}
	for _, name := range names {
		v, err = resolve(ctx, tx, p, &list, "domain", "", name)
		if err != nil {
			return err
		}
		if v.ID != "" && !seen[v.ID] {
			r.Domains = append(r.Domains, v.Name)
			seen[v.ID] = true
		}
	}
	r.Domain = ""
	if len(r.Domains) > 0 {
		r.Domain = r.Domains[0]
	}
	r.ClassificationInput = raw
	return nil
}
func audit(ctx context.Context, tx pgx.Tx, p identity.Principal, before, after store.Report, action string) error {
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	_, err := tx.Exec(ctx, `INSERT INTO report_history(id,team_id,report_id,actor_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`, store.ID(), p.TeamID, after.ID, p.UserID, action, a, b)
	return err
}
func (s *Service) SaveReport(ctx context.Context, p identity.Principal, r store.Report) (store.Report, error) {
	var out store.Report
	r.ClassificationLocked = false // Only the browser correction endpoint may set this flag.
	err := s.transaction(ctx, p, func(tx pgx.Tx) error {
		var old store.Report
		var deleted bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND author_id=$2 AND source_id=$3 AND deleted_at IS NOT NULL)`, p.TeamID, p.UserID, r.SourceID).Scan(&deleted); err != nil {
			return err
		}
		if deleted {
			return &identity.Error{Status: 409, Message: "简报已删除，请先在网页回收站恢复"}
		}
		q := db.New(tx)
		rows, err := q.ListReports(ctx, p.TeamID)
		if err != nil {
			return err
		}
		for _, v := range rows {
			if v.AuthorID == p.UserID && v.SourceID == r.SourceID {
				old = store.FromDB(v)
				break
			}
		}
		if old.ClassificationLocked {
			r.ProjectID = ""
			r.ProjectName = ""
			r.Domain = ""
			r.Domains = nil
		}
		if err = resolveReport(ctx, tx, p, &r); err != nil {
			return err
		}
		if old.ClassificationLocked {
			r.ProjectID = old.ProjectID
			r.Domain = old.Domain
			r.Domains = old.Domains
			r.ClassificationInput = old.ClassificationInput
			r.ClassificationLocked = true
		}
		out, err = store.SaveWith(ctx, q, r)
		if err != nil {
			return err
		}
		if old.ID != "" {
			a := old
			a.UpdatedAt = out.UpdatedAt
			a.Comments = nil
			b := out
			b.Comments = nil
			if equalJSON(a, b) {
				return nil
			}
		}
		action := "上报进展"
		if old.ID != "" {
			action = "更新进展"
		}
		if err = audit(ctx, tx, p, old, out, action); err != nil {
			return err
		}
		recipients := append([]string{}, out.Mentions...)
		// Follow-up changes notify previous commenters and collaborators as well.
		if old.ID != "" {
			rs, e := tx.Query(ctx, `SELECT author_id FROM comments WHERE report_id=$1 AND deleted_at IS NULL UNION SELECT assignee_id FROM collaboration_requests WHERE report_id=$1 UNION SELECT author_id FROM collaboration_requests WHERE report_id=$1`, out.ID)
			if e != nil {
				return e
			}
			for rs.Next() {
				var id string
				if e = rs.Scan(&id); e != nil {
					rs.Close()
					return e
				}
				recipients = append(recipients, id)
			}
			e = rs.Err()
			rs.Close()
			if e != nil {
				return e
			}
		}
		return notify(ctx, tx, p, recipients, out.ID, "", "report", action+"："+out.Title)
	})
	return out, err
}
func equalJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func (s *Service) Status(ctx context.Context, p identity.Principal, id, status string) (store.Report, error) {
	var out store.Report
	err := s.transaction(ctx, p, func(tx pgx.Tx) error {
		v, err := db.New(tx).GetReport(ctx, db.GetReportParams{ID: id, TeamID: p.TeamID})
		if errors.Is(err, pgx.ErrNoRows) {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		before := store.FromDB(v)
		if before.AuthorID != p.UserID && !(p.Kind == "session" && p.Role == "admin") {
			return store.ErrForbidden
		}
		out = before
		out.Status = status
		out.UpdatedAt = time.Now().UTC()
		out, err = store.SaveWith(ctx, db.New(tx), out)
		if err != nil {
			return err
		}
		if err = audit(ctx, tx, p, before, out, "更新状态"); err != nil {
			return err
		}
		return notify(ctx, tx, p, append(out.Mentions, out.AuthorID), out.ID, "", "report", "状态已更新："+out.Title)
	})
	return out, err
}

func (s *Service) ChangeCategory(ctx context.Context, p identity.Principal, kind, id string, input Category, target string) (Category, error) {
	if kind != "project" && kind != "domain" {
		return Category{}, identity.Invalid("分类类型无效")
	}
	if p.Kind != "session" {
		return Category{}, identity.Denied("分类整理需要网页登录")
	}
	var out Category
	err := s.transaction(ctx, p, func(tx pgx.Tx) error {
		list, err := categories(ctx, tx, p.TeamID)
		if err != nil {
			return err
		}
		var old Category
		if id != "" {
			var ok bool
			old, ok = find(list, kind, id, "")
			if !ok {
				return store.ErrNotFound
			}
			if old.State == "merged" {
				return identity.Invalid("已合并分类不能再修改")
			}
		}
		if target != "" {
			dest, ok := find(list, kind, target, "")
			if !ok || dest.State != "active" || dest.ID == id {
				return identity.Invalid("请选择另一个正式分类作为合并目标")
			}
			aliases := append(append([]string{}, dest.Aliases...), old.Aliases...)
			aliases = append(aliases, old.Name)
			if len(aliases) > 100 {
				return identity.Invalid("别名数量过多，请分批整理")
			}
			if _, err = tx.Exec(ctx, `UPDATE classifications SET aliases=$4 WHERE team_id=$1 AND kind=$2 AND id=$3`, p.TeamID, kind, target, aliases); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `UPDATE classifications SET state='merged',merged_into=$4,aliases='{}' WHERE team_id=$1 AND kind=$2 AND id=$3`, p.TeamID, kind, id, target); err != nil {
				return err
			}
			out = dest
			out.Aliases = aliases
		} else {
			input.Name = strings.TrimSpace(input.Name)
			if !validName(input.Name) {
				return identity.Invalid("分类名称需为 1–160 字节")
			}
			if input.State == "" {
				input.State = "active"
			}
			if input.State != "active" && input.State != "pending" && input.State != "archived" {
				return identity.Invalid("分类状态无效")
			}
			if len(input.Aliases) > 50 {
				return identity.Invalid("最多 50 个别名")
			}
			aliases := []string{}
			used := map[string]bool{key(input.Name): true}
			for _, name := range append(input.Aliases, old.Name) {
				name = strings.TrimSpace(name)
				if name == "" || used[key(name)] {
					continue
				}
				if !validName(name) {
					return identity.Invalid("别名过长")
				}
				used[key(name)] = true
				aliases = append(aliases, name)
			}
			for _, v := range list {
				if v.ID == id || v.Kind != kind {
					continue
				}
				if used[key(v.Name)] {
					return identity.Invalid("名称或别名已存在，请使用合并功能")
				}
				for _, a := range v.Aliases {
					if used[key(a)] {
						return identity.Invalid("名称或别名已存在，请使用合并功能")
					}
				}
			}
			if id == "" {
				id = store.ID()
			}
			out = Category{ID: id, Kind: kind, Name: input.Name, Aliases: aliases, State: input.State}
			_, err = tx.Exec(ctx, `INSERT INTO classifications(team_id,kind,id,name,normalized,aliases,state,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(team_id,kind,id) DO UPDATE SET name=EXCLUDED.name,normalized=EXCLUDED.normalized,aliases=EXCLUDED.aliases,state=EXCLUDED.state`, p.TeamID, kind, id, out.Name, key(out.Name), aliases, out.State, p.UserID)
			if err != nil {
				return err
			}
		}
		// Reclassify historical rows in the same transaction, preserving original body and raw input.
		if old.ID != "" && (target != "" || old.Name != out.Name) {
			rows, err := db.New(tx).ListReports(ctx, p.TeamID)
			if err != nil {
				return err
			}
			for _, row := range rows {
				before := store.FromDB(row)
				after := before
				changed := false
				if kind == "project" && before.ProjectID == old.ID {
					after.ProjectID = out.ID
					changed = true
				}
				if kind == "domain" {
					after.Domains = []string{}
					seen := map[string]bool{}
					names := before.Domains
					if len(names) == 0 && before.Domain != "" {
						names = []string{before.Domain}
					}
					for _, name := range names {
						if name == old.Name {
							name = out.Name
							changed = true
						}
						if !seen[name] {
							after.Domains = append(after.Domains, name)
							seen[name] = true
						}
					}
					if len(after.Domains) > 0 {
						after.Domain = after.Domains[0]
					}
				}
				if changed {
					after.UpdatedAt = time.Now().UTC()
					after, err = store.SaveWith(ctx, db.New(tx), after)
					if err != nil {
						return err
					}
					if err = audit(ctx, tx, p, before, after, fmt.Sprintf("整理分类：%s → %s", old.Name, out.Name)); err != nil {
						return err
					}
				}
			}
		}
		return nil
	})
	return out, err
}

func (s *Service) Classify(ctx context.Context, p identity.Principal, id, project string, domains []string) (store.Report, error) {
	var out store.Report
	err := s.transaction(ctx, p, func(tx pgx.Tx) error {
		v, err := db.New(tx).GetReport(ctx, db.GetReportParams{ID: id, TeamID: p.TeamID})
		if errors.Is(err, pgx.ErrNoRows) {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		before := store.FromDB(v)
		out = before
		out.ProjectID = project
		out.ProjectName = ""
		out.Domain = ""
		out.Domains = domains
		if err = resolveReport(ctx, tx, p, &out); err != nil {
			return err
		}
		out.ClassificationInput = before.ClassificationInput
		out.ClassificationLocked = true
		out.UpdatedAt = time.Now().UTC()
		out, err = store.SaveWith(ctx, db.New(tx), out)
		if err != nil {
			return err
		}
		return audit(ctx, tx, p, before, out, "人工纠正分类")
	})
	return out, err
}

// ReorderCatalog validates a complete visible list inside the team transaction.
// A concurrent create/merge requires a refresh rather than dropping unknown rows.
func (s *Service) ReorderCatalog(ctx context.Context, p identity.Principal, kind string, ids []string) error {
	if p.Kind != "session" {
		return identity.Denied("排序需要网页登录")
	}
	if kind != "project" && kind != "domain" {
		return identity.Invalid("分类类型无效")
	}
	return s.transaction(ctx, p, func(tx pgx.Tx) error {
		list, err := categories(ctx, tx, p.TeamID)
		if err != nil {
			return err
		}
		expected := map[string]bool{}
		for _, v := range list {
			if v.Kind == kind && v.State != "merged" {
				expected[v.ID] = true
			}
		}
		if len(ids) != len(expected) {
			return identity.Invalid("分类列表已变化，请刷新后重试")
		}
		for _, id := range ids {
			if !expected[id] {
				return identity.Invalid("排序包含重复或无效分类")
			}
			delete(expected, id)
		}
		for i, id := range ids {
			if _, err = tx.Exec(ctx, `UPDATE classifications SET sort_order=$4 WHERE team_id=$1 AND kind=$2 AND id=$3`, p.TeamID, kind, id, i+1); err != nil {
				return err
			}
		}
		return nil
	})
}
