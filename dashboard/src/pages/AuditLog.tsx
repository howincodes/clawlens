import { useState, useEffect, useCallback } from 'react'
import { getAuditLog } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { format } from 'date-fns'

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'user_created', label: 'User Created' },
  { value: 'user_killed', label: 'User Killed' },
  { value: 'user_paused', label: 'User Paused' },
  { value: 'user_active', label: 'User Active' },
  { value: 'limits_changed', label: 'Limits Changed' },
  { value: 'settings_updated', label: 'Settings Updated' },
  { value: 'password_changed', label: 'Password Changed' },
  { value: 'token_rotated', label: 'Token Rotated' },
]

const ACTION_COLORS: Record<string, string> = {
  user_created: 'bg-green-500/10 text-green-600 border-green-200',
  user_killed: 'bg-red-500/10 text-red-600 border-red-200',
  user_paused: 'bg-yellow-500/10 text-yellow-600 border-yellow-200',
  user_active: 'bg-blue-500/10 text-blue-600 border-blue-200',
  limits_changed: 'bg-purple-500/10 text-purple-600 border-purple-200',
  settings_updated: 'bg-teal-500/10 text-teal-600 border-teal-200',
  password_changed: 'bg-orange-500/10 text-orange-600 border-orange-200',
  token_rotated: 'bg-pink-500/10 text-pink-600 border-pink-200',
}

const LIMIT = 50

export function AuditLog() {
  const [data, setData] = useState<{ entries: any[]; total: number }>({ entries: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {
        page: page.toString(),
        limit: LIMIT.toString(),
      }
      if (action) params.action = action
      const res = await getAuditLog(params)
      setData({ entries: res?.data || res?.entries || [], total: res?.total || 0 })
    } catch (_err) {
      setError('Failed to load audit log.')
      setData({ entries: [], total: 0 })
    } finally {
      setLoading(false)
    }
  }, [page, action])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(data.total / LIMIT))

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const formatDetails = (details: unknown): string => {
    if (!details) return '-'
    try {
      if (typeof details === 'string') {
        const parsed = JSON.parse(details)
        return JSON.stringify(parsed, null, 2)
      }
      return JSON.stringify(details, null, 2)
    } catch {
      return String(details)
    }
  }

  const truncateDetails = (details: unknown): string => {
    if (!details) return '-'
    try {
      const str = typeof details === 'string' ? details : JSON.stringify(details)
      return str.length > 80 ? str.slice(0, 80) + '...' : str
    } catch {
      return String(details)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">Chronological record of system-level and admin actions.</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex justify-between items-start flex-col sm:flex-row gap-4">
            <div>
              <CardTitle>Event History</CardTitle>
              <CardDescription>{data.total.toLocaleString()} total events</CardDescription>
            </div>
            <select
              value={action}
              onChange={e => { setAction(e.target.value); setPage(1); setExpandedRows(new Set()) }}
              className="flex h-9 w-[200px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {ACTION_TYPES.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
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
          ) : data.entries.length === 0 ? (
            <div className="text-center p-12 text-muted-foreground border rounded bg-muted/10 border-dashed">
              No events in the audit log.
            </div>
          ) : (
            <div className="overflow-hidden border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[180px]">Timestamp</TableHead>
                    <TableHead className="w-[120px]">Actor</TableHead>
                    <TableHead className="w-[160px]">Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.entries.map((log, idx) => {
                    const isExpanded = expandedRows.has(idx)
                    const details = log.details
                    const detailStr = formatDetails(details)
                    const isLong = detailStr.length > 80

                    return (
                      <TableRow key={String(log.id || idx)} className={idx % 2 === 0 ? 'bg-muted/20' : ''}>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {log.timestamp ? format(new Date(String(log.timestamp)), 'MMM d, yyyy HH:mm:ss') : '-'}
                        </TableCell>
                        <TableCell>
                          {log.actor === 'admin' ? (
                            <Badge variant="default" className="text-[10px]">ADMIN</Badge>
                          ) : (
                            <span className="font-semibold text-sm">{String(log.actor || '-')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`font-mono text-[10px] ${ACTION_COLORS[String(log.action)] || ''}`}>
                            {String(log.action || '-')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{String(log.target || '-')}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {isLong ? (
                            <div>
                              <button
                                onClick={() => toggleRow(idx)}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                {isExpanded ? 'Collapse' : 'Expand'}
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                              {isExpanded ? (
                                <pre className="mt-2 text-left bg-muted/50 p-2 rounded text-[11px] overflow-x-auto max-w-[400px] whitespace-pre-wrap">
                                  {detailStr}
                                </pre>
                              ) : (
                                <span className="block truncate max-w-[200px] ml-auto" title={detailStr}>
                                  {truncateDetails(details)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span>{truncateDetails(details)}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {/* Pagination */}
        {data.total > 0 && (
          <div className="flex justify-between items-center px-6 py-4 border-t text-sm text-muted-foreground">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setPage(p => Math.max(1, p - 1)); setExpandedRows(new Set()) }}
                disabled={page === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setPage(p => Math.min(totalPages, p + 1)); setExpandedRows(new Set()) }}
                disabled={page >= totalPages}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
