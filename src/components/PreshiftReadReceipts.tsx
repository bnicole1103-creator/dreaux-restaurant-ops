// page-designer-instrumented
import { PageWord, PageOption } from "./PageDesign"
import { useEffect,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import './PreshiftReadReceipts.css'
type Status={post_id:string;version:number;read_at:string|null;previous_read_at:string|null;read_count:number|null;total_count:number|null}
type Person={visible_ms:number;first_opened_at:string|null;last_opened_at:string|null;home_opened_at:string|null;feed_viewed_at:string|null;user_id:string;name:string;read_at:string|null;previous_read_at:string|null}
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
 async function load(){const token=++sequence.current;setBusy(true);setError('');try{const r=await supabase.rpc('preshift_viewing_report',{p_location_id:location,p_post_id:postId});if(r.error)throw r.error;if(sequence.current===token)setData(r.data)}catch(e){if(sequence.current===token){setData(null);setError(message(e))}}finally{if(sequence.current===token)setBusy(false)}}
 useEffect(()=>{const d=dialog.current;if(!d)return;d.showModal();const cancel=(e:Event)=>{e.preventDefault();closeRef.current()};d.addEventListener('cancel',cancel);void load();return()=>{sequence.current++;d.removeEventListener('cancel',cancel);d.close()}},[location,postId])
 const read=data?.rows.filter(p=>p.first_opened_at).length??0
 const people=(data?.rows??[]).filter(p=>p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())&&(filter==='all'||(filter==='read'?!!p.first_opened_at:!p.first_opened_at)))
 return createPortal(<dialog ref={dialog} className="preshift-read-modal" aria-labelledby="preshift-read-title"><div data-design-block="copy.7539273a6de132ca.1" className="preshift-read-heading"><h2 data-design-block="copy.0b36688ec2f56b6c.1" id="preshift-read-title"><PageWord id="copy.ba1fe7cd7592b813.1">Pre-shift viewing receipts</PageWord></h2><button data-design-block="copy.79c4ce77618852f2.1" type="button" onClick={onClose} aria-label="Close read receipts"><PageWord id="copy.902bdaf4c6a86b3f.1">Close</PageWord></button></div>{error&&<p data-design-block="copy.fbd1a3bee2b470e4.1" role="alert">{error}</p>}{busy&&<p data-design-block="copy.4bb3d51bae8f0414.1" role="status"><PageWord id="copy.69d95d160230b8b5.1">Loading receipts…</PageWord></p>}{data&&<><h3 data-design-block="copy.b223410d179d3b3a.1">{data.title}</h3><p data-design-block="copy.1481eb6802322ffb.1">{read}<PageWord id="copy.f8afe1a8a37b6669.1">of </PageWord>{data.rows.length}<PageWord id="copy.8c2724f686f25072.1">active team accounts opened version </PageWord>{data.version}<PageWord id="copy.9fc7926a85b1f4f8.1">.</PageWord></p><p data-design-block="copy.1481eb6802322ffb.2"><PageWord id="copy.c4210952de975195.1">Visible time is recorded while the post is on screen and the app is active. It does not confirm reading or understanding.</PageWord></p><label data-design-block="copy.5a9431340f303546.1"><PageWord id="copy.9d879b97eecece40.1">Search team</PageWord><input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label data-design-block="copy.5a9431340f303546.2"><PageWord id="copy.2c61a5bb85a4bf12.1">Show</PageWord><select value={filter} onChange={e=>setFilter(e.target.value)}><PageOption designId="copy.dbdf4b3f90903869.1" value="all">Everyone</PageOption><PageOption designId="copy.0a7058eb07affc9a.1" value="read">Opened</PageOption><PageOption designId="copy.9520c03380773f37.1" value="unread">Not opened yet</PageOption></select></label><div data-design-block="copy.8377a5f5adc189e7.1" className="preshift-read-list">{people.map(p=><article data-design-block="copy.332e288e8f3114f0.1" key={p.user_id}><strong>{p.name}</strong><p>{p.first_opened_at?'First opened · '+stamp(p.first_opened_at):'No opening recorded for this version'}</p>{p.last_opened_at&&<p><PageWord id="sectioncopy.3bbb098b2d7ef476b1f4">{"Last opened · "}</PageWord>{stamp(p.last_opened_at)}</p>}{p.home_opened_at&&<p><PageWord id="sectioncopy.139d5d61b34c4373db85">{"Home: Read pre-shift · "}</PageWord>{stamp(p.home_opened_at)}</p>}{p.feed_viewed_at&&<p><PageWord id="sectioncopy.b39fd18742f9f8031bfa">{"Feed: post viewed · "}</PageWord>{stamp(p.feed_viewed_at)}</p>}<p><PageWord id="sectioncopy.2f830bc73eb057575107">{"Visible time · "}</PageWord>{Math.floor((p.visible_ms??0)/60000)}<PageWord id="sectioncopy.29478b009917dbc2efe6">{" min "}</PageWord>{Math.floor(((p.visible_ms??0)%60000)/1000)}<PageWord id="sectioncopy.d930b079ad5b6baa0d21">{" sec"}</PageWord></p></article>)}</div>{!people.length&&<p data-design-block="copy.1481eb6802322ffb.4"><PageWord id="copy.136d9e23f390838e.1">No matching team members.</PageWord></p>}</>}<button data-design-block="copy.5d870c148a899d64.1" type="button" disabled={busy} onClick={()=>void load()}><PageWord id="copy.368efcfc72120469.1">Refresh receipts</PageWord></button></dialog>,document.body)
}
export function PreshiftReadReceipt({location,postId,version,status,manager}:{location:string;postId:string;version:number;status?:Status;manager:boolean;onChange:()=>void}){
 const [open,setOpen]=useState(false)
 useEffect(()=>setOpen(false),[location,postId,version])
 if(!manager)return null
 return <div className="preshift-read-status"><button type="button" disabled={!status} onClick={()=>setOpen(true)}><PageWord id="sectioncopy.49ed945e173d9c9972c9">{"Viewing receipts"}</PageWord></button>{open&&<ReadReport location={location} postId={postId} onClose={()=>setOpen(false)}/>}</div>
}
