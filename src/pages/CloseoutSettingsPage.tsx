import { SignedPoints } from '../components/SignedPoints'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { loadLocationTeam } from '../lib/team'
import type { TeamMember } from '../lib/team'
import type { Config, Question, PointRule } from '../components/CloseoutConfig'
import './ManagerCloseoutPage.css'
export function CloseoutSettingsPage({awardsOnly = false}: {awardsOnly?: boolean}) {
  const [locationId,setLocationId]=useState('')
  const [config,setConfig]=useState<Config|null>(null)
  const [team,setTeam]=useState<TeamMember[]>([])
  const [tab,setTab]=useState<'staff'|'manager'|'points'|'award'>(awardsOnly ? 'award' : 'staff')
  const [busy,setBusy]=useState(false)
  const [dirty,setDirty]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [employee,setEmployee]=useState('')
  const [ruleId,setRuleId]=useState('')
  const [note,setNote]=useState('')
  const requestId=useRef<string|null>(null)
  const [awardPending,setAwardPending]=useState(false)
  async function load() {
    setError(''); setMessage(''); setBusy(true)
    try {
      const tenant=await loadTenantData(); const loc=tenant.locations[0]
      if(!loc) throw new Error('No active location found.')
      const permission=await supabase.rpc(awardsOnly ? 'mod_is_manager' : 'closeout_is_gm',{p_location_id:loc.id})
      if(permission.error) throw permission.error
      if(!permission.data) throw new Error(awardsOnly ? 'Manager access required.' : 'General manager access required.')
      const response=await supabase.rpc('closeout_get_config',{p_location_id:loc.id})
      if(response.error) throw response.error
      const user=await supabase.auth.getUser(); if(user.error) throw user.error
      const members=await loadLocationTeam(loc.id)
      setTeam(members.filter(m=>m.user_id!==user.data.user?.id));setLocationId(loc.id)
      setConfig(response.data as Config);setDirty(false)
    }catch(e){setError(String((e as {message?:string}).message??e))}
    finally{setBusy(false)}
  }
  useEffect(()=>{void load()},[])
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
  function updateQuestion(id:string,patch:Partial<Question>){setDirty(true);setMessage('');setConfig(c=>c&&({...c,questions:c.questions.map(q=>q.id===id?{...q,...patch}:q)}))}
  function updateRule(id:string,patch:Partial<PointRule>){setDirty(true);setMessage('');setConfig(c=>c&&({...c,rules:c.rules.map(r=>r.id===id?{...r,...patch}:r)}))}
  async function save(){if(!config)return;setBusy(true);setError('');setMessage('');try{
    const {data,error}=await supabase.rpc('closeout_save_config',{p_location_id:locationId,p_version:config.version,p_questions:config.questions,p_rules:config.rules})
    if(error)throw error;setConfig(data as Config);setDirty(false);setMessage('Settings saved. New forms and awards will use these settings.')
  }catch(e){setError(String((e as {message?:string}).message??e))}finally{setBusy(false)}}
  async function award(){setBusy(true);setError('');setMessage('');requestId.current??=crypto.randomUUID();setAwardPending(true)
    try{const {error}=await supabase.rpc('closeout_award_points',{p_location_id:locationId,p_user_id:employee,p_rule_id:ruleId,p_note:note.trim(),p_request_id:requestId.current})
      if(error){if(error.code){requestId.current=null;setAwardPending(false)}throw error};setMessage('Point adjustment saved. The employee’s monthly total has been updated.');setNote('');requestId.current=null;setAwardPending(false)
    }catch(e){setError(String((e as {message?:string}).message??e))}finally{setBusy(false)}}
  const rule=config?.rules.find(r=>r.id===ruleId)
  return <section className="mod-page"><Link to="/closeout">← Closeout</Link><h1>{awardsOnly ? 'Award / Deduct Points' : 'Form & Points Settings'}</h1>
    {!awardsOnly && <p>Change question wording or add questions. Add manager-awarded categories and edit their reasons and values.</p>}
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!config&&<p>{busy?'Loading settings…':'Settings unavailable.'}</p>}
    {config&&<><div className="settings-tabs">{(awardsOnly ? ['award'] as const : ['staff','manager','points','award'] as const).map(t=><button key={t} type="button" disabled={busy} aria-pressed={tab===t} onClick={()=>setTab(t)}>{({staff:'Staff Questions',manager:'Manager Questions',points:'Point Rules',award:'Award Points'})[t]}</button>)}</div>
    {tab!=='award'&&<form onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}>
      {(tab==='staff'||tab==='manager')&&<><p>Operational fields keep their existing validation; you can change their wording. Added questions can be optional or archived.</p>
        {config.questions.filter(q=>q.audience===tab).map(q=><article className="mod-review" key={q.id}><label>Question<textarea required rows={2} maxLength={500} value={q.label} onChange={e=>updateQuestion(q.id,{label:e.target.value})}/></label>
          {!q.builtin&&<div className="mod-fields"><label>Answer type<select value={q.type} onChange={e=>updateQuestion(q.id,{type:e.target.value as Question['type']})}><option value="text">Written answer</option><option value="number">Number</option><option value="yesno">Yes / No</option></select></label>
          <label className="mod-check"><input type="checkbox" checked={q.required} onChange={e=>updateQuestion(q.id,{required:e.target.checked})}/>Required</label>
          <label className="mod-check"><input type="checkbox" checked={q.active} onChange={e=>updateQuestion(q.id,{active:e.target.checked})}/>Active</label></div>}
        </article>)}
        <button type="button" disabled={config.questions.length>=100} onClick={()=>{setDirty(true);setConfig({...config,questions:[...config.questions,{id:crypto.randomUUID(),audience:tab,label:'',type:'text',required:true,active:true,builtin:false}]})}}>Add Question</button>
      </>}
      {tab==='points'&&<><p>Saved awards keep their values. Manager rating policies are fixed for an already-started Tuesday–Sunday week. Automatic rules retain their existing triggers; new rules are awarded by a manager.</p>
        {config.rules.map(r=><article className="mod-review" key={r.id}><p>{r.mode==='automatic'?'Automatic':'Manager awarded'}</p><div className="mod-fields">
          <label>Category<input required maxLength={100} value={r.category} onChange={e=>updateRule(r.id,{category:e.target.value})}/></label>
          <label>Reason<input required maxLength={500} value={r.reason} onChange={e=>updateRule(r.id,{reason:e.target.value})}/></label>
          <SignedPoints value={r.points} onChange={points=>updateRule(r.id,{points})} />
          <label className="mod-check"><input type="checkbox" checked={r.active} onChange={e=>updateRule(r.id,{active:e.target.checked})}/>Active</label>
        </div></article>)}
        <button type="button" disabled={config.rules.length>=200} onClick={()=>{setDirty(true);setConfig({...config,rules:[...config.rules,{id:crypto.randomUUID(),category:'',reason:'',points:0,active:true,mode:'manual'}]})}}>Add Point Category / Reason</button>
      </>}
      <div className="settings-actions"><button type="submit" disabled={!dirty}>{busy?'Saving…':'Save Settings'}</button><button type="button" onClick={()=>{if(!dirty||window.confirm('Discard unsaved settings?'))void load()}}>Reload Saved Settings</button></div>
    </fieldset></form>}
    {tab==='award'&&<form onSubmit={e=>{e.preventDefault();void award()}}><p>Save point rules before awarding. Your note stays private; staff see the category reason and point value.</p>
      <fieldset disabled={busy||dirty}><div className="mod-fields">
        <label>Staff member<select required disabled={awardPending} value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">Choose an employee</option>{team.map(m=><option key={m.user_id} value={m.user_id}>{m.profile?.preferred_name||m.profile?.full_name||'Team member'}</option>)}</select></label>
        <label>Category / reason<select required disabled={awardPending} value={ruleId} onChange={e=>setRuleId(e.target.value)}><option value="">Choose a reason</option>{config.rules.filter(r=>r.mode==='manual'&&r.active).map(r=><option key={r.id} value={r.id}>{r.category}: {r.reason} ({r.points>0?'+':''}{r.points})</option>)}</select></label>
        <label>Private explanation<textarea required disabled={awardPending} rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      </div>{rule&&<p>{rule.points>0?'+':''}{rule.points} points will be applied.</p>}<button type="submit">{awardPending?'Retry Same Adjustment':'Apply Point Adjustment'}</button></fieldset>
      {dirty&&<p>Save your settings first.</p>}
    </form>}</>}
  </section>
}
