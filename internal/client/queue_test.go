package client

import (
	"fmt"
	"path/filepath"
	"testing"
)

func newTestQueue(t *testing.T) *Queue {
	t.Helper()
	dir := t.TempDir()
	q, err := NewQueue(filepath.Join(dir, "queue.db"))
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	t.Cleanup(func() { q.Close() })
	return q
}

func TestQueuePushAndPop(t *testing.T) {
	q := newTestQueue(t)

	for i := 0; i < 5; i++ {
		payload := []byte(fmt.Sprintf(`{"n":%d}`, i))
		if err := q.Push("test_event", payload); err != nil {
			t.Fatalf("Push %d: %v", i, err)
		}
	}

	entries, err := q.PopUnsynced(10)
	if err != nil {
		t.Fatalf("PopUnsynced: %v", err)
	}
	if len(entries) != 5 {
		t.Errorf("got %d entries, want 5", len(entries))
	}
}

func TestQueueMarkSynced(t *testing.T) {
	q := newTestQueue(t)

	for i := 0; i < 5; i++ {
		if err := q.Push("test_event", []byte(`{}`)); err != nil {
			t.Fatalf("Push: %v", err)
		}
	}

	all, err := q.PopUnsynced(10)
	if err != nil {
		t.Fatalf("PopUnsynced: %v", err)
	}
	if len(all) != 5 {
		t.Fatalf("expected 5, got %d", len(all))
	}

	// Mark first 3 as synced.
	ids := make([]int64, 3)
	for i := 0; i < 3; i++ {
		ids[i] = all[i].ID
	}
	if err := q.MarkSynced(ids); err != nil {
		t.Fatalf("MarkSynced: %v", err)
	}

	remaining, err := q.PopUnsynced(10)
	if err != nil {
		t.Fatalf("PopUnsynced after mark: %v", err)
	}
	if len(remaining) != 2 {
		t.Errorf("got %d remaining, want 2", len(remaining))
	}
}

func TestQueueCleanup(t *testing.T) {
	q := newTestQueue(t)

	if err := q.Push("test_event", []byte(`{}`)); err != nil {
		t.Fatalf("Push: %v", err)
	}

	entries, _ := q.PopUnsynced(10)
	ids := make([]int64, len(entries))
	for i, e := range entries {
		ids[i] = e.ID
	}
	if err := q.MarkSynced(ids); err != nil {
		t.Fatalf("MarkSynced: %v", err)
	}

	// Cleanup with 0 duration should delete all synced entries.
	deleted, err := q.CleanupSynced(0)
	if err != nil {
		t.Fatalf("CleanupSynced: %v", err)
	}
	if deleted == 0 {
		t.Error("expected at least 1 deleted row, got 0")
	}

	count, err := q.UnsyncedCount()
	if err != nil {
		t.Fatalf("UnsyncedCount: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 unsynced after cleanup, got %d", count)
	}
}

func TestQueueUnsyncedCount(t *testing.T) {
	q := newTestQueue(t)

	for i := 0; i < 3; i++ {
		if err := q.Push("test_event", []byte(`{}`)); err != nil {
			t.Fatalf("Push: %v", err)
		}
	}

	count, err := q.UnsyncedCount()
	if err != nil {
		t.Fatalf("UnsyncedCount: %v", err)
	}
	if count != 3 {
		t.Errorf("got %d, want 3", count)
	}

	// Mark 2 as synced.
	entries, _ := q.PopUnsynced(2)
	ids := []int64{entries[0].ID, entries[1].ID}
	if err := q.MarkSynced(ids); err != nil {
		t.Fatalf("MarkSynced: %v", err)
	}

	count, err = q.UnsyncedCount()
	if err != nil {
		t.Fatalf("UnsyncedCount: %v", err)
	}
	if count != 1 {
		t.Errorf("got %d, want 1", count)
	}
}

func TestQueueDBSize(t *testing.T) {
	q := newTestQueue(t)

	// Push some data to ensure the file is non-empty.
	for i := 0; i < 10; i++ {
		if err := q.Push("test_event", []byte(`{"key":"value"}`)); err != nil {
			t.Fatalf("Push: %v", err)
		}
	}

	size, err := q.DBSize()
	if err != nil {
		t.Fatalf("DBSize: %v", err)
	}
	if size <= 0 {
		t.Errorf("expected size > 0, got %d", size)
	}
}
