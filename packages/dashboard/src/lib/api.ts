import { useAuthStore } from '../store/authStore'

export const fetchClient = async (endpoint: string, options: RequestInit = {}) => {
  const token = useAuthStore.getState().token
  const headers = new Headers(options.headers || {})

  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`/api/admin${endpoint}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    useAuthStore.getState().logout()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!response.ok) {
    let message = 'An error occurred'
    try {
      const err = await response.json()
      message = err.message || message
    } catch (_e) {
      // Ignore JSON parse error for plain text
    }
    throw new Error(message)
  }

  // Handle No Content
  if (response.status === 204) {
    return null
  }

  // Handle CSV/JSON export
  const contentType = response.headers.get('content-type')
  if (contentType && contentType.includes('text/csv')) {
    return response.text()
  }

  return response.json()
}

// ── Auth ──────────────────────────────────────────────────
export const login = (password: string) =>
  fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then((r) => {
    if (!r.ok) throw new Error('Invalid password')
    return r.json()
  })

// ── Team ──────────────────────────────────────────────────
export const getTeam = () => fetchClient('/team')
export const updateTeam = (data: Record<string, unknown>) =>
  fetchClient('/team', { method: 'PUT', body: JSON.stringify(data) })
// ── Users ─────────────────────────────────────────────────
export const getUsers = () => fetchClient('/users')
export const createUser = (name: string, slug: string, limits?: unknown[]) =>
  fetchClient('/users', { method: 'POST', body: JSON.stringify({ name, slug, limits }) })
export const getUser = (id: string) => fetchClient(`/users/${id}`)
export const updateUser = (id: string, data: Record<string, unknown>) =>
  fetchClient(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteUser = (id: string) => fetchClient(`/users/${id}`, { method: 'DELETE' })
export const getUserPrompts = (id: string, params?: Record<string, string>) =>
  fetchClient(`/users/${id}/prompts${params ? '?' + new URLSearchParams(params).toString() : ''}`)
export const getUserSessions = (id: string, params?: Record<string, string>) =>
  fetchClient(`/users/${id}/sessions${params ? '?' + new URLSearchParams(params).toString() : ''}`)
export const rotateToken = (id: string) =>
  fetchClient(`/users/${id}/rotate-token`, { method: 'POST' })

// ── Subscriptions ─────────────────────────────────────────
export const getSubscriptions = () => fetchClient('/subscriptions')

// ── Analytics ─────────────────────────────────────────────
export const getAnalytics = (days: number) => fetchClient(`/analytics?days=${days}`)
export const getLeaderboard = (days: number, sortBy?: string) =>
  fetchClient(`/analytics/users?days=${days}&sortBy=${sortBy || 'prompts'}`)
export const getProjectAnalytics = (days: number) =>
  fetchClient(`/analytics/projects?days=${days}`)
export const getCosts = (days: number) => fetchClient(`/analytics/costs?days=${days}`)

// ── Prompts (aggregate) ──────────────────────────────────
export const getAllPrompts = (params?: Record<string, string>) =>
  fetchClient(`/prompts${params ? '?' + new URLSearchParams(params).toString() : ''}`)

// ── Summaries ─────────────────────────────────────────────
export const getSummaries = (params?: Record<string, string>) =>
  fetchClient(`/summaries${params ? '?' + new URLSearchParams(params).toString() : ''}`)
export const generateSummary = (userId?: string) =>
  fetchClient('/summaries/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userId ? { user_id: userId } : {}),
  })

// ── AI Intelligence ───────────────────────────────────────
export const getLatestPulse = () => fetchClient('/pulse')
export const getPulseHistory = (limit?: number) => fetchClient(`/pulse/history${limit ? `?limit=${limit}` : ''}`)
export const generatePulse = () => fetchClient('/pulse/generate', { method: 'POST' })
export const getUserProfiles = () => fetchClient('/profiles')
export const getUserProfile = (userId: string) => fetchClient(`/users/${userId}/profile`)
export const updateUserProfile = (userId: string) => fetchClient(`/users/${userId}/profile/update`, { method: 'POST' })
export const analyzeSession = (sessionId: string) => fetchClient(`/sessions/${sessionId}/analyze`, { method: 'POST' })
export const getAnalyzedSessions = (params?: Record<string, string>) =>
  fetchClient(`/sessions/analyzed${params ? '?' + new URLSearchParams(params).toString() : ''}`)

// ── Audit ─────────────────────────────────────────────────
export const getAuditLog = (params?: Record<string, string>) =>
  fetchClient(`/audit-log${params ? '?' + new URLSearchParams(params).toString() : ''}`)

// ── Events ───────────────────────────────────────────────
export const getRecentEvents = (since: string) => fetchClient(`/events/recent?since=${encodeURIComponent(since)}`)

// ── Watcher ───────────────────────────────────────────────
export const getWatcherStatus = (userId: string) => fetchClient(`/users/${userId}/watcher/status`)
export const getWatcherLogs = (userId: string) => fetchClient(`/users/${userId}/watcher/logs`)
export const getWatcherLogHistory = (userId: string) => fetchClient(`/users/${userId}/watcher/logs?history=true`)
export const getWatcherLogEntry = (userId: string, logId: number) => fetchClient(`/users/${userId}/watcher/logs/${logId}`)
export const sendWatcherCommand = (userId: string, command: string, message?: string) =>
  fetchClient(`/users/${userId}/watcher/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, message }),
  })

