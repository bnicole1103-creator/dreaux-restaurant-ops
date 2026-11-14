import {useEffect,useState} from 'react'
import {supabase} from './supabase'
export function activeReservations<T extends {status?:string|null}>(rows:T[]):T[]{
 return rows.filter(row=>!['cancelled','canceled','seated','completed','no_show','removed','expired'].includes((row.status??'').trim().toLowerCase()))
}
export function notifyReservationsChanged(){window.dispatchEvent(new Event('reservations-changed'))}
// Realtime where enabled, with focus and polling fallback for other devices.
export function useReservationRevision(location:string){
 const [revision,setRevision]=useState(0)
 useEffect(()=>{if(!location)return
  const update=()=>{if(document.visibilityState==='visible')setRevision(v=>v+1)}
  const channel=supabase.channel('reservation-sync:'+location+':'+Math.random()).on('postgres_changes',{event:'*',schema:'public',table:'reservations',filter:'location_id=eq.'+location},update).subscribe()
  window.addEventListener('reservations-changed',update);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update)
  const timer=window.setInterval(update,30000)
  return()=>{window.clearInterval(timer);window.removeEventListener('reservations-changed',update);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);void supabase.removeChannel(channel)}
 },[location])
 return revision
}
