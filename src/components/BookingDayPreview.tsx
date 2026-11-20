import { seatingArea, type SeatingPreference } from '../lib/reservationSeating'
import {ReservationPlanReview} from './ReservationPlanReview'
import {replanReservations} from '../lib/reservationPlanning'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {useReservationRevision} from '../lib/reservationSync'
import {arrivalChoices} from '../lib/arrivalChoices'
import {capacityClock,type CapacityData,type CapacityBooking} from '../lib/reservationCapacity'
export function BookingDayPreview({location,day,party,room,time,onTime,tableIds=[],manualRefresh=false,seating}:{manualRefresh?:boolean;seating?:SeatingPreference;tableIds?:string[];location:string;day:string;party:number;room:string;time:string;onTime:(time:string)=>void}){
 const [snapshot,setSnapshot]=useState<{key:string;data:CapacityData}|null>(null)
 const [refresh,setRefresh]=useState({key:'',loading:false,error:''})
 const [manualRevision,setManualRevision]=useState(0)
 const revision=useReservationRevision(location,!manualRefresh)
 const key=location+':'+day
 const data=snapshot?.key===key?snapshot.data:null
 const {loading,error}=refresh.key===key?refresh:{loading:!!day&&!!location,error:''}
 useEffect(()=>{
  if(!day||!location)return
  const controller=new AbortController()
  setRefresh(previous=>({key,loading:true,error:previous.key===key?previous.error:''}))
  void Promise.resolve(supabase.rpc('reservation_capacity_load',{p_location_id:location,p_day:day})
   .abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])))
   .then(result=>{if(controller.signal.aborted)return;if(result.error)throw result.error;setSnapshot({key,data:result.data});setRefresh({key,loading:false,error:''})})
   .catch(e=>{if(!controller.signal.aborted)setRefresh({key,loading:false,error:String(e.message??e)})})
  return()=>controller.abort()
 },[location,day,key,revision,manualRevision])
 const start=data?.slots.find(s=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.value*60000))===time.slice(0,5))?.value
 const candidate:CapacityBooking|null=data&&start!=null&&party>0?{id:'candidate',name:'New reservation',party,start,end:start+data.config.duration,tableIds,room,version:0,seating}:null
 const reviewed=data&&candidate?replanReservations(data,candidate):null
 const baseline=data?replanReservations(data):null
 const options=data&&data.configured&&!data.config.closed&&party>0&&baseline?.ok?arrivalChoices(data,party,room,data.config.duration,time||data.config.open,seating):[]
 return <section aria-label="Selected day reservations and availability"><h3>Reservations & availability · {day||'Choose a date'}</h3>{manualRefresh&&day&&<button type="button" disabled={loading} onClick={()=>setManualRevision(value=>value+1)}>{loading?'Checking availability…':'Refresh availability'}</button>}{!manualRefresh&&loading&&!data&&<p role="status">Checking this day…</p>}{error&&<p role="alert">Day list unavailable: {error}</p>}{data&&<><p>Service: {capacityClock(data.open)} – {capacityClock(data.close)}. Last arrival: {capacityClock(data.close-15)}.</p>{seating&&reviewed?.ok&&<p>Available seating: {seatingArea(data.tables.filter(t=>reviewed.assignments.candidate?.includes(t.id)))}</p>}{candidate&&reviewed&&<ReservationPlanReview data={data} candidate={candidate} plan={reviewed}/>}
{!baseline?.ok&&<p role="alert">Existing bookings need review before availability can be verified: {baseline?.reason}</p>}{options.length>0?<><p>Nearest verified times and suggested tables:</p>{options.map(s=>{const start=s.value;const p=replanReservations(data,{id:'candidate',name:'New reservation',party,start,end:start+data.config.duration,tableIds:[],room,version:0,seating});return <button key={s.value} type="button" onClick={()=>onTime(s.time)}>{s.label}{seating&&s.area?' · '+s.area:''} · {(p.assignments.candidate??[]).map(id=>data.tables.find(t=>t.id===id)?.name).join(' + ')}</button>})}</>:<p>{party<1?'Enter the party size to see fitting times and tables.':data.config.closed?'This service day is closed.':!data.configured?'Save recurring service settings first.':'No verified alternatives found for this party and room. Review the list below or another date.'}</p>}<details open><summary>Day list · {data.bookings.length} loaded parties</summary>{!data.bookings.length&&<p>No active bookings or seated parties loaded for this service window.</p>}{[...data.bookings].sort((a,b)=>(a.start??0)-(b.start??0)).map(b=><p key={b.id}><strong>{b.name} · {b.party} guests · {data.day} · {b.start==null?'Time missing':capacityClock(b.start)}</strong> · {b.live?'Seated':'Reservation'} · {b.tableIds.map(id=>data.tables.find(t=>t.id===id)?.name??id).join(' + ')||'Tables unassigned'}</p>)}</details><p>Suggestions are checked again when saving. The list includes adjacent-day parties overlapping this service window.</p></>}</section>
}
