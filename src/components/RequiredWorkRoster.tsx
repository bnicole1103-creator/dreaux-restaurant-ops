import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Staff = { id: string; name: string; employee_key: string | null; role: string }
type Row = { shift_key: string; user_id: string; start_at: string; end_at: string; role_name: string; requires_closeout: boolean }
type Imported = { id: string; employee_key: string; assigned: boolean; role: string; start: string; end: string }
type Data = { confirmed_at: string | null; staff: Staff[]; shifts: Row[]; schedule: { rows: Imported[] } | null }
const localTime = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
type Draft = Omit<Row, 'start_at' | 'end_at'> & { start: string; end: string }
function initial(data: Data): Draft[] {
 const rows = data.confirmed_at ? data.shifts : (data.schedule?.rows ?? []).filter(s => s.assigned).map(s => ({
  shift_key: s.id, user_id: data.staff.find(p => p.employee_key === s.employee_key)?.id ?? '', start_at: s.start, end_at: s.end,
  role_name: s.role, requires_closeout: /server|bartender/i.test(s.role)
 }))
 return rows.map(s => ({ ...s, start: localTime(s.start_at), end: localTime(s.end_at) }))
}
export function RequiredWorkRoster({ location, day, data, onSaved }: { location: string; day: string; data: Data; onSaved: () => Promise<void> }) {
 const [rows, setRows] = useState<Draft[]>(() => initial(data))
 const [adding, setAdding] = useState('')
 const [busy, setBusy] = useState(false)
 const [dirty, setDirty] = useState(false)
 const [message, setMessage] = useState('')
 const [error, setError] = useState('')
 useEffect(() => { if (!dirty) setRows(initial(data)) }, [data, dirty])
 function change(key: string, patch: Partial<Draft>) {
  setRows(v => v.map(r => r.shift_key === key ? { ...r, ...patch } : r)); setDirty(true); setMessage('')
 }
 async function save() {
  setBusy(true); setError(''); setMessage('')
  try {
   const result = await supabase.rpc('staff_required_roster_save', { p_location_id: location, p_day: day,
    p_snapshot: data.schedule?.rows ?? null, p_confirmed_at: data.confirmed_at, p_rows: rows.map(r => ({ shift_key: r.shift_key, user_id: r.user_id,
     start_time: r.start, end_time: r.end, role_name: r.role_name, requires_closeout: r.requires_closeout })) })
   if (result.error) throw result.error
   await onSaved(); setDirty(false); setMessage('Roster saved. Quiz and closeout requirements are updated.')
  } catch (e) { setError(String((e as { message?: string })?.message ?? e)) }
  finally { setBusy(false) }
 }
 return <section aria-label="Edit required-work roster">
  <h3>Manage required work for this day</h3>
  <p>Add any active team member, including management. Edit each shift’s position, times, and closeout requirement. Everyone on this roster receives the day’s published quiz requirements.</p>
  <p>Changes take effect when you save. Removing someone here removes their requirements for this day; their account and submitted work stay available.</p>
  {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  <fieldset disabled={busy} style={{ minWidth: 0 }}>
   <label>Add team member <select value={adding} onChange={e => setAdding(e.target.value)}>
    <option value="">Choose a team member</option>{[...data.staff].sort((a,b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
   </select></label>
   <button type="button" disabled={!adding} onClick={() => {
    const person = data.staff.find(p => p.id === adding); if (!person) return
    setRows(v => [...v, { shift_key: 'manual:'+crypto.randomUUID(), user_id: person.id, start: '16:00', end: '23:00', role_name: person.role, requires_closeout: /server|bartender/i.test(person.role) }]);
    setAdding(''); setDirty(true); setMessage('')
   }}>Add to roster</button>
   {rows.map((r,index) => <article key={r.shift_key} className="task-card" aria-label={'Roster shift '+(index+1)}>
    <label>Team member <select value={r.user_id} onChange={e => change(r.shift_key, {user_id: e.target.value})}>
     <option value="">Choose the app account</option>{data.staff.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    <label>Position <input value={r.role_name} maxLength={100} onChange={e => change(r.shift_key,{role_name:e.target.value})}/></label>
    <div style={{display:'flex',flexWrap:'wrap',gap:16}}>
     <label>Start time <input type="time" value={r.start} onChange={e => change(r.shift_key,{start:e.target.value})}/></label>
     <label>End time <input type="time" value={r.end} onChange={e => change(r.shift_key,{end:e.target.value})}/></label>
    </div>
    <label><input type="checkbox" checked={r.requires_closeout} onChange={e => change(r.shift_key,{requires_closeout:e.target.checked})}/> Closeout required</label>
    <button type="button" onClick={() => {setRows(v => v.filter(s => s.shift_key !== r.shift_key));setDirty(true);setMessage('')}}>Remove from this day</button>
   </article>)}
   {!rows.length && <p>No one is on this day’s required-work roster.</p>}
   <p>Times use Central time. An end time earlier than the start is the following morning. Save before the service day’s 4 AM deadline.</p>
   {dirty && <p role="status">You have unsaved roster changes.</p>}
   <button type="button" disabled={rows.some(r => !r.user_id || !r.role_name.trim() || !r.start || !r.end)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save required-work roster'}</button>
   <button type="button" onClick={() => {setRows(initial(data));setDirty(false);setError('');setMessage('')}}>Reset unsaved changes</button>
  </fieldset>
 </section>
}
