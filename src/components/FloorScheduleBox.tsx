import { TeamProfileName } from './TeamProfileName'
import {PageWord} from './PageDesign'
import {useEffect,useRef,useState} from 'react'
import {useCalendarData} from './CalendarData'
import {dateLabel,validDay,shiftClock} from '../lib/calendarDates'
import {scheduledPeople} from '../lib/scheduledPeople'
import './FloorScheduleBox.css'
export function FloorScheduleBox({location,date:shiftDate}:{location:string;date:string}){
 const [date,setDate]=useState(()=>{const requested=new URLSearchParams(window.location.search).get('date')??'';return validDay(requested)?requested:shiftDate}),schedule=useCalendarData(location,date,date)
 const previous=useRef(shiftDate)
 useEffect(()=>{if(previous.current!==shiftDate){setDate(shiftDate);previous.current=shiftDate}},[shiftDate])
 const rows=scheduledPeople(schedule.data.days[date]?.rows??[])
 return <section data-design-block="section.029612f999126bc63c9e" className="floor-schedule-box"><header data-design-block="section.69a4537c24fa3a68c191"><div><p className="eyebrow"><PageWord id="sectioncopy.65b6a999645773416bc7">{"Who’s on"}</PageWord></p><h2>{dateLabel(date,true)}</h2></div><label><PageWord id="sectioncopy.27f559d134467117eed5">{"Schedule date"}</PageWord><input type="date" value={date} onChange={e=>{if(validDay(e.target.value))setDate(e.target.value)}}/></label><button type="button" disabled={schedule.loading} onClick={schedule.reload}><PageWord id="sectioncopy.87085633a1fa2102c3bb">{"Refresh"}</PageWord></button></header>{schedule.error&&<p role="alert">{schedule.error}</p>}{schedule.scheduleError&&<p role="alert">{schedule.scheduleError}</p>}{schedule.loading&&<p role="status"><PageWord id="sectioncopy.a7391884f644a5732163">{"Refreshing schedule…"}</PageWord></p>}<div className="floor-schedule-chips">{rows.map(s=><details key={s.id}><summary><TeamProfileName employeeKey={s.employee_key} locationId={location} name={s.name}/></summary><span>{s.role}<PageWord id="sectioncopy.2ce718624737ca9ef721">{" · "}</PageWord>{shiftClock(s.start)}<PageWord id="sectioncopy.3b86fcbf5119b0f611b5">{"–"}</PageWord>{s.close?'Close':s.business_decline?'Business decline':shiftClock(s.end)}</span></details>)}</div>{!schedule.loading&&!rows.length&&<p><PageWord id="sectioncopy.444fa3baaeaf1d827a30">{"No assigned, published shifts for this day."}</PageWord></p>}</section>
}
