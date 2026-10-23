package httpapi

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"coflow/api/internal/version"
	"coflow/api/internal/workspace"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func New(repo store.Repository) *gin.Engine { return NewWithConfig(repo, Config{Demo: true}) }

func NewWithConfig(repo store.Repository, cfg Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	_ = r.SetTrustedProxies(nil)
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		if c.Request.Method != "GET" && c.Request.Method != "HEAD" {
			if !strings.HasPrefix(c.GetHeader("Content-Type"), "application/json") {
				c.AbortWithStatusJSON(415, gin.H{"error": "写入请求需使用 application/json"})
				return
			}
			origin := c.GetHeader("Origin")
			if origin != "" {
				u, err := url.Parse(origin)
				if err != nil || u.Host != c.Request.Host && origin != frontendOrigin() {
					c.AbortWithStatusJSON(403, gin.H{"error": "不允许跨站写入"})
					return
				}
			}
		}
		c.Next()
	})
	r.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "mode": map[bool]string{true: "local-demo", false: "team"}[cfg.Demo], "version": version.Current})
	})
	registerIdentity(r, cfg)
	protected := r.Group("")
	protected.Use(requirePrincipal(cfg))
	var ws *workspace.Service
	if !cfg.Demo {
		ws = &workspace.Service{Pool: cfg.Identity.Pool}
		registerWorkspace(protected, ws)
	}
	protected.GET("/api/v1/meta", requireScope("reports:read"), func(c *gin.Context) {
		if cfg.Demo {
			c.JSON(200, gin.H{"members": store.Members, "projects": store.Projects, "domains": store.Domains, "current_user": "chen", "role": "admin", "mode": "local-demo", "timezone": "Asia/Shanghai", "team": gin.H{"id": "demo", "name": "共创团队"}})
			return
		}
		v, err := cfg.Identity.Metadata(c.Request.Context(), principal(c))
		if err != nil {
			fail(c, err)
			return
		}
		catalog, err := ws.Catalog(c.Request.Context(), principal(c))
		if err != nil {
			fail(c, err)
			return
		}
		projects := []store.Project{}
		domains := []string{}
		for _, item := range catalog {
			if item.State == "merged" {
				continue
			}
			if item.Kind == "project" {
				projects = append(projects, store.Project{ID: item.ID, Name: item.Name, Domains: []string{}, Status: item.State})
			} else {
				domains = append(domains, item.Name)
			}
		}
		v["projects"] = projects
		v["domains"] = domains
		v["catalog"] = catalog
		c.JSON(200, v)
	})
	protected.GET("/api/v1/reports", requireScope("reports:read"), func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context(), principal(c).TeamID)
		if err != nil {
			fail(c, err)
			return
		}
		out := []store.Report{}
		for _, v := range rows {
			if p := c.Query("project"); p != "" && v.ProjectID != p {
				continue
			}
			if p := c.Query("domain"); p != "" && v.Domain != p && !contains(v.Domains, p) {
				continue
			}
			if p := c.Query("member"); p != "" && v.AuthorID != p {
				continue
			}
			if p := c.Query("agent"); p != "" && v.Agent != p {
				continue
			}
			out = append(out, v)
		}
		c.JSON(200, gin.H{"items": out})
	})
	protected.POST("/api/v1/reports", requireScope("reports:write"), func(c *gin.Context) {
		var v store.Report
		if !decode(c, &v) {
			return
		}
		normalize(&v)
		if err := validateFor(c, cfg, v); err != "" {
			c.JSON(400, gin.H{"error": err})
			return
		}
		now := time.Now().UTC()
		v.ID = store.ID()
		v.TeamID = principal(c).TeamID
		v.AuthorID = principal(c).UserID
		v.CreatedAt = now
		v.UpdatedAt = now
		var row store.Report
		var err error
		if cfg.Demo {
			row, err = repo.Save(c.Request.Context(), v)
		} else {
			row, err = ws.SaveReport(c.Request.Context(), principal(c), v)
		}
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, row)
	})
	protected.PUT("/api/v1/reports/:id", requireScope("reports:write"), func(c *gin.Context) {
		if !cfg.Demo && principal(c).Kind != "session" {
			fail(c, identity.Denied("编辑简报需要网页登录"))
			return
		}
		var input struct {
			store.Report
			ExpectedUpdatedAt time.Time `json:"expected_updated_at"`
		}
		if !decode(c, &input) {
			return
		}
		normalize(&input.Report)
		if msg := validateFor(c, cfg, input.Report); msg != "" {
			c.JSON(400, gin.H{"error": msg})
			return
		}
		var row store.Report
		var err error
		if cfg.Demo {
			row, err = repo.Get(c.Request.Context(), principal(c).TeamID, c.Param("id"))
			if err == nil && row.AuthorID != principal(c).UserID {
				err = store.ErrForbidden
			}
			if err == nil && (input.ExpectedUpdatedAt.IsZero() || !row.UpdatedAt.Equal(input.ExpectedUpdatedAt)) {
				err = &identity.Error{Status: 409, Message: "简报已有新进展，请重新打开后编辑"}
			}
			if err == nil {
				row.Title = input.Title
				row.Body = input.Body
				row.Status = input.Status
				row.Links = input.Links
				row.Mentions = input.Mentions
				row.ProjectID = input.ProjectID
				row.Domain = input.Domain
				row.Domains = input.Domains
				row.UpdatedAt = time.Now().UTC()
				row, err = repo.Save(c.Request.Context(), row)
			}
		} else {
			row, err = ws.EditReport(c.Request.Context(), principal(c), c.Param("id"), input.Report, input.ExpectedUpdatedAt)
		}
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, row)
	})
	protected.PATCH("/api/v1/reports/:id", requireScope("reports:write"), func(c *gin.Context) {
		v, err := repo.Get(c.Request.Context(), principal(c).TeamID, c.Param("id"))
		if err != nil {
			fail(c, err)
			return
		}
		if v.AuthorID != principal(c).UserID && (cfg.Demo || principal(c).Role != "admin" || principal(c).Kind == "token") {
			fail(c, store.ErrForbidden)
			return
		}
		var input struct {
			Status string `json:"status"`
		}
		if !decode(c, &input) {
			return
		}
		v.Status = input.Status
		if err := validateFor(c, cfg, v); err != "" {
			c.JSON(400, gin.H{"error": err})
			return
		}
		v.UpdatedAt = time.Now().UTC()
		if cfg.Demo {
			v, err = repo.Save(c.Request.Context(), v)
		} else {
			v, err = ws.Status(c.Request.Context(), principal(c), v.ID, v.Status)
		}
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, v)
	})
	protected.POST("/api/v1/reports/:id/comments", requireScope("comments:write"), func(c *gin.Context) {
		var input struct {
			Body     string   `json:"body"`
			Mentions []string `json:"mentions"`
		}
		if !decode(c, &input) {
			return
		}
		input.Body = strings.TrimSpace(input.Body)
		if len(input.Body) == 0 || len(input.Body) > 12000 {
			c.JSON(400, gin.H{"error": "评论需为 1–12000 字节"})
			return
		}
		comment := store.Comment{ID: store.ID(), ReportID: c.Param("id"), AuthorID: principal(c).UserID, Body: input.Body, CreatedAt: time.Now().UTC()}
		var v store.Comment
		var err error
		if len(input.Mentions) > 50 {
			c.JSON(400, gin.H{"error": "关注成员过多"})
			return
		}
		if cfg.Demo {
			v, err = repo.Comment(c.Request.Context(), principal(c).TeamID, comment)
		} else {
			v, err = ws.Comment(c.Request.Context(), principal(c), comment, input.Mentions)
		}
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(201, v)
	})
	return r
}
func decode(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
	d := json.NewDecoder(c.Request.Body)
	if err := d.Decode(v); err != nil {
		c.JSON(400, gin.H{"error": "请求必须是有效 JSON，且小于 128 KB"})
		return false
	}
	return true
}
func normalize(v *store.Report) {
	v.Title = strings.TrimSpace(v.Title)
	v.Body = strings.TrimSpace(v.Body)
	if v.SourceID == "" {
		v.SourceID = store.ID()
	}
	if v.Status == "" {
		v.Status = "progress"
	}
	if v.Links == nil {
		v.Links = []store.Link{}
	}
	if v.Mentions == nil {
		v.Mentions = []string{}
	}
}
func validate(v store.Report) string {
	return validateWith(v, store.Projects, store.Domains, store.Members)
}
func validateFor(c *gin.Context, cfg Config, v store.Report) string {
	if cfg.Demo {
		return validate(v)
	}
	data, err := cfg.Identity.Metadata(c.Request.Context(), principal(c))
	if err != nil {
		return "无法读取团队分类，请重试"
	}
	v.ProjectID = ""
	v.Domain = "" // Team taxonomy is resolved transactionally when saving.
	return validateWith(v, data["projects"].([]store.Project), data["domains"].([]string), data["members"].([]store.Member))
}
func validateWith(v store.Report, projects []store.Project, domains []string, members []store.Member) string {
	if v.Title == "" || len(v.Title) > 600 {
		return "请填写简报标题（最多 600 字节）"
	}
	if len(v.Body) > 60000 || len(v.SourceID) > 200 || len(v.Agent) > 100 || len(v.Model) > 100 {
		return "简报内容或来源字段过长"
	}
	switch v.Status {
	case "progress", "review", "blocked", "delivered", "resolved":
	default:
		return "无效的进展状态"
	}
	if v.ProjectID != "" {
		ok := false
		for _, p := range projects {
			if p.ID == v.ProjectID {
				ok = true
			}
		}
		if !ok {
			return "项目不存在"
		}
	}
	if v.Domain != "" {
		ok := false
		for _, d := range domains {
			if d == v.Domain {
				ok = true
			}
		}
		if !ok {
			return "请选择已有领域"
		}
	}
	if len(v.Links) > 20 {
		return "最多添加 20 个链接"
	}
	for _, l := range v.Links {
		u, err := url.Parse(l.URL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return "交付链接必须是有效的 HTTP 或 HTTPS 地址"
		}
	}
	for _, id := range v.Mentions {
		ok := false
		for _, m := range members {
			if m.ID == id {
				ok = true
			}
		}
		if !ok {
			return "关注成员不存在"
		}
	}
	return ""
}
func fail(c *gin.Context, err error) {
	var authErr *identity.Error
	if errors.As(err, &authErr) {
		c.JSON(authErr.Status, gin.H{"error": authErr.Message})
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		c.JSON(404, gin.H{"error": "记录不存在"})
		return
	}
	if errors.Is(err, store.ErrForbidden) {
		c.JSON(403, gin.H{"error": "只能修改自己的上报"})
		return
	}
	log.Printf("repository error: %v", err)
	c.JSON(500, gin.H{"error": "保存失败，请稍后重试"})
}

func frontendOrigin() string {
	if origin := os.Getenv("COFLOW_WEB_ORIGIN"); origin != "" {
		return strings.TrimRight(origin, "/")
	}
	return "http://127.0.0.1:3000"
}

func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
