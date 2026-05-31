package ws

import "dior-agent/internal/session"

type ClientMessage struct {
	Type      string         `json:"type"`
	ID        string         `json:"id,omitempty"`
	SessionID string         `json:"sessionId,omitempty"`
	LastSeq   int            `json:"lastSeq,omitempty"`
	Input     string         `json:"input,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	TurnID    string         `json:"turnId,omitempty"`
	Reason    string         `json:"reason,omitempty"`
}

type ServerMessage struct {
	Type            string         `json:"type"`
	ID              string         `json:"id,omitempty"`
	ConnectionID    string         `json:"connectionId,omitempty"`
	ServerTime      string         `json:"serverTime,omitempty"`
	MaxMessageBytes int64          `json:"maxMessageBytes,omitempty"`
	SessionID       string         `json:"sessionId,omitempty"`
	LastSeq         int            `json:"lastSeq,omitempty"`
	ReplayedEvents  int            `json:"replayedEvents,omitempty"`
	Event           *session.Event `json:"event,omitempty"`
	TurnID          string         `json:"turnId,omitempty"`
	Code            string         `json:"code,omitempty"`
	Message         string         `json:"message,omitempty"`
}
