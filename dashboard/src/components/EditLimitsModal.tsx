import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Settings2 } from "lucide-react"
import { fetchClient } from "@/lib/api"

export function EditLimitsModal({ user, onClose, onSuccess }: { user: any, onClose: () => void, onSuccess: () => void }) {
  const [loading, setLoading] = useState(false)
  const [limits, setLimits] = useState({
     credit_budget: user?.limits?.credit_budget || '',
     credit_window: user?.limits?.credit_window || 'monthly',
     opus_cap: user?.limits?.opus_cap || '',
     opus_window: user?.limits?.opus_window || 'daily',
     sonnet_cap: user?.limits?.sonnet_cap || '',
     sonnet_window: user?.limits?.sonnet_window || 'daily',
     time_start: user?.limits?.time_start || '',
     time_end: user?.limits?.time_end || ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await fetchClient(`/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ limits })
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
                        <Label>Max Credits ($)</Label>
                        <Input type="number" placeholder="e.g. 50" value={limits.credit_budget} onChange={e => setLimits(l => ({...l, credit_budget: e.target.value}))} />
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
                        <Input type="number" placeholder="e.g. 100" value={limits.opus_cap} onChange={e => setLimits(l => ({...l, opus_cap: e.target.value}))} />
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
                        <Input type="number" placeholder="e.g. 500" value={limits.sonnet_cap} onChange={e => setLimits(l => ({...l, sonnet_cap: e.target.value}))} />
                     </div>
                     <div className="w-32 space-y-2">
                        <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={limits.sonnet_window} onChange={e => setLimits(l => ({...l, sonnet_window: e.target.value}))}>
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
                  <p className="text-xs text-muted-foreground">Leave blank to allow usage 24/7. Times are in server local time.</p>
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
