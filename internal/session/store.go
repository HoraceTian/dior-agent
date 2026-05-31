package session

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

var safeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type Store struct {
	workspaceRoot string
	mu            sync.Mutex
}

func NewStore(workspaceRoot string) *Store {
	return &Store{workspaceRoot: workspaceRoot}
}

func (s *Store) CreateSession(sessionID string, ownerID string, now string) (StoredSession, error) {
	if err := assertSafeID(sessionID); err != nil {
		return StoredSession{}, err
	}
	directory := s.SessionDirectory(sessionID)
	workspacePath := s.SessionWorkspaceDirectory(sessionID)
	for _, path := range []string{
		directory,
		filepath.Join(directory, "snapshots"),
		filepath.Join(directory, "turns"),
		filepath.Join(directory, "objects", "attachments"),
		filepath.Join(directory, "objects", "tool-results"),
		filepath.Join(directory, "logs"),
		workspacePath,
	} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			return StoredSession{}, err
		}
	}

	manifest := Manifest{
		SessionID:     sessionID,
		OwnerID:       ownerID,
		WorkspacePath: workspacePath,
		Status:        "active",
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	state := State{
		SessionID: sessionID,
		OwnerID:   ownerID,
		Status:    "active",
		LatestSeq: 0,
		UpdatedAt: now,
	}

	if err := writeJSONAtomic(s.manifestPath(sessionID), manifest); err != nil {
		return StoredSession{}, err
	}
	if err := writeJSONAtomic(s.statePath(sessionID), state); err != nil {
		return StoredSession{}, err
	}
	file, err := os.OpenFile(s.eventsPath(sessionID), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return StoredSession{}, err
	}
	_ = file.Close()
	return StoredSession{Manifest: manifest, State: state}, nil
}

func (s *Store) LoadSession(sessionID string) (StoredSession, error) {
	if err := assertSafeID(sessionID); err != nil {
		return StoredSession{}, err
	}
	var manifest Manifest
	if err := readJSON(s.manifestPath(sessionID), &manifest); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return StoredSession{}, fmt.Errorf("session not found: %s", sessionID)
		}
		return StoredSession{}, err
	}
	var state State
	if err := readJSON(s.statePath(sessionID), &state); err != nil {
		return StoredSession{}, err
	}
	return StoredSession{Manifest: manifest, State: state}, nil
}

func (s *Store) AcquireLease(sessionID string, holderID string, ttlMs int, now string) (Lease, error) {
	if _, err := s.LoadSession(sessionID); err != nil {
		return Lease{}, err
	}
	existing := Lease{}
	hasExisting := readJSON(s.leasePath(sessionID), &existing) == nil
	if hasExisting && existing.HolderID != holderID && !leaseExpired(existing, now) {
		return Lease{}, fmt.Errorf("session lease is held by another runtime: %s", sessionID)
	}
	acquiredAt := now
	if hasExisting && existing.HolderID == holderID {
		acquiredAt = existing.AcquiredAt
	}
	lease := Lease{
		SessionID:   sessionID,
		HolderID:    holderID,
		AcquiredAt:  acquiredAt,
		HeartbeatAt: now,
		TTLMs:       ttlMs,
	}
	return lease, writeJSONAtomic(s.leasePath(sessionID), lease)
}

func (s *Store) AppendEvent(event Event) (Event, error) {
	if err := assertSafeID(event.SessionID); err != nil {
		return Event{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	stored, err := s.LoadSession(event.SessionID)
	if err != nil {
		return Event{}, err
	}
	createdAt := nowString()
	event.Seq = stored.State.LatestSeq + 1
	event.CreatedAt = createdAt

	file, err := os.OpenFile(s.eventsPath(event.SessionID), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return Event{}, err
	}
	encoded, err := json.Marshal(event)
	if err == nil {
		_, err = file.Write(append(encoded, '\n'))
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return Event{}, err
	}

	stored.State.LatestSeq = event.Seq
	stored.State.UpdatedAt = createdAt
	switch event.Type {
	case "turn.started":
		stored.State.ActiveTurnID = event.TurnID
	case "turn.completed", "turn.failed", "turn.cancelled":
		if stored.State.ActiveTurnID == event.TurnID {
			stored.State.ActiveTurnID = ""
		}
	}
	stored.Manifest.UpdatedAt = createdAt
	if err := writeJSONAtomic(s.statePath(event.SessionID), stored.State); err != nil {
		return Event{}, err
	}
	if err := writeJSONAtomic(s.manifestPath(event.SessionID), stored.Manifest); err != nil {
		return Event{}, err
	}
	return event, nil
}

func (s *Store) ReadEventsAfter(sessionID string, lastSeq int) ([]Event, error) {
	if _, err := s.LoadSession(sessionID); err != nil {
		return nil, err
	}
	file, err := os.Open(s.eventsPath(sessionID))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()

	events := []Event{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		var event Event
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return nil, err
		}
		if event.Seq > lastSeq {
			events = append(events, event)
		}
	}
	return events, scanner.Err()
}

func (s *Store) WriteTurn(record TurnRecord) error {
	if err := assertSafeID(record.SessionID); err != nil {
		return err
	}
	if err := assertSafeID(record.TurnID); err != nil {
		return err
	}
	if _, err := s.LoadSession(record.SessionID); err != nil {
		return err
	}
	return writeJSONAtomic(s.turnPath(record.SessionID, record.TurnID), record)
}

func (s *Store) AppendLog(record LogRecord) error {
	if _, err := s.LoadSession(record.SessionID); err != nil {
		return err
	}
	file, err := os.OpenFile(s.runtimeLogPath(record.SessionID), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(record)
	if err == nil {
		_, err = file.Write(append(encoded, '\n'))
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err
}

func (s *Store) SessionDirectory(sessionID string) string {
	return filepath.Join(s.workspaceRoot, "sessions", sessionID)
}

func (s *Store) SessionWorkspaceDirectory(sessionID string) string {
	return filepath.Join(s.SessionDirectory(sessionID), "workspace")
}

func (s *Store) manifestPath(sessionID string) string {
	return filepath.Join(s.SessionDirectory(sessionID), "manifest.json")
}

func (s *Store) statePath(sessionID string) string {
	return filepath.Join(s.SessionDirectory(sessionID), "state.json")
}

func (s *Store) leasePath(sessionID string) string {
	return filepath.Join(s.SessionDirectory(sessionID), "lease.json")
}

func (s *Store) eventsPath(sessionID string) string {
	return filepath.Join(s.SessionDirectory(sessionID), "events.jsonl")
}

func (s *Store) turnPath(sessionID string, turnID string) string {
	return filepath.Join(s.SessionDirectory(sessionID), "turns", turnID+".json")
}

func (s *Store) runtimeLogPath(sessionID string) string {
	return filepath.Join(s.SessionDirectory(sessionID), "logs", "runtime.log")
}

func leaseExpired(lease Lease, now string) bool {
	heartbeat, err := time.Parse(time.RFC3339Nano, lease.HeartbeatAt)
	if err != nil {
		return true
	}
	current, err := time.Parse(time.RFC3339Nano, now)
	if err != nil {
		current = time.Now().UTC()
	}
	return current.Sub(heartbeat) > time.Duration(lease.TTLMs)*time.Millisecond
}

func assertSafeID(value string) error {
	if !safeIDPattern.MatchString(value) {
		return fmt.Errorf("unsafe id: %s", value)
	}
	return nil
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func writeJSONAtomic(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "    ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
