import {time12} from '../lib/time12'
import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {usePolicyContact} from './ReservationPrivacy'
type GuestBooking={
 guest_name?:string
 date:string
 time:string
 guests:number
 booking_confirmed:boolean
 policy_accepted:boolean
 house_rules:null|{id:string;title:string;body:string}
}
const readToken=()=>new URLSearchParams(window.location.hash.slice(1)).get('token')??''
export function ReservationGuestConfirmation(){
 const [token,setToken]=useState(readToken),[booking,setBooking]=useState<GuestBooking|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const {contact,error:contactError}=usePolicyContact();const sequence=useRef(0),lock=useRef(false)
 useEffect(()=>{const change=()=>{sequence.current++;lock.current=false;setBusy(false);setToken(readToken());setBooking(null);setError('')};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[])
 useEffect(()=>{const ref=document.createElement('meta');ref.name='referrer';ref.content='no-referrer';document.head.append(ref);const ticket=++sequence.current;setBooking(null);if(!token){setError('This link is missing its private reservation code. Ask JusTini’s for a new link.');return()=>{sequence.current++;ref.remove()}}void Promise.resolve(supabase.rpc('reservation_guest_link_load',{p_token:token}).abortSignal(AbortSignal.timeout(15000))).then(r=>{if(ticket!==sequence.current)return;if(r.error)setError(r.error.message);else{setBooking(r.data);setError('')}}).catch(e=>{if(ticket===sequence.current)setError(String(e?.message??'Could not load this reservation. Reopen your link.'))});return()=>{sequence.current++;ref.remove()}},[token])
 async function submit(){
  if(lock.current)return
  if(!booking?.house_rules||(booking.booking_confirmed&&booking.policy_accepted))return
  lock.current=true;const ticket=sequence.current;setBusy(true);setError('')
  try{if(contact?.version!=='2026-11-06-reservation-sms-v2')throw Error('The restaurant needs to update online confirmation. Contact JusTini’s directly.');const r=await supabase.rpc('reservation_guest_link_respond_v3',{p_token:token,p_booking:true,p_accept_rules:true,p_policy_id:booking.house_rules.id,p_sms:false,p_email:false,p_version:contact.version}).abortSignal(AbortSignal.timeout(20000));if(ticket!==sequence.current)return;if(r.error)throw r.error;setBooking(r.data)}catch(e){if(ticket===sequence.current)setError(String((e as Error).message??e))}finally{if(ticket===sequence.current){lock.current=false;setBusy(false)}}
 }
 const ready=!!booking?.house_rules&&contact?.ready&&contact.version==='2026-11-06-reservation-sms-v2'
 const confirmed=booking?.policy_accepted&&booking?.booking_confirmed
 return <main className="page" style={{maxWidth:760,margin:'24px auto',padding:24}}>
  <h1>Confirm your JusTini’s reservation</h1>
  {(error||contactError)&&<p role="alert">{error||contactError}</p>}
  {booking ? <>
   {booking.guest_name&&<p><strong>{booking.guest_name}</strong></p>}
   <p>{booking.date} at {time12(booking.time)} Central · {booking.guests} {booking.guests===1?'guest':'guests'}</p>
   {confirmed ? <p role="status"><strong>Your reservation is confirmed.</strong></p> : <>
    {booking.house_rules&&<details>
     <summary>{booking.house_rules.title}</summary>
     <div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{booking.house_rules.body}</div>
    </details>}
    <p>By confirming, you agree to the house rules above.</p>
    <button type="button" className="primary-button" disabled={busy||!ready} onClick={()=>void submit()}>
     {busy?'Confirming…':'Confirm reservation'}
    </button>
    {!ready&&<p role="alert">Ask JusTini’s for a fresh confirmation link.</p>}
   </>}
  </> : !error&&<p role="status">Loading your reservation…</p>}
  {contact?.ready&&<p>Questions or changes? <a href={'mailto:'+contact.email}>{contact.email}</a> · {contact.phone}</p>}
  <p><a href="/privacy">Privacy Policy & Messaging Terms</a></p>
 </main>
}
