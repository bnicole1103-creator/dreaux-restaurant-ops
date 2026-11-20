import {useRef,useState} from 'react'
import {supabase} from '../lib/supabase'

export function AIReservationPostNotes({location,date,disabled,onAdd}:{
 location:string;date:string;disabled:boolean;onAdd:(notes:string)=>void
}){
 const [busy,setBusy]=useState(false),[notes,setNotes]=useState<string|null>(null),[error,setError]=useState('')
 const lock=useRef(false)
 const scope=useRef('')
 scope.current=location+':'+date
 const [resultScope,setResultScope]=useState('')
 async function scan(){
  if(disabled||lock.current)return
  lock.current=true
  const requested=scope.current
  setBusy(true);setError('');setNotes(null)
  try{
   const result=await supabase.functions.invoke('prepare-day-assistant',{body:{mode:'reservations',location_id:location,date},signal:AbortSignal.timeout(55000)})
   if(result.error){
    const detail=await result.error.context?.json().catch(()=>null)
    throw Error(detail?.error||result.error.message)
   }
   if(result.data?.mode!=='reservations'||result.data.service_date!==date||typeof result.data.notes!=='string')
    throw Error('The reservation scan needs the updated Prepare Day assistant.')
   if(scope.current===requested){setNotes(result.data.notes);setResultScope(requested)}
  }catch(problem){if(scope.current===requested)setError((problem as Error).message)}
  finally{setBusy(false);lock.current=false}
 }
 return <section aria-label="AI reservation notes">
  <button type="button" disabled={disabled||busy||!location||!date} onClick={()=>void scan()}>{busy?'Scanning bookings…':'Scan day’s bookings with AI'}</button>
  {error&&<p role="alert">{error}</p>}
  {resultScope===scope.current&&notes!==null&&(notes?<div>
   <label>Review reservation notes<textarea rows={5} value={notes} onChange={event=>setNotes(event.target.value)}/></label>
   <button type="button" disabled={disabled||!notes.trim()} onClick={()=>{
    try{onAdd(notes.trim());setNotes(null);setError('')}catch(problem){setError((problem as Error).message)}
   }}>Add reservation notes to draft</button>
  </div>:<p role="status">No bookings found for this day.</p>)}
 </section>
}
