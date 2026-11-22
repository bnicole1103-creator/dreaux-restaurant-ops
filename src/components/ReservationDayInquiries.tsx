import { InquiryArrivalOffer } from './InquiryArrivalOffer'
import {watchReservations} from '../lib/reservationRefresh'
import {inquiryDetailLabel,inquiryDetailValue} from '../lib/inquiryDisplay'
import {useEffect,useId,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {useAppAccess} from './AppAccess'
import {TaskDialog} from './TaskDialog'
import {InquiryReservationDialog} from './InquiryReservationDialog'
import {InquiryTagBadges} from './InquiryTags'
import {supabase} from '../lib/supabase'
import {inquiryNeedsAction,inquiryQueue} from '../lib/inquiryQueue'
import {requestStudio,studioInquiry,hostInquiry,inquiryKey,type ManagementInquiry} from '../lib/reservationManagement'
import { InquiryDayOverview } from './ReservationDayOverview'
export function ReservationDayInquiries({location,day,onConfirmation,onChanged}:{location:string;day:string;onConfirmation:(id:string,name:string,date:string)=>void;onChanged:()=>void}){
 const [expanded,setExpanded]=useState(true)
 const panelId=useId()
 const access=useAppAccess(),allowed=access.can('guests','inbox')
 const [rows,setRows]=useState<ManagementInquiry[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[last,setLast]=useState(''),[notice,setNotice]=useState(''),[newCount,setNewCount]=useState(0)
 const [selected,setSelected]=useState<ManagementInquiry|null>(null),[convert,setConvert]=useState<ManagementInquiry|null>(null),[reply,setReply]=useState(false)
 const known=useRef<Set<string>|null>(null),seq=useRef(0)
 useEffect(()=>{known.current=null;setRows([]);setLast('');setNewCount(0);setNotice('');setSelected(null);setConvert(null)},[location,day])
 useEffect(()=>{if(!allowed||!location)return;let active=true;const refresh=async()=>{if(document.visibilityState==='hidden')return;const ticket=++seq.current;setLoading(true);try{
  const results=await Promise.allSettled([requestStudio(location),Promise.resolve(supabase.rpc('inquiry_combined_host_load',{p_location_id:location}).abortSignal(AbortSignal.timeout(20000))),Promise.resolve(supabase.rpc('inquiry_reservation_links',{p_location_id:location}).abortSignal(AbortSignal.timeout(20000))),Promise.resolve(supabase.rpc('inquiry_archive_list',{p_location_id:location}).abortSignal(AbortSignal.timeout(20000)))])
  if(!active||ticket!==seq.current)return;
  const problems=results.flatMap((r,i)=>r.status==='rejected'?[['Guest inbox','Host inbox','Linked bookings','Archive'][i]+': '+String(r.reason?.message??r.reason)]:i>0&&(r.value as any).error?[String((r.value as any).error.message)]:[])
  if(problems.length)throw Error(problems.join(' · '))
  const values=results.map(r=>r.status==='fulfilled'?r.value:null) as any[]
  const linked=new Set((values[2].data??[]).map((r:any)=>r.source+':'+r.inquiry_id)),hidden=new Set((values[3].data??[]).map((r:any)=>r.source+':'+r.inquiry_id))
  const pending:ManagementInquiry[]=[...values[0].inquiries.map(studioInquiry),...(values[1].data??[]).map(hostInquiry)].filter(r=>r.date===day&&inquiryNeedsAction(r)&&!linked.has(inquiryKey(r))&&!hidden.has(inquiryKey(r)))
  const next=inquiryQueue(pending,'All','','open','all',day)
  if(known.current){const added=next.filter(r=>!known.current!.has(inquiryKey(r))).length;if(added)setNewCount(n=>n+added)}
  known.current=new Set(next.map(inquiryKey));setRows(next);setLast(new Date().toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour12:true}));setError('')
 }catch(e){if(active&&ticket===seq.current)setError(String((e as Error).message??e))}finally{if(active&&ticket===seq.current)setLoading(false)}};void refresh();const stop=watchReservations(location,()=>void refresh());return()=>{active=false;seq.current++;stop()}},[location,day,allowed,revision])
 function open(row:ManagementInquiry){setSelected(row);setReply(false);setNewCount(0)}
 if(!allowed)return <p>Inquiry access is restricted for your account.</p>
 return <section className={'reservation-hub-inquiries'+(rows.length?' has-pending':'')} aria-label="Pending inquiries for selected day"><div className="reservation-hub-heading"><h2>{rows.length?'⚠ Action needed':'Inquiries'} · {day}</h2><div className="reservation-hub-controls">{expanded&&<button type="button" disabled={loading} onClick={()=>setRevision(n=>n+1)}>Refresh inquiries</button>}<button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={()=>setExpanded(value=>!value)}>{expanded?'Minimize inquiries':'Expand inquiries'+(rows.length?' ('+rows.length+' pending)':'')}</button></div></div>{newCount>0&&<p role="alert">URGENT: {newCount} new {newCount===1?'inquiry has':'inquiries have'} arrived for this day. Review availability and reply.</p>}<div id={panelId} hidden={!expanded}>{rows.length>0&&<p role="status"><strong>{rows.length} pending requests</strong> · Oldest received first. Review → add booking & prepare confirmation, or reply that the requested time is unavailable.</p>}{error&&<p role="alert">Inquiry refresh failed: {error}. Previous records may be incomplete; refresh before acting.</p>}{loading&&!last&&<p role="status">Checking guest and host inquiries…</p>}{!rows.length&&!loading&&!error&&<p>No pending inquiries for this day in the loaded inbox.</p>}<div className="reservation-hub-inquiry-list">{rows.map(row=><article key={inquiryKey(row)} className="reservation-hub-card"><div className="reservation-hub-heading"><strong>{row.name}</strong><strong>{row.guests??'?'} guests</strong></div><p>{row.source} · {row.status} · Received {new Date(row.received).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:true})}</p><InquiryTagBadges notes={row.notes}/><button type="button" disabled={!!error} onClick={()=>open(row)}>Review inquiry & day’s bookings</button></article>)}</div>{last&&<small>Last checked {last} CT · Refreshes every 30 seconds while visible. Each inbox source supplies its latest 2,000 requests. <Link to="/inquiry-inbox">All inquiries</Link></small>}{notice&&<p role="status">{notice}</p>}</div>
 {selected&&!convert&&<TaskDialog title="Review inquiry" onClose={()=>setSelected(null)}><div className="reservation-hub"><h2>{selected.name} · {selected.guests} guests</h2><p>{selected.date} · {selected.phone||'No phone'} · {selected.email||'No email'}</p><dl>{Object.entries(selected.details).filter(([,v])=>!!v).map(([k,v])=><div key={k}><dt>{inquiryDetailLabel(k)}</dt><dd>{inquiryDetailValue(k,v)}</dd></div>)}</dl><p style={{whiteSpace:'pre-wrap'}}>{selected.notes}</p><InquiryDayOverview key={inquiryKey(selected)} location={location} inquiry={selected}/><div className="reservation-hub-controls"><button type="button" disabled={!!error} onClick={()=>setConvert(selected)}>Review & add → confirmation</button><button type="button" disabled={!!error} onClick={()=>setReply(true)}>Requested time unavailable · guest options</button></div>{reply&&<section><InquiryArrivalOffer key={inquiryKey(selected)} location={location} inquiry={selected}/></section>}</div></TaskDialog>}
 {convert&&<InquiryReservationDialog location={location} inquiry={convert} onClose={()=>setConvert(null)} onSaved={()=>{setRevision(n=>n+1);onChanged()}} onReservationSaved={r=>{const row=convert;setConvert(null);setSelected(null);onConfirmation(r.reservation_id,row.name,r.reservation_date)}}/>}
 </section>
}
