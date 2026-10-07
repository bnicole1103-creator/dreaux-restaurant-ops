import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
let values: Record<string,string> = {}
const listeners = new Set<()=>void>()
const subscribe=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}}
export function setScreenWording(next:Record<string,string>){values=next;listeners.forEach(f=>f())}
export function ScreenText({id,children}:{id:string;children:ReactNode}){
 const text=useSyncExternalStore(subscribe,()=>values[id],()=>undefined)
 return new URLSearchParams(window.location.search).has('wording-preview') ? <span data-wording-id={id}>{text===undefined?children:text}</span> : <>{text===undefined?children:text}</>
}
export function ScreenWordingLoader(){
 const {pathname}=useLocation()
 useEffect(()=>{let live=true,sequence=0
 async function refresh(){const current=++sequence;try{
  const guest=pathname.match(/^\/walk-in\/([0-9a-f-]{36})$/i),feedback=pathname.match(/^\/guest-feedback\/([0-9a-f-]{36})$/i)
  let r
  if(guest)r=await supabase.rpc('screen_wording_public',{p_key:guest[1]})
  else if(feedback)r=await supabase.rpc('screen_wording_feedback',{p_key:feedback[1]})
  else {const {data}=await supabase.auth.getSession();if(!data.session){if(live&&current===sequence)setScreenWording({});return}const tenant=await loadTenantData();if(!tenant.locations[0])return;r=await supabase.rpc('screen_wording_get',{p_location_id:tenant.locations[0].id})}
  if(!r.error&&live&&current===sequence)setScreenWording(r.data||{})
 }catch{/* Original text remains available if the settings cannot load. */}}
 setScreenWording({});void refresh();const timer=setInterval(()=>void refresh(),30000);const focus=()=>void refresh();window.addEventListener('focus',focus)
 const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{sequence++;setScreenWording({});setTimeout(()=>void refresh(),0)})
 return()=>{live=false;sequence++;clearInterval(timer);window.removeEventListener('focus',focus);subscription.unsubscribe()}
 },[pathname])
 return null
}

