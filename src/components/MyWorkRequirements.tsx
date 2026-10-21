import {DesignSection} from './DesignSection'
import {PageWord} from './PageDesign'
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
 return <DesignSection as="article" data-design-block="section.ecb4add8fba363d4cf51" className="task-card"><h3><PageWord id="sectioncopy.ff2ea655044cc365139c">{"My required work today"}</PageWord></h3>
  {!work.confirmed ? <p><PageWord id="sectioncopy.410271501946fb305099">{"Management has not confirmed today’s schedule. Complete your assigned work and ask your manager to review the roster."}</PageWord></p>
   : work.shifts.length ? <>
    <p><PageWord id="sectioncopy.197e2a7acfe35bd4feea">{"You are scheduled today. Complete every published quiz and every assigned task list."}</PageWord></p>
    {work.shifts.filter(s=>s.closeout_required).map((s,i)=><p key={s.start+String(i)}><PageWord id="sectioncopy.4e0dfb5c32d1d5263f3f">{"Closeout required: "}</PageWord>{s.role}<PageWord id="sectioncopy.27ab3eff6c0ad50aae49">{" shift starting "}</PageWord>{new Date(s.start).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})}<PageWord id="sectioncopy.18dcf6241a1f88426744">{". Use that scheduled start time on your closeout."}</PageWord></p>)}
    <p><PageWord id="sectioncopy.2aa4a1d6ce32bf7af95d">{"Quiz and closeout deadline: "}</PageWord>{new Date(work.cutoff).toLocaleString('en-US',{timeZone:'America/Chicago'})}<PageWord id="sectioncopy.f59c5bdae4b6fe629c72">{"."}</PageWord></p>
   </> : <p><PageWord id="sectioncopy.5aa29cb3487693e310a9">{"You are not on today’s confirmed schedule. Daily quizzes and shift closeouts are not required; any task lists explicitly assigned to you remain required."}</PageWord></p>}
 </DesignSection>
}
