import {PageWord} from './PageDesign'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {serviceDay} from '../lib/serviceDay'
type State={manager:boolean;user_id:string;open:boolean;deadline:string;employees:{id:string;name:string}[];assignments:{user_id:string;name:string;completed:boolean;no_disposals:boolean}[]}
export function DisposalRequirements({location,refreshKey}:{location:string;refreshKey:number}){
 const [day,setDay]=useState(()=>serviceDay()),[data,setData]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[employee,setEmployee]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{let live=true;setData(null);setError('');if(location)void supabase.rpc('disposal_requirements_day',{p_location_id:location,p_day:day}).then(r=>{if(live){if(r.error)setError(r.error.message);else setData(r.data)}});return()=>{live=false}},[location,day,revision,refreshKey])
 async function change(user:string,active:boolean){setBusy(true);setError('');try{const r=await supabase.rpc('disposal_requirement_assign',{p_location_id:location,p_day:day,p_user_id:user,p_active:active});if(r.error)throw r.error;setEmployee('');setRevision(v=>v+1)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function none(){if(!window.confirm('Confirm you had no disposals to report for this shift?'))return;setBusy(true);setError('');try{const r=await supabase.rpc('disposal_requirement_none',{p_location_id:location,p_day:day});if(r.error)throw r.error;setRevision(v=>v+1)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const mine=data?.assignments.find(a=>a.user_id===data.user_id)
 return <section data-design-block="section.43e29761114591f92021" className="inventory-card"><h2><PageWord id="sectioncopy.8b91b0309b4b4e8ae36a">{"Required disposal forms"}</PageWord></h2><p><PageWord id="sectioncopy.b754d00cfe1de56ef682">{"Assigned employees lose 10 points if no disposal sheet or “No disposals” confirmation is submitted by 4 AM Central. Unassigned employees have no disposal deduction."}</PageWord></p>
 <label><PageWord id="sectioncopy.4416033541f57e903b7d">{"Service date"}</PageWord><input type="date" value={day} disabled={busy} onChange={e=>{if(e.target.value)setDay(e.target.value)}}/></label>
 {error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status"><PageWord id="sectioncopy.a28ecddba908e421ee3c">{"Loading assignments…"}</PageWord></p>}
 {data&&<><button type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)}><PageWord id="sectioncopy.1edced01ff66541434d7">{"Refresh assignments"}</PageWord></button>
 {data.manager&&<><label><PageWord id="sectioncopy.9ddf865901ca6aa741f2">{"Assign employee"}</PageWord><select disabled={busy||!data.open} value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">Choose employee</option>{data.employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><button type="button" disabled={busy||!data.open||!employee} onClick={()=>void change(employee,true)}><PageWord id="sectioncopy.724d199444e1e851ebe3">{"Assign disposal form"}</PageWord></button></>}
 {!data.assignments.length?<p><PageWord id="sectioncopy.b9c9632b0025f360cd5a">{"No disposal assignments for this date."}</PageWord></p>:<ul>{data.assignments.map(a=><li key={a.user_id}>{a.name}<PageWord id="sectioncopy.53b2942ac6fce2154c66">{": "}</PageWord>{a.completed?(a.no_disposals?'No disposals confirmed':'Disposal sheet submitted'):data.open?'Required before 4 AM':'Missed · −10 points'} {data.manager&&<button type="button" disabled={busy} onClick={()=>void change(a.user_id,false)}><PageWord id="sectioncopy.061f99f8cbd6846266c7">{"Cancel requirement"}</PageWord></button>}</li>)}</ul>}
 {mine&&!mine.completed&&data.open&&day===serviceDay()&&<button type="button" disabled={busy} onClick={()=>void none()}><PageWord id="sectioncopy.b16bdb7f19636442743e">{"No disposals this shift"}</PageWord></button>}
 {mine&&!mine.completed&&data.open&&<p><PageWord id="sectioncopy.c2f1ce7617c13eb097f2">{"For discarded bottles, submit the disposal count sheet below, then refresh assignments."}</PageWord></p>}
 </>}
 </section>
}
