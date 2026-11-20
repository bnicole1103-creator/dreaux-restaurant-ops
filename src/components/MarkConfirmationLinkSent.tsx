import {useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {notifyReservationsChanged} from '../lib/reservationSync'

export function MarkConfirmationLinkSent({location,reservationId,link,onSaved}:{
 location:string;reservationId:string;link:string;onSaved?:()=>void
}){
 const [busy,setBusy]=useState(false)
 const [sent,setSent]=useState(false)
 const [error,setError]=useState('')
 const pending=useRef(false)
 async function markSent(){
  if(pending.current||sent)return
  pending.current=true
  setBusy(true)
  setError('')
  try{
   const token=new URLSearchParams(new URL(link).hash.slice(1)).get('token')
   const result=await supabase.rpc('reservation_staff_link_mark_sent',{
    p_location:location,p_id:reservationId,p_token:token,
   }).abortSignal(AbortSignal.timeout(15000))
   if(result.error)throw result.error
   setSent(true)
   onSaved?.()
   notifyReservationsChanged()
  }catch(problem){
   setError(String((problem as Error).message??problem))
  }finally{
   pending.current=false
   setBusy(false)
  }
 }
 return <div>
  {sent?<p role="status">Confirmation link marked as sent.</p>:<>
   <p>After you send the message, record it here.</p>
   <button type="button" disabled={busy} onClick={()=>void markSent()}>{busy?'Saving…':'Mark confirmation link sent'}</button>
  </>}
  {error&&<p role="alert">{error}</p>}
 </div>
}
