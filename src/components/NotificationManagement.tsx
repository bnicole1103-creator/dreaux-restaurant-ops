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
 staff: Staff[]; shifts: { shift_key: string; requires_closeout: boolean }[]
}
const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)
const timeLabel = (s: string) => new Date(s).toLocaleTimeString('en-US', {timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})
const requiredCloseout = (s: Shift, staff: Staff[]) => /server|bartender/i.test(s.role) || /server|bartender/i.test(staff.find(p => p.employee_key === s.employee_key)?.role ?? '')

export function NotificationManagement() {
 const access = useManagementAccess()
 const [location, setLocation] = useState('')
 const [day, setDay] = useState(serviceDay)
 const [data, setData] = useState<Payload | null>(null)
 const [closeouts, setCloseouts] = useState<string[]>([])
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [notice, setNotice] = useState('')
 useEffect(() => { void loadTenantData().then(t => setLocation(t.locations[0]?.id ?? '')).catch(e => setError(errorText(e))) }, [])
 async function load() {
  const r = await supabase.rpc('staff_notifications_settings', {p_location_id:location,p_day:day})
  if (r.error) throw r.error
  const d = r.data as Payload
  setData(d)
  setCloseouts((d.schedule?.rows ?? []).filter(s =>
   s.assigned && (requiredCloseout(s,d.staff) || d.shifts.some(x => x.shift_key === s.id && x.requires_closeout))
  ).map(s => s.id))
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
   setCloseouts((d.schedule?.rows ?? []).filter(s => s.assigned && (requiredCloseout(s,d.staff) ||
    d.shifts.some(x => x.shift_key === s.id && x.requires_closeout))).map(s => s.id))
  })
  return () => {live = false}
 }, [location, day, access.manager])
 async function perform(action: () => Promise<void>, message: string) {
  setBusy(true); setError(''); setNotice('')
  try {await action(); await load(); setNotice(message)}
  catch (e) {setError(errorText(e))}
  finally {setBusy(false)}
 }

 const rows = data?.schedule?.rows.filter(s => s.assigned) ?? []
 const unmatched = rows.filter(s => !data?.staff.some(p => p.employee_key === s.employee_key))
 if (!location) return error ? <p role="alert">{error}</p> : null
 return <div className="notification-management">
  <p><Link to="/"><PageWord id="sectioncopy.0d8d3dfdc4f7818a6875">{"Open My notifications on Home"}</PageWord></Link><PageWord id="sectioncopy.7859ef1a7d9482137183">{" to enable or turn off notifications for this device. One setting covers the whole app."}</PageWord></p>
  <MyWorkRequirements location={location}/>
  <article data-design-block="section.cc57b0dece248baa7334" className="task-card">
   <h2><PageWord id="sectioncopy.8c50f9314c3fc79b2dfd">{"Required work and points"}</PageWord></h2>
   <p><PageWord id="sectioncopy.30eca7c7d8ff71e3f79e">{"Everyone scheduled for the day must complete each published daily quiz: −5 points per missed quiz."}</PageWord></p>
   <p><PageWord id="sectioncopy.d49b6260a2612e869bf0">{"Servers and bartenders must submit a closeout for every shift: −10 points per missing shift closeout."}</PageWord></p>
   <p><PageWord id="sectioncopy.41cecde861259c0e330f">{"Complete every assigned task list: −5 points per incomplete list, not per unchecked task."}</PageWord></p>
   <p><PageWord id="sectioncopy.fb0ce43f3091f5fbefa8">{"Quizzes and closeouts are due by 4 AM after the service day. Task lists use their assigned due time, or the same 4 AM cutoff. Push on/off does not change these requirements."}</PageWord></p>
  </article>
  {access.manager && <article data-design-block="section.a2d97c5e882b5ef67674" className="task-card">
   <h2><PageWord id="sectioncopy.ac7ccb51ece5dcf8268e">{"Schedule and required-work roster"}</PageWord></h2>
   {access.gm && <p><PageWord id="sectioncopy.0d358329b541c02170b8">{"Choose an alert and its audience on each published "}</PageWord><Link to="/preshift"><PageWord id="sectioncopy.997a5765e02085385f66">{"pre-shift post"}</PageWord></Link><PageWord id="sectioncopy.b8666ceb469d549c4dc0">{" or "}</PageWord><Link to="/quizzes"><PageWord id="sectioncopy.38a07502a4bd3de6a72f">{"quiz"}</PageWord></Link><PageWord id="sectioncopy.0ae15dddf505c4f80535">{". Publishing or editing alone sends no alert."}</PageWord></p>}
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
    <p>{data.ready ? 'Schedule confirmed.' : 'Schedule needs confirmation; scheduled-only alerts and quiz/closeout deductions are paused.'}</p>
    {data.schedule?.last_error && <p role="alert">{data.schedule.last_error}</p>}
    <p><PageWord id="sectioncopy.815e3b9f8e47f20ac473">{"Verify each employee’s app account and check every shift that requires a closeout. Server and bartender shifts are always required. Confirm after schedule changes or call-outs. The confirmed roster freezes at 4 AM."}</PageWord></p>
    {unmatched.length > 0 && <p role="alert">{unmatched.length}<PageWord id="sectioncopy.3ac5f6361277474dffdd">{" scheduled shift(s) have no active app-account link. The Management must link them before confirming."}</PageWord></p>}
    {rows.map(s => {
     const linked = data.staff.find(p => p.employee_key === s.employee_key)
     const mandatory = requiredCloseout(s,data.staff)
     return <div key={s.id} style={{borderBottom:'1px solid #ddd',padding:'12px 0'}}>
      <strong>{s.name}<PageWord id="sectioncopy.9d8094db7ee07358a8dd">{" · "}</PageWord>{s.role}</strong><p>{timeLabel(s.start)}<PageWord id="sectioncopy.5738e35dde172ef3dbe1">{"–"}</PageWord>{timeLabel(s.end)}<PageWord id="sectioncopy.0dc672a9d41bd2e3acc8">{" · 7shifts ID "}</PageWord>{s.employee_key}</p>
      {access.gm ? <label><PageWord id="sectioncopy.c6894e4e7bc4ad9b60d8">{"App account "}</PageWord><select value={linked?.id ?? ''} onChange={e => {
       const uid=e.target.value
       if(!uid)return
       void perform(async () => {
        const r=await supabase.rpc('team_schedule_link',{p_location_id:location,p_user_id:uid,p_key:s.employee_key})
        if(r.error)throw r.error
       }, 'Employee linked. Reconfirm the schedule.')
      }}><option value="">Choose the correct app account</option>{data.staff.map(p => <option key={p.id} value={p.id}>{p.name}{p.employee_key ? ' · '+p.employee_key : ''}</option>)}</select></label>
       : <p><PageWord id="sectioncopy.99e9021f73aa710f2bde">{"App account: "}</PageWord>{linked?.name ?? 'Not linked — ask the Management'}</p>}
      <label><input type="checkbox" checked={closeouts.includes(s.id)} disabled={mandatory} onChange={e => setCloseouts(v => e.target.checked ? [...v,s.id] : v.filter(x => x!==s.id))}/><PageWord id="sectioncopy.e402e48504a24e0bfdc4">{" Closeout required for this shift"}</PageWord></label>
     </div>
    })}
    {!rows.length && <p><PageWord id="sectioncopy.9e2c356fcd546748c469">{"No assigned shifts in the current cache. Refresh and verify that this is an off day before confirming."}</PageWord></p>}
    <button type="button" disabled={!data.schedule || !!unmatched.length} onClick={() => {
     if(!window.confirm('Confirm this schedule and closeout roster? Everyone listed will be required to complete the day’s published quizzes.'))return
     void perform(async () => {
      const r=await supabase.rpc('staff_schedule_confirm',{p_location_id:location,p_day:day,p_snapshot:data.schedule?.rows,p_closeout_keys:closeouts})
      if(r.error)throw r.error
     }, 'Schedule confirmed. Quiz requirements are active.')
    }}><PageWord id="sectioncopy.97590d379b153484d324">{"Confirm reviewed schedule"}</PageWord></button>
    <p><PageWord id="sectioncopy.c8b2da8b7c52556e8da6">{"Rules start on "}</PageWord>{data.effective_date}<PageWord id="sectioncopy.6312b2c88c68bfd294f8">{". Earlier point history is preserved. The Management can waive or correct deductions in Points."}</PageWord></p>
   </fieldset>}
  </article>}
 </div>
}
