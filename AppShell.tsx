import type { PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Banknote, ClipboardCheck, Gift, Home, LayoutGrid, LogOut } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Props = PropsWithChildren<{ session: Session }>

const links = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/floor', label: 'Floor', icon: LayoutGrid },
  { to: '/cash', label: 'Cash', icon: Banknote },
  { to: '/tasks', label: 'Tasks', icon: ClipboardCheck },
  { to: '/rewards', label: 'Rewards', icon: Gift },
]

export function AppShell({ session, children }: Props) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <strong>Dreaux Restaurant Ops</strong>
          <span>{session.user.email}</span>
        </div>
        <button className="icon-button" onClick={() => supabase.auth.signOut()} aria-label="Sign out">
          <LogOut size={20} />
        </button>
      </header>
      <main className="page-content">{children}</main>
      <nav className="bottom-nav">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
