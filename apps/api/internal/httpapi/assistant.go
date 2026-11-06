package httpapi

import (
	"coflow/api/internal/assistant"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"strconv"
	"strings"
	"sync"
	"time"
)

func registerAssistant(r *gin.RouterGroup, cfg Config, ws *workspace.Service, repo store.Repository) {
	aiLimit := assistantLimiter()
	g := r.Group("/api/v1/assistant", sessionOnly)
	s := &assistant.Service{Slots: make(chan struct{}, 3), Identity: cfg.Identity, Pool: cfg.Identity.Pool, Workspace: ws, Repo: repo, Key: cfg.AIEncryptionKey, Client: cfg.AIClient}
	if cfg.AIWorkerContext != nil {
		go s.RunScheduler(cfg.AIWorkerContext)
	}
	g.GET("/jobs", func(c *gin.Context) {
		v, e := s.Jobs(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	g.GET("/jobs/preview", func(c *gin.Context) {
		var days []int
		for _, value := range strings.Split(c.Query("weekdays"), ",") {
			d, e := strconv.Atoi(value)
			if e != nil {
				fail(c, identity.Invalid("工作日无效"))
				return
			}
			days = append(days, d)
		}
		v, e := assistant.NextRun(time.Now(), c.Query("timezone"), c.Query("local_time"), days)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"next_run_at": v})
	})
	g.POST("/jobs", func(c *gin.Context) {
		var in assistant.Job
		if !decode(c, &in) {
			return
		}
		v, e := s.SaveJob(c.Request.Context(), principal(c), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.PATCH("/jobs/:id", func(c *gin.Context) {
		var in struct {
			Revision int `json:"expected_revision"`
		}
		if !decode(c, &in) {
			return
		}
		v, e := s.PauseJob(c.Request.Context(), principal(c), c.Param("id"), in.Revision)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.GET("/jobs/:id/runs", func(c *gin.Context) {
		v, e := s.JobRuns(c.Request.Context(), principal(c), c.Param("id"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	g.GET("/mcp", func(c *gin.Context) {
		v, e := s.MCPConnections(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	g.POST("/mcp", func(c *gin.Context) {
		var in assistant.MCPConnection
		if !decode(c, &in) {
			return
		}
		v, e := s.SaveMCP(c.Request.Context(), principal(c), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.POST("/mcp/:id/verify", aiLimit, func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 24*time.Second)
		defer cancel()
		v, e := s.VerifyMCP(ctx, principal(c), c.Param("id"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.POST("/mcp/:id/approve", func(c *gin.Context) {
		var in struct {
			Revision int      `json:"expected_revision"`
			Names    []string `json:"tools"`
		}
		if !decode(c, &in) {
			return
		}
		v, e := s.ApproveMCP(c.Request.Context(), principal(c), c.Param("id"), in.Revision, in.Names)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.GET("/configs", func(c *gin.Context) {
		v, e := s.Configs(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		selected, e := s.Preference(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v, "configured": cfg.AIEncryptionKey != "", "selected_config_id": selected})
	})
	save := func(c *gin.Context) {
		var in assistant.ConfigInput
		if !decode(c, &in) {
			return
		}
		v, e := s.SaveConfig(c.Request.Context(), principal(c), c.Param("id"), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	}
	g.POST("/configs", save)
	g.PUT("/configs/:id", save)
	g.DELETE("/configs/:id", func(c *gin.Context) {
		var in struct {
			Revision int `json:"expected_revision"`
		}
		if !decode(c, &in) {
			return
		}
		if e := s.DeleteConfig(c.Request.Context(), principal(c), c.Param("id"), in.Revision); e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	g.POST("/configs/:id/verify", aiLimit, func(c *gin.Context) {
		v, e := s.VerifyConfig(c.Request.Context(), principal(c), c.Param("id"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.GET("/conversations", func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		v, e := s.History(c.Request.Context(), principal(c), assistant.HistoryQuery{Q: c.Query("q"), State: c.Query("state"), Cursor: c.Query("cursor"), Limit: limit})
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.GET("/conversations/:id", func(c *gin.Context) {
		v, e := s.Conversation(c.Request.Context(), principal(c), c.Param("id"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.PATCH("/conversations/:id", func(c *gin.Context) {
		var in struct {
			Action   string `json:"action"`
			Title    string `json:"title"`
			Revision int    `json:"expected_revision"`
		}
		if !decode(c, &in) {
			return
		}
		if e := s.ChangeConversation(c.Request.Context(), principal(c), c.Param("id"), in.Action, in.Title, in.Revision); e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	g.GET("/templates", func(c *gin.Context) {
		v, e := s.Templates(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	g.POST("/templates", func(c *gin.Context) {
		var in assistant.Template
		if !decode(c, &in) {
			return
		}
		v, e := s.SaveTemplate(c.Request.Context(), principal(c), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.PATCH("/preference", func(c *gin.Context) {
		var in struct {
			ID string `json:"config_id"`
		}
		if !decode(c, &in) {
			return
		}
		if e := s.SelectConfig(c.Request.Context(), principal(c), in.ID); e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	g.PATCH("/actions/:id", func(c *gin.Context) {
		var in struct {
			Title string `json:"title"`
			Body  string `json:"body"`
		}
		if !decode(c, &in) {
			return
		}
		v, e := s.EditDraft(c.Request.Context(), principal(c), c.Param("id"), in.Title, in.Body)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	g.POST("/chat", aiLimit, func(c *gin.Context) {
		var in assistant.ChatInput
		if !decode(c, &in) {
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 24*time.Second)
		defer cancel()
		streaming := strings.Contains(c.GetHeader("Accept"), "text/event-stream")
		emit := func(kind string, value any) {
			raw, _ := json.Marshal(value)
			fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", kind, raw)
			c.Writer.Flush()
		}
		if streaming {
			c.Header("Content-Type", "text/event-stream")
			c.Header("Cache-Control", "no-store")
			c.Header("X-Accel-Buffering", "no")
			emit("start", gin.H{})
			in.OnDelta = func(delta string) { emit("delta", gin.H{"text": delta}) }
		}
		v, e := s.Chat(ctx, principal(c), in)
		if streaming {
			if e != nil {
				message := "模型流已中断，请重试同一请求"
				var ie *identity.Error
				if errors.As(e, &ie) {
					message = ie.Message
				}
				emit("error", gin.H{"error": message})
			} else {
				emit("done", v)
			}
			return
		}
		if e != nil {
			if ctx.Err() != nil {
				fail(c, &identity.Error{Status: 504, Message: "请求已取消或超时，未执行业务变更"})
			} else {
				fail(c, e)
			}
			return
		}
		c.JSON(200, v)
	})
	g.POST("/actions/:id", func(c *gin.Context) {
		var in struct {
			Decision string `json:"decision"`
		}
		if !decode(c, &in) {
			return
		}
		v, e := s.Confirm(c.Request.Context(), principal(c), c.Param("id"), in.Decision)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
}

func assistantLimiter() gin.HandlerFunc {
	var mu sync.Mutex
	items := map[string]attempt{}
	return func(c *gin.Context) {
		p := principal(c)
		key := p.TeamID + ":" + p.UserID
		now := time.Now()
		mu.Lock()
		for k, v := range items {
			if now.Sub(v.start) > time.Minute {
				delete(items, k)
			}
		}
		v := items[key]
		if v.start.IsZero() {
			v.start = now
		}
		v.count++
		items[key] = v
		mu.Unlock()
		if v.count > 10 {
			c.Header("Retry-After", "60")
			c.AbortWithStatusJSON(429, gin.H{"error": "模型请求过于频繁，请一分钟后再试"})
			return
		}
		c.Next()
	}
}
