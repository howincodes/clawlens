import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Settings2 } from "lucide-react"
import { fetchClient } from "@/lib/api"

// Pre-fill form from the server's limits array format
function parseLimits(limitsArr: any[]) {
  const result = {
    credit_budget: '',
    credit_window: 'daily',
    opus_cap: '',
    opus_window: 'daily',
    sonnet_cap: '',
    sonnet_window: 'daily',
    haiku_cap: '',
    haiku_window: 'daily',
    time_start: '',
    time_end: '',
    time_tz: 'America/New_York',
  }
  if (!Array.isArray(limitsArr)) return result
  for (const lim of limitsArr) {
    if (lim.type === 'credits') {
      result.credit_budget = String(lim.value || '')
      result.credit_window = lim.window || 'daily'
    } else if (lim.type === 'per_model' && lim.model === 'opus') {
      result.opus_cap = String(lim.value || '')
      result.opus_window = lim.window || 'daily'
    } else if (lim.type === 'per_model' && lim.model === 'sonnet') {
      result.sonnet_cap = String(lim.value || '')
      result.sonnet_window = lim.window || 'daily'
    } else if (lim.type === 'per_model' && lim.model === 'haiku') {
      result.haiku_cap = String(lim.value || '')
      result.haiku_window = lim.window || 'daily'
    } else if (lim.type === 'time_of_day') {
      result.time_start = lim.schedule_start || ''
      result.time_end = lim.schedule_end || ''
      result.time_tz = lim.schedule_tz || 'America/New_York'
    }
  }
  return result
}

// Convert form state into the server's expected array format
function buildLimitsPayload(form: ReturnType<typeof parseLimits>) {
  const limits: Record<string, unknown>[] = []
  if (form.credit_budget) {
    limits.push({ type: 'credits', window: form.credit_window, value: Number(form.credit_budget) })
  }
  if (form.opus_cap) {
    limits.push({ type: 'per_model', model: 'opus', window: form.opus_window, value: Number(form.opus_cap) })
  }
  if (form.sonnet_cap) {
    limits.push({ type: 'per_model', model: 'sonnet', window: form.sonnet_window, value: Number(form.sonnet_cap) })
  }
  if (form.haiku_cap) {
    limits.push({ type: 'per_model', model: 'haiku', window: form.haiku_window, value: Number(form.haiku_cap) })
  }
  if (form.time_start && form.time_end) {
    limits.push({ type: 'time_of_day', schedule_start: form.time_start, schedule_end: form.time_end, schedule_tz: form.time_tz })
  }
  return limits
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'UTC',
]

export function EditLimitsModal({ user, onClose, onSuccess }: { user: any, onClose: () => void, onSuccess: () => void }) {
  const [loading, setLoading] = useState(false)
  const [limits, setLimits] = useState(() => parseLimits(user?.limits || []))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = buildLimitsPayload(limits)
      await fetchClient(`/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ limits: payload })
      })
      onSuccess()
    } catch (err) {
      console.error(err)
      alert("Failed to update limits")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-lg border-border max-h-[90vh] overflow-y-auto">
         <form onSubmit={handleSubmit}>
            <CardHeader>
               <div className="flex items-center gap-2">
                 <Settings2 className="w-5 h-5 text-primary" />
                 <CardTitle>Edit Rate Limits</CardTitle>
               </div>
               <CardDescription>Configure boundaries for {user.name} ({user.slug}).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
               <div className="space-y-4">
                  <h4 className="text-sm font-semibold border-b pb-2">Credit Budget</h4>
                  <div className="flex gap-4">
                     <div className="flex-1 space-y-2">
                        <Label>Max Credits</Label>
                        <Input type="number" placeholder="e.g. 100" value={limits.credit_budget} onChange={e => setLimits(l => ({...l, credit_budget: e.target.value}))} />
                     </div>
                     <div className="w-32 space-y-2">
                        <Label>Window</Label>
                        <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={limits.credit_window} onChange={e => setLimits(l => ({...l, credit_window: e.target.value}))}>
                           <option value="daily">Daily</option>
                           <option value="weekly">Weekly</option>
                           <option value="monthly">Monthly</option>
                        </select>
                     </div>
                  </div>
               </div>

               <div className="space-y-4">
                  <h4 className="text-sm font-semibold border-b pb-2">Per-Model Caps</h4>
                  <div className="flex gap-4 items-end">
                     <div className="flex-1 space-y-2">
                        <Label>Opus Requests</Label>
                        <Input type="number" placeholder="e.g. 50" value={limits.opus_cap} onChange={e => setLimits(l => ({...l, opus_cap: e.target.value}))} />
                     </div>
                     <div className="w-32 space-y-2">
                        <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={limits.opus_window} onChange={e => setLimits(l => ({...l, opus_window: e.target.value}))}>
                           <option value="daily">Daily</option>
                           <option value="weekly">Weekly</option>
                        </select>
                     </div>
                  </div>
                  <div className="flex gap-4 items-end">
                     <div className="flex-1 space-y-2">
                        <Label>Sonnet Requests</Label>
                        <Input type="number" placeholder="e.g. 200" value={limits.sonnet_cap} onChange={e => setLimits(l => ({...l, sonnet_cap: e.target.value}))} />
                     </div>
                     <div className="w-32 space-y-2">
                        <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={limits.sonnet_window} onChange={e => setLimits(l => ({...l, sonnet_window: e.target.value}))}>
                           <option value="daily">Daily</option>
                           <option value="weekly">Weekly</option>
                        </select>
                     </div>
                  </div>
                  <div className="flex gap-4 items-end">
                     <div className="flex-1 space-y-2">
                        <Label>Haiku Requests</Label>
                        <Input type="number" placeholder="e.g. 500" value={limits.haiku_cap} onChange={e => setLimits(l => ({...l, haiku_cap: e.target.value}))} />
                     </div>
                     <div className="w-32 space-y-2">
                        <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={limits.haiku_window} onChange={e => setLimits(l => ({...l, haiku_window: e.target.value}))}>
                           <option value="daily">Daily</option>
                           <option value="weekly">Weekly</option>
                        </select>
                     </div>
                  </div>
               </div>

               <div className="space-y-4">
                  <h4 className="text-sm font-semibold border-b pb-2">Time-of-Day Rules</h4>
                  <div className="flex gap-4">
                     <div className="flex-1 space-y-2">
                        <Label>Active From</Label>
                        <Input type="time" value={limits.time_start} onChange={e => setLimits(l => ({...l, time_start: e.target.value}))} />
                     </div>
                     <div className="flex-1 space-y-2">
                        <Label>Active Until</Label>
                        <Input type="time" value={limits.time_end} onChange={e => setLimits(l => ({...l, time_end: e.target.value}))} />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <Label>Timezone</Label>
                     <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={limits.time_tz} onChange={e => setLimits(l => ({...l, time_tz: e.target.value}))}>
                        {TIMEZONES.map(tz => (
                           <option key={tz} value={tz}>{tz}</option>
                        ))}
                     </select>
                  </div>
                  <p className="text-xs text-muted-foreground">Leave times blank to allow usage 24/7.</p>
               </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 bg-muted/20 border-t py-4">
               <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
               <Button type="submit" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Save Limits</Button>
            </CardFooter>
         </form>
      </Card>
    </div>
  )
}
