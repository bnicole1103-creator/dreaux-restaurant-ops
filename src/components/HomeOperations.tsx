import './HomeOperations.css'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
type Reservation={id:string;reservation_time:string;guest_name:string;party_size:number;status:string;table_name:string|null;occasion:string|null;is_birthday:boolean;is_vip:boolean}
type Shift={id:string;name:string;role:string;station:string;start:string;end:string;close:boolean;business_decline:boolean}
type Schedule={rows:Shift[];synced_at:string|null;error?:string;configured?:boolean}
export function reservationClock(value:string){const m=/^(\d{1,2}):(\d{2})/.exec(value);if(!m)return value;const h=Number(m[1]);return `${h%12||12}:${m[2]} ${h>=12?'PM':'AM'}`}
const clock=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value))
export function HomeOperations({location,today,refresh}:{location:string;today:string;refresh:number}){
 const [reservations,setReservations]=useState<Reservation[]>([]),[reservationError,setReservationError]=useState(''),[schedule,setSchedule]=useState<Schedule|null>(null),[scheduleError,setScheduleError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{let live=true;setReservations([]);setSchedule(null);setLoading(true)
 void Promise.allSettled([
  supabase.from('reservations').select('id,reservation_time,guest_name,party_size,status,table_name,occasion,is_birthday,is_vip').eq('location_id',location).eq('reservation_date',today).order('reservation_time'),
  supabase.functions.invoke('home-schedule',{body:{location_id:location}})
 ]).then(([r,s])=>{if(!live)return
  if(r.status==='fulfilled'&&!r.value.error){setReservations(r.value.data??[]);setReservationError('')}else setReservationError('Unable to load reservations. '+(r.status==='fulfilled'?r.value.error?.message:String(r.reason)))
  if(s.status==='fulfilled'&&!s.value.error){setSchedule(s.value.data);setScheduleError('')}else setScheduleError('Unable to load 7shifts. The connection may still need setup.')
  setLoading(false)
 });return()=>{live=false}
 },[location,today,refresh])
 return <><section className="home-section home-reservations"><div className="home-section-heading"><h2>Today’s Reservations</h2><Link to="/floor">Floor / Upload →</Link></div>
 {loading&&<p role="status">Loading reservations…</p>}{reservationError&&<p role="alert">{reservationError}</p>}{!loading&&!reservationError&&!reservations.length&&<p>No reservations uploaded for today.</p>}
 {!reservationError&&reservations.length>0&&<details className="home-reservation-disclosure" key={`${location}:${today}`}><summary><strong>{reservations.length} reservations · {reservations.filter(r=>!['cancelled','canceled','no_show'].includes(r.status)).reduce((n,r)=>n+(r.party_size??0),0)} guests expected</strong><span>View list</span></summary>
 <div className="home-reservation-scroll" role="region" aria-label="Today’s reservation list" tabIndex={0}>{reservations.map(r=><details className="home-reservation-row" key={r.id}><summary><time>{reservationClock(r.reservation_time)}</time><strong>{r.guest_name||'Guest'}</strong><span>{r.party_size} guests{r.is_vip?' ⭐':''}{r.is_birthday?' 🎂':''}</span></summary><div className="home-reservation-detail">{r.table_name&&<span>Table {r.table_name} · </span>}<span>{(r.status||'reserved').replace(/_/g,' ')}</span>{(r.is_vip||r.is_birthday||r.occasion)&&<p>{[r.is_vip?'⭐ VIP':'',r.is_birthday?'🎂 Birthday':'',r.occasion].filter(Boolean).join(' · ')}</p>}</div></details>)}</div></details>}
 </section>
 <section className="home-section"><div className="home-section-heading"><h2>Today’s 7shifts Schedule</h2><a href="https://app.7shifts.com" target="_blank" rel="noreferrer">Open 7shifts →</a></div><p className="muted">New Orleans time · Updates automatically while Home is open.</p>{loading&&<p role="status">Loading schedule…</p>}{scheduleError&&<p role="alert">{scheduleError}</p>}{schedule?.configured===false&&<p>The 7shifts connection needs to be configured by your administrator.</p>}{schedule?.error&&<p role="alert">{schedule.error}{schedule.synced_at?' Showing the last successful sync.':''}</p>}{schedule?.synced_at&&<p className="muted">Last synced: {new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(schedule.synced_at))}</p>}{!loading&&schedule?.configured!==false&&schedule&&!schedule.error&&!schedule.rows.length&&<p>No published shifts for today.</p>}<div className="home-operations-list">{schedule?.rows.map(s=><article className="home-post" key={s.id}><strong>{s.name}</strong><p>{s.role}{s.station&&` · ${s.station}`}</p><p>{clock(s.start)} – {s.close?'Close':s.business_decline?'Business decline':clock(s.end)}</p></article>)}</div></section></>
}
