import {capacityClock,type CapacityData,type CapacityBooking,type CapacityResult} from '../lib/reservationCapacity'
import {reservationConflicts,reservationMoves} from '../lib/reservationPlanning'

export function ReservationPlanReview({data,candidate,plan}:{data:CapacityData;candidate:CapacityBooking;plan:CapacityResult}){
 const conflicts=reservationConflicts(data,candidate)
 const moves=plan.ok?reservationMoves(data,plan.assignments):[]
 const names=(ids:string[])=>ids.map(id=>data.tables.find(t=>t.id===id)?.name??id).join(' + ')
 return <section aria-label="Reservation conflict and table plan review">
  {!plan.ok&&<p role="status">{plan.reason} You can review the parties below and save a capacity override with tables pending.</p>}
  {moves.length>0&&<><h4>Upcoming reservations to move</h4><ul>{moves.map(row=><li key={row.id}><strong>{row.name} · {row.party} guests</strong> · {capacityClock(row.start!)} · {names(row.from)} to {names(row.to)}</li>)}</ul></>}
  {conflicts.length>0&&<details open={!plan.ok}><summary>Overlapping parties to review ({conflicts.length})</summary><p>These parties overlap the requested dining and reset window. A time overlap alone can still fit on different tables.</p><ul>{conflicts.map(row=><li key={row.id}><strong>{row.name} · {row.party} guests</strong> · {capacityClock(row.start!)} · {names(row.tableIds)||'Tables pending'}<br/>{row.detail}</li>)}</ul></details>}
  {!plan.ok&&!conflicts.length&&<p>No loaded party overlaps this arrival. Check party size, room, approved table combinations, blocks, and other unresolved bookings for the day.</p>}
 </section>
}
