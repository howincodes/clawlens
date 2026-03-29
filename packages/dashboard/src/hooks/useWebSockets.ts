import { create } from 'zustand'
import { useCallback, useEffect, useRef } from 'react'
import { useAuthStore } from '../store/authStore'

export type WSEvent = {
  type: string
  payload: Record<string, unknown>
  timestamp: number
}

type ListenerFn = () => void

interface WSState {
  status: 'connected' | 'reconnecting' | 'disconnected'
  events: WSEvent[]
  listeners: Map<string, Set<ListenerFn>>
  addEvent: (event: WSEvent) => void
  setStatus: (status: 'connected' | 'reconnecting' | 'disconnected') => void
  subscribe: (eventType: string, callback: ListenerFn) => () => void
}

export const useWSStore = create<WSState>((set, get) => ({
  status: 'disconnected',
  events: [],
  listeners: new Map(),

  addEvent: (event) => {
    set((state) => ({ events: [event, ...state.events].slice(0, 100) }))
    // Notify listeners for this event type
    const { listeners } = get()
    const callbacks = listeners.get(event.type)
    if (callbacks) {
      callbacks.forEach((cb) => cb())
    }
    // Also notify wildcard listeners
    const wildcardCallbacks = listeners.get('*')
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach((cb) => cb())
    }
  },

  setStatus: (status) => set({ status }),

  subscribe: (eventType: string, callback: ListenerFn) => {
    const { listeners } = get()
    if (!listeners.has(eventType)) {
      listeners.set(eventType, new Set())
    }
    listeners.get(eventType)!.add(callback)
    return () => {
      const cbs = listeners.get(eventType)
      if (cbs) {
        cbs.delete(callback)
        if (cbs.size === 0) {
          listeners.delete(eventType)
        }
      }
    }
  },
}))

/** Hook to subscribe to specific WS event types. Calls `callback` whenever one arrives. */
export function useWSEvent(eventType: string, callback: () => void) {
  const subscribe = useWSStore((s) => s.subscribe)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const stableCb = () => callbackRef.current()
    const unsubscribe = subscribe(eventType, stableCb)
    return unsubscribe
  }, [eventType, subscribe])
}

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPollTime = useRef<string>(new Date().toISOString())
  const setStatus = useWSStore((s) => s.setStatus)
  const addEvent = useWSStore((s) => s.addEvent)
  const token = useAuthStore((s) => s.token)

  // Polling fallback
  const startPolling = useCallback(() => {
    if (pollTimer.current) return // already polling
    pollTimer.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/admin/events/recent?since=${encodeURIComponent(lastPollTime.current)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!resp.ok) return
        const { data, timestamp } = await resp.json()
        lastPollTime.current = timestamp
        // Add events in chronological order (oldest first)
        if (Array.isArray(data)) {
          for (const evt of data.reverse()) {
            addEvent({
              type: evt.event_type || evt.type || 'unknown',
              payload: { ...evt, user_name: evt.user_name },
              timestamp: new Date(evt.created_at).getTime(),
            })
          }
        }
      } catch {
        // Polling errors are silently ignored — next interval will retry
      }
    }, 10000) // poll every 10 seconds
    setStatus('connected') // polling counts as connected
  }, [token, addEvent, setStatus])

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  useEffect(() => {
    if (!token) return

    let reconnectTimer: ReturnType<typeof setTimeout>
    let wsConnectTimeout: ReturnType<typeof setTimeout>
    let attempt = 0

    function connect() {
      // In Vite dev, the proxy routes /ws to ws://localhost:3000
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host

      const socket = new WebSocket(`${protocol}//${host}/ws?token=${token}`)
      ws.current = socket

      // If WS doesn't connect within 5 seconds, start polling
      wsConnectTimeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          startPolling()
        }
      }, 5000)

      socket.onopen = () => {
        clearTimeout(wsConnectTimeout)
        setStatus('connected')
        attempt = 0
        stopPolling() // WS connected, stop polling
      }

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          addEvent({
            type: data.event || data.type,
            payload: data,
            timestamp: Date.now(),
          })
        } catch {
          // Binary ping frames are handled automatically by the browser;
          // non-JSON text frames (rare) can be safely ignored.
        }
      }

      socket.onclose = (ev) => {
        clearTimeout(wsConnectTimeout)
        // 4001 = auth failure — don't reconnect with a bad token
        if (ev.code === 4001) {
          setStatus('disconnected')
          return
        }
        // Start polling fallback immediately on close
        startPolling()
        // Still try to reconnect WS in background
        const timeout = Math.min(1000 * Math.pow(2, attempt), 30000)
        attempt++
        reconnectTimer = setTimeout(connect, timeout)
      }

      socket.onerror = () => {
        // onerror always fires before onclose; let onclose handle reconnection
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      clearTimeout(wsConnectTimeout)
      stopPolling()
      if (ws.current) {
        // Prevent reconnect logic from firing on unmount
        ws.current.onclose = null
        ws.current.close()
      }
    }
  }, [token, setStatus, addEvent, startPolling, stopPolling])

  return useWSStore()
}
