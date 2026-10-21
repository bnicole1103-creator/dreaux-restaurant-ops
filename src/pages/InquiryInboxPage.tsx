import {DesignSection} from '../components/DesignSection'
import {PageWord} from '../components/PageDesign'
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
  return <DesignSection as="section" data-design-block="section.d4d031a214d672d3f8d8" className="page guest-feedback-inbox">
    <h2><ScreenText id="InquiryInbox.title">Inquiry inbox</ScreenText></h2>
    <p><Link to="/reservation-inquiries"><PageWord id="sectioncopy.e7e9355a0602bef7d543">{"Add host inquiry"}</PageWord></Link><PageWord id="sectioncopy.ba2325dd3e7764b36782">{" · "}</PageWord><a href={studio} target="_blank" rel="noopener noreferrer"><PageWord id="sectioncopy.7a02dcdac9ccd7bc8f6c">{"Guest form / QR link"}</PageWord></a><PageWord id="sectioncopy.5977e7e027ef032f7b08">{" · "}</PageWord><Link to="/inquiry-studio"><PageWord id="sectioncopy.f4819c6a9014c609b67c">{"Edit guest forms and packages"}</PageWord></Link></p>
    <p><PageWord id="sectioncopy.39fb9379c837c51df9c6">{"Guest submissions and host inquiries appear here. Each source shows its latest 2,000 requests. An inquiry is confirmed only after availability has been checked."}</PageWord></p>
    <div className="form-grid"><label><PageWord id="sectioncopy.0b49188fa8f3951b37b2">{"Search"}</PageWord><input value={query} onChange={e=>setQuery(e.target.value)} /></label><label><PageWord id="sectioncopy.ba17ef0d759b2e317f55">{"Source"}</PageWord><select value={source} onChange={e=>setSource(e.target.value)}>{['All','Guest form','Host'].map(s=><option key={s}>{s}</option>)}</select></label><button disabled={loading||!location} onClick={()=>void reload(location)}><PageWord id="sectioncopy.2c2196e819e8b728ae6f">{"Refresh"}</PageWord></button></div>
    {error&&<p role="alert">{error}<PageWord id="sectioncopy.eddabafadd26ff5df215">{" Loaded records below may be incomplete."}</PageWord></p>}
    {loading&&<p role="status"><PageWord id="sectioncopy.c7111ee8b3b6a805ad7b">{"Loading inquiries…"}</PageWord></p>}
    {!loading&&!error&&!shown.length&&<p><PageWord id="sectioncopy.320aad7ba48b3e3d44c1">{"No matching inquiries."}</PageWord></p>}
    {shown.map(r=><article data-design-block="section.9f410a1bf4ed864f0f65" className="card" key={`${r.source}:${r.id}`}><h2>{r.name}</h2><p>{r.source}<PageWord id="sectioncopy.4af45b03cd6436663472">{" · "}</PageWord>{r.status}<PageWord id="sectioncopy.001a5a201305e22c2f0f">{" · "}</PageWord>{r.guests}<PageWord id="sectioncopy.08b53abd2b71cb843e09">{" guests · "}</PageWord>{r.date||'Date not supplied'}</p><p><PageWord id="sectioncopy.d374c2c72cdc3f5cb74e">{"Received "}</PageWord>{new Date(r.received).toLocaleString()}</p><button onClick={()=>setSelected({...r})}><PageWord id="sectioncopy.d61ec54f5738fbed8170">{"View inquiry"}</PageWord></button></article>)}
    {selected&&<DesignSection as="section" data-design-block="section.72a4b02d3f662c0d2d8e" className="card" aria-label="Inquiry details"><h2>{selected.name}</h2><p>{selected.source}<PageWord id="sectioncopy.f03736627a1135d38c4e">{" · "}</PageWord>{selected.guests}<PageWord id="sectioncopy.d51a288f9b3b5045ba03">{" guests · "}</PageWord>{selected.date||'Date not supplied'}</p><p><a href={`mailto:${selected.email}`}>{selected.email}</a><PageWord id="sectioncopy.b71237b57292e952c6ba">{" · "}</PageWord><a href={`tel:${selected.phone}`}>{selected.phone}</a></p><dl>{Object.entries(selected.details).filter(([k,v])=>v&&!['name','email','phone','category','guests','eventDate','budget','website'].includes(k)).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
      {selected.source==='Guest form'?<><label><PageWord id="sectioncopy.670dd7efec6c85bd423f">{"Status"}</PageWord><select value={selected.status} onChange={e=>setSelected({...selected,status:e.target.value})}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><label><PageWord id="sectioncopy.a7fd0deb507b0c2bf677">{"Internal notes"}</PageWord><textarea value={selected.notes} maxLength={10000} onChange={e=>setSelected({...selected,notes:e.target.value})}/></label><button disabled={saving} onClick={async()=>{setSaving(true);try{await request(location,{id:selected.id,status:selected.status,notes:selected.notes});setSelected(null);await reload(location)}catch(e){setError(e instanceof Error?e.message:'Could not save.')}finally{setSaving(false)}}}>{saving?'Saving…':'Save follow-up'}</button></>:<p><PageWord id="sectioncopy.198f0acbc70f2da29c9f">{"Internal notes: "}</PageWord>{selected.notes||'None'}</p>}
      <button onClick={()=>setSelected(null)}><PageWord id="sectioncopy.7e43ffe46f5cb3578932">{"Close details"}</PageWord></button>
    </DesignSection>}
  </DesignSection>
}
