import {PageCanvas} from './components/PageLayout'
import {AccessSection} from './components/AppAccess'
import {AppAccessProvider,AppPageAccess} from './components/AppAccess'
// page-designer-instrumented
import { PageWord } from "./components/PageDesign"
import { useLocation } from 'react-router-dom'
import { ManagementOnly as AppearanceGuard } from './components/ManagementAccess'
import { SignupGate } from './components/SignupGate'
import { ManagementOnly } from './components/ManagementAccess'
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'

import { supabase } from './lib/supabase'
import { AppShell } from './components/AppShell'


const ReservationPrivacy=lazy(()=>import('./pages/ReservationPrivacy').then(module=>({default:module.ReservationPrivacy})))
const ReservationArrivalOptions=lazy(()=>import('./pages/ReservationArrivalOptions').then(module=>({default:module.ReservationArrivalOptions})))
const ReservationGuestConfirmation=lazy(()=>import('./pages/ReservationGuestConfirmation').then(module=>({default:module.ReservationGuestConfirmation})))
const RestaurantGamesPage=lazy(()=>import('./pages/RestaurantGamesPage').then(module=>({default:module.RestaurantGamesPage})))
const PrepareDayPage=lazy(()=>import('./pages/PrepareDayPage').then(module=>({default:module.PrepareDayPage})))
const ServiceTrainingPage=lazy(()=>import('./pages/ServiceTrainingPage').then(module=>({default:module.ServiceTrainingPage})))
const CrewSchedulePage=lazy(()=>import('./pages/CrewSchedulePage').then(module=>({default:module.CrewSchedulePage})))
const ReportsPage=lazy(()=>import('./pages/ReportsPage').then(module=>({default:module.ReportsPage})))
const GuestServicesPage=lazy(()=>import('./pages/GuestServicesPage').then(module=>({default:module.GuestServicesPage})))
const StaffViewPage=lazy(()=>import('./pages/StaffViewPage').then(module=>({default:module.StaffViewPage})))
const CalendarPage=lazy(()=>import('./pages/CalendarPage').then(module=>({default:module.CalendarPage})))
const ScreenWordingPage=lazy(()=>import('./pages/ScreenWordingPage').then(module=>({default:module.ScreenWordingPage})))
const TrainingPage=lazy(()=>import('./pages/TrainingPage').then(module=>({default:module.TrainingPage})))
const CocktailTrainingPage=lazy(()=>import('./pages/CocktailTrainingPage').then(module=>({default:module.CocktailTrainingPage})))
const InventoryPage=lazy(()=>import('./pages/InventoryPage').then(module=>({default:module.InventoryPage})))
const GuestFeedbackPage=lazy(()=>import('./pages/GuestFeedbackPage').then(module=>({default:module.GuestFeedbackPage})))
const GuestFeedbackInbox=lazy(()=>import('./pages/GuestFeedbackInbox').then(module=>({default:module.GuestFeedbackInbox})))
const WalkInPage=lazy(()=>import('./pages/WalkInPage').then(module=>({default:module.WalkInPage})))
const SalesCalculatorPage=lazy(()=>import('./pages/SalesCalculatorPage').then(module=>({default:module.SalesCalculatorPage})))
const SalesTargetsPage=lazy(()=>import('./pages/SalesTargetsPage').then(module=>({default:module.SalesTargetsPage})))
const TasksPage=lazy(()=>import('./pages/TasksPage').then(module=>({default:module.TasksPage})))
const SettingsPage=lazy(()=>import('./pages/SettingsPage').then(module=>({default:module.SettingsPage})))
const SummaryPage=lazy(()=>import('./pages/SummaryPage').then(module=>({default:module.SummaryPage})))
const PreshiftFeedPage=lazy(()=>import('./pages/PreshiftFeedPage').then(module=>({default:module.PreshiftFeedPage})))
const QuizBuilderPage=lazy(()=>import('./pages/QuizBuilderPage').then(module=>({default:module.QuizBuilderPage})))
const QuizzesPage=lazy(()=>import('./pages/QuizzesPage').then(module=>({default:module.QuizzesPage})))
const PermissionsPage=lazy(()=>import('./pages/PermissionsPage').then(module=>({default:module.PermissionsPage})))
const CloseoutHub=lazy(()=>import('./pages/CloseoutHub').then(module=>({default:module.CloseoutHub})))
const CloseoutSettingsPage=lazy(()=>import('./pages/CloseoutSettingsPage').then(module=>({default:module.CloseoutSettingsPage})))
const ManagerCloseoutPage=lazy(()=>import('./pages/ManagerCloseoutPage').then(module=>({default:module.ManagerCloseoutPage})))
const PointsPage=lazy(()=>import('./pages/PointsPage').then(module=>({default:module.PointsPage})))
const ResetPasswordPage=lazy(()=>import('./pages/ResetPasswordPage').then(module=>({default:module.ResetPasswordPage})))
const LoginPage=lazy(()=>import('./pages/LoginPage').then(module=>({default:module.LoginPage})))
const DashboardPage=lazy(()=>import('./pages/DashboardPage').then(module=>({default:module.DashboardPage})))
const ReservationsPage=lazy(()=>import('./pages/ReservationsPage').then(module=>({default:module.ReservationsPage})))
const FloorPage=lazy(()=>import('./pages/FloorPage').then(module=>({default:module.FloorPage})))
const PlaceholderPage=lazy(()=>import('./pages/PlaceholderPage').then(module=>({default:module.PlaceholderPage})))
const TeamPage=lazy(()=>import('./pages/TeamPage').then(module=>({default:module.TeamPage})))
const CloseoutPage=lazy(()=>import('./pages/CloseoutPage').then(module=>({default:module.CloseoutPage})))
const ReservationInquiryPage=lazy(()=>import('./pages/ReservationInquiryPage').then(module=>({default:module.ReservationInquiryPage})))
const InquiryStudioPage=lazy(()=>import('./pages/InquiryStudioPage').then(module=>({default:module.InquiryStudioPage})))
const ReservationMessagingPage=lazy(()=>import('./pages/ReservationMessagingPage').then(module=>({default:module.ReservationMessagingPage})))
class PageLoadBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<section className="page" role="alert"><h1>This page could not load</h1><p>Your saved work is unchanged. Check your connection and reload the app.</p><button type="button" onClick={()=>window.location.reload()}>Reload app</button></section>:this.props.children}
}
export default function App(){return <PageLoadBoundary><Suspense fallback={<div className="app-loading" role="status">Loading page…</div>}><AppContent/></Suspense></PageLoadBoundary>}
function AppContent() {
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

  if (walkinPath === '/privacy' || walkinPath === '/privacy/') return <ReservationPrivacy/>
  if (walkinPath === '/reservation-confirmation' || walkinPath === '/reservation-confirmation/') return <ReservationGuestConfirmation/>
  if (walkinPath.startsWith('/guest-feedback/')) return <PageCanvas><GuestFeedbackPage key={walkinPath} publicKey={walkinPath.slice('/guest-feedback/'.length)} /></PageCanvas>

  if (walkinPath.startsWith('/walk-in/')) return <PageCanvas><WalkInPage key={walkinPath} publicKey={walkinPath.slice('/walk-in/'.length)} /></PageCanvas>

  // Guest-only pages must render before the staff session/loading gate.
  if (walkinPath.replace(/\/$/,'')==='/reservation-arrival-options') return <ReservationArrivalOptions/>
  if (walkinPath.replace(/\/$/,'')==='/reservation-confirmation') return <ReservationGuestConfirmation/>
  if (['/privacy','/messaging-terms'].includes(walkinPath.replace(/\/$/,''))) return <ReservationPrivacy/>
  if (walkinPath.replace(/\/$/,'')==='/reservation-messaging') return <ReservationMessagingPage/>

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
        <Route path="/prepare-day" element={<ManagementOnly><PrepareDayPage /></ManagementOnly>} />
        <Route path="/schedule" element={<CrewSchedulePage />} />
        <Route path="/reports" element={<ManagementOnly gmOnly><ReportsPage /></ManagementOnly>} />
        <Route path="/reservations" element={<ReservationsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/reservation-inquiries" element={<ReservationInquiryPage />} />
        <Route path="/inquiry-studio" element={<ManagementOnly><InquiryStudioPage /></ManagementOnly>} />
        <Route path="/inquiry-inbox" element={<GuestServicesPage />} />
        <Route path="/training/games" element={<RestaurantGamesPage />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/training/cocktails" element={<AccessSection page="training" section="cocktails"><CocktailTrainingPage /></AccessSection>} />
        <Route path="/training/service" element={<AccessSection page="training" section="service"><ServiceTrainingPage /></AccessSection>} />
        <Route path="/training/food" element={<AccessSection page="training" section="food"><CocktailTrainingPage key="food" kind="food" /></AccessSection>} />
        <Route path="/sales-targets" element={<SalesCalculatorPage />} />
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
        <Route path="/settings/stickers" element={<AppearanceGuard gmOnly><Navigate to="/settings/wording?tool=stickers" replace /></AppearanceGuard>} />
        <Route path="/appearance" element={<AppearanceGuard gmOnly><Navigate to="/settings/wording?tool=fonts" replace /></AppearanceGuard>} />
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
