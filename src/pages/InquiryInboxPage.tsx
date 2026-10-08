import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { ScreenText } from '../components/ScreenText'
import './GuestFeedback.css'

const studio = 'https://justinis-inquiry-studio.tealguppy.chatgpt.site'
type Row = { id:string; source:'Guest form'|'Host'; name:string; email:string; phone:string; guests:number; date:string; received:string; status:string; notes:string; details:Record<string,unknown> }
const statuses = ['New','Ready for review','Awaiting guest','Contacted','Confirmed','Closed']

export function InquiryInboxPage() {
  const [location,setLocation] = useState('')
  const [rows,setRows] = useState<Row[]>([])
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [source,setSource] = useState('All')
  const [query,setQuery] = useState('')
  const [selected,setSelected] = useState<Row|null>(null)
  const [saving,setSaving] = useState(false)
  const request = useCallback(async (loc:string, data?:unknown) => {
    const {data:sessionData,error:sessionError} = await supabase.auth.getSession()
    if(sessionError || !sessionData.session) throw Error('Please sign in again.')
    const response = await fetch(`${studio}/api/main-app?location=${encodeURIComponent(loc)}`,{
      method:data?'POST':'GET', headers:{Authorization:`Bearer ${sessionData.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
      ...(data?{body:JSON.stringify(data)}:{})
    })
    const body = await response.json().catch(()=>({error:'Guest inbox unavailable.'}))
    if(!response.ok) throw Error(body.error||'Guest inbox unavailable.')
    return body
  },[])
  const reload = useCallback(async (loc:string) => {
    setLoading(true);setError('')
    const results = await Promise.allSettled([request(loc),supabase.rpc('inquiry_combined_host_load',{p_location_id:loc})])
    const next:Row[]=[];const errors:string[]=[]
    if(results[0].status==='fulfilled') for(const r of results[0].value.inquiries) {
      let details:Record<string,unknown>={};try{details=JSON.parse(r.details)}catch{details={Details:r.details}}
      next.push({id:r.id,source:'Guest form',name:r.name,email:r.email,phone:r.phone,guests:r.guests,date:r.event_date,received:r.received,status:r.status,notes:r.notes,details:{...details,Package:r.package_name,'Guest follow-up':r.response,'Email delivery':r.mail_status}})
    } else errors.push(String(results[0].reason?.message||results[0].reason))
    if(results[1].status==='fulfilled'&&!results[1].value.error) for(const r of results[1].value.data||[]) next.push({id:r.id,source:'Host',name:r.guest_name,email:r.email||'',phone:r.phone||'',guests:r.party_size,date:r.preferred_date||'',received:r.created_at,status:r.status,notes:r.internal_notes,details:{Type:r.inquiry_type,'First time':r.preferred_time,'Second time':r.second_preferred_time,'Third time':r.third_preferred_time,'Guest notes':r.guest_notes,Package:r.preset_label}})
    else errors.push('Host inquiries could not load. Run the inquiry connection SQL.')
    setRows(next.sort((a,b)=>b.received.localeCompare(a.received)));setError(errors.join(' '));setLoading(false)
  },[request])
  useEffect(()=>{let live=true;void loadTenantData().then(t=>{if(!live)return;const loc=t.locations[0]?.id;if(!loc)throw Error('No location found.');setLocation(loc)}).catch(e=>{if(live){setError(e.message);setLoading(false)}});return()=>{live=false}},[])
  useEffect(()=>{if(!location)return;void reload(location);const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void reload(location)},60000);return()=>window.clearInterval(timer)},[location,reload])
  const shown=rows.filter(r=>(source==='All'||r.source===source)&&`${r.name} ${r.email} ${r.phone} ${r.status}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="page guest-feedback-inbox">
    <h1><ScreenText id="InquiryInbox.title">Inquiry inbox</ScreenText></h1>
    <p><Link to="/reservation-inquiries">Add host inquiry</Link> · <a href={studio} target="_blank" rel="noopener noreferrer">Guest form / QR link</a> · <Link to="/inquiry-studio">Edit guest forms and packages</Link></p>
    <p>Guest submissions and host inquiries appear here. Each source shows its latest 2,000 requests. An inquiry is confirmed only after availability has been checked.</p>
    <div className="form-grid"><label>Search<input value={query} onChange={e=>setQuery(e.target.value)} /></label><label>Source<select value={source} onChange={e=>setSource(e.target.value)}>{['All','Guest form','Host'].map(s=><option key={s}>{s}</option>)}</select></label><button disabled={loading||!location} onClick={()=>void reload(location)}>Refresh</button></div>
    {error&&<p role="alert">{error} Loaded records below may be incomplete.</p>}
    {loading&&<p role="status">Loading inquiries…</p>}
    {!loading&&!error&&!shown.length&&<p>No matching inquiries.</p>}
    {shown.map(r=><article className="card" key={`${r.source}:${r.id}`}><h2>{r.name}</h2><p>{r.source} · {r.status} · {r.guests} guests · {r.date||'Date not supplied'}</p><p>Received {new Date(r.received).toLocaleString()}</p><button onClick={()=>setSelected({...r})}>View inquiry</button></article>)}
    {selected&&<section className="card" aria-label="Inquiry details"><h2>{selected.name}</h2><p>{selected.source} · {selected.guests} guests · {selected.date||'Date not supplied'}</p><p><a href={`mailto:${selected.email}`}>{selected.email}</a> · <a href={`tel:${selected.phone}`}>{selected.phone}</a></p><dl>{Object.entries(selected.details).filter(([k,v])=>v&&!['name','email','phone','category','guests','eventDate','budget','website'].includes(k)).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
      {selected.source==='Guest form'?<><label>Status<select value={selected.status} onChange={e=>setSelected({...selected,status:e.target.value})}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><label>Internal notes<textarea value={selected.notes} maxLength={10000} onChange={e=>setSelected({...selected,notes:e.target.value})}/></label><button disabled={saving} onClick={async()=>{setSaving(true);try{await request(location,{id:selected.id,status:selected.status,notes:selected.notes});setSelected(null);await reload(location)}catch(e){setError(e instanceof Error?e.message:'Could not save.')}finally{setSaving(false)}}}>{saving?'Saving…':'Save follow-up'}</button></>:<p>Internal notes: {selected.notes||'None'}</p>}
      <button onClick={()=>setSelected(null)}>Close details</button>
    </section>}
  </section>
}
