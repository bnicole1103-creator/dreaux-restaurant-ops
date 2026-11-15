import {capacityClock,type CapacityData} from './reservationCapacity'
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
 const fitsWindow=(start:number)=>start>=data.open&&start<=data.close-15
 // Check the proposed tables and dining/reset window, not the whole-day solver.
 const inspect=(ids:string[],start:number)=>{
  const end=start+data.config.duration,buffer=data.config.buffer;
  const overlaps=(a:number,b:number)=>start<b+buffer&&a<end+buffer;
  const liveOrBooked=data.bookings.filter(b=>b.start==null||b.end==null||overlaps(b.start,b.end));
  if(liveOrBooked.some(b=>b.tableIds.some(id=>ids.includes(id))))return {fit:false,uncertain:false};
  if((data.blocks??[]).some(b=>start<Date.parse(b.ends_at)/60000&&Date.parse(b.starts_at)/60000<end+buffer&&(b.scope==='day'||b.tableIds.some(id=>ids.includes(id)))))return {fit:false,uncertain:false};
  return {fit:true,uncertain:liveOrBooked.some(b=>!b.tableIds.length)};
 }
 const options:SeatingOption[]=[];let unverified=false;
 if(fitsWindow(data.now))for(const ids of choices){const check=inspect(ids,data.now);if(check.fit){options.push(option(ids,data.now));unverified ||= check.uncertain}}
 const warning=(start:number)=>'Reservations needing review: '+data.bookings.filter(b=>!b.tableIds.length&&(b.start==null||b.end==null||start<b.end+data.config.buffer&&b.start<start+data.config.duration+data.config.buffer)).slice(0,10).map(b=>(b.name||'Guest')+' · '+b.party+' guests · '+(b.start==null?'Time missing':capacityClock(b.start))).join('; ')+'. These tables fit the selected party; the complete reservation plan still needs review.';
 if(options.length)return {options,next:null,unverified,reason:unverified?warning(data.now):''};
 for(const slot of data.slots.filter(s=>s.value>data.now&&fitsWindow(s.value))){for(const ids of choices){const check=inspect(ids,slot.value);if(check.fit)return {options,next:option(ids,slot.value),unverified:check.uncertain,reason:check.uncertain?warning(slot.value):''}}}
 return {options,next:null,unverified:false,reason:'No table fit found for this party in the checked service windows. Occupied/assigned tables, blocks, dining time and reset time are included.'}
}
