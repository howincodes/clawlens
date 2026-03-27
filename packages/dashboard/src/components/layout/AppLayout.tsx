import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useAuthStore } from '@/store/authStore'
import { useWebSocket, useWSStore } from '@/hooks/useWebSockets'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

function Toaster() {
  const events = useWSStore((s) => s.events)
  const [toasts, setToasts] = useState<any[]>([])
  
  // Track last seen event timestamp to only show new events
  const [lastSeen, setLastSeen] = useState(Date.now())

  useEffect(() => {
    const newEvents = events.filter(e => e.timestamp > lastSeen && ['prompt_blocked', 'user_killed', 'rate_limit_hit'].includes(e.type))
    if (newEvents.length > 0) {
       newEvents.forEach(evt => {
          const id = Date.now() + Math.random()
          setToasts(curr => [...curr, { id, ...evt }])
          setTimeout(() => {
            setToasts(curr => curr.filter(t => t.id !== id))
          }, 5000)
       })
       setLastSeen(Date.now())
    }
  }, [events, lastSeen])

  if (toasts.length === 0) return null

  return (
     <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
           <div key={t.id} className="bg-destructive text-destructive-foreground shadow-lg px-4 py-3 rounded-md flex items-start gap-3 min-w-[300px] animate-in slide-in-from-right">
              <div className="flex-1">
                 <p className="font-semibold text-sm capitalize">{t.type.replace(/_/g, ' ')}</p>
                 <p className="text-xs opacity-90 mt-1">{t.payload?.user?.name || t.payload?.user_id} triggered an alert.</p>
              </div>
              <button onClick={() => setToasts(c => c.filter(x => x.id !== t.id))} className="text-destructive-foreground/70 hover:text-white">
                 <X className="w-4 h-4" />
              </button>
           </div>
        ))}
     </div>
  )
}

export function AppLayout() {
  const token = useAuthStore((s) => s.token)
  
  useWebSocket()

  if (!token) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full relative">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
