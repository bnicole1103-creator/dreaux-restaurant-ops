import {DesignSection} from '../components/DesignSection'
import {useAppAccess} from '../components/AppAccess'
import {PageWord} from '../components/PageDesign'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
const studio='https://justinis-inquiry-studio.tealguppy.chatgpt.site'
export function InquiryStudioPage(){
 const appAccess=useAppAccess()
 const frame=useRef<HTMLIFrameElement>(null)
 const [error,setError]=useState('')
 useEffect(()=>{
  let live=true
  async function connect(){try{
   const [{data,error:sessionError},tenant]=await Promise.all([supabase.auth.getSession(),loadTenantData()])
   if(!appAccess.can('guests','studio'))throw Error('Guest form editing is restricted by management.');
   if(sessionError||!data.session)throw Error('Please sign in again.')
   const location=tenant.locations[0]?.id
   if(!location)throw Error('No active location found.')
   if(live)frame.current?.contentWindow?.postMessage({type:'justinis-studio-session',location,token:data.session.access_token,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},studio)
  }catch(e){if(live)setError(e instanceof Error?e.message:'Could not connect.') }}
  const receive=(e:MessageEvent)=>{if(e.origin===studio&&e.source===frame.current?.contentWindow&&e.data?.type==='justinis-studio-ready')void connect()}
  window.addEventListener('message',receive)
  const {data:listener}=supabase.auth.onAuthStateChange(()=>{window.setTimeout(()=>{if(live)void connect()},0)})
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void connect()},60000)
  return()=>{live=false;window.removeEventListener('message',receive);listener.subscription.unsubscribe();window.clearInterval(timer)}
 },[appAccess.ready])
 return <DesignSection as="section" data-design-block="section.cc9a126508481ea76516" className="page"><p><Link to="/inquiry-inbox"><PageWord id="sectioncopy.9d70d8ab2ae22d185275">{"Back to shared inquiry inbox"}</PageWord></Link></p>{error&&<p role="alert">{error}</p>}<iframe ref={frame} src={studio+'/admin'} title="Inquiry Studio management" style={{width:'100%',height:'calc(100dvh - 190px)',minHeight:600,border:0,borderRadius:16}} /></DesignSection>
}
