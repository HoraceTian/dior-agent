package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pelletier/go-toml/v2"

	"dior-agent/internal/logging"
)

type Endpoint struct {
	ID       string `toml:"id"`
	URL      string `toml:"url"`
	TokenEnv string `toml:"token_env"`
	Token    string `toml:"token"`
	Enabled  bool   `toml:"enabled"`
	Trust    string `toml:"trust"`
}

type fileConfig struct {
	Collectors []Endpoint `toml:"collectors"`
}

type ToolDescriptor struct {
	Name           string         `json:"name"`
	Description    string         `json:"description"`
	InputSchema    map[string]any `json:"inputSchema"`
	OutputSchema   map[string]any `json:"outputSchema"`
	Scopes         []string       `json:"scopes"`
	SideEffects    string         `json:"sideEffects"`
	TimeoutMs      int            `json:"timeoutMs"`
	MaxResultBytes int            `json:"maxResultBytes"`
}

type Manifest struct {
	CollectorID     string           `json:"collectorId"`
	DisplayName     string           `json:"displayName"`
	Description     string           `json:"description"`
	ProtocolVersion string           `json:"protocolVersion"`
	Version         string           `json:"version"`
	PublicURL       string           `json:"publicUrl"`
	Tools           []ToolDescriptor `json:"tools"`
}

type Registration struct {
	ID           string    `json:"id"`
	Endpoint     Endpoint  `json:"endpoint"`
	Manifest     Manifest  `json:"manifest"`
	DiscoveredAt time.Time `json:"discoveredAt"`
}

type Registry struct {
	path          string
	logger        logging.Logger
	registrations []Registration
}

func NewRegistry(path string, logger logging.Logger) *Registry {
	return &Registry{path: path, logger: logger}
}

func (r *Registry) Start(ctx context.Context) {
	r.reload(ctx)
}

func (r *Registry) Count() int {
	return len(r.registrations)
}

func (r *Registry) Registrations() []Registration {
	out := make([]Registration, len(r.registrations))
	copy(out, r.registrations)
	return out
}

func (r *Registry) reload(ctx context.Context) {
	text, err := os.ReadFile(r.path)
	if err != nil {
		r.logger.Info("Collector registry config not found; no collectors loaded", map[string]any{
			"path": r.path,
		})
		return
	}
	var config fileConfig
	if err := toml.Unmarshal(text, &config); err != nil {
		r.logger.Warn("Collector registry config invalid; no collectors loaded", map[string]any{
			"path":  r.path,
			"error": err.Error(),
		})
		return
	}
	registrations := []Registration{}
	for _, endpoint := range config.Collectors {
		if !endpoint.Enabled {
			continue
		}
		manifest, err := readManifest(ctx, endpoint)
		if err != nil {
			r.logger.Warn("Collector discovery failed", map[string]any{
				"id":    endpoint.ID,
				"url":   endpoint.URL,
				"error": err.Error(),
			})
			continue
		}
		registrations = append(registrations, Registration{
			ID:           endpoint.ID,
			Endpoint:     endpoint,
			Manifest:     manifest,
			DiscoveredAt: time.Now().UTC(),
		})
		r.logger.Info("Collector discovered", map[string]any{
			"id":    endpoint.ID,
			"url":   endpoint.URL,
			"tools": len(manifest.Tools),
		})
	}
	r.registrations = registrations
}

func readManifest(ctx context.Context, endpoint Endpoint) (Manifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(endpoint.URL, "/")+"/v1/manifest", nil)
	if err != nil {
		return Manifest{}, err
	}
	req.Header.Set("accept", "application/json")
	if token := resolveToken(endpoint); token != "" {
		req.Header.Set("authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return Manifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Manifest{}, fmt.Errorf("manifest request failed with HTTP %d", resp.StatusCode)
	}
	var manifest Manifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return Manifest{}, err
	}
	if manifest.Description == "" {
		manifest.Description = "No collector description configured."
	}
	return manifest, nil
}

func resolveToken(endpoint Endpoint) string {
	if strings.TrimSpace(endpoint.Token) != "" {
		return strings.TrimSpace(endpoint.Token)
	}
	if strings.TrimSpace(endpoint.TokenEnv) == "" {
		return ""
	}
	return strings.TrimSpace(os.Getenv(endpoint.TokenEnv))
}
