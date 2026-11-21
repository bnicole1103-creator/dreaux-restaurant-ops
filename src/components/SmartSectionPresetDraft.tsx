import {useRef, useState} from 'react'
import {sectionRoster, rosterName, type SectionRosterShift} from '../lib/sectionRoster'
import {shiftClock} from '../lib/calendarDates'
import {supabase} from '../lib/supabase'
import type {SectionPlan} from './SectionSchedule'

export type SectionTablePreset = {id:string;name:string;table_ids:string[];version:number}

type Props = {
  locationId:string
  initialDay:string
  presets:SectionTablePreset[]
  plans:SectionPlan[]
  tables:{id:string;table_name:string}[]
  disabled:boolean
  onReview:(preset:SectionTablePreset, shift:SectionRosterShift, day:string)=>void
}

type DraftRow = {preset:SectionTablePreset;shift?:SectionRosterShift}

const roles = {
  server: /server|waiter|waitress|waitstaff/,
  bartender: /bartender|bar tender/,
  host: /host/,
}

const samePerson = (a:SectionRosterShift, b:SectionRosterShift) =>
  a.user_id && b.user_id ? a.user_id === b.user_id : rosterName(a.name) === rosterName(b.name)

const overlaps = (aStart:string, aEnd:string, bStart:string, bEnd:string) =>
  Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd)

function conflicts(preset:SectionTablePreset, shift:SectionRosterShift, plans:SectionPlan[]) {
  return plans.some(plan=>overlaps(plan.starts_at, plan.ends_at, shift.start, shift.end)
    && (plan.table_ids.some(id=>preset.table_ids.includes(id))
      || (plan.employee_id && plan.employee_id === shift.user_id)
      || (plan.guest_name && rosterName(plan.guest_name) === rosterName(shift.name))))
}

export function SmartSectionPresetDraft({locationId, initialDay, presets, plans, tables, disabled, onReview}:Props) {
  const [day, setDay] = useState(initialDay)
  const [role, setRole] = useState<keyof typeof roles>('server')
  const [excluded, setExcluded] = useState<string[]>([])
  const [rows, setRows] = useState<DraftRow[] | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const selectedPresets = presets.filter(preset=>!excluded.includes(preset.id))
  const tableIds = new Set(tables.map(table=>table.id))
  const usable = (preset:SectionTablePreset) =>
    preset.table_ids.length > 0 && preset.table_ids.every(id=>tableIds.has(id))

  async function generate() {
    if (pending.current || disabled || !day || !selectedPresets.length) return
    pending.current = true
    setWorking(true)
    setError('')
    setRows(null)
    try {
      const result = await supabase.rpc('crew_schedule_tools_load', {p_location_id:locationId, p_day:day})
      if (result.error) throw result.error
      const shifts = sectionRoster(result.data?.rows ?? [])
        .filter(shift=>roles[role].test(shift.role?.toLowerCase() ?? '')
          && Date.parse(shift.end) > Date.parse(shift.start)
          && Date.parse(shift.end) > Date.now())
        .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start) || a.name.localeCompare(b.name))
      if (!shifts.length) {
        setError('No scheduled staff in this position have usable shift hours for this date.')
        return
      }
      const draft:DraftRow[] = []
      for (const preset of selectedPresets) {
        const shift = usable(preset) ? shifts.find(candidate=>!conflicts(preset,candidate,plans)
          && !draft.some(row=>row.shift
            && overlaps(row.shift.start,row.shift.end,candidate.start,candidate.end)
            && (samePerson(row.shift,candidate) || row.preset.table_ids.some(id=>preset.table_ids.includes(id))))) : undefined
        draft.push({preset,shift})
      }
      setRows(draft)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      pending.current = false
      setWorking(false)
    }
  }

  return <details className="smart-section-preset-draft">
    <summary>Smart sections · Draft from presets</summary>
    {!presets.length && <p>Save a table preset in Assign section to use it here.</p>}
    <div className="form-grid">
      <label>Service date<input type="date" required value={day} disabled={working||disabled} onChange={e=>{setDay(e.target.value);setRows(null);setError('')}}/></label>
      <label>Scheduled position<select value={role} disabled={working||disabled} onChange={e=>{setRole(e.target.value as keyof typeof roles);setRows(null);setError('')}}>
        <option value="server">Server</option>
        <option value="bartender">Bartender</option>
        <option value="host">Host</option>
      </select></label>
      <button type="button" disabled={working||disabled||!day||!selectedPresets.length} onClick={()=>void generate()}>{working?'Loading scheduled staff…':'Draft preset assignments'}</button>
    </div>
    {!!presets.length && <details>
      <summary>Choose presets ({selectedPresets.length})</summary>
      <fieldset disabled={working||disabled}>
        <legend>Table presets</legend>
        {presets.map(preset=><label key={preset.id}>
          <input type="checkbox" checked={!excluded.includes(preset.id)} onChange={e=>{
            const checked = e.target.checked
            setExcluded(items=>checked ? items.filter(id=>id!==preset.id) : [...items,preset.id])
            setRows(null)
          }}/>{preset.name}
        </label>)}
      </fieldset>
    </details>}
    {error && <p role="alert">{error}</p>}
    {rows && <div>
      <p>Review each suggestion to adjust or save it.</p>
      {rows.map(({preset,shift})=>{
        const current = presets.find(item=>item.id===preset.id)
        const changed = current?.version!==preset.version || !usable(preset)
        const conflict = !!shift && conflicts(preset,shift,plans)
        return <article className="card" key={preset.id}>
          <strong>{preset.name}</strong>
          <p>{preset.table_ids.map(id=>tables.find(table=>table.id===id)?.table_name ?? 'Unavailable table').join(' + ')}</p>
          {shift && <p>{shift.name} · {shiftClock(shift.start)} – {shiftClock(shift.end)}</p>}
          {changed ? <p>Preset changed or has unavailable tables. Draft again to refresh.</p>
            : conflict ? <p>Already covered or conflicts with a saved section.</p>
            : shift ? <button type="button" disabled={disabled||working} onClick={()=>onReview(preset,shift,day)}>Review assignment</button>
            : <p>No matching shift without a conflict.</p>}
        </article>
      })}
    </div>}
  </details>
}
