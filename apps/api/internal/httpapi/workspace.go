package httpapi

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/workspace"
	"github.com/gin-gonic/gin"
	"time"
)

func webMember(c *gin.Context) {
	if principal(c).Kind != "session" {
		fail(c, identity.Denied("此操作需要网页登录"))
		c.Abort()
		return
	}
	c.Next()
}
func registerWorkspace(r *gin.RouterGroup, s *workspace.Service) {
	r.GET("/api/v1/catalog", requireScope("reports:read"), func(c *gin.Context) {
		v, e := s.Catalog(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	r.POST("/api/v1/catalog/:kind", webMember, func(c *gin.Context) {
		var in workspace.Category
		if !decode(c, &in) {
			return
		}
		v, e := s.ChangeCategory(c.Request.Context(), principal(c), c.Param("kind"), "", in, "")
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(201, v)
	})
	r.PUT("/api/v1/catalog/:kind/order", webMember, func(c *gin.Context) {
		var in struct {
			IDs []string `json:"ids"`
		}
		if !decode(c, &in) {
			return
		}
		if e := s.ReorderCatalog(c.Request.Context(), principal(c), c.Param("kind"), in.IDs); e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	r.PATCH("/api/v1/catalog/:kind/:id", webMember, func(c *gin.Context) {
		var in workspace.Category
		if !decode(c, &in) {
			return
		}
		v, e := s.ChangeCategory(c.Request.Context(), principal(c), c.Param("kind"), c.Param("id"), in, "")
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	r.POST("/api/v1/catalog/:kind/:id/merge", webMember, func(c *gin.Context) {
		var in struct {
			Target string `json:"target_id"`
		}
		if !decode(c, &in) {
			return
		}
		if in.Target == "" {
			fail(c, identity.Invalid("请选择合并目标"))
			return
		}
		v, e := s.ChangeCategory(c.Request.Context(), principal(c), c.Param("kind"), c.Param("id"), workspace.Category{}, in.Target)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	r.PATCH("/api/v1/reports/:id/classification", webMember, func(c *gin.Context) {
		var in struct {
			Project string   `json:"project_id"`
			Domains []string `json:"domains"`
		}
		if !decode(c, &in) {
			return
		}
		v, e := s.Classify(c.Request.Context(), principal(c), c.Param("id"), in.Project, in.Domains)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	r.GET("/api/v1/reports/:id/history", requireScope("reports:read"), func(c *gin.Context) {
		v, e := s.History(c.Request.Context(), principal(c), c.Param("id"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	r.GET("/api/v1/collaborations", requireScope("reports:read"), func(c *gin.Context) {
		v, e := s.Collaborations(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	r.POST("/api/v1/collaborations", requireScope("comments:write"), func(c *gin.Context) {
		var in workspace.Collaboration
		if !decode(c, &in) {
			return
		}
		v, e := s.CreateCollaboration(c.Request.Context(), principal(c), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(201, v)
	})
	r.PATCH("/api/v1/collaborations/:id", requireScope("comments:write"), func(c *gin.Context) {
		var in struct {
			Status string `json:"status"`
			Body   string `json:"body"`
		}
		if !decode(c, &in) {
			return
		}
		if e := s.UpdateCollaboration(c.Request.Context(), principal(c), c.Param("id"), in.Status, in.Body); e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	r.GET("/api/v1/notifications", webMember, func(c *gin.Context) {
		v, e := s.Inbox(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	r.POST("/api/v1/notifications/read", webMember, func(c *gin.Context) {
		var in struct {
			ID string `json:"id"`
		}
		if !decode(c, &in) {
			return
		}
		if e := s.ReadNotification(c.Request.Context(), principal(c), in.ID); e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	r.GET("/api/v1/reads", webMember, func(c *gin.Context) {
		v, e := s.Reads(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	r.POST("/api/v1/reports/:id/read", webMember, func(c *gin.Context) {
		var in struct {
			Seen time.Time `json:"seen_at"`
		}
		if !decode(c, &in) {
			return
		}
		if e := s.MarkRead(c.Request.Context(), principal(c), c.Param("id"), in.Seen); e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
}
