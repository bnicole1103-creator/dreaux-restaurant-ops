import {useMemo} from 'react'
import {capacityClock,planCapacity,type CapacityData} from '../lib/reservationCapacity'
export function ReservationConflictSummary({data,party,room,time}:{data:CapacityData;party:number;room:string;time:string}){
 const review=useMemo(()=>{
  const notes=new Map<string,string[]>();const add=(id:string,note:string)=>notes.set(id,[...(notes.get(id)??[]),note]);
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const start=data.slots.find(s=>clock.format(new Date(s.value*60000))===time.slice(0,5))?.value;
  const overlaps=data.bookings.filter(b=>start!=null&&b.start!=null&&b.end!=null&&b.start<start+data.config.duration+data.config.buffer&&start<b.end+data.config.buffer);
  for(const b of data.bookings){const alone=planCapacity({...data,bookings:[b]},undefined,1000);if(!alone.ok&&!alone.exhausted)add(b.id,alone.reason)}
  for(let i=0;i<data.bookings.length;i++)for(let j=i+1;j<data.bookings.length;j++){
   const a=data.bookings[i],b=data.bookings[j];if(a.start==null||a.end==null||b.start==null||b.end==null)continue;
   const shared=a.tableIds.filter(id=>b.tableIds.includes(id));if(shared.length&&a.start<b.end+data.config.buffer&&b.start<a.end+data.config.buffer){const names=shared.map(id=>data.tables.find(t=>t.id===id)?.name??id).join(' + ');add(a.id,'Assigned table overlap with '+b.name+' · '+names);add(b.id,'Assigned table overlap with '+a.name+' · '+names)}
  }
  const candidate=start!=null&&party>0?{id:'candidate',name:'Requested booking',party,start,end:start+data.config.duration,tableIds:[],room,version:0}:undefined;
  const result=planCapacity(data,candidate,5000);
  return {notes,overlaps,reason:result.ok?'':result.reason,unverified:result.exhausted};
 },[data,party,room,time]);
 if(!review.reason)return null;
 const identified=data.bookings.filter(b=>review.notes.has(b.id));
 return <section aria-label="Reservation conflict details"><h4>Table-plan warnings · booking can still be saved</h4><p>{review.reason}</p>{identified.length>0&&<ul>{identified.map(b=><li key={b.id}><strong>{b.party||'?'} guests · {b.name}</strong> · {b.start==null?'Time missing':capacityClock(b.start)}{b.end!=null?' – '+capacityClock(b.end):''}{b.live?' · Currently seated':''}<ul>{[...new Set(review.notes.get(b.id))].map(note=><li key={note}>{note}</li>)}</ul></li>)}</ul>}{!identified.length&&<p>{review.unverified?'The search limit was reached; no specific conflict is proven.':'No individual reservation error or assigned-table collision was identified. The combined table plan could not be verified.'}</p>}{review.overlaps.length>0&&<details><summary>Parties overlapping the requested time ({review.overlaps.length})</summary><p>These parties may compete for tables; an overlap alone does not mean they conflict.</p>{review.overlaps.map(b=><p key={b.id}><strong>{b.party} guests · {b.name}</strong> · {capacityClock(b.start!)} – {capacityClock(b.end!)} · {b.tableIds.map(id=>data.tables.find(t=>t.id===id)?.name??id).join(' + ')||'Tables pending'}</p>)}</details>}<p>Warnings do not cancel reservations or change table assignments. Use the working capacity override to save with tables pending.</p></section>
}
