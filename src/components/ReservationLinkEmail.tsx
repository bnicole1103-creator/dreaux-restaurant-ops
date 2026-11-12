import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
type View={destination:string;body:string;configured:boolean;history:null|{status:string;created_at:string;provider_id?:string;destination?:string}}
export function ReservationLinkEmail({reservationId,token,onBusyChange}:{reservationId:string;token:string;onBusyChange?:(busy:boolean)=>void}){
 const [data,setData]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[agreed,setAgreed]=useState(false),[note,setNote]=useState(''),[uncertain,setUncertain]=useState(false)
 const lock=useRef(false),seq=useRef(0)
 useEffect(()=>{seq.current++;lock.current=false;setData(null);setError('');setBusy(false);setAgreed(false);setNote('');setUncertain(false);return()=>{seq.current++}},[reservationId,token])
 async function run(action:'preview'|'send'|'status'){
  if(lock.current)return;lock.current=true;const ticket=seq.current;setBusy(true);onBusyChange?.(true);setError('')
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
   const request=supabase.functions.invoke('reservation-link-email',{body:{action,reservation_id:reservationId,token,agreed,note,preview:data?{destination:data.destination,body:data.body}:null}})
   const result=await Promise.race([request,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Request timed out.')),25000)})])
   if(ticket!==seq.current)return
   if(result.error){let message=result.error.message;const response=(result.error as {context?:Response}).context;if(response)try{message=(await response.json()).error??message}catch{/* preserve invocation error */}throw Error(message)}
   if(!result.data)throw Error('No email result returned.')
   setData(result.data);if(result.data.history)setUncertain(false)
   if(result.data.error)throw Error(result.data.error)
  }catch(e){if(ticket===seq.current){setError(String((e as Error).message??e));if(action==='send')setUncertain(true)}}
  finally{if(timer)clearTimeout(timer);if(ticket===seq.current){setBusy(false);onBusyChange?.(false);lock.current=false}}
 }
 return <section aria-label="Email guest confirmation link"><h4>Send this link from the app</h4><p>Email the link to the guest’s saved reservation email. This requests their confirmation; it does not mark them confirmed or opt them into texts.</p><button type="button" disabled={busy||!reservationId||!token} onClick={()=>void run('preview')}>Preview guest-link email</button><button type="button" disabled={busy||!token} onClick={()=>void run('status')}>Check link-email attempt</button>{busy&&<p role="status">Working…</p>}{error&&<p role="alert">{error}</p>}{uncertain&&<p role="alert">Sending is blocked until the attempt is checked. Do not generate another link to bypass an uncertain result.</p>}{data&&<><p>To: {data.destination}</p><details open><summary>Email preview</summary><p style={{whiteSpace:'pre-wrap'}}>{data.body}</p></details>{!data.configured&&<p role="alert">Email sender needs configuration: RESEND_API_KEY and RESERVATION_EMAIL_FROM in Supabase Secrets.</p>}{data.history?<div role="status"><p>Link-email attempt: <strong>{data.history.status}</strong> · {new Date(data.history.created_at).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:true})} CT</p>{data.history.destination&&<p>Recipient on record: {data.history.destination}</p>}{data.history.provider_id&&<p>Resend reference: {data.history.provider_id}</p>}<p>Accepted means Resend accepted the email; delivery and the guest’s response are separate. Sending, unknown or failed attempts need review before creating another link.</p></div>:<fieldset disabled={busy}><label><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>The guest requested this reservation email at the saved address.</label><label>How was the email requested?<input maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Example: guest asked by phone for the reservation link"/></label><button type="button" disabled={!data.configured||!agreed||note.trim().length<5||uncertain} onClick={()=>void run('send')}>Send guest confirmation link by email</button></fieldset>}</>}</section>
}
