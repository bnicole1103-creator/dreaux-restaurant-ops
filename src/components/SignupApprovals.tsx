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
 return <article className="mod-review"><h2>Staff registration</h2>
  <p>Share this location’s registration link. New accounts wait for your approval.</p>
  <button type="button" disabled={busy} onClick={()=>void getLink()}>Show registration link</button>
  {link && <label>Link to share<input readOnly value={link} onFocus={e=>e.target.select()} /><button type="button" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setMessage('Link copied.')).catch(()=>setMessage('Select the link above and copy it.'))}>Copy link</button></label>}
  <h3>Pending approvals</h3><button type="button" disabled={busy} onClick={()=>void load()}>Refresh requests</button>
  {!busy && requests.length===0 && <p>No pending requests.</p>}
  {requests.map(r=>{const d=drafts[r.id] ?? {role:'employee',access:'staff'};return <article className="mod-review" key={r.id}>
   <h3>{r.name}</h3><p>{r.email}</p>
   <label>Job role<select value={d.role} disabled={busy} onChange={e=>setDrafts(v=>({...v,[r.id]:{...d,role:e.target.value}}))}>
    {['employee','host','server','bartender','busser','kitchen','assistant_manager','manager','general_manager'].map(role=><option key={role} value={role}>{role.replace(/_/g,' ')}</option>)}
   </select></label>
   <label>Closeout and points access<select value={d.access} disabled={busy} onChange={e=>setDrafts(v=>({...v,[r.id]:{...d,access:e.target.value}}))}>
    <option value="staff">Staff</option><option value="manager">Manager</option><option value="general_manager">General Manager</option>
   </select></label>
   <button disabled={busy} onClick={()=>void decide(r,true)}>Approve</button> <button disabled={busy} onClick={()=>void decide(r,false)}>Decline</button>
  </article>})}
  {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
 </article>
}
