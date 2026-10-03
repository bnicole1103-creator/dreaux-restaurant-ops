import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { applyAppearance,clearAppearance,defaultAppearance } from '../lib/appearance'
import '../pages/Appearance.css'
export function AppAppearance(){
 useEffect(()=>{let live=true;let loc='';let busy=false
 const refresh=async()=>{if(!loc || busy || document.visibilityState==='hidden')return;busy=true;try{const r=await supabase.rpc('app_appearance_get',{p_location_id:loc});if(!r.error && live)applyAppearance({...defaultAppearance,...r.data.config})}finally{busy=false}}
 void loadTenantData().then(t=>{if(!live)return;loc=t.locations[0]?.id ?? '';void refresh()}).catch(()=>{})
 const timer=setInterval(()=>void refresh(),60000);const focus=()=>void refresh();window.addEventListener('focus',focus);window.addEventListener('app-appearance-changed',focus);document.addEventListener('visibilitychange',focus)
 return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('app-appearance-changed',focus);document.removeEventListener('visibilitychange',focus);clearAppearance()}
 },[])
 return null
}
