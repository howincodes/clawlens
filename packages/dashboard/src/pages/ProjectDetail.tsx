import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getProject, getProjectMembersApi, getUsers, addProjectMemberApi, removeProjectMemberApi, getTasks, getMilestones, submitRequirement, getRequirementSuggestions, approveRequirementSuggestions, getProjectRepositories, removeProjectRepositoryApi, updateProjectApi, getTaskStatuses, createTaskStatusApi } from '../lib/api';
import AddRepoModal from '../components/AddRepoModal';

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = parseInt(id || '0');
  const [project, setProject] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('tasks');
  const [loading, setLoading] = useState(true);
  const [requirementText, setRequirementText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [lastRequirementId, setLastRequirementId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Repositories state
  const [repos, setRepos] = useState<any[]>([]);
  const [showAddRepo, setShowAddRepo] = useState(false);

  // Settings state
  const [statuses, setStatuses] = useState<any[]>([]);
  const [editingProject, setEditingProject] = useState(false);
  const [editProjectData, setEditProjectData] = useState({ name: '', description: '' });
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#6B7280');

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      getProject(projectId),
      getProjectMembersApi(projectId),
      getUsers(),
      getTasks(projectId),
      getMilestones(projectId),
      getProjectRepositories(projectId).catch(() => []),
      getTaskStatuses(projectId).catch(() => []),
    ]).then(([p, m, u, t, ms, r, st]) => {
      setProject(p);
      setMembers(m);
      setAllUsers(u);
      setTasks(t);
      setMilestones(ms);
      setRepos(Array.isArray(r) ? r : r?.data || []);
      setStatuses(Array.isArray(st) ? st : st?.data || []);
      setEditProjectData({ name: p?.name || '', description: p?.description || '' });
    }).finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleAddMember = async (userId: number) => {
    await addProjectMemberApi(projectId, { userId });
    const m = await getProjectMembersApi(projectId);
    setMembers(m);
  };

  const handleRemoveMember = async (userId: number) => {
    await removeProjectMemberApi(projectId, userId);
    const m = await getProjectMembersApi(projectId);
    setMembers(m);
  };

  const handleSubmitRequirement = async () => {
    if (!requirementText.trim()) return;
    setGenerating(true);
    try {
      const input = await submitRequirement({ projectId, inputType: 'text', content: requirementText });
      setLastRequirementId(input.id);
      // Poll for suggestions (AI generates in background)
      let attempts = 0;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const sugg = await getRequirementSuggestions(input.id);
          if (sugg && sugg.status !== 'not_generated') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setSuggestions(sugg);
            setGenerating(false);
          }
        } catch {}
        if (attempts > 30) { // 30 seconds timeout
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setGenerating(false);
        }
      }, 1000);
    } catch {
      setGenerating(false);
    }
  };

  const handleApproveSuggestions = async () => {
    if (!lastRequirementId) return;
    await approveRequirementSuggestions(lastRequirementId);
    setSuggestions(null);
    setRequirementText('');
    setLastRequirementId(null);
    const t = await getTasks(projectId);
    setTasks(t);
  };

  const handleSaveProject = async () => {
    if (!editProjectData.name.trim()) return;
    await updateProjectApi(projectId, editProjectData);
    const p = await getProject(projectId);
    setProject(p);
    setEditingProject(false);
  };

  const handleCreateStatus = async () => {
    if (!newStatusName.trim()) return;
    await createTaskStatusApi(projectId, { name: newStatusName, color: newStatusColor });
    const st = await getTaskStatuses(projectId);
    setStatuses(Array.isArray(st) ? st : st?.data || []);
    setNewStatusName('');
    setNewStatusColor('#6B7280');
  };

  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;
  if (!project) return <div className="p-6 text-center text-gray-500">Project not found</div>;

  const tabs = ['tasks', 'members', 'milestones', 'repositories', 'ai-generate', 'settings'];

  const memberIds = new Set(members.map((m: any) => m.userId));
  const nonMembers = allUsers.filter((u: any) => !memberIds.has(u.id));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{project.name}</h1>
        {project.description && <p className="text-gray-600 mt-1">{project.description}</p>}
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold">{tasks.length}</div>
          <div className="text-xs text-gray-500">Tasks</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold">{members.length}</div>
          <div className="text-xs text-gray-500">Members</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold">{repos.length}</div>
          <div className="text-xs text-gray-500">Repos</div>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab === 'ai-generate' ? 'AI Generate' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'tasks' && (
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No tasks yet. Use the AI Generate tab to create tasks from requirements.</p>
          ) : tasks.map((task: any) => (
            <div key={task.id} className="bg-white border rounded-lg p-3 flex items-center justify-between">
              <div>
                <Link to={`/tasks/${task.id}`} className="font-medium text-blue-600 hover:underline">{task.title}</Link>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${task.status === 'done' ? 'bg-green-100 text-green-700' : task.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700'}`}>{task.status}</span>
                <span className="ml-2 text-xs text-gray-500">{task.priority}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'members' && (
        <div>
          <div className="space-y-2 mb-6">
            {members.map((m: any) => (
              <div key={m.userId} className="bg-white border rounded-lg p-3 flex items-center justify-between">
                <span>{m.userName || `User ${m.userId}`}</span>
                <button onClick={() => handleRemoveMember(m.userId)} className="text-sm text-red-600 hover:underline">Remove</button>
              </div>
            ))}
          </div>
          {nonMembers.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 mb-2">Add Member</h3>
              <div className="space-y-1">
                {nonMembers.map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                    <span className="text-sm">{u.name}</span>
                    <button onClick={() => handleAddMember(u.id)} className="text-sm text-blue-600 hover:underline">Add</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'milestones' && (
        <div className="space-y-2">
          {milestones.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No milestones yet</p>
          ) : milestones.map((ms: any) => (
            <div key={ms.id} className="bg-white border rounded-lg p-3">
              <span className="font-medium">{ms.name}</span>
              {ms.dueDate && <span className="ml-2 text-sm text-gray-500">Due: {ms.dueDate}</span>}
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${ms.status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{ms.status}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'repositories' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Repositories ({repos.length})</h3>
            <button onClick={() => setShowAddRepo(true)} className="text-sm text-blue-600 hover:underline">+ Add Repository</button>
          </div>
          <AddRepoModal open={showAddRepo} onClose={() => setShowAddRepo(false)} projectId={projectId} onAdded={() => getProjectRepositories(projectId).then(r => setRepos(Array.isArray(r) ? r : r?.data || []))} />
          {repos.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No repositories linked yet</p>
          ) : (
            <div className="space-y-2">
              {repos.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between bg-white border rounded-lg p-3">
                  <div>
                    <a href={r.githubRepoUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 hover:underline">{r.githubRepoUrl}</a>
                    {r.label && <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{r.label}</span>}
                  </div>
                  <button onClick={async () => { await removeProjectRepositoryApi(r.id); const updated = await getProjectRepositories(projectId); setRepos(Array.isArray(updated) ? updated : updated?.data || []); }} className="text-sm text-red-500 hover:underline">Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'ai-generate' && (
        <div>
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-3">Generate Tasks from Requirements</h3>
            <textarea value={requirementText} onChange={e => setRequirementText(e.target.value)} placeholder="Paste meeting notes, requirements, or feature descriptions here..." className="w-full border rounded px-3 py-2 mb-3" rows={8} />
            <div className="mb-3">
              <label className="text-sm text-gray-500">Or upload a document:</label>
              <input type="file" accept=".txt,.md,.pdf,.doc,.docx" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const text = await file.text();
                  setRequirementText(text);
                }
              }} className="block mt-1 text-sm" />
            </div>
            <button onClick={handleSubmitRequirement} disabled={generating || !requirementText.trim()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {generating ? 'Generating...' : 'Generate Tasks'}
            </button>
          </div>

          {suggestions && suggestions.suggestedTasks && (
            <div className="mt-4 bg-white border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">AI Suggestions ({Array.isArray(suggestions.suggestedTasks) ? suggestions.suggestedTasks.length : 0} tasks)</h3>
                <button onClick={handleApproveSuggestions} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                  Approve All &amp; Create Tasks
                </button>
              </div>
              <div className="space-y-2">
                {Array.isArray(suggestions.suggestedTasks) && suggestions.suggestedTasks.map((task: any, i: number) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-3">
                    <div className="font-medium">{task.title}</div>
                    {task.description && <p className="text-sm text-gray-600 mt-1">{task.description}</p>}
                    <div className="flex gap-2 mt-2">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{task.priority}</span>
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{task.effort}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Edit Project Details */}
          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Project Details</h3>
              {!editingProject && (
                <button onClick={() => setEditingProject(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
              )}
            </div>
            {editingProject ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={editProjectData.name}
                    onChange={e => setEditProjectData({ ...editProjectData, name: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Description</label>
                  <textarea
                    value={editProjectData.description}
                    onChange={e => setEditProjectData({ ...editProjectData, description: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSaveProject} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                  <button onClick={() => { setEditingProject(false); setEditProjectData({ name: project.name || '', description: project.description || '' }); }} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Name</span>
                  <span className="font-medium">{project.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Description</span>
                  <span className="text-gray-700">{project.description || 'No description'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span>{project.createdAt || project.created_at ? new Date(project.createdAt || project.created_at).toLocaleDateString() : 'N/A'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Custom Task Statuses */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Custom Task Statuses</h3>
            {statuses.length > 0 && (
              <div className="space-y-2 mb-4">
                {statuses.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 bg-gray-50 rounded px-3 py-2 text-sm">
                    <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: s.color || '#6B7280' }} />
                    <span className="font-medium flex-1">{s.name}</span>
                    {s.isDoneState && <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">Done State</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newStatusColor}
                onChange={e => setNewStatusColor(e.target.value)}
                className="w-8 h-8 rounded border cursor-pointer"
              />
              <input
                type="text"
                value={newStatusName}
                onChange={e => setNewStatusName(e.target.value)}
                placeholder="New status name..."
                className="flex-1 border rounded px-3 py-2 text-sm"
              />
              <button onClick={handleCreateStatus} disabled={!newStatusName.trim()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm">
                Add Status
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-white border border-red-200 rounded-lg p-4">
            <h3 className="font-semibold text-red-600 mb-2">Danger Zone</h3>
            <p className="text-sm text-gray-500 mb-3">Archiving a project hides it from the active project list. This action can be reversed.</p>
            <button
              onClick={async () => {
                if (!confirm('Are you sure you want to archive this project?')) return;
                await updateProjectApi(projectId, { status: 'archived' });
                const p = await getProject(projectId);
                setProject(p);
              }}
              className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"
            >
              Archive Project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
