import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getUsers, getLeaderboard, updateUser, deleteUser } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Loader2,
  Plus,
  Search,
  Play,
  Pause,
  Skull,
  Trash2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react'
import { AddUserModal } from '@/components/AddUserModal'
import { ConfirmActionModal } from '@/components/ConfirmActionModal'
import { format } from 'date-fns'

function normalizeModel(model: string): string {
  if (!model) return '-'
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'Opus'
  if (lower.includes('sonnet')) return 'Sonnet'
  if (lower.includes('haiku')) return 'Haiku'
  return model
}

export function UsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [leaderMap, setLeaderMap] = useState<Map<string, any>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    user: any
    action: 'killed' | 'paused' | 'active'
  } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [usersRes, leaderRes] = await Promise.all([
        getUsers(),
        getLeaderboard(30).catch(() => ({ leaderboard: [] })),
      ])
      setUsers(usersRes?.data || usersRes?.users || [])
      const lMap = new Map()
      const leaderData = leaderRes?.data || leaderRes?.leaderboard || []
      for (const entry of leaderData) {
        lMap.set(String(entry.user_id || entry.id), entry)
      }
      setLeaderMap(lMap)
    } catch (err) {
      console.error('Failed to load users', err)
      setError('Failed to load users. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDelete = async (user: any) => {
    setDeleting(true)
    try {
      await deleteUser(user.id)
      setDeleteConfirm(null)
      loadData()
    } catch (_err) {
      alert('Failed to delete user')
    } finally {
      setDeleting(false)
    }
  }

  const handleQuickAction = async (user: any, action: 'killed' | 'paused' | 'active') => {
    try {
      await updateUser(user.id, { status: action })
      loadData()
    } catch (_err) {
      // handled by ConfirmActionModal
    }
  }

  const filteredUsers = users.filter((u: any) =>
    (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.slug || '').toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={loadData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="text-muted-foreground">Manage all developer profiles and access controls.</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            className="pl-9 bg-muted/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setShowAddModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{filteredUsers.length} Users</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="text-center p-12 border rounded-lg bg-muted/10 border-dashed">
              <p className="text-muted-foreground font-medium">
                {search ? 'No users matching your search.' : 'No users yet. Click "Add User" to create one.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Prompts</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Top Model</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user: any, idx: number) => {
                    const stats = leaderMap.get(String(user.id)) || {}
                    return (
                      <TableRow key={user.id} className={idx % 2 === 0 ? 'bg-muted/30' : ''}>
                        <TableCell>
                          <Link
                            to={`/users/${user.id}`}
                            className="font-medium hover:underline text-primary"
                          >
                            {user.name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {user.slug}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              user.status === 'active'
                                ? 'success'
                                : user.status === 'paused'
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {user.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(stats.prompts || 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(stats.credits ?? stats.cost_usd ?? stats.cost ?? 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(stats.sessions || 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="capitalize">
                            {normalizeModel(String(stats.top_model || ''))}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {user.created_at
                            ? format(new Date(user.created_at), 'MMM d, yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-green-600 hover:text-green-700"
                              title="Resume"
                              onClick={() => setConfirmAction({ user, action: 'active' })}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-yellow-600 hover:text-yellow-700"
                              title="Pause"
                              onClick={() => setConfirmAction({ user, action: 'paused' })}
                            >
                              <Pause className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-600 hover:text-red-700"
                              title="Kill"
                              onClick={() => setConfirmAction({ user, action: 'killed' })}
                            >
                              <Skull className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Delete"
                              onClick={() => setDeleteConfirm(user)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {showAddModal && (
        <AddUserModal onClose={() => setShowAddModal(false)} onSuccess={loadData} />
      )}

      {confirmAction && (
        <ConfirmActionModal
          user={confirmAction.user}
          action={confirmAction.action}
          onClose={() => setConfirmAction(null)}
          onSuccess={() => {
            setConfirmAction(null)
            handleQuickAction(confirmAction.user, confirmAction.action)
            loadData()
          }}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm shadow-lg border-destructive/20">
            <CardHeader className="text-center">
              <CardTitle>Delete User</CardTitle>
              <p className="text-sm text-muted-foreground mt-2">
                Are you sure you want to permanently delete <strong>{deleteConfirm.name}</strong> ({deleteConfirm.slug})?
                This action cannot be undone.
              </p>
            </CardHeader>
            <CardContent className="flex justify-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Delete Permanently
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
