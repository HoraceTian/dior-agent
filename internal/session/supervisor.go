package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
	"time"

	"dior-agent/internal/logging"
	"dior-agent/internal/model"
)

type Supervisor struct {
	holderID   string
	store      *Store
	models     *model.Manager
	client     *model.Client
	logger     logging.Logger
	runtimes   map[string]*Runtime
	leaseTTLMs int
	mu         sync.Mutex
}

type Ready struct {
	SessionID string
	LastSeq   int
	Events    []Event
}

func NewSupervisor(holderID string, store *Store, models *model.Manager, client *model.Client, logger logging.Logger) *Supervisor {
	return &Supervisor{
		holderID:   holderID,
		store:      store,
		models:     models,
		client:     client,
		logger:     logger,
		runtimes:   map[string]*Runtime{},
		leaseTTLMs: 30_000,
	}
}

func (s *Supervisor) CreateSession(ownerID string) (Ready, error) {
	sessionID := newID("sess")
	now := nowString()
	stored, err := s.store.CreateSession(sessionID, ownerID, now)
	if err != nil {
		return Ready{}, err
	}
	if _, err := s.acquireLease(sessionID); err != nil {
		return Ready{}, err
	}
	runtime := s.createRuntime(stored)
	s.mu.Lock()
	s.runtimes[sessionID] = runtime
	s.mu.Unlock()

	event, err := s.store.AppendEvent(Event{
		Type:      "session.created",
		SessionID: sessionID,
		OwnerID:   ownerID,
	})
	if err != nil {
		return Ready{}, err
	}
	return Ready{SessionID: sessionID, LastSeq: event.Seq, Events: []Event{event}}, nil
}

func (s *Supervisor) AttachSession(sessionID string, ownerID string, lastSeq int) (Ready, error) {
	if _, err := s.getOrLoadRuntime(sessionID, ownerID); err != nil {
		return Ready{}, err
	}
	stored, err := s.store.LoadSession(sessionID)
	if err != nil {
		return Ready{}, err
	}
	events, err := s.store.ReadEventsAfter(sessionID, lastSeq)
	if err != nil {
		return Ready{}, err
	}
	latest := stored.State.LatestSeq
	if len(events) > 0 {
		latest = events[len(events)-1].Seq
	}
	return Ready{SessionID: sessionID, LastSeq: latest, Events: events}, nil
}

func (s *Supervisor) RunTurn(ctx context.Context, sessionID string, ownerID string, input RunTurnInput, sink EventSink) error {
	runtime, err := s.getOrLoadRuntime(sessionID, ownerID)
	if err != nil {
		return err
	}
	if _, err := s.acquireLease(sessionID); err != nil {
		return err
	}
	return runtime.RunTurn(ctx, input, sink)
}

func (s *Supervisor) CancelTurn(sessionID string, ownerID string, turnID string, reason string) (Event, error) {
	runtime, err := s.getOrLoadRuntime(sessionID, ownerID)
	if err != nil {
		return Event{}, err
	}
	if _, err := s.acquireLease(sessionID); err != nil {
		return Event{}, err
	}
	return runtime.CancelTurn(turnID, reason)
}

func (s *Supervisor) getOrLoadRuntime(sessionID string, ownerID string) (*Runtime, error) {
	s.mu.Lock()
	existing := s.runtimes[sessionID]
	s.mu.Unlock()
	if existing != nil {
		stored, err := s.store.LoadSession(sessionID)
		if err != nil {
			return nil, err
		}
		if stored.Manifest.OwnerID != ownerID {
			return nil, fmt.Errorf("session owner mismatch: %s", sessionID)
		}
		return existing, nil
	}

	stored, err := s.store.LoadSession(sessionID)
	if err != nil {
		return nil, err
	}
	if stored.Manifest.OwnerID != ownerID {
		return nil, fmt.Errorf("session owner mismatch: %s", sessionID)
	}
	if _, err := s.acquireLease(sessionID); err != nil {
		return nil, err
	}
	runtime := s.createRuntime(stored)
	s.mu.Lock()
	s.runtimes[sessionID] = runtime
	s.mu.Unlock()
	s.logger.Info("Session runtime loaded", map[string]any{"sessionId": sessionID, "ownerId": ownerID})
	return runtime, nil
}

func (s *Supervisor) createRuntime(stored StoredSession) *Runtime {
	return NewRuntime(stored.Manifest.SessionID, stored.Manifest.OwnerID, s.store, s.models, s.client)
}

func (s *Supervisor) acquireLease(sessionID string) (Lease, error) {
	return s.store.AcquireLease(sessionID, s.holderID, s.leaseTTLMs, nowString())
}

func NewHolderID(serviceName string) string {
	return fmt.Sprintf("%s:%d:%s", serviceName, time.Now().UnixNano(), newID("holder"))
}

func newID(prefix string) string {
	var bytes [18]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(bytes[:])
}
