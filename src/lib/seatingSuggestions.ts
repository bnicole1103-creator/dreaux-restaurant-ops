export type SeatingCandidate={id:string;room_id:string;table_name:string;seat_count:number}
export function suggestSingleTables<T extends SeatingCandidate>(tables:T[],party:number,room:string,blocked:Set<string>){
 if(!Number.isInteger(party)||party<1)return []
 return tables.filter(t=>t.room_id===room&&!blocked.has(t.id)&&t.seat_count>=party).sort((a,b)=>a.seat_count-b.seat_count||a.table_name.localeCompare(b.table_name,undefined,{numeric:true})).slice(0,3)
}
