package httpapi

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/workspace"
	"github.com/gin-gonic/gin"
	"sort"
	"strconv"
	"strings"
)

func todoRead(c *gin.Context) {
	if !principal(c).Can("todos:read") {
		fail(c, identity.Denied("需要 todos:read 权限"))
		c.Abort()
		return
	}
	c.Next()
}
func registerTodos(r *gin.RouterGroup, s *workspace.Service) {
	r.GET("/api/v1/todo-completions", todoRead, func(c *gin.Context) {
		v, e := s.TodoCompletions(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	r.GET("/api/v1/todo-board", todoRead, func(c *gin.Context) {
		v, e := s.TodoBoard(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	r.GET("/api/v1/todos", todoRead, func(c *gin.Context) {
		xs, e := s.Todos(c.Request.Context(), principal(c))
		if e != nil {
			fail(c, e)
			return
		}
		items := []workspace.Todo{}
		p := principal(c)
		for _, t := range xs {
			if t.Archived != (c.Query("archived") == "true") {
				continue
			}
			if v := c.Query("column"); v != "" && t.ColumnID != v {
				continue
			}
			if v := c.Query("project"); v != "" && t.ProjectID != v {
				continue
			}
			if v := c.Query("domain"); v != "" && !contains(t.Domains, v) {
				continue
			}
			if v := c.Query("assignee"); v != "" && t.AssigneeID != v {
				continue
			}
			if v := strings.ToLower(c.Query("q")); v != "" && !strings.Contains(strings.ToLower(t.Title+" "+t.Body), v) {
				continue
			}
			if c.Query("scope") == "todo" && (t.AssigneeID != p.UserID || t.CompletedAt != nil) {
				continue
			}
			if c.Query("scope") == "related" && t.CreatorID != p.UserID && t.AssigneeID != p.UserID {
				full, err := s.GetTodo(c.Request.Context(), p, t.ID)
				if err != nil {
					fail(c, err)
					return
				}
				related := false
				for _, comment := range full.Comments {
					if !comment.Deleted && (comment.AuthorID == p.UserID || contains(comment.Mentions, p.UserID)) {
						related = true
					}
				}
				if !related {
					continue
				}
			}
			items = append(items, t)
		}
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].ColumnID != items[j].ColumnID {
				return items[i].ColumnID < items[j].ColumnID
			}
			if items[i].Position != items[j].Position {
				return items[i].Position < items[j].Position
			}
			return items[i].ID < items[j].ID
		})
		// Keyset cursor is the last ID within a stable ordered list; moves invalidate the board revision returned separately.
		total := len(items)
		start := 0
		if cursor := c.Query("cursor"); cursor != "" {
			start = -1
			for i, t := range items {
				if t.ID == cursor {
					start = i + 1
					break
				}
			}
			if start < 0 {
				fail(c, &identity.Error{Status: 409, Message: "分页已变化，请刷新看板"})
				return
			}
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		if limit <= 0 || limit > 200 {
			limit = 100
		}
		end := start + limit
		if end > total {
			end = total
		}
		next := ""
		if end < total {
			next = items[end-1].ID
		}
		c.JSON(200, gin.H{"items": items[start:end], "total": total, "next_cursor": next})
	})
	r.GET("/api/v1/todos/:id", todoRead, func(c *gin.Context) {
		v, e := s.GetTodo(c.Request.Context(), principal(c), c.Param("id"))
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
	change := func(c *gin.Context) {
		var in workspace.TodoInput
		if !decode(c, &in) {
			return
		}
		p := principal(c)
		if in.Action == "comment" {
			if !p.Can("comments:write") {
				fail(c, identity.Denied("需要 comments:write 权限"))
				return
			}
		} else if !p.Can("todos:write") {
			fail(c, identity.Denied("需要 todos:write 权限"))
			return
		}
		v, e := s.ChangeTodo(c.Request.Context(), p, c.Param("id"), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	}
	r.POST("/api/v1/todos", todoRead, change)
	r.PATCH("/api/v1/todos/:id", todoRead, change)
	column := func(c *gin.Context) {
		var in workspace.ColumnInput
		if !decode(c, &in) {
			return
		}
		v, e := s.ChangeTodoColumn(c.Request.Context(), principal(c), c.Param("id"), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	}
	r.POST("/api/v1/todo-columns", todoRead, column)
	r.PATCH("/api/v1/todo-columns/:id", todoRead, column)
	r.POST("/api/v1/collaborations/:id/todo", todoRead, func(c *gin.Context) {
		if !principal(c).Can("todos:write") || !principal(c).Can("reports:read") {
			fail(c, identity.Denied("需要任务写入和简报读取权限"))
			return
		}
		var in workspace.TodoInput
		if !decode(c, &in) {
			return
		}
		v, e := s.TransferCollaboration(c.Request.Context(), principal(c), c.Param("id"), in)
		if e != nil {
			fail(c, e)
			return
		}
		c.JSON(200, v)
	})
}
