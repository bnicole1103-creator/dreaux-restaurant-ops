import {PartySizeInput} from './PartySizeInput'
import {TimeInput12} from './TimeInput12'
import {useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {notifyReservationsChanged} from '../lib/reservationSync'
import {reservationToday} from './ManualReservation'
import {useAppAccess} from './AppAccess'
type Row={id:string;edit_version:number;guest_name:string;reservation_date:string;reservation_time:string|null;party_size:number;phone:string|null;email:string|null;notes:string|null;status:string}
export function CalendarReservationActions({id,location,date,disabled,onEditing,onSaved}:{id:string;location:string;date:string;disabled:boolean;onEditing:(active:boolean)=>void;onSaved:(message:string)=>void}){
 const access=useAppAccess(),[draft,setDraft]=useState<Row|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false)
 const permitted=access.can('calendar','reservations'),past=date<reservationToday()
 async function open(remove=false){
  if(lock.current||disabled||!permitted||past)return
  lock.current=true;setBusy(true);setError('');onEditing(true)
  let keep=false
  try{
   const r=await supabase.rpc('reservation_future_load',{p_location_id:location,p_day:date});if(r.error)throw r.error
   const row=(r.data??[]).find((x:Row)=>x.id===id) as Row|undefined
   if(!row)throw Error('This reservation changed or was removed. Refresh the calendar and try again.')
   if(remove){if(window.confirm('Remove '+row.guest_name+'’s reservation? It will be cancelled and kept in history.'))await change(row,true)}
   else{setDraft({...row});keep=true}
  }catch(e){setError(String((e as Error).message??e))}finally{lock.current=false;setBusy(false);if(!keep)onEditing(false)}
 }
 async function change(row:Row,remove=false){
  const r=await supabase.rpc('reservation_future_change',{p_location_id:location,p_id:row.id,p_version:row.edit_version,p_remove:remove,p_data:{guest_name:row.guest_name.trim(),reservation_date:row.reservation_date,reservation_time:row.reservation_time||null,party_size:Number(row.party_size),phone:row.phone,email:row.email,notes:row.notes}})
  if(r.error)throw r.error
  setDraft(null);onEditing(false);notifyReservationsChanged();onSaved(remove?'Reservation removed.':'Reservation changes saved.')
 }
 async function save(){if(!draft||lock.current)return;lock.current=true;setBusy(true);setError('');try{await change(draft)}catch(e){setError(String((e as Error).message??e))}finally{lock.current=false;setBusy(false)}}
 if(!permitted)return null
 return <div className="calendar-reservation-actions">{past?<small>Past reservations are kept as history.</small>:draft?<form onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}><legend>Edit reservation</legend><label>Guest name<input required maxLength={200} value={draft.guest_name} onChange={e=>setDraft({...draft,guest_name:e.target.value})}/></label><label>Date<input required type="date" min={reservationToday()} value={draft.reservation_date} onChange={e=>setDraft({...draft,reservation_date:e.target.value})}/></label><label>Time (Central)<TimeInput12 required  value={draft.reservation_time?.slice(0,5)??''} onChange={e=>setDraft({...draft,reservation_time:e.target.value})}/></label><label>Guests<PartySizeInput required type="number" min={1} max={500} step={1} value={draft.party_size} onChange={e=>setDraft({...draft,party_size:Number(e.target.value)})}/></label><label>Phone<input type="tel" maxLength={100} value={draft.phone??''} onChange={e=>setDraft({...draft,phone:e.target.value})}/></label><label>Email<input type="email" maxLength={250} value={draft.email??''} onChange={e=>setDraft({...draft,email:e.target.value})}/></label><label>Notes<textarea rows={3} maxLength={4000} value={draft.notes??''} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label><button type="submit">{busy?'Saving…':'Save changes'}</button><button type="button" onClick={()=>{setDraft(null);setError('');onEditing(false)}}>Cancel editing</button></fieldset></form>:<div className="feed-actions"><button type="button" disabled={busy||disabled} onClick={()=>void open()}>Edit reservation</button><button type="button" disabled={busy||disabled} onClick={()=>void open(true)}>Remove reservation</button></div>}{busy&&!draft&&<p role="status">Loading reservation…</p>}{error&&<p role="alert">{error}</p>}</div>
}
