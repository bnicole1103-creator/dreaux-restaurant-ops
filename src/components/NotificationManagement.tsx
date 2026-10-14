import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { useManagementAccess } from './ManagementAccess'
import { PushNotifications } from './PushNotifications'
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
const types = [
 ['assigned', 'New task assignments'], ['reminder', 'Task deadline reminders'],
 ['due', 'Task deadlines'], ['quiz', 'Published quizzes'], ['preshift', 'Pre-shift updates'],
 ['closeout', 'Closeout reminders'], ['announcement', 'Management announcements'],
] as const
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
 const [title, setTitle] = useState('')
 const [body, setBody] = useState('')
 const requestId = useRef<string | null>(null)
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
 async function savePolicy(kind: string, enabled: boolean, audience: string) {
  await perform(async () => {
   const r = await supabase.rpc('staff_notifications_save', {p_location_id:location,p_kind:kind,p_enabled:enabled,p_audience:audience})
   if (r.error) throw r.error
  }, 'Notification setting saved.')
 }
 const rows = data?.schedule?.rows.filter(s => s.assigned) ?? []
 const unmatched = rows.filter(s => !data?.staff.some(p => p.employee_key === s.employee_key))
 if (!location) return error ? <p role="alert">{error}</p> : null
 return <div className="notification-management">
  <PushNotifications location={location}/>
  <MyWorkRequirements location={location}/>
  <article className="task-card">
   <h2>Required work and points</h2>
   <p>Everyone scheduled for the day must complete each published daily quiz: −5 points per missed quiz.</p>
   <p>Servers and bartenders must submit a closeout for every shift: −10 points per missing shift closeout.</p>
   <p>Complete every assigned task list: −5 points per incomplete list, not per unchecked task.</p>
   <p>Quizzes and closeouts are due by 4 AM after the service day. Task lists use their assigned due time, or the same 4 AM cutoff. Push on/off does not change these requirements.</p>
  </article>
  {access.manager && <article className="task-card">
   <h2>Management notification settings</h2>
   <p>Scheduled only uses the confirmed schedule for the notification’s service day. Entire staff includes active staff who are off that day. Staff still choose whether their device receives push.</p>
   {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
   {!data ? <p>Loading notification settings…</p> : <fieldset disabled={busy}>
    {types.map(([kind,label]) => {
     const p = data.policies.find(p => p.kind === kind) ?? {kind,enabled:true,audience:kind === 'announcement' ? 'all' : 'scheduled'}
     return <div key={kind} style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',margin:'12px 0'}}>
      <label><input type="checkbox" checked={p.enabled} onChange={e => void savePolicy(kind,e.target.checked,p.audience)}/> {label}</label>
      <select aria-label={label+' audience'} value={p.audience} onChange={e => void savePolicy(kind,p.enabled,e.target.value)}>
       <option value="scheduled">Staff scheduled for the day</option><option value="all">Entire staff</option>
      </select>
     </div>
    })}
    <button type="button" onClick={() => void perform(async () => {
     const r = await supabase.rpc('staff_push_test',{p_location_id:location}); if(r.error) throw r.error
    }, 'Test queued for your device.')}>Test my notification connection</button>
    <h3>Schedule and required-work roster</h3>
    <label>Service day <input type="date" value={day} onChange={e => {setDay(e.target.value);requestId.current=null}}/></label>
    <button type="button" onClick={() => void perform(async () => {
     const r = await supabase.functions.invoke('home-schedule',{body:{location_id:location,date:day}})
     if(r.error) throw r.error
     if(!r.data?.configured) throw Error('7shifts is not connected.')
     if(r.data.error) throw Error(r.data.error)
    }, 'Schedule refreshed. Review the roster and confirm it.')}>Refresh 7shifts schedule</button>
    <p>{data.ready ? 'Schedule confirmed.' : 'Schedule needs confirmation; scheduled-only alerts and quiz/closeout deductions are paused.'}</p>
    {data.schedule?.last_error && <p role="alert">{data.schedule.last_error}</p>}
    <p>Verify each employee’s app account and check every shift that requires a closeout. Server and bartender shifts are always required. Confirm after schedule changes or call-outs. The confirmed roster freezes at 4 AM.</p>
    {unmatched.length > 0 && <p role="alert">{unmatched.length} scheduled shift(s) have no active app-account link. The GM must link them before confirming.</p>}
    {rows.map(s => {
     const linked = data.staff.find(p => p.employee_key === s.employee_key)
     const mandatory = requiredCloseout(s,data.staff)
     return <div key={s.id} style={{borderBottom:'1px solid #ddd',padding:'12px 0'}}>
      <strong>{s.name} · {s.role}</strong><p>{timeLabel(s.start)}–{timeLabel(s.end)} · 7shifts ID {s.employee_key}</p>
      {access.gm ? <label>App account <select value={linked?.id ?? ''} onChange={e => {
       const uid=e.target.value
       if(!uid)return
       void perform(async () => {
        const r=await supabase.rpc('team_schedule_link',{p_location_id:location,p_user_id:uid,p_key:s.employee_key})
        if(r.error)throw r.error
       }, 'Employee linked. Reconfirm the schedule.')
      }}><option value="">Choose the correct app account</option>{data.staff.map(p => <option key={p.id} value={p.id}>{p.name}{p.employee_key ? ' · '+p.employee_key : ''}</option>)}</select></label>
       : <p>App account: {linked?.name ?? 'Not linked — ask the GM'}</p>}
      <label><input type="checkbox" checked={closeouts.includes(s.id)} disabled={mandatory} onChange={e => setCloseouts(v => e.target.checked ? [...v,s.id] : v.filter(x => x!==s.id))}/> Closeout required for this shift</label>
     </div>
    })}
    {!rows.length && <p>No assigned shifts in the current cache. Refresh and verify that this is an off day before confirming.</p>}
    <button type="button" disabled={!data.schedule || !!unmatched.length} onClick={() => {
     if(!window.confirm('Confirm this schedule and closeout roster? Everyone listed will be required to complete the day’s published quizzes.'))return
     void perform(async () => {
      const r=await supabase.rpc('staff_schedule_confirm',{p_location_id:location,p_day:day,p_snapshot:data.schedule?.rows,p_closeout_keys:closeouts})
      if(r.error)throw r.error
     }, 'Schedule confirmed. Quiz requirements are active.')
    }}>Confirm reviewed schedule</button>
    <h3>Send a management announcement</h3>
    <p>Uses the Management announcements audience above. No announcement is sent until you press Send.</p>
    <label>Title <input maxLength={120} value={title} onChange={e => {setTitle(e.target.value);requestId.current=null}}/></label>
    <label>Message <textarea maxLength={500} value={body} onChange={e => {setBody(e.target.value);requestId.current=null}}/></label>
    <button disabled={!title.trim() || !body.trim()} type="button" onClick={() => {
     if(!window.confirm('Send this push announcement to the selected audience?'))return
     requestId.current ??= crypto.randomUUID()
     void perform(async () => {
      const r=await supabase.rpc('staff_notification_send',{p_location_id:location,p_day:day,p_title:title,p_body:body,p_request_id:requestId.current})
      if(r.error)throw r.error
      requestId.current=null;setTitle('');setBody('')
     }, 'Announcement queued.')
    }}>Send announcement</button>
    <p>Rules start on {data.effective_date}. Earlier point history is preserved. The GM can waive or correct deductions in Points.</p>
   </fieldset>}
  </article>}
 </div>
}
