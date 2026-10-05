import { ScreenText } from "../components/ScreenText"
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
 return <section className="mod-page"><Link to="/closeout"><ScreenText id="PermissionsPage.89412119744c72b5">← Closeout</ScreenText></Link><h1><ScreenText id="PermissionsPage.eba4c32dd13c83d3">Permissions</ScreenText></h1>
 <p><ScreenText id="PermissionsPage.d12d88b97232e821">Choose access for each employee at this location. Their job role stays the same.</ScreenText></p>
 <article className="mod-review"><p><strong><ScreenText id="PermissionsPage.56fcfaa54ccb7d09">Staff:</ScreenText></strong><ScreenText id="PermissionsPage.681d3b871530589d"> own closeout summary.</ScreenText></p><p><strong><ScreenText id="PermissionsPage.88900bc321bb8122">Manager:</ScreenText></strong><ScreenText id="PermissionsPage.6191742eab1e9efb"> all staff summaries, team recap, manager closeout, and point adjustments.</ScreenText></p><p><strong><ScreenText id="PermissionsPage.5bc58a6ada2e921f">General Manager:</ScreenText></strong><ScreenText id="PermissionsPage.f06c082707c73f84"> manager access plus form settings, point rules, and permissions.</ScreenText></p><p><strong><ScreenText id="PermissionsPage.02d0a9e3451617bf">Owner:</ScreenText></strong><ScreenText id="PermissionsPage.3deac9dec36bd1fc"> general manager administrative access, including private manager reviews and sales target settings.</ScreenText></p></article>
 {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
 {location && <SignupApprovals location={location} />}
 {loading ? <p><ScreenText id="PermissionsPage.6663fb06ab55cf4f">Loading permissions…</ScreenText></p> : members.map(m=><article className="mod-review" key={m.user_id}>
 <h2>{m.name}</h2><p><ScreenText id="PermissionsPage.d3d9fc4260ebd42e">Job role: </ScreenText>{m.job_role.replace(/_/g,' ')}</p>
 <label><ScreenText id="PermissionsPage.b2d9b93ee36796d9">Access</ScreenText><select disabled={!!saving} value={drafts[m.user_id] ?? m.access_level} onChange={e=>setDrafts(d=>({...d,[m.user_id]:e.target.value as Access}))}>
 <option value="staff"><ScreenText id="PermissionsPage.175d78737a59a4d4">Staff</ScreenText></option><option value="manager"><ScreenText id="PermissionsPage.937330689bcbced3">Manager</ScreenText></option><option value="general_manager"><ScreenText id="PermissionsPage.9c4a744e3bd4548e">General Manager</ScreenText></option><option value="owner"><ScreenText id="PermissionsPage.7d46bc1460e96051">Owner</ScreenText></option></select></label>
 <button disabled={!!saving || drafts[m.user_id]===m.access_level} onClick={()=>void save(m)}>{saving===m.user_id?'Saving…':'Save Access'}</button></article>)}
 </section>
}
