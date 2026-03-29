import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getUser, getUserPrompts, getUserSessions, generateSummary, getSubscriptions, getWatcherStatus, getWatcherLogs, sendWatcherCommand } from '@/lib/api'
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
  Monitor,
  Zap,
  Bell,
  Skull,
  FileText,
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
import { formatDistanceToNow, format } from 'date-fns'

const COLORS = ['#3b82f6', '#a855f7', '#f97316', '#22c55e', '#ef4444', '#06b6d4']

// ── Helpers ───────────────────────────────────────────────
function normalizeModel(model: string): string {
  if (!model) return 'Unknown'
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
  const [activeLogTab, setActiveLogTab] = useState<'hook' | 'watcher'>('hook')
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Modal states
  const [showLimits, setShowLimits] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'killed' | 'paused' | 'active' | null>(null)
  const [generatingSummary, setGeneratingSummary] = useState(false)

  // All prompts for charts (larger set)
  const [allPrompts, setAllPrompts] = useState<any[]>([])

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
      const res = await getUserPrompts(id, params)
      setPrompts(res?.data || res?.prompts || [])
      setPromptsTotal(res?.total || 0)
    } catch (err) {
      console.error('Failed to load prompts', err)
    } finally {
      setPromptsLoading(false)
    }
  }, [id, promptPage, promptSearch])

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
      const res = await getUserPrompts(id, { limit: '500' })
      setAllPrompts(res?.data || res?.prompts || [])
    } catch (_err) {
      // Chart data is nice-to-have, don't block on it
    }
  }, [id])

  useEffect(() => {
    loadUser()
  }, [loadUser])

  useEffect(() => {
    loadPrompts()
  }, [loadPrompts])

  useEffect(() => {
    loadSessions()
    loadAllPromptsForCharts()
    if (id) {
      getWatcherStatus(id).then(setWatcherStatus).catch(() => {})
    }
  }, [loadSessions, loadAllPromptsForCharts, id])

  // Cleanup log polling on unmount
  useEffect(() => {
    return () => {
      if (logPollRef.current) clearInterval(logPollRef.current)
    }
  }, [])

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
      const dir = p.project_dir || 'unknown'
      const cur = map.get(dir) || { count: 0, cost: 0 }
      cur.count++
      cur.cost += Number(p.credit_cost || p.cost_usd || p.cost || 0)
      map.set(dir, cur)
    }
    return Array.from(map.entries())
      .map(([name, d]) => ({ name, prompt_count: d.count, cost: d.cost }))
      .sort((a, b) => b.prompt_count - a.prompt_count)
      .slice(0, 10)
  }, [allPrompts])

  const handleRequestLogs = useCallback(async () => {
    if (!id) return
    setWatcherLoading(true)
    setWatcherLogs(null)
    try {
      await sendWatcherCommand(id, 'upload_logs')
    } catch (_err) {
      // command send is best-effort
    }
    // Poll for logs every 2s for up to 30s
    let elapsed = 0
    if (logPollRef.current) clearInterval(logPollRef.current)
    logPollRef.current = setInterval(async () => {
      elapsed += 2000
      try {
        const logs = await getWatcherLogs(id)
        if (logs && (logs.hook_log || logs.watcher_log)) {
          setWatcherLogs(logs)
          setWatcherLoading(false)
          if (logPollRef.current) clearInterval(logPollRef.current)
        }
      } catch (_err) {
        // keep polling
      }
      if (elapsed >= 30000) {
        setWatcherLoading(false)
        if (logPollRef.current) clearInterval(logPollRef.current)
      }
    }, 2000)
  }, [id])

  const handleSendNotification = useCallback(async () => {
    if (!id) return
    const message = window.prompt('Enter notification message:')
    if (!message) return
    try {
      await sendWatcherCommand(id, 'notify', message)
    } catch (_err) {
      console.error('Failed to send notification')
    }
  }, [id])

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
  const stats = data.stats || data.analytics || {}
  const limits = user?.limits || data.limits || []

  const totalPrompts = stats.total_prompts ?? stats.allTime?.prompts ?? 0
  const promptsToday = stats.prompts_today ?? stats.today?.prompts ?? 0
  const totalCost = stats.total_cost ?? stats.allTime?.cost ?? 0
  const totalSessions = stats.total_sessions ?? stats.allTime?.sessions ?? 0
  const sessionsToday = stats.sessions_today ?? stats.today?.sessions ?? 0
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
          <Button variant="destructive" onClick={() => setConfirmAction('killed')}>
            <Trash2 className="w-4 h-4 mr-2" />
            Kill User
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Prompts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{totalPrompts}</div>
            <p className="text-xs text-muted-foreground">+{promptsToday} today</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Credits</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{Number(totalCost)} credits</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{totalSessions}</div>
            <p className="text-xs text-muted-foreground">+{sessionsToday} today</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Devices</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold flex items-center gap-2">
              <Monitor className="w-5 h-5 text-muted-foreground" />
              {deviceCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Watcher */}
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
          <div className="flex items-center gap-4 text-sm">
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
                  {formatDistanceToNow(new Date(watcherStatus.last_event_at), { addSuffix: true })}
                </span>
              </>
            )}
          </div>

          <div className="flex gap-2">
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
            <Button variant="outline" size="sm" onClick={handleSendNotification}>
              <Bell className="w-4 h-4 mr-2" />
              Send Notification
            </Button>
            <Button variant="destructive" size="sm" onClick={handleKill}>
              <Skull className="w-4 h-4 mr-2" />
              Kill Now
            </Button>
          </div>

          {watcherLogs && (
            <div className="space-y-2">
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
                </button>
              </div>
              <div
                className="bg-muted/30 rounded-md p-3 font-mono text-xs overflow-y-auto"
                style={{ maxHeight: 300, whiteSpace: 'pre-wrap' }}
              >
                {(activeLogTab === 'hook'
                  ? watcherLogs.hook_log
                  : watcherLogs.watcher_log
                )
                  ?.split('\n')
                  .reverse()
                  .join('\n') || (
                  <span className="text-muted-foreground italic">No log data available.</span>
                )}
              </div>
            </div>
          )}
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
                            ? formatDistanceToNow(new Date(dev.last_seen), { addSuffix: true })
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
                    className="flex justify-between items-center border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm flex gap-2 items-center flex-wrap">
                        <span className="truncate max-w-[160px]">
                          {session.project_dir || 'Unknown project'}
                        </span>
                        <Badge
                          variant={modelBadgeVariant(session.model || '')}
                          className="text-[10px] uppercase font-mono"
                        >
                          {normalizeModel(session.model || '')}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {session.started_at
                          ? formatDistanceToNow(new Date(session.started_at), { addSuffix: true })
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

      {/* Recent Prompts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex justify-between items-center gap-4">
            <span>Recent Prompts</span>
            <div className="flex items-center gap-2">
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
                            ? formatDistanceToNow(new Date(p.timestamp || p.created_at), {
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
                        {p.project_dir && (
                          <Badge variant="outline" className="text-[10px]">
                            <Folder className="w-3 h-3 mr-1 inline" /> {p.project_dir}
                          </Badge>
                        )}
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
