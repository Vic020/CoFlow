package httpapi

import (
	"coflow/api/internal/workspace"
	"github.com/gin-gonic/gin"
)

func registerStatistics(r *gin.RouterGroup, s *workspace.Service) {
	r.GET("/api/v1/statistics", func(c *gin.Context) {
		q, e := workspace.ParseStatisticsQuery(c.Request.URL.Query())
		if e != nil {
			fail(c, e)
			return
		}
		v, e := s.Statistics(c.Request.Context(), principal(c), q)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
}
