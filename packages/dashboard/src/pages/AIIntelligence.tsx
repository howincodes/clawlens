import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getLatestPulse,
  getPulseHistory,
  generatePulse,
  getUserProfiles,
  updateUserProfile,
  getAnalyzedSessions,
  analyzeSession,
  getUsers,
} from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Loader2,
  Sparkles,
  Brain,
  ScrollText,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Folder,
  Zap,
  AlertTriangle,
  TrendingUp,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
  Users,
  BookOpen,
  CheckCircle2,
  Flag,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

// ── Helpers ───────────────────────────────────────────────

function parseServerDate(dateStr: string): Date {
  if (!dateStr) return new Date(0)
  return new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z')
}

function normalizeModel(model: string): string {
  if (!model) return 'Unknown'
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'OPUS'
  if (lower.includes('sonnet')) return 'SONNET'
  if (lower.includes('haiku')) return 'HAIKU'
  return model.toUpperCase()
}

function modelBadgeVariant(
  model: string
): 'default' | 'secondary' | 'warning' | 'outline' {
  const n = normalizeModel(model)
  if (n === 'OPUS') return 'default'
  if (n === 'SONNET') return 'secondary'
  if (n === 'HAIKU') return 'warning'
  return 'outline'
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-600 dark:text-green-400'
  if (score >= 40) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

function scoreBgColor(score: number): string {
  if (score >= 70) return 'bg-green-500/10'
  if (score >= 40) return 'bg-yellow-500/10'
  return 'bg-red-500/10'
}

function trendArrow(trend: string) {
  if (trend === 'improving') return <ArrowUpRight className="w-4 h-4 text-green-500 inline" />
  if (trend === 'declining') return <ArrowDownRight className="w-4 h-4 text-red-500 inline" />
  return <ArrowRight className="w-4 h-4 text-muted-foreground inline" />
}

function safeJsonParse(val: unknown): unknown {
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return val }
  }
  return val
}

function safeArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String)
  const parsed = safeJsonParse(val)
  if (Array.isArray(parsed)) return parsed.map(String)
  return []
}

// ── Tab definitions ──────────────────────────────────────

type TabId = 'pulse' | 'profiles' | 'sessions'

const tabs: { id: TabId; label: string; icon: typeof Sparkles }[] = [
  { id: 'pulse', label: 'Team Pulse', icon: Zap },
  { id: 'profiles', label: 'Developer Profiles', icon: Users },
  { id: 'sessions', label: 'Session Log', icon: ScrollText },
]

// ══════════════════════════════════════════════════════════
// ── Main Component ───────────────────────────────────────
// ══════════════════════════════════════════════════════════

