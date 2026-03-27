import { useState, useEffect } from 'react'
import { fetchClient } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Users, Coins, MessageSquare } from 'lucide-react'

export function Subscriptions() {
  const [data, setData] = useState<any>({ subscriptions: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetchClient('/subscriptions')
        setData(res || { subscriptions: [] })
      } catch (err) {
        console.error('Failed to load subscriptions', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const subscriptions = data.subscriptions || []

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Subscriptions</h1>
        <p className="text-muted-foreground">Manage and group users by their Claude Code billing accounts.</p>
      </div>

      {subscriptions.length === 0 ? (
        <Card className="p-12 text-center flex flex-col items-center justify-center">
          <CardTitle className="text-xl mb-2">No Subscriptions Found</CardTitle>
          <CardDescription>Accounts are automatically created when users connect their Claude CLI.</CardDescription>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {subscriptions.map((sub: any) => (
            <Card key={sub.id || sub.email} className="overflow-hidden">
              <CardHeader className="bg-muted/30 border-b pb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg mb-1">{sub.email}</CardTitle>
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
          ))}
        </div>
      )}
    </div>
  )
}
