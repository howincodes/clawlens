import { useAuthStore } from '@/store/authStore'
import { LogOut, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Header() {
  const logout = useAuthStore((s) => s.logout)
  const team = useAuthStore((s) => s.team)

  return (
    <header className="h-16 border-b flex items-center justify-between px-6 bg-background/95 backdrop-blur z-10 sticky top-0">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          {team?.name || 'ClawLens Admin'}
        </h2>
      </div>
      
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full"></span>
        </Button>
        <div className="w-px h-6 bg-border mx-2"></div>
        <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground">
          <LogOut className="w-4 h-4 mr-2" />
          Log out
        </Button>
      </div>
    </header>
  )
}
