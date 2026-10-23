package store

import (
	"coflow/api/internal/db"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewPostgres(ctx context.Context, url string) (*Postgres, error) {
	p, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err = p.Ping(ctx); err != nil {
		p.Close()
		return nil, err
	}
	return &Postgres{p, db.New(p)}, nil
}
func (p *Postgres) Pool() *pgxpool.Pool { return p.pool }
func (p *Postgres) Close()              { p.pool.Close() }
func FromDB(v db.Report) Report {
	r := Report{ID: v.ID, TeamID: v.TeamID, AuthorID: v.AuthorID, SourceID: v.SourceID, Title: v.Title, Body: v.Body, ProjectID: v.ProjectID, Domain: v.Domain, Agent: v.Agent, Model: v.Model, Status: v.Status, CreatedAt: v.CreatedAt.Time, UpdatedAt: v.UpdatedAt.Time, Links: []Link{}, Mentions: []string{}, Comments: []Comment{}, Domains: v.Domains, ClassificationInput: v.ClassificationInput, ClassificationLocked: v.ClassificationLocked}
	_ = json.Unmarshal(v.Links, &r.Links)
	_ = json.Unmarshal(v.Mentions, &r.Mentions)
	return r
}
func (p *Postgres) List(ctx context.Context, team string) ([]Report, error) {
	rows, err := p.q.ListReports(ctx, team)
	if err != nil {
		return nil, err
	}
	cs, err := p.q.ListComments(ctx, team)
	if err != nil {
		return nil, err
	}
	out := []Report{}
	for _, r := range rows {
		v := FromDB(r)
		for _, c := range cs {
			if c.ReportID == v.ID {
				v.Comments = append(v.Comments, Comment{c.ID, c.ReportID, c.AuthorID, c.Body, c.CreatedAt.Time})
			}
		}
		out = append(out, v)
	}
	return out, nil
}
func (p *Postgres) Get(ctx context.Context, team, id string) (Report, error) {
	r, err := p.q.GetReport(ctx, db.GetReportParams{ID: id, TeamID: team})
	if errors.Is(err, pgx.ErrNoRows) {
		return Report{}, ErrNotFound
	}
	if err != nil {
		return Report{}, err
	}
	return FromDB(r), nil
}
func (p *Postgres) Save(ctx context.Context, r Report) (Report, error) { return SaveWith(ctx, p.q, r) }
func SaveWith(ctx context.Context, q *db.Queries, r Report) (Report, error) {
	links, _ := json.Marshal(r.Links)
	mentions, _ := json.Marshal(r.Mentions)
	if r.Domains == nil {
		r.Domains = []string{}
		if r.Domain != "" {
			r.Domains = []string{r.Domain}
		}
	}
	if len(r.ClassificationInput) == 0 {
		r.ClassificationInput = []byte(`{}`)
	}
	v, err := q.UpsertReport(ctx, db.UpsertReportParams{ID: r.ID, TeamID: r.TeamID, AuthorID: r.AuthorID, SourceID: r.SourceID, Title: r.Title, Body: r.Body, Domains: r.Domains, ClassificationInput: r.ClassificationInput, ClassificationLocked: r.ClassificationLocked, ProjectID: r.ProjectID, Domain: r.Domain, Agent: r.Agent, Model: r.Model, Status: r.Status, Links: links, Mentions: mentions, CreatedAt: pgtype.Timestamptz{Time: r.CreatedAt, Valid: true}, UpdatedAt: pgtype.Timestamptz{Time: r.UpdatedAt, Valid: true}})
	if err != nil {
		return Report{}, err
	}
	return FromDB(v), nil
}
func (p *Postgres) Comment(ctx context.Context, team string, c Comment) (Comment, error) {
	if _, err := p.Get(ctx, team, c.ReportID); err != nil {
		return Comment{}, err
	}
	err := p.q.CreateComment(ctx, db.CreateCommentParams{ID: c.ID, ReportID: c.ReportID, AuthorID: c.AuthorID, Body: c.Body, CreatedAt: pgtype.Timestamptz{Time: c.CreatedAt, Valid: true}})
	return c, err
}
