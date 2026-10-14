import {useEffect,useState} from 'react'
import {CalendarDayPopup} from './CalendarDayPopup'
import {calendarLook} from '../lib/calendarLook'
import './CalendarStudio.css'
import {Link} from 'react-router-dom'
import {calendarToday,dateLabel,weekDays} from '../lib/calendarDates'
import {useCalendarData} from './CalendarData'
import './Calendar.css'
import './CompactCalendar.css'
import './CalendarLayoutExtras.css'
export function WeeklyCalendar({location}:{location:string}){
 const [today,setToday]=useState(calendarToday)
 useEffect(()=>{const update=()=>setToday(calendarToday());const timer=setInterval(update,60000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update)}},[])
 const [open,setOpen]=useState<{date:string;view:string}|null>(null)
 const days=weekDays(today),calendar=useCalendarData(location,days[0],days[6])
 return <><section style={calendarLook(calendar.data.styles?.[today.slice(0,7)]?.config)} className="home-section home-week-calendar calendar-studio-week poster-week" aria-label="This week's calendar">
  <div className="home-section-heading"><h2>This week</h2><div className="calendar-week-actions"><Link to="/calendar">Full calendar →</Link><button type="button" disabled={calendar.loading} onClick={calendar.reload}>Refresh</button></div></div>
  <p className="calendar-week-range">{dateLabel(days[0],true)}–{dateLabel(days[6],true)} · Central time</p>
  {calendar.error&&<p role="alert">{calendar.error}</p>}{calendar.scheduleError&&<p role="alert">{calendar.scheduleError}</p>}{calendar.loading&&<p role="status">Loading the week…</p>}
  <div className="calendar-week-scroll" role="region" aria-label="Monday through Sunday; scroll horizontally on smaller screens" tabIndex={0}><div className="calendar-week">{days.map((date,index)=>{
   const day=calendar.data.days[date],events=calendar.data.events.filter(e=>e.date===date),event=events[0]
   return <article key={date} className={'calendar-week-day'+(date===today?' today':'')} aria-label={dateLabel(date)}>
    <h3><button type="button" onClick={()=>setOpen({date,view:'day'})} aria-current={date===today?'date':undefined}><span>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index]}</span><span>{new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(date+'T12:00:00Z'))}</span></button></h3>
    <button type="button" className={'calendar-week-event'+(!event?' muted':'')} onClick={()=>setOpen({date,view:'day'})} title={event?.title}>{event?event.title:day?.posts?day.posts+' post'+(day.posts===1?'':'s'):'No updates'}{events.length>1&&<small>+{events.length-1} more</small>}</button>
    <button type="button" className="calendar-reservations" onClick={()=>setOpen({date,view:'reservations'})}><span className="calendar-reservation-label">Reservations</span><strong>{day?day.reservations:'—'}</strong></button>
   </article>
  })}</div></div>
 </section>{open&&<CalendarDayPopup key={open.date} location={location} date={open.date} initialView={open.view} onClose={()=>setOpen(null)}/>}</>
}
