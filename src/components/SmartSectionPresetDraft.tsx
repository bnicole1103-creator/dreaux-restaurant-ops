import {useRef, useState} from 'react'
import {sectionRoster, rosterName, type SectionRosterShift} from '../lib/sectionRoster'
import {recommendSections, type CloseoutPerformance} from '../lib/smartSections'
import {shiftClock} from '../lib/calendarDates'
import {supabase} from '../lib/supabase'
import type {SectionPlan} from './SectionSchedule'

export type SectionTablePreset = {id:string;name:string;table_ids:string[];version:number}

type Props = {
  locationId:string
  initialDay:string
  presets:SectionTablePreset[]
  plans:SectionPlan[]
  tables:{id:string;table_name:string;seat_count:number}[]
  disabled:boolean
  onReview:(preset:SectionTablePreset, shift:SectionRosterShift, day:string)=>void
}

type DraftRow = {preset:SectionTablePreset;shift?:SectionRosterShift;reason?:string}

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
  const [choices, setChoices] = useState<Partial<Record<string, keyof typeof roles>>>({})
  const [rows, setRows] = useState<DraftRow[] | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const selectedPresets = presets.filter(preset=>choices[preset.id])
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
        .filter(shift=>Date.parse(shift.end) > Date.parse(shift.start) && Date.parse(shift.end) > Date.now())
        .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start) || a.name.localeCompare(b.name))
      const countSeats = (ids:string[]) => tables.reduce((sum,table)=>sum+(ids.includes(table.id)?table.seat_count:0),0)
      const draft:DraftRow[] = []
      const priority = [...selectedPresets].sort((a,b)=>countSeats(b.table_ids)-countSeats(a.table_ids))
      for (const preset of priority) {
        const role = choices[preset.id]!
        const eligible = usable(preset) ? shifts.filter(candidate=>
          roles[role].test(candidate.role?.toLowerCase() ?? '')
          && !conflicts(preset,candidate,plans)
          && !draft.some(row=>row.shift
            && overlaps(row.shift.start,row.shift.end,candidate.start,candidate.end)
            && (samePerson(row.shift,candidate) || row.preset.table_ids.some(id=>preset.table_ids.includes(id))))) : []
        if (!eligible.length) {
          draft.push({preset})
          continue
        }
        const history = await supabase.rpc('floor_smart_context', {
          p_location_id:locationId, p_table_ids:preset.table_ids, p_day:day, p_role:role,
        })
        if (history.error) throw history.error
        const context = history.data as {performance?:CloseoutPerformance[];loads?:Record<string,number>} | null
        const candidates = new Map<string, SectionRosterShift>()
        for (const shift of eligible) {
          const id = shift.user_id ?? 'schedule:'+shift.id
          if (!candidates.has(id)) candidates.set(id,shift)
        }
        const loads:Record<string,number> = {}
        for (const [id,shift] of candidates) {
          const assigned = new Set(plans.filter(plan=>shifts.some(other=>samePerson(shift,other)
            && overlaps(other.start,other.end,plan.starts_at,plan.ends_at)
            && (shift.user_id ? plan.employee_id===shift.user_id
              : !!plan.guest_name && rosterName(plan.guest_name)===rosterName(shift.name))))
            .flatMap(plan=>plan.table_ids))
          const drafted = draft.reduce((sum,row)=>sum+(row.shift&&samePerson(shift,row.shift)?countSeats(row.preset.table_ids):0),0)
          loads[id] = Math.max(context?.loads?.[id] ?? 0,countSeats([...assigned])) + drafted
        }
        const ranked = recommendSections([...candidates].map(([id,shift])=>({id,name:shift.name,scheduled:true})),
          context?.performance ?? [],loads,countSeats(preset.table_ids))
        const best = ranked[0]
        draft.push({preset,shift:candidates.get(best.employeeId),
          reason:best.historicalUses ? `Matched using closeout performance and seat allocation · ${best.currentSeats} seats already allocated.`
            : `Ranked by seat allocation · ${best.currentSeats} seats already allocated.`})
      }
      setRows(selectedPresets.flatMap(preset=>draft.filter(row=>row.preset.id===preset.id)))
    } catch (error) {
      setError((error as Error).message || 'Could not draft section assignments.')
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
    </div>
    {!!presets.length && <fieldset disabled={working||disabled}>
      <legend>Which presets should Smart Sections use?</legend>
      <p>Choose a position for each preset you want to assign.</p>
      {presets.map(preset=><label key={preset.id}>{preset.name}
        <select value={choices[preset.id] ?? ''} onChange={e=>{
          const role = e.target.value as keyof typeof roles | ''
          setChoices(previous=>({...previous,[preset.id]:role || undefined}))
          setRows(null)
          setError('')
        }}>
          <option value="">Skip preset</option>
          <option value="server">Server</option>
          <option value="bartender">Bartender</option>
          <option value="host">Host</option>
        </select>
      </label>)}
    </fieldset>}
    <button type="button" disabled={working||disabled||!day||!selectedPresets.length} onClick={()=>void generate()}>
      {working?'Ranking scheduled staff…':'Draft preset assignments'}
    </button>
    {error && <p role="alert">{error}</p>}
    {rows && <div>
      <p>Review each suggestion to adjust or save it.</p>
      {rows.map(({preset,shift,reason})=>{
        const current = presets.find(item=>item.id===preset.id)
        const changed = current?.version!==preset.version || !usable(preset)
        const conflict = !!shift && conflicts(preset,shift,plans)
        return <article className="card" key={preset.id}>
          <strong>{preset.name}</strong>
          <p>{preset.table_ids.map(id=>tables.find(table=>table.id===id)?.table_name ?? 'Unavailable table').join(' + ')}</p>
          {shift && <p>{shift.name} · {shiftClock(shift.start)} – {shiftClock(shift.end)}</p>}
          {reason && <p>{reason}</p>}
          {changed ? <p>Preset changed or has unavailable tables. Draft again to refresh.</p>
            : conflict ? <p>Already covered or conflicts with a saved section.</p>
            : shift ? <button type="button" disabled={disabled||working} onClick={()=>onReview(preset,shift,day)}>Review assignment</button>
            : <p>No matching shift without a conflict.</p>}
        </article>
      })}
    </div>}
  </details>
}
