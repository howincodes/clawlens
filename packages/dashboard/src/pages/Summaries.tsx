import { useState, useEffect, useCallback } from 'react'
import { getSummaries, generateSummary, getUsers } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Sparkles, Calendar, Code, Clock } from 'lucide-react'
import { useWSEvent } from '@/hooks/useWebSockets'

const CATEGORY_COLORS: Record<string, string> = {
  coding: 'bg-blue-500/10 text-blue-600',
  debugging: 'bg-red-500/10 text-red-600',
  refactoring: 'bg-purple-500/10 text-purple-600',
  testing: 'bg-green-500/10 text-green-600',
  documentation: 'bg-orange-500/10 text-orange-600',
  planning: 'bg-teal-500/10 text-teal-600',
  review: 'bg-pink-500/10 text-pink-600',
}

export function Summaries() {
  const [data, setData] = useState<{ data: Record<string, unknown>[]; summaries?: Record<string, unknown>[] }>({ data: [] })
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generateMessage, setGenerateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [users, setUsers] = useState<Record<string, unknown>[]>([])
  const [userId, setUserId] = useState('')
  const [days, setDays] = useState('30')

  // Load users on mount
  useEffect(() => {
    getUsers()
      .then(res => setUsers(res?.data || res?.users || []))
      .catch(() => setUsers([]))
  }, [])

  const loadSummaries = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (days && days !== 'all') params.days = days
      if (userId) params.userId = userId
      const res = await getSummaries(params)
      setData(res || { data: [] })
    } catch (_err) {
      console.error('Failed to load summaries')
    } finally {
      setLoading(false)
    }
  }, [userId, days])

  useEffect(() => { loadSummaries() }, [loadSummaries])

  // Listen to WebSocket for auto-refresh
  useWSEvent('summary_generated', () => {
    setGenerating(false)
    setGenerateMessage({ type: 'success', text: 'Summary generated successfully!' })
    loadSummaries()
    setTimeout(() => setGenerateMessage(null), 5000)
  })

  const handleGenerate = async () => {
    setGenerating(true)
    setGenerateMessage(null)
    try {
      await generateSummary(userId || undefined)
      const forUser = userId ? users.find((u: any) => String(u.id) === userId) : null
      setGenerateMessage({ type: 'success', text: `Summary${forUser ? ` for ${(forUser as any).name}` : ' (all users)'} generation started. It will appear shortly.` })
      // Also re-fetch after a delay in case WS doesn't fire
      setTimeout(() => {
        loadSummaries()
        setGenerating(false)
      }, 8000)
    } catch (_e) {
      setGenerating(false)
      setGenerateMessage({ type: 'error', text: 'Failed to generate summary. Please try again.' })
    }
  }

  if (loading && (data.data || data.summaries || []).length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <div className="flex sm:items-center justify-between flex-col sm:flex-row gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Summaries</h1>
          <p className="text-muted-foreground">Automated intelligence briefs on engineering activity.</p>
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="w-4 h-4 mr-2" /> Generate Now</>
          )}
        </Button>
      </div>

      {/* Toast message */}
      {generateMessage && (
        <div className={`p-3 rounded-lg text-sm font-medium ${
          generateMessage.type === 'success'
            ? 'bg-green-500/10 text-green-600 border border-green-200'
            : 'bg-red-500/10 text-red-600 border border-red-200'
        }`}>
          {generateMessage.text}
        </div>
      )}

      {/* Filters */}
      <div className="flex justify-end gap-2">
        <select
          className="flex h-9 w-[180px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={userId}
          onChange={e => setUserId(e.target.value)}
        >
          <option value="">User: All</option>
          {users.map(u => <option key={String(u.id)} value={String(u.id)}>{String(u.name)}</option>)}
        </select>
        <select
          className="flex h-9 w-[150px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={days}
          onChange={e => setDays(e.target.value)}
        >
          <option value="7">Last 7 Days</option>
          <option value="30">Last 30 Days</option>
          <option value="90">Last 90 Days</option>
          <option value="all">All Time</option>
        </select>
      </div>

      {(data.data || data.summaries || []).length === 0 ? (
        <Card className="p-12 text-center border-dashed bg-muted/20">
          <Sparkles className="mx-auto w-10 h-10 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-1">No AI summaries generated yet</h3>
          <p className="text-sm text-muted-foreground">
            Click Generate Now to create one.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {(data.data || data.summaries || []).map((summary, idx) => {
            // Parse categories — DB stores as JSON array of strings
            let categories: string[] = []
            try {
              const raw = summary.categories
              if (typeof raw === 'string') {
                const parsed = JSON.parse(raw)
                categories = Array.isArray(parsed) ? parsed : Object.keys(parsed)
              } else if (Array.isArray(raw)) {
                categories = raw as string[]
              }
            } catch { /* ignore parse errors */ }

            // Parse topics
            let topics: string[] = []
            try {
              const raw = summary.topics
              if (typeof raw === 'string') topics = JSON.parse(raw)
              else if (Array.isArray(raw)) topics = raw as string[]
            } catch { /* ignore */ }

            const periodStart = summary.period_start ? new Date(String(summary.period_start)).toLocaleDateString() : ''
            const periodEnd = summary.period_end ? new Date(String(summary.period_end)).toLocaleDateString() : ''

            // Look up user name from users list
            const userMap = new Map(users.map(u => [String(u.id), String(u.name)]))
            const userName = summary.type === 'weekly_team'
              ? 'Team Report'
              : summary.user_id
                ? (userMap.get(String(summary.user_id)) || 'User')
                : 'Team Summary'

            return (
              <Card key={String(summary.id || idx)} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {summary.type === 'weekly_team'
                        ? <Calendar className="w-4 h-4 text-primary" />
                        : <Code className="w-4 h-4 text-muted-foreground" />
                      }
                      <Badge variant={summary.type === 'weekly_team' ? 'default' : 'secondary'} className="capitalize">
                        {String(summary.type || '').replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {(periodStart || periodEnd) && (
                      <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {periodStart} - {periodEnd}
                      </span>
                    )}
                  </div>
                  <CardTitle className="text-lg">{String(userName)}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {summary.created_at ? new Date(String(summary.created_at)).toLocaleString() : ''}
                  </span>
                </CardHeader>

                <CardContent className="text-sm leading-relaxed text-muted-foreground pb-4 whitespace-pre-wrap">
                  {String(summary.summary || summary.summary_text || 'No summary text')}
                </CardContent>

                {/* Categories + Topics */}
                {(categories.length > 0 || topics.length > 0) ? (
                  <div className="px-6 pb-3 space-y-2">
                    {categories.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {categories.map((cat) => (
                          <Badge key={cat} variant="outline" className={`text-xs capitalize ${CATEGORY_COLORS[String(cat).toLowerCase()] || 'bg-gray-500/10 text-gray-600'}`}>
                            {String(cat).replace(/_/g, ' ')}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {topics.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {topics.map((t, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Risk Level */}
                {summary.risk_level ? (
                  <CardFooter className="bg-muted/30 pt-4 pb-4 border-t">
                    <Badge variant={summary.risk_level === 'high' ? 'destructive' : summary.risk_level === 'medium' ? 'warning' : 'secondary'}>
                      Risk: {String(summary.risk_level)}
                    </Badge>
                  </CardFooter>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
