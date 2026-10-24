import {useEffect,useRef,useState} from 'react'
import type {VideoHTMLAttributes} from 'react'
import {supabase} from '../lib/supabase'
import {VideoWatchClock,watchTime} from '../lib/videoWatchClock'
import './VideoAnalytics.css'
type Source='sales'|'crew'
type Session={id:string;name:string;started_at:string;last_seen_at:string;watched_seconds:number;duration_seconds:number|null;position_seconds:number}
type Report={viewers:number;sessions:number;watched_seconds:number;rows:Session[]}
export function TrackedVideo({source,path,...props}:VideoHTMLAttributes<HTMLVideoElement>&{source:Source;path:string}){
 const preview=['wording-preview','staff-layout-edit','staff-preview'].some(key=>new URLSearchParams(window.location.search).has(key))
 const video=useRef<HTMLVideoElement>(null),[trackingError,setTrackingError]=useState(false),[canReport,setCanReport]=useState(false),[open,setOpen]=useState(false)
 const [report,setReport]=useState<Report|null>(null),[reportError,setReportError]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0)
 useEffect(()=>{if(preview)return;let active=true;setCanReport(false);setOpen(false);setReport(null)
  void supabase.rpc('video_watch_info',{p_source:source,p_path:path}).then(r=>{if(active&&!r.error)setCanReport(r.data.can_report===true)})
  return()=>{active=false}
 },[source,path,preview])
 useEffect(()=>{
  if(preview)return
  const node=video.current;if(!node)return;const element:HTMLVideoElement=node
  let live=true,visible=false,playing=false,started=false,pending=false,sequence=0,lastSent=0
  const session=crypto.randomUUID(),clock=new VideoWatchClock()
  let queue=Promise.resolve()
  const eligible=()=>playing&&!document.hidden&&visible&&!element.paused&&!element.ended&&!element.seeking
  const sample=()=>clock.sample(performance.now(),element.currentTime,eligible(),element.playbackRate,element.seeking)
  function send(force=false){sample();if(!started||(!force&&clock.total-lastSent<8))return
   const total=clock.total;lastSent=total;const seq=++sequence
   const payload={p_session:session,p_source:source,p_path:path,p_sequence:seq,p_total:total,p_playing:eligible(),p_position:Math.max(0,Number.isFinite(element.currentTime)?element.currentTime:0),p_duration:Number.isFinite(element.duration)&&element.duration>0?element.duration:null}
   queue=queue.then(async()=>{try{const r=await supabase.rpc('video_watch_record',payload).abortSignal(AbortSignal.timeout(15000));if(r.error)throw r.error;if(live)setTrackingError(false)}catch{pending=true;if(live)setTrackingError(true)}})
  }
  const begin=()=>{playing=true;sample();if(!started){started=true;send(true)}}
  const stop=()=>{sample();playing=false;sample();send(true)}
  const wait=()=>{sample();playing=false;sample();send(true)}
  const seek=()=>{sample();send(true)}
  const seeked=()=>{playing=!element.paused&&!element.ended;sample()}
  const rate=()=>sample()
  const visibility=()=>{sample();send(true)}
  const observer=new IntersectionObserver(entries=>{sample();visible=entries[0]?.isIntersecting===true&&entries[0].intersectionRatio>=.25;sample();if(started)send(true)},{threshold:[0,.25]})
  observer.observe(element)
  element.addEventListener('playing',begin);element.addEventListener('pause',stop);element.addEventListener('ended',stop);element.addEventListener('waiting',wait);element.addEventListener('seeking',seek);element.addEventListener('seeked',seeked);element.addEventListener('ratechange',rate)
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',visibility)
  const timer=setInterval(()=>{sample();if(pending){pending=false;send(true)}else send()},1000)
  return()=>{sample();playing=false;send(true);live=false;clearInterval(timer);observer.disconnect();element.removeEventListener('playing',begin);element.removeEventListener('pause',stop);element.removeEventListener('ended',stop);element.removeEventListener('waiting',wait);element.removeEventListener('seeking',seek);element.removeEventListener('seeked',seeked);element.removeEventListener('ratechange',rate);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',visibility)}
 },[source,path,preview])
 useEffect(()=>{if(!open)return;let active=true;setLoading(true);setReportError('')
  void (async()=>{try{const r=await supabase.rpc('video_watch_report',{p_source:source,p_path:path});if(r.error)throw r.error;if(active)setReport(r.data)}catch(e){if(active)setReportError(String((e as {message?:string}).message||'Unable to load viewing analytics.'))}finally{if(active)setLoading(false)}})()
  return()=>{active=false}
 },[open,refresh,source,path])
 const dateTime=(s:string)=>new Date(s).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'})
 return <div className="tracked-video"><video {...props} ref={video}/>
  <small className="video-watch-note">In-app playback time is recorded for management. External video links are not tracked.</small>
  {trackingError&&<p className="video-watch-note" role="status">Playback analytics could not sync. Recorded time may be incomplete.</p>}
  {canReport&&<div className="video-analytics"><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?'Hide viewing analytics':'Viewing analytics'}</button>
   {open&&<section aria-label="Video viewing analytics"><div className="video-analytics-heading"><h5>Video viewing analytics</h5><button type="button" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>Refresh analytics</button></div>
    {loading&&<p role="status">Loading viewing analytics…</p>}{reportError&&<p role="alert">{reportError}</p>}
    {report&&!reportError&&<><p>{report.viewers} viewers · {report.sessions} viewing sessions · {watchTime(report.watched_seconds)} recorded playback</p>
     <p className="video-watch-note">Latest 200 sessions shown; totals include all sessions. New tracking starts after installation. Paused, seeking, buffered and hidden playback are excluded. Times shown in New Orleans time.</p>
     {!report.rows.length?<p>No recorded views yet.</p>:<ul className="video-watch-rows">{report.rows.map(row=><li key={row.id}><strong>{row.name}</strong><dl><div><dt>Started</dt><dd>{dateTime(row.started_at)}</dd></div><div><dt>Last activity</dt><dd>{dateTime(row.last_seen_at)}</dd></div><div><dt>Recorded playback</dt><dd>{watchTime(row.watched_seconds)}</dd></div></dl></li>)}</ul>}
    </>}
   </section>}
  </div>}
 </div>
}
