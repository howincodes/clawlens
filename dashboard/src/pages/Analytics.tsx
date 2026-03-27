import { useState, useEffect, useCallback } from 'react'
import { getAnalytics, getLeaderboard, getProjectAnalytics, getCosts } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, TrendingUp, BarChart3, PieChart as PieChartIcon, Clock, FolderOpen, Wrench, Coins, Users, MessageSquare, ArrowUpDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer,
  PieChart, Pie, LineChart, Line,
} from 'recharts'

// ── Color constants ──────────────────────────────────────
const MODEL_COLORS: Record<string, string> = {
  opus: '#3b82f6',
  sonnet: '#8b5cf6',
  haiku: '#f59e0b',
}

const TOOL_COLORS: Record<string, string> = {
  Bash: '#22c55e',
  Read: '#3b82f6',
  Write: '#8b5cf6',
  Edit: '#f59e0b',
  Glob: '#14b8a6',
  Grep: '#ec4899',
  Agent: '#6366f1',
}

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e', '#ec4899', '#f97316']

type SortField = 'prompts' | 'cost' | 'sessions'

function fmtCredits(v: number): string {
  return `${Number(v || 0)} credits`
}

export function Analytics() {
  const [days, setDays] = useState(7)
  const [sortBy, setSortBy] = useState<SortField>('prompts')
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null)
  const [leaderboard, setLeaderboard] = useState<Record<string, unknown>[]>([])
  const [costs, setCosts] = useState<Record<string, unknown> | null>(null)
  const [projects, setProjects] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [analyticsRes, leaderboardRes, costsRes, projectsRes] = await Promise.all([
        getAnalytics(days).catch(() => null),
        getLeaderboard(days, sortBy).catch(() => ({ leaderboard: [] })),
        getCosts(days).catch(() => null),
        getProjectAnalytics(days).catch(() => ({ projects: [] })),
      ])
      setAnalytics(analyticsRes)
      setLeaderboard(leaderboardRes?.leaderboard || [])
      setCosts(costsRes)
      setProjects(projectsRes?.projects || [])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [days, sortBy])

  useEffect(() => { load() }, [load])

  const handleSort = (field: SortField) => {
    setSortBy(field)
  }

  const overview = (analytics as Record<string, unknown>)?.overview as Record<string, unknown> | undefined

  // ── Chart data helpers ─────────────────────────────────
  const modelDistribution = (overview?.models as Record<string, unknown>[] | undefined) || []
  const toolUsage = (overview?.tools as Record<string, unknown>[] | undefined) || []
  const peakHours = (overview?.peak_hours as Record<string, unknown>[] | undefined) || []
  const trends = (analytics as Record<string, unknown>)?.trends as Record<string, unknown>[] | undefined

  const costByUser = (costs as Record<string, unknown>)?.by_user as Record<string, unknown>[] | undefined
  const costByModel = (costs as Record<string, unknown>)?.by_model as Record<string, unknown>[] | undefined
  const costByProject = (costs as Record<string, unknown>)?.by_project as Record<string, unknown>[] | undefined

  const sortArrow = (field: SortField) => sortBy === field ? ' \u2193' : ''

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header + day range selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">Deep dive into team-wide usage patterns and costs.</p>
        </div>
        <div className="flex items-center gap-2 bg-muted p-1 rounded-md">
          {[7, 14, 30, 90].map(d => (
            <Button
              key={d}
              variant={days === d ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d} Days
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-center p-8 text-red-500">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={load}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Section 1: Team Overview stat cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10"><MessageSquare className="w-5 h-5 text-blue-500" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Prompts</p>
                    <p className="text-2xl font-bold">{Number(overview?.total_prompts || 0).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10"><Users className="w-5 h-5 text-purple-500" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Sessions</p>
                    <p className="text-2xl font-bold">{Number(overview?.total_sessions || 0).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10"><Coins className="w-5 h-5 text-green-500" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Credits</p>
                    <p className="text-2xl font-bold">{fmtCredits(Number(overview?.total_cost || 0))}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/10"><TrendingUp className="w-5 h-5 text-orange-500" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Turns/Session</p>
                    <p className="text-2xl font-bold">{Number(overview?.avg_turns_per_session || 0).toFixed(1)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Section 2: Leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Team Leaderboard
              </CardTitle>
              <CardDescription>Ranking developers by usage. Click column headers to sort.</CardDescription>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="text-center p-8 text-muted-foreground">No data for this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Rank</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right cursor-pointer hover:text-primary" onClick={() => handleSort('prompts')}>
                          <span className="inline-flex items-center gap-1">Prompts{sortArrow('prompts')} <ArrowUpDown className="w-3 h-3" /></span>
                        </TableHead>
                        <TableHead className="text-right cursor-pointer hover:text-primary" onClick={() => handleSort('sessions')}>
                          <span className="inline-flex items-center gap-1">Sessions{sortArrow('sessions')} <ArrowUpDown className="w-3 h-3" /></span>
                        </TableHead>
                        <TableHead className="text-right cursor-pointer hover:text-primary" onClick={() => handleSort('cost')}>
                          <span className="inline-flex items-center gap-1">Credits{sortArrow('cost')} <ArrowUpDown className="w-3 h-3" /></span>
                        </TableHead>
                        <TableHead className="text-right">Avg Turns</TableHead>
                        <TableHead className="text-right">Top Model</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leaderboard.map((user, idx) => (
                        <TableRow key={String(user.id || idx)} className={idx % 2 === 0 ? 'bg-muted/30' : ''}>
                          <TableCell className="font-bold text-muted-foreground">#{idx + 1}</TableCell>
                          <TableCell className="font-medium">{String(user.name || '')}</TableCell>
                          <TableCell className="text-right">{Number(user.prompts || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right">{Number(user.sessions || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right">{fmtCredits(Number(user.cost || 0))}</TableCell>
                          <TableCell className="text-right">{Number(user.avg_turns || 0).toFixed(1)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="capitalize">{String(user.top_model || user.model_preference || 'N/A')}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 3: Cost Report */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Cost by User */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Credits by User
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                {costByUser && costByUser.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={costByUser}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#88888833" />
                      <XAxis type="number" tickFormatter={(v) => `${v}`} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                      <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => fmtCredits(Number(v ?? 0))} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                      <Bar dataKey="cost" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground pt-20">No data for this period.</p>
                )}
              </CardContent>
            </Card>

            {/* Cost by Model (donut) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="w-5 h-5 text-primary" />
                  Credits by Model
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                {costByModel && costByModel.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={costByModel}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="cost"
                        nameKey="name"
                        label={(props) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                      >
                        {costByModel.map((entry, index) => (
                          <Cell key={`model-cost-${index}`} fill={MODEL_COLORS[String(entry.name).toLowerCase()] || PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => fmtCredits(Number(v ?? 0))} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground pt-20">No data for this period.</p>
                )}
              </CardContent>
            </Card>

            {/* Cost by Project */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-primary" />
                  Credits by Project
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                {costByProject && costByProject.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={costByProject}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#88888833" />
                      <XAxis type="number" tickFormatter={(v) => `${v}`} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                      <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => fmtCredits(Number(v ?? 0))} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                      <Bar dataKey="cost" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground pt-20">No data for this period.</p>
                )}
              </CardContent>
            </Card>

            {/* Daily Cost Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-primary" />
                  Daily Credit Trend
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                {trends && trends.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => `${v}`} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => fmtCredits(Number(v ?? 0))} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                      <Line type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground pt-20">No data for this period.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Section 4: Model Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChartIcon className="w-5 h-5 text-primary" />
                Model Distribution
              </CardTitle>
              <CardDescription>Usage breakdown by model with percentages</CardDescription>
            </CardHeader>
            <CardContent className="h-72 flex items-center justify-center">
              {modelDistribution.length > 0 ? (
                <div className="flex items-center gap-8 w-full">
                  <div className="flex-1 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={modelDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={5}
                          dataKey="value"
                          nameKey="name"
                          label={(props) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(1)}%`}
                        >
                          {modelDistribution.map((entry, index) => (
                            <Cell key={`model-${index}`} fill={MODEL_COLORS[String(entry.name).toLowerCase()] || PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 min-w-[140px]">
                    {modelDistribution.map((m, i) => {
                      const total = modelDistribution.reduce((s, x) => s + Number(x.value || 0), 0)
                      const pct = total > 0 ? ((Number(m.value || 0) / total) * 100).toFixed(1) : '0'
                      return (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MODEL_COLORS[String(m.name).toLowerCase()] || PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="font-medium">{String(m.name)}</span>
                          <span className="text-muted-foreground ml-auto">{Number(m.value || 0).toLocaleString()} ({pct}%)</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No data for this period.</p>
              )}
            </CardContent>
          </Card>

          {/* Section 5: Tool Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-primary" />
                Most Used Tools
              </CardTitle>
              <CardDescription>Tool usage counts with error rates shown in red</CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              {toolUsage.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={toolUsage}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#88888833" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                    <Legend />
                    <Bar dataKey="count" name="Success" stackId="tools" radius={[0, 0, 0, 0]}>
                      {toolUsage.map((entry, index) => (
                        <Cell key={`tool-${index}`} fill={TOOL_COLORS[String(entry.name)] || '#6b7280'} />
                      ))}
                    </Bar>
                    <Bar dataKey="errors" name="Errors" stackId="tools" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground pt-20">No data for this period.</p>
              )}
            </CardContent>
          </Card>

          {/* Section 6: Project Analytics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-primary" />
                Project Analytics
              </CardTitle>
              <CardDescription>Projects sorted by prompt count</CardDescription>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <p className="text-center p-8 text-muted-foreground">No data for this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right">Prompts</TableHead>
                        <TableHead className="text-right">Users</TableHead>
                        <TableHead className="text-right">Credits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projects.map((p, idx) => (
                        <TableRow key={String(p.name || idx)} className={idx % 2 === 0 ? 'bg-muted/30' : ''}>
                          <TableCell className="font-medium">{String(p.name || 'Unknown')}</TableCell>
                          <TableCell className="text-right">{Number(p.prompts || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right">{Number(p.users || 0)}</TableCell>
                          <TableCell className="text-right">{fmtCredits(Number(p.cost || 0))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 7: Peak Hours */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Peak Hours
              </CardTitle>
              <CardDescription>Prompt volume by hour of day (0-23)</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              {peakHours.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={peakHours}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888833" />
                    <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground pt-20">No data for this period.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
