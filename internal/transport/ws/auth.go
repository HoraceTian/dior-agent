package ws

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"dior-agent/internal/app"
)

func authenticate(r *http.Request, config app.Config) (string, bool) {
	if config.Auth.StaticToken == "" && config.Auth.AllowInsecureDev {
		return "private-client", true
	}

	credential := bearerToken(r.Header.Get("authorization"))
	if credential == "" {
		if cookie, err := r.Cookie("agent_token"); err == nil {
			credential = strings.TrimSpace(cookie.Value)
		}
	}
	if credential == "" && config.Auth.AllowQueryToken {
		credential = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	if credential == "" || config.Auth.StaticToken == "" {
		return "", false
	}
	if subtle.ConstantTimeCompare([]byte(credential), []byte(config.Auth.StaticToken)) != 1 {
		return "", false
	}
	return "private-client", true
}

func originAllowed(r *http.Request, config app.Config) bool {
	if len(config.Auth.AllowedOrigins) == 0 {
		return true
	}
	origin := r.Header.Get("origin")
	if origin == "" {
		return true
	}
	for _, allowed := range config.Auth.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func bearerToken(value string) string {
	if strings.HasPrefix(value, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	}
	return ""
}
