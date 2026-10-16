import {TeamProfileName} from './TeamProfileName'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {shiftGroup,shiftHours,type SalesShift,type TargetGroup,type TargetInputs} from '../lib/salesTargets'

type Person={id:string;name:string;role:string;employee_key:string}
type Data={role_groups:Record<string,TargetGroup>;version:number;manual:boolean;locked:boolean;can_edit:boolean;employees:Person[];rows:(SalesShift&{user_id?:string|null})[];overrides:TargetInputs['overrides']}
type Draft={id:string;user_id:string;employee_key:string;role:string;group:TargetGroup;start_time:string;hours:string;name:string}
type Props={location:string;date:string;disabled:boolean;onDirty:(dirty:boolean)=>void;onSaved:()=>void}
const localTime=(value:string)=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d):''}
const unlinkedKey=()=> 'unlinked:'+crypto.randomUUID()
export function SalesTargetRoster({location,date,disabled,onDirty,onSaved}:Props){
 const [data,setData]=useState<Data|null>(null),[rows,setRows]=useState<Draft[]>([]),[adding,setAdding]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false)
 useEffect(()=>{let live=true;setData(null);setError('');void supabase.rpc('sales_target_roster_load',{p_location_id:location,p_date:date}).then(r=>{
  if(!live)return;if(r.error){setError(r.error.message);return}const d=r.data as Data;setData(d)
  setRows(d.rows.map(s=>{
   const n=shiftHours(s,{overrides:d.overrides} as TargetInputs)
   const uid=s.user_id===undefined?d.employees.find(p=>p.employee_key===s.employee_key)?.id??'':s.user_id??''
   return {id:s.id,user_id:uid,employee_key:s.employee_key||d.employees.find(p=>p.id===uid)?.employee_key||unlinkedKey(),name:s.assigned===false&&!s.employee_key?'':s.name,role:s.role,group:shiftGroup(s,{overrides:d.overrides,settings:{role_groups:d.role_groups}} as TargetInputs),start_time:localTime(s.start),hours:n==null?'':String(n)}
  }));setDirty(false)
 });return()=>{live=false}},[location,date])
 function edited(){setDirty(true);onDirty(true);setError('')}
 function change(id:string,patch:Partial<Draft>){setRows(v=>v.map(r=>r.id===id?{...r,...patch}:r));edited()}
 function account(row:Draft,id:string){const p=data?.employees.find(p=>p.id===id);change(row.id,p?{user_id:p.id,employee_key:p.employee_key,name:p.name}:{user_id:'',employee_key:row.employee_key.startsWith('app:')?unlinkedKey():row.employee_key})}
 function addWithoutAccount(){setRows(v=>[...v,{id:'manual:'+crypto.randomUUID(),user_id:'',employee_key:unlinkedKey(),name:'',role:'server',group:'floor',start_time:'16:00',hours:'6'}]);edited()}
 const invalid=rows.some(r=>!r.name.trim()||!r.role.trim()||!r.start_time||!r.hours||!Number.isFinite(Number(r.hours))||Number(r.hours)<=0||Number(r.hours)>24)
 async function save(){if(!data||busy||invalid||disabled||data.locked||!data.can_edit)return;setBusy(true);setError('');try{
  const r=await supabase.rpc('sales_target_roster_save',{p_location_id:location,p_date:date,p_version:data.version,p_rows:rows.map(r=>({...r,user_id:r.user_id||null,hours:Number(r.hours)}))});if(r.error)throw r.error;setData({...data,version:data.version+1,manual:true});setDirty(false);onDirty(false);onSaved()
 }catch(e){setError(String((e as Error).message??e))}finally{setBusy(false)}}
 return <section className="task-card" aria-label="Sales target employees"><h2>Manage sales target employees</h2>
 <p>App accounts are optional. Save imported employees as they are, or add a name without an account. You can link an account later. Positions, pools, start times and expected hours still apply to the day’s sales calculation.</p>
 {error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Loading sales target employees…</p>}
 {data&&<><p>{data.manual?'Using your saved employee list.':'Starting from the imported schedule.'} {data.locked?'This day is locked by a submitted closeout.':''}</p>
 {!data.can_edit&&<p>General manager access is required to edit this list.</p>}{disabled&&<p>Save or reload the calculation settings before editing employees.</p>}
 <fieldset disabled={busy||disabled||data.locked||!data.can_edit} style={{minWidth:0}}><legend>Employees for this target date</legend>
 <label>Add employee with an account<select value={adding} onChange={e=>setAdding(e.target.value)}><option value="">Choose an active employee</option>{data.employees.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <button type="button" disabled={!adding||rows.length>=200} onClick={()=>{const p=data.employees.find(p=>p.id===adding);if(!p)return;setRows(v=>[...v,{id:'manual:'+crypto.randomUUID(),user_id:p.id,employee_key:p.employee_key,name:p.name,role:p.role,group:/bartender/i.test(p.role)?'bar':/server/i.test(p.role)?'floor':'exclude',start_time:'16:00',hours:'6'}]);setAdding('');edited()}}>Add employee</button>
 <button type="button" disabled={rows.length>=200} onClick={addWithoutAccount}>Add employee without an account</button>
 {rows.map((r,i)=><article className="task-card" key={r.id} aria-label={'Sales shift '+(i+1)}><strong>{r.user_id?<TeamProfileName userId={r.user_id} locationId={location} name={r.name}/>:r.name||'Employee without an account'}</strong><div className="sales-target-fields">
 <label>App account (optional)<select value={r.user_id} onChange={e=>account(r,e.target.value)}><option value="">No app account — save without linking</option>{data.employees.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 {!r.user_id&&<label>Employee name<input maxLength={200} value={r.name} onChange={e=>change(r.id,{name:e.target.value})}/></label>}
 <label>Position<input value={r.role} maxLength={100} onChange={e=>change(r.id,{role:e.target.value})}/></label>
 <label>Pool<select value={r.group} onChange={e=>change(r.id,{group:e.target.value as TargetGroup})}><option value="bar">Bar</option><option value="floor">Floor</option><option value="exclude">Exclude</option></select></label>
 <label>Start time (Central)<input type="time" value={r.start_time} onChange={e=>change(r.id,{start_time:e.target.value})}/></label>
 <label>Expected hours<input type="number" min="0.01" max="24" step="0.01" value={r.hours} onChange={e=>change(r.id,{hours:e.target.value})}/></label></div>
 <button type="button" onClick={()=>{setRows(v=>v.filter(x=>x.id!==r.id));edited()}}>Remove from this date</button></article>)}
 {!rows.length&&<p>No employees on this target list.</p>}<p>Employees without accounts keep their sales targets. They can be linked later on an unlocked date. Removing a row changes only this date’s allocation.</p>
 {dirty&&<p role="status">Unsaved employee changes. Save the list before changing calculation settings.</p>}
 {invalid&&<p>Enter a name, position, start time and valid expected hours for every employee. An app account is not required.</p>}
 <button type="button" disabled={(!dirty&&data.manual)||invalid} onClick={()=>void save()}>{busy?'Saving…':'Save sales target employees'}</button></fieldset></>}
 </section>
}
