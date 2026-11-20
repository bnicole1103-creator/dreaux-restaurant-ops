import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {time12} from '../lib/time12'
import {InquiryReservationDialog,type InquiryReservationSource} from './InquiryReservationDialog'
import {ReservationGuestLinks} from './ReservationGuestLinks'
import {TaskDialog} from './TaskDialog'

type Request = Omit<InquiryReservationSource,'notes'> & {
 time: string
 request_kind: 'waitlist' | 'date'
 reservation_id: string | null
}
const key = (row:Request) => row.source+':'+row.id

export function ReservationWaitlist({location,day,revision,onChanged}:{
 location:string;day:string;revision:number;onChanged:()=>void
}){
 const [rows,setRows]=useState<Request[]>([])
 const [error,setError]=useState('')
 const [selected,setSelected]=useState<Request|null>(null)
 const [loading,setLoading]=useState(true)
 const [refresh,setRefresh]=useState(0)

 useEffect(()=>{
  let active=true
  let running=false
  async function load(){
   if(running)return
   running=true
   try{
    const result=await supabase.rpc('inquiry_guest_followup_list',{p_location:location,p_day:day})
     .abortSignal(AbortSignal.timeout(12000))
    if(result.error)throw result.error
    if(active){setRows(result.data??[]);setError('')}
   }catch(problem){if(active)setError((problem as Error).message)}
   finally{running=false;if(active)setLoading(false)}
  }
  void load()
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},30000)
  return()=>{active=false;window.clearInterval(timer)}
 },[location,day,revision,refresh])

 const pending=rows.filter(row=>!row.reservation_id)
 return <details className="reservation-hub-inquiries">
  <summary>Waitlist & date requests · {pending.length} pending</summary>
  <button type="button" onClick={()=>setRefresh(value=>value+1)}>Refresh requests</button>
  {loading&&<p role="status">Loading requests…</p>}
  {error&&<p role="alert">Could not load guest requests. {error}</p>}
  {!loading&&!error&&!rows.length&&<p>No guest requests for this date.</p>}
  <ul>{rows.map(row=><li key={key(row)}>
   <p><strong>{row.name}</strong> · {time12(row.time)} · {row.guests} {row.guests===1?'guest':'guests'} · {row.phone}</p>
   <p>{row.reservation_id?'Booked':row.request_kind==='waitlist'?'On waitlist':'New date requested'}</p>
   <button type="button" onClick={()=>setSelected(row)}>{row.reservation_id?'Open confirmation link tools':'Review & book'}</button>
  </li>)}</ul>
  {selected?.reservation_id&&<TaskDialog title="Guest confirmation" onClose={()=>setSelected(null)}>
   <ReservationGuestLinks location={location} reservationId={selected.reservation_id} opening={selected.request_kind==='waitlist'}/>
  </TaskDialog>}
  {selected&&!selected.reservation_id&&<InquiryReservationDialog
   location={location}
   inquiry={{...selected,notes:'',details:{...selected.details,'First time':selected.time}}}
   opening={selected.request_kind==='waitlist'}
   onClose={()=>setSelected(null)} onSaved={()=>{setRefresh(value=>value+1);onChanged()}}
  />}
 </details>
}
