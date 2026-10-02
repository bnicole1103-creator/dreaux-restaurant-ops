import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { Link } from 'react-router-dom'
import { loadTenantData } from '../lib/tenant'
import { supabase } from '../lib/supabase'
export function useManagementAccess(userId?: string) {
  const [access, setAccess] = useState({loading: true, manager: false, gm: false, error: ''})
  useEffect(() => {
    let active = true
    setAccess({loading: true, manager: false, gm: false, error: ''})
    void (async () => {
      try {
        const tenant = await loadTenantData()
        const location = tenant.locations[0]
        if (!location) throw new Error('No active location found.')
        const [manager, gm] = await Promise.all([
          supabase.rpc('mod_is_manager', {p_location_id: location.id}),
          supabase.rpc('closeout_is_gm', {p_location_id: location.id})
        ])
        if (manager.error) throw manager.error
        if (gm.error) throw gm.error
        if (active) setAccess({loading: false, manager: !!manager.data, gm: !!gm.data, error: ''})
      } catch (e) {
        if (active) setAccess({loading: false, manager: false, gm: false, error: String((e as {message?: string}).message ?? e)})
      }
    })()
    return () => { active = false }
  }, [userId])
  return access
}
export function ManagementOnly({gmOnly = false, children}: PropsWithChildren<{gmOnly?: boolean}>) {
  const access = useManagementAccess()
  if (access.loading) return <section className="page"><p>Checking access…</p></section>
  if (access.error) return <section className="page"><p role="alert">{access.error}</p></section>
  if (!(gmOnly ? access.gm : access.manager)) return <section className="page"><h1>Access restricted</h1><p>{gmOnly ? 'General manager access is required.' : 'Manager access is required.'}</p><Link to="/closeout">Return to Closeout</Link></section>
  return <>{children}</>
}
