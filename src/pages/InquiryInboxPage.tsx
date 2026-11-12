import {TaskDialog} from '../components/TaskDialog'
import {useManagementAccess} from '../components/ManagementAccess'
import {inquiryQueue,inquiryNeedsAction} from '../lib/inquiryQueue'
import {InquiryReservationDialog,type InquiryReservationSource} from '../components/InquiryReservationDialog'
import {DesignSection} from '../components/DesignSection'
import {PageWord} from '../components/PageDesign'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { ScreenText } from '../components/ScreenText'
import './GuestFeedback.css'
import './InquiryStaffEditor.css'
import {inquiryDetailLabel,inquiryDetailValue,normalizeInquiryStatus} from '../lib/inquiryDisplay'

const studio = 'https://justinis-inquiry-studio.tealguppy.chatgpt.site'
type Row = { id:string; source:'Guest form'|'Host'; name:string; email:string; phone:string; guests:number; date:string; received:string; status:string; notes:string; details:Record<string,unknown> }
const statuses = ['New','Ready for review','Awaiting guest','Contacted','Confirmed','Closed']

export function InquiryInboxPage() {
  const management=useManagementAccess()
  const [archivedRows,setArchivedRows]=useState<Row[]>([]),[restoring,setRestoring]=useState('')
  const restoreLock=useRef(false)
  const [linked,setLinked]=useState<Record<string,string>>({})
  const [converting,setConverting]=useState<InquiryReservationSource|null>(null)
  const [location,setLocation] = useState('')
  const [rows,setRows] = useState<Row[]>([])
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [lastLoaded,setLastLoaded]=useState('')
  const [source,setSource] = useState('All')
  const [query,setQuery] = useState('')
  const [queueView,setQueueView]=useState('open'),[dateView,setDateView]=useState('all')
  const [selected,setSelected] = useState<Row|null>(null)
  const [saving,setSaving] = useState(false)
  const saveLock=useRef(false)
  const [editError,setEditError]=useState('')
  const [notice,setNotice]=useState('')
  const request = useCallback(async (loc:string, data?:unknown) => {
    const {data:sessionData,error:sessionError} = await supabase.auth.getSession()
    if(sessionError || !sessionData.session) throw Error('Please sign in again.')
    const response = await fetch(`${studio}/api/main-app?location=${encodeURIComponent(loc)}`,{
      method:data?'POST':'GET', cache:'no-store', signal:AbortSignal.timeout(20000), headers:{Authorization:`Bearer ${sessionData.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
      ...(data?{body:JSON.stringify(data)}:{})
    })
    const body = await response.json().catch(()=>({error:'Guest inbox unavailable.'}))
    if(!response.ok) throw Error(body.error||'Guest inbox unavailable.')
    return body
  },[])
  const reloadSequence=useRef(0),editingInquiry=useRef(false);editingInquiry.current=!!selected||saving||!!restoring||!!converting
  const reload = useCallback(async (loc:string) => {
    const ticket=++reloadSequence.current;setLoading(true);setError('')
    try{
    const results = await Promise.allSettled([request(loc),supabase.rpc('inquiry_combined_host_load',{p_location_id:loc}).abortSignal(AbortSignal.timeout(20000))])
    const next:Row[]=[];const errors:string[]=[]
    const links=await supabase.rpc('inquiry_reservation_links',{p_location_id:loc}).abortSignal(AbortSignal.timeout(20000));if(links.error)errors.push('Reservation links could not load: '+links.error.message)
    if(results[0].status==='fulfilled') for(const r of results[0].value.inquiries) {
      let details:Record<string,unknown>={};try{details=JSON.parse(r.details)}catch{details={Details:r.details}}
      next.push({id:r.id,source:'Guest form',name:r.name,email:r.email,phone:r.phone,guests:r.guests,date:r.event_date,received:r.received,status:r.status,notes:r.notes,details:{...details,Package:r.package_name,'Guest follow-up':r.response,'Email delivery':r.mail_status}})
    } else errors.push(String(results[0].reason?.message||results[0].reason))
    if(results[1].status==='fulfilled'&&!results[1].value.error) for(const r of results[1].value.data||[]) next.push({id:r.id,source:'Host',name:r.guest_name,email:r.email||'',phone:r.phone||'',guests:r.party_size,date:r.preferred_date||'',received:r.created_at,status:r.status,notes:r.internal_notes,details:{Type:r.inquiry_type,'First time':r.preferred_time,'Second time':r.second_preferred_time,'Third time':r.third_preferred_time,'Guest notes':r.guest_notes,Package:r.preset_label}})
    else errors.push('Host inquiries could not load. Run the inquiry connection SQL.')
    const archived=await supabase.rpc('inquiry_archive_list',{p_location_id:loc}).abortSignal(AbortSignal.timeout(20000));if(archived.error)errors.push('Archive filter: '+archived.error.message)
    if(ticket!==reloadSequence.current)return
    if(errors.length)throw Error(errors.join(' ')+' The previous inbox is retained; refresh before acting on stale records.')
    setLinked(Object.fromEntries((links.data??[]).map((r:{source:string;inquiry_id:string;reservation_date:string})=>[r.source+':'+r.inquiry_id,r.reservation_date])))
    const hidden=new Set((archived.data??[]).map((a:{source:string;inquiry_id:string})=>a.source+':'+a.inquiry_id))
    setArchivedRows(next.filter(r=>hidden.has(r.source+':'+r.id)))
    setRows(next.filter(r=>!hidden.has(r.source+':'+r.id)).sort((a,b)=>b.received.localeCompare(a.received)));setLastLoaded(new Date().toISOString());setError('')
    }catch(e){if(ticket===reloadSequence.current)setError(String((e as Error).message??e))}finally{if(ticket===reloadSequence.current)setLoading(false)}
  },[request])
  useEffect(()=>{let live=true;void loadTenantData().then(t=>{if(!live)return;const loc=t.locations[0]?.id;if(!loc)throw Error('No location found.');setLocation(loc)}).catch(e=>{if(live){setError(e.message);setLoading(false)}});return()=>{live=false}},[])
  useEffect(()=>{if(!location)return;void reload(location);const timer=window.setInterval(()=>{if(document.visibilityState==='visible'&&!editingInquiry.current)void reload(location)},60000);return()=>{reloadSequence.current++;window.clearInterval(timer)}},[location,reload])
  async function saveFollowup(row:Row){
    if(saveLock.current||loading||error)return;saveLock.current=true;setSaving(true);setEditError('');setNotice('')
    try{
      if(row.source==='Guest form')await request(location,{id:row.id,status:normalizeInquiryStatus(row.status),notes:row.notes})
      else{const r=await supabase.rpc('inquiry_staff_followup_save',{p_location_id:location,p_id:row.id,p_status:normalizeInquiryStatus(row.status),p_notes:row.notes});if(r.error)throw r.error}
      setSelected(null);setNotice('Inquiry follow-up saved.');await reload(location)
    }catch(e){setEditError(e instanceof Error?e.message:String((e as {message?:string}).message??'Could not save inquiry.'))}finally{saveLock.current=false;setSaving(false)}
  }
  async function removeInquiry(row:Row){
    if(saveLock.current||loading||error||!window.confirm('Remove '+row.name+'’s inquiry from the shared inbox? The original record and linked reservation will be kept.'))return
    saveLock.current=true;setSaving(true);setError('');try{const r=await supabase.rpc('inquiry_archive',{p_location_id:location,p_source:row.source,p_id:row.id});if(r.error)throw r.error;setSelected(null);setNotice('Inquiry removed from the shared inbox.');await reload(location)}catch(e){setError(String((e as Error).message??e))}finally{saveLock.current=false;setSaving(false)}
  }
  async function restoreInquiry(row:Row){if(restoreLock.current||loading||error||!management.manager)return;restoreLock.current=true;setRestoring(row.source+':'+row.id);setError('');try{const r=await supabase.rpc('inquiry_restore',{p_location_id:location,p_source:row.source,p_id:row.id});if(r.error)throw r.error;await reload(location);setNotice('Inquiry restored. Its original status and linked reservation are unchanged; use All statuses if needed.')}catch(e){setError(String((e as Error).message??e))}finally{restoreLock.current=false;setRestoring('')}}
  const centralToday=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const shown=inquiryQueue(rows,source,query,queueView,dateView,centralToday)
  return <DesignSection as="section" data-design-block="section.d4d031a214d672d3f8d8" className="page guest-feedback-inbox">
    <h2><ScreenText id="InquiryInbox.title">Inquiry inbox</ScreenText></h2>{management.manager&&<details><summary>Removed inquiries · {archivedRows.length} loaded</summary><p>Restore returns an inquiry to the shared inbox. It does not create or modify a reservation. Only inquiries available in the loaded source records appear here.</p>{archivedRows.map(row=><article className="card" key={row.source+':'+row.id}><strong>{row.name}</strong><p>{row.source} · {row.date||'Date not entered'} · {normalizeInquiryStatus(row.status)}</p><button type="button" disabled={!!restoring||loading||!!error} onClick={()=>void restoreInquiry(row)}>{restoring===row.source+':'+row.id?'Restoring…':'Restore inquiry'}</button></article>)}{!archivedRows.length&&<p>No removed inquiries in the loaded records.</p>}</details>}
    <p><Link to="/reservation-inquiries"><PageWord id="sectioncopy.e7e9355a0602bef7d543">{"Add host inquiry"}</PageWord></Link><PageWord id="sectioncopy.ba2325dd3e7764b36782">{" · "}</PageWord><a href={studio} target="_blank" rel="noopener noreferrer"><PageWord id="sectioncopy.7a02dcdac9ccd7bc8f6c">{"Guest form / QR link"}</PageWord></a><PageWord id="sectioncopy.5977e7e027ef032f7b08">{" · "}</PageWord><Link to="/inquiry-studio"><PageWord id="sectioncopy.f4819c6a9014c609b67c">{"Edit guest forms and packages"}</PageWord></Link></p>
    <p><PageWord id="sectioncopy.39fb9379c837c51df9c6">{"Guest submissions and host inquiries appear here. Each source shows its latest 2,000 requests. An inquiry is confirmed only after availability has been checked."}</PageWord></p>
    <p role="status">{lastLoaded?'Inbox last successfully loaded '+new Date(lastLoaded).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:true})+' CT. ':'Inbox has not loaded successfully yet. '}Visible inbox refreshes every minute while you are not editing. Alerts are separate from this refresh.</p><p>Inquiry follow-up status, saved booking, guest response and message delivery are separate. Marking an inquiry Confirmed does not reserve tables, create a reservation or send a confirmation.</p><p role="status">{rows.filter(inquiryNeedsAction).length} loaded inquiries need follow-up · {shown.length} shown. Counts cover loaded records only.</p><div className="form-grid"><label>Work queue<select value={queueView} onChange={e=>setQueueView(e.target.value)}><option value="open">Needs follow-up</option><option value="all">All statuses</option>{statuses.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>Event dates<select value={dateView} onChange={e=>setDateView(e.target.value)}><option value="all">All dates</option><option value="upcoming">Today onward · dated inquiries</option><option value="undated">Missing or unrecognized date</option></select></label><label><PageWord id="sectioncopy.0b49188fa8f3951b37b2">{"Search"}</PageWord><input value={query} onChange={e=>setQuery(e.target.value)} /></label><label><PageWord id="sectioncopy.ba17ef0d759b2e317f55">{"Source"}</PageWord><select value={source} onChange={e=>setSource(e.target.value)}>{['All','Guest form','Host'].map(s=><option key={s}>{s}</option>)}</select></label><button disabled={loading||!location} onClick={()=>void reload(location)}><PageWord id="sectioncopy.2c2196e819e8b728ae6f">{"Refresh"}</PageWord></button></div>
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert">{error}<PageWord id="sectioncopy.eddabafadd26ff5df215">{" Loaded records below may be incomplete."}</PageWord></p>}
    {loading&&<p role="status"><PageWord id="sectioncopy.c7111ee8b3b6a805ad7b">{"Loading inquiries…"}</PageWord></p>}
    {!loading&&!error&&!shown.length&&<p><PageWord id="sectioncopy.320aad7ba48b3e3d44c1">{"No matching inquiries."}</PageWord></p>}
    {shown.map(r=><article data-design-block="section.9f410a1bf4ed864f0f65" className="card" key={`${r.source}:${r.id}`}><h2>{r.name}</h2><p>{r.source}<PageWord id="sectioncopy.4af45b03cd6436663472">{" · "}</PageWord>{normalizeInquiryStatus(r.status)}<PageWord id="sectioncopy.001a5a201305e22c2f0f">{" · "}</PageWord>{r.guests}<PageWord id="sectioncopy.08b53abd2b71cb843e09">{" guests · "}</PageWord>{r.date||'Date not supplied'}</p><p><PageWord id="sectioncopy.d374c2c72cdc3f5cb74e">{"Received "}</PageWord>{new Date(r.received).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:true})}</p><button disabled={saving||loading||!!error} onClick={()=>{if(selected&&!window.confirm('Discard unsaved inquiry edits?'))return;setEditError('');setSelected({...r,status:normalizeInquiryStatus(r.status),notes:r.notes??''})}}><PageWord id="sectioncopy.d61ec54f5738fbed8170">{"View inquiry"}</PageWord></button><button type="button" disabled={saving||loading||!!error} onClick={()=>void removeInquiry(r)}>Remove inquiry</button><button type="button" disabled={saving||loading||!!error} onClick={()=>setConverting({...r})}>{linked[r.source+':'+r.id]?'View linked reservation':'Create reservation'}</button>{linked[r.source+':'+r.id]&&<p>Reservation linked · {linked[r.source+':'+r.id]}</p>}</article>)}
    {converting&&<InquiryReservationDialog location={location} inquiry={converting} onClose={()=>setConverting(null)} onSaved={()=>void reload(location)}/>}
    {selected&&<TaskDialog title="Inquiry details & follow-up" busy={saving} onClose={()=>{if(!saving&&window.confirm('Close without saving inquiry edits?'))setSelected(null)}}><DesignSection as="section" data-design-block="section.72a4b02d3f662c0d2d8e" className="card" aria-label="Inquiry details"><h2>{selected.name}</h2><p>{selected.source}<PageWord id="sectioncopy.f03736627a1135d38c4e">{" · "}</PageWord>{selected.guests}<PageWord id="sectioncopy.d51a288f9b3b5045ba03">{" guests · "}</PageWord>{selected.date||'Date not supplied'}</p><p><a href={`mailto:${selected.email}`}>{selected.email}</a><PageWord id="sectioncopy.b71237b57292e952c6ba">{" · "}</PageWord><a href={`tel:${selected.phone}`}>{selected.phone}</a></p><dl>{Object.entries(selected.details).filter(([k,v])=>v&&!['name','email','phone','category','guests','eventDate','budget','website'].includes(k)).map(([k,v])=><div key={k}><dt>{inquiryDetailLabel(k)}</dt><dd>{inquiryDetailValue(k,v)}</dd></div>)}</dl>
      <form className="inquiry-followup-editor" onSubmit={e=>{e.preventDefault();void saveFollowup(selected)}}><fieldset disabled={saving||loading||!!error}><legend>Edit inquiry follow-up</legend>
        {editError&&<p role="alert">{editError}</p>}
        <label>Status<select value={normalizeInquiryStatus(selected.status)} onChange={e=>setSelected({...selected,status:e.target.value})}>{[...new Set([...statuses,normalizeInquiryStatus(selected.status)])].map(status=><option key={status}>{status}</option>)}</select></label>
        <label>Internal notes<textarea value={selected.notes??''} maxLength={10000} rows={4} onChange={e=>setSelected({...selected,notes:e.target.value})}/></label>
        <button type="submit">{saving?'Saving…':'Save follow-up'}</button>
        <p>Saving follow-up does not create or change a reservation or send a guest message.</p>
      </fieldset></form>
      <button type="button" disabled={saving||loading||!!error} onClick={()=>setConverting({...selected})}>{linked[selected.source+':'+selected.id]?'View linked reservation':'Create reservation'}</button><p>Existing inquiry links are checked before a new booking is created.</p>
      <button disabled={saving} onClick={()=>{if(window.confirm('Close without saving inquiry edits?'))setSelected(null)}}><PageWord id="sectioncopy.7e43ffe46f5cb3578932">{"Close details"}</PageWord></button>
    </DesignSection></TaskDialog>}
  </DesignSection>
}
