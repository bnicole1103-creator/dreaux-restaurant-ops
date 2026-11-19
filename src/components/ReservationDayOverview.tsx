import { useEffect, useMemo, useState } from 'react'
import { capacityClock, planCapacity, type CapacityData } from '../lib/reservationCapacity'
import { inquiryClock, inquiryReservationFields } from '../lib/inquiryReservationFields'
import { inquirySeatingPreference, seatingArea } from '../lib/reservationSeating'
import { supabase } from '../lib/supabase'
import { time12 } from '../lib/time12'
import type { InquiryReservationSource } from './InquiryReservationDialog'
import './ReservationDayOverview.css'

const central = 'America/Chicago'
const slotClock = new Intl.DateTimeFormat('en-GB',{timeZone:central,hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
const serviceDate = new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric'})
const timeFields = [
 ['First time','eventTime','time','firstTime','preferred_time','preferredTime','reservation_time'],
 ['Second time','secondTime','second_preferred_time'],
 ['Third time','thirdTime','third_preferred_time'],
]

function inquiryAvailability(data:CapacityData,inquiry:InquiryReservationSource) {
 const fields=inquiryReservationFields(inquiry)
 if(!data.configured||data.config.closed||!fields.size)return null
 const requested=[...new Set(timeFields.map(keys=>keys.map(key=>inquiryClock(inquiry.details[key])).find(Boolean)).filter((time):time is string=>!!time))]
 const party=Number(fields.size),duration=data.config.duration,seating=inquirySeatingPreference(inquiry.details)
 const slots=data.slots.filter(slot=>slot.value>=data.now&&slot.value+duration+data.config.buffer<=data.close)
 const baseline=planCapacity(data)
 const planAt=(minute:number)=>{
  const plan=planCapacity(data,{id:'candidate',name:'Inquiry',party,start:minute,end:minute+duration,tableIds:[],room:'',version:0,seating})
  const area=plan.ok?seatingArea(data.tables.filter(t=>plan.assignments.candidate?.includes(t.id))):''
  return {area,exhausted:plan.exhausted}
 }
 if(!baseline.ok)return {requested:requested.map(time=>({time,label:'Needs staff review'})),alternatives:[],verified:false}
 const clock=(value:number)=>slotClock.format(new Date(value*60000))
 const requestedChecks=requested.map(time=>{
  const slot=slots.find(s=>clock(s.value)===time)
  if(!slot)return {time,label:'Outside available arrival times'}
  const check=planAt(slot.value)
  return {time,label:check.area || (check.exhausted?'Needs staff review':'No fitting tables')}
 })
 const alternatives:{minute:number;area:string}[]=[]
 const requestedSlot=data.slots.find(slot=>clock(slot.value)===requested[0])?.value
 const candidates=requestedSlot===undefined?slots:[...slots].sort((a,b)=>Math.abs(a.value-requestedSlot)-Math.abs(b.value-requestedSlot)||a.value-b.value)
 for(const slot of candidates){
  if(requested.includes(clock(slot.value)))continue
  const {area}=planAt(slot.value)
  if(area)alternatives.push({minute:slot.value,area})
  if(alternatives.length===3)break
 }
 return {requested:requestedChecks,alternatives,verified:true}
}

export function ReservationDayOverview({data,inquiry}:{data:CapacityData;inquiry?:InquiryReservationSource}) {
 const availability=useMemo(()=>inquiry?inquiryAvailability(data,inquiry):null,[data,inquiry])
 const arrivals=useMemo(()=>{
  const groups=new Map<number|null,typeof data.bookings>()
  const sorted=[...data.bookings].sort((a,b)=>(a.start??Infinity)-(b.start??Infinity)||String(a.name??'').localeCompare(String(b.name??'')))
  for(const booking of sorted){
   const minute=booking.start==null?null:Math.floor(booking.start)
   const at=groups.get(minute)??[]
   at.push(booking)
   groups.set(minute,at)
  }
  return [...groups]
 },[data.bookings])
 const guests=data.bookings.reduce((total,row)=>total+(Number(row.party)||0),0)
 const tables=new Map(data.tables.map(table=>[table.id,table]))
 return <section className="reservation-day-overview" aria-label="Day bookings and availability">
  <h3>{serviceDate.format(new Date(data.day+'T12:00:00Z'))}</h3>
  <p><strong>{data.bookings.length} {data.bookings.length===1?'party':'parties'} · {guests} guests</strong>{data.configured&&!data.config.closed&&<> · {capacityClock(data.open)}–{capacityClock(data.close)} Central</>}</p>
  {!data.configured&&<p role="status">Service settings are needed to verify availability.</p>}
  {data.configured&&data.config.closed&&<p role="status">Closed for reservations.</p>}
  {availability&&<div className="reservation-day-availability">
   {!!availability.requested.length&&<><h4>Requested times</h4><ul>{availability.requested.map(row=><li key={row.time}><strong>{time12(row.time)}</strong> · {row.label}</li>)}</ul></>}
   <h4>{availability.requested.length?'Nearby available times':'Available times'}</h4>
   {availability.alternatives.length?<ul>{availability.alternatives.map(row=><li key={row.minute}><strong>{capacityClock(row.minute)}</strong> · {row.area}</li>)}</ul>
    :<p>{availability.verified?'No other arrival times verified.':'Staff review needed before availability can be verified.'}</p>}
  </div>}
  <h4>Bookings by arrival time</h4>
  {arrivals.length?<ol className="reservation-day-arrivals">{arrivals.map(([minute,bookings])=><li key={minute??'unset'}>
   <div className="reservation-day-time"><strong>{minute===null?'Time pending':capacityClock(minute)}</strong><span>{bookings.reduce((total,row)=>total+(Number(row.party)||0),0)} guests</span></div>
   <ul>{bookings.map(row=>{
    const assigned=row.tableIds.flatMap(id=>tables.get(id)??[])
    const room=assigned[0]?.roomName || row.room
    return <li key={row.id}><strong>{row.name}</strong> · {row.party??'?'} guests{row.live?' · Seated':''}
     <small>{room?room+' · ':''}{assigned.length?assigned.map(table=>table.name).join(', '):'Tables pending'}</small>
    </li>
   })}</ul>
  </li>)}</ol>:<p>No active bookings or seated parties are listed for this service window.</p>}
 </section>
}

export function InquiryDayOverview({location,inquiry}:{location:string;inquiry:InquiryReservationSource}){
 const date=inquiryReservationFields(inquiry).date
 const [data,setData]=useState<CapacityData|null>(null)
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(false)
 const [revision,setRevision]=useState(0)
 useEffect(()=>{
  if(!location||!date)return
  const controller=new AbortController()
  setLoading(true)
  setError('')
  void Promise.resolve(supabase.rpc('reservation_capacity_load',{p_location_id:location,p_day:date})
   .abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]))).then(result=>{
    if(controller.signal.aborted)return
    if(result.error)throw result.error
    if(result.data?.day!==date)throw Error('Availability returned a different date.')
    setData(result.data)
   }).catch(caught=>{
    if(!controller.signal.aborted)setError(String(caught.message??caught))
   }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[location,date,revision])
 if(!date)return <p>Add a requested date to see bookings and availability.</p>
 return <section className="reservation-day-inquiry">
  <div className="reservation-day-heading"><h3>Bookings & availability</h3><button type="button" disabled={loading||!location} onClick={()=>setRevision(value=>value+1)}>{loading?'Checking…':'Refresh availability'}</button></div>
  {error&&<p role="alert">Availability could not refresh. {data?.day===date?'Showing the last loaded day. ':''}{error}</p>}
  {data?.day===date&&<ReservationDayOverview data={data} inquiry={inquiry}/>}
 </section>
}
