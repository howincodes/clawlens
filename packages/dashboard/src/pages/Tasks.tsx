import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getTasks, getProjects, createTaskApi, changeTaskStatus, deleteTaskApi, getUsers, getMilestones } from '../lib/api';

export default function Tasks() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', effort: 'm' });
  const [users, setUsers] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<number | null>(null);
  const [milestoneFilter, setMilestoneFilter] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState('created');

  useEffect(() => {
    getProjects().then(p => {
      setProjects(p);
      if (p.length > 0) setSelectedProject(p[0].id);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedProject) {
      setLoading(true);
      getTasks(selectedProject, statusFilter ? { status: statusFilter } : undefined)
        .then(setTasks)
        .finally(() => setLoading(false));
    }
  }, [selectedProject, statusFilter]);

  useEffect(() => {
    if (selectedProject) {
      getUsers().then(setUsers);
      getMilestones(selectedProject).then(setMilestones).catch(() => setMilestones([]));
    }
  }, [selectedProject]);

  const handleCreate = async () => {
    if (!selectedProject || !newTask.title) return;
    await createTaskApi({ projectId: selectedProject, ...newTask });
    setNewTask({ title: '', description: '', priority: 'medium', effort: 'm' });
    setShowCreate(false);
    const updated = await getTasks(selectedProject);
    setTasks(updated);
  };

  const handleStatusChange = async (taskId: number, status: string) => {
    await changeTaskStatus(taskId, status);
    if (selectedProject) {
      const updated = await getTasks(selectedProject, statusFilter ? { status: statusFilter } : undefined);
      setTasks(updated);
    }
  };

  const handleDelete = async (taskId: number) => {
    if (!confirm('Delete this task?')) return;
    await deleteTaskApi(taskId);
    if (selectedProject) {
      const updated = await getTasks(selectedProject, statusFilter ? { status: statusFilter } : undefined);
      setTasks(updated);
    }
  };

  const getUserName = (id: number | null) => {
    if (!id) return 'Unassigned';
    const user = users.find((u: any) => u.id === id);
    return user?.name || 'Unknown';
  };

  const statuses = ['open', 'in_progress', 'done', 'blocked'];
  const priorities = ['low', 'medium', 'high', 'urgent'];
  const priorityColors: Record<string, string> = {
    low: 'bg-gray-100 text-gray-700',
    medium: 'bg-blue-100 text-blue-700',
    high: 'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700',
  };
  const statusColors: Record<string, string> = {
    open: 'bg-gray-100 text-gray-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    done: 'bg-green-100 text-green-700',
    blocked: 'bg-red-100 text-red-700',
  };
  const effortColors: Record<string, string> = {
    xs: 'bg-green-100 text-green-700',
    s: 'bg-blue-100 text-blue-700',
    m: 'bg-yellow-100 text-yellow-700',
    l: 'bg-orange-100 text-orange-700',
    xl: 'bg-red-100 text-red-700',
  };

  const statusCounts = tasks.reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  const filteredTasks = tasks
    .filter(t => !search || t.title.toLowerCase().includes(search.toLowerCase()))
    .filter(t => !assigneeFilter || t.assigneeId === assigneeFilter)
    .filter(t => !milestoneFilter || t.milestoneId === milestoneFilter)
    .sort((a, b) => {
      if (sortBy === 'priority') {
        const order: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        return (order[a.priority] ?? 4) - (order[b.priority] ?? 4);
      }
      if (sortBy === 'updated') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + New Task
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={selectedProject || ''} onChange={e => setSelectedProject(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={assigneeFilter ?? ''} onChange={e => setAssigneeFilter(e.target.value ? Number(e.target.value) : null)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Assignees</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={milestoneFilter ?? ''} onChange={e => setMilestoneFilter(e.target.value ? Number(e.target.value) : null)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Milestones</option>
          {milestones.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="created">Newest</option>
          <option value="priority">Priority</option>
          <option value="updated">Last Updated</option>
        </select>
        <input type="text" placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" />
      </div>

      {tasks.length > 0 && (
        <div className="flex items-center gap-3 text-sm text-gray-600 mb-4 bg-gray-50 rounded-lg px-4 py-2">
          <span className="font-medium">{tasks.length} tasks:</span>
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status} className={`${statusColors[status] || ''} px-2 py-0.5 rounded-full text-xs`}>
              {count} {status.replace('_', ' ')}
            </span>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="bg-white border rounded-lg p-4 mb-6 shadow-sm">
          <h3 className="font-semibold mb-3">New Task</h3>
          <input type="text" placeholder="Task title" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} className="w-full border rounded px-3 py-2 mb-2" />
          <textarea placeholder="Description" value={newTask.description} onChange={e => setNewTask({ ...newTask, description: e.target.value })} className="w-full border rounded px-3 py-2 mb-2" rows={3} />
          <div className="flex gap-2 mb-3">
            <select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })} className="border rounded px-3 py-2">
              {priorities.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={newTask.effort} onChange={e => setNewTask({ ...newTask, effort: e.target.value })} className="border rounded px-3 py-2">
              <option value="xs">XS (&lt;1h)</option>
              <option value="s">S (1-4h)</option>
              <option value="m">M (1-2d)</option>
              <option value="l">L (3-5d)</option>
              <option value="xl">XL (1w+)</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No tasks found</div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map(task => (
            <div key={task.id} className="bg-white border rounded-lg p-4 flex items-center justify-between hover:shadow-sm transition-shadow">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Link to={`/tasks/${task.id}`} className="font-medium text-blue-600 hover:underline">{task.title}</Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColors[task.priority] || ''}`}>{task.priority}</span>
                  {task.effort && <span className={`text-xs px-2 py-0.5 rounded-full ${effortColors[task.effort] || 'bg-gray-100 text-gray-700'}`}>{task.effort.toUpperCase()}</span>}
                </div>
                {task.description && <p className="text-sm text-gray-600 line-clamp-1">{task.description}</p>}
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                  <span>{getUserName(task.assigneeId)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <select value={task.status} onChange={e => handleStatusChange(task.id, e.target.value)} className={`text-xs px-2 py-1 rounded-full border-0 ${statusColors[task.status] || ''}`}>
                  {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <button onClick={() => handleDelete(task.id)} className="text-gray-400 hover:text-red-500 text-sm">&times;</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
