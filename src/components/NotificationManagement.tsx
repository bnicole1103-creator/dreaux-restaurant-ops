import {DesignSection} from './DesignSection'
import { DisposalRequirements } from './DisposalRequirements'
import { RequiredWorkRoster } from './RequiredWorkRoster'
import {PageWord} from './PageDesign'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { useManagementAccess } from './ManagementAccess'
import { Link } from 'react-router-dom'
import { MyWorkRequirements } from './MyWorkRequirements'
import { serviceDay } from '../lib/serviceDay'

type Policy = { kind: string; enabled: boolean; audience: 'all' | 'scheduled' }
type Shift = { id: string; employee_key: string; assigned: boolean; name: string; role: string; start: string; end: string }
type Staff = { id: string; name: string; employee_key: string | null; role: string }
type Payload = {
 policies: Policy[]; effective_date: string; ready: boolean; confirmed_at: string | null
 schedule: { rows: Shift[]; synced_at: string | null; last_error: string | null } | null
 staff: Staff[]; shifts: { shift_key: string; user_id: string; start_at: string; end_at: string; role_name: string; requires_closeout: boolean }[]
}
const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)

export function NotificationManagement() {
 const access = useManagementAccess()
 const [location, setLocation] = useState('')
 const [day, setDay] = useState(serviceDay)
 const [data, setData] = useState<Payload | null>(null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [notice, setNotice] = useState('')
 useEffect(() => { void loadTenantData().then(t => setLocation(t.locations[0]?.id ?? '')).catch(e => setError(errorText(e))) }, [])
 async function load() {
  const r = await supabase.rpc('staff_notifications_settings', {p_location_id:location,p_day:day})
  if (r.error) throw r.error
  const d = r.data as Payload
  setData(d)

 }
 useEffect(() => {
  if (!location || !access.manager) return
  let live = true
  setData(null); setError('')
  void supabase.rpc('staff_notifications_settings', {p_location_id:location,p_day:day}).then(r => {
   if (!live) return
   if (r.error) {setError(errorText(r.error)); return}
   const d = r.data as Payload
   setData(d)

  })
  return () => {live = false}
 }, [location, day, access.manager])
 async function perform(action: () => Promise<void>, message: string) {
  setBusy(true); setError(''); setNotice('')
  try {await action(); await load(); setNotice(message)}
  catch (e) {setError(errorText(e))}
  finally {setBusy(false)}
 }

 if (!location) return error ? <p role="alert">{error}</p> : null
 return <div className="notification-management">
  <p><Link to="/"><PageWord id="sectioncopy.0d8d3dfdc4f7818a6875">{"Open My notifications on Home"}</PageWord></Link><PageWord id="sectioncopy.7859ef1a7d9482137183">{" to enable or turn off notifications for this device. One setting covers the whole app."}</PageWord></p>
  <MyWorkRequirements key={data?.confirmed_at ?? day} location={location}/>

  <section className="task-card">
    <nav className="workspace-actions" aria-label="Disposal forms">
      <Link to="/inventory">Open disposal form</Link>
      <Link to="/inventory?view=history">Disposal history</Link>
    </nav>
    <DisposalRequirements location={location} refreshKey={0}/>
  </section>

  <DesignSection as="article" data-design-block="section.cc57b0dece248baa7334" className="task-card">
   <h2><PageWord id="sectioncopy.8c50f9314c3fc79b2dfd">{"Required work and points"}</PageWord></h2>
   <p><PageWord id="sectioncopy.30eca7c7d8ff71e3f79e">{"Staff marked as quiz-required by recurring controls or a daily roster must complete each published quiz: −10 points per missed quiz."}</PageWord></p>
   <p><PageWord id="sectioncopy.d49b6260a2612e869bf0">{"Each shift marked “Closeout required” needs a submission: −10 points per missing shift closeout."}</PageWord></p>
   <p><PageWord id="sectioncopy.41cecde861259c0e330f">{"Complete every assigned task list: −5 points per incomplete list, not per unchecked task."}</PageWord></p>
   <p><PageWord id="sectioncopy.fb0ce43f3091f5fbefa8">{"Quizzes and closeouts are due by 4 AM after the service day. Task lists use their assigned due time, or the same 4 AM cutoff. Push on/off does not change these requirements."}</PageWord></p>
  </DesignSection>
  {access.manager && <DesignSection as="article" data-design-block="section.a2d97c5e882b5ef67674" className="task-card">
   {access.gm&&<p><Link to="/settings?view=controls">Operations controls — set recurring work and notification audiences</Link></p>}<h2><PageWord id="sectioncopy.ac7ccb51ece5dcf8268e">{"Schedule and required-work roster"}</PageWord></h2>
   {access.gm && <p><PageWord id="sectioncopy.0d358329b541c02170b8">{"Choose an alert and its audience on each published "}</PageWord><Link to="/preshift"><PageWord id="sectioncopy.997a5765e02085385f66">{"post"}</PageWord></Link><PageWord id="sectioncopy.b8666ceb469d549c4dc0">{" or "}</PageWord><Link to="/quizzes"><PageWord id="sectioncopy.38a07502a4bd3de6a72f">{"quiz"}</PageWord></Link><PageWord id="sectioncopy.0ae15dddf505c4f80535">{". Operations controls can send automatic alerts; a post-specific choice overrides them."}</PageWord></p>}
   <p><PageWord id="sectioncopy.21a9a2adadc5fd55c1af">{"Scheduled only uses the confirmed schedule for the notification’s service day. Entire staff includes active staff who are off that day. Staff still choose whether their device receives push."}</PageWord></p>
   {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
   {!data ? <p><PageWord id="sectioncopy.ef2dad413c26a137cc0e">{"Loading notification settings…"}</PageWord></p> : <fieldset data-design-block="section.114e4bf93654bd349710" disabled={busy}>
    <label><PageWord id="sectioncopy.6d28a817446118aa17d8">{"Service day "}</PageWord><input type="date" value={day} onChange={e => {setDay(e.target.value)}}/></label>
    <button type="button" onClick={() => void perform(async () => {
     const r = await supabase.functions.invoke('home-schedule',{body:{location_id:location,date:day}})
     if(r.error) throw r.error
     if(!r.data?.configured) throw Error('7shifts is not connected.')
     if(r.data.error) throw Error(r.data.error)
    }, 'Schedule refreshed. Review the roster and confirm it.')}><PageWord id="sectioncopy.dab772ee08a7cc3ede8a">{"Refresh 7shifts schedule"}</PageWord></button>
    <p>{data.ready ? 'Schedule confirmed.' : 'Roster not ready. Check automatic controls, schedule sync and account links, or save a one-day override.'}</p>
    {data.schedule?.last_error && <p role="alert">{data.schedule.last_error}</p>}
    <RequiredWorkRoster key={day} location={location} day={day} data={data} onSaved={load}/>
    <p><PageWord id="sectioncopy.c8b2da8b7c52556e8da6">{"Rules start on "}</PageWord>{data.effective_date}<PageWord id="sectioncopy.6312b2c88c68bfd294f8">{". Earlier point history is preserved. Management can waive or correct deductions in Points."}</PageWord></p>
   </fieldset>}
  </DesignSection>}
 </div>
}
