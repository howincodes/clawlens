import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getProject, getProjectMembersApi, getUsers, addProjectMemberApi, removeProjectMemberApi, getTasks, getMilestones, submitRequirement, getRequirementSuggestions, approveRequirementSuggestions } from '../lib/api';

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

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      getProject(projectId),
      getProjectMembersApi(projectId),
      getUsers(),
      getTasks(projectId),
      getMilestones(projectId),
    ]).then(([p, m, u, t, ms]) => {
      setProject(p);
      setMembers(m);
      setAllUsers(u);
      setTasks(t);
      setMilestones(ms);
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

  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;
  if (!project) return <div className="p-6 text-center text-gray-500">Project not found</div>;

  const tabs = ['tasks', 'members', 'milestones', 'ai-generate'];

  const memberIds = new Set(members.map((m: any) => m.userId));
  const nonMembers = allUsers.filter((u: any) => !memberIds.has(u.id));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{project.name}</h1>
        {project.description && <p className="text-gray-600 mt-1">{project.description}</p>}
        {project.githubRepoUrl && <a href={project.githubRepoUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">{project.githubRepoUrl}</a>}
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
    </div>
  );
}
