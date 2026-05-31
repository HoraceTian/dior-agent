package model

import (
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pelletier/go-toml/v2"

	"dior-agent/internal/logging"
)

type Provider string

const (
	ProviderOllama Provider = "ollama"
	ProviderOpenAI Provider = "openai"
)

type RawConfig struct {
	LLMProvider     string `toml:"llm_provider"`
	OllamaBaseURL   string `toml:"ollama_base_url"`
	OllamaModelName string `toml:"ollama_model_name"`
	OpenAIAPIKeyEnv string `toml:"openai_api_key_env"`
	OpenAIBaseURL   string `toml:"openai_base_url"`
	OpenAIModelName string `toml:"openai_model_name"`
}

type ResolvedConfig struct {
	Provider  Provider
	BaseURL   string
	ModelName string
	APIKeyEnv string
}

type Snapshot struct {
	Version    int
	LoadedAt   time.Time
	SourcePath string
	Provider   Provider
	Resolved   ResolvedConfig
}

type Manager struct {
	path    string
	watch   bool
	logger  logging.Logger
	mu      sync.RWMutex
	current Snapshot
	version int
	stopCh  chan struct{}
}

func NewManager(path string, watch bool, logger logging.Logger) *Manager {
	return &Manager{
		path:    path,
		watch:   watch,
		logger:  logger,
		current: DefaultSnapshot(path),
		version: 1,
		stopCh:  make(chan struct{}),
	}
}

func DefaultSnapshot(path string) Snapshot {
	raw := defaultRawConfig()
	return Snapshot{
		Version:    0,
		LoadedAt:   time.Unix(0, 0).UTC(),
		SourcePath: path,
		Provider:   Provider(raw.LLMProvider),
		Resolved:   resolve(raw),
	}
}

func (m *Manager) Start() {
	m.reload("initial")
	if m.watch {
		go m.watchLoop()
	}
}

func (m *Manager) Stop() {
	close(m.stopCh)
}

func (m *Manager) Snapshot() Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.current
}

func (m *Manager) reload(reason string) {
	text, err := os.ReadFile(m.path)
	if err != nil {
		m.logger.Warn("Model config reload failed; keeping previous snapshot", map[string]any{
			"reason": reason,
			"path":   m.path,
			"error":  err.Error(),
		})
		return
	}

	raw := defaultRawConfig()
	if err := toml.Unmarshal(text, &raw); err != nil {
		m.logger.Warn("Model config TOML invalid; keeping previous snapshot", map[string]any{
			"reason": reason,
			"path":   m.path,
			"error":  err.Error(),
		})
		return
	}
	normalizeRaw(&raw)
	snapshot := Snapshot{
		Version:    m.version,
		LoadedAt:   time.Now().UTC(),
		SourcePath: m.path,
		Provider:   Provider(raw.LLMProvider),
		Resolved:   resolve(raw),
	}
	m.version++

	m.mu.Lock()
	m.current = snapshot
	m.mu.Unlock()

	m.logger.Info("Model config loaded", map[string]any{
		"reason":    reason,
		"path":      m.path,
		"version":   snapshot.Version,
		"provider":  snapshot.Provider,
		"modelName": snapshot.Resolved.ModelName,
	})
}

func (m *Manager) watchLoop() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	var lastMod time.Time
	for {
		select {
		case <-m.stopCh:
			return
		case <-ticker.C:
			info, err := os.Stat(m.path)
			if err != nil {
				continue
			}
			if info.ModTime().After(lastMod) {
				lastMod = info.ModTime()
				m.reload("watch")
			}
		}
	}
}

func defaultRawConfig() RawConfig {
	return RawConfig{
		LLMProvider:     "ollama",
		OllamaBaseURL:   "http://localhost:11434",
		OllamaModelName: "deepseek-r1:70b",
		OpenAIAPIKeyEnv: "OPENAI_API_KEY",
		OpenAIBaseURL:   "https://api.openai.com/v1",
		OpenAIModelName: "gpt-4.1-mini",
	}
}

func normalizeRaw(raw *RawConfig) {
	defaults := defaultRawConfig()
	raw.LLMProvider = valueOrDefault(raw.LLMProvider, defaults.LLMProvider)
	raw.OllamaBaseURL = valueOrDefault(raw.OllamaBaseURL, defaults.OllamaBaseURL)
	raw.OllamaModelName = valueOrDefault(raw.OllamaModelName, defaults.OllamaModelName)
	raw.OpenAIAPIKeyEnv = valueOrDefault(raw.OpenAIAPIKeyEnv, defaults.OpenAIAPIKeyEnv)
	raw.OpenAIBaseURL = valueOrDefault(raw.OpenAIBaseURL, defaults.OpenAIBaseURL)
	raw.OpenAIModelName = valueOrDefault(raw.OpenAIModelName, defaults.OpenAIModelName)
	if raw.LLMProvider != string(ProviderOpenAI) {
		raw.LLMProvider = string(ProviderOllama)
	}
}

func resolve(raw RawConfig) ResolvedConfig {
	if raw.LLMProvider == string(ProviderOpenAI) {
		return ResolvedConfig{
			Provider:  ProviderOpenAI,
			BaseURL:   raw.OpenAIBaseURL,
			ModelName: raw.OpenAIModelName,
			APIKeyEnv: raw.OpenAIAPIKeyEnv,
		}
	}
	return ResolvedConfig{
		Provider:  ProviderOllama,
		BaseURL:   raw.OllamaBaseURL,
		ModelName: raw.OllamaModelName,
	}
}

func valueOrDefault(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
