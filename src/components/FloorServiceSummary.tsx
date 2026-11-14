import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {useReservationRevision} from '../lib/reservationSync'
import {time12} from '../lib/time12'
import './FloorServiceSummary.css'
type Session={id:string;table_id:string;guest_name:string|null;party_size:number;seated_at:string;tableIds:string[]}
type Booking={id:string;guest_name:string;reservation_time:string|null;party_size:number;status:string}
export function FloorServiceSummary({location,day,tables,onShowTables}:{location:string;day:string;tables:{id:string;table_name:string}[];onShowTables:(ids:string[])=>void}){
 const [tab,setTab]=useState<'seated'|'upcoming'>('seated'),[data,setData]=useState<{sessions:Session[];bookings:Booking[];limited:boolean;context:string}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0)
 const revision=useReservationRevision(location),context=location+':'+day
 useEffect(()=>{if(!location||!day)return;let live=true;setLoading(true);setError('');void(async()=>{try{
  const sessions=await supabase.from('table_sessions').select('id,table_id,guest_name,party_size,seated_at').eq('location_id',location).is('closed_at',null).order('seated_at').limit(201).abortSignal(AbortSignal.timeout(15000));if(sessions.error)throw sessions.error
  const rows=(sessions.data??[]).slice(0,200);let links:{table_session_id:string;table_id:string}[]=[]
  if(rows.length){const r=await supabase.from('table_session_tables').select('table_session_id,table_id').in('table_session_id',rows.map(s=>s.id)).abortSignal(AbortSignal.timeout(15000));if(r.error)throw r.error;links=r.data??[]}
  const bookings:Booking[]=[];let more=false
  for(let offset=0;offset<200;offset+=50){const r=await supabase.rpc('reservation_management_list',{p_location:location,p_day:day,p_query:'',p_offset:offset,p_status:'active'}).abortSignal(AbortSignal.timeout(15000));if(r.error)throw r.error;if(!Array.isArray(r.data?.reservations))throw Error('Unexpected upcoming reservation response.');bookings.push(...r.data.reservations);more=r.data.has_more===true;if(!more)break}
  if(live)setData({sessions:rows.map(s=>({...s,tableIds:[...new Set([s.table_id,...links.filter(l=>l.table_session_id===s.id).map(l=>l.table_id)].filter(Boolean))]})),bookings,limited:more||(sessions.data??[]).length>200,context})
 }catch(e){if(live)setError(String((e as Error).message??e))}finally{if(live)setLoading(false)}})();return()=>{live=false}},[location,day,revision,refresh])
 const current=data?.context===context?data:null
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]))
 const today=parts.year+'-'+parts.month+'-'+parts.day,clock=parts.hour+':'+parts.minute
 const upcoming=(current?.bookings??[]).filter(b=>b.reservation_time&&(day>today||day===today&&b.reservation_time.slice(0,5)>=clock))
 const tableNames=(ids:string[])=>ids.map(id=>tables.find(t=>t.id===id)?.table_name??'Table').join(' + ')
 return <details open className="floor-service-summary"><summary>Floor at a glance</summary><div className="floor-service-summary-body"><div className="floor-service-summary-tabs"><button type="button" aria-pressed={tab==='seated'} onClick={()=>setTab('seated')}>Seated {current&&!error?'('+current.sessions.length+')':''}</button><button type="button" aria-pressed={tab==='upcoming'} onClick={()=>setTab('upcoming')}>Upcoming {current&&!error?'('+upcoming.length+')':''}</button></div>{error&&<p role="alert">Summary unavailable: {error}</p>}{loading&&!current&&<p role="status">Loading floor summary…</p>}{current&&!error&&<div className="floor-service-summary-list">{tab==='seated'?<><small>Currently open parties · all shifts at this location</small>{!current.sessions.length&&<p>No currently seated parties.</p>}{current.sessions.map(s=><button type="button" key={s.id} onClick={()=>onShowTables(s.tableIds)}><strong>{tableNames(s.tableIds)} · {s.party_size} guests</strong><span>{s.guest_name||'Walk-in'} · Seated {new Date(s.seated_at).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',hour12:true})}</span></button>)}</>:<><small>Upcoming · {day} · Central time</small>{!upcoming.length&&<p>No upcoming booked or confirmed reservations.</p>}{upcoming.map(b=><Link key={b.id} to={'/reservations?'+new URLSearchParams({date:day,reservation:b.id}).toString()}><strong>{time12(b.reservation_time)} · {b.party_size} guests</strong><span>{b.guest_name}</span></Link>)}{current.bookings.some(b=>!b.reservation_time)&&<p>Some bookings need a time. Review the day list.</p>}</>}</div>}{current?.limited&&<p>Showing a limited summary. Open the full lists for more records.</p>}<footer><Link to={'/reservations?date='+day}>Day reservations ↗</Link><button type="button" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh</button></footer></div></details>
}
