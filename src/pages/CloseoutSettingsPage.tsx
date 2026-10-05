import { ScreenText } from "../components/ScreenText"
import { SignedPoints } from '../components/SignedPoints'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { loadLocationTeam } from '../lib/team'
import type { TeamMember } from '../lib/team'
import type { Config, Question, PointRule } from '../components/CloseoutConfig'
import './ManagerCloseoutPage.css'
export function CloseoutSettingsPage({awardsOnly = false, initialTab = 'staff'}: {awardsOnly?: boolean; initialTab?: 'staff'|'manager'|'points'|'award'}) {
  const [locationId,setLocationId]=useState('')
  const [config,setConfig]=useState<Config|null>(null)
  const [team,setTeam]=useState<TeamMember[]>([])
  const [tab,setTab]=useState<'staff'|'manager'|'points'|'award'>(awardsOnly ? 'award' : initialTab)
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
  return <section className="mod-page"><Link to="/closeout"><ScreenText id="CloseoutSettingsPage.89412119744c72b5">← Closeout</ScreenText></Link><h1>{awardsOnly ? 'Award / Deduct Points' : 'Form & Points Settings'}</h1>
    {!awardsOnly && <p><ScreenText id="CloseoutSettingsPage.6987a743a4e1d65b">Change question wording or add questions. Add manager-awarded categories and edit their reasons and values.</ScreenText></p>}
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!config&&<p>{busy?'Loading settings…':'Settings unavailable.'}</p>}
    {config&&<><div className="settings-tabs">{(awardsOnly ? ['award'] as const : ['staff','manager','points','award'] as const).map(t=><button key={t} type="button" disabled={busy} aria-pressed={tab===t} onClick={()=>setTab(t)}>{({staff:'Staff Questions',manager:'Manager Questions',points:'Point Rules',award:'Award Points'})[t]}</button>)}</div>
    {tab!=='award'&&<form onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}>
      {(tab==='staff'||tab==='manager')&&<><p><ScreenText id="CloseoutSettingsPage.ea06472db1ca16d2">Operational fields keep their existing validation; you can change their wording. Custom questions can be removed. Previously saved answers remain in their original closeouts.</ScreenText></p>
        {config.questions.filter(q=>q.audience===tab).map(q=><article className="mod-review" key={q.id}><label><ScreenText id="CloseoutSettingsPage.b45379e8eccb5aad">Question</ScreenText><textarea required rows={2} maxLength={500} value={q.label} onChange={e=>updateQuestion(q.id,{label:e.target.value})}/></label>
          {!q.builtin&&<div className="mod-fields"><label><ScreenText id="CloseoutSettingsPage.01164c368bd99fd0">Answer type</ScreenText><select value={q.type} onChange={e=>updateQuestion(q.id,{type:e.target.value as Question['type']})}><option value="text"><ScreenText id="CloseoutSettingsPage.6b3ace26a361ac6c">Written answer</ScreenText></option><option value="number"><ScreenText id="CloseoutSettingsPage.c7527ecfa76fa775">Number</ScreenText></option><option value="yesno"><ScreenText id="CloseoutSettingsPage.bcaa86591c49ccd9">Yes / No</ScreenText></option></select></label>
          <label className="mod-check"><input type="checkbox" checked={q.required} onChange={e=>updateQuestion(q.id,{required:e.target.checked})}/><ScreenText id="CloseoutSettingsPage.eac1c0b6f8b1d338">Required</ScreenText></label>
          <label className="mod-check"><input type="checkbox" checked={q.active} onChange={e=>updateQuestion(q.id,{active:e.target.checked})}/><ScreenText id="CloseoutSettingsPage.4a5b2cbbdcf6d2e2">Active</ScreenText></label></div>}
          {!q.builtin && <button type="button" onClick={() => {
            if (!window.confirm('Remove this question from future forms? Saved answers will remain available.')) return
            setDirty(true); setMessage(''); setConfig(c => c && ({...c, questions: c.questions.filter(item => item.id !== q.id)}))
          }}><ScreenText id="CloseoutSettingsPage.75e6832d204f3149">Remove Question</ScreenText></button>}
          {q.builtin && <small><ScreenText id="CloseoutSettingsPage.43cb8c506629acf0">Required operational field. Its wording can be edited.</ScreenText></small>}
        </article>)}
        <button type="button" disabled={config.questions.length>=100} onClick={()=>{setDirty(true);setConfig({...config,questions:[...config.questions,{id:crypto.randomUUID(),audience:tab,label:'',type:'text',required:true,active:true,builtin:false}]})}}><ScreenText id="CloseoutSettingsPage.fa61b25ed7f306ce">Add Question</ScreenText></button>
      </>}
      {tab==='points'&&<><p><ScreenText id="CloseoutSettingsPage.0f526e8e187ed139">Saved awards keep their values. Manager rating policies are fixed for an already-started Tuesday–Sunday week. Automatic rules retain their existing triggers; new rules are awarded by a manager.</ScreenText></p>
        {config.rules.map(r=><article className="mod-review" key={r.id}><p>{r.mode==='automatic'?'Automatic':'Manager awarded'}</p><div className="mod-fields">
          <label><ScreenText id="CloseoutSettingsPage.783f5ba78c270aac">Category</ScreenText><input required maxLength={100} value={r.category} onChange={e=>updateRule(r.id,{category:e.target.value})}/></label>
          <label><ScreenText id="CloseoutSettingsPage.f7f3f1b8e74f69f9">Reason</ScreenText><input required maxLength={500} value={r.reason} onChange={e=>updateRule(r.id,{reason:e.target.value})}/></label>
          <SignedPoints value={r.points} onChange={points=>updateRule(r.id,{points})} />
          <label className="mod-check"><input type="checkbox" checked={r.active} onChange={e=>updateRule(r.id,{active:e.target.checked})}/><ScreenText id="CloseoutSettingsPage.4cb33a274253f8a6">Active</ScreenText></label>
        </div></article>)}
        <button type="button" disabled={config.rules.length>=200} onClick={()=>{setDirty(true);setConfig({...config,rules:[...config.rules,{id:crypto.randomUUID(),category:'',reason:'',points:0,active:true,mode:'manual'}]})}}><ScreenText id="CloseoutSettingsPage.15c182586a1c067a">Add Point Category / Reason</ScreenText></button>
      </>}
      <div className="settings-actions"><button type="submit" disabled={!dirty}>{busy?'Saving…':'Save Settings'}</button><button type="button" onClick={()=>{if(!dirty||window.confirm('Discard unsaved settings?'))void load()}}><ScreenText id="CloseoutSettingsPage.b22ebcdb8a593632">Reload Saved Settings</ScreenText></button></div>
    </fieldset></form>}
    {tab==='award'&&<form onSubmit={e=>{e.preventDefault();void award()}}><p><ScreenText id="CloseoutSettingsPage.1119c48727c8e47e">Save point rules before awarding. Your note stays private; staff see the category reason and point value.</ScreenText></p>
      <fieldset disabled={busy||dirty}><div className="mod-fields">
        <label><ScreenText id="CloseoutSettingsPage.639847409938b2d0">Staff member</ScreenText><select required disabled={awardPending} value={employee} onChange={e=>setEmployee(e.target.value)}><option value=""><ScreenText id="CloseoutSettingsPage.c0227cc5dd9cc90c">Choose an employee</ScreenText></option>{team.map(m=><option key={m.user_id} value={m.user_id}>{m.profile?.preferred_name||m.profile?.full_name||'Team member'}</option>)}</select></label>
        <label><ScreenText id="CloseoutSettingsPage.d943487cbd19d8b7">Category / reason</ScreenText><select required disabled={awardPending} value={ruleId} onChange={e=>setRuleId(e.target.value)}><option value=""><ScreenText id="CloseoutSettingsPage.6f9be7687a0dc330">Choose a reason</ScreenText></option>{config.rules.filter(r=>r.mode==='manual'&&r.active).map(r=><option key={r.id} value={r.id}>{r.category}: {r.reason} ({r.points>0?'+':''}{r.points})</option>)}</select></label>
        <label><ScreenText id="CloseoutSettingsPage.b25562e5720de193">Private explanation</ScreenText><textarea required disabled={awardPending} rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      </div>{rule&&<p>{rule.points>0?'+':''}{rule.points}<ScreenText id="CloseoutSettingsPage.9c11b80a43f8816b"> points will be applied.</ScreenText></p>}<button type="submit">{awardPending?'Retry Same Adjustment':'Apply Point Adjustment'}</button></fieldset>
      {dirty&&<p><ScreenText id="CloseoutSettingsPage.22c9d1c31b0df769">Save your settings first.</ScreenText></p>}
    </form>}</>}
  </section>
}

