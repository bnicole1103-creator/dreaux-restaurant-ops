import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {serviceDay} from '../lib/serviceDay'
import {dateLabel,shiftClock} from '../lib/calendarDates'
import './ProfileNextShift.css'
type Shift={id:string;date:string;start:string;end:string;role:string;station:string;close:boolean;business_decline:boolean;synced_at:string|null}
type Data={shift:Shift|null;linked:boolean;has_saved_schedule:boolean;from:string;to:string}
export function ProfileNextShift({location}:{location:string}){
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[warning,setWarning]=useState(''),[refresh,setRefresh]=useState(0)
 useEffect(()=>{
  let live=true,running=false;const pending=new Set<AbortController>();setData(null);setError('');setWarning('')
  async function read(){const c=new AbortController();pending.add(c);const timer=setTimeout(()=>c.abort(),20000);try{const r=await supabase.rpc('my_next_shift',{p_location_id:location}).abortSignal(c.signal);if(r.error)throw r.error;return r.data as Data}finally{clearTimeout(timer);pending.delete(c)}}
  async function load(){
   if(!location||running)return;running=true;if(live){setBusy(true);setWarning('')}
   try{
    const cached=await read();if(!live)return;setData(cached);setError('')
    const preview=new URLSearchParams(window.location.search)
    if(!preview.has('staff-preview')&&!preview.has('wording-preview')){
     const from=serviceDay(),last=new Date(from+'T12:00:00Z');last.setUTCDate(last.getUTCDate()+30)
     const c=new AbortController();pending.add(c);const timer=setTimeout(()=>c.abort(),25000)
     let sync;try{sync=await supabase.functions.invoke('calendar-schedule',{signal:c.signal,body:{location_id:location,from,to:last.toISOString().slice(0,10)}})}finally{clearTimeout(timer);pending.delete(c)}
     if(!live)return
     setWarning(sync.error||sync.data?.error?'Schedule refresh unavailable. Showing the last saved schedule.':'')
     const latest=await read();if(live)setData(latest)
    }
   }catch(e){if(live)setError(String((e as {message?:string})?.message??'Unable to load your next shift.'))}
   finally{running=false;if(live)setBusy(false)}
  }
  const update=()=>{if(document.visibilityState==='visible')void load()}
  if(location)void load();else setBusy(false)
  const timer=setInterval(update,60000);window.addEventListener('focus',update);window.addEventListener('crew-schedule-changed',update)
  return()=>{live=false;clearInterval(timer);for(const c of pending)c.abort();window.removeEventListener('focus',update);window.removeEventListener('crew-schedule-changed',update)}
 },[location,refresh])
 const shift=data?.shift
 const path='/schedule'+(shift?'?date='+shift.date:'')
 return <div className="profile-next-shift" aria-label="My next shift" aria-busy={busy}>
  <div className="profile-next-shift-heading"><strong>Next shift</strong><Link to={path}>View schedule →</Link></div>
  {shift?<><p className="profile-next-shift-date">{dateLabel(shift.date)}</p><p><time dateTime={shift.start}>{shiftClock(shift.start)}</time> – {shift.close?'Close':shift.business_decline?'Business decline':<time dateTime={shift.end}>{shiftClock(shift.end)}</time>}</p><p className="profile-next-shift-role">{shift.role}{shift.station?' · '+shift.station:''}</p></>:busy?<p role="status">Checking your next shift…</p>:!error&&<p>{!data?.has_saved_schedule?'Your schedule has not synced yet.':!data.linked?'Your schedule account is not linked yet. Ask management to link it.':'No upcoming shift found in the next 31 days.'}</p>}
  {busy&&shift&&<small>Refreshing…</small>}{warning&&<small role="status">{warning}</small>}{error&&<small role="alert">{error}</small>}
  {(error||warning||!shift&&!busy)&&<button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh next shift</button>}
 </div>
}
