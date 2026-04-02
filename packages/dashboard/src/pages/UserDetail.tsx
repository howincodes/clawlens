import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getUser, getUserMessages, getUserSessions, generateSummary, getSubscriptions, getWatcherStatus, getWatcherLogs, getWatcherLogHistory, getWatcherLogEntry, sendWatcherCommand, updateUser, getUserProfile, updateUserProfile, getProviderQuotas, getUserActivity, getUserActivityWindows, getProjects, getProjectMembersApi, getTasks, killUserCredential, rotateUserCredential } from '@/lib/api'
import RoleBadge from '@/components/RoleBadge'
import WatchStatusIndicator from '@/components/WatchStatusIndicator'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Loader2,
  ArrowLeft,
  Settings2,
  Trash2,
  Code2,
  Play,
  Pause,
  Folder,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RefreshCw,
  Zap,
  Skull,
  FileText,
  Copy,
  Key,
  Download,
  Clock,
  Info,
  Brain,
} from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart as RePieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts'
import { EditLimitsModal } from '@/components/EditLimitsModal'
import { ConfirmActionModal } from '@/components/ConfirmActionModal'
import { QuotaBar } from '@/components/QuotaBar'
import { SourceBadge } from '@/components/SourceBadge'
import { SourceFilter } from '@/components/SourceFilter'
import { formatDistanceToNow, format } from 'date-fns'

const COLORS = ['#3b82f6', '#a855f7', '#f97316', '#22c55e', '#ef4444', '#06b6d4']

// ── Helpers ───────────────────────────────────────────────

/** Parse a server date string, appending 'Z' if missing so it's treated as UTC. */
function parseServerDate(dateStr: string): Date {
  if (!dateStr) return new Date(0)
  return new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z')
}

function normalizeModel(model: string): string {
  if (!model) return 'Unknown'
  if (model.startsWith('AG-')) return model  // Keep full AG- name
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'Opus'
  if (lower.includes('sonnet')) return 'Sonnet'
  if (lower.includes('haiku')) return 'Haiku'
  return model
}

function modelBadgeVariant(
  model: string
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
  const n = normalizeModel(model)
  if (n.startsWith('AG-')) return 'outline'  // AG models use outline + teal color
  if (n === 'Opus') return 'default'
  if (n === 'Sonnet') return 'secondary'
  if (n === 'Haiku') return 'warning'
  return 'outline'
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const val = bytes / Math.pow(k, i)
  return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)}${sizes[i]}`
}

function formatQuotaReset(unixTs: number | null | undefined): string {
  if (!unixTs) return 'N/A'
  const date = new Date(unixTs * 1000)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  if (diffMs < 0) return 'Expired'
  if (diffMs < 86400000) {
    const hours = Math.floor(diffMs / 3600000)
    const mins = Math.floor((diffMs % 3600000) / 60000)
    return `Resets in ${hours}h ${mins}m`
  }
  return `Resets ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function extractProjectName(cwd: string): string {
  if (!cwd) return 'unknown'
  // Get last meaningful directory name from path
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  // Skip generic names like "Users", "home", drive letters
  const name = parts[parts.length - 1] || 'unknown'
  return name
}

