import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TeamMember } from '../lib/team'
import { serviceDateLabel } from '../lib/serviceDay'
import { ScreenText } from './ScreenText'

type Preset = { id: string; title: string; items: string[]; reviewed: boolean; version: number; due_time?: string | null }
type Props = { location: string; day: string; templates: Preset[]; staff: TeamMember[]; disabled: boolean; onBusy: (busy: boolean) => void; onAssigned: () => void }
export function BulkTaskAssignment({ location, day, templates, staff, disabled, onBusy, onAssigned }: Props) {
  const [employee, setEmployee] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [due, setDue] = useState('')
  const [shift, setShift] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const request = useRef<{ key: string; id: string } | null>(null)
  const selected = templates.filter(t => ids.includes(t.id))
  const visible = templates.filter(t => t.title.toLowerCase().includes(search.toLowerCase()))
  const member = staff.find(m => m.user_id === employee)
  const name = member?.profile?.preferred_name || member?.profile?.full_name || 'employee'
  const valid = !!member && ids.length > 0 && ids.length <= 40 && selected.length === ids.length && selected.every(t => t.reviewed)
  function change() { request.current = null; setNotice(''); setError('') }
  async function assign() {
    if (pending.current || disabled || !valid) return
    pending.current = true; setBusy(true); onBusy(true); setError(''); setNotice('')
    const payload = { p_location_id: location, p_employee: employee, p_templates: selected.map(t => ({ id: t.id, version: t.version })).sort((a, b) => a.id.localeCompare(b.id)), p_day: day, p_shift: shift, p_due: due || null }
    const key = JSON.stringify(payload)
    if (request.current && request.current.key !== key) {
      setError('The selection changed after the last attempt. Clear the selection and try again.'); pending.current = false; setBusy(false); onBusy(false); return
    }
    request.current ??= { key, id: crypto.randomUUID() }
    try {
      const result = await supabase.rpc('staff_tasks_assign_many', { ...payload, p_request_id: request.current.id })
      if (result.error) throw result.error
      setNotice(`Assigned ${selected.length} task groups to ${name} for ${serviceDateLabel(day)}.`)
      setIds([]); request.current = null; onAssigned()
    } catch (e) { setError(String((e as { message?: string })?.message ?? e)) }
    finally { pending.current = false; setBusy(false); onBusy(false) }
  }
  return <article className="task-card" data-design-block="tasks.bulk.card">
    <h2><ScreenText id="TasksBulk.heading">Assign multiple task groups</ScreenText></h2>
    <p><ScreenText id="TasksBulk.description">Choose one employee and all the task groups they need. Assign them together.</ScreenText></p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset disabled={disabled || busy}>
      <label>Employee<select value={employee} onChange={e => { setEmployee(e.target.value); change() }}>
        <option value="">Choose an employee</option>
        {staff.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.preferred_name || m.profile?.full_name || 'Team Member'}</option>)}
      </select></label>
      <label>Find task groups<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="task-staff">{visible.map(t => <div key={t.id}>
        <label><input type="checkbox" disabled={!t.reviewed || (!ids.includes(t.id) && ids.length >= 40)} checked={ids.includes(t.id)} onChange={e => { setIds(v => e.target.checked ? [...v, t.id] : v.filter(id => id !== t.id)); change() }} />
          <span>{t.title}<small>{t.items.length} tasks · {t.reviewed ? (t.due_time ? `Due ${t.due_time.slice(0, 5)}` : 'No preset due time') : 'Review this group before assigning'}</small></span>
        </label>
        <details><summary>Preview tasks</summary><ol>{t.items.map((item, i) => <li key={i}>{item}</li>)}</ol></details>
      </div>)}</div>
      {!visible.length && <p>No matching task groups.</p>}
      <button type="button" onClick={() => { setIds([]); change() }}>Clear selection</button>
      <label>Shift or area (optional)<input maxLength={100} value={shift} onChange={e => { setShift(e.target.value); change() }} /></label>
      <label>Common due time (optional, New Orleans time)<input type="time" value={due} onChange={e => { setDue(e.target.value); change() }} /></label>
      <p>Leave the time blank to keep each group's default due time.</p>
      <p>{ids.length} groups selected · {selected.reduce((n, t) => n + t.items.length, 0)} tasks · {serviceDateLabel(day)}</p>
      {selected.length > 0 && <ul>{selected.map(t => <li key={t.id}>{t.title}</li>)}</ul>}
      <button type="button" disabled={!valid} onClick={() => void assign()}>{busy ? 'Assigning…' : `Assign ${ids.length} groups to ${name}`}</button>
    </fieldset>
  </article>
}
