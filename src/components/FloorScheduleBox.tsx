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
 return <section className="floor-schedule-box"><header><div><p className="eyebrow">Who’s on</p><h2>{dateLabel(date,true)}</h2></div><label>Schedule date<input type="date" value={date} onChange={e=>{if(validDay(e.target.value))setDate(e.target.value)}}/></label><button type="button" disabled={schedule.loading} onClick={schedule.reload}>Refresh</button></header>{schedule.error&&<p role="alert">{schedule.error}</p>}{schedule.scheduleError&&<p role="alert">{schedule.scheduleError}</p>}{schedule.loading&&<p role="status">Refreshing schedule…</p>}<div className="floor-schedule-chips">{rows.map(s=><details key={s.id}><summary>{s.name}</summary><span>{s.role} · {shiftClock(s.start)}–{s.close?'Close':s.business_decline?'Business decline':shiftClock(s.end)}</span></details>)}</div>{!schedule.loading&&!rows.length&&<p>No assigned, published shifts for this day.</p>}</section>
}
