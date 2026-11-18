import {planCapacity,type CapacityData,type CapacityBooking} from './reservationCapacity'

export function replanReservations(data:CapacityData,candidate?:CapacityBooking,maxNodes=40000){
 return planCapacity(data,candidate,maxNodes,true)
}

export function reservationMoves(data:CapacityData,assignments:Record<string,string[]>){
 return data.bookings.filter(row=>!row.live&&row.tableIds.length&&assignments[row.id]&&
  (row.tableIds.length!==assignments[row.id].length||row.tableIds.some(id=>!assignments[row.id].includes(id))))
  .map(row=>({...row,from:row.tableIds,to:assignments[row.id]}))
}

export function reservationConflicts(data:CapacityData,candidate:CapacityBooking){
 const shared=(a:string[],b:string[])=>a.some(id=>b.includes(id))
 const overlap=(a:CapacityBooking,b:CapacityBooking)=>a.start!=null&&a.end!=null&&b.start!=null&&b.end!=null&&
  a.start<b.end+data.config.buffer&&b.start<a.end+data.config.buffer
 return data.bookings.filter(row=>row.id!==candidate.id&&overlap(row,candidate)).map(row=>({
  ...row,
  detail:shared(row.tableIds,candidate.tableIds)?'Uses a selected table during this arrival and reset window':
   row.live?'Seated party occupying tables':row.tableIds.length?'Overlapping reservation with assigned tables':'Overlapping reservation awaiting tables',
  direct:shared(row.tableIds,candidate.tableIds)
 })).sort((a,b)=>Number(b.direct)-Number(a.direct)||(a.start??0)-(b.start??0))
}
