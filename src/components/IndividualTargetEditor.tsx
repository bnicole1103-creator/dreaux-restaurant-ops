import { targetFromPoolShare } from '../lib/targetShares'
import {balanceTargets} from '../lib/balanceTargets'
import type {calculateTargets} from '../lib/salesTargets'
import {PreparedTargetScope} from './PreparedTargetScope'
import {usePrepareRelease} from './PrepareRelease'
import {usePrepareWorkStatus} from './PrepareWorkStatus'
import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {salesMoney} from '../lib/salesTargets'
type Row={employee_key:string;name:string;group:string;target:number}
type Override={employee_key:string;pool:string;target:number|null;version:number}
type Data={locked:boolean;can_override:boolean;allocation:{ready:boolean;reason?:string;team_target:number;rows:Row[]};overrides:Override[]}
export function IndividualTargetEditor({location,date,disabled,onSaved,pendingSettings=false,beforeSave,blockedReason='',allocationPreview,calculated,manualTargets}:{allocationPreview?:ReturnType<typeof calculateTargets>|null;calculated?:ReturnType<typeof calculateTargets>|null;manualTargets?:Record<string,number>;pendingSettings?:boolean;beforeSave?:()=>Promise<boolean>;blockedReason?:string;location:string;date:string;disabled:boolean;onSaved:()=>void}){
 const [data,setData]=useState<Data|null>(null),[drafts,setDrafts]=useState<Record<string,string>>({}),[override,setOverride]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const release=usePrepareRelease()
 const lock=useRef(false)
 const savedRows=Object.values((data?.allocation.rows??[]).reduce<Record<string,Row>>((all,r)=>{const key=r.group+':'+r.employee_key;if(!all[key])all[key]={...r,target:0};all[key].target+=Number(r.target);return all},{}))
 const rows=allocationPreview?.ready?allocationPreview.rows.map(r=>({employee_key:r.key,name:r.name,group:r.group,target:r.target})):savedRows
 const teamTarget=allocationPreview?.ready?allocationPreview.total:Number(data?.allocation.team_target??0)
 const previewReady=allocationPreview?.ready??!!data?.allocation.ready
 const pool=(row:Row)=>row.group==='bar'?calculated?.bar??0:calculated?.floor??0
 const keyOf=(row:Row)=>row.group+':'+row.employee_key
 const baseline=(row:Row)=>calculated?.rows.find(r=>r.group===row.group&&r.key===row.employee_key)?.target??row.target
 const fingerprint=(row:Row,reset=false)=>JSON.stringify([reset?baseline(row):drafts[keyOf(row)]??baseline(row),pool(row),data?.overrides.find(o=>o.employee_key===row.employee_key&&o.pool===row.group)?.version??0,override,reason])
 const entered=Object.fromEntries(rows.flatMap(row=>{
  const raw=drafts[keyOf(row)]
  const amount=raw===undefined?null:targetFromPoolShare(pool(row),raw)
  return amount===null?[]:[[keyOf(row),amount]]
 }))
 const recalculated=calculated?.ready?balanceTargets(teamTarget,calculated.rows,{...manualTargets,...entered}):null
 const groups=rows.reduce<Map<string,Row[]>>((people,row)=>{
  people.set(row.employee_key,[...(people.get(row.employee_key)??[]),row]);return people
 },new Map())
 const editingDisabled=disabled||!data||!!release?.locked||!!release&&!release.ready

 useEffect(()=>{let live=true;setData(null);setDrafts({});setError('');setOverride(false);setReason('');void supabase.rpc('personal_sales_targets_load',{p_location_id:location,p_date:date}).then(r=>{if(!live)return;if(r.error)setError(r.error.message);else setData(r.data)});return()=>{live=false}},[location,date])
 async function save(row:Row,reset=false){if(lock.current||busy||editingDisabled||!data)return;const key=keyOf(row),amount=targetFromPoolShare(pool(row),drafts[key]??'');if(!reset&&amount===null){setError('Enter a share from 0% to 100% of an assigned pool.');return}lock.current=true;setBusy(true);setError('');setNotice('');try{if(beforeSave&&!await beforeSave()){setError('Calculation settings could not be saved. Review the error above, then retry.');return}const loaded=await supabase.rpc('personal_sales_targets_load',{p_location_id:location,p_date:date});if(loaded.error)throw loaded.error;const current=loaded.data as Data;if(!(release?rows:current.allocation.rows).some(r=>r.employee_key===row.employee_key&&r.group===row.group))throw Error('This employee’s allocation changed. Reload targets before editing.');const saved=data.overrides.find(o=>o.employee_key===row.employee_key&&o.pool===row.group);const latest=current.overrides.find(o=>o.employee_key===row.employee_key&&o.pool===row.group);if((saved?.version??0)!==(latest?.version??0))throw Error('This target changed on another device. Reload targets before saving.');if(release){
 if(!allocationPreview)throw Error('Wait for the target preview to load before queuing changes.');
 const manual={...(manualTargets??{})};if(reset)delete manual[key];else manual[key]=amount!;
 const next=balanceTargets(teamTarget,allocationPreview.rows,manual);if(next.issue)throw Error(next.issue);
 release.stage({id:'target:'+key,workId:'target:'+key,label:(reset?'Reset target: ':'Individual target: ')+row.name,operation:'personal_sales_target_save',args:{p_location_id:location,p_date:date,p_employee_key:row.employee_key,p_pool:row.group,p_target:reset?null:amount,p_version:saved?.version??0,p_allow_locked:override,p_reason:reason},fingerprint:fingerprint(row,reset),selected:true});if(reset)setDrafts(v=>{const next={...v};delete next[key];return next});setNotice('Target queued. The preview below includes selected queued targets. Apply them with Save & release selected work in Prepare day’s final review.');return} const r=await supabase.rpc('personal_sales_target_save',{p_location_id:location,p_date:date,p_employee_key:row.employee_key,p_pool:row.group,p_target:reset?null:amount,p_version:saved?.version??0,p_allow_locked:override,p_reason:reason});if(r.error)throw r.error;const fresh=await supabase.rpc('personal_sales_targets_load',{p_location_id:location,p_date:date});if(fresh.error)throw fresh.error;setData(fresh.data);setDrafts(v=>{const next={...v};delete next[key];return next});setNotice('Individual target saved. Remaining targets recalibrated to the team goal.');window.dispatchEvent(new Event('sales-targets-changed'));onSaved()}catch(e){setError(String((e as Error).message??e))}finally{lock.current=false;setBusy(false)}}
 usePrepareWorkStatus({id:'individual-targets',phase:'service',label:'Individual targets',dirty:!release&&Object.keys(drafts).length>0,busy:busy||!data&&!error,error,detail:notice|| (data?'Assigned target records loaded.':'Individual targets not loaded.')})
 return <section className="task-card" aria-label="Edit individual sales targets"><h2>Individual sales targets</h2>{previewReady&&<p><strong>Team goal {salesMoney(teamTarget)}</strong> · Automatic bar pool {salesMoney(calculated?.bar??0)} · Automatic floor pool {salesMoney(calculated?.floor??0)}</p>}<p>Enter a percentage of the person’s bar or floor pool. The remaining targets recalculate against the same team goal.</p>{release&&<p>Queue each change, then apply it in Prepare day’s final review.</p>}{pendingSettings&&<p role="status">You can edit the goals below. {release?'Queuing a goal will first queue the pending calculation settings above.':'Saving a goal will first save the pending calculation settings above.'}</p>}{blockedReason&&<p role="status">{blockedReason}</p>}{!data&&!error&&<p role="status">Loading individual targets…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{data&&!previewReady&&<p>{allocationPreview?.issues.join(' ')||data.allocation.reason||'Confirm the schedule and calculate targets first.'}</p>}{data?.locked&&<p>Targets were locked by a closeout. Owner or General Manager can enable the override below and enter a reason. Submitted closeout snapshots stay as recorded.</p>}{data?.locked&&data.can_override&&<><label><input type="checkbox" checked={override} onChange={e=>setOverride(e.target.checked)}/>Override the locked assigned targets</label><label>Override reason<input maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label></>}{recalculated?.issue&&<p role="alert">{recalculated.issue}</p>}
 {Array.from(groups,([employee,person])=><div className="sales-allocation-person" key={employee}>
  <strong>{person[0].name}</strong>
  {person.map(row=>{
   const key=keyOf(row),poolName=row.group==='bar'?'Bar':'Floor'
   const saved=manualTargets?.[key]
   const actual=recalculated&&!recalculated.issue?recalculated.rows.find(r=>r.key===row.employee_key&&r.group===row.group)?.target??row.target:row.target
   const canEdit=previewReady&&!busy&&!editingDisabled&&(!data?.locked||(override&&data.can_override))
   const canSave=canEdit&&(!data?.locked||reason.trim().length>=3)
   return <PreparedTargetScope key={key} id={'target:'+key} name={row.name} fingerprint={JSON.parse(fingerprint(row))} dirty={key in drafts} busy={busy} error={error}>
    <div className="sales-allocation-controls">
      <span>{poolName} · Auto <strong>{salesMoney(baseline(row))}</strong></span>
      <label>{poolName} pool % <input aria-label={row.name+' '+poolName+' pool percentage'} type="number" min="0" max="100" step="0.01"
        placeholder={saved!==undefined&&pool(row)>0?(saved/pool(row)*100).toFixed(2):'Auto'}
        value={drafts[key]??''} disabled={!canEdit||pool(row)<=0}
        onChange={e=>setDrafts(v=>{const next={...v};if(e.target.value==='')delete next[key];else next[key]=e.target.value;return next})}/></label>
      <span>Target <strong>{salesMoney(actual)}</strong></span>
      <button type="button" disabled={!canSave||entered[key]===undefined||!!recalculated?.issue} onClick={()=>void save(row)}>{release?'Queue':'Save'}</button>
      {saved!==undefined&&<button type="button" disabled={!canSave} onClick={()=>void save(row,true)}>Reset to auto</button>}
    </div>
   </PreparedTargetScope>
  })}
 </div>)}</section>
}
