package app

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ServiceName          string
	Host                 string
	Port                 int
	WorkspaceRoot        string
	ModelConfigPath      string
	ModelConfigWatch     bool
	CollectorsConfigPath string
	Auth                 AuthConfig
	MaxMessageBytes      int64
	IdleTimeoutMs        int
	LogLevel             string
}

type AuthConfig struct {
	StaticToken      string
	AllowInsecureDev bool
	AllowQueryToken  bool
	AllowedOrigins   []string
}

func LoadEnvFile(path string) error {
	text, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for key, value := range parseEnvFile(string(text)) {
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	return nil
}

func LoadConfig(env map[string]string) (Config, error) {
	if env == nil {
		env = environ()
	}
	config := Config{
		ServiceName:          stringDefault(env["AGENT_SERVICE_NAME"], "dior-agent"),
		Host:                 stringDefault(env["AGENT_HOST"], "0.0.0.0"),
		Port:                 intDefault(env["AGENT_PORT"], 8787),
		WorkspaceRoot:        stringDefault(env["AGENT_WORKSPACE_ROOT"], ".data"),
		ModelConfigPath:      stringDefault(env["AGENT_MODEL_CONFIG_PATH"], ".config/models.toml"),
		ModelConfigWatch:     boolDefault(env["AGENT_MODEL_CONFIG_WATCH"], true),
		CollectorsConfigPath: stringDefault(env["AGENT_COLLECTORS_CONFIG_PATH"], ".config/collectors.toml"),
		Auth: AuthConfig{
			StaticToken:      strings.TrimSpace(env["AGENT_API_TOKEN"]),
			AllowInsecureDev: boolValue(env["AGENT_ALLOW_INSECURE_DEV"]),
			AllowQueryToken:  boolValue(env["AGENT_ALLOW_QUERY_TOKEN"]),
			AllowedOrigins:   parseOrigins(env["AGENT_ALLOWED_ORIGINS"]),
		},
		MaxMessageBytes: int64Bounded(env["AGENT_MAX_MESSAGE_BYTES"], 64*1024, 1024, 10*1024*1024),
		IdleTimeoutMs:   intBounded(env["AGENT_IDLE_TIMEOUT_MS"], 120_000, 5_000, 30*60_000),
		LogLevel:        logLevel(env["AGENT_LOG_LEVEL"]),
	}
	if err := validateConfig(config); err != nil {
		return Config{}, err
	}
	return config, nil
}

func environ() map[string]string {
	result := map[string]string{}
	for _, item := range os.Environ() {
		parts := strings.SplitN(item, "=", 2)
		if len(parts) == 2 {
			result[parts[0]] = parts[1]
		}
	}
	return result
}

func parseEnvFile(text string) map[string]string {
	result := map[string]string{}
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		if key == "" || strings.ContainsAny(key, " \t") {
			continue
		}
		result[key] = unquoteEnvValue(strings.TrimSpace(parts[1]))
	}
	return result
}

func unquoteEnvValue(value string) string {
	if len(value) < 2 {
		return value
	}
	first := value[0]
	last := value[len(value)-1]
	if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
		return value[1 : len(value)-1]
	}
	return value
}

func validateConfig(config Config) error {
	if config.Auth.StaticToken == "" && !config.Auth.AllowInsecureDev {
		return fmt.Errorf("AGENT_API_TOKEN is required. Set AGENT_ALLOW_INSECURE_DEV=1 only for local throwaway development")
	}
	if config.Auth.StaticToken == "" && config.Auth.AllowInsecureDev && !isLoopbackHost(config.Host) {
		return fmt.Errorf("AGENT_ALLOW_INSECURE_DEV without AGENT_API_TOKEN may only bind to loopback hosts")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	if host == "localhost" || host == "::1" {
		return true
	}
	parsed := net.ParseIP(host)
	return parsed != nil && parsed.IsLoopback()
}

func parseOrigins(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	seen := map[string]bool{}
	origins := []string{}
	for _, raw := range strings.Split(value, ",") {
		parsed, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			continue
		}
		origin := parsed.Scheme + "://" + parsed.Host
		if !seen[origin] {
			origins = append(origins, origin)
			seen[origin] = true
		}
	}
	return origins
}

func stringDefault(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func boolValue(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func boolDefault(value string, fallback bool) bool {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func intDefault(value string, fallback int) int {
	return intBounded(value, fallback, 0, 65535)
}

func intBounded(value string, fallback int, min int, max int) int {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < min || parsed > max {
		return fallback
	}
	return parsed
}

func int64Bounded(value string, fallback int64, min int64, max int64) int64 {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed < min || parsed > max {
		return fallback
	}
	return parsed
}

func logLevel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug", "info", "warn", "error":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "info"
	}
}
