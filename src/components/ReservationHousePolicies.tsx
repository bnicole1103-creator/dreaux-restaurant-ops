import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
type Rules={id:string;title:string;body:string;published_at:string}
export function ReservationHousePolicies({location,onSaved}:{location:string;onSaved?:()=>void}){
 const [rules,setRules]=useState<Rules|null>(null),[title,setTitle]=useState('House rules and reservation policies'),[body,setBody]=useState(''),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const lock=useRef(false),sequence=useRef(0)
 useEffect(()=>{sequence.current++;lock.current=false;setRules(null);setBody('');setTitle('House rules and reservation policies');setLoaded(false);setBusy(false);setError('');setNotice('');return()=>{sequence.current++}},[location])
 async function run(save=false){
  if(lock.current||!location)return
  if(save&&!window.confirm('Publish these exact house rules for new guest links? Existing links and recorded acceptances keep their original policy version.'))return
  if(!save&&loaded&&body!==(rules?.body??'')&&!window.confirm('Discard unsaved policy edits and reload?'))return
  lock.current=true;const ticket=sequence.current;setBusy(true);setError('');setNotice('')
  try{const r=save?await supabase.rpc('reservation_house_policy_publish',{p_location:location,p_expected:rules?.id??null,p_title:title,p_body:body}).abortSignal(AbortSignal.timeout(15000)):await supabase.rpc('reservation_house_policy_get',{p_location:location}).abortSignal(AbortSignal.timeout(15000));if(ticket!==sequence.current)return;if(r.error)throw r.error;setRules(r.data);setTitle(r.data?.title??'House rules and reservation policies');setBody(r.data?.body??'');setLoaded(true);if(save){setNotice('House rules published. Generate new guest links to use this version.');onSaved?.()}}
  catch(e){if(ticket===sequence.current)setError(String((e as Error).message??e))}finally{if(ticket===sequence.current){lock.current=false;setBusy(false)}}
 }
 return <details><summary>House rules & required guest acceptance</summary><p>Publish the actual restaurant rules guests must accept before confirming. No rules are filled in automatically. Publishing creates a permanent version; new links use it and existing links keep their assigned version.</p><button type="button" disabled={!location||busy} onClick={()=>void run()}>Load published house rules</button>{loaded&&<fieldset disabled={busy}><label>Policy title<input maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>House rules and reservation policies<textarea rows={12} maxLength={20000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Paste the approved rules guests must review and accept."/></label>{rules&&<p>Version published: {new Date(rules.published_at).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:true})} CT · {rules.id}</p>}<button type="button" disabled={!title.trim()||body.trim().length<10} onClick={()=>void run(true)}>Publish house rules</button></fieldset>}{busy&&<p role="status">Working…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}</details>
}
