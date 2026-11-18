import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {watchGuestRefresh} from '../lib/guestContact'
import {notifyReservationsChanged} from '../lib/reservationSync'
import {confirmationInvitation,confirmationOrigin,guestConfirmationLabel,type ConfirmationState} from '../lib/reservationConfirmation'
import {ReservationMessagesButton} from './ReservationMessagesButton'
import {TaskDialog} from './TaskDialog'
import './ReservationConfirmationActions.css'

// Share simultaneous reads when a booking appears in more than one visible list.
const pending=new Map<string,Promise<ConfirmationState|null>>()
function readStatus(id:string){
 const existing=pending.get(id);if(existing)return existing
 const request=Promise.resolve(supabase.rpc('reservation_guest_link_status',{p_id:id}).abortSignal(AbortSignal.timeout(15000))).then(r=>{if(r.error)throw Error(r.error.message);return r.data as ConfirmationState|null}).finally(()=>pending.delete(id))
 pending.set(id,request);return request
}
export function ReservationConfirmationActions({location,reservationId,status}:{location:string;reservationId:string;status?:string|null}){
 const [audit,setAudit]=useState<ConfirmationState|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[dialog,setDialog]=useState(false),[link,setLink]=useState(''),[busy,setBusy]=useState(false),[openMessages,setOpenMessages]=useState(false),[actionError,setActionError]=useState(''),[revision,setRevision]=useState(0)
 const host=useRef<HTMLSpanElement>(null),lock=useRef(false),identity=useRef('');identity.current=location+':'+reservationId
 useEffect(()=>{
  let live=true,sequence=0;setAudit(null);setLoaded(false);setError('')
  const refresh=()=>{const ticket=++sequence;void readStatus(reservationId).then(value=>{if(live&&sequence===ticket){setAudit(value);if(!value?.valid)setLink('');setLoaded(true);setError('')}}).catch(e=>{if(live&&sequence===ticket){setAudit(null);setLoaded(false);setError(e.message)}})}
  refresh();const stop=watchGuestRefresh(()=>{if(host.current?.getClientRects().length)refresh()});return()=>{live=false;sequence++;stop()}
 },[location,reservationId,revision])
 useEffect(()=>{setLink('');setDialog(false);setActionError('')},[location,reservationId])
 const active=!['cancelled','canceled','removed','expired','no_show','completed','departed','seated'].includes((status??'').toLowerCase())
 async function prepare(resend:boolean){
  if(lock.current)return
  if((resend||!link)&&(audit?.expires_at||audit?.responded_at)&&!window.confirm('Generate a replacement confirmation link? The previous link will stop working and the guest will need to confirm again.'))return
  lock.current=true;setBusy(true);setActionError('');setOpenMessages(true);setDialog(true)
  const key=identity.current
  try{
   if(resend||!link){const r=await supabase.rpc('reservation_guest_link_create',{p_id:reservationId});if(r.error)throw Error(r.error.message);if(!r.data?.token)throw Error('Confirmation link was not returned.');if(identity.current!==key)return;setLink(confirmationOrigin+'/reservation-confirmation#token='+r.data.token);setRevision(v=>v+1);notifyReservationsChanged()}
  }catch(e){if(identity.current===key)setActionError(String((e as Error).message??e))}finally{lock.current=false;if(identity.current===key)setBusy(false)}
 }
 return <span ref={host} className="reservation-confirmation-actions">
  <strong role="status" className={loaded&&guestConfirmationLabel(audit)==='Confirmed'?'guest-confirmed':'guest-unconfirmed'}>Guest confirmation: {error?'Unavailable':loaded?guestConfirmationLabel(audit):'Loading…'}</strong>
  {error&&<span role="alert">{error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Retry confirmation status</button></span>}
  {active&&<span className="reservation-confirmation-buttons"><button type="button" disabled={busy||!loaded} onClick={()=>void prepare(true)}>Resend confirmation link</button><button type="button" disabled={busy||!loaded} onClick={()=>void prepare(false)}>Open Messages</button></span>}
  {dialog&&<TaskDialog title="Guest confirmation message" busy={busy} onClose={()=>setDialog(false)}>
   {busy&&<p role="status">Preparing confirmation link…</p>}{actionError&&<p role="alert">{actionError}</p>}
   {!busy&&!actionError&&link&&<><ReservationMessagesButton key={link+String(openMessages)} location={location} reservationId={reservationId} message={confirmationInvitation(link)} autoOpen={openMessages}/><label>Confirmation message<textarea readOnly rows={6} value={confirmationInvitation(link)}/></label><p>Review the message and press Send in Messages. Opening a draft does not mark it sent or confirmed.</p></>}
  </TaskDialog>}
 </span>
}
