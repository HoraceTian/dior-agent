package collectorapp

import (
	"fmt"
	"os"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

type Config struct {
	Collector CollectorSection `toml:"collector"`
	Auth      AuthSection      `toml:"auth"`
	Tools     ToolsSection     `toml:"tools"`
	LogRoots  []NamedRoot      `toml:"log_roots"`
	FileRoots []FileRoot       `toml:"file_roots"`
}

type CollectorSection struct {
	ID                       string `toml:"id"`
	Name                     string `toml:"name"`
	Description              string `toml:"description"`
	Bind                     string `toml:"bind"`
	PublicURL                string `toml:"public_url"`
	DataDir                  string `toml:"data_dir"`
	DefaultTimeoutMs         int    `toml:"default_timeout_ms"`
	MaxResultBytes           int    `toml:"max_result_bytes"`
	MaxConcurrentInvocations int    `toml:"max_concurrent_invocations"`
}

type AuthSection struct {
	Mode     string `toml:"mode"`
	TokenEnv string `toml:"token_env"`
	Token    string `toml:"token"`
}

type ToolsSection struct {
	Enabled []string `toml:"enabled"`
}

type NamedRoot struct {
	Name string `toml:"name"`
	Path string `toml:"path"`
}

type FileRoot struct {
	Name     string `toml:"name"`
	Path     string `toml:"path"`
	ReadOnly bool   `toml:"read_only"`
}

func LoadConfig(path string) (Config, error) {
	text, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	config := Config{
		Collector: CollectorSection{
			Bind:             "127.0.0.1:9701",
			PublicURL:        "http://127.0.0.1:9701",
			DataDir:          ".collector-data",
			DefaultTimeoutMs: 10_000,
			MaxResultBytes:   65_536,
		},
		Auth: AuthSection{
			Mode:     "static-token",
			TokenEnv: "DIOR_COLLECTOR_TOKEN",
		},
		Tools: ToolsSection{Enabled: []string{"system.info"}},
	}
	if err := toml.Unmarshal(text, &config); err != nil {
		return Config{}, err
	}
	if strings.TrimSpace(config.Collector.ID) == "" {
		return Config{}, fmt.Errorf("collector.id must not be empty")
	}
	if strings.TrimSpace(config.Collector.Name) == "" {
		return Config{}, fmt.Errorf("collector.name must not be empty")
	}
	if strings.TrimSpace(config.Collector.Description) == "" {
		config.Collector.Description = "No collector description configured."
	}
	if strings.TrimSpace(config.Collector.Bind) == "" {
		return Config{}, fmt.Errorf("collector.bind must not be empty")
	}
	if strings.TrimSpace(config.Collector.PublicURL) == "" {
		return Config{}, fmt.Errorf("collector.public_url must not be empty")
	}
	return config, nil
}

func (c Config) AuthToken() (string, error) {
	if c.Auth.Mode != "" && c.Auth.Mode != "static-token" {
		return "", fmt.Errorf("unsupported auth mode: %s", c.Auth.Mode)
	}
	if strings.TrimSpace(c.Auth.Token) != "" {
		return strings.TrimSpace(c.Auth.Token), nil
	}
	env := strings.TrimSpace(c.Auth.TokenEnv)
	if env == "" {
		env = "DIOR_COLLECTOR_TOKEN"
	}
	token := strings.TrimSpace(os.Getenv(env))
	if token == "" {
		return "", fmt.Errorf("missing collector token env: %s", env)
	}
	return token, nil
}
