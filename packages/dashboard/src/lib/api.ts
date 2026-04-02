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
export async function login(email: string, password: string) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error('Invalid credentials')
  return res.json()
}

export async function getMe() {
  return fetchClient('/auth/me')
}

// ── Team ──────────────────────────────────────────────────
export const getTeam = () => fetchClient('/team')
export const updateTeam = (data: Record<string, unknown>) =>
  fetchClient('/team', { method: 'PUT', body: JSON.stringify(data) })
// ── Users ─────────────────────────────────────────────────
export const getUsers = (source?: string) =>
  fetchClient(`/users${source ? `?source=${source}` : ''}`)
export const createUser = (name: string, slug: string, limits?: unknown[]) =>
  fetchClient('/users', { method: 'POST', body: JSON.stringify({ name, slug, limits }) })
export const getUser = (id: string) => fetchClient(`/users/${id}`)
export const updateUser = (id: string, data: Record<string, unknown>) =>
  fetchClient(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteUser = (id: string) => fetchClient(`/users/${id}`, { method: 'DELETE' })
export const getUserMessages = (id: string, params?: Record<string, string>) =>
  fetchClient(`/users/${id}/messages${params ? '?' + new URLSearchParams(params).toString() : ''}`)
export const getUserSessions = (id: string, params?: Record<string, string>) =>
  fetchClient(`/users/${id}/sessions${params ? '?' + new URLSearchParams(params).toString() : ''}`)
export const rotateToken = (id: string) =>
  fetchClient(`/users/${id}/rotate-token`, { method: 'POST' })

// ── Subscriptions ─────────────────────────────────────────
export const getSubscriptions = (source?: string) =>
  fetchClient(`/subscriptions${source ? `?source=${source}` : ''}`)

// ── Analytics ─────────────────────────────────────────────
export const getAnalytics = (days: number, source?: string) =>
  fetchClient(`/analytics?days=${days}${source ? `&source=${source}` : ''}`)
export const getLeaderboard = (days: number, sortBy?: string, source?: string) =>
  fetchClient(`/analytics/users?days=${days}&sortBy=${sortBy || 'prompts'}${source ? `&source=${source}` : ''}`)
export const getProjectAnalytics = (days: number, source?: string) =>
  fetchClient(`/analytics/projects?days=${days}${source ? `&source=${source}` : ''}`)
export const getCosts = (days: number, source?: string) =>
  fetchClient(`/analytics/costs?days=${days}${source ? `&source=${source}` : ''}`)

// ── Messages (aggregate) ─────────────────────────────────
export const getAllMessages = (params?: Record<string, string>) =>
  fetchClient(`/messages${params ? '?' + new URLSearchParams(params).toString() : ''}`)

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

// ── Model Credits ────────────────────────────────────
export const getModelCredits = (source?: string) =>
  fetchClient(`/model-credits${source ? `?source=${source}` : ''}`)
export const updateModelCredit = (id: number, credits: number, tier?: string) =>
  fetchClient(`/model-credits/${id}`, { method: 'PUT', body: JSON.stringify({ credits, tier }) })

// ── Provider Quotas ──────────────────────────────────
export const getProviderQuotas = (userId: string, source?: string) =>
  fetchClient(`/provider-quotas/${userId}${source ? `?source=${source}` : ''}`)

// ── Roles ────────────────────────────────────────────
export async function getRoles() {
  return fetchClient('/roles')
}

export async function createRole(data: { name: string; description?: string }) {
  return fetchClient('/roles', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateRoleApi(id: number, data: { name?: string; description?: string }) {
  return fetchClient(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteRoleApi(id: number) {
  return fetchClient(`/roles/${id}`, { method: 'DELETE' })
}

export async function getPermissions() {
  return fetchClient('/permissions')
}

export async function getRolePermissions(roleId: number) {
  return fetchClient(`/roles/${roleId}/permissions`)
}

export async function setRolePermissions(roleId: number, permissionIds: number[]) {
  return fetchClient(`/roles/${roleId}/permissions`, { method: 'PUT', body: JSON.stringify({ permissionIds }) })
}

// ── Projects ─────────────────────────────────────────
export async function getProjects() {
  return fetchClient('/projects')
}

export async function createProjectApi(data: { name: string; description?: string }) {
  return fetchClient('/projects', { method: 'POST', body: JSON.stringify(data) })
}

export async function getProject(id: number) {
  return fetchClient(`/projects/${id}`)
}

export async function updateProjectApi(id: number, data: any) {
  return fetchClient(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteProjectApi(id: number) {
  return fetchClient(`/projects/${id}`, { method: 'DELETE' })
}

export async function getProjectMembersApi(projectId: number) {
  return fetchClient(`/projects/${projectId}/members`)
}

export async function addProjectMemberApi(projectId: number, data: { userId: number; roleId?: number }) {
  return fetchClient(`/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify(data) })
}

export async function removeProjectMemberApi(projectId: number, userId: number) {
  return fetchClient(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' })
}

// ── Project Repositories ──

export async function getProjectRepositories(projectId: number) {
  return fetchClient(`/projects/${projectId}/repositories`);
}

export async function addProjectRepositoryApi(projectId: number, data: { githubRepoUrl: string; label?: string }) {
  return fetchClient(`/projects/${projectId}/repositories`, { method: 'POST', body: JSON.stringify(data) });
}

export async function removeProjectRepositoryApi(id: number) {
  return fetchClient(`/repositories/${id}`, { method: 'DELETE' });
}

// ── Subscription Credentials ──

export async function getSubscriptionCredentials() {
  return fetchClient('/subscriptions/credentials');
}

export async function getSubscriptionCredentialDetail(id: number) {
  return fetchClient(`/subscriptions/credentials/${id}`);
}

export async function createSubscriptionCredential(data: { email: string; accessToken?: string; refreshToken?: string; orgId?: string; subscriptionType?: string }) {
  return fetchClient('/subscriptions/credentials', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteSubscriptionCredential(id: number) {
  return fetchClient(`/subscriptions/credentials/${id}`, { method: 'DELETE' });
}

export async function getSubscriptionUsage() {
  return fetchClient('/subscriptions/usage');
}

export async function killUserCredential(userId: number) {
  return fetchClient(`/subscriptions/kill/${userId}`, { method: 'POST' });
}

export async function rotateUserCredential(userId: number) {
  return fetchClient('/subscriptions/rotate', { method: 'POST', body: JSON.stringify({ userId }) });
}

// ── Tasks ──

export async function getTasks(projectId: number, filters?: { status?: string; assigneeId?: number }) {
  const params = new URLSearchParams({ projectId: String(projectId) });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.assigneeId) params.set('assigneeId', String(filters.assigneeId));
  return fetchClient(`/tasks?${params}`);
}

export async function createTaskApi(data: { projectId: number; title: string; description?: string; priority?: string; effort?: string; assigneeId?: number; milestoneId?: number; parentTaskId?: number }) {
  return fetchClient('/tasks', { method: 'POST', body: JSON.stringify(data) });
}

export async function getTask(id: number) {
  return fetchClient(`/tasks/${id}`);
}

export async function updateTaskApi(id: number, data: any) {
  return fetchClient(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteTaskApi(id: number) {
  return fetchClient(`/tasks/${id}`, { method: 'DELETE' });
}

export async function addTaskComment(taskId: number, content: string) {
  return fetchClient(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ content }) });
}

export async function assignTask(taskId: number, assigneeId: number) {
  return fetchClient(`/tasks/${taskId}/assign`, { method: 'PUT', body: JSON.stringify({ assigneeId }) });
}

export async function changeTaskStatus(taskId: number, status: string) {
  return fetchClient(`/tasks/${taskId}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

// ── Milestones ──

export async function getMilestones(projectId: number) {
  return fetchClient(`/projects/${projectId}/milestones`);
}

export async function createMilestoneApi(projectId: number, data: { name: string; description?: string; dueDate?: string }) {
  return fetchClient(`/projects/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateMilestoneApi(id: number, data: any) {
  return fetchClient(`/milestones/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteMilestoneApi(id: number) {
  return fetchClient(`/milestones/${id}`, { method: 'DELETE' });
}

// ── Requirements & AI Task Generation ──

export async function submitRequirement(data: { projectId: number; inputType: string; content: string }) {
  return fetchClient('/requirements', { method: 'POST', body: JSON.stringify(data) });
}

export async function getRequirementSuggestions(requirementId: number) {
  return fetchClient(`/requirements/${requirementId}/suggestions`);
}

export async function approveRequirementSuggestions(requirementId: number) {
  return fetchClient(`/requirements/${requirementId}/approve`, { method: 'POST' });
}

export async function rejectRequirementSuggestions(requirementId: number) {
  return fetchClient(`/requirements/${requirementId}/reject`, { method: 'POST' });
}

// ── Activity ──

export async function getUserActivity(userId: number, since?: string) {
  const params = since ? `?since=${since}` : '';
  return fetchClient(`/activity/${userId}${params}`);
}

export async function getUserActivityWindows(userId: number, date?: string) {
  const params = date ? `?date=${date}` : '';
  return fetchClient(`/activity/windows/${userId}${params}`);
}

// ── Task Status Configs ──

export async function getTaskStatuses(projectId: number) {
  return fetchClient(`/projects/${projectId}/statuses`);
}

export async function createTaskStatusApi(projectId: number, data: { name: string; color?: string; position?: number; isDoneState?: boolean }) {
  return fetchClient(`/projects/${projectId}/statuses`, { method: 'POST', body: JSON.stringify(data) });
}

