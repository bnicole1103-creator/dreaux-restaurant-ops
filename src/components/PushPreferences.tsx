import { ScreenText } from './ScreenText'
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
 const preview=window.parent!==window && new URLSearchParams(window.location.search).has('wording-preview')
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
 return <details className="home-section" data-design-block="copy.PushPreferences.section">
  <summary data-design-block="copy.PushPreferences.title"><ScreenText id="PushPreferences.title">My notifications</ScreenText></summary>
  <p data-design-block="copy.PushPreferences.description"><ScreenText id="PushPreferences.description">Enable or turn off notifications on this device. The GM chooses which posts send an alert and who receives them.</ScreenText></p>
  {!supported()&&<p data-design-block="copy.PushPreferences.install"><ScreenText id="PushPreferences.install">On iPhone or iPad: open the app in Safari → Share → Add to Home Screen. Open the new Home Screen icon, sign in, then enable notifications here.</ScreenText></p>}
  {supported()&&<p data-design-block="copy.PushPreferences.status">{enabled?<ScreenText id="PushPreferences.enabled">Enabled on this device.</ScreenText>:<ScreenText id="PushPreferences.disabled">Not enabled on this device.</ScreenText>}</p>}
  {(supported()||preview)&&<fieldset disabled={busy||!loaded} data-design-block="copy.PushPreferences.controls">
   {preview?<><button type="button"><ScreenText id="PushPreferences.enable">Enable notifications</ScreenText></button><button type="button"><ScreenText id="PushPreferences.disable">Turn off on this device</ScreenText></button></>:<button type="button" onClick={()=>void(enabled?disable():enable())}>{enabled?<ScreenText id="PushPreferences.disable">Turn off on this device</ScreenText>:<ScreenText id="PushPreferences.enable">Enable notifications</ScreenText>}</button>}
   {(enabled||preview)&&access.gm&&<button type="button" onClick={preview?undefined:()=>void test()}><ScreenText id="PushPreferences.test">Send test notification</ScreenText></button>}
  </fieldset>}
  {busy&&<p role="status"><ScreenText id="PushPreferences.working">Working…</ScreenText></p>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert">{error} <button type="button" onClick={()=>void load()}><ScreenText id="PushPreferences.retry">Retry loading settings</ScreenText></button></p>}
 </details>
}
