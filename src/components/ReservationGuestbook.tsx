import {useState} from 'react'
import {supabase} from '../lib/supabase'

type Visit={id:string;reservation_date:string;reservation_time:string|null;party_size:number;status:string;occasion:string|null;notes:string|null;table_name:string|null}
type Guest={id:string;name:string;phone:string|null;email:string|null;vip:boolean;birthday:boolean;first_date:string|null;last_date:string|null;last_occasion:string|null;last_notes:string|null;details:Record<string,string>;reservation_count:number;history:Visit[]}
const time=(value:string|null)=>{if(!value)return 'Time not entered';const [h,m]=value.split(':');return `${Number(h)%12||12}:${m} ${Number(h)>=12?'PM':'AM'}`}
export function ReservationGuestbook({location}:{location:string}){
 const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[rows,setRows]=useState<Guest[]>([]),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState('')
 async function load(){if(!location||busy)return;setBusy(true);setError('');try{const result=await supabase.rpc('reservation_guestbook_read',{p_location_id:location,p_search:search.trim()});if(result.error)throw result.error;setRows((result.data??[]) as Guest[]);setLoaded(true)}catch(e){setError(String((e as Error).message??e))}finally{setBusy(false)}}
 return <details open={open} onToggle={e=>{const next=(e.currentTarget as HTMLDetailsElement).open;setOpen(next);if(next&&!loaded)void load()}}>
  <summary>Guestbook</summary>
  <p>Search guest contact details, flags, requests and reservation history.</p>
  <form onSubmit={e=>{e.preventDefault();void load()}} className="feed-actions">
   <label>Guest search<input value={search} maxLength={200} placeholder="Name, phone or email" onChange={e=>setSearch(e.target.value)}/></label>
   <button type="submit" disabled={busy}>{busy?'Searching…':'Search guestbook'}</button>
   {search&&<button type="button" disabled={busy} onClick={()=>{setSearch('');setLoaded(false);setRows([])}}>Clear</button>}
  </form>
  {error&&<p role="alert">{error}</p>}
  {loaded&&!rows.length&&<p>No matching guests.</p>}
  <div className="reservation-guestbook-list">{rows.map(guest=><details key={guest.id}>
   <summary><strong>{guest.name}</strong> · {guest.reservation_count} booking{guest.reservation_count===1?'':'s'}{guest.vip?' · ⭐ VIP':''}{guest.birthday?' · 🎂 Birthday':''}</summary>
   <p>{guest.phone||'No phone'} · {guest.email||'No email'}</p>
   <p>First booking: {guest.first_date||'Not recorded'} · Latest: {guest.last_date||'Not recorded'}</p>
   {guest.last_occasion&&<p><strong>Latest occasion:</strong> {guest.last_occasion}</p>}
   {guest.last_notes&&<p><strong>Latest guest notes:</strong> {guest.last_notes}</p>}
   {!!Object.keys(guest.details??{}).length&&<details><summary>All imported guest information</summary><dl>{Object.entries(guest.details).map(([key,value])=><div key={key}><dt>{key.replace(/_/g,' ')}</dt><dd>{value}</dd></div>)}</dl></details>}
   <h4>Reservation history</h4>
   {!guest.history.length&&<p>No reservation history.</p>}
   {guest.history.map(visit=><article key={visit.id}>
    <strong>{visit.reservation_date} · {time(visit.reservation_time)} · {visit.party_size} guests</strong>
    <p>{visit.status?.replace(/_/g,' ')}{visit.table_name?' · '+visit.table_name:''}{visit.occasion?' · '+visit.occasion:''}</p>
    {visit.notes&&<p>{visit.notes}</p>}
   </article>)}
  </details>)}</div>
 </details>
}
