import {useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {notifyReservationsChanged} from '../lib/reservationSync'

export function MarkConfirmationLinkSent({location,reservationId,link,linkId,onSaved}:{
 location:string;reservationId:string;link?:string;linkId?:string;onSaved?:(sentAt:string)=>void
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
   const params={p_location:location,p_id:reservationId}
   const result=await (linkId
    ? supabase.rpc('reservation_staff_current_link_mark_sent',{...params,p_link:linkId})
    : supabase.rpc('reservation_staff_link_mark_sent',{...params,p_token:link?new URLSearchParams(new URL(link).hash.slice(1)).get('token'):null})
   ).abortSignal(AbortSignal.timeout(15000))
   if(result.error)throw result.error
   setSent(true)
   onSaved?.(result.data)
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
