import { useState, useEffect } from 'react'
import { getUsers, getProjects, getSubscriptionUsage, getSubscriptionCredentials, getMe } from '@/lib/api'
import { Link } from 'react-router-dom'
import RoleBadge from '@/components/RoleBadge'
import UsageBar from '@/components/UsageBar'

export default function Overview() {
  const [me, setMe] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [credentials, setCredentials] = useState<any[]>([])
  const [usage, setUsage] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getMe().catch(() => null),
      getUsers().catch(() => []),
      getProjects().catch(() => []),
      getSubscriptionCredentials().catch(() => []),
      getSubscriptionUsage().catch(() => []),
    ]).then(([m, u, p, c, us]) => {
      setMe(m)
      setUsers(Array.isArray(u) ? u : u?.data || u?.users || [])
      setProjects(Array.isArray(p) ? p : p?.data || [])
      setCredentials(Array.isArray(c) ? c : c?.data || [])
      setUsage(Array.isArray(us) ? us : us?.data || [])
    }).finally(() => setLoading(false))
  }, [])

  // Auto-refresh usage every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      getSubscriptionUsage().then((us) => setUsage(Array.isArray(us) ? us : us?.data || [])).catch(() => {})
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>

  const onWatchCount = users.filter((u: any) => u.status === 'active').length

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Welcome */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back{me?.user?.name ? `, ${me.user.name}` : ''}</h1>
          <p className="text-sm text-gray-500 mt-1">HowinLens Dashboard</p>
        </div>
        {me?.roles?.[0] && <RoleBadge role={me.roles[0].roleName || 'Admin'} />}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">Users</div>
          <div className="text-2xl font-bold text-gray-900">{users.length}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">Projects</div>
          <div className="text-2xl font-bold text-gray-900">{projects.length}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">Subscriptions</div>
          <div className="text-2xl font-bold text-gray-900">{credentials.length}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">Active Users</div>
          <div className="text-2xl font-bold text-green-600">{onWatchCount}</div>
        </div>
      </div>

      {/* Subscription Usage */}
      {credentials.length > 0 && (
        <div className="bg-white border rounded-xl p-5 mb-8">
          <h2 className="text-lg font-semibold mb-4">Subscription Usage</h2>
          <div className="space-y-4">
            {credentials.map((cred: any) => {
              const credUsage = usage.find((u: any) => u.id === cred.id)
              return (
                <div key={cred.id} className="flex items-center gap-4">
                  <div className="w-48 truncate">
                    <div className="font-medium text-sm">{cred.email}</div>
                    <div className="text-xs text-gray-500">{cred.subscriptionType || 'pro'} &bull; {cred.activeUsers || 0} users</div>
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <UsageBar value={credUsage?.usage?.fiveHourUtilization || 0} label="5-Hour" size="sm" />
                    <UsageBar value={credUsage?.usage?.sevenDayUtilization || 0} label="7-Day" size="sm" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Users Quick View */}
        <div className="bg-white border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Users</h2>
            <Link to="/users" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="space-y-2">
            {users.slice(0, 8).map((user: any) => (
              <Link key={user.id} to={`/users/${user.id}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-sm font-medium text-gray-600">
                    {user.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-gray-500">{user.email}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {user.status === 'active' ? '\u{1F7E2}' : user.status === 'killed' ? '\u{1F534}' : '\u26AB'}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Projects Quick View */}
        <div className="bg-white border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Projects</h2>
            <Link to="/projects" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          {projects.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p>No projects yet</p>
              <Link to="/projects" className="text-sm text-blue-600 hover:underline mt-2 inline-block">Create your first project</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.slice(0, 8).map((project: any) => (
                <Link key={project.id} to={`/projects/${project.id}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div>
                    <div className="text-sm font-medium">{project.name}</div>
                    {project.description && <div className="text-xs text-gray-500 line-clamp-1">{project.description}</div>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${project.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {project.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Keep backward-compatible named export
export { Overview }
