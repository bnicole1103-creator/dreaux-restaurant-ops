import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
type Audience = 'off' | 'scheduled' | 'all'
const message = (e: unknown) => String((e as {message?: string})?.message ?? e)
export function PostNotificationControl({location,category,objectId,version,serviceDate}:{location:string;category:'preshift'|'quiz';objectId:string;version:number;serviceDate:string}) {
 const [audience,setAudience]=useState<Audience>('off'),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const request=useRef<string|null>(null)
 useEffect(()=>{let live=true;setLoaded(false);setError('');setNotice('');request.current=null
  void supabase.rpc('push_post_notification_settings',{p_location_id:location,p_category:category,p_object_id:objectId,p_version:version}).then(r=>{
   if(!live)return
   if(r.error){setError(message(r.error));return}
   setAudience(r.data?.audience ?? 'off');setLoaded(true)
  })
  return()=>{live=false}
 },[location,category,objectId,version])
 async function send(){
  if(busy||!loaded)return
  if(audience!=='off'&&!window.confirm(`Send this post’s alert to ${audience==='all'?'all active staff':'staff scheduled for '+serviceDate} who enabled notifications?`))return
  setBusy(true);setError('');setNotice('');request.current??=crypto.randomUUID()
  try{
   const r=await supabase.rpc('push_post_notification_send',{p_location_id:location,p_category:category,p_object_id:objectId,p_version:version,p_audience:audience,p_request_id:request.current})
   if(r.error)throw r.error
   request.current=null
   setNotice(audience==='off'?'No alert for this version. Pending alerts cancelled.':`Alert queued for ${r.data.queued_devices} device(s). ${r.data.queued_devices===0?'No enabled devices match this audience.':r.data.deferred?'Delivery starts on '+serviceDate+'.':'It should arrive within about a minute.'}`)
  }catch(e){setError(message(e))}finally{setBusy(false)}
 }
 return <div className="gm-post-notification" style={{borderTop:'1px solid #c8b59f',marginTop:16,paddingTop:12}}>
  <strong>GM notification</strong><p>Service day: {serviceDate}. Publishing or editing sends no alert until you choose Send.</p>
  <label>Audience <select value={audience} disabled={busy||!loaded} onChange={e=>{setAudience(e.target.value as Audience);request.current=null;setNotice('')}}><option value="off">No alert</option><option value="scheduled">Staff scheduled for this service day</option><option value="all">All active staff</option></select></label>{' '}
  <button type="button" disabled={busy||!loaded} onClick={()=>void send()}>{busy?'Saving…':audience==='off'?'Save no alert':'Send notification'}</button>
  {audience==='scheduled'&&<p>Confirm this date’s roster in Settings first. Off-duty staff will not receive this alert.</p>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </div>
}
