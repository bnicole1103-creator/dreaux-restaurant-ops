// page-designer-instrumented
import { PageWord } from "./PageDesign"
import { ScreenText } from "./ScreenText"
import { AppearanceHeader } from './AppearanceHeader'
import '../pages/WarmTheme.css'
import type { PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'

import {
  Package,
  GraduationCap,
  Newspaper,
  BookOpen,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  Gift,
  Home,
  LayoutGrid,
  LogOut,
  Users,
} from 'lucide-react'

import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Props = PropsWithChildren<{
  session: Session
}>

const links = [
  {
    to: '/',
    label: 'Home',
    icon: Home,
  },
  {
    to: '/floor',
    label: 'Floor',
    icon: LayoutGrid,
  },
  {
    to: '/closeout',
    label: 'Closeout',
    icon: ClipboardList,
  },
  {
    to: '/closeout-summary',
    label: 'Summary',
    icon: BarChart3,
  },
  {
    to: '/tasks',
    label: 'Tasks',
    icon: ClipboardCheck,
  },
  {
    to: '/rewards',
    label: 'Points',
    icon: Gift,
  },
  {
    to: '/team',
    label: 'Team',
    icon: Users,
  },
  { to: '/preshift', label: 'Pre-Shift', icon: Newspaper },
  { to: '/quizzes', label: 'Quizzes', icon: BookOpen },
  { to: '/training', label: 'Training', icon: GraduationCap },
  { to: '/inventory', label: 'Inventory', icon: Package },
]

export function AppShell({
  session,
  children,
}: Props) {
  async function signOut() {
    const { error } =
      await supabase.auth.signOut()

    if (error) {
      console.error(
        'Sign out error:',
        error
      )
    }
  }

  return (
    <div data-design-block="copy.45d24048ce7bc1e6.1" className="app-shell">

      <header data-design-block="copy.edeb9250004ef168.1" className="app-header">
        <AppearanceHeader />

        <div data-design-block="copy.4440213bd6ff846f.1" className="app-brand">
          <strong><ScreenText id="AppShell.262da4df982b420d">
            LNX Systems
          </ScreenText></strong>

          <span>
            {session.user.email}
          </span>
        </div>

        <button data-design-block="copy.816668b675145def.1"
          type="button"
          className="logout-button"
          onClick={signOut}
          aria-label="Sign out"
        >
          <LogOut size={24} />
        </button>

      </header>

      <main data-design-block="copy.60535db1b6f53b61.1" className="app-content" style={{paddingBottom: 'calc(300px + env(safe-area-inset-bottom))'}}>
        {children}
      </main>

      <nav data-design-block="copy.7cb60e4ed1acdcd5.1" className="bottom-nav">

        {links.map(
          ({
            to,
            label,
            icon: Icon,
          }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({
                isActive,
              }) =>
                isActive
                  ? 'nav-item active'
                  : 'nav-item'
              }
            >
              <Icon size={22} />

              <span>
                <PageWord instance id="copy.134d06397a14a4fd.1">{label}</PageWord>
              </span>
            </NavLink>
          )
        )}

      </nav>

    </div>
  )
}
