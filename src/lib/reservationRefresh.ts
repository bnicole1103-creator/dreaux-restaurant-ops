import {supabase} from './supabase'
type Listener=()=>void
type Group={listeners:Set<Listener>;stop:()=>void;notify:()=>void}
const groups=new Map<string,Group>()
// One realtime channel and fallback clock per mounted location, shared by all readers.
export function watchReservations(location:string,listener:Listener){
 let group=groups.get(location)
 if(!group){
  const listeners=new Set<Listener>();let debounce:ReturnType<typeof setTimeout>|undefined,last=Date.now()
  const notify=()=>{if(document.visibilityState!=='visible'||debounce)return;debounce=setTimeout(()=>{debounce=undefined;last=Date.now();for(const fn of listeners)fn()},100)}
  let channel=location?supabase.channel('reservation-workspace:'+location):null
  if(channel){for(const table of ['reservations','floor_section_plans'])channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'location_id=eq.'+location},notify);channel=channel.subscribe(()=>{})}
  const timer=setInterval(()=>{if(Date.now()-last>=(30000))notify()},15000)
  window.addEventListener('reservations-changed',notify);window.addEventListener('focus',notify);document.addEventListener('visibilitychange',notify)
  group={listeners,notify,stop:()=>{clearInterval(timer);if(debounce)clearTimeout(debounce);window.removeEventListener('reservations-changed',notify);window.removeEventListener('focus',notify);document.removeEventListener('visibilitychange',notify);if(channel)void supabase.removeChannel(channel)}}
  groups.set(location,group)
 }
 group.listeners.add(listener)
 return()=>{group!.listeners.delete(listener);if(!group!.listeners.size){group!.stop();groups.delete(location)}}
}
