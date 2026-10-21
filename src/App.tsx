import {PageCanvas} from './components/PageLayout'
import {CrewSchedulePage} from './pages/CrewSchedulePage'
import {ReportsPage} from './pages/ReportsPage'
import {AccessSection} from './components/AppAccess'
import {GuestServicesPage} from './pages/GuestServicesPage'
import {AppAccessProvider,AppPageAccess} from './components/AppAccess'
// page-designer-instrumented
import {StaffViewPage} from './pages/StaffViewPage'
import { CalendarPage } from './pages/CalendarPage'
import { PageWord } from "./components/PageDesign"
import { ScreenWordingPage } from './pages/ScreenWordingPage'
import { TrainingPage } from './pages/TrainingPage'
import { CocktailTrainingPage } from './pages/CocktailTrainingPage'
import { InventoryPage } from './pages/InventoryPage'
import { GuestFeedbackPage } from './pages/GuestFeedbackPage'
import { GuestFeedbackInbox } from './pages/GuestFeedbackInbox'
import { WalkInPage } from './pages/WalkInPage'
import { useLocation } from 'react-router-dom'
import { SalesTargetsPage } from './pages/SalesTargetsPage'
import { TasksPage } from './pages/TasksPage'
import { SettingsPage } from './pages/SettingsPage'
import { SummaryPage } from './pages/SummaryPage'
import {StickerBankPage} from './pages/StickerBankPage'
import { AppearancePage as LocationAppearancePage } from './pages/AppearancePage'
import { ManagementOnly as AppearanceGuard } from './components/ManagementAccess'
import { PreshiftFeedPage } from './pages/PreshiftFeedPage'
import { QuizBuilderPage } from './pages/QuizBuilderPage'
import { QuizzesPage } from './pages/QuizzesPage'
import { SignupGate } from './components/SignupGate'
import { PermissionsPage } from './pages/PermissionsPage'
import { ManagementOnly } from './components/ManagementAccess'
import { CloseoutHub } from './pages/CloseoutHub'
import { CloseoutSettingsPage } from './pages/CloseoutSettingsPage'
import { ManagerCloseoutPage } from './pages/ManagerCloseoutPage'
import { PointsPage } from './pages/PointsPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
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
import { PlaceholderPage } from './pages/PlaceholderPage'
import { TeamPage } from './pages/TeamPage'
import { CloseoutPage } from './pages/CloseoutPage'
import { ReservationInquiryPage } from './pages/ReservationInquiryPage'
import { InquiryStudioPage } from './pages/InquiryStudioPage'


