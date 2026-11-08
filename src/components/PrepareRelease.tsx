import {normalizeQueuedTargetHours} from '../lib/preparedTargetPreview'
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react'
import {supabase} from '../lib/supabase'
import {useWorkspaceRecovery} from '../lib/workspaceRecovery'
export type PreparedEntry={id:string;workId:string;label:string;operation:string;args:Record<string,unknown>;fingerprint:string;selected:boolean}
type Result={request_id:string;status:string;items:{id:string;operation?:string;label:string;status:string;result:unknown}[]}
type Attempt={request:string;plan:PreparedEntry[]}
type Model={entries:PreparedEntry[];attempt:Attempt|null;result:Result|null;knownFailure:boolean}
const empty=():Model=>({entries:[],attempt:null,result:null,knownFailure:false})
type Api={ready:boolean;locked:boolean;error:string;entries:PreparedEntry[];result:Result|null;attempt:Attempt|null;knownFailure:boolean;stage:(e:PreparedEntry)=>void;register:(id:string,fp:string,workId:string)=>()=>void;hasPrepared:(workId:string)=>boolean;stale:(e:PreparedEntry)=>boolean;choose:(id:string,selected:boolean)=>void;remove:(id:string)=>void;releasePost:(id:string,version:number)=>Promise<Result>;releaseQueued:()=>Promise<Result>;startNext:()=>void;retry:()=>Promise<Result>;editPlan:()=>void}
export function verifyReleaseResult(attempt:Attempt,result:Result){
 if(result?.status!=='committed'||result.request_id!==attempt.request||!Array.isArray(result.items))throw Error('Release confirmation does not match this request. Retry/check the same release before doing anything again.')
 if(result.items.length!==attempt.plan.length||new Set(result.items.map(i=>i.id)).size!==result.items.length)throw Error('The server did not confirm every selected release item. Keep this release and retry/check it; do not reassign tasks manually yet.')
 for(const planned of attempt.plan){const item=result.items.find(i=>i.id===planned.id)
  if(!item||item.status!=='committed'||item.operation&&item.operation!==planned.operation)throw Error('Release item was not confirmed: '+planned.label+'. Retry/check the same release.')
  if(planned.operation==='quiz_manager_save_v2'&&planned.args.p_publish===true&&(item.result as {published?:boolean}|null)?.published!==true)throw Error('Quiz publication was not confirmed: '+planned.label+'. Retry/check the same release.')
 }
 return result
}
const samePost=(attempt:Attempt|null,id:string,version:number)=>attempt?.plan.some(e=>e.operation==='preshift_draft_publish'&&e.args.p_id===id&&Number(e.args.p_version)===version)
const Context=createContext<Api|null>(null)
export function PrepareReleaseProvider({location,day,children}:{location:string;day:string;children:ReactNode}){
 const [model,setModel]=useState<Model>(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[,redraw]=useState(0)
 const current=useRef(model),running=useRef(false),registrations=useRef(new Map<string,{fp:string;workId:string}>());current.current=model
 const recovery=useWorkspaceRecovery('prepare-release:'+location+':'+day,model,saved=>{if(saved&&Array.isArray(saved.entries))setModel({...empty(),...saved})})
 function update(next:Model){if(!recovery.save(next))throw Error('The release plan could not be saved on this device. No release was sent.');current.current=next;setModel(next)}
 const register=useCallback((id:string,fp:string,workId:string)=>{registrations.current.set(id,{fp,workId});redraw(v=>v+1);return()=>{registrations.current.delete(id);redraw(v=>v+1)}},[])
 const stale=(entry:PreparedEntry)=>{const registration=registrations.current.get(entry.id);return !!registration&&registration.fp!==entry.fingerprint}
 const hasPrepared=(workId:string)=>{const active=[...registrations.current.entries()].filter(([,r])=>r.workId===workId);return active.some(([id,r])=>model.entries.some(e=>e.id===id&&e.fingerprint===r.fp))}
 function stage(entry:PreparedEntry){if(!recovery.ready)throw Error('Wait for the saved release plan to restore.');if(running.current||current.current.attempt||current.current.result)throw Error('Resolve the current release before changing its plan.');if(String(entry.args.p_location_id)!==location)throw Error('This editor belongs to another location.');const entries=[...current.current.entries.filter(e=>e.id!==entry.id),JSON.parse(JSON.stringify(entry))];if(entries.length>49)throw Error('Use at most 49 queued changes plus the pre-shift in one release.');update({...current.current,entries});setError('')}
 async function send(attempt:Attempt):Promise<Result>{
  if(running.current)throw Error('Release is already running.');running.current=true;setBusy(true);setError('')
  try{
   const response=await supabase.rpc('prepare_day_release',{p_location_id:location,p_day:day,p_request_id:attempt.request,p_plan:attempt.plan})
   if(response.error){const code=String(response.error.code??'');update({...current.current,knownFailure:code==='P0001'||code==='42501'||/^(22|23|42)/.test(code)||['40001','40P01','55P03','57014'].includes(code)});throw response.error}
   const result=verifyReleaseResult(attempt,response.data as Result)
   update({...current.current,result,knownFailure:false});window.dispatchEvent(new Event('prepare-day-released'));window.dispatchEvent(new Event('reservations-changed'));window.dispatchEvent(new Event('sales-targets-changed'));return result
  }catch(e){const text=String((e as {message?:string}).message??e);setError(text);throw Error(text)}finally{running.current=false;setBusy(false)}
 }
 async function releasePost(id:string,version:number){
  if(!recovery.ready)throw Error('Wait for the release plan to restore.')
  if(current.current.result){if(!current.current.attempt||!samePost(current.current.attempt,id,version))throw Error('That completed release belongs to another pre-shift. Choose Prepare another release before publishing this draft.');return verifyReleaseResult(current.current.attempt,current.current.result)}
  if(current.current.attempt){if(!samePost(current.current.attempt,id,version))throw Error('Another release is unresolved. Retry/check that release first.');return send(current.current.attempt)}
  const entries=normalizeQueuedTargetHours(current.current.entries.filter(e=>e.selected),day)
  if(entries.some(stale))throw Error('An editor changed after being queued. Queue its latest changes or remove it before releasing.')
  const post:PreparedEntry={id:'post',workId:'post',label:'Pre-shift & included sections',operation:'preshift_draft_publish',args:{p_location_id:location,p_id:id,p_version:version},fingerprint:id+':'+version,selected:true}
  const attempt={request:crypto.randomUUID(),plan:[...entries,post]};update({...current.current,attempt,knownFailure:false});return send(attempt)
 }
 async function releaseQueued(){
  if(!recovery.ready)throw Error('Wait for the release plan to restore.')
  if(current.current.result)throw Error('Choose Prepare another release to review remaining work first.')
  if(current.current.attempt)throw Error('A release is unresolved. Retry/check it before starting another.')
  const entries=current.current.entries.filter(e=>e.selected)
  if(!entries.length)throw Error('Select at least one queued item.')
  if(entries.some(stale))throw Error('An editor changed after being queued. Queue its latest changes first.')
  const attempt={request:crypto.randomUUID(),plan:entries};update({...current.current,attempt,knownFailure:false});return send(attempt)
 }
 function startNext(){
  if(running.current||!current.current.result||!current.current.attempt)return
  verifyReleaseResult(current.current.attempt,current.current.result)
  const applied=current.current.attempt.plan
  const entries=current.current.entries.filter(e=>!applied.some(p=>p.id===e.id&&p.operation===e.operation&&p.fingerprint===e.fingerprint))
  update({entries,attempt:null,result:null,knownFailure:false});setError('')
 }
 const api:Api={ready:recovery.ready,locked:busy||!!model.attempt,error,entries:model.entries,result:model.result,attempt:model.attempt,knownFailure:model.knownFailure,stage,register,hasPrepared,stale,
  choose:(id,selected)=>{if(model.attempt)return;update({...model,entries:model.entries.map(e=>e.id===id?{...e,selected}:e)})},
  remove:id=>{if(model.attempt)return;update({...model,entries:model.entries.filter(e=>e.id!==id)})},releasePost,releaseQueued,startNext,
  retry:()=>{if(!current.current.attempt)return Promise.reject(Error('No release to retry.'));return send(current.current.attempt)},
  editPlan:()=>{if(!current.current.knownFailure||running.current)return;update({...current.current,attempt:null,knownFailure:false});setError('')}
 }
 return <Context.Provider value={api}>{children}</Context.Provider>
}
export function usePrepareRelease(){return useContext(Context)}
export function usePreparedAction(id:string,workId:string,label:string,fingerprint:unknown){
 const release=useContext(Context),fp=JSON.stringify(fingerprint),register=release?.register
 useEffect(()=>register?.(id,fp,workId),[register,id,fp,workId])
 return {active:!!release,queued:!!release?.entries.some(e=>e.id===id&&e.fingerprint===fp),stage:(operation:string,args:Record<string,unknown>)=>{if(!release)return false;release.stage({id,workId,label,operation,args,fingerprint:fp,selected:true});return true}}
}
export function PrepareReleaseReview(){const release=usePrepareRelease();if(!release)return null;return <section className="prepare-release-review"><h3>Selected work for this release</h3><p>Queue changes using each tool’s confirmation button. They remain drafts until Save & release selected work. Items unchecked below will not be applied.</p>{!release.entries.length&&<p>No new crew, task, target or quiz changes queued. Existing saved records will be kept.</p>}{release.entries.map(e=><article key={e.id}><label><input type="checkbox" checked={e.selected} disabled={release.locked} onChange={event=>release.choose(e.id,event.target.checked)}/><strong>{e.label}</strong></label><details><summary>Review queued details</summary>{e.operation==='quiz_manager_save_v2'?<><p>{String(e.args.p_title)} · {e.args.p_publish?'Publish':'Save draft only'}</p><label><input type="checkbox" checked={e.args.p_publish===true} disabled={release.locked} onChange={event=>release.stage({...e,args:{...e.args,p_publish:event.target.checked}})}/>Publish this quiz when releasing selected work</label>{(e.args.p_questions as {prompt:string;options:string[];correct:number}[]??[]).map((q,i)=><div key={i}><strong>{i+1}. {q.prompt}</strong><ul>{q.options.map((option,j)=><li key={j}>{option}{j===q.correct?' · Correct answer':''}</li>)}</ul></div>)}</>:e.operation==='personal_sales_target_save'?<p>{e.args.p_target===null?'Reset to calculated target':'Target: $'+String(e.args.p_target)}</p>:e.operation==='staff_tasks_distribute_v1'?<ul>{(e.args.p_plan as {list:{title:string;items:string[]}}[]??[]).map((p,i)=><li key={i}>{p.list.title} · {p.list.items.length} tasks</li>)}</ul>:<p>{e.label} · {String(e.args.p_day??e.args.p_date??'Selected service day')}</p>}</details><p>{release.stale(e)?'Editor changed — queue the latest version before release.':'Queued for review; not applied yet.'}</p><button type="button" disabled={release.locked} onClick={()=>release.remove(e.id)}>Remove from release</button></article>)}</section>}
export function PrepareReleaseOutcome({postPublished=false}:{postPublished?:boolean}={}){
 const release=usePrepareRelease(),[retrying,setRetrying]=useState(false),[localError,setLocalError]=useState('')
 if(!release)return null
 async function run(action:()=>Promise<unknown>){setRetrying(true);setLocalError('');try{await action()}catch(e){setLocalError(String((e as {message?:string}).message??e))}finally{setRetrying(false)}}
 let confirmationError='';if(release.result){try{if(!release.attempt)throw Error('Saved release lacks its original plan. Its contents cannot be verified.');verifyReleaseResult(release.attempt,release.result)}catch(e){confirmationError=String((e as Error).message)}}
 if(confirmationError)return <section role="alert"><p>{confirmationError}</p>{release.attempt&&<button type="button" disabled={retrying} onClick={()=>void run(release.retry)}>Retry / check this release</button>}</section>
 const selected=release.entries.filter(e=>e.selected)
 const quizLabel=(item:Result['items'][number])=>{const planned=release.attempt?.plan.find(p=>p.id===item.id);if(planned?.operation==='quiz_manager_save_v2')return planned.args.p_publish?'Quiz published':'Quiz saved as draft — staff cannot see it';if(planned?.operation.startsWith('staff_tasks_'))return 'Tasks assigned — staff visibility follows their release time';return 'Committed'}
 return <section aria-live="polite">{(release.error||localError)&&<p role="alert">{localError||release.error}</p>}{release.result?<><h3>Release completed</h3><ul>{release.result.items.map(e=><li key={e.id}>{e.label}: {quizLabel(e)}</li>)}</ul><p>Release reference: {release.result.request_id}</p><button type="button" onClick={()=>window.location.reload()}>Reload saved records</button><button type="button" disabled={retrying} onClick={()=>{try{release.startNext();setLocalError('')}catch(e){setLocalError(String((e as Error).message))}}}>Prepare another release</button></>:release.attempt?<><p>This release uses the exact work captured at confirmation. Retry checks the same request and cannot create a second release.</p><button type="button" disabled={retrying} onClick={()=>void run(release.retry)}>{retrying?'Checking release…':'Retry / check this release'}</button>{release.knownFailure&&<button type="button" disabled={retrying} onClick={release.editPlan}>Correct the plan — nothing was committed</button>}</>:postPublished&&release.entries.length>0?<><h3>Queued work still awaiting release</h3><p>The pre-shift is already published. Release selected queued work here without creating another post. Quiz drafts remain drafts; task availability follows the assigned release time.</p><PrepareReleaseReview/><button type="button" disabled={!release.ready||retrying||!selected.length} onClick={()=>{if(window.confirm('Release '+selected.length+' selected queued item(s) without publishing another pre-shift?'))void run(release.releaseQueued)}}>{retrying?'Releasing queued work…':'Release selected queued work'}</button></>:null}</section>
}
