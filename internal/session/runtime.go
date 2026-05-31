package session

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"dior-agent/internal/model"
)

type Runtime struct {
	sessionID string
	ownerID   string
	store     *Store
	models    *model.Manager
	client    *model.Client
	mu        sync.Mutex
	running   *runningTurn
}

type runningTurn struct {
	turnID        string
	cancel        context.CancelFunc
	cancelEmitted bool
}

type RunTurnInput struct {
	TurnID       string
	ConnectionID string
	Input        string
	Metadata     map[string]any
}

type EventSink func(Event) error

func NewRuntime(sessionID string, ownerID string, store *Store, models *model.Manager, client *model.Client) *Runtime {
	return &Runtime{
		sessionID: sessionID,
		ownerID:   ownerID,
		store:     store,
		models:    models,
		client:    client,
	}
}

func (r *Runtime) RunTurn(ctx context.Context, input RunTurnInput, sink EventSink) error {
	r.mu.Lock()
	if r.running != nil {
		r.mu.Unlock()
		return fmt.Errorf("session already has a running turn: %s", r.sessionID)
	}
	turnCtx, cancel := context.WithCancel(ctx)
	r.running = &runningTurn{turnID: input.TurnID, cancel: cancel}
	r.mu.Unlock()
	defer func() {
		cancel()
		r.mu.Lock()
		r.running = nil
		r.mu.Unlock()
	}()

	startedAt := time.Now().UTC()
	snapshot := r.models.Snapshot()
	turnRecord := TurnRecord{
		SessionID: r.sessionID,
		TurnID:    input.TurnID,
		Status:    "running",
		Input:     input.Input,
		Metadata:  input.Metadata,
		Model:     TurnModel(snapshot),
		StartedAt: startedAt.Format(time.RFC3339Nano),
	}
	if err := r.store.WriteTurn(turnRecord); err != nil {
		return err
	}
	r.writeLog("info", "turn.started", map[string]any{
		"turnId":             input.TurnID,
		"connectionId":       input.ConnectionID,
		"modelProvider":      snapshot.Provider,
		"modelName":          snapshot.Resolved.ModelName,
		"modelConfigVersion": snapshot.Version,
	})

	startedEvent, err := r.store.AppendEvent(Event{
		Type:         "turn.started",
		SessionID:    r.sessionID,
		TurnID:       input.TurnID,
		Input:        input.Input,
		ConnectionID: input.ConnectionID,
		Metadata:     input.Metadata,
	})
	if err != nil {
		return err
	}
	if err := sink(startedEvent); err != nil {
		return err
	}

	history, err := r.readConversationHistory()
	if err != nil {
		return err
	}
	messages := prepareMessages(history, input.Input)
	output, err := r.client.Stream(turnCtx, snapshot, messages, func(delta string) error {
		event, appendErr := r.store.AppendEvent(Event{
			Type:      "assistant.delta",
			SessionID: r.sessionID,
			TurnID:    input.TurnID,
			Text:      delta,
		})
		if appendErr != nil {
			return appendErr
		}
		return sink(event)
	})
	if err != nil {
		return r.completeWithError(turnCtx, turnRecord, input.TurnID, startedAt, err, sink)
	}

	completedAt := nowString()
	turnRecord.Status = "completed"
	turnRecord.CompletedAt = completedAt
	if err := r.store.WriteTurn(turnRecord); err != nil {
		return err
	}
	r.writeLog("info", "turn.completed", map[string]any{
		"turnId":     input.TurnID,
		"durationMs": time.Since(startedAt).Milliseconds(),
	})

	messageEvent, err := r.store.AppendEvent(Event{
		Type:      "assistant.message",
		SessionID: r.sessionID,
		TurnID:    input.TurnID,
		Content:   output,
		Metadata: map[string]any{
			"runtime":            "llm",
			"connectionId":       input.ConnectionID,
			"sessionId":          r.sessionID,
			"turnId":             input.TurnID,
			"modelProvider":      snapshot.Provider,
			"modelName":          snapshot.Resolved.ModelName,
			"modelConfigVersion": snapshot.Version,
		},
	})
	if err != nil {
		return err
	}
	if err := sink(messageEvent); err != nil {
		return err
	}

	completedEvent, err := r.store.AppendEvent(Event{
		Type:      "turn.completed",
		SessionID: r.sessionID,
		TurnID:    input.TurnID,
		Output:    output,
		Metadata:  messageEvent.Metadata,
	})
	if err != nil {
		return err
	}
	return sink(completedEvent)
}

