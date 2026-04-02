import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getTasks, getProjects, createTaskApi, changeTaskStatus, deleteTaskApi } from '../lib/api';

export default function Tasks() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', effort: 'm' });

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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + New Task
        </button>
      </div>

      <div className="flex gap-4 mb-6">
        <select value={selectedProject || ''} onChange={e => setSelectedProject(Number(e.target.value))} className="border rounded-lg px-3 py-2">
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded-lg px-3 py-2">
          <option value="">All Statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

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
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No tasks yet</div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <div key={task.id} className="bg-white border rounded-lg p-4 flex items-center justify-between hover:shadow-sm transition-shadow">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Link to={`/tasks/${task.id}`} className="font-medium text-blue-600 hover:underline">{task.title}</Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColors[task.priority] || ''}`}>{task.priority}</span>
                  {task.effort && <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded">{task.effort.toUpperCase()}</span>}
                </div>
                {task.description && <p className="text-sm text-gray-600 line-clamp-1">{task.description}</p>}
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
