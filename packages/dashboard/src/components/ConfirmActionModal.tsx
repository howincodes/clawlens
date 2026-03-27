import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, AlertTriangle } from "lucide-react"
import { fetchClient } from "@/lib/api"

export function ConfirmActionModal({ user, action, onClose, onSuccess }: { user: any, action: 'killed' | 'paused' | 'active', onClose: () => void, onSuccess: () => void }) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await fetchClient(`/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: action })
      })
      alert(`User status updated to ${action}.`)
      onSuccess()
    } catch (err) {
       alert("Action failed")
    } finally {
       setLoading(false)
    }
  }

  const actText = action === 'killed' ? 'Kill' : action === 'paused' ? 'Pause' : 'Reinstate'

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm shadow-lg border-destructive/20 relative">
         <CardHeader>
           <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-2 mx-auto">
             <AlertTriangle className="w-6 h-6" />
           </div>
           <CardTitle className="text-center">{actText} User</CardTitle>
           <CardDescription className="text-center">
             Are you sure you want to {actText.toLowerCase()} <strong>{user.name}</strong> ({user.slug})?
           </CardDescription>
         </CardHeader>
         <CardContent>
            <p className="text-xs text-muted-foreground text-center">
               {action === 'killed' 
                 ? 'This revokes credentials globally. The dev will be forcibly disconnected.' 
                 : action === 'paused' ? 'This temporarily halts AI access. They can be reinstated later.' 
                 : 'This restores API access to its previous state.'}
            </p>
         </CardContent>
         <CardFooter className="flex justify-center gap-2 border-t pt-4">
           <Button variant="ghost" className="w-full" onClick={onClose} disabled={loading}>Cancel</Button>
           <Button variant={action === 'active' ? 'default' : 'destructive'} className="w-full" onClick={handleConfirm} disabled={loading}>
             {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
             Confirm {actText}
           </Button>
         </CardFooter>
      </Card>
    </div>
  )
}
