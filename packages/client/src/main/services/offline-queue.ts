import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Offline queue — buffers events when the server is unreachable and flushes
// them when the connection is restored.
//
// Persisted to ~/.howinlens/queue.json so events survive restarts.
// ---------------------------------------------------------------------------

const QUEUE_DIR = path.join(os.homedir(), '.howinlens');
const QUEUE_PATH = path.join(QUEUE_DIR, 'queue.json');
const MAX_EVENTS = 1000;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export interface QueuedEvent {
  type: string;             // 'conversations' | 'session-jsonl' | 'file-events' | 'heartbeat'
  payload: unknown;
  timestamp: number;        // Date.now() when queued
}

// In-memory queue, loaded from disk on init
let queue: QueuedEvent[] = [];
let dirty = false;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Load the queue from disk. Call once at startup.
 */
export function loadQueue(): void {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      const raw = fs.readFileSync(QUEUE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        queue = parsed;
        console.log(`[offline-queue] Loaded ${queue.length} queued events from disk`);
      }
    }
  } catch (err) {
    console.error('[offline-queue] Failed to load queue:', err);
    queue = [];
  }
}

// ---------------------------------------------------------------------------
// Enqueue / dequeue
// ---------------------------------------------------------------------------

/**
 * Add an event to the offline queue. Returns false if the queue is full.
 */
export function enqueue(event: QueuedEvent): boolean {
  if (queue.length >= MAX_EVENTS) {
    console.warn('[offline-queue] Queue full (max events), dropping oldest');
    queue.shift();
  }

  // Check size limit — approximate by serializing the new event
  const eventSize = JSON.stringify(event).length;
  const currentSize = estimateQueueSize();
  if (currentSize + eventSize > MAX_SIZE_BYTES) {
    // Drop oldest events until we have room
    while (queue.length > 0 && estimateQueueSize() + eventSize > MAX_SIZE_BYTES) {
      queue.shift();
    }
    if (estimateQueueSize() + eventSize > MAX_SIZE_BYTES) {
      console.warn('[offline-queue] Single event exceeds max size, dropping');
      return false;
    }
  }

  queue.push(event);
  dirty = true;
  persistQueue();
  return true;
}

/**
 * Get all queued events (does not remove them).
 */
export function peekAll(): QueuedEvent[] {
  return [...queue];
}

/**
 * Remove the first N events from the queue (after successful flush).
 */
export function dequeue(count: number): void {
  queue.splice(0, count);
  dirty = true;
  persistQueue();
}

/**
 * Clear the entire queue.
 */
export function clearQueue(): void {
  queue = [];
  dirty = true;
  persistQueue();
}

/**
 * Get the current queue length.
 */
export function queueLength(): number {
  return queue.length;
}

/**
 * Check if the queue has any events.
 */
export function hasQueuedEvents(): boolean {
  return queue.length > 0;
}

// ---------------------------------------------------------------------------
// Flush — call this when the server becomes reachable
// ---------------------------------------------------------------------------

export type FlushHandler = (events: QueuedEvent[]) => Promise<number>;

/**
 * Flush all queued events using the provided handler.
 * The handler should attempt to send events to the server and return
 * the number of events successfully processed.
 *
 * Returns the number of events flushed.
 */
export async function flushQueue(handler: FlushHandler): Promise<number> {
  if (queue.length === 0) return 0;

  const events = [...queue];
  try {
    const flushed = await handler(events);
    if (flushed > 0) {
      dequeue(flushed);
      console.log(`[offline-queue] Flushed ${flushed}/${events.length} events`);
    }
    return flushed;
  } catch (err) {
    console.error('[offline-queue] Flush failed:', err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced write to disk — avoids thrashing on rapid enqueues.
 */
function persistQueue(): void {
  if (persistTimer) return; // already scheduled

  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!dirty) return;

    try {
      if (!fs.existsSync(QUEUE_DIR)) {
        fs.mkdirSync(QUEUE_DIR, { recursive: true });
      }
      fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue), 'utf-8');
      dirty = false;
    } catch (err) {
      console.error('[offline-queue] Failed to persist queue:', err);
    }
  }, 1000); // 1s debounce
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateQueueSize(): number {
  // Fast approximation — serialize the whole queue
  // This is called on enqueue, so keep it simple
  if (queue.length === 0) return 0;
  return JSON.stringify(queue).length;
}
