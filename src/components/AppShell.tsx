import {HeaderChatPreview} from './HeaderChatPreview'
import {AppThemeRuntime} from './AppThemeRuntime'
import {useAppAccess} from './AppAccess'
import {accessPage} from '../lib/accessCatalog'
import './PageFormat.css'
import { disconnectPush } from './PushPreferences'
// page-designer-instrumented
import { PageWord } from "./PageDesign"
import { ScreenText } from "./ScreenText"
import { AppearanceHeader } from './AppearanceHeader'
import '../pages/WarmTheme.css'
import { useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import {AppStickerDecorations} from './StickerDecorations'
import { PageRecovery } from './PageRecovery'
import './AppPolish.css'
import type { Session } from '@supabase/supabase-js'

import {
  Package,
  GraduationCap,
  Newspaper,
  BookOpen,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  Home,
  LayoutGrid,
  LogOut,
  Users,
  MoreHorizontal,
  X,
  Settings,
  CalendarDays,
} from 'lucide-react'

import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Props = PropsWithChildren<{
  session: Session
}>

const links = [
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays },
  { to: '/rewards', label: 'Points', icon: BarChart3 },
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
    to: '/team',
    label: 'Team',
    icon: Users,
  },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/preshift', label: 'Posts', icon: Newspaper },
  { to: '/quizzes', label: 'Quizzes', icon: BookOpen },
  { to: '/training', label: 'Training', icon: GraduationCap },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/inquiry-inbox', label: 'Guest Services', icon: CalendarDays },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell({
  session,
  children,
}: Props) {
  const { pathname } = useLocation()
  const pageAccess=useAppAccess()
  const [more, setMore] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [offline, setOffline] = useState(!navigator.onLine)
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLElement>(null)
  const lastPath = useRef(pathname)
  const primary = links.filter(l => ['/', '/floor', '/preshift', '/closeout'].includes(l.to))
  const extras = links.filter(l => !primary.includes(l))
  const moreActive = !primary.some(l => l.to === '/' ? pathname === '/' : pathname === l.to || pathname.startsWith(l.to + '/'))
  useEffect(() => {
    setMore(false)
    if(lastPath.current !== pathname) {
      window.scrollTo(0, 0)
      content.current?.focus({preventScroll: true})
      lastPath.current = pathname
    }
  }, [pathname])
  useEffect(() => {
    if(more && !dialog.current?.open) dialog.current?.showModal()
    else if(!more && dialog.current?.open) dialog.current.close()
  }, [more])
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => {window.removeEventListener('online', update); window.removeEventListener('offline', update)}
  }, [])
  function navItem({to, label, icon: Icon}: typeof links[number]) {
    if(!pageAccess.can(accessPage(to))||(to==='/reports'&&!pageAccess.admin))return null
    return <NavLink key={to} to={to} end={to === '/'} onClick={() => setMore(false)} className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}><Icon size={20} aria-hidden="true"/><span><PageWord instance id={`AppShell.nav.${label.replace(/\s+/g, '')}`}>{label}</PageWord></span></NavLink>
  }
  async function signOut() {
    await disconnectPush().catch(() => {});
    if(signingOut) return
    setSigningOut(true); setSignOutError('')
    try {
    const { error } =
      await supabase.auth.signOut()

    if (error) {
      throw error
    }
    } catch(e) {setSignOutError(e instanceof Error ? e.message : 'Could not sign out. Please retry.')}
    finally {setSigningOut(false)}
  }

  return (
    <div data-design-block="copy.45d24048ce7bc1e6.1" className="app-shell polished-app">
      <a className="skip-link" href="#app-main"><PageWord id="sectioncopy.814ff0c2cb2ec5ecee02">{"Skip to content"}</PageWord></a>

      <header data-design-block="copy.edeb9250004ef168.1" className="app-header">
        <AppearanceHeader /><AppThemeRuntime />

        <div data-design-block="copy.4440213bd6ff846f.1" className="app-brand">
          <strong>JusTini’s</strong>

          <span>
            {session.user.email}
          </span>
        </div>

        <button data-design-block="copy.816668b675145def.1"
          type="button"
          className="logout-button"
          onClick={signOut}
          disabled={signingOut}
          aria-label="Sign out"
        >
          <LogOut size={24} />
        </button>

      </header>

      <nav data-design-block="section.c1754735109ac4f13c9e" className="desktop-nav" aria-label="Main navigation"><p className="nav-section-label"><PageWord id="sectioncopy.caee5cd3478c41a41029">{"Your shift"}</PageWord></p>{primary.map(navItem)}<p className="nav-section-label"><PageWord id="sectioncopy.20c5d63d03cf302ecd1a">{"Workspace"}</PageWord></p>{extras.map(navItem)}</nav>
      <main ref={content} id="app-main" tabIndex={-1} data-design-block="copy.60535db1b6f53b61.1" className="app-content">
        {offline && <p role="status"><PageWord id="sectioncopy.bf2a7186a2c1ce67fd80">{"You’re offline. Reconnect before saving or refreshing."}</PageWord></p>}
        {signOutError && <p role="alert">{signOutError}</p>}
        <HeaderChatPreview enabled={pageAccess.can('schedule','chat')}/>
        <AppStickerDecorations />
        <div className="app-sticker-content"><PageRecovery key={pathname.startsWith('/preshift/')?'/preshift':pathname}>{children}</PageRecovery></div>
      </main>

      <nav data-design-block="copy.7cb60e4ed1acdcd5.1" className="bottom-nav" aria-label="Main navigation">

        {primary.map(navItem)}
        <button type="button" className={`nav-item${moreActive || more ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={more} aria-controls="workspace-menu" onClick={() => setMore(true)}><MoreHorizontal size={22}/><span><ScreenText id="AppShell.more">More</ScreenText></span></button>

      </nav>
      <dialog ref={dialog} id="workspace-menu" className="workspace-menu" aria-labelledby="workspace-menu-title" onCancel={() => setMore(false)} onClose={() => setMore(false)}>
        <div className="workspace-menu-heading"><h2 id="workspace-menu-title"><ScreenText id="AppShell.workspace">Workspace</ScreenText></h2><button type="button" aria-label="Close menu" onClick={() => setMore(false)}><X size={20}/></button></div>
        <nav data-design-block="section.e7e3f0725c6512fd5af5" aria-label="More pages">{extras.map(navItem)}</nav>
      </dialog>

    </div>
  )
}
// app-polish-v2
