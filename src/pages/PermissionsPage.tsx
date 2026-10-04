import { SignupApprovals } from '../components/SignupApprovals'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import './ManagerCloseoutPage.css'
type Access = 'staff' | 'manager' | 'general_manager' | 'owner'
type Member = {user_id: string; name: string; job_role: string; access_level: Access}
export function PermissionsPage() {
 const [location, setLocation] = useState('')
 const [members, setMembers] = useState<Member[]>([])
 const [drafts, setDrafts] = useState<Record<string, Access>>({})
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState('')
 const [error, setError] = useState('')
 const [message, setMessage] = useState('')
 async function load(id: string) {
  const {data, error} = await supabase.rpc('closeout_permission_roster', {p_location_id:id})
  if(error) throw error
  const rows = (data ?? []) as Member[]
  setMembers(rows); setDrafts(Object.fromEntries(rows.map(m=>[m.user_id,m.access_level])))
 }
 useEffect(()=>{void (async()=>{
  try { const t=await loadTenantData(); const l=t.locations[0]; if(!l) throw new Error('No active location.'); setLocation(l.id); await load(l.id) }
  catch(e){setError(String((e as {message?:string}).message??e))}
  finally{setLoading(false)}
 })()},[])
 async function save(m: Member) {
  setSaving(m.user_id);setError('');setMessage('')
  try {
   const {error}=await supabase.rpc('closeout_set_permission',{p_location_id:location,p_user_id:m.user_id,p_access:drafts[m.user_id],p_expected:m.access_level})
   if(error) throw error
   await load(location); setMessage(`Saved access for ${m.name}.`)
  } catch(e){setError(String((e as {message?:string}).message??e))}
  finally{setSaving('')}
 }
 return <section className="mod-page"><Link to="/closeout">← Closeout</Link><h1>Permissions</h1>
 <p>Choose access for each employee at this location. Their job role stays the same.</p>
 <article className="mod-review"><p><strong>Staff:</strong> own closeout summary.</p><p><strong>Manager:</strong> all staff summaries, team recap, manager closeout, and point adjustments.</p><p><strong>General Manager:</strong> manager access plus form settings, point rules, and permissions.</p><p><strong>Owner:</strong> general manager administrative access, including private manager reviews and sales target settings.</p></article>
 {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
 {location && <SignupApprovals location={location} />}
 {loading ? <p>Loading permissions…</p> : members.map(m=><article className="mod-review" key={m.user_id}>
 <h2>{m.name}</h2><p>Job role: {m.job_role.replace(/_/g,' ')}</p>
 <label>Access<select disabled={!!saving} value={drafts[m.user_id] ?? m.access_level} onChange={e=>setDrafts(d=>({...d,[m.user_id]:e.target.value as Access}))}>
 <option value="staff">Staff</option><option value="manager">Manager</option><option value="general_manager">General Manager</option><option value="owner">Owner</option></select></label>
 <button disabled={!!saving || drafts[m.user_id]===m.access_level} onClick={()=>void save(m)}>{saving===m.user_id?'Saving…':'Save Access'}</button></article>)}
 </section>
}
