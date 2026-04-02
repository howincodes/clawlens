import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CheckSquare,
  KeyRound,
  Lock,
  Activity,
  BarChart3,
  Brain,
  Search,
  Shield,
  ShieldAlert,
  Settings,
  Terminal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWSStore } from '@/hooks/useWebSockets'

const navItems = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/projects', label: 'Projects', icon: FolderKanban },
  { path: '/tasks', label: 'Tasks', icon: CheckSquare },
  { path: '/subscriptions', label: 'Subscriptions', icon: KeyRound },
  { path: '/credentials', label: 'Credential Vault', icon: Lock },
  { path: '/activity', label: 'Activity', icon: Activity },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/ai', label: 'AI Intelligence', icon: Brain },
  { path: '/prompts', label: 'Prompts', icon: Search },
  { path: '/roles', label: 'Roles', icon: Shield },
]

const adminItems = [
  { path: '/audit-log', label: 'Audit Log', icon: ShieldAlert },
  { path: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const wsStatus = useWSStore((s) => s.status)

  return (
    <aside className="w-64 border-r bg-card/50 backdrop-blur-sm flex flex-col hidden md:flex">
      <div className="h-16 flex items-center px-6 border-b">
        <Terminal className="w-6 h-6 mr-2 text-primary" />
        <span className="font-bold text-lg tracking-tight">HowinLens</span>
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
