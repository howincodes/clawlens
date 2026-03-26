import { Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Login } from './pages/Login'
import { useAuthStore } from './store/authStore'

import { Overview } from './pages/Overview'
import { UserDetail } from './pages/UserDetail'
import { Subscriptions } from './pages/Subscriptions'
import { Analytics } from './pages/Analytics'
import { Summaries } from './pages/Summaries'
import { PromptsBrowser } from './pages/PromptsBrowser'
import { Settings } from './pages/Settings'
import { AuditLog } from './pages/AuditLog'

export default function App() {
  const token = useAuthStore((s) => s.token)

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/users/:id" element={<UserDetail />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/summaries" element={<Summaries />} />
        <Route path="/prompts" element={<PromptsBrowser />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/audit-log" element={<AuditLog />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
