import { useEffect,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import './PreshiftReadReceipts.css'
type Status={post_id:string;version:number;read_at:string|null;previous_read_at:string|null;read_count:number|null;total_count:number|null}
type Person={user_id:string;name:string;read_at:string|null;previous_read_at:string|null}
type Report={title:string;version:number;rows:Person[]}
const stamp=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value))+' CT'
const message=(e:unknown)=>String((e as {message?:string})?.message??e)
export function usePreshiftReadReceipts(location:string,posts:{id:string;version:number}[]){
 const signature=JSON.stringify(posts.map(p=>[p.id,p.version]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))
 const [rows,setRows]=useState<Record<string,Status>>({}),[manager,setManager]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 useEffect(()=>{if(!location){setRows({});setManager(false);return}let active=true,fetching=false
  const ids=(JSON.parse(signature) as [string,number][]).map(p=>p[0])
  async function load(){if(fetching)return;if(!ids.length){if(active){setRows({});setLoading(false)}return}fetching=true;if(active)setLoading(true)
   try{const r=await supabase.rpc('preshift_read_status',{p_location_id:location,p_post_ids:ids});if(r.error)throw r.error;if(active){setRows(Object.fromEntries((r.data.rows as Status[]).map(r=>[r.post_id,r])));setManager(r.data.manager===true);setError('')}}catch(e){if(active){setRows({});setManager(false);setError(message(e))}}finally{fetching=false;if(active)setLoading(false)}
  }
  const visible=()=>{if(document.visibilityState==='visible')void load()}
  void load();const timer=setInterval(visible,30000);window.addEventListener('focus',visible)
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',visible)}
 },[location,signature,refresh])
 return {rows,manager,loading,error,reload:()=>setRefresh(v=>v+1)}
}
function ReadReport({location,postId,onClose}:{location:string;postId:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),sequence=useRef(0),[data,setData]=useState<Report|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[filter,setFilter]=useState('all')
 const closeRef=useRef(onClose);closeRef.current=onClose
 async function load(){const token=++sequence.current;setBusy(true);setError('');try{const r=await supabase.rpc('preshift_read_report',{p_location_id:location,p_post_id:postId});if(r.error)throw r.error;if(sequence.current===token)setData(r.data)}catch(e){if(sequence.current===token){setData(null);setError(message(e))}}finally{if(sequence.current===token)setBusy(false)}}
 useEffect(()=>{const d=dialog.current;if(!d)return;d.showModal();const cancel=(e:Event)=>{e.preventDefault();closeRef.current()};d.addEventListener('cancel',cancel);void load();return()=>{sequence.current++;d.removeEventListener('cancel',cancel);d.close()}},[location,postId])
 const read=data?.rows.filter(p=>p.read_at).length??0
 const people=(data?.rows??[]).filter(p=>p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())&&(filter==='all'||(filter==='read'?!!p.read_at:!p.read_at)))
 return createPortal(<dialog ref={dialog} className="preshift-read-modal" aria-labelledby="preshift-read-title"><div className="preshift-read-heading"><h2 id="preshift-read-title">Pre-shift read receipts</h2><button type="button" onClick={onClose} aria-label="Close read receipts">Close</button></div>{error&&<p role="alert">{error}</p>}{busy&&<p role="status">Loading receipts…</p>}{data&&<><h3>{data.title}</h3><p>{read} of {data.rows.length} active team accounts acknowledged version {data.version}.</p><p>These receipts record “Mark as read” confirmations.</p><label>Search team<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Show<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Everyone</option><option value="read">Read</option><option value="unread">Not read yet</option></select></label><div className="preshift-read-list">{people.map(p=><article key={p.user_id}><strong>{p.name}</strong><p>{p.read_at?'Read · '+stamp(p.read_at):p.previous_read_at?'Updated post not acknowledged · Earlier version read '+stamp(p.previous_read_at):'Not read yet'}</p></article>)}</div>{!people.length&&<p>No matching team members.</p>}</>}<button type="button" disabled={busy} onClick={()=>void load()}>Refresh receipts</button></dialog>,document.body)
}
export function PreshiftReadReceipt({location,postId,version,status,manager,onChange}:{location:string;postId:string;version:number;status?:Status;manager:boolean;onChange:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false),[confirmed,setConfirmed]=useState<string|null>(null)
 const sequence=useRef(0)
 useEffect(()=>{sequence.current++;setConfirmed(null);setError('');setBusy(false);setOpen(false);return()=>{sequence.current++}},[location,postId,version])
 const current=status?.version===version?status:undefined,readAt=confirmed??current?.read_at
 async function mark(){if(busy||readAt||!current)return;const token=++sequence.current;setBusy(true);setError('');try{const r=await supabase.rpc('preshift_mark_read',{p_location_id:location,p_post_id:postId,p_version:version});if(r.error)throw r.error;if(sequence.current===token){setConfirmed(r.data);onChange()}}catch(e){if(sequence.current===token)setError(message(e))}finally{if(sequence.current===token)setBusy(false)}}
 return <div className="preshift-read-status">{readAt?<p role="status">✓ Read · {stamp(readAt)}</p>:<><button type="button" disabled={busy||!current||!location} onClick={()=>void mark()}>{busy?'Saving…':'Mark as read'}</button>{current?.previous_read_at&&<p>This post was updated. Read it again, then acknowledge this version.</p>}</>}{manager&&<button type="button" disabled={!current} onClick={()=>setOpen(true)}>Read receipts{current?.total_count!=null?' · '+current.read_count+'/'+current.total_count:''}</button>}{error&&<p role="alert">{error}</p>}{open&&<ReadReport location={location} postId={postId} onClose={()=>setOpen(false)}/>}</div>
}
