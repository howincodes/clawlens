import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getTask, updateTaskApi, addTaskComment, assignTask, changeTaskStatus, deleteTaskApi, getUsers, createTaskApi, getProjects } from '../lib/api';

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const taskId = parseInt(id || '0');
  const [task, setTask] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ title: '', description: '', priority: '', effort: '' });
  const [newSubtask, setNewSubtask] = useState('');
  const [project, setProject] = useState<any>(null);

  const loadTask = async () => {
    const [t, u] = await Promise.all([getTask(taskId), getUsers()]);
    setTask(t);
    setUsers(u);
    setEditData({ title: t.title, description: t.description || '', priority: t.priority, effort: t.effort || '' });
    if (t.projectId) {
      getProjects().then(projs => {
        const p = projs.find((p: any) => p.id === t.projectId);
        setProject(p);
      });
    }
    setLoading(false);
  };

  useEffect(() => { if (taskId) loadTask(); }, [taskId]);

  const handleComment = async () => {
    if (!comment.trim()) return;
    await addTaskComment(taskId, comment);
    setComment('');
    loadTask();
  };

  const handleSave = async () => {
    await updateTaskApi(taskId, editData);
    setEditing(false);
    loadTask();
  };

  const handleStatusChange = async (status: string) => {
    await changeTaskStatus(taskId, status);
    loadTask();
  };

  const handleAssign = async (assigneeId: number) => {
    await assignTask(taskId, assigneeId);
    loadTask();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this task?')) return;
    await deleteTaskApi(taskId);
    navigate(-1);
  };

  const handleAddSubtask = async () => {
    if (!newSubtask.trim() || !task) return;
    await createTaskApi({ projectId: task.projectId, title: newSubtask, parentTaskId: taskId });
    setNewSubtask('');
    loadTask();
  };

  const getUserName = (id: number | null) => {
    if (!id) return null;
    const user = users.find((u: any) => u.id === id);
    return user?.name || `User #${id}`;
  };

  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;
  if (!task) return <div className="p-6 text-center text-gray-500">Task not found</div>;

  const statuses = ['open', 'in_progress', 'done', 'blocked'];
  const priorities = ['low', 'medium', 'high', 'urgent'];
  const statusColors: Record<string, string> = { open: 'bg-gray-100 text-gray-700', in_progress: 'bg-yellow-100 text-yellow-700', done: 'bg-green-100 text-green-700', blocked: 'bg-red-100 text-red-700' };
  const priorityColors: Record<string, string> = { low: 'bg-gray-100 text-gray-700', medium: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700' };

  const activityIcons: Record<string, string> = {
    created: '\u{1F195}',
    status_changed: '\u{1F504}',
    assigned: '\u{1F464}',
    commented: '\u{1F4AC}',
    priority_changed: '\u{26A1}',
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">&larr; Back</button>

      <div className="bg-white border rounded-lg p-6 mb-6">
        {editing ? (
          <div className="space-y-3">
            <input type="text" value={editData.title} onChange={e => setEditData({ ...editData, title: e.target.value })} className="w-full text-xl font-bold border rounded px-3 py-2" />
            <textarea value={editData.description} onChange={e => setEditData({ ...editData, description: e.target.value })} className="w-full border rounded px-3 py-2" rows={4} />
            <div className="flex gap-2">
              <select value={editData.priority} onChange={e => setEditData({ ...editData, priority: e.target.value })} className="border rounded px-3 py-2">
                {priorities.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={editData.effort} onChange={e => setEditData({ ...editData, effort: e.target.value })} className="border rounded px-3 py-2">
                <option value="xs">XS</option><option value="s">S</option><option value="m">M</option><option value="l">L</option><option value="xl">XL</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 bg-gray-200 rounded">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-xl font-bold">{task.title}</h1>
              <div className="flex gap-2">
                <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
                <button onClick={handleDelete} className="text-sm text-red-600 hover:underline">Delete</button>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
              {project && <Link to={`/projects/${project.id}`} className="text-blue-600 hover:underline">{project.name}</Link>}
              {task.milestoneId && <span>Milestone #{task.milestoneId}</span>}
              <span>Created {new Date(task.createdAt).toLocaleDateString()}</span>
              {task.createdBy && <span>by {getUserName(task.createdBy) || `User #${task.createdBy}`}</span>}
              {task.githubIssueUrl && (
                <a href={task.githubIssueUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  GitHub Issue #{task.githubIssueId}
                </a>
              )}
            </div>
            {task.description && <p className="text-gray-600 mb-4">{task.description}</p>}
            <div className="flex flex-wrap gap-3 items-center">
              <select value={task.status} onChange={e => handleStatusChange(e.target.value)} className={`text-sm px-3 py-1 rounded-full ${statusColors[task.status] || ''}`}>
                {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
              <span className={`text-sm px-3 py-1 rounded-full ${priorityColors[task.priority] || ''}`}>{task.priority}</span>
              {task.effort && <span className="text-sm px-3 py-1 rounded bg-gray-50">{task.effort.toUpperCase()}</span>}
              <select value={task.assigneeId || ''} onChange={e => handleAssign(Number(e.target.value))} className="text-sm border rounded px-2 py-1">
                <option value="">Unassigned</option>
                {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Subtasks */}
      <div className="bg-white border rounded-lg p-4 mb-6">
        <h3 className="font-semibold mb-3">Subtasks</h3>
        {task.subtasks?.length > 0 ? (
          <div className="space-y-1 mb-3">
            {task.subtasks.map((st: any) => (
              <div key={st.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-sm">
                <span>{st.title}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[st.status] || ''}`}>{st.status}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-500 mb-3">No subtasks</p>}
        <div className="flex gap-2">
          <input type="text" placeholder="Add subtask..." value={newSubtask} onChange={e => setNewSubtask(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddSubtask()} className="flex-1 border rounded px-3 py-1.5 text-sm" />
          <button onClick={handleAddSubtask} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">Add</button>
        </div>
      </div>

      {/* Comments */}
      <div className="bg-white border rounded-lg p-4 mb-6">
        <h3 className="font-semibold mb-3">Comments ({task.comments?.length || 0})</h3>
        <div className="space-y-3 mb-4">
          {task.comments?.map((c: any) => (
            <div key={c.id} className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">{new Date(c.createdAt).toLocaleString()}</div>
              <p className="text-sm">{c.content}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input type="text" placeholder="Write a comment..." value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleComment()} className="flex-1 border rounded px-3 py-2" />
          <button onClick={handleComment} className="px-4 py-2 bg-blue-600 text-white rounded">Post</button>
        </div>
      </div>

      {/* Activity Log */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-3">Activity ({task.activity?.length || 0})</h3>
        <div className="space-y-2">
          {task.activity?.map((a: any) => (
            <div key={a.id} className="flex items-center gap-2 text-sm text-gray-600">
              <span className="text-xs text-gray-400">{new Date(a.createdAt).toLocaleString()}</span>
              <span>{activityIcons[a.action] || '\u{1F4DD}'} {a.action.replace('_', ' ')}</span>
              {a.oldValue && <span className="line-through text-gray-400">{a.oldValue}</span>}
              {a.newValue && <span className="font-medium">{a.newValue}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
