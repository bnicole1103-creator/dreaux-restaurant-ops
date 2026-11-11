import type {CapacityData,CapacityResult} from './reservationCapacity'
export function seatsRemaining(data:CapacityData,minute:number,plan:CapacityResult|null){
 const all=new Map(data.tables.map(t=>[t.id,t])),blocked=new Set(data.config.blockedTables)
 for(const block of data.blocks??[]){
  if(Date.parse(block.starts_at)/60000<=minute&&minute<Date.parse(block.ends_at)/60000){
   for(const id of block.scope==='day'?all.keys():block.tableIds)blocked.add(id)
  }
 }
 const held=new Set<string>();let estimated=false,unknown=false
 for(const row of data.bookings){
  if(row.start==null||row.end==null){unknown=true;continue}
  if(!(row.start<=minute&&minute<row.end+data.config.buffer))continue
  const ids=row.tableIds.length?row.tableIds:plan?.ok?plan.assignments[row.id]??[]:[]
  if(!ids.length){unknown=true;continue}
  if(!row.tableIds.length)estimated=true
  for(const id of ids){if(all.has(id))held.add(id);else unknown=true}
 }
 const usable=data.tables.filter(t=>!blocked.has(t.id)).reduce((n,t)=>n+t.seats,0)
 const remaining=data.config.closed?0:data.tables.filter(t=>!blocked.has(t.id)&&!held.has(t.id)).reduce((n,t)=>n+t.seats,0)
 return {remaining:data.config.closed||minute<data.open||minute>=data.close?0:unknown||!data.configured?null:remaining,usable,estimated,unknown,blocked:data.tables.filter(t=>blocked.has(t.id)).reduce((n,t)=>n+t.seats,0)}
}
