package httpapi

import (
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
	"github.com/gin-gonic/gin"
)

func registerCalendar(r *gin.RouterGroup, s *workspace.Service, repo store.Repository) {
	r.GET("/api/v1/calendar/reports", requireScope("reports:read"), func(c *gin.Context) {
		q, e := workspace.ParseCalendarQuery(c.Request.URL.Query())
		if e != nil {
			fail(c, e)
			return
		}
		v, e := s.CalendarReports(c.Request.Context(), principal(c), repo, q)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	r.GET("/api/v1/calendar/schedule", func(c *gin.Context) {
		q, e := workspace.ParseCalendarQuery(c.Request.URL.Query())
		if e != nil {
			fail(c, e)
			return
		}
		v, e := s.CalendarSchedule(c.Request.Context(), principal(c), q)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	r.GET("/api/v1/calendar/events/:id", requireScope("calendar:read"), func(c *gin.Context) {
		v, e := s.GetCalendarEvent(c.Request.Context(), principal(c), c.Param("id"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	change := func(c *gin.Context) {
		var in workspace.CalendarEventInput
		if !decode(c, &in) {
			return
		}
		v, e := s.ChangeCalendarEvent(c.Request.Context(), principal(c), c.Param("id"), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	}
	r.POST("/api/v1/calendar/events", requireScope("calendar:read"), requireScope("calendar:write"), change)
	r.PATCH("/api/v1/calendar/events/:id", requireScope("calendar:read"), requireScope("calendar:write"), change)
}
