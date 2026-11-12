import {planCapacity,type CapacityData,type CapacityBooking} from './reservationCapacity'
export type SeatingOption={ids:string[];seats:number;label:string;room:string;start:number}
export function liveSeatingOptions(data:CapacityData,party:number,room=''){
 const none={options:[] as SeatingOption[],next:null as SeatingOption|null,reason:'',unverified:false}
 if(!Number.isInteger(party)||party<1||party>500)return {...none,reason:'Enter 1–500 guests.'}
 if(!data.configured)return {...none,reason:'Confirm recurring service settings to verify availability.',unverified:true}
 if(data.config.closed)return {...none,reason:'This service day is closed for reservations.'}
 const byId=new Map(data.tables.map(t=>[t.id,t]))
 const seen=new Set<string>()
 const choices=[...data.tables.map(t=>[t.id]),...data.config.joinGroups].filter(ids=>{
  const key=[...ids].sort().join(':');if(seen.has(key))return false;seen.add(key)
  return ids.length&&new Set(ids).size===ids.length&&ids.every(id=>byId.has(id))&&ids.every(id=>!data.config.blockedTables.includes(id))&&(!room||ids.every(id=>byId.get(id)!.room===room))&&new Set(ids.map(id=>byId.get(id)!.room)).size===1&&ids.reduce((n,id)=>n+byId.get(id)!.seats,0)>=party
 }).sort((a,b)=>a.reduce((n,id)=>n+byId.get(id)!.seats,0)-b.reduce((n,id)=>n+byId.get(id)!.seats,0)||a.length-b.length||a.join(':').localeCompare(b.join(':')))
 const option=(ids:string[],start:number):SeatingOption=>({ids,seats:ids.reduce((n,id)=>n+byId.get(id)!.seats,0),label:ids.map(id=>byId.get(id)!.name).join(' + '),room:byId.get(ids[0])!.roomName,start})
 const candidate=(start:number,ids:string[]=[]):CapacityBooking=>({id:'live-finder-candidate',name:'New walk-in',party,start,end:start+data.config.duration,tableIds:ids,room,version:0})
 const fitsWindow=(start:number)=>start>=data.open&&start<=data.close-15
 const options:SeatingOption[]=[];let unverified=false,reason=''
 if(fitsWindow(data.now))for(const ids of choices){
  const result=planCapacity(data,candidate(data.now,ids),4000)
  if(result.ok)options.push(option(ids,data.now))
  else{unverified ||= result.exhausted;reason=result.reason}
 }
 if(options.length)return {options,next:null,reason:'',unverified}
 // Occupied tables remain unavailable until checkout; no invented departure estimate.
 for(const slot of data.slots.filter(s=>s.value>data.now&&fitsWindow(s.value))){
  const result=planCapacity(data,candidate(slot.value),4000)
  if(result.ok&&result.assignments['live-finder-candidate']?.length)return {options,next:option(result.assignments['live-finder-candidate'],slot.value),reason:'',unverified}
  unverified ||= result.exhausted;reason=result.reason
 }
 return {options,next:null,unverified,reason:reason||'No verified fit in this service window. Try another room or check again after checkout.'}
}
