package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"coflow/api/internal/identity"
	"github.com/gin-gonic/gin"
)

const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code"

func registerCLIDevice(r *gin.Engine, cfg Config) {
	if cfg.Demo {
		return
	}
	s := cfg.Identity
	public := r.Group("/api/v1/oauth", authLimiter())
	public.Use(func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
		if !cliOAuthForm(c) || c.Request.ParseForm() != nil {
			c.AbortWithStatusJSON(400, gin.H{"error": "invalid_request"})
			return
		}
		c.Next()
	})
	public.POST("/device", func(c *gin.Context) {
		if c.PostForm("client_id") != "coflow-cli" {
			c.JSON(400, gin.H{"error": "invalid_client"})
			return
		}
		days, _ := strconv.Atoi(c.DefaultPostForm("days", "7"))
		scopes := strings.Fields(c.DefaultPostForm("scope", "reports:read todos:read calendar:read context:read"))
		if len(scopes) == 0 {
			c.JSON(400, gin.H{"error": "invalid_scope"})
			return
		}
		out, err := s.StartDevice(c.Request.Context(), c.DefaultPostForm("name", "CoFlow CLI"), scopes, days, c.PostForm("team_id"), identity.DeviceScope{ProjectID: c.PostForm("project_id"), TodoID: c.PostForm("todo_id")})
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"device_code": out.DeviceCode, "user_code": out.UserCode,
			"verification_uri": frontendOrigin() + "/credentials", "expires_in": out.ExpiresIn, "interval": out.Interval})
	})
	public.POST("/token", func(c *gin.Context) {
		if c.PostForm("client_id") != "coflow-cli" {
			c.JSON(400, gin.H{"error": "invalid_client"})
			return
		}
		if c.PostForm("grant_type") != deviceGrant {
			c.JSON(400, gin.H{"error": "unsupported_grant_type"})
			return
		}
		device := c.PostForm("device_code")
		if len(device) != 46 || !strings.HasPrefix(device, "cd_") {
			c.JSON(400, gin.H{"error": "invalid_grant"})
			return
		}
		out, status, err := s.RedeemDevice(c.Request.Context(), device)
		if err != nil {
			fail(c, err)
			return
		}
		if status != "" {
			c.JSON(400, gin.H{"error": status})
			return
		}
		c.JSON(200, out)
	})
	browser := r.Group("/api/v1/cli/device", requirePrincipal(cfg), sessionOnly, authLimiter())
	browser.POST("/review", func(c *gin.Context) {
		var in struct {
			Code string `json:"code"`
		}
		if !decode(c, &in) {
			return
		}
		out, err := s.ReviewDevice(c.Request.Context(), principal(c), in.Code)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, out)
	})
	browser.POST("/decision", func(c *gin.Context) {
		var in struct {
			Code    string `json:"code"`
			UserID  string `json:"user_id"`
			TeamID  string `json:"team_id"`
			Approve *bool  `json:"approve"`
		}
		if !decode(c, &in) {
			return
		}
		if in.Approve == nil {
			fail(c, identity.Invalid("请选择允许或拒绝"))
			return
		}
		if err := s.DecideDevice(c.Request.Context(), principal(c), in.Code, in.UserID, in.TeamID, *in.Approve); err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	r.POST("/api/v1/cli/revoke", requirePrincipal(cfg), func(c *gin.Context) {
		raw := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if err := s.RevokeDeviceToken(c.Request.Context(), principal(c), raw); err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
}

func cliOAuthForm(c *gin.Context) bool {
	return c.ContentType() == "application/x-www-form-urlencoded"
}
