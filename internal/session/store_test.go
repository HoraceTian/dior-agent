package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStorePersistsAndReplaysSessionEvents(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	stored, err := store.CreateSession("sess_test", "owner", "2026-05-31T00:00:00Z")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if stored.Manifest.WorkspacePath != filepath.Join(root, "sessions", "sess_test", "workspace") {
		t.Fatalf("unexpected workspace path: %s", stored.Manifest.WorkspacePath)
	}

	if _, err := store.AppendEvent(Event{
		Type:      "session.created",
		SessionID: "sess_test",
		OwnerID:   "owner",
	}); err != nil {
		t.Fatalf("append session event: %v", err)
	}
	if _, err := store.AppendEvent(Event{
		Type:      "turn.started",
		SessionID: "sess_test",
		TurnID:    "turn_test",
		Input:     "hello",
	}); err != nil {
		t.Fatalf("append turn event: %v", err)
	}

	events, err := store.ReadEventsAfter("sess_test", 1)
	if err != nil {
		t.Fatalf("read events: %v", err)
	}
	if len(events) != 1 || events[0].Type != "turn.started" {
		t.Fatalf("unexpected events: %#v", events)
	}
	if _, err := os.Stat(filepath.Join(root, "sessions", "sess_test", "events.jsonl")); err != nil {
		t.Fatalf("events log missing: %v", err)
	}
}
