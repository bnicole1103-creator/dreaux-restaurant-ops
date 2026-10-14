import {useEffect,useRef} from 'react'
import {useCalendarData} from './CalendarData'
import {shiftClock,dateLabel} from '../lib/calendarDates'
import {scheduledPeople,matchSchedulePeople} from '../lib/scheduledPeople'
import './FloorScheduleBox.css'
export function ScheduledSectionEmployeePicker({location,date,employees,employeeId,guestName,onChange,disabled=false}:{location:string;date:string;employees:{id:string;name:string}[];employeeId:string|null;guestName:string;onChange:(id:string|null,name:string)=>void;disabled?:boolean}){
 const schedule=useCalendarData(location,date,date),people=matchSchedulePeople(scheduledPeople(schedule.data.days[date]?.rows??[]),employees)
 const previousDate=useRef(date)
 useEffect(()=>{if(previousDate.current!==date){previousDate.current=date;onChange('','')}},[date])
 const chosen=employeeId?people.find(p=>p.account?.id===employeeId):people.find(p=>p.name===guestName)
 const value=chosen?.key??(employeeId||guestName?'__existing__':'')
 return <div className="scheduled-section-picker"><label>Scheduled staff · {dateLabel(date,true)}<select required value={value} disabled={disabled||schedule.loading} onChange={e=>{const p=people.find(p=>p.key===e.target.value);if(p)onChange(p.account?.id??null,p.account?'':p.name);else onChange('','')}}><option value="">Choose scheduled employee</option>{value==='__existing__'&&<option value="__existing__">Existing assignment — not matched to this schedule</option>}{people.map(p=><option key={p.key} value={p.key}>{p.name} · {p.role} · {shiftClock(p.start)}{p.account?'':' · name only'}</option>)}</select></label>{schedule.loading&&<p role="status">Loading scheduled staff…</p>}{schedule.error&&<p role="alert">{schedule.error}</p>}{schedule.scheduleError&&<p role="alert">{schedule.scheduleError}</p>}{!schedule.loading&&!people.length&&<p>No assigned, published shifts found for this date. Refresh the schedule before assigning.</p>}{!schedule.loading&&<div className="scheduled-section-roster">{people.map(p=><span key={p.key}><strong>{p.name}</strong> · {p.role} · {shiftClock(p.start)}–{p.close?'Close':p.business_decline?'Business decline':shiftClock(p.end)}</span>)}</div>}{chosen&&!chosen.account&&<p>This scheduled name has no unique matching app account. It will be saved as a name-only assignment.</p>}<button type="button" disabled={disabled||schedule.loading} onClick={schedule.reload}>Refresh scheduled staff</button></div>
}
