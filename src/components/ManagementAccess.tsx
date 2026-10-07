// page-designer-instrumented
import { PageWord } from "./PageDesign"
import { ScreenText } from "./ScreenText"
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
  if (access.loading) return <section data-design-block="copy.4009a4af2c7a8ad6.1" className="page"><p data-design-block="copy.64cfbdd1df89de4e.1"><ScreenText id="ManagementAccess.80409edadbb53ccf">Checking access…</ScreenText></p></section>
  if (access.error) return <section data-design-block="copy.4009a4af2c7a8ad6.2" className="page"><p data-design-block="copy.c9b544804d5d34b8.1" role="alert">{access.error}</p></section>
  if (!(gmOnly ? access.gm : access.manager)) return <section data-design-block="copy.4009a4af2c7a8ad6.3" className="page"><h1 data-design-block="copy.794647c84babc37d.1"><ScreenText id="ManagementAccess.66253c5629fe2863">Access restricted</ScreenText></h1><p data-design-block="copy.64cfbdd1df89de4e.2">{gmOnly ? <PageWord id="copy.726d7858c8266462.1">{"General manager access is required."}</PageWord> : <PageWord id="copy.c7acd52d2352ae4d.1">{"Manager access is required."}</PageWord>}</p><Link to="/closeout"><ScreenText id="ManagementAccess.5bf2843cf474120a">Return to Closeout</ScreenText></Link></section>
  return <>{children}</>
}
