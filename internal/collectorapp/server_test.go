package collectorapp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCollectorManifestIncludesRoleDescription(t *testing.T) {
	app, err := NewServer(Config{
		Collector: CollectorSection{
			ID:          "local-dev",
			Name:        "Local Dev Collector",
			Description: "Developer workstation collector.",
			Bind:        "127.0.0.1:9701",
			PublicURL:   "http://127.0.0.1:9701",
		},
		Auth: AuthSection{
			Mode:  "static-token",
			Token: "secret",
		},
		Tools: ToolsSection{Enabled: []string{"system.info"}},
	})
	if err != nil {
		t.Fatalf("collector app: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/v1/manifest", nil)
	request.Header.Set("authorization", "Bearer secret")
	response := httptest.NewRecorder()
	app.Routes().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.Code)
	}
	if body := response.Body.String(); !strings.Contains(body, `"description":"Developer workstation collector."`) {
		t.Fatalf("manifest did not include description: %s", body)
	}
}