func (r *Runtime) CancelTurn(turnID string, reason string) (Event, error) {
	r.mu.Lock()
	running := r.running
	if running == nil || running.turnID != turnID {
		r.mu.Unlock()
		return Event{}, fmt.Errorf("session turn not found: %s", turnID)
	}
	running.cancelEmitted = true
	running.cancel()
	r.mu.Unlock()

	if reason == "" {
		reason = "cancelled"
	}
	r.writeLog("warn", "turn.cancel_requested", map[string]any{
		"turnId": turnID,
		"reason": reason,
	})
	return r.store.AppendEvent(Event{
		Type:      "turn.cancelled",
		SessionID: r.sessionID,
		TurnID:    turnID,
		Reason:    reason,
	})
}

func (r *Runtime) completeWithError(ctx context.Context, record TurnRecord, turnID string, startedAt time.Time, err error, sink EventSink) error {
	status := "failed"
	eventType := "turn.failed"
	message := err.Error()
	if errors.Is(ctx.Err(), context.Canceled) {
		status = "cancelled"
		eventType = "turn.cancelled"
		message = "cancelled"
	}
	record.Status = status
	record.CompletedAt = nowString()
	record.Error = message
	_ = r.store.WriteTurn(record)
	r.writeLog("warn", "turn."+status, map[string]any{
		"turnId":     turnID,
		"durationMs": time.Since(startedAt).Milliseconds(),
		"error":      message,
	})

	r.mu.Lock()
	cancelAlreadyEmitted := r.running != nil && r.running.cancelEmitted
	r.mu.Unlock()
	if eventType == "turn.cancelled" && cancelAlreadyEmitted {
		return nil
	}

	event := Event{
		Type:      eventType,
		SessionID: r.sessionID,
		TurnID:    turnID,
	}
	if eventType == "turn.failed" {
		event.Message = message
	} else {
		event.Reason = message
	}
	appended, appendErr := r.store.AppendEvent(event)
	if appendErr != nil {
		return appendErr
	}
	return sink(appended)
}

func (r *Runtime) readConversationHistory() ([]model.Message, error) {
	events, err := r.store.ReadEventsAfter(r.sessionID, 0)
	if err != nil {
		return nil, err
	}
	turnInputs := map[string]string{}
	messages := []model.Message{}
	for _, event := range events {
		if event.Type == "turn.started" {
			if input, ok := event.Input.(string); ok {
				turnInputs[event.TurnID] = input
			}
			continue
		}
		if event.Type != "assistant.message" {
			continue
		}
		input := turnInputs[event.TurnID]
		if input == "" {
			continue
		}
		messages = append(messages, model.Message{Role: "user", Content: input})
		messages = append(messages, model.Message{Role: "assistant", Content: event.Content})
		delete(turnInputs, event.TurnID)
	}
	return messages, nil
}

func (r *Runtime) writeLog(level string, message string, fields map[string]any) {
	_ = r.store.AppendLog(LogRecord{
		SessionID: r.sessionID,
		Time:      nowString(),
		Level:     level,
		Message:   message,
		Fields:    fields,
	})
}

func prepareMessages(history []model.Message, input string) []model.Message {
	messages := []model.Message{
		{
			Role:    "system",
			Content: "You are Dior Agent, a private websocket agent service. Keep responses direct, useful, and grounded in the current session context.",
		},
	}
	messages = append(messages, history...)
	messages = append(messages, model.Message{Role: "user", Content: input})
	if len(messages) <= 40 {
		return messages
	}
	return append(messages[:1], messages[len(messages)-39:]...)
}
