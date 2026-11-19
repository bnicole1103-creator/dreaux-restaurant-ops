import { bookingSeating } from '../lib/bookingSeating'
import {useEffect,useRef,useState} from 'react'
import {readConfirmation,createStaffConfirmationLink} from '../lib/confirmationSummary'
import {watchGuestRefresh} from '../lib/guestContact'
import {notifyReservationsChanged} from '../lib/reservationSync'
import {confirmationInvitation,confirmationOrigin,guestConfirmationLabel,type ConfirmationState} from '../lib/reservationConfirmation'
import {ReservationLinkContact} from './ReservationLinkContact'
import {ReservationMessagesButton} from './ReservationMessagesButton'
import {TaskDialog} from './TaskDialog'
import './ReservationConfirmationActions.css'

export function ReservationConfirmationActions({location,reservationId,status,initiallyOpen=false,onClose}:{location:string;reservationId:string;status?:string|null;initiallyOpen?:boolean;onClose?:()=>void}){
 const [audit,setAudit]=useState<ConfirmationState|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[dialog,setDialog]=useState(initiallyOpen),[link,setLink]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[revision,setRevision]=useState(0)
 const host=useRef<HTMLSpanElement>(null),lock=useRef(false),identity=useRef('');identity.current=location+':'+reservationId
 useEffect(()=>{
  let live=true,sequence=0;setAudit(null);setLoaded(false);setError('')
  const refresh=()=>{const ticket=++sequence;void readConfirmation(location,reservationId).then(value=>{if(live&&sequence===ticket){setAudit(value);if(!value?.valid)setLink('');setLoaded(true);setError('')}}).catch(e=>{if(live&&sequence===ticket){setAudit(null);setLoaded(false);setError(e.message)}})}
  refresh();const stop=watchGuestRefresh(()=>{if(host.current?.getClientRects().length)refresh()},location);return()=>{live=false;sequence++;stop()}
 },[location,reservationId,revision])
 useEffect(()=>{setLink('');setDialog(initiallyOpen);setActionError('')},[location,reservationId,initiallyOpen])
 const [seating,setSeating]=useState('')
 const active=!['cancelled','canceled','removed','expired','no_show','completed','departed','seated'].includes((status??'').toLowerCase())
 async function generate(){
  if(lock.current)return
  lock.current=true;setBusy(true);setActionError('');setDialog(true)
  const key=identity.current
  try{
   {const r=await createStaffConfirmationLink(reservationId);if(r.error)throw Error(r.error.message);if(!r.data?.token)throw Error('Confirmation link was not returned.');const area=await bookingSeating(location,reservationId).catch(()=>'');if(identity.current!==key)return;setSeating(area);setLink(confirmationOrigin+'/reservation-confirmation#token='+r.data.token);setRevision(v=>v+1);notifyReservationsChanged()}
  }catch(e){if(identity.current===key)setActionError(String((e as Error).message??e))}finally{lock.current=false;if(identity.current===key)setBusy(false)}
 }
 return <span ref={host} className="reservation-confirmation-actions">
  <strong role="status" className={loaded&&guestConfirmationLabel(audit)==='Confirmed'?'guest-confirmed':'guest-unconfirmed'}>Guest confirmation: {error?'Unavailable':loaded?guestConfirmationLabel(audit):'Loading…'}</strong>
  {error&&<span role="alert">{error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Retry confirmation status</button></span>}
  {active&&<span className="reservation-confirmation-buttons"><button type="button" disabled={busy} onClick={()=>{setActionError('');setDialog(true)}}>Resend confirmation link</button><button type="button" disabled={busy} onClick={()=>{setActionError('');setDialog(true)}}>Open Messages</button></span>}
  {dialog&&<TaskDialog title="Generate confirmation link" busy={busy} onClose={()=>{setDialog(false);onClose?.()}}>
   <ReservationLinkContact location={location} reservationId={reservationId}/>
   <p>Generate the confirmation link, then open Messages with the guest’s phone number and invitation filled in.</p>
   {(audit?.expires_at||audit?.responded_at)&&<p role="note">Generating a replacement link will stop the previous link from working. The guest will need to confirm again.</p>}
   <button type="button" disabled={busy||!loaded} onClick={()=>void generate()}>{busy?'Generating…':link?'Generate replacement link':'Generate link'}</button>
   {!loaded&&<p role="status">{error||'Loading confirmation status…'}{error&&<button type="button" onClick={()=>setRevision(v=>v+1)}>Retry</button>}</p>}
   {busy&&<p role="status">Preparing confirmation link…</p>}{actionError&&<p role="alert">{actionError}</p>}
   {!busy&&!actionError&&link&&<><ReservationMessagesButton key={link} location={location} reservationId={reservationId} message={confirmationInvitation(link,seating)}/><label>Confirmation message<textarea readOnly rows={6} value={confirmationInvitation(link,seating)}/></label><p>Review the message and press Send in Messages. Opening a draft does not mark it sent or confirmed.</p></>}
  </TaskDialog>}
 </span>
}
