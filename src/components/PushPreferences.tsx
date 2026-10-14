import { useEffect,useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { useManagementAccess } from './ManagementAccess'
const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window
async function worker(){const registration=await navigator.serviceWorker.register('/push-sw.js',{scope:'/'});await navigator.serviceWorker.ready;return registration}
export async function disconnectPush(){
 if(!('serviceWorker' in navigator))return
 const registration=await navigator.serviceWorker.getRegistration('/');const subscription=await registration?.pushManager.getSubscription();
 if(subscription){try{await supabase.rpc('push_remove_device',{p_endpoint:subscription.endpoint})}finally{await subscription.unsubscribe()}}
 localStorage.removeItem('justinis-push-owner')
}
export function PushPreferences(){
 const access=useManagementAccess()
 const [location,setLocation]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 async function load(){setError('');setLoaded(false);try{const tenant=await loadTenantData(),loc=tenant.locations[0]?.id;if(!loc)throw Error('No active location found.');setLocation(loc);const r=await supabase.rpc('push_preferences',{p_location_id:loc});if(r.error)throw r.error;if(supported()){const reg=await navigator.serviceWorker.getRegistration('/');setEnabled(!!(await reg?.pushManager.getSubscription()))}setLoaded(true)}catch(e){setError(String((e as {message?:string}).message??e))}}
 useEffect(()=>{void load()},[])
 async function enable(){if(busy||!loaded)return;setBusy(true);setError('');setNotice('');let subscription:PushSubscription|null=null,created=false;try{
  // Request from the user tap, before awaiting network calls (required on iOS).
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications are blocked. Allow them in your device/browser settings.');
  const config=await supabase.functions.invoke('push-dispatch',{body:{action:'config'}});if(config.error)throw config.error;
  const publicKey=config.data?.publicKey;if(!publicKey)throw Error('Notifications are not configured yet.');
  const user=(await supabase.auth.getUser()).data.user;if(!user)throw Error('Sign in again first.');
  const reg=await worker();subscription=await reg.pushManager.getSubscription();
  if(subscription&&localStorage.getItem('justinis-push-owner')!==user.id){await subscription.unsubscribe();subscription=null}
  if(!subscription){const raw=atob(publicKey.replace(/-/g,'+').replace(/_/g,'/'));const key=new Uint8Array([...raw].map(c=>c.charCodeAt(0)));subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});created=true}
  const r=await supabase.rpc('push_register_device',{p_location_id:location,p_subscription:subscription.toJSON()});if(r.error)throw r.error;
  localStorage.setItem('justinis-push-owner',user.id);setEnabled(true);setNotice('Notifications enabled on this device.');
 }catch(e){if(created)await subscription?.unsubscribe();setError(String((e as {message?:string}).message??e))}finally{setBusy(false)}}
 async function disable(){setBusy(true);setError('');setNotice('');try{await disconnectPush();setEnabled(false);setNotice('Notifications turned off on this device.')}catch(e){setError(String((e as {message?:string}).message??e))}finally{setBusy(false)}}
 async function test(){setBusy(true);setError('');setNotice('');try{const reg=await navigator.serviceWorker.getRegistration('/'),sub=await reg?.pushManager.getSubscription();if(!sub)throw Error('Enable notifications first.');const r=await supabase.rpc('push_test',{p_location_id:location,p_endpoint:sub.endpoint});if(r.error)throw r.error;setNotice('Test queued. It should arrive within about a minute.')}catch(e){setError(String((e as {message?:string}).message??e))}finally{setBusy(false)}}
 return <details className="home-section"><summary>My notifications</summary><p>Enable or turn off notifications on this device. The GM chooses which posts send an alert and who receives them.</p>{!supported()&&<p>On iPhone or iPad: open the app in Safari → Share → Add to Home Screen. Open the new Home Screen icon, sign in, then enable notifications here.</p>}{supported()&&<p>{enabled?'Enabled on this device.':'Not enabled on this device.'}</p>}<fieldset disabled={busy||!loaded}>{supported()&&<button type="button" onClick={()=>void(enabled?disable():enable())}>{enabled?'Turn off on this device':'Enable notifications'}</button>}{enabled&&access.gm&&<button type="button" onClick={()=>void test()}>Send test notification</button>}</fieldset>{busy&&<p role="status">Working…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error} <button type="button" onClick={()=>void load()}>Retry loading settings</button></p>}</details>
}
