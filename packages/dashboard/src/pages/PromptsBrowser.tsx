import { useState, useEffect, useRef, useCallback } from 'react'
import { getAllMessages, getUsers } from '@/lib/api'
import { SourceFilter } from '@/components/SourceFilter'
import { SourceBadge } from '@/components/SourceBadge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, Loader2, ChevronLeft, ChevronRight, Clock, Coins, Shield } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

const MODEL_BADGE_COLORS: Record<string, string> = {
  Opus: 'bg-purple-500/10 text-purple-700',
  Sonnet: 'bg-blue-500/10 text-blue-700',
  Haiku: 'bg-green-500/10 text-green-700',
}

function getModelBadgeColor(model: string): string {
  if (model.startsWith('AG-')) return 'bg-teal-500/10 text-teal-700'
  const known = MODEL_BADGE_COLORS[model]
  if (known) return known
  return 'bg-gray-500/10 text-gray-600'
}

const TOOL_BADGE_COLORS: Record<string, string> = {
  Bash: 'bg-green-500/10 text-green-700',
  Read: 'bg-blue-500/10 text-blue-700',
  Write: 'bg-purple-500/10 text-purple-700',
  Edit: 'bg-orange-500/10 text-orange-700',
  Glob: 'bg-teal-500/10 text-teal-700',
  Grep: 'bg-pink-500/10 text-pink-700',
  Agent: 'bg-indigo-500/10 text-indigo-700',
}

const LIMIT = 50

/**
 * Parse server timestamps (SQLite stores without 'Z' suffix) as UTC,
 * so date-fns format() and formatDistanceToNow() display in the browser's local timezone.
 */
function parseServerDate(dateStr: string): Date {
  if (!dateStr) return new Date(0)
  return new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z')
}

function getModelShortName(model: string): string {
  if (!model) return 'Unknown'
  if (model.startsWith('AG-')) return model  // Keep full AG- name
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'Opus'
  if (lower.includes('sonnet')) return 'Sonnet'
  if (lower.includes('haiku')) return 'Haiku'
  return model
}

