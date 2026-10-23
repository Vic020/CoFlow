package httpapi

import (
	"coflow/api/internal/identity"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"sync"
	"time"
)

const sessionCookie = "coflow_session"

type Config struct {
	Identity      *identity.Service
	SecureCookies bool
	Demo          bool
}

func principal(c *gin.Context) identity.Principal {
	p, _ := c.Get("principal")
	return p.(identity.Principal)
}
func requirePrincipal(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.Demo {
			c.Set("principal", identity.Principal{UserID: "chen", TeamID: "demo", Role: "admin", Kind: "demo"})
			c.Next()
			return
		}
		raw := ""
		agent := false
		if header := c.GetHeader("Authorization"); header != "" {
			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				fail(c, identity.Unauthorized())
				c.Abort()
				return
			}
			raw = parts[1]
			agent = true
		} else {
			raw, _ = c.Cookie(sessionCookie)
		}
		p, err := cfg.Identity.Authenticate(c.Request.Context(), raw, agent)
		if err != nil {
			fail(c, err)
			c.Abort()
			return
		}
		c.Set("principal", p)
		c.Next()
	}
}
func requireScope(scope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !principal(c).Can(scope) {
			fail(c, identity.Denied("凭证没有此操作权限"))
			c.Abort()
			return
		}
		c.Next()
	}
}
func sessionOnly(c *gin.Context) {
	if principal(c).Kind != "session" {
		fail(c, identity.Denied("此操作需要网页登录，Agent 凭证不可管理账号或团队"))
		c.Abort()
		return
	}
	c.Next()
}
func setSession(c *gin.Context, raw string, secure bool) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookie, raw, 7*24*3600, "/", "", secure, true)
}

type attempt struct {
	start time.Time
	count int
}

func authLimiter() gin.HandlerFunc {
	var mu sync.Mutex
	items := map[string]attempt{}
	return func(c *gin.Context) {
		mu.Lock()
		now := time.Now()
		for key, v := range items {
			if now.Sub(v.start) > time.Minute {
				delete(items, key)
			}
		}
		key := c.ClientIP()
		v := items[key]
		if v.start.IsZero() {
			v.start = now
		}
		v.count++
		items[key] = v
		mu.Unlock()
		if v.count > 30 {
			c.Header("Retry-After", "60")
			c.AbortWithStatusJSON(429, gin.H{"error": "请求过于频繁，请一分钟后再试"})
			return
		}
		c.Next()
	}
}
func registerIdentity(r *gin.Engine, cfg Config) {
	r.GET("/api/v1/auth/status", func(c *gin.Context) {
		if cfg.Demo {
			c.JSON(200, gin.H{"mode": "local-demo", "initialized": true})
			return
		}
		ready, err := cfg.Identity.Initialized(c.Request.Context())
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"mode": "team", "initialized": ready})
	})
	if cfg.Demo {
		return
	}
	s := cfg.Identity
	pub := r.Group("/api/v1/auth")
	pub.Use(authLimiter())
	pub.POST("/bootstrap", func(c *gin.Context) {
		var v struct {
			Email    string `json:"email"`
			Name     string `json:"name"`
			Password string `json:"password"`
			TeamName string `json:"team_name"`
		}
		if !decode(c, &v) {
			return
		}
		raw, err := s.Bootstrap(c.Request.Context(), v.Email, v.Name, v.Password, v.TeamName)
		if err != nil {
			fail(c, err)
			return
		}
		setSession(c, raw, cfg.SecureCookies)
		c.JSON(201, gin.H{"ok": true})
	})
	pub.POST("/login", func(c *gin.Context) {
		var v struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if !decode(c, &v) {
			return
		}
		raw, err := s.Login(c.Request.Context(), v.Email, v.Password)
		if err != nil {
			fail(c, err)
			return
		}
		setSession(c, raw, cfg.SecureCookies)
		c.JSON(200, gin.H{"ok": true})
	})
	pub.POST("/invite-info", func(c *gin.Context) {
		var v struct {
			Token string `json:"token"`
		}
		if !decode(c, &v) {
			return
		}
		info, err := s.InviteInfo(c.Request.Context(), v.Token)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, info)
	})
	pub.POST("/accept-invite", func(c *gin.Context) {
		var v struct {
			Token    string `json:"token"`
			Name     string `json:"name"`
			Password string `json:"password"`
		}
		if !decode(c, &v) {
			return
		}
		uid := ""
		if raw, err := c.Cookie(sessionCookie); err == nil {
			p, err := s.Authenticate(c.Request.Context(), raw, false)
			if err == nil {
				uid = p.UserID
			}
		}
		raw, err := s.AcceptInvite(c.Request.Context(), v.Token, v.Name, v.Password, uid)
		if err != nil {
			fail(c, err)
			return
		}
		setSession(c, raw, cfg.SecureCookies)
		c.JSON(200, gin.H{"ok": true})
	})
	own := r.Group("/api/v1")
	own.Use(requirePrincipal(cfg), sessionOnly)
	own.POST("/teams", func(c *gin.Context) {
		var in struct {
			Name        string `json:"name"`
			DisplayName string `json:"display_name"`
		}
		if !decode(c, &in) {
			return
		}
		raw, _ := c.Cookie(sessionCookie)
		id, err := s.CreateWorkspace(c.Request.Context(), principal(c), raw, in.Name, in.DisplayName)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(201, gin.H{"id": id})
	})
	own.GET("/auth/me", func(c *gin.Context) {
		v, err := s.Me(c.Request.Context(), principal(c))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, v)
	})
	own.POST("/auth/logout", func(c *gin.Context) {
		raw, _ := c.Cookie(sessionCookie)
		if err := s.Logout(c.Request.Context(), raw); err != nil {
			fail(c, err)
			return
		}
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(sessionCookie, "", -1, "/", "", cfg.SecureCookies, true)
		c.JSON(200, gin.H{"ok": true})
	})
	own.POST("/auth/team", func(c *gin.Context) {
		var v struct {
			TeamID string `json:"team_id"`
		}
		if !decode(c, &v) {
			return
		}
		raw, _ := c.Cookie(sessionCookie)
		if err := s.SwitchTeam(c.Request.Context(), principal(c), raw, v.TeamID); err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	own.GET("/invites", func(c *gin.Context) {
		v, err := s.ListInvites(c.Request.Context(), principal(c))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"items": v})
	})
	own.POST("/invites", func(c *gin.Context) {
		var v struct {
			Email string `json:"email"`
		}
		if !decode(c, &v) {
			return
		}
		row, err := s.CreateInvite(c.Request.Context(), principal(c), v.Email)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(201, row)
	})
	own.DELETE("/invites/:id", func(c *gin.Context) {
		if err := s.RevokeInvite(c.Request.Context(), principal(c), c.Param("id")); err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	own.GET("/tokens", func(c *gin.Context) {
		rows, err := s.ListTokens(c.Request.Context(), principal(c))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"items": rows})
	})
	own.POST("/tokens", func(c *gin.Context) {
		var v struct {
			Name   string   `json:"name"`
			Scopes []string `json:"scopes"`
			Days   int      `json:"expires_in_days"`
		}
		if !decode(c, &v) {
			return
		}
		row, err := s.CreateToken(c.Request.Context(), principal(c), v.Name, v.Scopes, v.Days)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(201, row)
	})
	own.DELETE("/tokens/:id", func(c *gin.Context) {
		if err := s.RevokeToken(c.Request.Context(), principal(c), c.Param("id")); err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	own.DELETE("/members/:id", func(c *gin.Context) {
		if err := s.RemoveMember(c.Request.Context(), principal(c), c.Param("id")); err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
}
