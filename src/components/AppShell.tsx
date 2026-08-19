import type { PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'

import {
  Banknote,
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
    to: '/cash',
    label: 'Cash',
    icon: Banknote,
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
    label: 'Rewards',
    icon: Gift,
  },
  {
    to: '/team',
    label: 'Team',
    icon: Users,
  },
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
    <div className="app-shell">

      <header className="app-header">

        <div className="app-brand">
          <strong>
            LNX Systems
          </strong>

          <span>
            {session.user.email}
          </span>
        </div>

        <button
          type="button"
          className="logout-button"
          onClick={signOut}
          aria-label="Sign out"
        >
          <LogOut size={24} />
        </button>

      </header>

      <main className="app-content">
        {children}
      </main>

      <nav className="bottom-nav">

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
                {label}
              </span>
            </NavLink>
          )
        )}

      </nav>

    </div>
  )
}