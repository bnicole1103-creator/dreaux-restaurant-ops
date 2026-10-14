import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
export function PushNotifications({location}:{location:string}){
 useEffect(()=>{if(!document.querySelector('link[rel=manifest]')){const link=document.createElement('link');link.rel='manifest';link.href='/task-notifications.webmanifest';document.head.append(link)};if('serviceWorker' in navigator){void navigator.serviceWorker.getRegistration('/').then(r=>r?.update()).catch(()=>{})}},[])
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 async function enable(){setBusy(true);setNotice('');try{
  if(!('serviceWorker' in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('This browser does not support push here. On iPhone or iPad, add the app to your Home Screen and open it there.');
  const config=await supabase.rpc('staff_push_config',{p_location_id:location});if(config.error)throw config.error;
  if(!config.data?.public_key)throw Error('Push delivery is not configured yet. Ask your GM to finish notification setup.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications are not allowed. Enable them in your browser or device settings.');
  const registration=await navigator.serviceWorker.register('/task-notifications-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
  const text=config.data.public_key as string,bytes=Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(text.length/4)*4,'=')),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes.buffer});
  const saved=await supabase.rpc('staff_push_subscribe',{p_location_id:location,p_subscription:subscription.toJSON()});if(saved.error)throw saved.error;
  setNotice('This device is subscribed. Delivery still depends on the notification service and your device settings.');
 }catch(e){setNotice(String((e as Error).message??e))}finally{setBusy(false)}}
 async function disable(){setBusy(true);try{const registration=await navigator.serviceWorker.getRegistration('/');const sub=await registration?.pushManager.getSubscription();if(sub){const r=await supabase.rpc('staff_push_unsubscribe',{p_endpoint:sub.endpoint});if(r.error)throw r.error;await sub.unsubscribe()}setNotice('Notifications disabled for this device.')}catch(e){setNotice(String((e as Error).message??e))}finally{setBusy(false)}}
 return <article className="task-card"><h2>Push notifications</h2><p>Management chooses which notifications are sent and who receives them. Choose whether this device receives push notifications. On iPhone or iPad, open the app from your Home Screen.</p><button disabled={busy} onClick={()=>void enable()}>Enable push notifications</button><button disabled={busy} onClick={()=>void disable()}>Disable push notifications</button>{notice&&<p role="status">{notice}</p>}</article>
}
