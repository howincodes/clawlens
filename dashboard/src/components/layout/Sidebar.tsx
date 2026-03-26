import { NavLink } from 'react-router-dom'
import { 
  LayoutDashboard, 
  CreditCard,  
  BarChart3, 
  Sparkles, 
  Search, 
  Settings, 
  ShieldAlert,
  Terminal
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWSStore } from '@/hooks/useWebSockets'

const navItems = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/summaries', label: 'AI Summaries', icon: Sparkles },
  { path: '/prompts', label: 'Prompts Browser', icon: Search },
]

const adminItems = [
  { path: '/settings', label: 'Settings', icon: Settings },
  { path: '/audit-log', label: 'Audit Log', icon: ShieldAlert },
]

export function Sidebar() {
  const wsStatus = useWSStore((s) => s.status)

  return (
    <aside className="w-64 border-r bg-card/50 backdrop-blur-sm flex flex-col hidden md:flex">
      <div className="h-16 flex items-center px-6 border-b">
        <Terminal className="w-6 h-6 mr-2 text-primary" />
        <span className="font-bold text-lg tracking-tight">ClawLens</span>
      </div>
      
      <div className="flex-1 py-6 overflow-y-auto px-3 space-y-6">
        <div>
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Dashboard
          </p>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    isActive 
                      ? "bg-primary text-primary-foreground" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )
                }
              >
                <item.icon className="w-4 h-4 mr-3" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div>
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            System
          </p>
          <nav className="space-y-1">
            {adminItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    isActive 
                      ? "bg-primary text-primary-foreground" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )
                }
              >
                <item.icon className="w-4 h-4 mr-3" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      <div className="p-4 border-t mt-auto">
        <div className="flex items-center text-sm text-muted-foreground">
          <span className="relative flex h-3 w-3 mr-2">
            <span className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              wsStatus === 'connected' ? 'bg-green-400' : wsStatus === 'reconnecting' ? 'bg-yellow-400' : 'bg-red-400'
            )}></span>
            <span className={cn(
              "relative inline-flex rounded-full h-3 w-3",
              wsStatus === 'connected' ? 'bg-green-500' : wsStatus === 'reconnecting' ? 'bg-yellow-500' : 'bg-red-500'
            )}></span>
          </span>
          <span className="capitalize">{wsStatus}</span>
        </div>
      </div>
    </aside>
  )
}
