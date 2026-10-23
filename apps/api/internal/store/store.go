package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

var ErrNotFound = errors.New("record not found")
var ErrForbidden = errors.New("not the author")

type Link struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}
type Comment struct {
	ID        string    `json:"id"`
	ReportID  string    `json:"report_id"`
	AuthorID  string    `json:"author_id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}
type Report struct {
	ID                   string          `json:"id"`
	TeamID               string          `json:"team_id"`
	AuthorID             string          `json:"author_id"`
	SourceID             string          `json:"source_id"`
	Title                string          `json:"title"`
	Body                 string          `json:"body"`
	ProjectID            string          `json:"project_id"`
	Domain               string          `json:"domain"`
	Domains              []string        `json:"domains"`
	ProjectName          string          `json:"project_name,omitempty"`
	ClassificationInput  json.RawMessage `json:"classification_input,omitempty"`
	ClassificationLocked bool            `json:"classification_locked"`
	Agent                string          `json:"agent"`
	Model                string          `json:"model"`
	Status               string          `json:"status"`
	Links                []Link          `json:"links"`
	Mentions             []string        `json:"mentions"`
	CreatedAt            time.Time       `json:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
	Comments             []Comment       `json:"comments"`
}
type Member struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	Color string `json:"color"`
}
type Project struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Domains []string `json:"domains"`
	Status  string   `json:"status"`
}

var Members = []Member{{"chen", "陈一", "研发", "mint"}, {"lin", "林悦", "运营", "rose"}, {"zhou", "周可", "视频制作", "blue"}, {"xu", "许然", "产品", "lime"}, {"wang", "王霖", "设计", "violet"}}
var Projects = []Project{{"website", "官网改版", []string{"产品", "研发", "设计"}, "进行中"}, {"launch", "新品发布", []string{"运营", "视频制作", "内容"}, "进行中"}, {"brand", "品牌内容建设", []string{"内容", "运营"}, "规划中"}}
var Domains = []string{"产品", "研发", "设计", "运营", "内容", "视频制作"}

func ID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

type Repository interface {
	List(context.Context, string) ([]Report, error)
	Save(context.Context, Report) (Report, error)
	Get(context.Context, string, string) (Report, error)
	Comment(context.Context, string, Comment) (Comment, error)
}
type Memory struct {
	mu      sync.Mutex
	reports []Report
	path    string
}

