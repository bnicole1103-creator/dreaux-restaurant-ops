import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
type Event={id:number;changed_at:string;actor_name:string;action:string;before_record:Record<string,unknown>|null;after_record:Record<string,unknown>|null}
const stamp=(s:string)=>new Date(s).toLocaleString('en-US',{timeZone:'America/Chicago',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true})+' CT'
const hidden=new Set(['id','location_id','organization_id','shift_id','updated_at','edit_version','version'])
export function ReservationEntryHistory({location,entryKey}:{location:string;entryKey:string}){
 const kind=entryKey.startsWith('live:')?'seating':'reservation',id=entryKey.replace(/^live:/,'')
 const [open,setOpen]=useState(false),[events,setEvents]=useState<Event[]>([]),[labels,setLabels]=useState<Record<string,string>>({}),[current,setCurrent]=useState<Record<string,unknown>|null>(null),[cursor,setCursor]=useState<number|null>(null),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{if(!open)return;let live=true;setLoading(true);setError('');if(cursor==null)setEvents([]);
 void Promise.resolve(supabase.rpc('reservation_entry_history',{p_location_id:location,p_kind:kind,p_id:id,p_before:cursor})).then(r=>{if(!live)return;if(r.error)throw r.error;const rows=(r.data.events??[]) as Event[];setEvents(old=>cursor==null?rows.slice(0,50):[...old,...rows.slice(0,50).filter(row=>!old.some(x=>x.id===row.id))]);setMore(rows.length>50);setLabels(r.data.labels??{});setCurrent(r.data.current??null)}).catch(e=>{if(live)setError(String(e.message??e))}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}
 },[open,location,kind,id,cursor,revision])
 function display(value:unknown):string{
  if(value==null||value==='')return 'Not set'
  if(Array.isArray(value))return value.map(display).join(', ')||'None'
  if(typeof value==='boolean')return value?'Yes':'No'
  if(typeof value==='object')return JSON.stringify(value)
  const s=String(value);if(labels[s])return labels[s]
  if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:/.test(s)&&Number.isFinite(Date.parse(s)))return stamp(s)
  if(/^\d{2}:\d{2}(:\d{2})?$/.test(s)){const [h,m]=s.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+(h>=12?' PM':' AM')}
  return s
 }
 function details(before:Record<string,unknown>|null,after:Record<string,unknown>|null){
  return [...new Set([...Object.keys(before??{}),...Object.keys(after??{})])].filter(k=>!hidden.has(k)&&JSON.stringify(before?.[k])!==JSON.stringify(after?.[k])).map(k=><li key={k}><strong>{k.replace(/_/g,' ')}:</strong> {display(before?.[k])} → {display(after?.[k])}</li>)
 }
 return <details className="reservation-entry-history" onToggle={e=>{const value=e.currentTarget.open;if(value&&!open){setCursor(null);setEvents([])}setOpen(value)}}><summary>History · details, user &amp; date/time</summary>{open&&<><button type="button" disabled={loading} onClick={()=>{setCursor(null);setRevision(v=>v+1)}}>Refresh history</button>{loading&&<p role="status">Loading history…</p>}{error&&<p role="alert">{error}</p>}{current&&<details><summary>Current saved details</summary><dl>{Object.entries(current).filter(([k])=>!hidden.has(k)).map(([k,v])=><div key={k}><dt>{k.replace(/_/g,' ')}</dt><dd>{display(v)}</dd></div>)}</dl></details>}<p>Changes are recorded from installation onward. Earlier edits and their users cannot be reconstructed here.</p>{events.map(event=><article key={event.id}><strong>{event.action} · {event.actor_name}</strong><p><time dateTime={event.changed_at}>{stamp(event.changed_at)}</time></p><ul>{details(event.before_record,event.after_record)}</ul></article>)}{!loading&&!error&&!events.length&&<p>No recorded changes yet.</p>}{more&&<button type="button" disabled={loading} onClick={()=>setCursor(events[events.length-1]?.id??null)}>Load older changes</button>}</>}</details>
}
