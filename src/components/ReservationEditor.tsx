import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { ScreenText } from './ScreenText'
import type { TeamMember } from '../lib/team'

type Reservation = {id:string;party_size:number;table_id:string|null;assigned_server_id:string|null;notes:string|null;edit_version:number}
export function ReservationEditor({reservation,locationId,tables,team,onSaved}:{reservation:Reservation;locationId:string;tables:{id:string;table_name:string}[];team:TeamMember[];onSaved:()=>void}) {
  const [editing,setEditing]=useState(false)
  const [size,setSize]=useState(String(reservation.party_size))
  const [table,setTable]=useState(reservation.table_id??'')
  const [server,setServer]=useState(reservation.assigned_server_id??'')
  const [notes,setNotes]=useState(reservation.notes??'')
  const [version,setVersion]=useState(reservation.edit_version)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  function open(){setSize(String(reservation.party_size));setTable(reservation.table_id??'');setServer(reservation.assigned_server_id??'');setNotes(reservation.notes??'');setVersion(reservation.edit_version);setError('');setEditing(true)}
  async function save(){
    setBusy(true);setError('')
    try {
      const result=await supabase.rpc('reservation_edit',{p_location_id:locationId,p_reservation_id:reservation.id,p_version:version,p_party_size:Number(size),p_table_id:table||null,p_server_id:server||null,p_notes:notes})
      if(result.error)throw result.error
      setEditing(false);onSaved()
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  if(!editing)return <button type="button" onClick={open}><ScreenText id="ReservationEditor.edit">Edit reservation</ScreenText></button>
  return <form onSubmit={e=>{e.preventDefault();void save()}}>
    <fieldset disabled={busy}>
      <label><ScreenText id="ReservationEditor.size">Party size (number of guests)</ScreenText><input required type="number" min={1} max={500} step={1} value={size} onChange={e=>setSize(e.target.value)}/></label>
      <label><ScreenText id="ReservationEditor.table">Table</ScreenText><select value={table} onChange={e=>setTable(e.target.value)}><option value="">Unassigned</option>{tables.map(t=><option key={t.id} value={t.id}>{t.table_name}</option>)}</select></label>
      <label><ScreenText id="ReservationEditor.server">Server</ScreenText><select value={server} onChange={e=>setServer(e.target.value)}><option value="">Unassigned</option>{team.map(m=><option key={m.user_id} value={m.user_id}>{m.profile?.preferred_name||m.profile?.full_name||m.role}</option>)}</select></label>
      <label><ScreenText id="ReservationEditor.notes">Notes and guest requests</ScreenText><textarea rows={3} maxLength={4000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      <button type="submit"><ScreenText id="ReservationEditor.save">Save changes</ScreenText></button>
      <button type="button" onClick={()=>setEditing(false)}><ScreenText id="ReservationEditor.cancel">Cancel</ScreenText></button>
    </fieldset>
    {error&&<p role="alert">{error}</p>}
  </form>
}
