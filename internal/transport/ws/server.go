package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"dior-agent/internal/app"
	"dior-agent/internal/collector"
	"dior-agent/internal/logging"
	"dior-agent/internal/session"
)

type Server struct {
	Config     app.Config
	Logger     logging.Logger
	Sessions   *session.Supervisor
	Collectors *collector.Registry
	upgrader   websocket.Upgrader
}

func NewServer(config app.Config, logger logging.Logger, sessions *session.Supervisor, collectors *collector.Registry) *Server {
	return &Server{
		Config:     config,
		Logger:     logger,
		Sessions:   sessions,
		Collectors: collectors,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return originAllowed(r, config)
			},
		},
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.root)
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/ready", s.ready)
	mux.HandleFunc("/ws", s.websocket)
	return mux
}

func (s *Server) root(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service": s.Config.ServiceName,
		"transport": map[string]any{
			"websocket": "/ws",
			"health":    "/health",
			"ready":     "/ready",
		},
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": s.Config.ServiceName,
		"time":    time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ready",
		"service":    s.Config.ServiceName,
		"websocket":  "/ws",
		"collectors": s.Collectors.Count(),
	})
}

func (s *Server) websocket(w http.ResponseWriter, r *http.Request) {
	principalID, ok := authenticate(r, s.Config)
	if !ok {
		s.Logger.Warn("Rejected unauthorized websocket upgrade", map[string]any{"reason": "missing_or_invalid_credentials"})
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.Logger.Warn("Websocket upgrade failed", map[string]any{"error": err.Error()})
		return
	}
	session := &socketSession{
		server:             s,
		conn:               conn,
		principalID:        principalID,
		connectionID:       newConnectionID(),
		attachedSessionIDs: map[string]bool{},
		runningCancels:     map[string]context.CancelFunc{},
	}
	session.run()
}

type socketSession struct {
	server             *Server
	conn               *websocket.Conn
	principalID        string
	connectionID       string
	attachedSessionIDs map[string]bool
	runningCancels     map[string]context.CancelFunc
	mu                 sync.Mutex
	writeMu            sync.Mutex
}

func (s *socketSession) run() {
	defer s.conn.Close()
	s.conn.SetReadLimit(s.server.Config.MaxMessageBytes)
	_ = s.send(ServerMessage{
		Type:            "connection.ready",
		ConnectionID:    s.connectionID,
		ServerTime:      time.Now().UTC().Format(time.RFC3339Nano),
		MaxMessageBytes: s.server.Config.MaxMessageBytes,
	})
	for {
		_, data, err := s.conn.ReadMessage()
		if err != nil {
			return
		}
		var message ClientMessage
		if err := json.Unmarshal(data, &message); err != nil {
			_ = s.sendError("invalid_json", "Invalid JSON message.", "")
			continue
		}
		s.handle(message)
	}
}

func (s *socketSession) handle(message ClientMessage) {
	switch message.Type {
	case "ping":
		_ = s.send(ServerMessage{Type: "pong", ID: message.ID, ServerTime: time.Now().UTC().Format(time.RFC3339Nano)})
	case "session.create":
		s.handleCreate(message)
	case "session.attach":
		s.handleAttach(message)
	case "turn.start":
		s.handleTurnStart(message)
	case "turn.cancel":
		s.handleTurnCancel(message)
	default:
		_ = s.sendError("invalid_message", "Unsupported message type.", message.ID)
	}
}

func (s *socketSession) handleCreate(message ClientMessage) {
	ready, err := s.server.Sessions.CreateSession(s.principalID)
	if err != nil {
		_ = s.sendError("agent_error", err.Error(), message.ID)
		return
	}
	s.attachedSessionIDs[ready.SessionID] = true
	_ = s.send(ServerMessage{Type: "session.ready", ID: message.ID, SessionID: ready.SessionID, LastSeq: ready.LastSeq, ReplayedEvents: len(ready.Events)})
	for _, event := range ready.Events {
		eventCopy := event
		_ = s.send(ServerMessage{Type: "session.event", Event: &eventCopy})
	}
}

func (s *socketSession) handleAttach(message ClientMessage) {
	ready, err := s.server.Sessions.AttachSession(message.SessionID, s.principalID, message.LastSeq)
	if err != nil {
		_ = s.sendError(errorCode(err), err.Error(), message.ID)
		return
	}
	s.attachedSessionIDs[ready.SessionID] = true
	_ = s.send(ServerMessage{Type: "session.ready", ID: message.ID, SessionID: ready.SessionID, LastSeq: ready.LastSeq, ReplayedEvents: len(ready.Events)})
	for _, event := range ready.Events {
		eventCopy := event
		_ = s.send(ServerMessage{Type: "session.event", Event: &eventCopy})
	}
}

func (s *socketSession) handleTurnStart(message ClientMessage) {
	if !s.attachedSessionIDs[message.SessionID] {
		_ = s.sendError("session_not_attached", "Attach the session before starting a turn.", message.ID)
		return
	}
	if strings.TrimSpace(message.Input) == "" || message.ID == "" {
		_ = s.sendError("invalid_message", "turn.start requires id and input.", message.ID)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.runningCancels[message.ID] = cancel
	s.mu.Unlock()
	_ = s.send(ServerMessage{Type: "turn.accepted", ID: message.ID, SessionID: message.SessionID, TurnID: message.ID})
	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.runningCancels, message.ID)
			s.mu.Unlock()
			cancel()
		}()
		err := s.server.Sessions.RunTurn(ctx, message.SessionID, s.principalID, session.RunTurnInput{
			TurnID:       message.ID,
			ConnectionID: s.connectionID,
			Input:        strings.TrimSpace(message.Input),
			Metadata:     message.Metadata,
		}, func(event session.Event) error {
			eventCopy := event
			return s.send(ServerMessage{Type: "session.event", Event: &eventCopy})
		})
		if err != nil {
			_ = s.sendError(errorCode(err), err.Error(), message.ID)
		}
	}()
}

func (s *socketSession) handleTurnCancel(message ClientMessage) {
	if !s.attachedSessionIDs[message.SessionID] {
		_ = s.sendError("session_not_attached", "Attach the session before cancelling a turn.", message.ID)
		return
	}
	s.mu.Lock()
	cancel := s.runningCancels[message.TurnID]
	if cancel != nil {
		cancel()
	}
	s.mu.Unlock()
	event, err := s.server.Sessions.CancelTurn(message.SessionID, s.principalID, message.TurnID, message.Reason)
	if err != nil {
		_ = s.sendError(errorCode(err), err.Error(), message.ID)
		return
	}
	_ = s.send(ServerMessage{Type: "session.event", Event: &event})
}

func (s *socketSession) send(message ServerMessage) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteJSON(message)
}

func (s *socketSession) sendError(code string, message string, id string) error {
	return s.send(ServerMessage{Type: "error", ID: id, Code: code, Message: message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func errorCode(err error) string {
	message := err.Error()
	switch {
	case strings.Contains(message, "turn not found"):
		return "turn_not_found"
	case strings.Contains(message, "not found"):
		return "session_not_found"
	case strings.Contains(message, "owner mismatch"):
		return "forbidden"
	case strings.Contains(message, "lease"):
		return "lease_conflict"
	case strings.Contains(message, "running turn"):
		return "turn_in_progress"
	default:
		return "agent_error"
	}
}

func newConnectionID() string {
	return fmt.Sprintf("conn_%d", time.Now().UnixNano())
}
