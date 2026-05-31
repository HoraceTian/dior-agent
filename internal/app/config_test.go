package app

import (
	"os"
	"testing"
)

func TestLoadConfigRequiresTokenUnlessLocalInsecure(t *testing.T) {
	if _, err := LoadConfig(map[string]string{}); err == nil {
		t.Fatal("expected missing token to fail")
	}
	if _, err := LoadConfig(map[string]string{
		"AGENT_ALLOW_INSECURE_DEV": "1",
	}); err == nil {
		t.Fatal("expected insecure non-loopback config to fail")
	}
	config, err := LoadConfig(map[string]string{
		"AGENT_ALLOW_INSECURE_DEV": "1",
		"AGENT_HOST":               "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("expected loopback insecure config to pass: %v", err)
	}
	if !config.Auth.AllowInsecureDev {
		t.Fatal("expected insecure dev flag to be enabled")
	}
}

func TestLoadConfigParsesCollectorConfigPath(t *testing.T) {
	config, err := LoadConfig(map[string]string{
		"AGENT_API_TOKEN":              "secret",
		"AGENT_COLLECTORS_CONFIG_PATH": ".private-collectors.toml",
		"AGENT_ALLOWED_ORIGINS":        "https://private.example/, https://admin.example",
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if config.CollectorsConfigPath != ".private-collectors.toml" {
		t.Fatalf("unexpected collectors config path: %s", config.CollectorsConfigPath)
	}
	if len(config.Auth.AllowedOrigins) != 2 {
		t.Fatalf("unexpected allowed origins: %#v", config.Auth.AllowedOrigins)
	}
}

func TestLoadEnvFileDoesNotOverrideExistingEnv(t *testing.T) {
	t.Setenv("DIOR_AGENT_ENV_TEST_TOKEN", "from-env")
	_ = os.Unsetenv("DIOR_AGENT_ENV_TEST_QUOTED")
	_ = os.Unsetenv("DIOR_AGENT_ENV_TEST_EMPTY")
	t.Cleanup(func() {
		_ = os.Unsetenv("DIOR_AGENT_ENV_TEST_QUOTED")
		_ = os.Unsetenv("DIOR_AGENT_ENV_TEST_EMPTY")
	})

	path := t.TempDir() + "/.env"
	content := []byte(`
# comments and empty lines are ignored
DIOR_AGENT_ENV_TEST_TOKEN=from-file
export DIOR_AGENT_ENV_TEST_QUOTED="quoted-value"
DIOR_AGENT_ENV_TEST_EMPTY=
`)
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}

	if err := LoadEnvFile(path); err != nil {
		t.Fatalf("load env file: %v", err)
	}
	if value := os.Getenv("DIOR_AGENT_ENV_TEST_TOKEN"); value != "from-env" {
		t.Fatalf("expected existing env to win, got %q", value)
	}
	if value := os.Getenv("DIOR_AGENT_ENV_TEST_QUOTED"); value != "quoted-value" {
		t.Fatalf("expected quoted value to be unwrapped, got %q", value)
	}
	if value, ok := os.LookupEnv("DIOR_AGENT_ENV_TEST_EMPTY"); !ok || value != "" {
		t.Fatalf("expected empty value to be set, got %q exists=%v", value, ok)
	}
}