export function PromptsBrowser() {
  const [data, setData] = useState<{ items: Record<string, unknown>[]; total: number }>({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<Record<string, unknown>[]>([])
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set())
  const [expandedResponses, setExpandedResponses] = useState<Set<string>>(new Set())

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [userId, setUserId] = useState('')
  const [model, setModel] = useState('')
  const [project, setProject] = useState('')
  const [blocked, setBlocked] = useState('')
  const [source, setSource] = useState('')

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search input
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 500)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search])

  // Load users on mount
  useEffect(() => {
    getUsers()
      .then(res => setUsers(res?.data || res?.users || []))
      .catch(() => setUsers([]))
  }, [])

  // Build user lookup map
  const userMap = new Map<string, string>()
  for (const u of users) {
    userMap.set(String(u.id), String(u.name || ''))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {
        page: page.toString(),
        limit: LIMIT.toString(),
      }
      if (debouncedSearch) params.search = debouncedSearch
      if (userId) params.userId = userId
      if (model) params.model = model
      if (project) params.project = project
      if (blocked) params.blocked = blocked
      if (source) params.source = source

      const res = await getAllMessages(params)
      setData({ items: res?.data || [], total: res?.total || 0 })
    } catch (err) {
      setError(String(err))
      setData({ items: [], total: 0 })
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, userId, model, project, blocked, source])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(data.total / LIMIT))

  const toggleExpand = (id: string, type: 'prompt' | 'response') => {
    const setter = type === 'prompt' ? setExpandedPrompts : setExpandedResponses
    setter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const truncate = (text: string, max: number) => {
    if (!text || text.length <= max) return text
    return text.slice(0, max)
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Prompt Browser</h1>
        <p className="text-muted-foreground">Search and audit all prompts sent by developers.</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4">
            {/* Search bar */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search prompt text..."
                className="pl-9 bg-muted/50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Filter row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={userId}
                onChange={e => { setUserId(e.target.value); setPage(1) }}
              >
                <option value="">User: All</option>
                {users.map(u => <option key={String(u.id)} value={String(u.id)}>{String(u.name)}</option>)}
              </select>

              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={model}
                onChange={e => { setModel(e.target.value); setPage(1) }}
              >
                <option value="">Model: All</option>
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>

              <Input
                placeholder="Project filter..."
                className="h-9"
                value={project}
                onChange={e => { setProject(e.target.value); setPage(1) }}
              />

              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={blocked}
                onChange={e => { setBlocked(e.target.value); setPage(1) }}
              >
                <option value="">Blocked: All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>

              <SourceFilter value={source} onChange={(v) => { setSource(v); setPage(1) }} className="w-full" />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Count display */}
          {!loading && data.total > 0 && (
            <p className="text-sm text-muted-foreground mb-4">
              Showing {((page - 1) * LIMIT) + 1}-{Math.min(page * LIMIT, data.total)} of {data.total.toLocaleString()} prompts
            </p>
          )}

          {error && (
            <div className="text-center p-8 text-red-500">
              <p>{error}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={load}>Retry</Button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : data.items.length === 0 ? (
            <div className="text-center p-12 border rounded-lg bg-muted/10 border-dashed">
              <Search className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-muted-foreground font-medium">No prompts found matching your filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.items.map((p) => {
                const id = String(p.id || '')
                const modelShort = getModelShortName(String(p.model || ''))
                const modelColorClass = getModelBadgeColor(modelShort)
                const promptText = String(p.content || p.prompt || p.prompt_text || '')
                const responseText = String(p.response || p.response_text || '')
                const isPromptExpanded = expandedPrompts.has(id)
                const isResponseExpanded = expandedResponses.has(id)
                const tools = (p.tools_used || p.tools) as string[] | undefined
                const isBlocked = Boolean(p.blocked || p.was_blocked)
                const userName = p.user_id ? (userMap.get(String(p.user_id)) || `User ${p.user_id}`) : 'Unknown'
                const timestamp = (p.created_at || p.timestamp) ? parseServerDate(String(p.created_at || p.timestamp)) : null

                return (
                  <Card key={id} className="overflow-hidden transition-shadow hover:shadow-md">
                    {/* Header */}
                    <div className="border-b bg-muted/30 p-3 px-4 flex items-center justify-between text-sm flex-wrap gap-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-medium">{userName}</span>
                        <Badge variant="outline" className={`text-xs font-normal capitalize ${modelColorClass}`}>
                          {modelShort}
                        </Badge>
                        <SourceBadge source={String(p.source || 'claude_code')} />
                        {String(p.project_dir || '') && p.project_dir ? (
                          <Badge variant="outline" className="text-xs font-normal">
                            {String(p.project_dir)}
                          </Badge>
                        ) : null}
                        {isBlocked && (
                          <Badge variant="destructive" className="text-xs">
                            <Shield className="w-3 h-3 mr-1" /> Blocked
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground text-xs flex items-center gap-3">
                        {timestamp && (
                          <>
                            <span title={format(timestamp, 'PPpp')} className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDistanceToNow(timestamp, { addSuffix: true })}
                            </span>
                            <span className="hidden sm:inline">{format(timestamp, 'MMM d, yyyy HH:mm')}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="p-4 space-y-3">
                      {/* Prompt text */}
                      <div className="font-mono text-sm whitespace-pre-wrap text-foreground/90 bg-muted/20 p-3 rounded-md border">
                        {promptText ? (
                          <>
                            {isPromptExpanded ? promptText : truncate(promptText, 200)}
                            {promptText.length > 200 && (
                              <button
                                className="text-primary text-xs ml-2 hover:underline"
                                onClick={() => toggleExpand(id, 'prompt')}
                              >
                                {isPromptExpanded ? 'Show less' : 'Show more'}
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="italic text-muted-foreground">(Prompt text not collected)</span>
                        )}
                      </div>

                      {/* Response text */}
                      {responseText && (
                        <div className="text-sm border-l-2 pl-4 border-primary">
                          <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Response</div>
                          <div className="font-sans whitespace-pre-wrap text-muted-foreground">
                            {isResponseExpanded ? responseText : truncate(responseText, 200)}
                            {responseText.length > 200 && (
                              <button
                                className="text-primary text-xs ml-2 hover:underline"
                                onClick={() => toggleExpand(id, 'response')}
                              >
                                {isResponseExpanded ? 'Show less' : 'Show more'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Footer: tools, duration, cost */}
                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground pt-1">
                        {tools && Array.isArray(tools) && tools.map((tool, i) => (
                          <Badge key={i} variant="secondary" className={`text-[10px] ${TOOL_BADGE_COLORS[tool] || ''}`}>
                            {tool}
                          </Badge>
                        ))}
                        {Number(p.turn_duration_ms || 0) > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {(Number(p.turn_duration_ms) / 1000).toFixed(1)}s
                          </span>
                        )}
                        {Number(p.credit_cost || 0) > 0 && (
                          <span className="flex items-center gap-1">
                            <Coins className="w-3 h-3" /> {Number(p.credit_cost)} credits
                          </span>
                        )}
                        {Number(p.input_tokens || 0) > 0 && (
                          <span className="text-muted-foreground">
                            {Number(p.input_tokens).toLocaleString()} in / {Number(p.output_tokens || 0).toLocaleString()} out tokens
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data.total > 0 && (
        <div className="flex justify-between items-center text-sm text-muted-foreground px-1">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
