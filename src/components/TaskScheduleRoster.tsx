import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {dateLabel} from '../lib/calendarDates'
import './TaskAssignmentTools.css'
type Shift={id:string;user_id:string|null;name:string;role:string;station?:string;start:string;end:string;close?:boolean;business_decline?:boolean;assigned?:boolean}
type Schedule={rows:Shift[];override:boolean;confirmed_at?:string|null;source_error?:string|null}
const clock=(value:string)=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(date):'Time unavailable'}
const message=(e:unknown)=>String((e as {message?:string})?.message??e)
export function TaskScheduleRoster({location,day,users,activeUsers,disabled,onUsers}:{location:string;day:string;users:string[];activeUsers:string[];disabled:boolean;onUsers:(users:string[])=>void}){
 const [data,setData]=useState<Schedule|null>(null),[loading,setLoading]=useState(true),[syncing,setSyncing]=useState(false),[error,setError]=useState(''),[syncError,setSyncError]=useState(''),[refresh,setRefresh]=useState(0)
 const mounted=useRef(true),syncLock=useRef(false)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{let live=true;const controller=new AbortController();setLoading(true);setData(null);setError('');const timer=setTimeout(()=>controller.abort(),25000)
  void(async()=>{try{const r=await supabase.rpc('crew_schedule_tools_load',{p_location_id:location,p_day:day}).abortSignal(controller.signal);if(r.error)throw r.error;if(live)setData(r.data as Schedule)}catch(e){if(live)setError(message(e)||'Could not load this schedule.')}finally{clearTimeout(timer);if(live)setLoading(false)}})()
  return()=>{live=false;clearTimeout(timer);controller.abort()}
 },[location,day,refresh])
 async function sync(){if(syncLock.current)return;syncLock.current=true;setSyncing(true);setSyncError('');try{const r=await supabase.functions.invoke('crew-schedule',{body:{location_id:location,from:day,to:day}});if(r.error)throw Error('Could not refresh 7shifts. Reload the saved schedule to continue.');if(r.data?.error)throw Error(r.data.error)}catch(e){if(mounted.current)setSyncError(message(e))}finally{syncLock.current=false;if(mounted.current){setSyncing(false);setRefresh(v=>v+1)}}}
 const rows=(data?.rows??[]).filter(r=>r.assigned!==false),scheduled=[...new Set(rows.map(r=>r.user_id).filter((id):id is string=>!!id&&activeUsers.includes(id)))],off=users.filter(id=>!scheduled.includes(id))
 return <section className="task-assignment-tool task-schedule-roster" aria-label="Schedule while assigning tasks"><header><div><h2>Who’s working?</h2><p>{dateLabel(day)} · Central time</p></div><Link to={'/schedule?date='+day}>Open schedule</Link></header>
 <p>{data?.override?'Reviewed app schedule, including saved coverage changes.':'Shared app schedule for the selected service day.'} Refresh 7shifts if you need the latest import.</p>
 <div className="task-assignment-actions"><button type="button" disabled={disabled||loading||syncing} onClick={()=>setRefresh(v=>v+1)}>Reload saved schedule</button><button type="button" disabled={disabled||loading||syncing} onClick={()=>void sync()}>{syncing?'Refreshing 7shifts…':'Refresh 7shifts'}</button><button type="button" disabled={disabled||loading||syncing||!scheduled.length} onClick={()=>onUsers([...new Set([...users,...scheduled])])}>Select scheduled staff</button></div>
 {loading&&<p role="status">Loading this day’s shifts…</p>}{error&&<p role="alert">Schedule unavailable: {error}<button type="button" onClick={()=>setRefresh(v=>v+1)}>Retry schedule</button></p>}{syncError&&<p role="alert">{syncError}</p>}{data?.source_error&&<p role="alert">Schedule source: {data.source_error}</p>}
 {!loading&&data&&!rows.length&&<p>No saved shifts for this date. Check or refresh the schedule; you can still choose active employees below.</p>}
 <div className="task-schedule-shifts">{rows.map((row,i)=>{const linked=!!row.user_id&&activeUsers.includes(row.user_id);return <label key={row.id+':'+i} className={'task-schedule-shift'+(!linked?' task-schedule-unlinked':'')}><input type="checkbox" aria-label={'Assign tasks to '+row.name} disabled={disabled||loading||syncing||!linked} checked={linked&&users.includes(row.user_id!)} onChange={e=>onUsers(e.target.checked?[...new Set([...users,row.user_id!])]:users.filter(id=>id!==row.user_id))}/><span><strong>{row.name}</strong><span>{row.role}{row.station?' · '+row.station:''}</span><span>{clock(row.start)} – {row.close?'Close':row.business_decline?'Business decline':clock(row.end)}</span>{!linked&&<small>Link an active app account to receive tasks.</small>}</span></label>})}</div>
 {data&&!loading&&off.length>0&&<p role="status">{off.length} selected employee(s) have no linked shift shown for this date. Confirm availability before assigning.</p>}
 <p className="task-assignment-hint">Selecting a person here updates the employee selection below. Each selected employee will receive every selected checklist.</p>
 </section>
}