func NewMemory(path string) (*Memory, error) {
	m := &Memory{path: path, reports: []Report{}}
	if path != "" {
		b, err := os.ReadFile(path)
		if err == nil {
			if err = json.Unmarshal(b, &m.reports); err != nil {
				return nil, err
			}
			return m, nil
		}
		if !os.IsNotExist(err) {
			return nil, err
		}
	}
	m.reports = Seed(time.Now())
	return m, nil
}
func (m *Memory) persist() error {
	if m.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(m.reports, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err = os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}
func clone(r Report) Report {
	b, _ := json.Marshal(r)
	var out Report
	_ = json.Unmarshal(b, &out)
	return out
}
func (m *Memory) List(_ context.Context, team string) ([]Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Report{}
	for _, r := range m.reports {
		if r.TeamID == team {
			out = append(out, clone(r))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
func (m *Memory) Get(_ context.Context, team, id string) (Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.reports {
		if r.ID == id && r.TeamID == team {
			return clone(r), nil
		}
	}
	return Report{}, ErrNotFound
}
func (m *Memory) Save(_ context.Context, r Report) (Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := append([]Report(nil), m.reports...)
	for i, v := range m.reports {
		if v.TeamID == r.TeamID && v.AuthorID == r.AuthorID && v.SourceID == r.SourceID {
			r.ID = v.ID
			r.CreatedAt = v.CreatedAt
			r.Comments = v.Comments
			m.reports[i] = r
			if err := m.persist(); err != nil {
				m.reports = old
				return Report{}, err
			}
			return clone(r), nil
		}
	}
	r.Comments = []Comment{}
	m.reports = append(m.reports, r)
	if err := m.persist(); err != nil {
		m.reports = old
		return Report{}, err
	}
	return clone(r), nil
}
func (m *Memory) Comment(_ context.Context, team string, c Comment) (Comment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, r := range m.reports {
		if r.ID == c.ReportID && r.TeamID == team {
			m.reports[i].Comments = append(append([]Comment{}, r.Comments...), c)
			m.reports[i].UpdatedAt = c.CreatedAt
			if err := m.persist(); err != nil {
				m.reports[i] = r
				return Comment{}, err
			}
			return c, nil
		}
	}
	return Comment{}, ErrNotFound
}
func Seed(now time.Time) []Report {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	n := now.In(loc)
	base := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, loc)
	rows := []Report{
		{ID: "demo-mobile", AuthorID: "chen", Title: "完成首页移动端适配", Body: "导航与内容布局已适配移动端，预览已更新。等待设计确认后合并。\n\n- 完成导航折叠与筛选面板\n- 调整手机端简报与评论布局\n- 请 @王霖 确认视觉效果", ProjectID: "website", Domain: "研发", Agent: "Codex", Model: "演示来源", Status: "review", Links: []Link{{"Next.js 文档", "https://nextjs.org/docs"}, {"交付示例", "https://github.com/vercel/next.js"}}, Mentions: []string{"wang"}, CreatedAt: base.Add(14*time.Hour + 30*time.Minute)},
		{ID: "demo-growth", AuthorID: "lin", Title: "首轮渠道推广已上线", Body: "完成 3 个渠道的发布，整理了首日数据与下一轮投放建议。", ProjectID: "launch", Domain: "运营", Agent: "Claude Code", Status: "delivered", Links: []Link{{"运营文档示例", "https://www.notion.com"}}, CreatedAt: base.Add(13*time.Hour + 45*time.Minute)},
		{ID: "demo-video", AuthorID: "zhou", Title: "宣传片初剪完成，等待产品镜头", Body: "已完成 60 秒版本初剪，还缺新版产品界面录屏，需要 @陈一 协助提供。\n\n需要录制：注册 → 创建项目 → 上报进展的完整流程。", ProjectID: "launch", Domain: "视频制作", Agent: "Claude Code", Status: "blocked", Links: []Link{{"视频工具示例", "https://www.blackmagicdesign.com/products/davinciresolve"}}, Mentions: []string{"chen"}, CreatedAt: base.Add(11*time.Hour + 20*time.Minute)},
		{ID: "demo-product", AuthorID: "xu", Title: "确认注册流程与首版功能范围", Body: "评审结论与交付标准已整理，研发可按最新文档推进。", ProjectID: "website", Domain: "产品", Agent: "Codex", Status: "progress", Links: []Link{{"设计工具示例", "https://www.figma.com"}}, CreatedAt: base.Add(10*time.Hour + 5*time.Minute)},
		{ID: "demo-design", AuthorID: "wang", Title: "完成官网首页视觉稿 v2", Body: "根据评审意见更新视觉稿，优化了导航层级与首屏信息结构。", ProjectID: "website", Domain: "设计", Agent: "Claude Code", Status: "delivered", Links: []Link{{"视觉稿工具示例", "https://www.figma.com"}}, CreatedAt: base.Add(-6 * time.Hour)},
	}
	for i := range rows {
		r := &rows[i]
		if i < 4 {
			// Keep sample reports earlier than the first real report, even before dawn.
			r.CreatedAt = base.Add(time.Duration(float64(now.Sub(base)) * []float64{0.85, 0.65, 0.45, 0.25}[i]))
		}
		r.TeamID = "demo"
		r.SourceID = r.ID
		r.UpdatedAt = r.CreatedAt
		r.Comments = []Comment{}
		if r.Mentions == nil {
			r.Mentions = []string{}
		}
	}
	rows[2].Comments = []Comment{{ID: "demo-comment", ReportID: "demo-video", AuthorID: "chen", Body: "收到，移动端确认后补录产品演示。", CreatedAt: rows[2].CreatedAt.Add(30 * time.Minute)}}
	return rows
}
