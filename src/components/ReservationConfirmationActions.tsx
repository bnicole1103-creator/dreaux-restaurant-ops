import {MarkConfirmationLinkSent} from './MarkConfirmationLinkSent'
import {useEffect,useRef,useState} from 'react'
import {readConfirmation,createStaffConfirmationLink} from '../lib/confirmationSummary'
import {watchGuestRefresh} from '../lib/guestContact'
import {notifyReservationsChanged} from '../lib/reservationSync'
import {confirmationInvitation,confirmationOrigin,confirmationWorkflowLabel,guestConfirmationLabel,type ConfirmationState} from '../lib/reservationConfirmation'
import {ReservationLinkContact} from './ReservationLinkContact'
import {ReservationMessagesButton} from './ReservationMessagesButton'
import {TaskDialog} from './TaskDialog'
import './ReservationConfirmationActions.css'

export function ReservationConfirmationActions({location,reservationId,status,initiallyOpen=false,compact=false,onClose,onOpen}:{onOpen?:()=>void;location:string;reservationId:string;status?:string|null;initiallyOpen?:boolean;compact?:boolean;onClose?:()=>void}){
 const [audit,setAudit]=useState<ConfirmationState|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[dialog,setDialog]=useState(initiallyOpen),[link,setLink]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[revision,setRevision]=useState(0)
 const host=useRef<HTMLElement|null>(null),lock=useRef(false),identity=useRef('');identity.current=location+':'+reservationId
 useEffect(()=>{
  let live=true,sequence=0;setAudit(null);setLoaded(false);setError('')
  const refresh=()=>{const ticket=++sequence;void readConfirmation(location,reservationId).then(value=>{if(live&&sequence===ticket){setAudit(value);if(!value?.valid)setLink('');setLoaded(true);setError('')}}).catch(e=>{if(live&&sequence===ticket){setAudit(null);setLoaded(false);setError(e.message)}})}
  refresh();const stop=watchGuestRefresh(()=>{if(host.current?.getClientRects().length)refresh()},location);return()=>{live=false;sequence++;stop()}
 },[location,reservationId,revision])
 useEffect(()=>{setLink('');setDialog(initiallyOpen);setActionError('')},[location,reservationId,initiallyOpen])
 const active=!['cancelled','canceled','removed','expired','no_show','completed','departed','seated'].includes((status??'').toLowerCase())
 function openDialog(){
  setActionError('')
  if(onOpen)onOpen()
  else setDialog(true)
 }
 async function generate(){
  if(lock.current)return
  lock.current=true;setBusy(true);setActionError('');setDialog(true)
  const key=identity.current
  try{
   {const r=await createStaffConfirmationLink(reservationId);if(r.error)throw Error(r.error.message);if(!r.data?.token)throw Error('Confirmation link was not returned.');if(identity.current!==key)return;setLink(confirmationOrigin+'/reservation-confirmation#token='+r.data.token);setRevision(v=>v+1);notifyReservationsChanged()}
  }catch(e){if(identity.current===key)setActionError(String((e as Error).message??e))}finally{lock.current=false;if(identity.current===key)setBusy(false)}
 }
 const confirmationLabel=error?'Unavailable':loaded?(active||guestConfirmationLabel(audit)==='Confirmed'?confirmationWorkflowLabel(audit):'Not confirmed'):'Loading…'
 const confirmationControls=<>
  {error&&<span role="alert">{error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Retry confirmation status</button></span>}
  {active&&!initiallyOpen&&audit?.confirmation_open!==false&&<span className="reservation-confirmation-buttons"><button type="button" disabled={busy} onClick={openDialog}>{audit?.link_sent_at?'Resend confirmation link':'Send confirmation link'}</button><button type="button" disabled={busy} onClick={openDialog}>Open Messages</button></span>}
  {active&&!initiallyOpen&&audit?.link_id&&!audit.link_sent_at&&guestConfirmationLabel(audit)!=='Confirmed'&&
   <MarkConfirmationLinkSent key={audit.link_id} location={location} reservationId={reservationId} linkId={audit.link_id}
    onSaved={sentAt=>{setAudit(previous=>previous?{...previous,link_sent_at:sentAt}:previous);setRevision(v=>v+1)}}/>}
 </>
 const Container=compact?'div':'span'
 return <Container ref={node=>{host.current=node}} className={compact?'reservation-confirmation-actions floor-compact-confirmation':'reservation-confirmation-actions'}>
  {compact ? <details><summary aria-label={'Guest confirmation: '+confirmationLabel}>{confirmationLabel==='Needs confirmation link sent'?'Link needed':confirmationLabel}</summary>{confirmationControls}</details>
    : <><strong role="status" className={loaded&&guestConfirmationLabel(audit)==='Confirmed'?'guest-confirmed':'guest-unconfirmed'}>Guest confirmation: {confirmationLabel}</strong>{confirmationControls}</>}
  {dialog&&<TaskDialog title="Generate confirmation link" busy={busy} onClose={()=>{setDialog(false);onClose?.()}}>
   <ReservationLinkContact location={location} reservationId={reservationId}/>
   <p>Generate a link to open a prefilled message.</p>
   {!link&&audit?.link_id&&!audit.link_sent_at&&guestConfirmationLabel(audit)!=='Confirmed'&&
    <MarkConfirmationLinkSent key={audit.link_id} location={location} reservationId={reservationId} linkId={audit.link_id} onSaved={()=>setRevision(v=>v+1)}/>}
   {(audit?.expires_at||audit?.responded_at)&&<p role="note">Generating a replacement link will stop the previous link from working. The guest will need to confirm again.</p>}
   <button type="button" disabled={busy||!loaded||audit?.confirmation_open===false} onClick={()=>void generate()}>{busy?'Generating…':link?'Generate replacement link':'Generate link'}</button>
   {!loaded&&<p role="status">{error||'Loading confirmation status…'}{error&&<button type="button" onClick={()=>setRevision(v=>v+1)}>Retry</button>}</p>}
   {busy&&<p role="status">Preparing confirmation link…</p>}{actionError&&<p role="alert">{actionError}</p>}
   {!busy&&!actionError&&link&&<><ReservationMessagesButton key={link} location={location} reservationId={reservationId} message={confirmationInvitation(link)}/><label>Confirmation message<textarea readOnly rows={6} value={confirmationInvitation(link)}/></label><MarkConfirmationLinkSent key={link} location={location} reservationId={reservationId} link={link} onSaved={()=>setRevision(v=>v+1)}/></>}
  </TaskDialog>}
 </Container>
}
