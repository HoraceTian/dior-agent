package session

import (
	"time"

	"dior-agent/internal/model"
)

type Event struct {
	Type         string         `json:"type"`
	Seq          int            `json:"seq"`
	SessionID    string         `json:"sessionId"`
	CreatedAt    string         `json:"createdAt"`
	OwnerID      string         `json:"ownerId,omitempty"`
	TurnID       string         `json:"turnId,omitempty"`
	Input        any            `json:"input,omitempty"`
	ConnectionID string         `json:"connectionId,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	Text         string         `json:"text,omitempty"`
	Content      string         `json:"content,omitempty"`
	Output       string         `json:"output,omitempty"`
	Message      string         `json:"message,omitempty"`
	Reason       string         `json:"reason,omitempty"`
	ToolUseID    string         `json:"toolUseId,omitempty"`
	Name         string         `json:"name,omitempty"`
	ResultRef    string         `json:"resultRef,omitempty"`
	IsError      *bool          `json:"isError,omitempty"`
}

type Manifest struct {
	SessionID     string `json:"sessionId"`
	OwnerID       string `json:"ownerId"`
	WorkspacePath string `json:"workspacePath"`
	Status        string `json:"status"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type State struct {
	SessionID    string `json:"sessionId"`
	OwnerID      string `json:"ownerId"`
	Status       string `json:"status"`
	LatestSeq    int    `json:"latestSeq"`
	ActiveTurnID string `json:"activeTurnId,omitempty"`
	UpdatedAt    string `json:"updatedAt"`
}

type Lease struct {
	SessionID   string `json:"sessionId"`
	HolderID    string `json:"holderId"`
	AcquiredAt  string `json:"acquiredAt"`
	HeartbeatAt string `json:"heartbeatAt"`
	TTLMs       int    `json:"ttlMs"`
}

type StoredSession struct {
	Manifest Manifest
	State    State
}

type TurnModelRecord struct {
	ConfigVersion int            `json:"configVersion"`
	Provider      model.Provider `json:"provider"`
	BaseURL       string         `json:"baseUrl"`
	ModelName     string         `json:"modelName"`
	APIKeyEnv     string         `json:"apiKeyEnv,omitempty"`
}

type TurnRecord struct {
	SessionID   string          `json:"sessionId"`
	TurnID      string          `json:"turnId"`
	Status      string          `json:"status"`
	Input       string          `json:"input"`
	Metadata    map[string]any  `json:"metadata,omitempty"`
	Model       TurnModelRecord `json:"model"`
	StartedAt   string          `json:"startedAt"`
	CompletedAt string          `json:"completedAt,omitempty"`
	Error       string          `json:"error,omitempty"`
}

type LogRecord struct {
	SessionID string         `json:"sessionId"`
	Time      string         `json:"time"`
	Level     string         `json:"level"`
	Message   string         `json:"message"`
	Fields    map[string]any `json:"fields,omitempty"`
}

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func TurnModel(snapshot model.Snapshot) TurnModelRecord {
	return TurnModelRecord{
		ConfigVersion: snapshot.Version,
		Provider:      snapshot.Provider,
		BaseURL:       snapshot.Resolved.BaseURL,
		ModelName:     snapshot.Resolved.ModelName,
		APIKeyEnv:     snapshot.Resolved.APIKeyEnv,
	}
}
