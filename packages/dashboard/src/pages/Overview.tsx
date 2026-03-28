import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getUsers, getSubscriptions, getAnalytics, getLeaderboard, updateUser, getTamperAlerts, resolveTamperAlert } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useWSStore, useWSEvent } from '@/hooks/useWebSockets'
import {
  Loader2,
  Users,
  Activity,
  MessageSquare,
  Coins,
  Play,
  Pause,
  Trash,
  Plus,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react'
import { AddUserModal } from '@/components/AddUserModal'
import { ConfirmActionModal } from '@/components/ConfirmActionModal'
import { formatDistanceToNow } from 'date-fns'

// ── Helpers ───────────────────────────────────────────────
function eventColor(type: string): string {
  switch (type) {
    case 'prompt_submitted':
      return 'text-blue-500'
    case 'prompt_blocked':
      return 'text-yellow-600'
    case 'turn_completed':
      return 'text-green-500'
    case 'session_started':
    case 'session_ended':
      return 'text-muted-foreground'
    case 'tool_used':
      return 'text-purple-500'
    case 'tool_failed':
      return 'text-red-500'
    case 'rate_limit_hit':
      return 'text-red-600'
    case 'user_killed':
      return 'text-red-600'
    case 'user_paused':
      return 'text-yellow-600'
    default:
      return 'text-muted-foreground'
  }
}

function eventBgClass(type: string): string {
  switch (type) {
    case 'prompt_submitted':
      return 'border-l-blue-500'
    case 'prompt_blocked':
      return 'border-l-yellow-500'
    case 'turn_completed':
      return 'border-l-green-500'
    case 'session_started':
    case 'session_ended':
      return 'border-l-gray-400'
    case 'tool_used':
      return 'border-l-purple-500'
    case 'tool_failed':
      return 'border-l-red-400'
    case 'rate_limit_hit':
    case 'user_killed':
      return 'border-l-red-600'
    case 'user_paused':
      return 'border-l-yellow-600'
    default:
      return 'border-l-gray-300'
  }
}

function eventDescription(evt: { type: string; payload: Record<string, unknown> }): string {
  const p = evt.payload
  switch (evt.type) {
    case 'prompt_submitted':
      return `submitted a prompt${p.model ? ` via ${normalizeModel(p.model as string)}` : ''}`
    case 'prompt_blocked':
      return `prompt was blocked${p.reason ? `: ${p.reason}` : ''}`
    case 'turn_completed':
      return `completed a turn${p.model ? ` on ${normalizeModel(p.model as string)}` : ''}`
    case 'session_started':
      return `started a session${p.project_dir ? ` in ${p.project_dir}` : ''}`
    case 'session_ended':
      return `ended a session`
    case 'tool_used':
      return `used tool ${p.tool_name || p.tool || 'unknown'}`
    case 'tool_failed':
      return `tool failed: ${p.tool_name || p.tool || 'unknown'}`
    case 'rate_limit_hit':
      return `hit rate limit${p.limit_type ? ` (${p.limit_type})` : ''}`
    case 'user_killed':
      return `was killed`
    case 'user_paused':
      return `was paused`
    default:
      return evt.type.replace(/_/g, ' ')
  }
}

function normalizeModel(model: string): string {
  if (!model) return 'Unknown'
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'Opus'
  if (lower.includes('sonnet')) return 'Sonnet'
  if (lower.includes('haiku')) return 'Haiku'
  return model
}

function avatarColor(name: string): string {
  const colors = [
    'bg-blue-500/20 text-blue-600',
    'bg-purple-500/20 text-purple-600',
    'bg-green-500/20 text-green-600',
    'bg-orange-500/20 text-orange-600',
    'bg-pink-500/20 text-pink-600',
    'bg-cyan-500/20 text-cyan-600',
    'bg-rose-500/20 text-rose-600',
    'bg-teal-500/20 text-teal-600',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

// ── Component ─────────────────────────────────────────────
export function Overview() {
  const [showAddModal, setShowAddModal] = useState(false)
  const [users, setUsers] = useState<any[]>([])
  const [subscriptions, setSubscriptions] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [leaderMap, setLeaderMap] = useState<Map<string, any>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    user: any
    action: 'killed' | 'paused' | 'active'
  } | null>(null)
  const [expandedSub, setExpandedSub] = useState<string | null>(null)
  const [tamperAlerts, setTamperAlerts] = useState<any[]>([])
  const [resolvingAlert, setResolvingAlert] = useState<number | null>(null)
  const events = useWSStore((s) => s.events)
  const wsStatus = useWSStore((s) => s.status)

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [usersRes, subsRes, analyticsRes, leaderRes, tamperRes] = await Promise.all([
        getUsers(),
        getSubscriptions(),
        getAnalytics(1),
        getLeaderboard(30).catch(() => ({ data: [] })),
        getTamperAlerts().catch(() => ({ data: [] })),
      ])
      setUsers(usersRes?.data || usersRes?.users || [])
      setSubscriptions(subsRes?.data || subsRes?.subscriptions || [])
      setAnalytics(analyticsRes?.overview || {})
      setTamperAlerts(tamperRes?.data || tamperRes?.alerts || [])
      const lMap = new Map()
      for (const entry of leaderRes?.data || leaderRes?.leaderboard || []) {
        lMap.set(String(entry.user_id || entry.id), entry)
      }
      setLeaderMap(lMap)
    } catch (err) {
      console.error('Failed to load overview data', err)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadData()
  }, [loadData])

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      loadData()
    }, 30000)
    return () => clearInterval(interval)
  }, [loadData])

  // Refresh on relevant WS events
  useWSEvent('prompt_submitted', loadData)
  useWSEvent('turn_completed', loadData)
  useWSEvent('session_started', loadData)
  useWSEvent('session_ended', loadData)
  useWSEvent('user_killed', loadData)
  useWSEvent('user_paused', loadData)

  const handleQuickAction = useCallback(
    async (user: any, action: 'killed' | 'paused' | 'active') => {
      try {
        await updateUser(user.id, { status: action })
        loadData()
      } catch (_err) {
        // ConfirmActionModal handles its own errors
      }
    },
    [loadData]
  )

  const handleResolveAlert = useCallback(
    async (alertId: number) => {
      setResolvingAlert(alertId)
      try {
        await resolveTamperAlert(alertId)
        loadData()
      } catch (_err) {
        console.error('Failed to resolve alert')
      } finally {
        setResolvingAlert(null)
      }
    },
    [loadData]
  )

  // ── Loading state ─────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────
  if (error && users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={loadData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  const totalUsers = analytics?.total_users ?? users.length
  const activeNow = analytics?.active_now ?? users.filter((u: any) => u.status === 'active').length
  const promptsToday = analytics?.prompts_today ?? 0
  const costToday = analytics?.cost_today ?? 0

  const displayEvents = events.slice(0, 50)

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Monitor your team's Claude usage in real-time.</p>
      </div>

      {/* Stats Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUsers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Now</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeNow}</div>
            <p className="text-xs text-muted-foreground">Users with recent sessions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Prompts Today</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{promptsToday}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Credits Today</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Number(costToday)} credits</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-6 md:col-span-2">
          {/* Subscriptions */}
          {subscriptions.length > 0 ? (
            <div className="mb-8">
              <h2 className="text-xl font-semibold tracking-tight mb-4">Subscriptions</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {subscriptions.map((sub: any) => (
                  <Card
                    key={sub.id || sub.email}
                    className="cursor-pointer hover:border-primary/50 transition-colors group"
                    onClick={() => setExpandedSub(expandedSub === sub.email ? null : sub.email)}
                  >
                    <CardHeader className="p-4 bg-muted/30">
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-sm font-medium truncate pr-2">
                          {sub.email}
                        </CardTitle>
                        <Badge
                          variant={
                            (sub.subscription_type || sub.type || '').toLowerCase() === 'max'
                              ? 'default'
                              : 'secondary'
                          }
                          className="text-[10px] uppercase"
                        >
                          {sub.subscription_type || sub.type || 'PRO'}
                        </Badge>
                      </div>
                      <CardDescription className="text-xs">
                        {sub.user_count ?? sub.users?.length ?? 0} users &bull;{' '}
                        {sub.total_credits ?? Number(sub.total_cost || sub.cost || 0)} credits
                      </CardDescription>
                    </CardHeader>
                    {expandedSub === sub.email ? (
                      <CardContent className="px-4 py-2 border-t text-xs max-h-40 overflow-y-auto">
                        {sub.users?.map((u: any) => (
                          <div
                            key={u.id}
                            className="flex justify-between py-1 border-b last:border-0 border-muted"
                          >
                            <span>{u.name}</span>
                            <span className="text-muted-foreground flex gap-2">
                              <span>{u.prompts ?? u.usage?.prompts ?? u.prompt_count ?? 0} prompts</span>
                              <span>{u.credits ?? 0} credits</span>
                            </span>
                          </div>
                        ))}
                        {(!sub.users || sub.users.length === 0) && (
                          <span className="text-muted-foreground italic">No Active Users</span>
                        )}
                      </CardContent>
                    ) : (
                      <CardContent className="px-4 py-2 border-t text-xs text-muted-foreground group-hover:bg-muted/10">
                        Click to expand users...
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-8">
              <h2 className="text-xl font-semibold tracking-tight mb-4">Subscriptions</h2>
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  No subscriptions linked yet
                </CardContent>
              </Card>
            </div>
          )}

          {/* Users */}
          <div className="flex items-center justify-between mb-4 mt-8">
            <h2 className="text-xl font-semibold tracking-tight">Active Users</h2>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </div>

          {users.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No users yet. Click "Add User" to create your first developer profile.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {users.map((user: any) => {
                const stats = leaderMap.get(String(user.id)) || {}

                return (
                  <Card
                    key={user.id}
                    className="overflow-hidden flex flex-col hover:border-primary/50 transition-colors"
                  >
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs uppercase ${avatarColor(user.name || 'U')}`}
                          >
                            {user.name?.substring(0, 2) || 'U'}
                          </div>
                          <Link
                            to={`/users/${user.id}`}
                            className="font-semibold text-lg hover:underline truncate mr-2"
                          >
                            {user.name}
                          </Link>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {((typeof user.tamper_status === 'string' && (user.tamper_status === 'hooks_modified' || user.tamper_status === 'config_changed')) || (typeof user.tamper_status === 'object' && user.tamper_status?.status && user.tamper_status.status !== 'ok')) && (
                            <span title={`Tamper: ${(typeof user.tamper_status === 'string' ? user.tamper_status : user.tamper_status?.status || '').replace(/_/g, ' ')}`} className="text-yellow-500">
                              <ShieldAlert className="h-4 w-4" />
                            </span>
                          )}
                          <Badge
                            variant={
                              user.status === 'active'
                                ? 'success'
                                : user.status === 'paused'
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {user.status}
                          </Badge>
                        </div>
                      </div>
                      <CardDescription className="text-xs">
                        {user.subscription_email || 'No subscription linked'}
                      </CardDescription>
                    </CardHeader>
                    <Link to={`/users/${user.id}`} className="flex-1">
                      <CardContent className="p-4 pt-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="text-center p-2 bg-muted/30 rounded">
                            <div className="text-lg font-bold">{Number(stats.prompts || 0)}</div>
                            <div className="text-[10px] text-muted-foreground">Prompts</div>
                          </div>
                          <div className="text-center p-2 bg-muted/30 rounded">
                            <div className="text-lg font-bold">{Number(stats.credits ?? stats.cost_usd ?? stats.cost ?? 0)} credits</div>
                            <div className="text-[10px] text-muted-foreground">Credits</div>
                          </div>
                          <div className="text-center p-2 bg-muted/30 rounded">
                            <div className="text-lg font-bold">{Number(stats.sessions || 0)}</div>
                            <div className="text-[10px] text-muted-foreground">Sessions</div>
                          </div>
                          <div className="text-center p-2 bg-muted/30 rounded">
                            <div className="text-lg font-bold capitalize">{normalizeModel(String(stats.top_model || user.current_model || ''))}</div>
                            <div className="text-[10px] text-muted-foreground">Top Model</div>
                          </div>
                        </div>
                      </CardContent>
                    </Link>
                    <div className="p-4 border-t flex justify-between items-center bg-muted/10 mt-auto">
                      <div className="text-xs flex flex-col gap-1">
                        <span className="text-muted-foreground">
                          Model:{' '}
                          <span className="font-medium text-foreground">
                            {normalizeModel(user.current_model || '')}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          Credits:{' '}
                          <span className="font-medium text-foreground">
                            {Number(stats.credits ?? stats.cost_usd ?? stats.cost ?? 0)} credits
                          </span>
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-green-600 hover:text-green-700"
                          title="Resume"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setConfirmAction({ user, action: 'active' })
                          }}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-yellow-600 hover:text-yellow-700"
                          title="Pause"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setConfirmAction({ user, action: 'paused' })
                          }}
                        >
                          <Pause className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Kill"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setConfirmAction({ user, action: 'killed' })
                          }}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Sidebar Feed */}
        <div className="space-y-6 h-full flex flex-col">
          {/* Tamper Alerts */}
          {tamperAlerts.length > 0 && (
            <Card className="border-yellow-500/30">
              <CardHeader className="p-4 pb-2 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-yellow-500" />
                  Tamper Alerts
                  <Badge variant="warning" className="ml-auto">
                    {tamperAlerts.filter((a: any) => !a.resolved_at).length} unresolved
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-60 overflow-y-auto">
                <div className="divide-y">
                  {tamperAlerts
                    .filter((a: any) => !a.resolved_at)
                    .slice(0, 10)
                    .map((alert: any) => (
                      <div
                        key={alert.id}
                        className="p-3 text-sm hover:bg-muted/50 transition-colors border-l-2 border-l-yellow-500"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-semibold text-xs">
                            {alert.user_name || alert.user_slug || 'Unknown'}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                            {alert.detected_at
                              ? formatDistanceToNow(new Date(alert.detected_at), { addSuffix: true })
                              : ''}
                          </span>
                        </div>
                        <div className="text-xs text-yellow-600 mb-1">
                          {(alert.alert_type || alert.type || '').replace(/_/g, ' ')}
                        </div>
                        {alert.details && (
                          <div className="text-[10px] text-muted-foreground mb-1 truncate">
                            {typeof alert.details === 'string' ? alert.details : JSON.stringify(alert.details)}
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-green-600 hover:text-green-700 p-0"
                          onClick={() => handleResolveAlert(alert.id)}
                          disabled={resolvingAlert === alert.id}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          {resolvingAlert === alert.id ? 'Resolving...' : 'Resolve'}
                        </Button>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="flex-1 flex flex-col max-h-[800px]">
            <CardHeader className="p-4 pb-2 border-b">
              <CardTitle className="text-lg flex items-center justify-between">
                Live Feed
                <span className="flex items-center gap-2">
                  <span
                    className={`text-xs font-normal ${wsStatus === 'connected' ? 'text-green-500' : wsStatus === 'reconnecting' ? 'text-yellow-500' : 'text-red-500'}`}
                  >
                    {wsStatus}
                  </span>
                  <span className="relative flex h-2 w-2">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${wsStatus === 'connected' ? 'bg-green-400' : wsStatus === 'reconnecting' ? 'bg-yellow-400' : 'bg-red-400'}`}
                    ></span>
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${wsStatus === 'connected' ? 'bg-green-500' : wsStatus === 'reconnecting' ? 'bg-yellow-500' : 'bg-red-500'}`}
                    ></span>
                  </span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              {displayEvents.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No recent events. Activity will appear here in real-time.
                </div>
              ) : (
                <div className="divide-y">
                  {displayEvents.map((evt, i) => (
                    <div
                      key={i}
                      className={`p-3 text-sm hover:bg-muted/50 transition-colors border-l-2 ${eventBgClass(evt.type)}`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-xs">
                          {(evt.payload.user_name as string) ||
                            (evt.payload.user_slug as string) ||
                            'System'}
                        </span>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                          {formatDistanceToNow(new Date(evt.timestamp), { addSuffix: true })}
                        </span>
                      </div>
                      <div className={`text-xs leading-tight ${eventColor(evt.type)}`}>
                        {eventDescription(evt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {showAddModal && (
        <AddUserModal onClose={() => setShowAddModal(false)} onSuccess={loadData} />
      )}
      {confirmAction && (
        <ConfirmActionModal
          user={confirmAction.user}
          action={confirmAction.action}
          onClose={() => setConfirmAction(null)}
          onSuccess={() => {
            setConfirmAction(null)
            handleQuickAction(confirmAction.user, confirmAction.action)
            loadData()
          }}
        />
      )}
    </div>
  )
}