export default function App() {
  const walkinPath=useLocation().pathname
  const [recovering, setRecovering] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const query = new URLSearchParams(window.location.search)
    const recoveryLink =
      hash.get('type') === 'recovery' ||
      query.get('type') === 'recovery' ||
      window.location.pathname === '/reset-password'
    if (recoveryLink) sessionStorage.setItem('lnx-password-recovery', '1')
    return recoveryLink || sessionStorage.getItem('lnx-password-recovery') === '1'
  })

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
      (event, nextSession) => {
        if (event === 'PASSWORD_RECOVERY') {
          sessionStorage.setItem('lnx-password-recovery', '1')
          setRecovering(true)
        }
        setSession(nextSession)
        setLoading(false)
      }
    )

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  if (walkinPath.startsWith('/guest-feedback/')) return <PageCanvas><GuestFeedbackPage key={walkinPath} publicKey={walkinPath.slice('/guest-feedback/'.length)} /></PageCanvas>

  if (walkinPath.startsWith('/walk-in/')) return <PageCanvas><WalkInPage key={walkinPath} publicKey={walkinPath.slice('/walk-in/'.length)} /></PageCanvas>

  if (loading) {
    return (
      <div data-design-block="copy.47b021b4417b7997.1" className="app-loading"><PageWord id="copy.8c08eaa51e524373.1">Loading...
      </PageWord></div>
    )
  }

  if (recovering) {
    return <ResetPasswordPage hasSession={Boolean(session)} />
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
    <SignupGate key={session.user.id} userId={session.user.id}>
    <AppAccessProvider><AppShell session={session}><AppPageAccess>
      <Routes>
        <Route path="/settings/staff-view" element={<ManagementOnly gmOnly><StaffViewPage/></ManagementOnly>}/>
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/schedule" element={<CrewSchedulePage />} />
        <Route path="/reports" element={<ManagementOnly gmOnly><ReportsPage /></ManagementOnly>} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/reservation-inquiries" element={<ReservationInquiryPage />} />
        <Route path="/inquiry-studio" element={<ManagementOnly><InquiryStudioPage /></ManagementOnly>} />
        <Route path="/inquiry-inbox" element={<GuestServicesPage />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/training/cocktails" element={<AccessSection page="training" section="cocktails"><CocktailTrainingPage /></AccessSection>} />
        <Route path="/training/food" element={<AccessSection page="training" section="food"><CocktailTrainingPage key="food" kind="food" /></AccessSection>} />
        <Route path="/settings/sales-targets" element={<ManagementOnly gmOnly><SalesTargetsPage /></ManagementOnly>} />
        <Route path="/settings/wording" element={<ManagementOnly gmOnly><ScreenWordingPage /></ManagementOnly>} />
        <Route path="/guest-feedback" element={<ManagementOnly><GuestFeedbackInbox /></ManagementOnly>} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/points" element={<PointsPage />} />
        <Route path="/settings/points-adjustments" element={<ManagementOnly><CloseoutSettingsPage key="settings-awards" awardsOnly /></ManagementOnly>} />
        <Route path="/settings/forms" element={<ManagementOnly gmOnly><CloseoutSettingsPage key="settings-forms" /></ManagementOnly>} />
        <Route path="/settings/permissions" element={<ManagementOnly gmOnly><PermissionsPage /></ManagementOnly>} />
        <Route path="/settings/point-rules" element={<ManagementOnly gmOnly><CloseoutSettingsPage key="point-rules" initialTab="points" /></ManagementOnly>} />
        <Route path="/closeout-summary/cash" element={<SummaryPage cash />} />
        <Route path="/settings/stickers" element={<AppearanceGuard gmOnly><StickerBankPage /></AppearanceGuard>} />
        <Route path="/appearance" element={<AppearanceGuard gmOnly><LocationAppearancePage /></AppearanceGuard>} />
        <Route path="/preshift/*" element={<PreshiftFeedPage />} />
        <Route path="/quizzes" element={<QuizzesPage />} />
        <Route path="/quizzes/build" element={<ManagementOnly><QuizBuilderPage key="future" /></ManagementOnly>} />
        <Route path="/quizzes/manage" element={<ManagementOnly><QuizBuilderPage key="published" publishedView /></ManagementOnly>} />

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
          element={<Navigate to="/closeout-summary/cash" replace />}
        />

        <Route path="/manager-closeout" element={<Navigate to="/closeout/manager" replace />} />
        <Route path="/closeout/manager" element={<ManagementOnly><ManagerCloseoutPage /></ManagementOnly>} />
        <Route path="/closeout/settings" element={<ManagementOnly gmOnly><CloseoutSettingsPage key="settings" /></ManagementOnly>} />
        <Route path="/closeout/awards" element={<ManagementOnly><CloseoutSettingsPage key="awards" awardsOnly /></ManagementOnly>} />
        <Route path="/closeout/permissions" element={<ManagementOnly gmOnly><PermissionsPage /></ManagementOnly>} />
        <Route path="/closeout/staff" element={<CloseoutPage />} />

        <Route
          path="/closeout"
          element={<CloseoutHub />}
        />

        <Route
          path="/closeout-summary"
          element={<SummaryPage />}
        />

        <Route
          path="/team"
          element={<TeamPage />}
        />

        <Route
          path="/tasks"
          element={
            <TasksPage />
          }
        />

        <Route
          path="/rewards"
          element={
            <PointsPage />
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
    </AppPageAccess></AppShell></AppAccessProvider>
    </SignupGate>
  )
}
