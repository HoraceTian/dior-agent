package collectorapp

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

const ProtocolVersion = "2026-05-collector-v1"

type Manifest struct {
	CollectorID     string           `json:"collectorId"`
	DisplayName     string           `json:"displayName"`
	Description     string           `json:"description"`
	ProtocolVersion string           `json:"protocolVersion"`
	Version         string           `json:"version"`
	PublicURL       string           `json:"publicUrl"`
	Tools           []ToolDescriptor `json:"tools"`
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

type InvocationRequest struct {
	InvocationID string         `json:"invocationId"`
	SessionID    string         `json:"sessionId"`
	TurnID       string         `json:"turnId"`
	Input        map[string]any `json:"input"`
	DeadlineMs   int            `json:"deadlineMs"`
}

type InvocationResponse struct {
	InvocationID string `json:"invocationId"`
	Status       string `json:"status"`
	Content      string `json:"content,omitempty"`
	Structured   any    `json:"structured,omitempty"`
	ResultRef    string `json:"resultRef,omitempty"`
	IsError      bool   `json:"isError"`
}

type Server struct {
	config Config
	token  string
}

func NewServer(config Config) (*Server, error) {
	token, err := config.AuthToken()
	if err != nil {
		return nil, err
	}
	return &Server{config: config, token: token}, nil
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/v1/manifest", s.manifest)
	mux.HandleFunc("/v1/tools/", s.invoke)
	return mux
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":          "ok",
		"collectorId":     s.config.Collector.ID,
		"protocolVersion": ProtocolVersion,
	})
}

func (s *Server) manifest(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"message": "collector token is missing or invalid"})
		return
	}
	writeJSON(w, http.StatusOK, s.manifestPayload())
}

func (s *Server) invoke(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"message": "collector token is missing or invalid"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"message": "method not allowed"})
		return
	}
	toolName := strings.TrimPrefix(r.URL.Path, "/v1/tools/")
	toolName = strings.TrimSuffix(toolName, "/invoke")
	if toolName != "system.info" || !s.toolEnabled(toolName) {
		writeJSON(w, http.StatusNotFound, map[string]any{"message": "tool not found: " + toolName})
		return
	}
	var request InvocationRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"message": "invalid invocation request"})
		return
	}
	writeJSON(w, http.StatusOK, s.systemInfo(request))
}

func (s *Server) manifestPayload() Manifest {
	return Manifest{
		CollectorID:     s.config.Collector.ID,
		DisplayName:     s.config.Collector.Name,
		Description:     s.config.Collector.Description,
		ProtocolVersion: ProtocolVersion,
		Version:         "0.1.0",
		PublicURL:       s.config.Collector.PublicURL,
		Tools:           s.tools(),
	}
}

func (s *Server) tools() []ToolDescriptor {
	if !s.toolEnabled("system.info") {
		return nil
	}
	return []ToolDescriptor{
		{
			Name:        "system.info",
			Description: "Return read-only runtime and host context for this collector.",
			InputSchema: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
			},
			OutputSchema: map[string]any{
				"type": "object",
			},
			Scopes:         []string{"system:read"},
			SideEffects:    "read-only",
			TimeoutMs:      valueOrDefault(s.config.Collector.DefaultTimeoutMs, 10_000),
			MaxResultBytes: valueOrDefault(s.config.Collector.MaxResultBytes, 65_536),
		},
	}
}

func (s *Server) systemInfo(request InvocationRequest) InvocationResponse {
	cwd, _ := os.Getwd()
	hostname, _ := os.Hostname()
	structured := map[string]any{
		"collectorId":          s.config.Collector.ID,
		"collectorName":        s.config.Collector.Name,
		"collectorDescription": s.config.Collector.Description,
		"sessionId":            request.SessionID,
		"turnId":               request.TurnID,
		"os":                   runtime.GOOS,
		"arch":                 runtime.GOARCH,
		"pid":                  os.Getpid(),
		"hostname":             hostname,
		"currentDir":           cwd,
		"deadlineMs":           request.DeadlineMs,
		"input":                request.Input,
	}
	return InvocationResponse{
		InvocationID: request.InvocationID,
		Status:       "ok",
		Content: fmt.Sprintf(
			"collector=%s name=%s os=%s arch=%s pid=%d",
			s.config.Collector.ID,
			s.config.Collector.Name,
			runtime.GOOS,
			runtime.GOARCH,
			os.Getpid(),
		),
		Structured: structured,
	}
}

func (s *Server) toolEnabled(name string) bool {
	if len(s.config.Tools.Enabled) == 0 {
		return true
	}
	for _, enabled := range s.config.Tools.Enabled {
		if enabled == name {
			return true
		}
	}
	return false
}

func (s *Server) authorized(r *http.Request) bool {
	credential := bearerToken(r.Header.Get("authorization"))
	if credential == "" {
		credential = strings.TrimSpace(r.Header.Get("x-collector-token"))
	}
	if credential == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(credential), []byte(s.token)) == 1
}

func bearerToken(value string) string {
	if strings.HasPrefix(value, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func valueOrDefault(value int, fallback int) int {
	if value == 0 {
		return fallback
	}
	return value
}

func LogStarted(bind string) {
	line, _ := json.Marshal(map[string]any{
		"time":    time.Now().UTC().Format(time.RFC3339Nano),
		"level":   "info",
		"message": "Dior collector started",
		"bind":    bind,
	})
	fmt.Println(string(line))
}
