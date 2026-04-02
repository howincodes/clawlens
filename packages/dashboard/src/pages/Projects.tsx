import { useState, useEffect } from 'react'
import { getProjects, deleteProjectApi, getProjectMembersApi, getProjectRepositories } from '@/lib/api'
import { Link } from 'react-router-dom'
import CreateProjectModal from '@/components/CreateProjectModal'

export default function Projects() {
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [projectDetails, setProjectDetails] = useState<Record<number, { members: number; repos: number }>>({})

  const loadProjects = async () => {
    setLoading(true)
    try {
      const projs = await getProjects()
      const projList = Array.isArray(projs) ? projs : projs?.data || []
      setProjects(projList)

      // Load member and repo counts for each project
      const details: Record<number, { members: number; repos: number }> = {}
      await Promise.all(projList.map(async (p: any) => {
        const [members, repos] = await Promise.all([
          getProjectMembersApi(p.id).catch(() => []),
          getProjectRepositories(p.id).catch(() => []),
        ])
        const memberList = Array.isArray(members) ? members : members?.data || []
        const repoList = Array.isArray(repos) ? repos : repos?.data || []
        details[p.id] = { members: memberList.length, repos: repoList.length }
      }))
      setProjectDetails(details)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProjects() }, [])

  const handleDelete = async (id: number) => {
    if (!confirm('Archive this project?')) return
    await deleteProjectApi(id)
    loadProjects()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          + New Project
        </button>
      </div>

      <CreateProjectModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={loadProjects} />

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-gray-400 text-lg mb-2">No projects yet</div>
          <p className="text-gray-500 text-sm mb-4">Create your first project to start managing tasks and tracking work.</p>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project: any) => {
            const detail = projectDetails[project.id]
            return (
              <div key={project.id} className="bg-white border rounded-xl p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <Link to={`/projects/${project.id}`} className="text-lg font-semibold text-gray-900 hover:text-blue-600">
                    {project.name}
                  </Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${project.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {project.status}
                  </span>
                </div>
                {project.description && (
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{project.description}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                  <span>{detail?.members || 0} members</span>
                  <span>{detail?.repos || 0} repos</span>
                </div>
                <div className="flex items-center justify-between pt-3 border-t">
                  <div className="text-xs text-gray-400">
                    Created {new Date(project.createdAt).toLocaleDateString()}
                  </div>
                  <div className="flex gap-2">
                    <Link to={`/projects/${project.id}`} className="text-xs text-blue-600 hover:underline">View</Link>
                    <button onClick={() => handleDelete(project.id)} className="text-xs text-red-500 hover:underline">Archive</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
