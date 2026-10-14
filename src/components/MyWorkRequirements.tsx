import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { serviceDay } from '../lib/serviceDay'
type Work = {confirmed:boolean;cutoff:string;shifts:{start:string;role:string;closeout_required:boolean}[]}
export function MyWorkRequirements({location}:{location:string}) {
 const [work,setWork]=useState<Work|null>(null)
 const [error,setError]=useState('')
 useEffect(()=>{
  let live=true
  async function load(){
   const r=await supabase.rpc('staff_my_obligations',{p_location_id:location,p_day:serviceDay()})
   if(!live)return
   if(r.error){setError(r.error.message);return}
   setWork(r.data as Work);setError('')
  }
  void load()
  const timer=setInterval(()=>void load(),60000)
  return ()=>{live=false;clearInterval(timer)}
 },[location])
 if(error)return <p role="alert">{error}</p>
 if(!work)return null
 return <article className="task-card"><h3>My required work today</h3>
  {!work.confirmed ? <p>Management has not confirmed today’s schedule. Complete your assigned work and ask your manager to review the roster.</p>
   : work.shifts.length ? <>
    <p>You are scheduled today. Complete every published quiz and every assigned task list.</p>
    {work.shifts.filter(s=>s.closeout_required).map((s,i)=><p key={s.start+String(i)}>Closeout required: {s.role} shift starting {new Date(s.start).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})}. Use that scheduled start time on your closeout.</p>)}
    <p>Quiz and closeout deadline: {new Date(work.cutoff).toLocaleString('en-US',{timeZone:'America/Chicago'})}.</p>
   </> : <p>You are not on today’s confirmed schedule. Daily quizzes and shift closeouts are not required; any task lists explicitly assigned to you remain required.</p>}
 </article>
}