export function AIIntelligence() {
  const [activeTab, setActiveTab] = useState<TabId>('pulse')

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="w-8 h-8 text-primary" />
          AI Intelligence
        </h1>
        <p className="text-muted-foreground mt-1">
          Team pulse, developer profiles, and AI-analyzed sessions.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b">
        <nav className="flex gap-6" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-1 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'pulse' && <TeamPulseTab />}
      {activeTab === 'profiles' && <DeveloperProfilesTab />}
      {activeTab === 'sessions' && <SessionLogTab />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// ── Tab 1: Team Pulse ────────────────────────────────────
// ══════════════════════════════════════════════════════════

function TeamPulseTab() {
  const [latestPulse, setLatestPulse] = useState<Record<string, unknown> | null>(null)
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pulseRes, historyRes] = await Promise.all([
        getLatestPulse(),
        getPulseHistory(5),
      ])
      setLatestPulse(pulseRes?.data ?? null)
      setHistory(historyRes?.data ?? [])
    } catch {
      console.error('Failed to load pulse data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleGenerate = async () => {
    setGenerating(true)
    setStatusMsg(null)
    try {
      const res = await generatePulse()
      if (res?.data) setLatestPulse(res.data)
      setStatusMsg({ type: 'success', text: 'Team pulse generated successfully.' })
      load()
    } catch {
      setStatusMsg({ type: 'error', text: 'Failed to generate pulse. Is Claude AI configured?' })
    } finally {
      setGenerating(false)
      setTimeout(() => setStatusMsg(null), 5000)
    }
  }

  const toggleHistoryExpand = (idx: number) => {
    setExpandedHistory((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const pulse = latestPulse?.pulse as Record<string, unknown> | undefined

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Team Pulse</h2>
        <Button onClick={handleGenerate} disabled={generating} size="sm">
          {generating ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="w-4 h-4 mr-2" /> Generate Now</>
          )}
        </Button>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div className={cn(
          'p-3 rounded-lg text-sm font-medium',
          statusMsg.type === 'success'
            ? 'bg-green-500/10 text-green-600 border border-green-200'
            : 'bg-red-500/10 text-red-600 border border-red-200'
        )}>
          {statusMsg.text}
        </div>
      )}

      {/* Latest pulse */}
      {!pulse ? (
        <Card className="p-12 text-center border-dashed bg-muted/20">
          <Zap className="mx-auto w-10 h-10 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-1">No team pulse generated yet</h3>
          <p className="text-sm text-muted-foreground">Click Generate Now to create one.</p>
        </Card>
      ) : (
        <PulseCard pulse={pulse} generatedAt={latestPulse?.created_at as string} />
      )}

      {/* Previous pulses */}
      {history.length > 1 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Previous Pulses</h3>
          {history.slice(1).map((item, idx) => {
            const p = item.pulse as Record<string, unknown> | undefined
            const isExpanded = expandedHistory.has(idx)
            return (
              <div key={idx} className="border rounded-lg">
                <button
                  onClick={() => toggleHistoryExpand(idx)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className="font-medium text-sm">{String(p?.headline || 'Team Pulse')}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {item.created_at
                      ? formatDistanceToNow(parseServerDate(String(item.created_at)), { addSuffix: true })
                      : ''}
                  </span>
                </button>
                {isExpanded && p && (
                  <div className="px-4 pb-4 border-t">
                    <PulseCard pulse={p} generatedAt={item.created_at as string} compact />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Pulse Card sub-component ─────────────────────────────

function PulseCard({
  pulse,
  generatedAt,
  compact = false,
}: {
  pulse: Record<string, unknown>
  generatedAt?: string
  compact?: boolean
}) {
  const headline = String(pulse.headline || '')
  const summary = String(pulse.active_summary || pulse.summary || '')
  const shipping = safeArray(pulse.whos_shipping).length > 0
    ? (pulse.whos_shipping as unknown[])
    : []
  const attention = safeArray(pulse.needs_attention).length > 0
    ? (pulse.needs_attention as unknown[])
    : []
  const costInsight = String(pulse.cost_insight || '')
  const trend = String(pulse.trend || '')
  const recommendations = safeArray(pulse.recommendations)

  return (
    <Card className={cn(!compact && 'shadow-md')}>
      <CardHeader className={cn(compact && 'pt-4 pb-2')}>
        <CardTitle className={cn(compact ? 'text-lg' : 'text-2xl')}>
          {headline}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary */}
        {summary && (
          <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>
        )}

        {/* Who's Shipping */}
        {shipping.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-500" />
              Who&apos;s Shipping
            </h4>
            <div className="space-y-1.5">
              {shipping.map((item, i) => {
                const obj = typeof item === 'object' && item ? (item as Record<string, string>) : null
                return (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    <span>
                      <span className="font-medium">{obj ? String(obj.user || obj.name || '') : String(item)}</span>
                      {obj?.work && <span className="text-muted-foreground"> — {obj.work}</span>}
                      {obj?.description && <span className="text-muted-foreground"> — {obj.description}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Needs Attention */}
        {attention.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Needs Attention
            </h4>
            <div className="space-y-1.5">
              {attention.map((item, i) => {
                const obj = typeof item === 'object' && item ? (item as Record<string, string>) : null
                return (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                    <span>
                      <span className="font-medium">{obj ? String(obj.user || obj.name || '') : String(item)}</span>
                      {obj?.issue && <span className="text-muted-foreground"> — {obj.issue}</span>}
                      {obj?.description && <span className="text-muted-foreground"> — {obj.description}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Cost Insight */}
        {costInsight && (
          <div>
            <h4 className="text-sm font-semibold mb-1">Cost Insight</h4>
            <p className="text-sm text-muted-foreground">{costInsight}</p>
          </div>
        )}

        {/* Trend */}
        {trend && (
          <div>
            <h4 className="text-sm font-semibold mb-1">Trend</h4>
            <p className="text-sm text-muted-foreground">{trend}</p>
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Recommendations</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              {recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Generated timestamp */}
        {generatedAt && (
          <p className="text-xs text-muted-foreground pt-2 border-t">
            Generated: {formatDistanceToNow(parseServerDate(String(generatedAt)), { addSuffix: true })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ══════════════════════════════════════════════════════════
// ── Tab 2: Developer Profiles ────────────────────────────
// ══════════════════════════════════════════════════════════

function DeveloperProfilesTab() {
  const [profiles, setProfiles] = useState<Record<string, unknown>[]>([])
  const [users, setUsers] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [profilesRes, usersRes] = await Promise.all([
        getUserProfiles(),
        getUsers(),
      ])
      setProfiles(profilesRes?.data ?? [])
      setUsers(usersRes?.data ?? usersRes?.users ?? [])
    } catch {
      console.error('Failed to load profiles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleUpdateAll = async () => {
    setUpdatingAll(true)
    setStatusMsg(null)
    try {
      const userList = users.length > 0 ? users : []
      for (const u of userList) {
        await updateUserProfile(String(u.id))
      }
      setStatusMsg({ type: 'success', text: `Updated profiles for ${userList.length} user(s).` })
      load()
    } catch {
      setStatusMsg({ type: 'error', text: 'Failed to update all profiles.' })
    } finally {
      setUpdatingAll(false)
      setTimeout(() => setStatusMsg(null), 5000)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Build a user name map for profiles that might lack a user_name field
  const userMap = new Map(users.map((u) => [String(u.id), u]))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Developer Profiles</h2>
        <Button onClick={handleUpdateAll} disabled={updatingAll} size="sm" variant="outline">
          {updatingAll ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating...</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" /> Update All Profiles</>
          )}
        </Button>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div className={cn(
          'p-3 rounded-lg text-sm font-medium',
          statusMsg.type === 'success'
            ? 'bg-green-500/10 text-green-600 border border-green-200'
            : 'bg-red-500/10 text-red-600 border border-red-200'
        )}>
          {statusMsg.text}
        </div>
      )}

      {profiles.length === 0 ? (
        <Card className="p-12 text-center border-dashed bg-muted/20">
          <Brain className="mx-auto w-10 h-10 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-1">No developer profiles yet</h3>
          <p className="text-sm text-muted-foreground">
            Profiles auto-generate every 2 hours for active users.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map((item, idx) => {
            const profile = (item.profile ?? item) as Record<string, unknown>
            const userId = String(item.user_id || '')
            const user = userMap.get(userId) as Record<string, unknown> | undefined
            const userName = String(item.user_name || user?.name || profile.name || 'Unknown')
            const score = Number(profile.productivity_score ?? profile.score ?? 0)
            const trendVal = String(profile.trend || 'stable')
            const role = String(profile.role_estimate || profile.role || '')
            const focus = String(profile.current_focus || '')
            const weekSummary = String(profile.this_week || profile.week_summary || '')
            const strengths = safeArray(profile.strengths).slice(0, 3)
            const growth = safeArray(profile.growth_areas).slice(0, 2)
            const flags = safeArray(profile.flags)

            return (
              <Card key={idx} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {userName}
                        <span className={cn('text-sm font-bold', scoreColor(score))}>
                          {score}
                        </span>
                        {trendArrow(trendVal)}
                      </CardTitle>
                      {role && (
                        <p className="text-xs text-muted-foreground mt-0.5">{role}</p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {/* Current focus */}
                  {focus && (
                    <div>
                      <span className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Focus</span>
                      <p className="text-sm mt-0.5">{focus}</p>
                    </div>
                  )}

                  {/* This week */}
                  {weekSummary && (
                    <div>
                      <span className="font-medium text-xs text-muted-foreground uppercase tracking-wide">This Week</span>
                      <p className="text-sm mt-0.5 line-clamp-2">{weekSummary}</p>
                    </div>
                  )}

                  {/* Strengths */}
                  {strengths.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {strengths.map((s, i) => (
                        <Badge key={i} variant="success" className="text-[11px] gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Growth areas */}
                  {growth.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {growth.map((g, i) => (
                        <Badge key={i} variant="secondary" className="text-[11px] gap-1">
                          <BookOpen className="w-3 h-3" />
                          {g}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Flags */}
                  {flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {flags.map((f, i) => (
                        <Badge key={i} variant="warning" className="text-[11px] gap-1">
                          <Flag className="w-3 h-3" />
                          {f}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* View profile link */}
                  {userId && (
                    <Link
                      to={`/users/${userId}`}
                      className="text-xs text-primary font-medium hover:underline inline-block pt-1"
                    >
                      View Full Profile &rarr;
                    </Link>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// ── Tab 3: Session Log ───────────────────────────────────
// ══════════════════════════════════════════════════════════

function SessionLogTab() {
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([])
  const [users, setUsers] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set())

  // Filters
  const [filterUser, setFilterUser] = useState('')
  const [filterDays, setFilterDays] = useState('7')
  const [filterMinScore, setFilterMinScore] = useState('0')

  // Pagination
  const [page, setPage] = useState(1)
  const perPage = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { days: filterDays }
      if (filterUser) params.user_id = filterUser
      if (Number(filterMinScore) > 0) params.min_score = filterMinScore

      const [sessionsRes, usersRes] = await Promise.all([
        getAnalyzedSessions(params),
        getUsers(),
      ])
      setSessions(sessionsRes?.data ?? [])
      setUsers(usersRes?.data ?? usersRes?.users ?? [])
      setPage(1)
    } catch {
      console.error('Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [filterUser, filterDays, filterMinScore])

  useEffect(() => { load() }, [load])

  const handleReanalyze = async (sessionId: string) => {
    setAnalyzingIds((prev) => new Set(prev).add(sessionId))
    try {
      await analyzeSession(sessionId)
      // Reload after a short delay for the analysis to start
      setTimeout(() => {
        load()
        setAnalyzingIds((prev) => {
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })
      }, 3000)
    } catch {
      setAnalyzingIds((prev) => {
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
  }

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sessions.length / perPage))
  const paginatedSessions = sessions.slice((page - 1) * perPage, page * perPage)

  const selectClass =
    'flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Session Log</h2>
        <Button onClick={load} disabled={loading} size="sm" variant="outline">
          <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          className={cn(selectClass, 'w-[180px]')}
          value={filterUser}
          onChange={(e) => setFilterUser(e.target.value)}
        >
          <option value="">User: All</option>
          {users.map((u) => (
            <option key={String(u.id)} value={String(u.id)}>
              {String(u.name)}
            </option>
          ))}
        </select>
        <select
          className={cn(selectClass, 'w-[150px]')}
          value={filterDays}
          onChange={(e) => setFilterDays(e.target.value)}
        >
          <option value="1">Today</option>
          <option value="7">This Week</option>
          <option value="30">This Month</option>
        </select>
        <select
          className={cn(selectClass, 'w-[180px]')}
          value={filterMinScore}
          onChange={(e) => setFilterMinScore(e.target.value)}
        >
          <option value="0">Min Score: Any</option>
          <option value="25">Min Score: 25+</option>
          <option value="50">Min Score: 50+</option>
          <option value="75">Min Score: 75+</option>
        </select>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : sessions.length === 0 ? (
        <Card className="p-12 text-center border-dashed bg-muted/20">
          <ScrollText className="mx-auto w-10 h-10 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-1">No analyzed sessions yet</h3>
          <p className="text-sm text-muted-foreground">
            Sessions are auto-analyzed when they end.
          </p>
        </Card>
      ) : (
        <>
          {/* Session cards */}
          <div className="space-y-3">
            {paginatedSessions.map((session) => (
              <SessionCard
                key={String(session.id)}
                session={session}
                analyzing={analyzingIds.has(String(session.id))}
                onReanalyze={() => handleReanalyze(String(session.id))}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Session Card sub-component ───────────────────────────

function SessionCard({
  session,
  analyzing,
  onReanalyze,
}: {
  session: Record<string, unknown>
  analyzing: boolean
  onReanalyze: () => void
}) {
  const userName = String(session.user_name || 'Unknown')
  const project = String(session.project_folder || session.project || '')
  const projectName = project ? project.split('/').pop() || project : ''
  const model = normalizeModel(String(session.model || session.primary_model || ''))
  const promptCount = Number(session.prompt_count || 0)
  const credits = Number(session.total_credits || session.credit_cost || 0)
  const score = Number(session.ai_productivity_score ?? -1)
  const startedAt = session.started_at ? parseServerDate(String(session.started_at)) : null
  const hasAnalysis = !!session.ai_summary || !!session.ai_analyzed_at

  // AI analysis fields
  const aiSummary = String(session.ai_summary || '')
  const categories = safeArray(session.ai_categories)
  const keyActions = safeArray(session.ai_key_actions)
  const toolsSummary = String(session.ai_tools_summary || '')

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-2.5">
        {/* Header row */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold">{userName}</span>
            {projectName && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Folder className="w-3.5 h-3.5" />
                {projectName}
              </span>
            )}
            <Badge variant={modelBadgeVariant(model)} className="text-[10px]">
              {model}
            </Badge>
            {promptCount > 0 && (
              <span className="text-xs text-muted-foreground">{promptCount} prompts</span>
            )}
            {credits > 0 && (
              <span className="text-xs text-muted-foreground">{Math.round(credits)} credits</span>
            )}
            {startedAt && (
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(startedAt, { addSuffix: true })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {score >= 0 ? (
              <span className={cn(
                'text-sm font-bold px-2 py-0.5 rounded-md',
                scoreColor(score),
                scoreBgColor(score)
              )}>
                <Zap className="w-3.5 h-3.5 inline mr-0.5" />{score}
              </span>
            ) : (
              !hasAnalysis && (
                <Badge variant="outline" className="text-[10px]">Not analyzed</Badge>
              )
            )}
          </div>
        </div>

        {/* AI Summary */}
        {aiSummary && (
          <p className="text-sm text-muted-foreground italic leading-relaxed">
            &ldquo;{aiSummary}&rdquo;
          </p>
        )}

        {/* Category badges */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {cat}
              </Badge>
            ))}
          </div>
        )}

        {/* Key actions */}
        {keyActions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Key:</span>{' '}
            {keyActions.join(' \u2022 ')}
          </p>
        )}

        {/* Tools summary */}
        {toolsSummary && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Tools:</span> {toolsSummary}
          </p>
        )}

        {/* Re-analyze button */}
        <div className="flex justify-end pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onReanalyze}
            disabled={analyzing}
          >
            {analyzing ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Analyzing...</>
            ) : (
              <><RefreshCw className="w-3 h-3 mr-1" /> Re-analyze</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
