import {useEffect,useState} from 'react'
import {watchReservations} from './reservationRefresh'
export function isCanceledReservation(status?:string|null){
 return ['cancelled','canceled'].includes((status??'').trim().toLowerCase())
}
export function activeReservations<T extends {status?:string|null}>(rows:T[]):T[]{
 return rows.filter(row=>!['cancelled','canceled','seated','completed','no_show','removed','expired'].includes((row.status??'').trim().toLowerCase()))
}
export function notifyReservationsChanged(){window.dispatchEvent(new Event('reservations-changed'))}
// Realtime where enabled, with focus and polling fallback for other devices.
export function useReservationRevision(location:string,enabled=true){
 const [revision,setRevision]=useState(0)
 useEffect(()=>location&&enabled?watchReservations(location,()=>setRevision(v=>v+1)):undefined,[location,enabled])
 return revision
}
