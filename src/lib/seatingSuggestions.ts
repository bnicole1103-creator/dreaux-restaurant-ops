export type SeatingCandidate={id:string;room_id:string;table_name:string;seat_count:number}
export function suggestSingleTables<T extends SeatingCandidate>(tables:T[],party:number,room:string,blocked:Set<string>){
 return suggestTableGroups(tables,[],party,room,blocked).filter(g=>g.length===1).slice(0,3).map(g=>g[0])
}
export function suggestTableGroups<T extends SeatingCandidate>(tables:T[],approved:string[][],party:number,room:string,blocked:Set<string>):T[][]{
 if(!Number.isInteger(party)||party<1)return []
 const byId=new Map(tables.map(t=>[t.id,t])),seen=new Set<string>(),groups:T[][]=[]
 for(const ids of [...tables.map(t=>[t.id]),...approved]){
  if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)continue
  const key=[...ids].sort().join(':');if(seen.has(key))continue;seen.add(key)
  const group=ids.map(id=>byId.get(id));
  if(group.some(t=>!t||t.room_id!==room||blocked.has(t.id)||!Number.isFinite(t.seat_count)||t.seat_count<1))continue
  const valid=group as T[];if(valid.reduce((n,t)=>n+t.seat_count,0)<party)continue
  groups.push(valid)
 }
 return groups.sort((a,b)=>a.reduce((n,t)=>n+t.seat_count,0)-b.reduce((n,t)=>n+t.seat_count,0)||a.length-b.length||a[0].table_name.localeCompare(b[0].table_name,undefined,{numeric:true})).slice(0,3)
}