// ── Component ─────────────────────────────────────────────
export function UserDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Prompts state
  const [prompts, setPrompts] = useState<any[]>([])
  const [promptsLoading, setPromptsLoading] = useState(true)
  const [promptPage, setPromptPage] = useState(1)
  const [promptSearch, setPromptSearch] = useState('')
  const [promptsTotal, setPromptsTotal] = useState(0)
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null)

  // Sessions state
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)

  // Watcher state
  const [watcherStatus, setWatcherStatus] = useState<any>(null)
  const [watcherLogs, setWatcherLogs] = useState<any>(null)
  const [watcherLoading, setWatcherLoading] = useState(false)
  const [watcherCommandQueued, setWatcherCommandQueued] = useState(false)
  const [activeLogTab, setActiveLogTab] = useState<'hook' | 'watcher'>('hook')
  const [logHistory, setLogHistory] = useState<any[]>([])
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)
  const [logEntryLoading, setLogEntryLoading] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Token visibility
  const [showToken, setShowToken] = useState(false)

  // Modal states
  const [showLimits, setShowLimits] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'killed' | 'paused' | 'active' | null>(null)
  const [generatingSummary, setGeneratingSummary] = useState(false)

  // Notification config state
  const [notifConfig, setNotifConfig] = useState<Record<string, boolean>>({
    on_stop: true,
    on_block: true,
    on_credit_warning: true,
    on_kill: true,
    sound: true,
  })
  const [pollIntervalInput, setPollIntervalInput] = useState<string>('30')
  const [pollSaving, setPollSaving] = useState(false)

  // AI Profile state
  const [aiProfile, setAiProfile] = useState<any>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  // All prompts for charts (larger set)
  const [allPrompts, setAllPrompts] = useState<any[]>([])

  // Provider quotas and prompt source filter
  const [providerQuotas, setProviderQuotas] = useState<any[]>([])
  const [promptSource, setPromptSource] = useState('')

  // Tab navigation
  const [activeTab, setActiveTab] = useState<'profile' | 'watch' | 'activity' | 'projects' | 'tasks' | 'prompts' | 'sessions' | 'limits'>('profile')

  // Activity tab state
  const [activityData, setActivityData] = useState<any[]>([])
  const [activityWindows, setActivityWindows] = useState<any[]>([])
  const [activityLoading, setActivityLoading] = useState(false)

  // Projects tab state
  const [userProjects, setUserProjects] = useState<any[]>([])
  const [userProjectsLoading, setUserProjectsLoading] = useState(false)

  // Tasks tab state
  const [userTasks, setUserTasks] = useState<any[]>([])
  const [userTasksLoading, setUserTasksLoading] = useState(false)

  const loadUser = useCallback(async () => {
    if (!id) return
    try {
      setError(null)
      const res = await getUser(id)
      // New API returns user fields directly; old API wraps in { user: {...} }
      const userData = res?.user ? res : { user: res, ...res }
      // If the user doesn't already have a subscription_email, look it up from subscriptions
      if (userData?.user && !userData.user.subscription_email && userData.user.subscription_id) {
        try {
          const subsRes = await getSubscriptions()
          const subs = subsRes?.data || subsRes?.subscriptions || []
          const linkedSub = subs.find((s: any) => s.id === userData.user.subscription_id)
          if (linkedSub) {
            userData.user.subscription_email = linkedSub.email
          }
        } catch (_err) {
          // subscription lookup is best-effort
        }
      }
      setData(userData)
    } catch (err) {
      console.error('Failed to load user', err)
      setError('Failed to load user data.')
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadPrompts = useCallback(async () => {
    if (!id) return
    setPromptsLoading(true)
    try {
      const params: Record<string, string> = {
        page: String(promptPage),
        limit: '10',
      }
      if (promptSearch) params.search = promptSearch
      if (promptSource) params.source = promptSource
      const res = await getUserMessages(id, params)
      setPrompts(res?.data || res?.prompts || [])
      setPromptsTotal(res?.total || 0)
    } catch (err) {
      console.error('Failed to load prompts', err)
    } finally {
      setPromptsLoading(false)
    }
  }, [id, promptPage, promptSearch, promptSource])

  const loadSessions = useCallback(async () => {
    if (!id) return
    setSessionsLoading(true)
    try {
      const res = await getUserSessions(id, { limit: '20' })
      setSessions(res?.data || res?.sessions || [])
    } catch (err) {
      console.error('Failed to load sessions', err)
    } finally {
      setSessionsLoading(false)
    }
  }, [id])

  const loadAllPromptsForCharts = useCallback(async () => {
    if (!id) return
    try {
      const res = await getUserMessages(id, { limit: '500', ...(promptSource ? { source: promptSource } : {}) })
      setAllPrompts(res?.data || res?.prompts || [])
    } catch (_err) {
      // Chart data is nice-to-have, don't block on it
    }
  }, [id, promptSource])

  useEffect(() => {
    loadUser()
  }, [loadUser])

  // Sync notification config + poll interval from user data
  useEffect(() => {
    if (data?.user) {
      const defaults = { on_stop: true, on_block: true, on_credit_warning: true, on_kill: true, sound: true }
      if (data.user.notification_config) {
        try {
          setNotifConfig({ ...defaults, ...JSON.parse(data.user.notification_config) })
        } catch {
          setNotifConfig(defaults)
        }
      } else {
        setNotifConfig(defaults)
      }
      setPollIntervalInput(String(Math.round((data.user.poll_interval || 30000) / 1000)))
    }
  }, [data?.user])

  useEffect(() => {
    loadPrompts()
  }, [loadPrompts])

  const loadWatcherStatus = useCallback(async () => {
    if (!id) return
    try {
      const status = await getWatcherStatus(id)
      setWatcherStatus(status)
    } catch {
      // watcher status is best-effort
    }
  }, [id])

  useEffect(() => {
    loadSessions()
    loadAllPromptsForCharts()
    loadWatcherStatus()
    if (id) {
      getUserProfile(id).then(res => setAiProfile(res?.data || null)).catch(() => {})
      getProviderQuotas(id, 'codex').then(res => setProviderQuotas(res?.data || [])).catch(() => {})
    }
  }, [loadSessions, loadAllPromptsForCharts, loadWatcherStatus, id])

  // Auto-refresh watcher status every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadWatcherStatus, 30000)
    return () => clearInterval(interval)
  }, [loadWatcherStatus])

  // Cleanup log polling on unmount
  useEffect(() => {
    return () => {
      if (logPollRef.current) clearInterval(logPollRef.current)
    }
  }, [])

  // Load activity data when Activity tab is selected
  useEffect(() => {
    if (activeTab !== 'activity' || !id) return
    setActivityLoading(true)
    Promise.all([
      getUserActivity(parseInt(id)).catch(() => []),
      getUserActivityWindows(parseInt(id)).catch(() => []),
    ]).then(([act, wins]) => {
      setActivityData(Array.isArray(act) ? act : act?.data || [])
      setActivityWindows(Array.isArray(wins) ? wins : wins?.data || [])
    }).finally(() => setActivityLoading(false))
  }, [activeTab, id])

  // Load projects data when Projects tab is selected
  useEffect(() => {
    if (activeTab !== 'projects' || !id) return
    setUserProjectsLoading(true)
    getProjects().then(async (projects: any) => {
      const allProjects = Array.isArray(projects) ? projects : projects?.data || []
      const userMemberships: any[] = []
      await Promise.all(allProjects.map(async (proj: any) => {
        try {
          const members = await getProjectMembersApi(proj.id)
          const memberList = Array.isArray(members) ? members : members?.data || []
          const membership = memberList.find((m: any) => String(m.userId) === id)
          if (membership) {
            userMemberships.push({ ...proj, memberRole: membership.role || membership.roleName || 'member' })
          }
        } catch {}
      }))
      setUserProjects(userMemberships)
    }).catch(() => setUserProjects([])).finally(() => setUserProjectsLoading(false))
  }, [activeTab, id])

  // Load tasks data when Tasks tab is selected
  useEffect(() => {
    if (activeTab !== 'tasks' || !id) return
    setUserTasksLoading(true)
    getProjects().then(async (projects: any) => {
      const allProjects = Array.isArray(projects) ? projects : projects?.data || []
      const allTasks: any[] = []
      await Promise.all(allProjects.map(async (proj: any) => {
        try {
          const tasks = await getTasks(proj.id, { assigneeId: parseInt(id) })
          const taskList = Array.isArray(tasks) ? tasks : tasks?.data || []
          taskList.forEach((t: any) => allTasks.push({ ...t, projectName: proj.name, projectId: proj.id }))
        } catch {}
      }))
      setUserTasks(allTasks)
    }).catch(() => setUserTasks([])).finally(() => setUserTasksLoading(false))
  }, [activeTab, id])

  // ── Chart data derived from prompts ───────────────────
  const dailyUsageData = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of allPrompts) {
      const day = format(new Date(p.timestamp || p.created_at), 'MM/dd')
      map.set(day, (map.get(day) || 0) + 1)
    }
    const entries = Array.from(map.entries())
      .map(([date, prompts]) => ({ date, prompts }))
      .slice(-30)
    return entries.length > 0 ? entries : [{ date: 'Today', prompts: 0 }]
  }, [allPrompts])

  const modelDistData = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of allPrompts) {
      const model = normalizeModel(p.model || '')
      map.set(model, (map.get(model) || 0) + 1)
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }))
  }, [allPrompts])

  const toolUsageData = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of allPrompts) {
      const tools = p.tools_used || []
      for (const t of tools) {
        const name = typeof t === 'string' ? t : t.name || t.tool || 'unknown'
        map.set(name, (map.get(name) || 0) + 1)
      }
    }
    return Array.from(map.entries())
      .map(([name, uses]) => ({ name, uses }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 8)
  }, [allPrompts])

  const peakHoursData = useMemo(() => {
    const hours = new Array(24).fill(0)
    for (const p of allPrompts) {
      const h = new Date(p.timestamp || p.created_at).getHours()
      hours[h]++
    }
    return hours.map((count, h) => ({
      hour: `${h.toString().padStart(2, '0')}:00`,
      count,
    }))
  }, [allPrompts])

  // ── Top projects from prompts ─────────────────────────
  const topProjects = useMemo(() => {
    const map = new Map<string, { count: number; cost: number }>()
    for (const p of allPrompts) {
      const session = data?.sessions?.find((s: any) => s.id === p.session_id)
      const dir = session?.cwd ? extractProjectName(session.cwd) : 'unknown'
      const cur = map.get(dir) || { count: 0, cost: 0 }
      cur.count++
      cur.cost += Number(p.credit_cost || p.cost_usd || p.cost || 0)
      map.set(dir, cur)
    }
    return Array.from(map.entries())
      .map(([name, d]) => ({ name, prompt_count: d.count, cost: d.cost }))
      .sort((a, b) => b.prompt_count - a.prompt_count)
      .slice(0, 10)
  }, [allPrompts, data?.sessions])

  const loadLogHistory = useCallback(async () => {
    if (!id) return
    try {
      const res = await getWatcherLogHistory(id)
      const history = res?.data || []
      setLogHistory(history)
    } catch {
      // log history is best-effort
    }
  }, [id])

  const loadLogEntry = useCallback(async (logId: number) => {
    if (!id) return
    setLogEntryLoading(true)
    setSelectedLogId(logId)
    try {
      const res = await getWatcherLogEntry(id, logId)
      const logData = res?.data || res
      if (logData) {
        setWatcherLogs(logData)
      }
    } catch {
      // log entry load is best-effort
    } finally {
      setLogEntryLoading(false)
    }
  }, [id])

  const handleRefreshLogs = useCallback(async () => {
    if (!id) return
    setLogEntryLoading(true)
    try {
      const existing = await getWatcherLogs(id)
      const logs = existing?.data || existing
      if (logs && (logs.hook_log || logs.watcher_log)) {
        setWatcherLogs(logs)
        setSelectedLogId(logs.id || null)
      }
      await loadLogHistory()
    } catch {
      // refresh is best-effort
    } finally {
      setLogEntryLoading(false)
    }
  }, [id, loadLogHistory])

  const handleRequestLogs = useCallback(async () => {
    if (!id) return
    setWatcherLoading(true)
    setWatcherCommandQueued(true)

    // First check if logs already exist (from previous upload)
    try {
      const existing = await getWatcherLogs(id)
      const existingLogs = existing?.data || existing
      if (existingLogs && (existingLogs.hook_log || existingLogs.watcher_log)) {
        setWatcherLogs(existingLogs)
        setSelectedLogId(existingLogs.id || null)
      }
    } catch {}

    // Load history
    await loadLogHistory()

    // Send upload command
    try {
      await sendWatcherCommand(id, 'upload_logs')
    } catch (_err) {
      // command send is best-effort
    }

    // Poll for NEW logs every 3s for up to 90s
    const requestTime = new Date().toISOString()
    let elapsed = 0
    if (logPollRef.current) clearInterval(logPollRef.current)
    logPollRef.current = setInterval(async () => {
      elapsed += 3000
      try {
        const res = await getWatcherLogs(id)
        const logs = res?.data || res
        if (logs && (logs.hook_log || logs.watcher_log)) {
          // Check if this is a fresh upload (after our request)
          if (!requestTime || (logs.uploaded_at && logs.uploaded_at > requestTime)) {
            setWatcherLogs(logs)
            setSelectedLogId(logs.id || null)
            setWatcherLoading(false)
            setWatcherCommandQueued(false)
            if (logPollRef.current) clearInterval(logPollRef.current)
            // Refresh history to include the new entry
            loadLogHistory()
          } else if (!watcherLogs) {
            // Show old logs while waiting for fresh ones
            setWatcherLogs(logs)
            setSelectedLogId(logs.id || null)
          }
        }
      } catch (_err) {
        // keep polling
      }
      if (elapsed >= 90000) {
        setWatcherLoading(false)
        setWatcherCommandQueued(false)
        if (logPollRef.current) clearInterval(logPollRef.current)
      }
    }, 3000)
  }, [id, watcherLogs, loadLogHistory])

  const handleCopyLog = useCallback(() => {
    const logContent = activeLogTab === 'hook' ? watcherLogs?.hook_log : watcherLogs?.watcher_log
    if (!logContent) return
    navigator.clipboard.writeText(logContent).then(() => {
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    })
  }, [activeLogTab, watcherLogs])

  const handleDownloadLog = useCallback(() => {
    const logContent = activeLogTab === 'hook' ? watcherLogs?.hook_log : watcherLogs?.watcher_log
    if (!logContent) return
    const blob = new Blob([logContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeLogTab}-log-${watcherLogs?.id || 'latest'}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [activeLogTab, watcherLogs])

  // Load log history on mount
  useEffect(() => {
    loadLogHistory()
  }, [loadLogHistory])

  const toggleNotification = useCallback(async (key: string) => {
    if (!id) return
    const prev = { ...notifConfig }
    const updated = { ...notifConfig, [key]: !notifConfig[key] }
    setNotifConfig(updated)
    try {
      await updateUser(id, { notification_config: JSON.stringify(updated) })
    } catch {
      setNotifConfig(prev) // revert on failure
    }
  }, [id, notifConfig])

  const handleSavePollInterval = useCallback(async () => {
    if (!id) return
    const seconds = parseInt(pollIntervalInput, 10)
    if (isNaN(seconds) || seconds < 1) return
    setPollSaving(true)
    try {
      await updateUser(id, { poll_interval: seconds * 1000 })
      await loadUser()
    } catch {
      // revert display
      if (data?.user) {
        setPollIntervalInput(String(Math.round((data.user.poll_interval || 30000) / 1000)))
      }
    } finally {
      setPollSaving(false)
    }
  }, [id, pollIntervalInput, loadUser, data?.user])

  const handleKill = useCallback(async () => {
    if (!id) return
    const confirmed = window.confirm('Are you sure you want to kill this user\'s Claude Code session?')
    if (!confirmed) return
    try {
      await sendWatcherCommand(id, 'kill')
    } catch (_err) {
      console.error('Failed to send kill command')
    }
  }, [id])

  const handleGenerateSummary = useCallback(async () => {
    setGeneratingSummary(true)
    try {
      await generateSummary()
      await loadUser()
    } catch (err) {
      console.error('Failed to generate summary', err)
    } finally {
      setGeneratingSummary(false)
    }
  }, [loadUser])

  const handleUpdateProfile = useCallback(async () => {
    if (!id) return
    setProfileLoading(true)
    try {
      const res = await updateUserProfile(id)
      setAiProfile(res?.data || null)
    } catch {}
    setProfileLoading(false)
  }, [id])

  // ── Loading state ─────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={loadUser} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  if (!data?.user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="w-12 h-12 text-muted-foreground" />
        <p className="text-muted-foreground">User not found</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Overview
        </Button>
      </div>
    )
  }

  const { user, devices, latest_summary: latestSummary } = data
  const limits = user?.limits || data.limits || []

  const totalPrompts = data.prompt_count ?? 0
  const agPromptCount = data.ag_prompt_count ?? 0
  const promptsToday = data.prompts_today ?? 0
  const totalCost = data.total_credits ?? 0
  const totalSessions = data.session_count ?? data.sessions?.length ?? 0
  const sessionsToday = data.sessions_today ?? 0
  const deviceCount = devices?.length ?? 0

  const promptTotalPages = Math.max(1, Math.ceil(promptsTotal / 10))

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{user.name}</h1>
          <p className="text-muted-foreground flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm">{user.slug}</span>
            <span>&bull;</span>
            <span>{user.subscription_email || user.email || 'No Linked Subscription'}</span>
            <span>&bull;</span>
            <span>
              {deviceCount} device{deviceCount !== 1 ? 's' : ''}
            </span>
            <Badge
              variant={
                user.status === 'active'
                  ? 'success'
                  : user.status === 'paused'
                    ? 'warning'
                    : 'destructive'
              }
              className="ml-2"
            >
              {user.status}
            </Badge>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {user.status === 'active' ? (
            <Button
              variant="outline"
              className="text-yellow-600"
              onClick={() => setConfirmAction('paused')}
            >
              <Pause className="w-4 h-4 mr-2" />
              Pause
            </Button>
          ) : (
            <Button
              variant="outline"
              className="text-green-600"
              onClick={() => setConfirmAction('active')}
            >
              <Play className="w-4 h-4 mr-2" />
              Reinstate
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowLimits(true)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Edit Limits
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowToken(!showToken)}>
            <Key className="w-4 h-4 mr-2" />
            {showToken ? 'Hide Token' : 'Show Token'}
          </Button>
          <Button variant="destructive" onClick={() => setConfirmAction('killed')}>
            <Trash2 className="w-4 h-4 mr-2" />
            Kill User
          </Button>
        </div>
      </div>
      {showToken && data?.user?.auth_token && (
        <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
          <code className="text-xs font-mono flex-1 select-all">{data.user.auth_token}</code>
          <Button variant="ghost" size="sm" onClick={() => {
            navigator.clipboard.writeText(data.user.auth_token)
          }}>
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {([
          ['profile', 'Profile'],
          ['watch', 'Watch & Subscription'],
          ['activity', 'Activity'],
          ['projects', 'Projects'],
          ['tasks', 'Tasks'],
          ['prompts', 'Prompts'],
          ['sessions', 'Sessions'],
          ['limits', 'Limits'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══ PROFILE TAB ═══ */}
      {activeTab === 'profile' && (<>
      {/* Profile Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">User Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{user.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{user.subscription_email || user.email || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Slug / GitHub ID</span>
                <span className="font-mono text-sm">{user.slug}</span>
              </div>
              <div className="flex justify-between text-sm items-center">
                <span className="text-muted-foreground">Role</span>
                <RoleBadge role={user.role || 'user'} />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm items-center">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={user.status === 'active' ? 'success' : user.status === 'paused' ? 'warning' : 'destructive'}>{user.status}</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Deployment Tier</span>
                <span className="font-medium capitalize">{user.deployment_tier || user.tier || 'standard'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Created</span>
                <span className="text-sm">{user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Devices</span>
                <span className="font-medium">{deviceCount}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total CC Prompts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{totalPrompts}</div>
            <p className="text-xs text-muted-foreground">
              +{promptsToday} today
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Credits</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{Number(totalCost)} credits</div>
            <p className="text-xs text-muted-foreground">Claude Code</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              AG Prompts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{agPromptCount}</div>
            <p className="text-xs text-muted-foreground">Antigravity</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{totalSessions}</div>
            <p className="text-xs text-muted-foreground">+{sessionsToday} today</p>
          </CardContent>
        </Card>
      </div>

      {/* Provider Credit Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Claude Code Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <SourceBadge source="claude_code" /> Claude Code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credits Used (today)</span>
              <span className="font-medium">{data?.cc_credits ?? data?.credits ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prompts</span>
              <span className="font-medium">{data?.prompt_count ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model</span>
              <span className="font-medium">{normalizeModel(user?.default_model || 'sonnet')}</span>
            </div>
          </CardContent>
        </Card>

        {/* Codex Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <SourceBadge source="codex" /> Codex
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credits Used (today)</span>
              <span className="font-medium">{data?.codex_credits ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prompts</span>
              <span className="font-medium">{data?.codex_prompts ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {providerQuotas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">OpenAI Quotas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {providerQuotas.map((q: any) => (
              <QuotaBar
                key={q.window_name}
                percent={q.used_percent ?? 0}
                label={q.window_name === 'primary' ? 'Weekly' : '5hr'}
                resetText={formatQuotaReset(q.resets_at)}
              />
            ))}
            {providerQuotas[0]?.plan_type && (
              <div className="text-xs text-muted-foreground">Plan: {providerQuotas[0].plan_type.toUpperCase()}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Developer Profile */}
      {(() => {
        const profile = aiProfile?.profile || {}
        return (
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  Developer Profile
                </CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {aiProfile?.updated_at && (
                    <span>Updated: {formatDistanceToNow(parseServerDate(aiProfile.updated_at), { addSuffix: true })}</span>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleUpdateProfile} disabled={profileLoading}>
                    {profileLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!aiProfile?.profile ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm mb-3">No AI profile yet.</p>
                  <Button variant="outline" size="sm" onClick={handleUpdateProfile} disabled={profileLoading}>
                    {profileLoading ? 'Generating...' : 'Generate Profile'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Role + Languages */}
                  <div>
                    <div className="text-lg font-semibold">{profile.role_estimate}</div>
                    <div className="text-sm text-muted-foreground">{profile.primary_languages?.join(', ')}</div>
                  </div>

                  {/* Two columns: Focus + Productivity */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground uppercase">Current Focus</div>
                        <div className="text-sm">{profile.current_focus}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground uppercase">This Week</div>
                        <div className="text-sm">{profile.this_week}</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground uppercase">Productivity</div>
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold">{profile.productivity?.score || 0}</span>
                        <span className="text-lg">/100</span>
                        <span className={`text-sm font-medium ${
                          profile.productivity?.trend === 'improving' ? 'text-green-600' :
                          profile.productivity?.trend === 'declining' ? 'text-red-600' : 'text-yellow-600'
                        }`}>
                          {profile.productivity?.trend === 'improving' ? '\u2191' : profile.productivity?.trend === 'declining' ? '\u2193' : '\u2192'}
                          {profile.productivity?.trend}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${
                          (profile.productivity?.score || 0) >= 70 ? 'bg-green-500' :
                          (profile.productivity?.score || 0) >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`} style={{ width: `${Math.min(profile.productivity?.score || 0, 100)}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {profile.productivity?.prompts_per_day_avg || 0} prompts/day avg &bull; {Math.round((profile.productivity?.tool_use_ratio || 0) * 100)}% tool use
                      </div>
                    </div>
                  </div>

                  {/* Strengths + Growth */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase mb-2">Strengths</div>
                      <div className="flex flex-wrap gap-1">
                        {profile.strengths?.map((s: string) => (
                          <Badge key={s} variant="secondary" className="bg-green-500/10 text-green-700 text-xs">{s}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase mb-2">Growth Areas</div>
                      <div className="flex flex-wrap gap-1">
                        {profile.growth_areas?.map((g: string) => (
                          <Badge key={g} variant="secondary" className="bg-blue-500/10 text-blue-700 text-xs">{g}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Work Patterns */}
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Work Patterns</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                      <span>Peak: {profile.work_patterns?.peak_hours}</span>
                      <span>Avg session: {profile.work_patterns?.avg_session_length}</span>
                      <span>{profile.work_patterns?.preferred_model}</span>
                    </div>
                  </div>

                  {/* Behavioral Notes */}
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Behavioral Notes</div>
                    <p className="text-sm italic text-muted-foreground">{profile.behavioral_notes}</p>
                  </div>

                  {/* Flags */}
                  {profile.flags?.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-yellow-600 uppercase mb-1">Flags</div>
                      <div className="space-y-1">
                        {profile.flags.map((f: string, i: number) => (
                          <div key={i} className="text-sm text-yellow-700 bg-yellow-50 dark:bg-yellow-500/10 px-2 py-1 rounded">{f}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Last Week */}
                  {profile.last_week && (
                    <div className="text-xs text-muted-foreground border-t pt-2">
                      <span className="font-medium">Last week:</span> {profile.last_week}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="text-[10px] text-muted-foreground border-t pt-2">
                    Profile v{aiProfile.version} &bull; First seen: {new Date(aiProfile.created_at).toLocaleDateString()}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}

      </>)}

      {/* ═══ WATCH & SUBSCRIPTION TAB ═══ */}
      {activeTab === 'watch' && (<>
      {/* Watch Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Watch & Subscription</CardTitle>
          <CardDescription>Current watch status, assigned subscription, and credential info.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex justify-between text-sm items-center">
                <span className="text-muted-foreground">Watch Status</span>
                <WatchStatusIndicator status={watcherStatus?.connected ? 'on' : 'off'} />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subscription Email</span>
                <span className="font-medium">{user.subscription_email || user.email || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subscription Type</span>
                <span className="font-medium capitalize">{user.subscription_type || 'N/A'}</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Poll Interval</span>
                <span className="font-medium">{Math.round((user.poll_interval || 30000) / 1000)}s</span>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => id && rotateUserCredential(parseInt(id)).then(() => loadUser())}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Rotate Subscription
                </Button>
                <Button variant="destructive" size="sm" onClick={() => id && killUserCredential(parseInt(id)).then(() => loadUser())}>
                  <Skull className="w-3 h-3 mr-1" /> Revoke Credential
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Watcher Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                watcherStatus?.connected
                  ? 'bg-green-500'
                  : watcherStatus?.last_event_at
                    ? 'bg-red-500'
                    : 'bg-gray-400'
              }`}
            />
            Watcher
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <span className="text-muted-foreground">Status:</span>
            <span
              className={`font-medium ${
                watcherStatus?.connected
                  ? 'text-green-600'
                  : watcherStatus?.last_event_at
                    ? 'text-red-600'
                    : 'text-gray-500'
              }`}
            >
              {watcherStatus?.connected
                ? 'Connected'
                : watcherStatus?.last_event_at
                  ? 'Disconnected'
                  : 'Never connected'}
            </span>
            {watcherStatus?.last_event_at && (
              <>
                <span className="text-muted-foreground">Last heartbeat:</span>
                <span className="text-sm">
                  {formatDistanceToNow(parseServerDate(watcherStatus.last_event_at), { addSuffix: true })}
                </span>
              </>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRequestLogs}
              disabled={watcherLoading}
            >
              {watcherLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 mr-2" />
              )}
              Request Logs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshLogs}
              disabled={logEntryLoading}
            >
              {logEntryLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh
            </Button>
            <Button variant="destructive" size="sm" onClick={handleKill}>
              <Skull className="w-4 h-4 mr-2" />
              Kill Now
            </Button>
          </div>

          {watcherCommandQueued && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span>Command queued -- watcher will upload on next sync (up to 5 min)</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Watcher Logs Viewer */}
      {(watcherLogs || logHistory.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Watcher Logs
            </CardTitle>
            {watcherLogs?.uploaded_at && (
              <CardDescription className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Last uploaded: {formatDistanceToNow(parseServerDate(watcherLogs.uploaded_at), { addSuffix: true })}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Log History List */}
            {logHistory.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Log History (click to view):</p>
                <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                  {logHistory.map((entry: any) => (
                    <button
                      key={entry.id}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between gap-4 ${
                        selectedLogId === entry.id ? 'bg-muted/70 font-medium' : ''
                      }`}
                      onClick={() => loadLogEntry(entry.id)}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">
                          {entry.uploaded_at
                            ? format(parseServerDate(entry.uploaded_at), 'MMM d, yyyy HH:mm')
                            : 'Unknown'}
                        </span>
                      </span>
                      <span className="flex items-center gap-3 text-muted-foreground flex-shrink-0">
                        <span>Hook: {entry.hook_log_size ? formatBytes(entry.hook_log_size) : '0B'}</span>
                        <span>Watcher: {entry.watcher_log_size ? formatBytes(entry.watcher_log_size) : '0B'}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Log Content Tabs */}
            {watcherLogs && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1 border-b">
                    <button
                      className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                        activeLogTab === 'hook'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setActiveLogTab('hook')}
                    >
                      Hook Log
                      {watcherLogs.hook_log && (
                        <span className="ml-1.5 text-muted-foreground font-normal">
                          ({formatBytes(watcherLogs.hook_log.length)})
                        </span>
                      )}
                    </button>
                    <button
                      className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                        activeLogTab === 'watcher'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setActiveLogTab('watcher')}
                    >
                      Watcher Log
                      {watcherLogs.watcher_log && (
                        <span className="ml-1.5 text-muted-foreground font-normal">
                          ({formatBytes(watcherLogs.watcher_log.length)})
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleCopyLog}
                      disabled={!(activeLogTab === 'hook' ? watcherLogs.hook_log : watcherLogs.watcher_log)}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      {copySuccess ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleDownloadLog}
                      disabled={!(activeLogTab === 'hook' ? watcherLogs.hook_log : watcherLogs.watcher_log)}
                    >
                      <Download className="w-3.5 h-3.5 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>

                {logEntryLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div
                    className="bg-muted/30 rounded-md p-3 font-mono text-xs overflow-y-auto"
                    style={{ maxHeight: 400, whiteSpace: 'pre-wrap' }}
                  >
                    {(() => {
                      const logContent = activeLogTab === 'hook'
                        ? watcherLogs.hook_log
                        : watcherLogs.watcher_log
                      if (!logContent) {
                        return <span className="text-muted-foreground italic">No log data available.</span>
                      }
                      const lines = logContent.split('\n')
                      return lines.map((line: string, idx: number) => (
                        <div key={idx} className="flex">
                          <span className="select-none text-muted-foreground/50 w-10 text-right pr-3 flex-shrink-0">
                            {idx + 1}
                          </span>
                          <span className={line.match(/^\[.*?\]/) ? '' : ''}>
                            {line.match(/^(\[.*?\])(.*)/) ? (
                              <>
                                <span className="text-blue-500">{line.match(/^(\[.*?\])/)?.[1]}</span>
                                {line.replace(/^\[.*?\]/, '')}
                              </>
                            ) : line}
                          </span>
                        </div>
                      ))
                    })()}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>Watcher polls every 5 min. Logs appear after next sync.</span>
            </div>
          </CardContent>
        </Card>
      )}

      </>)}

      {/* ═══ PROFILE TAB continued (Config, Summary, Charts) ═══ */}
      {activeTab === 'profile' && (<>
      {/* User Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            User Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Notifications */}
            <div>
              <h4 className="text-sm font-medium mb-3">Notifications</h4>
              <div className="space-y-3">
                {([
                  ['on_stop', 'Task Completed'],
                  ['on_block', 'Prompt Blocked'],
                  ['on_credit_warning', 'Credit Warnings'],
                  ['on_kill', 'Kill/Pause Alerts'],
                  ['sound', 'Sound'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <button
                      className={`w-10 h-5 rounded-full transition-colors relative ${notifConfig[key] ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      onClick={() => toggleNotification(key)}
                    >
                      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-0.5 ${notifConfig[key] ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Watcher Settings */}
            <div>
              <h4 className="text-sm font-medium mb-3">Watcher</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">Poll Interval</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      className="w-24 h-8 text-sm"
                      value={pollIntervalInput}
                      onChange={(e) => setPollIntervalInput(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">seconds</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={handleSavePollInterval}
                      disabled={pollSaving}
                    >
                      {pollSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Antigravity Collection</div>
                    <div className="text-xs text-muted-foreground">Collect prompts from Google Antigravity IDE</div>
                  </div>
                  <button
                    className={`w-10 h-5 rounded-full transition-colors ${data?.antigravity_collection !== 0 ? 'bg-green-500' : 'bg-gray-300'}`}
                    onClick={async () => {
                      const newVal = data?.antigravity_collection === 0 ? 1 : 0
                      try {
                        await updateUser(id!, { antigravity_collection: newVal })
                        loadUser()
                      } catch {}
                    }}
                  >
                    <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${data?.antigravity_collection !== 0 ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Antigravity Interval</div>
                    <div className="text-xs text-muted-foreground">Collection frequency (seconds)</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="w-20 h-8 rounded border border-input px-2 text-sm"
                      defaultValue={Math.round((data?.antigravity_interval || 120000) / 1000)}
                      min={30}
                      max={600}
                      onBlur={async (e) => {
                        const sec = parseInt(e.target.value) || 120
                        const ms = Math.max(30000, Math.min(600000, sec * 1000))
                        try { await updateUser(id!, { antigravity_interval: ms }); loadUser() } catch {}
                      }}
                    />
                    <span className="text-xs text-muted-foreground">sec</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Summary + Devices / Limits */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code2 className="w-5 h-5 text-primary" />
              Latest AI Summary
            </CardTitle>
            <CardDescription>
              {latestSummary
                ? new Date(latestSummary.generated_at).toLocaleDateString()
                : 'No recent summary'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            {latestSummary ? (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed">{latestSummary.summary_text}</p>

                {/* Categories as tags */}
                {latestSummary.categories && (() => {
                  let cats: Record<string, number> = {}
                  try {
                    cats = typeof latestSummary.categories === 'string'
                      ? JSON.parse(latestSummary.categories)
                      : latestSummary.categories
                  } catch { /* ignore */ }
                  const entries = Object.entries(cats).filter(([,v]) => v > 0)
                  if (entries.length === 0) return null
                  return (
                    <div className="flex flex-wrap gap-2">
                      {entries.map(([cat, count], idx) => (
                        <Badge
                          key={cat}
                          variant="outline"
                          className="text-xs capitalize"
                          style={{
                            borderColor: COLORS[idx % COLORS.length],
                            color: COLORS[idx % COLORS.length],
                          }}
                        >
                          {cat.replace(/_/g, ' ')} ({count})
                        </Badge>
                      ))}
                    </div>
                  )
                })()}

                {/* Scores */}
                <div className="space-y-3">
                  {latestSummary.productivity_score != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Productivity</span>
                        <span className="font-medium">{latestSummary.productivity_score}/100</span>
                      </div>
                      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${latestSummary.productivity_score}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                  {latestSummary.prompt_quality_score != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Quality</span>
                        <span className="font-medium">
                          {latestSummary.prompt_quality_score}/100
                        </span>
                      </div>
                      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${latestSummary.prompt_quality_score}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                  {latestSummary.model_efficiency_score != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Efficiency</span>
                        <span className="font-medium">
                          {latestSummary.model_efficiency_score}/100
                        </span>
                      </div>
                      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full"
                          style={{ width: `${latestSummary.model_efficiency_score}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No AI summary available for this user yet.
              </p>
            )}
          </CardContent>
          <CardFooter className="bg-muted/30 p-4 border-t mt-auto">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGenerateSummary}
              disabled={generatingSummary}
            >
              {generatingSummary && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Generate Summary Now
            </Button>
          </CardFooter>
        </Card>

        <div className="flex flex-col gap-6">
          {/* Devices Table */}
          <Card>
            <CardHeader>
              <CardTitle>Devices</CardTitle>
            </CardHeader>
            <CardContent>
              {devices?.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hostname</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead>OS</TableHead>
                      <TableHead>Claude</TableHead>
                      <TableHead className="text-right">Last Seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices.map((dev: any) => (
                      <TableRow key={dev.id}>
                        <TableCell className="font-medium text-xs">{dev.hostname}</TableCell>
                        <TableCell className="text-xs">
                          {dev.platform} ({dev.arch})
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {dev.os_version || '-'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {dev.claude_version || '-'}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {dev.last_seen
                            ? formatDistanceToNow(parseServerDate(dev.last_seen), { addSuffix: true })
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground italic">No devices registered.</p>
              )}
            </CardContent>
          </Card>

          {/* Rate Limits */}
          <Card className="flex-1">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Rate Limits</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowLimits(true)}>
                  Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {limits.length > 0 ? (
                <div className="space-y-2">
                  {limits.map((lim: any, idx: number) => (
                    <div key={idx} className="flex justify-between p-2 border rounded text-sm">
                      <span className="font-medium capitalize">{lim.type}</span>
                      <span className="text-muted-foreground">
                        {lim.value} per {lim.window}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm border border-dashed p-4 text-center rounded text-muted-foreground">
                  No limits active for this user.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 4 Charts */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Daily Usage (30d)</CardTitle>
          </CardHeader>
          <CardContent className="h-40">
            {allPrompts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyUsageData}>
                  <defs>
                    <linearGradient id="colorPrompts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="prompts"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#colorPrompts)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No data yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Model Dist.</CardTitle>
          </CardHeader>
          <CardContent className="h-40">
            {modelDistData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Tooltip content={<CustomTooltip />} />
                  <Pie
                    data={modelDistData}
                    innerRadius={20}
                    outerRadius={40}
                    dataKey="value"
                    stroke="none"
                  >
                    {modelDistData.map((_entry, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </RePieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No data yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Tools</CardTitle>
          </CardHeader>
          <CardContent className="h-40">
            {toolUsageData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={toolUsageData}
                  layout="vertical"
                  margin={{ left: -20, right: 0, top: 0, bottom: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="uses" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No data yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Peak Hours</CardTitle>
          </CardHeader>
          <CardContent className="h-40">
            {allPrompts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={peakHoursData}>
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 8 }}
                    interval={3}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No data yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Projects + Recent Sessions */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Folder className="w-5 h-5 text-muted-foreground" />
              Top Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProjects.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Prompts</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topProjects.map((proj, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium text-sm flex items-center gap-2">
                        <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="truncate max-w-[200px]">{proj.name}</span>
                      </TableCell>
                      <TableCell className="text-right">{proj.prompt_count}</TableCell>
                      <TableCell className="text-right">
                        {Number(proj.cost)} credits
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center p-4 border border-dashed rounded text-muted-foreground text-sm">
                No project data available.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-muted-foreground" />
              Recent Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : sessions.length > 0 ? (
              <div className="space-y-4">
                {sessions.slice(0, 10).map((session: any) => (
                  <div
                    key={session.id}
                    className="border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex justify-between items-center">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm flex gap-2 items-center flex-wrap">
                          <span className="truncate max-w-[160px]">
                            {extractProjectName(session.cwd) || 'Unknown project'}
                          </span>
                          <Badge
                            variant={modelBadgeVariant(session.model || '')}
                            className="text-[10px] uppercase font-mono"
                          >
                            {normalizeModel(session.model || '')}
                          </Badge>
                          {session.ai_productivity_score != null && (
                            <Badge variant="outline" className={`text-[10px] ${
                              session.ai_productivity_score >= 70 ? 'border-green-500 text-green-600' :
                              session.ai_productivity_score >= 40 ? 'border-yellow-500 text-yellow-600' : 'border-red-500 text-red-600'
                            }`}>
                              {session.ai_productivity_score}/100
                            </Badge>
                          )}
                          {!session.ai_summary && session.ended_at && !session.ai_productivity_score && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground animate-pulse">
                              Analyzing...
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {session.started_at
                            ? formatDistanceToNow(parseServerDate(session.started_at), { addSuffix: true })
                            : 'Unknown time'}{' '}
                          &bull;{' '}
                          {formatDuration(session.duration_ms || session.duration || 0)}
                        </div>
                      </div>
                      <div className="text-right text-sm ml-4">
                        <div>{session.prompt_count || 0} prompts</div>
                        <div className="text-xs text-muted-foreground">
                          {Number(session.total_cost_usd || session.cost || 0)} credits
                        </div>
                      </div>
                    </div>
                    {session.ai_summary && (
                      <div className="mt-1.5 text-xs text-muted-foreground italic pl-1">{session.ai_summary}</div>
                    )}
                    {session.ai_categories && (() => {
                      let cats: string[] = []
                      try {
                        cats = typeof session.ai_categories === 'string' ? JSON.parse(session.ai_categories) : session.ai_categories
                      } catch {}
                      if (!Array.isArray(cats) || cats.length === 0) return null
                      return (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {cats.map((cat: string) => (
                            <Badge key={cat} variant="outline" className="text-[10px] capitalize">{cat.replace(/_/g, ' ')}</Badge>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground text-sm italic border border-dashed rounded py-4">
                No recent sessions.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      </>)}

      {/* ═══ PROMPTS TAB ═══ */}
      {activeTab === 'prompts' && (<>
      {/* Recent Prompts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex justify-between items-center gap-4">
            <span>Recent Prompts</span>
            <div className="flex items-center gap-2">
              <SourceFilter value={promptSource} onChange={(v) => { setPromptSource(v); setPromptPage(1) }} />
              <Input
                type="text"
                placeholder="Search prompts..."
                className="w-48 h-8 text-xs"
                value={promptSearch}
                onChange={(e) => {
                  setPromptSearch(e.target.value)
                  setPromptPage(1)
                }}
              />
              <span className="text-sm font-normal text-muted-foreground whitespace-nowrap">
                {promptsTotal} total
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {promptsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : prompts.length > 0 ? (
            <div className="space-y-3">
              {prompts.map((p: any) => {
                const isExpanded = expandedPrompt === p.id
                return (
                  <div key={p.id} className="border rounded-md p-3 text-sm">
                    <div className="flex justify-between items-center mb-2 border-b pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {p.timestamp || p.created_at
                            ? formatDistanceToNow(parseServerDate(p.timestamp || p.created_at), {
                                addSuffix: true,
                              })
                            : 'Unknown'}
                        </span>
                        <Badge
                          variant={modelBadgeVariant(p.model || '')}
                          className="text-[10px] uppercase"
                        >
                          {normalizeModel(p.model || '')}
                        </Badge>
                        {(() => {
                          const pSession = data?.sessions?.find((s: any) => s.id === p.session_id)
                          const projName = pSession?.cwd ? extractProjectName(pSession.cwd) : null
                          return projName && projName !== 'unknown' ? (
                            <Badge variant="outline" className="text-[10px]">
                              <Folder className="w-3 h-3 mr-1 inline" /> {projName}
                            </Badge>
                          ) : null
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        {p.turn_duration_ms && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatDuration(p.turn_duration_ms)}
                          </span>
                        )}
                        <span className="text-muted-foreground text-[10px]">
                          {p.tools_used?.length || 0} tools
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setExpandedPrompt(isExpanded ? null : p.id)}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div
                      className={`font-mono text-xs bg-muted/30 p-2 rounded mb-2 whitespace-pre-wrap ${isExpanded ? '' : 'max-h-16 overflow-hidden'}`}
                    >
                      {p.prompt || p.prompt_text || (
                        <span className="italic text-muted-foreground">
                          Prompt text not collected
                        </span>
                      )}
                    </div>
                    {isExpanded && (p.response || p.response_text) && (
                      <div className="text-xs border-l-2 border-primary pl-2 text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
                        {p.response || p.response_text}
                      </div>
                    )}
                    {isExpanded && p.tools_used && p.tools_used.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {p.tools_used.map((tool: any, idx: number) => (
                          <Badge key={idx} variant="outline" className="text-[10px]">
                            {typeof tool === 'string' ? tool : tool.name || tool.tool || 'unknown'}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Pagination */}
              <div className="flex justify-between items-center pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={promptPage <= 1}
                  onClick={() => setPromptPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Prev
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {promptPage} of {promptTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={promptPage >= promptTotalPages}
                  onClick={() => setPromptPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center p-8 border border-dashed rounded text-muted-foreground text-sm">
              {promptSearch ? 'No prompts matching your search.' : 'No recent prompts tracked.'}
            </div>
          )}
        </CardContent>
      </Card>

      </>)}

      {/* ═══ ACTIVITY TAB ═══ */}
      {activeTab === 'activity' && (
        <div className="space-y-6">
          {activityLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Work Windows */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Work Windows</CardTitle>
                  <CardDescription>Active time windows detected from file events and app tracking.</CardDescription>
                </CardHeader>
                <CardContent>
                  {activityWindows.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No work windows recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {activityWindows.map((w: any, i: number) => (
                        <div key={i} className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-2 text-sm">
                          <div className="flex items-center gap-3">
                            <span className="font-medium">{w.date || new Date(w.startTime || w.start_time).toLocaleDateString()}</span>
                            <span className="text-muted-foreground">{w.startTime || w.start_time ? new Date(w.startTime || w.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''} - {w.endTime || w.end_time ? new Date(w.endTime || w.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{w.durationMinutes || w.duration_minutes ? `${w.durationMinutes || w.duration_minutes} min` : ''}</span>
                            <span>{w.eventCount || w.event_count || 0} events</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Activity Events */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Recent Activity</CardTitle>
                  <CardDescription>File events, app tracking, and other activity signals.</CardDescription>
                </CardHeader>
                <CardContent>
                  {activityData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No activity data recorded yet.</p>
                  ) : (
                    <div className="space-y-1 max-h-96 overflow-y-auto">
                      {activityData.slice(0, 100).map((evt: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                          <span className="text-xs text-muted-foreground w-20 flex-shrink-0">
                            {evt.timestamp || evt.created_at ? new Date(evt.timestamp || evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                          </span>
                          <Badge variant="outline" className="text-[10px]">{evt.type || evt.event_type || 'event'}</Badge>
                          <span className="truncate text-sm">{evt.description || evt.path || evt.app_name || evt.details || JSON.stringify(evt.data || {}).slice(0, 100)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ═══ PROJECTS TAB ═══ */}
      {activeTab === 'projects' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Project Memberships</CardTitle>
            <CardDescription>Projects this user belongs to and their role in each.</CardDescription>
          </CardHeader>
          <CardContent>
            {userProjectsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : userProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">This user is not a member of any projects.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userProjects.map((proj: any) => (
                    <TableRow key={proj.id}>
                      <TableCell>
                        <Link to={`/projects/${proj.id}`} className="font-medium text-blue-600 hover:underline">{proj.name}</Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">{proj.memberRole}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{proj.description || '-'}</TableCell>
                      <TableCell className="text-right">
                        <Link to={`/projects/${proj.id}`} className="text-sm text-blue-600 hover:underline">View</Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ TASKS TAB ═══ */}
      {activeTab === 'tasks' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Assigned Tasks</CardTitle>
            <CardDescription>Tasks assigned to this user across all projects.</CardDescription>
          </CardHeader>
          <CardContent>
            {userTasksLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : userTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No tasks assigned to this user.</p>
            ) : (
              <div className="space-y-2">
                {userTasks.map((task: any) => (
                  <div key={task.id} className="flex items-center justify-between bg-white border rounded-lg p-3">
                    <div>
                      <Link to={`/tasks/${task.id}`} className="font-medium text-blue-600 hover:underline">{task.title}</Link>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${task.status === 'done' ? 'bg-green-100 text-green-700' : task.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700'}`}>{task.status}</span>
                      <span className="ml-2 text-xs text-gray-500">{task.priority}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <Link to={`/projects/${task.projectId}`} className="text-xs hover:underline">{task.projectName}</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ SESSIONS TAB ═══ */}
      {activeTab === 'sessions' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="w-5 h-5 text-muted-foreground" />
              All Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : sessions.length > 0 ? (
              <div className="space-y-4">
                {sessions.map((session: any) => (
                  <div key={session.id} className="border-b pb-3 last:border-0 last:pb-0">
                    <div className="flex justify-between items-center">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm flex gap-2 items-center flex-wrap">
                          <span className="truncate max-w-[200px]">
                            {extractProjectName(session.cwd) || 'Unknown project'}
                          </span>
                          <Badge variant={modelBadgeVariant(session.model || '')} className="text-[10px] uppercase font-mono">
                            {normalizeModel(session.model || '')}
                          </Badge>
                          {session.ai_productivity_score != null && (
                            <Badge variant="outline" className={`text-[10px] ${session.ai_productivity_score >= 70 ? 'border-green-500 text-green-600' : session.ai_productivity_score >= 40 ? 'border-yellow-500 text-yellow-600' : 'border-red-500 text-red-600'}`}>
                              {session.ai_productivity_score}/100
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {session.started_at ? formatDistanceToNow(parseServerDate(session.started_at), { addSuffix: true }) : 'Unknown time'} &bull; {formatDuration(session.duration_ms || session.duration || 0)}
                        </div>
                      </div>
                      <div className="text-right text-sm ml-4">
                        <div>{session.prompt_count || 0} prompts</div>
                        <div className="text-xs text-muted-foreground">{Number(session.total_cost_usd || session.cost || 0)} credits</div>
                      </div>
                    </div>
                    {session.ai_summary && (
                      <div className="mt-1.5 text-xs text-muted-foreground italic pl-1">{session.ai_summary}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground text-sm italic border border-dashed rounded py-4">
                No sessions recorded.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ LIMITS TAB ═══ */}
      {activeTab === 'limits' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="text-lg">Rate Limits</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setShowLimits(true)}>
                <Settings2 className="w-4 h-4 mr-2" /> Edit Limits
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {limits.length > 0 ? (
              <div className="space-y-2">
                {limits.map((lim: any, idx: number) => (
                  <div key={idx} className="flex justify-between p-3 border rounded-lg text-sm">
                    <span className="font-medium capitalize">{lim.type}</span>
                    <span className="text-muted-foreground">{lim.value} per {lim.window}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm border border-dashed p-8 text-center rounded text-muted-foreground">
                No limits active for this user. Click "Edit Limits" to configure rate limits.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modals */}
      {showLimits && (
        <EditLimitsModal
          user={{ ...user, limits }}
          onClose={() => setShowLimits(false)}
          onSuccess={() => {
            setShowLimits(false)
            loadUser()
          }}
        />
      )}
      {confirmAction && (
        <ConfirmActionModal
          user={user}
          action={confirmAction}
          onClose={() => setConfirmAction(null)}
          onSuccess={() => {
            setConfirmAction(null)
            loadUser()
          }}
        />
      )}
    </div>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background border rounded-md shadow-md p-2 text-xs">
        <p className="font-medium">{label}</p>
        <p className="text-primary">{`${payload[0].name}: ${payload[0].value}`}</p>
      </div>
    )
  }
  return null
}
