// page-designer-instrumented
import { PageOption } from "./PageDesign"
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
 return <article data-design-block="copy.dcdf4701a196b176.1" className="mod-review"><h2 data-design-block="copy.6460bbc8cc5d375c.1"><ScreenText id="SignupApprovals.95a9f1d8b4c13366">Staff registration</ScreenText></h2>
  <p data-design-block="copy.fccf04de874a28a6.1"><ScreenText id="SignupApprovals.3a73d6354f18049d">Share this location’s registration link. New accounts wait for your approval.</ScreenText></p>
  <button data-design-block="copy.b84d5b1189dff689.1" type="button" disabled={busy} onClick={()=>void getLink()}><ScreenText id="SignupApprovals.05123828a691762a">Show registration link</ScreenText></button>
  {link && <label data-design-block="copy.e9a700bc6f9db62a.1"><ScreenText id="SignupApprovals.05fe0dd879dc8934">Link to share</ScreenText><input readOnly value={link} onFocus={e=>e.target.select()} /><button data-design-block="copy.7d713a85d6427841.1" type="button" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setMessage('Link copied.')).catch(()=>setMessage('Select the link above and copy it.'))}><ScreenText id="SignupApprovals.568b322cd36d6794">Copy link</ScreenText></button></label>}
  <h3 data-design-block="copy.9127f2e04348955c.1"><ScreenText id="SignupApprovals.85ec8552b653471b">Pending approvals</ScreenText></h3><button data-design-block="copy.6bb084af5432592f.1" type="button" disabled={busy} onClick={()=>void load()}><ScreenText id="SignupApprovals.d3a52cdec2918e1c">Refresh requests</ScreenText></button>
  {!busy && requests.length===0 && <p data-design-block="copy.fccf04de874a28a6.2"><ScreenText id="SignupApprovals.039c735a83bd164d">No pending requests.</ScreenText></p>}
  {requests.map(r=>{const d=drafts[r.id] ?? {role:'employee',access:'staff'};return <article data-design-block="copy.446ae97690ed27cf.1" className="mod-review" key={r.id}>
   <h3 data-design-block="copy.9127f2e04348955c.2">{r.name}</h3><p data-design-block="copy.fccf04de874a28a6.3">{r.email}</p>
   <label data-design-block="copy.e9a700bc6f9db62a.2"><ScreenText id="SignupApprovals.f4c886ee06bf98eb">Job role</ScreenText><select value={d.role} disabled={busy} onChange={e=>setDrafts(v=>({...v,[r.id]:{...d,role:e.target.value,access:e.target.value==='owner'?'owner':d.access}}))}>
    {['employee','host','server','bartender','busser','kitchen','assistant_manager','manager','general_manager','owner'].map(role=><option key={role} value={role}>{role.replace(/_/g,' ')}</option>)}
   </select></label>
   <label data-design-block="copy.e9a700bc6f9db62a.3"><ScreenText id="SignupApprovals.a3c282007006d3a4">Closeout and points access</ScreenText><select value={d.access} disabled={busy} onChange={e=>setDrafts(v=>({...v,[r.id]:{...d,access:e.target.value}}))}>
    <PageOption designId="copy.ad056f1c1fbf8199.1" value="staff"><ScreenText plain id="SignupApprovals.da3517fc883115dc">Staff</ScreenText></PageOption><PageOption designId="copy.250f8d8d409f7415.1" value="manager"><ScreenText plain id="SignupApprovals.512df00a51aa1f81">Manager</ScreenText></PageOption><PageOption designId="copy.b879e2ecf791517f.1" value="general_manager"><ScreenText plain id="SignupApprovals.4d708599f2eb2fee">General Manager</ScreenText></PageOption><PageOption designId="copy.7b9eed62706aef0f.1" value="owner"><ScreenText plain id="SignupApprovals.54fb778996195dc7">Owner</ScreenText></PageOption>
   </select></label>
   <button data-design-block="copy.716308f10e3c63a3.1" disabled={busy} onClick={()=>void decide(r,true)}><ScreenText id="SignupApprovals.a8b1800d91c87bb4">Approve</ScreenText></button> <button data-design-block="copy.e310de1b8a8c4799.1" disabled={busy} onClick={()=>void decide(r,false)}><ScreenText id="SignupApprovals.efa6b04a57456942">Decline</ScreenText></button>
  </article>})}
  {error && <p data-design-block="copy.70c5821183bc5e83.1" role="alert">{error}</p>}{message && <p data-design-block="copy.a9dafbd43b9e4453.1" role="status">{message}</p>}
 </article>
}
