import {DesignSection} from '../components/DesignSection'
import {useAppAccess} from '../components/AppAccess'
import {PageWord} from '../components/PageDesign'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
const studio='https://justinis-inquiry-studio.h8w8547sfq.chatgpt.site'
export function InquiryStudioPage(){
 const appAccess=useAppAccess()
 const allowed=appAccess.ready&&appAccess.can('guests','studio')
 const frame=useRef<HTMLIFrameElement>(null),sequence=useRef(0)
 const [error,setError]=useState(''),[connecting,setConnecting]=useState(false),[sent,setSent]=useState(false)
 const connect=useCallback(async()=>{
  const ticket=++sequence.current
  if(!allowed)return
  setConnecting(true);setError('')
  try{
   const [{data,error:sessionError},tenant]=await Promise.all([supabase.auth.getSession(),loadTenantData()])
   if(ticket!==sequence.current)return
   if(sessionError||!data.session)throw Error('Please sign in to the staff app again, then reopen Guest Services → Edit guest forms.')
   const location=tenant.locations[0]?.id
   if(!location)throw Error('No active location found.')
   if(!frame.current?.contentWindow)throw Error('The form editor has not loaded yet. Try Reconnect form editor.')
   frame.current.contentWindow.postMessage({type:'justinis-studio-session',location,token:data.session.access_token,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},studio)
   setSent(true)
  }catch(e){if(ticket===sequence.current){setSent(false);setError(e instanceof Error?e.message:'Could not connect to the form editor.')}}finally{if(ticket===sequence.current)setConnecting(false)}
 },[allowed])
 useEffect(()=>{
  if(!allowed){sequence.current++;setSent(false);return}
  const receive=(e:MessageEvent)=>{if(e.origin===studio&&e.source===frame.current?.contentWindow&&e.data?.type==='justinis-studio-ready')void connect()}
  window.addEventListener('message',receive)
  const {data:listener}=supabase.auth.onAuthStateChange(()=>{window.setTimeout(()=>void connect(),0)})
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void connect()},60000)
  return()=>{sequence.current++;window.removeEventListener('message',receive);listener.subscription.unsubscribe();window.clearInterval(timer)}
 },[allowed,connect])
 return <DesignSection as="section" data-design-block="section.cc9a126508481ea76516" className="page"><p><Link to="/inquiry-inbox"><PageWord id="sectioncopy.9d70d8ab2ae22d185275">{"Back to shared inquiry inbox"}</PageWord></Link></p>
 {!appAccess.ready?<p role="status">Checking form editor access…</p>:!allowed?<p role="alert">Guest form editing is restricted by management.</p>:<>
 <div className="card"><button type="button" disabled={connecting} onClick={()=>void connect()}>{connecting?'Connecting…':'Reconnect form editor'}</button><p role="status">{sent?'Staff sign-in sent to the editor. Wait for its records to load. If the editor still shows a sign-in error, tap Reconnect form editor.':'Loading the form editor and connecting your staff sign-in…'}</p>{error&&<p role="alert">{error}</p>}<p>Use the shared inquiry inbox for guest and host requests. An empty editor list during a connection error does not mean there are no inquiries.</p></div>
 <iframe ref={frame} src={studio+'/admin'} onLoad={()=>void connect()} title="Inquiry Studio management" style={{width:'100%',height:'calc(100dvh - 190px)',minHeight:600,border:0,borderRadius:16}} />
 </>}
 </DesignSection>
}
