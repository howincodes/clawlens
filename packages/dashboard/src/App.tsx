import { Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Login } from './pages/Login'
import { useAuthStore } from './store/authStore'

import { Overview } from './pages/Overview'
import { UserDetail } from './pages/UserDetail'
import { Analytics } from './pages/Analytics'
import { AIIntelligence } from './pages/AIIntelligence'
import { PromptsBrowser } from './pages/PromptsBrowser'
import { Settings } from './pages/Settings'
import { AuditLog } from './pages/AuditLog'
import { UsersPage } from './pages/Users'
import Tasks from './pages/Tasks'
import TaskDetail from './pages/TaskDetail'
import SubscriptionsManager from './pages/SubscriptionsManager'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import ActivitySummary from './pages/ActivitySummary'
import Roles from './pages/Roles'
import Credentials from './pages/Credentials'
import CredentialAdd from './pages/CredentialAdd'

export default function App() {
  const token = useAuthStore((s) => s.token)

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/users/:id" element={<UserDetail />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/subscriptions" element={<SubscriptionsManager />} />
        <Route path="/credentials" element={<Credentials />} />
        <Route path="/credentials/add" element={<CredentialAdd />} />
        <Route path="/subscriptions-manager" element={<Navigate to="/subscriptions" replace />} />
        <Route path="/activity" element={<ActivitySummary />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/ai" element={<AIIntelligence />} />
        <Route path="/summaries" element={<Navigate to="/ai" replace />} />
        <Route path="/prompts" element={<PromptsBrowser />} />
        <Route path="/audit-log" element={<AuditLog />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
