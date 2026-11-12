import {arrivalChoices} from './arrivalChoices'
import {supabase} from './supabase'
import {planCapacity,type CapacityData,type CapacityBooking} from './reservationCapacity'
export class ArrivalOptionsError extends Error{constructor(public options:{time:string;label:string}[],message:string){super(message);this.name='ArrivalOptionsError'}}
export type VerifiedValues={guest_name:string;phone:string;email?:string|null;reservation_date:string;reservation_time:string;party_size:number|null;room_id?:string|null;dining_area?:string|null;[key:string]:unknown}
export async function saveVerifiedReservation(location:string,request:string,values:VerifiedValues,source?:string,inquiry?:string){
 if(!values.guest_name.trim()||!values.phone.trim()||!values.reservation_date||!values.reservation_time||!Number.isInteger(values.party_size)||Number(values.party_size)<1||Number(values.party_size)>500)throw Error('Enter name, phone, date, time and 1–500 guests.')
 const loaded=await supabase.rpc('reservation_capacity_load',{p_location_id:location,p_day:values.reservation_date}).abortSignal(AbortSignal.timeout(15000));if(loaded.error)throw loaded.error;const data=loaded.data as CapacityData
 if(!data.configured)throw Error('No recurring service setup is available for this weekday. Save its weekly settings once in Floor → Capacity & availability. Special dates can use a date exception.');if(data.config.closed)throw Error('This date is closed in the saved service settings. Review its recurring weekday or add a special-date exception before booking.')
 const start=data.slots.find(s=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.value*60000))===values.reservation_time.slice(0,5))?.value
 const duration=data.config.duration
 if(start==null||start<data.now||start>data.close-15){const choices=arrivalChoices(data,Number(values.party_size),values.room_id||values.dining_area||'',duration,values.reservation_time);throw new ArrivalOptionsError(choices.map(s=>({time:s.time,label:s.label})),choices.length?'Choose a nearby available arrival time below.':'No available arrival found for this party before the last reservation time, 15 minutes before close.')}
 const room=values.room_id||values.dining_area||''
 const candidate:CapacityBooking={id:'candidate',name:values.guest_name,party:Number(values.party_size),start,end:start+duration,tableIds:[],room,version:0}
 const plan=planCapacity(data,candidate);if(!plan.ok)throw new ArrivalOptionsError(arrivalChoices(data,Number(values.party_size),room,duration,values.reservation_time).map(s=>({time:s.time,label:s.label})),plan.reason+' Choose a nearby available time below.')
 const labels=(plan.assignments.candidate??[]).map(id=>data.tables.find(t=>t.id===id)?.name??id).join(' + ')
 if(!window.confirm('Review booking: '+values.guest_name+' · '+values.reservation_date+' at '+values.reservation_time+' Central · '+values.party_size+' guests.\nTables: '+labels+' · '+duration+' dining minutes.\nSave this booking and the complete suggested table plan? Other unassigned reservations may receive suggested tables. No guest message is sent.'))return null
 const saved=await supabase.rpc('reservation_save_verified',{p_location_id:location,p_request_id:request,p_values:values,p_fingerprint:data.fingerprint,p_assignments:plan.assignments,p_duration:duration,p_source:source??null,p_inquiry_id:inquiry??null});if(saved.error)throw saved.error;return saved.data as {reservation_id:string;reservation_date:string;already_linked:boolean;capacity_verified?:boolean;message_sent?:boolean}
}
