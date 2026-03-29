import { create } from 'zustand'
import { useEffect, useRef } from 'react'
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
  const setStatus = useWSStore((s) => s.setStatus)
  const addEvent = useWSStore((s) => s.addEvent)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (!token) return

    let reconnectTimer: ReturnType<typeof setTimeout>
    let attempt = 0

    function connect() {
      // In Vite dev, the proxy routes /ws to ws://localhost:3000
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host

      const socket = new WebSocket(`${protocol}//${host}/ws?token=${token}`)
      ws.current = socket

      socket.onopen = () => {
        setStatus('connected')
        attempt = 0
      }

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          addEvent({
            type: data.event || data.type,
            payload: data,
            timestamp: Date.now(),
          })
        } catch (e) {
          // Binary ping frames are handled automatically by the browser;
          // non-JSON text frames (rare) can be safely ignored.
        }
      }

      socket.onclose = (ev) => {
        // 4001 = auth failure — don't reconnect with a bad token
        if (ev.code === 4001) {
          setStatus('disconnected')
          return
        }
        setStatus('reconnecting')
        // Exponential backoff: 1s, 2s, 4s, 8s, … capped at 30s
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
      if (ws.current) {
        // Prevent reconnect logic from firing on unmount
        ws.current.onclose = null
        ws.current.close()
      }
    }
  }, [token, setStatus, addEvent])

  return useWSStore()
}
