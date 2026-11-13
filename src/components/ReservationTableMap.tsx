import {TableSeatCorrection} from './TableSeatCorrection'
import {useEffect,useMemo,useRef,useState} from 'react'
import {TaskDialog} from './TaskDialog'
import {supabase} from '../lib/supabase'
import {notifyReservationsChanged} from '../lib/reservationSync'
import {capacityClock,planCapacity,type CapacityData,type CapacityBooking} from '../lib/reservationCapacity'
import {floorTableGeometry,floorRoomRatio} from '../lib/floorPhotoLayout'
import './ReservationTableMap.css'
type Geometry={id:string;position_x:number;position_y:number;width:number;height:number;shape:string}
type Snapshot={capacity:CapacityData;geometry:Geometry[]}
const overlapping=(a:CapacityBooking,b:CapacityBooking,buffer:number)=>a.start!=null&&a.end!=null&&b.start!=null&&b.end!=null&&a.start<b.end+buffer&&b.start<a.end+buffer
export function ReservationTableMap({location,reservationId,onClose}:{location:string;reservationId:string;onClose:()=>void}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[room,setRoom]=useState(''),[selected,setSelected]=useState<string[]>([])
 const lock=useRef(false),dirty=useRef(false),pendingDraft=useRef<string[]|null>(null)
 useEffect(()=>{let live=true;setLoading(true);setSnapshot(null);setError('');setSelected([]);dirty.current=false;
 void Promise.resolve(supabase.rpc('reservation_table_map_load',{p_location_id:location,p_id:reservationId})).then(r=>{if(!live)return;if(r.error)throw r.error;const next=r.data as Snapshot;setSnapshot(next);const target=next.capacity.bookings.find(b=>b.id===reservationId);const restored=pendingDraft.current;setSelected(restored??target?.tableIds??[]);dirty.current=restored!==null;pendingDraft.current=null;const table=next.capacity.tables.find(t=>(restored??target?.tableIds??[]).includes(t.id));setRoom(table?.room??next.capacity.tables.find(t=>t.room===target?.room||t.roomName.toLowerCase()===target?.room?.toLowerCase())?.room??next.capacity.tables[0]?.room??'')}).catch(e=>{if(live)setError(String(e.message??e))}).finally(()=>{if(live)setLoading(false)});
 return()=>{live=false}
 },[location,reservationId,revision])
 const data=snapshot?.capacity,target=data?.bookings.find(b=>b.id===reservationId)
 const rooms=data?[...new Map(data.tables.map(t=>[t.room,t.roomName])).entries()]:[]
 const conflicts=data&&target?data.bookings.filter(b=>b.id!==target.id&&overlapping(target,b,data.config.buffer)):[]
 const planned=useMemo(()=>data&&target?planCapacity({...data,bookings:data.bookings.map(b=>b.id===target.id?{...b,tableIds:[]}:b)}):null,[data,target])
 const suggested=planned?.ok?planned.assignments[reservationId]??[]:[]
 const preview=useMemo(()=>data&&target&&selected.length?planCapacity({...data,bookings:[...data.bookings.filter(b=>b.id!==target.id&&b.tableIds.length>0),{...target,tableIds:selected}]}):null,[data,target,selected])
 const combination=selected.length===1||!!data?.config.joinGroups.some(ids=>ids.length===selected.length&&ids.every(id=>selected.includes(id)))
 const seats=data?.tables.filter(t=>selected.includes(t.id)).reduce((n,t)=>n+t.seats,0)??0
 function blocked(id:string){return !!data&&!!target&&(data.config.blockedTables.includes(id)||data.blocks?.some(b=>target.start!=null&&target.end!=null&&target.start<Date.parse(b.ends_at)/60000&&Date.parse(b.starts_at)/60000<target.end+data.config.buffer&&(b.scope==='day'||b.tableIds.includes(id))))}
 function pick(id:string){dirty.current=true;setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])}
 function close(){if(!busy&&(!dirty.current||window.confirm('Discard unsaved table selection?')))onClose()}
 async function save(){if(!data||!target||lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await supabase.rpc('reservation_table_map_save',{p_location_id:location,p_id:reservationId,p_version:target.version,p_fingerprint:data.fingerprint,p_table_ids:selected});if(r.error)throw r.error;dirty.current=false;notifyReservationsChanged();onClose()}catch(e){setError(String((e as Error).message??e))}finally{lock.current=false;setBusy(false)}}
 return <TaskDialog title={'Assign tables'+(target?' · '+target.name:'')} busy={busy} onClose={close}><div className="reservation-table-map">
 {loading&&<p role="status">Loading floor map and reservation assignments…</p>}{error&&<p role="alert">{error}</p>}
 <button type="button" disabled={loading||busy} onClick={()=>{if(!dirty.current||window.confirm('Discard your selection and reload current assignments?'))setRevision(v=>v+1)}}>Reload current map</button>
 {data&&target&&<><p><strong>{data.day} · {target.start==null?'Time missing':capacityClock(target.start)} – {target.end==null?'Time missing':capacityClock(target.end)} · {target.party} guests</strong></p><p>Colors show assignments overlapping this reservation, including reset time. Suggestions are not held until saved.</p>
 <div className="reservation-map-legend"><span className="map-assigned">Blue · saved reservation / seated party</span><span className="map-suggested">Amber · suggested assignment</span><span>Green outline · your selection</span><span className="map-blocked">Gray · blocked</span></div>
 {!data.configured&&<p role="alert">Confirm recurring or date service settings before saving.</p>}{data.config.closed&&<p role="alert">This date is closed for reservations.</p>}
 <label>Room<select value={room} disabled={busy} onChange={e=>setRoom(e.target.value)}>{rooms.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
 <div className="reservation-map-scroll"><div className="reservation-map-canvas" style={{aspectRatio:floorRoomRatio(rooms.find(([id])=>id===room)?.[1]??'')}} aria-label="Reservation floor map">
 {data.tables.filter(t=>t.room===room).map(t=>{const geometry=snapshot?.geometry.find(g=>g.id===t.id);const saved=[...(target.tableIds.includes(t.id)?[target]:[]),...conflicts.filter(b=>b.tableIds.includes(t.id))];const suggestedBookings=planned?.ok?data.bookings.filter(b=>(b.id===target.id||conflicts.some(c=>c.id===b.id))&&(b.id===target.id||!b.tableIds.length)&&planned.assignments[b.id]?.includes(t.id)):[];const taken=conflicts.some(b=>b.tableIds.includes(t.id)),unavailable=blocked(t.id);const descriptions=[...saved.map(b=>'Saved: '+b.name),...suggestedBookings.map(b=>'Suggested: '+b.name),...(unavailable?['Blocked']:[])];return <button type="button" key={t.id} disabled={busy||taken||unavailable} aria-pressed={selected.includes(t.id)} aria-label={t.name+' · '+t.seats+' seats · '+(descriptions.join('; ')||'Unassigned')} title={descriptions.join('; ')} className={'reservation-map-table '+(unavailable?'map-blocked':saved.length?'map-assigned':suggestedBookings.length?'map-suggested':'')+(selected.includes(t.id)?' map-selected':'')} style={{...floorTableGeometry(geometry??{position_x:0,position_y:0,width:10,height:10}),borderRadius:geometry?.shape==='round'?'50%':12}} onClick={()=>pick(t.id)}><strong>{t.name}</strong><small>{t.seats} seats</small><small>{saved.map(b=>b.name).join(', ')||suggestedBookings.map(b=>b.name).join(', ')}</small></button>})}
 </div></div>
 <TableSeatCorrection disabled={busy} location={location} tables={data.tables.filter(t=>selected.includes(t.id)).map(t=>({id:t.id,name:t.name,seats:t.seats}))} onSaved={()=>{pendingDraft.current=[...selected];setRevision(v=>v+1)}}/><p role="status">{selected.map(id=>data.tables.find(t=>t.id===id)?.name??'?').join(' + ')||'Select tables on the map'} · {seats} seats for {target.party} guests</p>
 {suggested.length>0&&<button type="button" disabled={busy} onClick={()=>{dirty.current=true;setSelected(suggested);const t=data.tables.find(t=>t.id===suggested[0]);if(t)setRoom(t.room)}}>Use suggested tables: {suggested.map(id=>data.tables.find(t=>t.id===id)?.name).join(' + ')}</button>}
 {planned&&!planned.ok&&<p role="status">Full-day suggestions unavailable: {planned.reason} You can still select valid tables for this reservation.</p>}
 {!combination&&selected.length>1&&<p role="alert">Select a saved approved joined-table combination.</p>}{preview&&!preview.ok&&<p role="alert">{preview.reason}</p>}
 <button className="primary-button" type="button" disabled={busy||loading||!data.configured||data.config.closed||!combination||!preview?.ok||seats<target.party||selected.some(blocked)} onClick={()=>void save()}>{busy?'Saving…':'Save table assignment'}</button><p>This reserves tables for the booking. It does not seat the guests or change another reservation.</p>
 <details><summary>Assignments and suggestions for this time</summary>{[target,...conflicts].map(b=><p key={b.id}><strong>{b.name}</strong> · {b.tableIds.length?'Saved':'Suggested'}: {(b.tableIds.length?b.tableIds:planned?.assignments[b.id]??[]).map(id=>data.tables.find(t=>t.id===id)?.name).join(' + ')||'No suggestion'}</p>)}</details>
 </>}
 </div></TaskDialog>
}
