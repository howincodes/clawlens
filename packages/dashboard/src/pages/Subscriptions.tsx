import { useState, useEffect } from 'react'
import { getSubscriptions, getProviderQuotas } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Users, Coins, MessageSquare } from 'lucide-react'
import { SourceFilter } from '@/components/SourceFilter'
import { SourceBadge } from '@/components/SourceBadge'
import { QuotaBar } from '@/components/QuotaBar'

// ── Helpers ───────────────────────────────────────────────

function planBadgeClass(plan: string): string {
  switch (plan?.toLowerCase()) {
    case 'go': return 'bg-green-100 text-green-700'
    case 'pro': return 'bg-blue-100 text-blue-700'
    case 'plus': return 'bg-purple-100 text-purple-700'
    case 'max': return 'bg-amber-100 text-amber-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function formatReset(unixTs: number | null | undefined): string {
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

function getSubStatus(activeUntil: string | null | undefined): { color: string; label: string } {
  if (!activeUntil) return { color: 'bg-gray-400', label: 'Unknown' }
  const until = new Date(activeUntil)
  const now = new Date()
  const daysLeft = (until.getTime() - now.getTime()) / 86400000
  if (daysLeft < 0) return { color: 'bg-red-500', label: 'Expired' }
  if (daysLeft < 7) return { color: 'bg-yellow-500', label: 'Expiring Soon' }
  return { color: 'bg-green-500', label: 'Active' }
}

// ── Component ─────────────────────────────────────────────

export function Subscriptions() {
  const [data, setData] = useState<any>({ data: [] })
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('')
  const [quotaMap, setQuotaMap] = useState<Map<string, any[]>>(new Map())

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await getSubscriptions(source || undefined)
        setData(res || { data: [] })

        // Fetch quotas for Codex subscriptions
        const subs = res?.data || res?.subscriptions || []
        const codexSubs = subs.filter((s: any) => s.source === 'codex' && s.users?.length > 0)
        const qMap = new Map<string, any[]>()
        await Promise.all(
          codexSubs.map(async (sub: any) => {
            try {
              const firstUser = sub.users[0]
              const quotaRes = await getProviderQuotas(String(firstUser.id), 'codex')
              if (quotaRes?.data) {
                qMap.set(sub.id || sub.email, quotaRes.data)
              }
            } catch {
              // Quota fetch is best-effort
            }
          })
        )
        setQuotaMap(qMap)
      } catch (err) {
        console.error('Failed to load subscriptions', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [source])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const subscriptions = data.data || data.subscriptions || []

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Subscriptions</h1>
          <SourceFilter value={source} onChange={setSource} />
        </div>
        <p className="text-muted-foreground">Manage and group users by their billing accounts.</p>
      </div>

      {subscriptions.length === 0 ? (
        <Card className="p-12 text-center flex flex-col items-center justify-center">
          <CardTitle className="text-xl mb-2">No Subscriptions Found</CardTitle>
          <CardDescription>Accounts are automatically created when users connect their CLI.</CardDescription>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {subscriptions.map((sub: any) => {
            const subSource = sub.source || 'claude_code'
            const isCodex = subSource === 'codex'
            const quotas = quotaMap.get(sub.id || sub.email) || []

            if (isCodex) {
              const subStatus = getSubStatus(sub.subscription_active_until)
              return (
                <Card key={sub.id || sub.email} className="overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b pb-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <CardTitle className="text-lg truncate">{sub.email}</CardTitle>
                          {!source && <SourceBadge source={subSource} />}
                        </div>
                        <CardDescription className="text-xs">
                          {sub.auth_provider ? `${sub.auth_provider} · ` : ''}{sub.plan_name || sub.org_name || 'Individual'}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${subStatus.color}`} title={subStatus.label} />
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${planBadgeClass(sub.subscription_type || sub.type || 'pro')}`}>
                          {(sub.subscription_type || sub.type || 'PRO').toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {/* Subscription details */}
                    <div className="p-4 border-b space-y-2 text-xs">
                      {sub.account_id && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Account</span>
                          <span className="font-mono text-[10px]">{sub.account_id.slice(0, 12)}...</span>
                        </div>
                      )}
                      {sub.org_id && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Org</span>
                          <span>{sub.plan_name || sub.org_id.slice(0, 12) + '...'}</span>
                        </div>
                      )}
                      {sub.subscription_active_start && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Active</span>
                          <span>
                            {new Date(sub.subscription_active_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            {' → '}
                            {sub.subscription_active_until
                              ? new Date(sub.subscription_active_until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : 'Active'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Quota bars */}
                    {quotas.length > 0 && (
                      <div className="p-4 border-b space-y-3">
                        {quotas.map((q: any, idx: number) => (
                          <QuotaBar
                            key={idx}
                            percent={q.used_percent ?? 0}
                            label={q.window_name === 'primary' ? 'Weekly Quota' : '5hr Quota'}
                            resetText={formatReset(q.resets_at)}
                          />
                        ))}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="grid grid-cols-3 border-b text-center divide-x">
                      <div className="p-4 flex flex-col items-center justify-center">
                        <Users className="w-4 h-4 text-muted-foreground mb-2" />
                        <div className="text-xl font-bold">{sub.user_count ?? sub.users?.length ?? 0}</div>
                        <div className="text-xs text-muted-foreground">Users</div>
                      </div>
                      <div className="p-4 flex flex-col items-center justify-center">
                        <MessageSquare className="w-4 h-4 text-muted-foreground mb-2" />
                        <div className="text-xl font-bold">{sub.total_prompts || 0}</div>
                        <div className="text-xs text-muted-foreground">Prompts</div>
                      </div>
                      <div className="p-4 flex flex-col items-center justify-center">
                        <Coins className="w-4 h-4 text-muted-foreground mb-2" />
                        <div className="text-xl font-bold">{sub.total_credits ?? 0}</div>
                        <div className="text-xs text-muted-foreground">Credits</div>
                      </div>
                    </div>

                    {/* Linked Users */}
                    <div className="p-4">
                      <h4 className="text-sm font-semibold mb-3">Linked Users</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {sub.users?.length > 0 ? (
                          sub.users.map((u: any) => (
                            <div key={u.id} className="flex items-center justify-between text-sm p-2 rounded-md hover:bg-muted/50 transition-colors">
                              <span className="font-medium">{u.name}</span>
                              <div className="text-muted-foreground text-xs flex gap-2">
                                <span>{u.prompt_count ?? 0} prompts</span>
                                <span>{u.total_credits ?? 0} credits</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground italic">No active users associated with this plan.</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            }

            // Claude Code / Antigravity / default card layout
            return (
              <Card key={sub.id || sub.email} className="overflow-hidden">
                <CardHeader className="bg-muted/30 border-b pb-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <CardTitle className="text-lg truncate">{sub.email}</CardTitle>
                        {!source && <SourceBadge source={subSource} />}
                      </div>
                      <CardDescription>{sub.display_name || sub.org_name || 'Individual'}</CardDescription>
                    </div>
                    <Badge variant={(sub.subscription_type || sub.type || '').toLowerCase() === 'max' ? 'default' : 'secondary'} className="uppercase">
                      {(sub.subscription_type || sub.type || 'PRO').toUpperCase()}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid grid-cols-3 border-b text-center divide-x">
                    <div className="p-4 flex flex-col items-center justify-center">
                      <Users className="w-4 h-4 text-muted-foreground mb-2" />
                      <div className="text-xl font-bold">{sub.user_count ?? sub.users?.length ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Users</div>
                    </div>
                    <div className="p-4 flex flex-col items-center justify-center">
                      <MessageSquare className="w-4 h-4 text-muted-foreground mb-2" />
                      <div className="text-xl font-bold">{sub.total_prompts || 0}</div>
                      <div className="text-xs text-muted-foreground">Prompts</div>
                    </div>
                    <div className="p-4 flex flex-col items-center justify-center">
                      <Coins className="w-4 h-4 text-muted-foreground mb-2" />
                      <div className="text-xl font-bold">{sub.total_credits ?? Number(sub.total_cost || 0)}</div>
                      <div className="text-xs text-muted-foreground">Credits</div>
                    </div>
                  </div>

                  <div className="p-4">
                    <h4 className="text-sm font-semibold mb-3">Linked Users</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {sub.users?.length > 0 ? (
                        sub.users.map((u: any) => (
                           <div key={u.id} className="flex items-center justify-between text-sm p-2 rounded-md hover:bg-muted/50 transition-colors">
                             <span className="font-medium">{u.name}</span>
                             <div className="text-muted-foreground text-xs flex gap-2">
                                <span>{u.prompts ?? u.usage?.prompts ?? u.prompt_count ?? 0} prompts</span>
                                <span>{u.credits ?? 0} credits</span>
                             </div>
                           </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No active users associated with this plan.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
