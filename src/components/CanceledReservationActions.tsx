import {useRef, useState} from 'react'
import {notifyReservationsChanged} from '../lib/reservationSync'
import {supabase} from '../lib/supabase'
import './CanceledReservationActions.css'

export function CanceledReservationActions({location,reservation,disabled}:{
 location:string;reservation:{id:string;edit_version:number;cancellation_cleared_at?:string|null};disabled?:boolean
}){
 const [busy,setBusy]=useState(false),[cleared,setCleared]=useState(false),[error,setError]=useState('')
 const lock=useRef(false)

 async function clear(){
  if(lock.current||disabled||cleared||reservation.cancellation_cleared_at)return
  lock.current=true
  setBusy(true)
  setError('')
  try{
   const {error}=await supabase.rpc('reservation_clear_cancellation',{
    p_location_id:location,p_id:reservation.id,p_version:reservation.edit_version,
   })
   if(error)throw error
   setCleared(true)
   notifyReservationsChanged()
  }catch(e){setError((e as Error).message)}
  finally{lock.current=false;setBusy(false)}
 }

 return <div className="canceled-reservation-actions">
  <strong className="reservation-canceled">Canceled</strong>
  {!(cleared||reservation.cancellation_cleared_at)&&<button type="button" disabled={busy||disabled} onClick={()=>void clear()}>
   {busy?'Clearing…':'Clear reservation'}
  </button>}
  {error&&<p role="alert">{error}</p>}
 </div>
}
