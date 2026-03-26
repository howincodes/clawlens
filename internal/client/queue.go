package client

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Queue wraps a SQLite database that acts as a durable outbound event buffer.
type Queue struct {
	db     *sql.DB
	dbPath string
}

// QueueEntry represents one row from the event_queue table.
type QueueEntry struct {
	ID        int64           `json:"id"`
	EventType string          `json:"event_type"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"created_at"`
}

const queueSchema = `
CREATE TABLE IF NOT EXISTS event_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  created_at DATETIME NOT NULL,
  synced     BOOLEAN  DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_event_queue_synced ON event_queue(synced, created_at);
`

// NewQueue opens (or creates) the SQLite database at dbPath, enables WAL mode,
// creates the event_queue table and index if they don't exist, and returns a
// ready-to-use Queue.
func NewQueue(dbPath string) (*Queue, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open queue db: %w", err)
	}

	// SQLite supports only one concurrent writer.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("set WAL mode: %w", err)
	}

	if _, err := db.Exec(queueSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}

	return &Queue{db: db, dbPath: dbPath}, nil
}

// Close closes the underlying database connection.
func (q *Queue) Close() error {
	return q.db.Close()
}

// Push inserts a new unsynced event into the queue.
func (q *Queue) Push(eventType string, payload []byte) error {
	_, err := q.db.Exec(
		`INSERT INTO event_queue (event_type, payload, created_at) VALUES (?, ?, ?)`,
		eventType,
		string(payload),
		time.Now().UTC(),
	)
	return err
}

// PopUnsynced returns up to limit unsynced entries ordered by created_at.
func (q *Queue) PopUnsynced(limit int) ([]QueueEntry, error) {
	rows, err := q.db.Query(
		`SELECT id, event_type, payload, created_at
		   FROM event_queue
		  WHERE synced = FALSE
		  ORDER BY created_at
		  LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []QueueEntry
	for rows.Next() {
		var e QueueEntry
		var payload string
		var createdAt string
		if err := rows.Scan(&e.ID, &e.EventType, &payload, &createdAt); err != nil {
			return nil, err
		}
		e.Payload = json.RawMessage(payload)
		t, err := time.Parse("2006-01-02T15:04:05.999999999Z07:00", createdAt)
		if err != nil {
			// fallback to datetime format stored by older rows
			t, err = time.Parse("2006-01-02 15:04:05.999999999+00:00", createdAt)
			if err != nil {
				t, _ = time.Parse("2006-01-02 15:04:05", createdAt)
			}
		}
		e.CreatedAt = t
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// MarkSynced marks the given entry IDs as synced.
func (q *Queue) MarkSynced(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}

	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(
		`UPDATE event_queue SET synced = TRUE WHERE id IN (%s)`,
		strings.Join(placeholders, ","),
	)
	_, err := q.db.Exec(query, args...)
	return err
}

// CleanupSynced deletes synced entries older than olderThan duration and
// returns the number of rows deleted. Pass 0 to delete all synced entries.
func (q *Queue) CleanupSynced(olderThan time.Duration) (int64, error) {
	// Add a tiny grace window (1ms) so that entries created in the same
	// wall-clock instant as the threshold are also caught when olderThan==0.
	threshold := time.Now().UTC().Add(-olderThan).Add(time.Millisecond)
	res, err := q.db.Exec(
		`DELETE FROM event_queue WHERE synced = TRUE AND created_at < ?`,
		threshold,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// UnsyncedCount returns the number of entries that have not yet been synced.
func (q *Queue) UnsyncedCount() (int, error) {
	var count int
	err := q.db.QueryRow(
		`SELECT COUNT(*) FROM event_queue WHERE synced = FALSE`,
	).Scan(&count)
	return count, err
}

// DBSize returns the size of the on-disk SQLite file in bytes.
func (q *Queue) DBSize() (int64, error) {
	info, err := os.Stat(q.dbPath)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}
