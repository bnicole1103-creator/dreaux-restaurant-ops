import {DesignSection} from './DesignSection'
import {PageWord} from './PageDesign'
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
  return <DesignSection as="article" className="task-card" data-design-block="tasks.bulk.card">
    <h2><ScreenText id="TasksBulk.heading">Assign multiple task groups</ScreenText></h2>
    <p><ScreenText id="TasksBulk.description">Choose one employee and all the task groups they need. Assign them together.</ScreenText></p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset data-design-block="section.ef46d04fc64a75b86955" disabled={disabled || busy}>
      <label><PageWord id="sectioncopy.9b580c0f8f8394d1a81f">{"Employee"}</PageWord><select value={employee} onChange={e => { setEmployee(e.target.value); change() }}>
        <option value="">Choose an employee</option>
        {staff.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.preferred_name || m.profile?.full_name || 'Team Member'}</option>)}
      </select></label>
      <label><PageWord id="sectioncopy.48ee43402cd57eae7b32">{"Find task groups"}</PageWord><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="task-staff">{visible.map(t => <div key={t.id}>
        <label><input type="checkbox" disabled={!t.reviewed || (!ids.includes(t.id) && ids.length >= 40)} checked={ids.includes(t.id)} onChange={e => { setIds(v => e.target.checked ? [...v, t.id] : v.filter(id => id !== t.id)); change() }} />
          <span>{t.title}<small>{t.items.length}<PageWord id="sectioncopy.42c7d4a30e22580a87a6">{" tasks · "}</PageWord>{t.reviewed ? (t.due_time ? `Due ${t.due_time.slice(0, 5)}` : 'No preset due time') : 'Review this group before assigning'}</small></span>
        </label>
        <details><summary><PageWord id="sectioncopy.937db82a1fb1b9e6a8ae">{"Preview tasks"}</PageWord></summary><ol>{t.items.map((item, i) => <li key={i}>{item}</li>)}</ol></details>
      </div>)}</div>
      {!visible.length && <p><PageWord id="sectioncopy.18cc692bd696d5b62db3">{"No matching task groups."}</PageWord></p>}
      <button type="button" onClick={() => { setIds([]); change() }}><PageWord id="sectioncopy.dc9e5efcd851f51d4e99">{"Clear selection"}</PageWord></button>
      <label><PageWord id="sectioncopy.18226ad244aef3bad482">{"Shift or area (optional)"}</PageWord><input maxLength={100} value={shift} onChange={e => { setShift(e.target.value); change() }} /></label>
      <label><PageWord id="sectioncopy.27e0ce704fb948c7d4de">{"Common due time (optional, New Orleans time)"}</PageWord><input type="time" value={due} onChange={e => { setDue(e.target.value); change() }} /></label>
      <p><PageWord id="sectioncopy.2dadfe4d749f92570ec9">{"Leave the time blank to keep each group's default due time."}</PageWord></p>
      <p>{ids.length}<PageWord id="sectioncopy.4f6771649856d2102a45">{" groups selected · "}</PageWord>{selected.reduce((n, t) => n + t.items.length, 0)}<PageWord id="sectioncopy.41a8995e0ef7f19242dc">{" tasks · "}</PageWord>{serviceDateLabel(day)}</p>
      {selected.length > 0 && <ul>{selected.map(t => <li key={t.id}>{t.title}</li>)}</ul>}
      <button type="button" disabled={!valid} onClick={() => void assign()}>{busy ? 'Assigning…' : `Assign ${ids.length} groups to ${name}`}</button>
    </fieldset>
  </DesignSection>
}
