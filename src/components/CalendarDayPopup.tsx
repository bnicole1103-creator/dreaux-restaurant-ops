import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {dateLabel} from '../lib/calendarDates'
import {calendarLook} from '../lib/calendarLook'
import {useCalendarData} from './CalendarData'
import {CalendarDialog} from './CalendarDialog'
import {CalendarFlyers} from './CalendarFlyers'
import {CalendarDayPosts} from './CalendarDayPosts'
type Reservation={id:string;name:string;time:string|null;party:number;notes:string|null;status:string;occasion:string|null}
export function CalendarDayPopup({location,date,initialView='day',onClose}:{location:string;date:string;initialView?:string;onClose:()=>void}){
 const calendar=useCalendarData(location,date,date),[view,setView]=useState(initialView),[reservations,setReservations]=useState<Reservation[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{let live=true;void supabase.rpc('calendar_reservations',{p_location_id:location,p_date:date}).then(r=>{if(!live)return;if(r.error)setError(r.error.message);else setReservations(r.data??[]);setLoading(false)});return()=>{live=false}},[location,date])
 return <CalendarDialog title={dateLabel(date)} onClose={onClose} style={calendarLook(calendar.data.styles?.[date.slice(0,7)]?.config)}><nav className="calendar-popup-tabs"><button type="button" aria-pressed={view==='day'} onClick={()=>setView('day')}>Highlights & posts</button><Link to={'/floor?date='+date}>Staff schedule on Floor →</Link><button type="button" aria-pressed={view==='reservations'} onClick={()=>setView('reservations')}>Reservations</button></nav>{calendar.error&&<p role="alert">{calendar.error}</p>}{calendar.scheduleError&&<p role="alert">{calendar.scheduleError}</p>}{view==='day'&&<>{calendar.data.events.filter(e=>e.date===date).map(e=><article className="calendar-highlight" key={e.id} style={calendarLook(e.style)}><p className="eyebrow">{e.category}{e.time?' · '+e.time.slice(0,5):''}</p><h3>{e.title}</h3><p className="event-body">{e.body}</p><CalendarFlyers assets={e.media??[]}/></article>)}<CalendarDayPosts location={location} date={date}/></>}{view==='reservations'&&<><h3>Reservations</h3>{loading&&<p role="status">Loading reservations…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!reservations.length&&<p>No reservations for this date.</p>}{reservations.map(r=><article className="calendar-list-row" key={r.id}><strong>{r.name} · {r.party} guests</strong><span>{r.time?.slice(0,5)} · {r.status?.replace(/_/g,' ')}</span>{r.occasion&&<p>{r.occasion}</p>}{r.notes&&<p>{r.notes}</p>}</article>)}</>}<footer className="calendar-popup-footer"><Link to={'/calendar?date='+date+'&view='+ (view==='reservations'?'reservations':'day')} onClick={onClose}>Open full calendar / manage day →</Link></footer></CalendarDialog>
}
