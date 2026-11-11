export type CapacityBlock={id:string;scope:string;reason:string;starts_at:string;ends_at:string;tableIds:string[];room_id?:string;section_id?:string;version:number}
export type CapacityTable={id:string;name:string;seats:number;room:string;roomName:string}
export type CapacityBooking={id:string;name:string;party:number;start:number|null;end:number|null;tableIds:string[];room:string;version:number;live?:boolean;source?:string}
export type CapacityConfig={duration:number;buffer:number;step:number;open:string;close:string;closed:boolean;joinGroups:string[][];blockedTables:string[]}
export type CapacityData={day:string;now:number;open:number;close:number;configured:boolean;config:CapacityConfig;tables:CapacityTable[];bookings:CapacityBooking[];fingerprint:string;canManage:boolean;organization:string;blocks?:CapacityBlock[];sections?:{id:string;name:string;tableIds:string[]}[];slots:{value:number;label:string}[]}
export const capacityClock=(minute:number)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(minute*60000))
export type CapacityResult={ok:boolean;assignments:Record<string,string[]>;reason:string;exhausted:boolean}
const overlaps=(a:CapacityBooking,b:CapacityBooking,buffer:number)=>a.start!<b.end!+buffer&&b.start!<a.end!+buffer
export function planCapacity(data:CapacityData,candidate?:CapacityBooking,maxNodes=40000):CapacityResult{
 const fail=(reason:string,exhausted=false):CapacityResult=>({ok:false,assignments:{},reason,exhausted})
 const rows=[...data.bookings,...(candidate?[candidate]:[])],tables=data.tables.filter(t=>!data.config.blockedTables.includes(t.id)),byId=new Map(tables.map(t=>[t.id,t]));
 if(!tables.length)return fail('No usable tables are configured.')
 if(rows.length>150)return fail('More than 150 overlapping-day records need review before automatic planning.')
 const options=new Map<string,string[][]>();
 for(const row of rows){
  if(!Number.isInteger(row.party)||row.party<1||row.start==null||row.end==null||row.end<=row.start)return fail(`${row.name}: add a valid party size and time before finding availability.`)
  const fits=(ids:string[])=>ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>byId.has(id))&&ids.reduce((sum,id)=>sum+byId.get(id)!.seats,0)>=row.party&&(!row.room||ids.every(id=>{const t=byId.get(id)!;return t.room===row.room||t.roomName.toLowerCase()===row.room.toLowerCase()}))
  const blocked=(ids:string[])=>data.blocks?.some(b=>row.start!<Date.parse(b.ends_at)/60000&&Date.parse(b.starts_at)/60000<row.end!+data.config.buffer&&(b.scope==='day'||ids.some(id=>b.tableIds.includes(id))));
  const sets=row.tableIds.length?[row.tableIds]:[...tables.map(t=>[t.id]),...data.config.joinGroups];
  const choices=sets.filter(ids=>fits(ids)&&!blocked(ids)).sort((a,b)=>a.reduce((n,id)=>n+byId.get(id)!.seats,0)-b.reduce((n,id)=>n+byId.get(id)!.seats,0)||a.length-b.length);
  if(!choices.length)return fail(`${row.name}: no table or approved joined-table group fits this party and room.`)
  options.set(row.id,choices)
 }
 rows.sort((a,b)=>Number(!!b.tableIds.length)-Number(!!a.tableIds.length)||options.get(a.id)!.length-options.get(b.id)!.length||b.party-a.party||a.start!-b.start!);
 const assignments:Record<string,string[]>={};let nodes=0,exhausted=false;
 function search(index:number):boolean{
  if(++nodes>maxNodes){exhausted=true;return false}if(index===rows.length)return true;
  const row=rows[index];for(const ids of options.get(row.id)!){
   if(rows.slice(0,index).some(other=>overlaps(row,other,data.config.buffer)&&assignments[other.id]?.some(id=>ids.includes(id))))continue;
   assignments[row.id]=ids;if(search(index+1))return true;delete assignments[row.id];if(exhausted)return false;
  }return false
 }
 return search(0)?{ok:true,assignments,reason:'A table plan fits all loaded bookings.',exhausted:false}:fail(exhausted?'Search limit reached. Availability is unverified; review table assignments.':'No table plan fits these overlapping parties. Try a different time, room or duration.',exhausted)
}
export function capacityAt(data:CapacityData,minute:number){
 const overlapping=data.bookings.filter(b=>b.start!=null&&b.end!=null&&b.start<=minute&&minute<b.end+data.config.buffer);
 const blocked=new Set([...(data.config.blockedTables??[]),...(data.blocks??[]).filter(b=>Date.parse(b.starts_at)/60000<=minute&&minute<Date.parse(b.ends_at)/60000).flatMap(b=>b.tableIds)]);
 return {blockedSeats:data.tables.filter(t=>blocked.has(t.id)).reduce((n,t)=>n+t.seats,0),guests:overlapping.some(b=>!Number.isInteger(b.party)||b.party<1)?null:overlapping.reduce((n,b)=>n+b.party,0),tables:new Set(overlapping.flatMap(b=>b.tableIds)).size,totalSeats:data.tables.filter(t=>!blocked.has(t.id)).reduce((n,t)=>n+t.seats,0)}
}
