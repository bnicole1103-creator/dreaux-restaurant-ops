// page-designer-instrumented
import { PageWord, PageOption } from "../components/PageDesign"
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
  return <section data-design-block="copy.3f89dbf081c0d62a.1" className="mod-page"><Link to="/closeout"><ScreenText id="CloseoutSettingsPage.89412119744c72b5">← Closeout</ScreenText></Link><h1 data-design-block="copy.3085ccf5f36b4e89.1">{awardsOnly ? <PageWord id="copy.f1474c9132064ed4.1">{"Award / Deduct Points"}</PageWord> : <PageWord id="copy.d7b98cfed567961b.1">{"Form & Points Settings"}</PageWord>}</h1>
    {!awardsOnly && <p data-design-block="copy.4ff63d424e9af0e9.1"><ScreenText id="CloseoutSettingsPage.6987a743a4e1d65b">Change question wording or add questions. Add manager-awarded categories and edit their reasons and values.</ScreenText></p>}
    {error&&<p data-design-block="copy.9c142daea85fd7ea.1" role="alert">{error}</p>}{message&&<p data-design-block="copy.d2938c395789d43c.1" role="status">{message}</p>}
    {!config&&<p data-design-block="copy.4ff63d424e9af0e9.2">{busy?<PageWord id="copy.47964877dcb8bfb2.1">{"Loading settings…"}</PageWord>:<PageWord id="copy.1feb03db0bf784ca.1">{"Settings unavailable."}</PageWord>}</p>}
    {config&&<><div data-design-block="copy.5e0e6ddbf1f0039c.1" className="settings-tabs">{(awardsOnly ? ['award'] as const : ['staff','manager','points','award'] as const).map(t=><button data-design-block="copy.e33d9dbd61d817d4.1" key={t} type="button" disabled={busy} aria-pressed={tab===t} onClick={()=>setTab(t)}>{({staff:'Staff Questions',manager:'Manager Questions',points:'Point Rules',award:'Award Points'})[t]}</button>)}</div>
    {tab!=='award'&&<form data-design-block="copy.89725dbb87ec8078.1" onSubmit={e=>{e.preventDefault();void save()}}><fieldset data-design-block="copy.abbdbea09102fe85.1" disabled={busy}>
      {(tab==='staff'||tab==='manager')&&<><p data-design-block="copy.4ff63d424e9af0e9.3"><ScreenText id="CloseoutSettingsPage.ea06472db1ca16d2">Edit labels and remove staff questions from future forms. Removing a question also disables its associated automatic points. Saved closeouts retain their original answers and point rules.</ScreenText></p>
        {config.questions.filter(q=>q.audience===tab).map(q=><article data-design-block="copy.fc6e3de54e40081f.1" className="mod-review" key={q.id}><label data-design-block="copy.5eac557af0c71ef5.1"><ScreenText id="CloseoutSettingsPage.b45379e8eccb5aad">Question</ScreenText><textarea required rows={2} maxLength={500} value={q.label} onChange={e=>updateQuestion(q.id,{label:e.target.value})}/></label>
          {!q.builtin&&<div data-design-block="copy.e9ed6694a657e1e2.1" className="mod-fields"><label data-design-block="copy.5eac557af0c71ef5.2"><ScreenText id="CloseoutSettingsPage.01164c368bd99fd0">Answer type</ScreenText><select value={q.type} onChange={e=>updateQuestion(q.id,{type:e.target.value as Question['type']})}><PageOption designId="copy.bbc2cc864212f727.1" value="text"><ScreenText plain id="CloseoutSettingsPage.6b3ace26a361ac6c">Written answer</ScreenText></PageOption><PageOption designId="copy.be482231d9e09166.1" value="number"><ScreenText plain id="CloseoutSettingsPage.c7527ecfa76fa775">Number</ScreenText></PageOption><PageOption designId="copy.1ff8141b5a663cde.1" value="yesno"><ScreenText plain id="CloseoutSettingsPage.bcaa86591c49ccd9">Yes / No</ScreenText></PageOption></select></label>
          <label data-design-block="copy.73d954dfaa482558.1" className="mod-check"><input type="checkbox" checked={q.required} onChange={e=>updateQuestion(q.id,{required:e.target.checked})}/><ScreenText id="CloseoutSettingsPage.eac1c0b6f8b1d338">Required</ScreenText></label>
          <label data-design-block="copy.73d954dfaa482558.2" className="mod-check"><input type="checkbox" checked={q.active} onChange={e=>updateQuestion(q.id,{active:e.target.checked})}/><ScreenText id="CloseoutSettingsPage.4a5b2cbbdcf6d2e2">Active</ScreenText></label></div>}
          {!q.builtin && <button data-design-block="copy.16388dcfc3c3c6f6.1" type="button" onClick={() => {
            if (!window.confirm('Remove this question from future forms? Saved answers will remain available.')) return
            setDirty(true); setMessage(''); setConfig(c => c && ({...c, questions: c.questions.filter(item => item.id !== q.id)}))
          }}><ScreenText id="CloseoutSettingsPage.75e6832d204f3149">Remove Question</ScreenText></button>}
          {q.builtin&&q.audience==='staff'&&<label data-design-block="copy.73d954dfaa482558.3" className="mod-check"><input type="checkbox" checked={q.active} onChange={e=>updateQuestion(q.id,{active:e.target.checked})}/><PageWord id="copy.ba9c1fa06f447a88.1">Show this question on future forms</PageWord></label>}{q.builtin && <small><ScreenText id="CloseoutSettingsPage.43cb8c506629acf0">Built-in question. Staff questions can be removed and restored with the checkbox above.</ScreenText></small>}
        </article>)}
        <button data-design-block="copy.02d87b6c8f0fea89.1" type="button" disabled={config.questions.length>=100} onClick={()=>{setDirty(true);setConfig({...config,questions:[...config.questions,{id:crypto.randomUUID(),audience:tab,label:'',type:'text',required:true,active:true,builtin:false}]})}}><ScreenText id="CloseoutSettingsPage.fa61b25ed7f306ce">Add Question</ScreenText></button>
      </>}
      {tab==='points'&&<><p data-design-block="copy.4ff63d424e9af0e9.4"><ScreenText id="CloseoutSettingsPage.0f526e8e187ed139">Saved awards keep their values. Manager rating policies are fixed for an already-started Tuesday–Sunday week. Automatic rules retain their existing triggers; new rules are awarded by a manager.</ScreenText></p>
        {config.rules.map(r=><article data-design-block="copy.3888ba74c15da250.1" className="mod-review" key={r.id}><p data-design-block="copy.4ff63d424e9af0e9.5">{r.mode==='automatic'?<PageWord id="copy.a5605216062fa3dc.1">{"Automatic"}</PageWord>:<PageWord id="copy.c102da3e6cc89568.1">{"Manager awarded"}</PageWord>}</p><div data-design-block="copy.e9ed6694a657e1e2.2" className="mod-fields">
          <label data-design-block="copy.5eac557af0c71ef5.3"><ScreenText id="CloseoutSettingsPage.783f5ba78c270aac">Category</ScreenText><input required maxLength={100} value={r.category} onChange={e=>updateRule(r.id,{category:e.target.value})}/></label>
          <label data-design-block="copy.5eac557af0c71ef5.4"><ScreenText id="CloseoutSettingsPage.f7f3f1b8e74f69f9">Reason</ScreenText><input required maxLength={500} value={r.reason} onChange={e=>updateRule(r.id,{reason:e.target.value})}/></label>
          <SignedPoints value={r.points} onChange={points=>updateRule(r.id,{points})} />
          <label data-design-block="copy.73d954dfaa482558.4" className="mod-check"><input type="checkbox" checked={r.active} onChange={e=>updateRule(r.id,{active:e.target.checked})}/><ScreenText id="CloseoutSettingsPage.4cb33a274253f8a6">Active</ScreenText></label>
        </div></article>)}
        <button data-design-block="copy.22b5792805ba9628.1" type="button" disabled={config.rules.length>=200} onClick={()=>{setDirty(true);setConfig({...config,rules:[...config.rules,{id:crypto.randomUUID(),category:'',reason:'',points:0,active:true,mode:'manual'}]})}}><ScreenText id="CloseoutSettingsPage.15c182586a1c067a">Add Point Category / Reason</ScreenText></button>
      </>}
      <div data-design-block="copy.a54db4a2b95d7942.1" className="settings-actions"><button data-design-block="copy.380f5b22116254fd.1" type="submit" disabled={!dirty}>{busy?<PageWord id="copy.0780273d7d562b30.1">{"Saving…"}</PageWord>:<PageWord id="copy.9c93c69fd3084019.1">{"Save Settings"}</PageWord>}</button><button data-design-block="copy.61fbe136a412c23c.1" type="button" onClick={()=>{if(!dirty||window.confirm('Discard unsaved settings?'))void load()}}><ScreenText id="CloseoutSettingsPage.b22ebcdb8a593632">Reload Saved Settings</ScreenText></button></div>
    </fieldset></form>}
    {tab==='award'&&<form data-design-block="copy.bdea3275cf8cec65.1" onSubmit={e=>{e.preventDefault();void award()}}><p data-design-block="copy.4ff63d424e9af0e9.6"><ScreenText id="CloseoutSettingsPage.1119c48727c8e47e">Save point rules before awarding. Your note stays private; staff see the category reason and point value.</ScreenText></p>
      <fieldset data-design-block="copy.8acf7f359cbeee0d.1" disabled={busy||dirty}><div data-design-block="copy.e9ed6694a657e1e2.3" className="mod-fields">
        <label data-design-block="copy.5eac557af0c71ef5.5"><ScreenText id="CloseoutSettingsPage.639847409938b2d0">Staff member</ScreenText><select required disabled={awardPending} value={employee} onChange={e=>setEmployee(e.target.value)}><PageOption designId="copy.2440fa81719432d9.1" value=""><ScreenText plain id="CloseoutSettingsPage.c0227cc5dd9cc90c">Choose an employee</ScreenText></PageOption>{team.map(m=><option key={m.user_id} value={m.user_id}>{m.profile?.preferred_name||m.profile?.full_name||'Team member'}</option>)}</select></label>
        <label data-design-block="copy.5eac557af0c71ef5.6"><ScreenText id="CloseoutSettingsPage.d943487cbd19d8b7">Category / reason</ScreenText><select required disabled={awardPending} value={ruleId} onChange={e=>setRuleId(e.target.value)}><PageOption designId="copy.88254274aa15887f.1" value=""><ScreenText plain id="CloseoutSettingsPage.6f9be7687a0dc330">Choose a reason</ScreenText></PageOption>{config.rules.filter(r=>r.mode==='manual'&&r.active).map(r=><option key={r.id} value={r.id}>{r.category}: {r.reason} ({r.points>0?'+':''}{r.points})</option>)}</select></label>
        <label data-design-block="copy.5eac557af0c71ef5.7"><ScreenText id="CloseoutSettingsPage.b25562e5720de193">Private explanation</ScreenText><textarea required disabled={awardPending} rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      </div>{rule&&<p data-design-block="copy.4ff63d424e9af0e9.7">{rule.points>0?<PageWord id="copy.4b6ba40f93e7a2e1.1">{"+"}</PageWord>:<PageWord id="copy.80ef1106a839456c.1">{""}</PageWord>}{rule.points}<ScreenText id="CloseoutSettingsPage.9c11b80a43f8816b"> points will be applied.</ScreenText></p>}<button data-design-block="copy.d3cb2050ee893930.1" type="submit">{awardPending?<PageWord id="copy.c2619e9469915c66.1">{"Retry Same Adjustment"}</PageWord>:<PageWord id="copy.e7ef696a07898563.1">{"Apply Point Adjustment"}</PageWord>}</button></fieldset>
      {dirty&&<p data-design-block="copy.4ff63d424e9af0e9.8"><ScreenText id="CloseoutSettingsPage.22c9d1c31b0df769">Save your settings first.</ScreenText></p>}
    </form>}</>}
  </section>
}


