import { ScreenText } from "./ScreenText"
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
type Request = {id: string; name: string; email: string; created_at: string}
export function SignupApprovals({location}: {location: string}) {
 const [requests,setRequests]=useState<Request[]>([])
 const [link,setLink]=useState('')
 const [drafts,setDrafts]=useState<Record<string,{role:string;access:string}>>({})
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)
 async function load() {
  setBusy(true);setError('')
  try {
   const {data,error}=await supabase.rpc('staff_signup_queue',{p_location_id:location})
   if(error) throw error
   setRequests(data ?? [])
  }catch(e){setError(String((e as {message?:string}).message ?? e))}
  finally{setBusy(false)}
 }
 useEffect(()=>{setLink('');setDrafts({});void load()},[location])
 async function getLink() {
  setBusy(true);setError('');setMessage('')
  try {
   const {data,error}=await supabase.rpc('staff_signup_link',{p_location_id:location})
   if(error) throw error
   const url=new URL('/',window.location.origin);url.searchParams.set('join',String(data));setLink(url.toString())
  }catch(e){setError(String((e as {message?:string}).message ?? e))}
  finally{setBusy(false)}
 }
 async function decide(r: Request, approve: boolean) {
  const draft=drafts[r.id] ?? {role:'employee',access:'staff'}
  if(!window.confirm(`${approve ? 'Approve' : 'Decline'} access for ${r.name}?`)) return
  setBusy(true);setError('');setMessage('')
  try {
   const {error}=await supabase.rpc('staff_signup_decide',{p_request_id:r.id,p_approve:approve,p_job_role:draft.role,p_access:draft.access})
   if(error) throw error
   setMessage(`${r.name}: ${approve ? 'approved' : 'declined'}.`);await load()
  }catch(e){setError(String((e as {message?:string}).message ?? e))}
  finally{setBusy(false)}
 }
 return <article className="mod-review"><h2><ScreenText id="SignupApprovals.95a9f1d8b4c13366">Staff registration</ScreenText></h2>
  <p><ScreenText id="SignupApprovals.3a73d6354f18049d">Share this location’s registration link. New accounts wait for your approval.</ScreenText></p>
  <button type="button" disabled={busy} onClick={()=>void getLink()}><ScreenText id="SignupApprovals.05123828a691762a">Show registration link</ScreenText></button>
  {link && <label><ScreenText id="SignupApprovals.05fe0dd879dc8934">Link to share</ScreenText><input readOnly value={link} onFocus={e=>e.target.select()} /><button type="button" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setMessage('Link copied.')).catch(()=>setMessage('Select the link above and copy it.'))}><ScreenText id="SignupApprovals.568b322cd36d6794">Copy link</ScreenText></button></label>}
  <h3><ScreenText id="SignupApprovals.85ec8552b653471b">Pending approvals</ScreenText></h3><button type="button" disabled={busy} onClick={()=>void load()}><ScreenText id="SignupApprovals.d3a52cdec2918e1c">Refresh requests</ScreenText></button>
  {!busy && requests.length===0 && <p><ScreenText id="SignupApprovals.039c735a83bd164d">No pending requests.</ScreenText></p>}
  {requests.map(r=>{const d=drafts[r.id] ?? {role:'employee',access:'staff'};return <article className="mod-review" key={r.id}>
   <h3>{r.name}</h3><p>{r.email}</p>
   <label><ScreenText id="SignupApprovals.f4c886ee06bf98eb">Job role</ScreenText><select value={d.role} disabled={busy} onChange={e=>setDrafts(v=>({...v,[r.id]:{...d,role:e.target.value,access:e.target.value==='owner'?'owner':d.access}}))}>
    {['employee','host','server','bartender','busser','kitchen','assistant_manager','manager','general_manager','owner'].map(role=><option key={role} value={role}>{role.replace(/_/g,' ')}</option>)}
   </select></label>
   <label><ScreenText id="SignupApprovals.a3c282007006d3a4">Closeout and points access</ScreenText><select value={d.access} disabled={busy} onChange={e=>setDrafts(v=>({...v,[r.id]:{...d,access:e.target.value}}))}>
    <option value="staff"><ScreenText id="SignupApprovals.da3517fc883115dc">Staff</ScreenText></option><option value="manager"><ScreenText id="SignupApprovals.512df00a51aa1f81">Manager</ScreenText></option><option value="general_manager"><ScreenText id="SignupApprovals.4d708599f2eb2fee">General Manager</ScreenText></option><option value="owner"><ScreenText id="SignupApprovals.54fb778996195dc7">Owner</ScreenText></option>
   </select></label>
   <button disabled={busy} onClick={()=>void decide(r,true)}><ScreenText id="SignupApprovals.a8b1800d91c87bb4">Approve</ScreenText></button> <button disabled={busy} onClick={()=>void decide(r,false)}><ScreenText id="SignupApprovals.efa6b04a57456942">Decline</ScreenText></button>
  </article>})}
  {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
 </article>
}
