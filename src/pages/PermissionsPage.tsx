// page-designer-instrumented
import { PageWord, PageOption } from "../components/PageDesign"
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
 return <section data-design-block="copy.7f407d1fc881c4bc.1" className="mod-page"><Link to="/closeout"><ScreenText id="PermissionsPage.89412119744c72b5">← Closeout</ScreenText></Link><h1 data-design-block="copy.7159855716041a98.1"><ScreenText id="PermissionsPage.eba4c32dd13c83d3">Permissions</ScreenText></h1>
 <p data-design-block="copy.61f98721237f9747.1"><ScreenText id="PermissionsPage.d12d88b97232e821">Choose access for each employee at this location. Their job role stays the same.</ScreenText></p>
 <article data-design-block="copy.7a1e4d6c1ba10d5f.1" className="mod-review"><p data-design-block="copy.61f98721237f9747.2"><strong><ScreenText id="PermissionsPage.56fcfaa54ccb7d09">Staff:</ScreenText></strong><ScreenText id="PermissionsPage.681d3b871530589d"> own closeout summary.</ScreenText></p><p data-design-block="copy.61f98721237f9747.3"><strong><ScreenText id="PermissionsPage.88900bc321bb8122">Manager:</ScreenText></strong><ScreenText id="PermissionsPage.6191742eab1e9efb"> all staff summaries, team recap, manager closeout, and point adjustments.</ScreenText></p><p data-design-block="copy.61f98721237f9747.4"><strong><ScreenText id="PermissionsPage.5bc58a6ada2e921f">General Manager:</ScreenText></strong><ScreenText id="PermissionsPage.f06c082707c73f84"> manager access plus form settings, point rules, and permissions.</ScreenText></p><p data-design-block="copy.61f98721237f9747.5"><strong><ScreenText id="PermissionsPage.02d0a9e3451617bf">Owner:</ScreenText></strong><ScreenText id="PermissionsPage.3deac9dec36bd1fc"> general manager administrative access, including private manager reviews and sales target settings.</ScreenText></p></article>
 {error && <p data-design-block="copy.02a076fd1e805665.1" role="alert">{error}</p>}{message && <p data-design-block="copy.3b35439f980eb845.1" role="status">{message}</p>}
 {location && <SignupApprovals location={location} />}
 {loading ? <p data-design-block="copy.61f98721237f9747.6"><ScreenText id="PermissionsPage.6663fb06ab55cf4f">Loading permissions…</ScreenText></p> : members.map(m=><article data-design-block="copy.b278d5a76355cf38.1" className="mod-review" key={m.user_id}>
 <h2 data-design-block="copy.00f6a5b15d5288da.1">{m.name}</h2><p data-design-block="copy.61f98721237f9747.7"><ScreenText id="PermissionsPage.d3d9fc4260ebd42e">Job role: </ScreenText>{m.job_role.replace(/_/g,' ')}</p>
 <label data-design-block="copy.6d99f4603abaaf0b.1"><ScreenText id="PermissionsPage.b2d9b93ee36796d9">Access</ScreenText><select disabled={!!saving} value={drafts[m.user_id] ?? m.access_level} onChange={e=>setDrafts(d=>({...d,[m.user_id]:e.target.value as Access}))}>
 <PageOption designId="copy.f6ee65661bb4b3c8.1" value="staff"><ScreenText plain id="PermissionsPage.175d78737a59a4d4">Staff</ScreenText></PageOption><PageOption designId="copy.931190b030c2f061.1" value="manager"><ScreenText plain id="PermissionsPage.937330689bcbced3">Manager</ScreenText></PageOption><PageOption designId="copy.d39f3e9c93c0919b.1" value="general_manager"><ScreenText plain id="PermissionsPage.9c4a744e3bd4548e">General Manager</ScreenText></PageOption><PageOption designId="copy.d33e95fae857988b.1" value="owner"><ScreenText plain id="PermissionsPage.7d46bc1460e96051">Owner</ScreenText></PageOption></select></label>
 <button data-design-block="copy.e0e629aa52424fa8.1" disabled={!!saving || drafts[m.user_id]===m.access_level} onClick={()=>void save(m)}>{saving===m.user_id?<PageWord id="copy.1959386350ffdcd5.1">{"Saving…"}</PageWord>:<PageWord id="copy.6c8260e00e331275.1">{"Save Access"}</PageWord>}</button></article>)}
 </section>
}
