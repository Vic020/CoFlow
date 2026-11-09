package httpapi

import (
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
	"github.com/gin-gonic/gin"
	"strconv"
)

func registerKnowledge(r *gin.RouterGroup, s *workspace.Service, repo store.Repository) {
	s.SourceReports = repo
	r.GET("/api/v1/context", func(c *gin.Context) {
		offset, _ := strconv.Atoi(c.Query("offset"))
		limit, _ := strconv.Atoi(c.Query("limit"))
		xs, total, e := s.Contexts(c.Request.Context(), principal(c), workspace.ContextFilter{Q: c.Query("q"), Project: c.Query("project"), Domain: c.Query("domain"), Member: c.Query("member"), State: c.Query("state"), Kind: c.Query("kind"), Source: c.Query("source"), Offset: offset, Limit: limit})
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": xs, "total": total, "next_offset": offset + len(xs)})
	})
	r.GET("/api/v1/context-graph", func(c *gin.Context) {
		v, e := s.ContextGraph(c.Request.Context(), principal(c), workspace.ContextFilter{Project: c.Query("project"), Domain: c.Query("domain"), Member: c.Query("member"), State: c.Query("state"), Kind: c.Query("kind"), Source: c.Query("source"), Q: c.Query("q")})
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	r.GET("/api/v1/context-tree", func(c *gin.Context) {
		xs, e := s.ContextTree(c.Request.Context(), principal(c), workspace.ContextFilter{Project: c.Query("project"), Domain: c.Query("domain"), Member: c.Query("member"), State: c.Query("state"), Q: c.Query("q"), Kind: c.Query("kind"), Source: c.Query("source")})
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": xs, "total": len(xs)})
	})
	r.GET("/api/v1/context/:id", func(c *gin.Context) {
		v, e := s.GetContext(c.Request.Context(), principal(c), c.Param("id"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	change := func(c *gin.Context) {
		var in workspace.ContextInput
		if !decode(c, &in) {
			return
		}
		v, e := s.ChangeContext(c.Request.Context(), principal(c), c.Param("id"), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	}
	r.POST("/api/v1/context", change)
	r.PATCH("/api/v1/context/:id", change)
	r.GET("/api/v1/delegations", func(c *gin.Context) {
		v, e := s.Delegations(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	delegation := func(c *gin.Context) {
		var in workspace.DelegationInput
		if !decode(c, &in) {
			return
		}
		v, e := s.ChangeDelegation(c.Request.Context(), principal(c), c.Param("id"), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	}
	r.POST("/api/v1/delegations", delegation)
	r.PATCH("/api/v1/delegations/:id", delegation)
}
