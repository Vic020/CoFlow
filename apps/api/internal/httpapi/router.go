package httpapi

import (
	"coflow/api/internal/store"
	"coflow/api/internal/version"
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

const team = "demo"

func New(repo store.Repository) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Cache-Control", "no-store")
		if c.Request.Method != "GET" && c.Request.Method != "HEAD" {
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
		c.JSON(200, gin.H{"status": "ok", "mode": "local-demo", "version": version.Current})
	})
	r.GET("/api/v1/meta", func(c *gin.Context) {
		c.JSON(200, gin.H{"members": store.Members, "projects": store.Projects, "domains": store.Domains, "current_user": "chen", "mode": "local-demo", "timezone": "Asia/Shanghai"})
	})
	r.GET("/api/v1/reports", func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context(), team)
		if err != nil {
			fail(c, err)
			return
		}
		out := []store.Report{}
		for _, v := range rows {
			if p := c.Query("project"); p != "" && v.ProjectID != p {
				continue
			}
			if p := c.Query("domain"); p != "" && v.Domain != p {
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
	r.POST("/api/v1/reports", func(c *gin.Context) {
		var v store.Report
		if !decode(c, &v) {
			return
		}
		normalize(&v)
		if err := validate(v); err != "" {
			c.JSON(400, gin.H{"error": err})
			return
		}
		now := time.Now().UTC()
		v.ID = store.ID()
		v.TeamID = team
		v.AuthorID = "chen"
		v.CreatedAt = now
		v.UpdatedAt = now
		row, err := repo.Save(c.Request.Context(), v)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, row)
	})
	r.PATCH("/api/v1/reports/:id", func(c *gin.Context) {
		v, err := repo.Get(c.Request.Context(), team, c.Param("id"))
		if err != nil {
			fail(c, err)
			return
		}
		if v.AuthorID != "chen" {
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
		if err := validate(v); err != "" {
			c.JSON(400, gin.H{"error": err})
			return
		}
		v.UpdatedAt = time.Now().UTC()
		v, err = repo.Save(c.Request.Context(), v)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, v)
	})
	r.POST("/api/v1/reports/:id/comments", func(c *gin.Context) {
		var input struct {
			Body string `json:"body"`
		}
		if !decode(c, &input) {
			return
		}
		input.Body = strings.TrimSpace(input.Body)
		if len(input.Body) == 0 || len(input.Body) > 12000 {
			c.JSON(400, gin.H{"error": "评论需为 1–12000 字节"})
			return
		}
		v, err := repo.Comment(c.Request.Context(), team, store.Comment{ID: store.ID(), ReportID: c.Param("id"), AuthorID: "chen", Body: input.Body, CreatedAt: time.Now().UTC()})
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
		for _, p := range store.Projects {
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
		for _, d := range store.Domains {
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
		for _, m := range store.Members {
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
