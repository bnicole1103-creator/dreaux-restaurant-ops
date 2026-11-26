import {CanceledReservationActions} from './CanceledReservationActions'
import {ClearReservationButton} from './ClearReservationButton'
import {ReservationConfirmationActions} from './ReservationConfirmationActions'
import {useState} from 'react'
import {Link} from 'react-router-dom'
import {time12} from '../lib/time12'
import './FloorGuestSidebar.css'
type Booking={id:string;edit_version:number;guest_name:string;reservation_time:string|null;party_size:number;phone:string|null;status:string;table_name:string|null;table_ids?:string[]}
type Party={id:string;guestName:string|null;partySize:number;seatedAt:string;status:string;tableIds:string[];primaryTableId:string;serverId:string|null}
export function FloorGuestSidebar({location,day,reservations,canceledBookings,parties,tableName,serverName,onDetails,onSeat,onParty,onAdd,onManage,onAssign,assignDisabled,assigningId,canSeat,busy}:{location:string;day:string;reservations:Booking[];canceledBookings:Booking[];parties:Party[];tableName:(id:string)=>string;serverName:(id:string)=>string;onDetails:(id:string)=>void;onSeat:(id:string)=>void;onParty:(id:string)=>void;onAdd:()=>void;onManage:()=>void;onAssign:(id:string)=>void;assignDisabled:boolean;assigningId?:string;canSeat:boolean;busy:boolean}){
 const [tab,setTab]=useState<'reservations'|'seated'>('reservations')
 const bookings=reservations.filter(r=>!['seated','cancelled','canceled','completed','no_show','removed','expired'].includes((r.status??'').trim().toLowerCase())).slice().sort((a,b)=>(a.reservation_time??'99:99').localeCompare(b.reservation_time??'99:99')||a.guest_name.localeCompare(b.guest_name))
 const seated=parties.filter(p=>!['ready','cleared','completed','cancelled','canceled'].includes(p.status.toLowerCase())).slice().sort((a,b)=>a.seatedAt.localeCompare(b.seatedAt))
 return <aside className="floor-guest-sidebar" aria-label="Day reservations and seated parties"><header><div><h2>Guests</h2><p>{new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(day+'T12:00:00Z'))}</p></div><button type="button" disabled={busy} onClick={onAdd} aria-label="Add reservation">＋</button></header><div className="floor-guest-tabs" role="group" aria-label="Guest list"><button type="button" aria-pressed={tab==='reservations'} onClick={()=>setTab('reservations')}>Reservations ({bookings.length})</button><button type="button" aria-pressed={tab==='seated'} onClick={()=>setTab('seated')}>Seated ({seated.length})</button></div><div className="floor-guest-list" tabIndex={0} role="region" aria-label={tab==='reservations'?'Reservations':'Seated parties'}>{tab==='reservations'?<>{canceledBookings.map(booking=><article className="floor-booking-row" key={booking.id}>
  <strong>{booking.guest_name}</strong>
  <div>{time12(booking.reservation_time)||'Time pending'} · {booking.party_size} guests</div>
  <CanceledReservationActions location={location} reservation={booking} disabled={busy}/>
 </article>)}{!bookings.length&&<p>No active reservations for this day.</p>}{bookings.map(r=>{
   const assigned = r.table_ids?.length ? r.table_ids.map(tableName).join(' + ') : r.table_name
   return <article key={r.id} className="floor-booking-row" data-assigning={assigningId===r.id}>
     <div className="floor-booking-summary">
       <button className="floor-guest-name" type="button" onClick={()=>onDetails(r.id)}>
         <strong>{r.guest_name}</strong>
         <small>{time12(r.reservation_time)||'Time pending'} · {r.party_size} guests</small>
       </button>
       <button className="floor-booking-assign" type="button" disabled={assignDisabled||busy}
         aria-label={(assigned?'Reassign tables for ':'Assign tables for ')+r.guest_name}
         onClick={()=>onAssign(r.id)}>{assigningId===r.id?'…':assigned?'Move':'Assign'}</button>
     </div>
     <div className="floor-booking-meta"><span>{assigned||'Tables pending'}</span>
       <ReservationConfirmationActions compact location={location} reservationId={r.id} status={r.status}/>
     </div>
     <details className="floor-booking-more">
       <summary>More actions</summary>
       <p>{r.status?.toLowerCase()==='confirmed'?'Booked':r.status||'Booked'}{r.phone?' · '+r.phone:''}</p>
       <div className="floor-guest-actions">
         <button type="button" disabled={busy} onClick={()=>onDetails(r.id)}>Details</button>
         <button type="button" disabled={!canSeat||busy} onClick={()=>onSeat(r.id)}>Seat guests</button>
         <ClearReservationButton location={location} day={day} reservation={r} disabled={busy}/>
       </div>
     </details>
   </article>
 })}</>:<>{!seated.length&&<p>No parties currently seated.</p>}{seated.map(p=><article key={p.id}><button className="floor-guest-name" type="button" onClick={()=>onParty(p.id)}>{p.guestName||'Walk-in party'}</button><dl><div><dt>Party</dt><dd>{p.partySize} guests</dd></div><div><dt>Table</dt><dd>{(p.tableIds.length?p.tableIds:[p.primaryTableId]).map(tableName).join(' + ')}</dd></div><div><dt>Seated</dt><dd>{new Date(p.seatedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',hour12:true})}</dd></div><div><dt>Server</dt><dd>{p.serverId?serverName(p.serverId):'Unassigned'}</dd></div></dl><button type="button" disabled={busy} onClick={()=>onParty(p.id)}>Open table</button></article>)}</>}</div><footer><button type="button" onClick={onManage}>Search & import tools</button><Link to={'/reservations?date='+day}>All bookings & history</Link></footer></aside>
}
