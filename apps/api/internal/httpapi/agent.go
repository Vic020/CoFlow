package httpapi

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
	"github.com/gin-gonic/gin"
	"strconv"
)

func registerAgent(r *gin.RouterGroup, s *workspace.Service, repo store.Repository) {
	r.GET("/api/v1/agent/changes", func(c *gin.Context) {
		limit := 100
		if raw := c.Query("limit"); raw != "" {
			v, e := strconv.Atoi(raw)
			if e != nil {
				fail(c, identity.Invalid("limit 无效"))
				return
			}
			limit = v
		}
		out, e := s.AgentChanges(c.Request.Context(), principal(c), c.Query("project"), c.Query("cursor"), limit)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, out)
	})
	r.GET("/api/v1/agent/context", func(c *gin.Context) {
		out, e := s.Handoff(c.Request.Context(), principal(c), repo, c.Query("project"), c.Query("todo"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, out)
	})
}
