import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'

import { supabase } from './lib/supabase'
import { AppShell } from './components/AppShell'

import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { FloorPage } from './pages/FloorPage'
import { CashPage } from './pages/CashPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { TeamPage } from './pages/TeamPage'
import { CloseoutPage } from './pages/CloseoutPage'
import { CloseoutSummaryPage } from './pages/CloseoutSummary'

export default function App() {
  const [session, setSession] =
    useState<Session | null>(null)

  const [loading, setLoading] =
    useState(true)

  useEffect(() => {
    async function loadSession() {
      const {
        data,
        error,
      } = await supabase.auth.getSession()

      if (error) {
        console.error(
          'Session error:',
          error
        )
      }

      setSession(data.session)
      setLoading(false)
    }

    void loadSession()

    const {
      data: authListener,
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession)
        setLoading(false)
      }
    )

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return (
      <div className="app-loading">
        Loading...
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route
          path="*"
          element={<LoginPage />}
        />
      </Routes>
    )
  }

  return (
    <AppShell session={session}>
      <Routes>

        <Route
          path="/"
          element={<DashboardPage />}
        />

        <Route
          path="/floor"
          element={<FloorPage />}
        />

        <Route
          path="/cash"
          element={<CashPage />}
        />

        <Route
          path="/closeout"
          element={<CloseoutPage />}
        />

        <Route
          path="/closeout-summary"
          element={<CloseoutSummaryPage />}
        />

        <Route
          path="/team"
          element={<TeamPage />}
        />

        <Route
          path="/tasks"
          element={
            <PlaceholderPage title="Tasks" />
          }
        />

        <Route
          path="/rewards"
          element={
            <PlaceholderPage title="Rewards" />
          }
        />

        <Route
          path="*"
          element={
            <Navigate
              to="/"
              replace
            />
          }
        />

      </Routes>
    </AppShell>
  )
}