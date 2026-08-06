import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { FloorPage } from './pages/FloorPage'
import { CashPage } from './pages/CashPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="center-screen">Loading…</div>

  if (!session) {
    return <Routes><Route path="*" element={<LoginPage />} /></Routes>
  }

  return (
    <AppShell session={session}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/floor" element={<FloorPage />} />
        <Route path="/cash" element={<CashPage />} />
        <Route path="/tasks" element={<PlaceholderPage title="Tasks" />} />
        <Route path="/rewards" element={<PlaceholderPage title="Rewards" />} />
        <Route path="/team" element={<PlaceholderPage title="Team" />} />
        <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
        <Route path="/admin" element={<PlaceholderPage title="Admin" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
