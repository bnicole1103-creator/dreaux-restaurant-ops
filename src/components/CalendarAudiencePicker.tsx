import { TeamProfileName } from './TeamProfileName'
import {PageWord} from './PageDesign'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {audienceLabel,calendarRoles,everyoneCalendarAudience,type CalendarAudience} from '../lib/calendarAudience'
import './CalendarAudiencePicker.css'
type Person={id:string;name:string;role:string}
export function CalendarAudiencePicker({location,value,onChange,disabled,onReady}:{location:string;value:CalendarAudience;onChange:(value:CalendarAudience)=>void;disabled:boolean;onReady:(ready:boolean)=>void}){
 const [people,setPeople]=useState<Person[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0)
 useEffect(()=>{let live=true;setLoading(true);setError('');onReady(false);void supabase.rpc('calendar_audience_roster',{p_location_id:location}).then(r=>{if(!live)return;if(r.error){setError(r.error.message);onReady(false)}else{setPeople(r.data??[]);onReady(true)}setLoading(false)});return()=>{live=false}},[location,retry,onReady])
 const listed=people.filter(p=>(p.name+' '+p.role.replace(/_/g,' ')).toLowerCase().includes(query.toLowerCase()))
 const unknown=value.users.filter(id=>!people.some(p=>p.id===id))
 function toggle(key:'roles'|'users',id:string,checked:boolean){onChange({...value,[key]:checked?[...value[key],id]:value[key].filter(x=>x!==id)})}
 return <fieldset data-design-block="section.0497b831aa3d9017f401" className="calendar-audience-picker" disabled={disabled}><legend><PageWord id="sectioncopy.e42e09602101808b821d">{"Who can see this calendar update?"}</PageWord></legend>
  <label><PageWord id="sectioncopy.d40e761d51c821af312f">{"Visibility"}</PageWord><select value={value.mode} onChange={e=>onChange(e.target.value==='all'?everyoneCalendarAudience():{mode:'selected',roles:[],users:[]})}><option value="all">Everyone at this location</option><option value="selected">Selected roles or people</option></select></label>
  {loading&&<p role="status"><PageWord id="sectioncopy.1a55216919619a647387">{"Loading employees…"}</PageWord></p>}{error&&<p role="alert"><PageWord id="sectioncopy.04020be865d016c8ee36">{"Could not load the audience list: "}</PageWord>{error} <button type="button" onClick={()=>setRetry(v=>v+1)}><PageWord id="sectioncopy.826916c250a97847b294">{"Try again"}</PageWord></button></p>}
  {value.mode==='selected'&&<><p><PageWord id="sectioncopy.2ac5c061954ecdd1e058">{"Anyone in a checked role or selected by name can see it."}</PageWord></p><div className="calendar-audience-roles" role="group" aria-label="Role groups">{calendarRoles.map(([id,label])=><label key={id}><input type="checkbox" checked={value.roles.includes(id)} onChange={e=>toggle('roles',id,e.target.checked)}/><span>{label}</span></label>)}</div>
   <label><PageWord id="sectioncopy.e278acbfbbf4a35b10e8">{"Find employees"}</PageWord><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or role"/></label>
   <div className="calendar-audience-people" role="group" aria-label="Specific employees">{listed.map(p=><label key={p.id}><input type="checkbox" checked={value.users.includes(p.id)} onChange={e=>toggle('users',p.id,e.target.checked)}/><span><TeamProfileName locationId={location} userId={p.id} name={p.name}/><small>{p.role.replace(/_/g,' ')}</small></span></label>)}</div>
   {!loading&&!error&&!listed.length&&<p><PageWord id="sectioncopy.684845ca4428d7117596">{"No matching employees."}</PageWord></p>}
   {unknown.length>0&&<p role="alert">{unknown.length}<PageWord id="sectioncopy.8a3ebeb95fd8b77d99c9">{" selected employee account(s) are no longer available. "}</PageWord><button type="button" onClick={()=>onChange({...value,users:value.users.filter(id=>!unknown.includes(id))})}><PageWord id="sectioncopy.53df4047d7a0a2197ed8">{"Remove unavailable people"}</PageWord></button></p>}
   {!value.roles.length&&!value.users.length&&<p role="status"><PageWord id="sectioncopy.e9764595890d47b119fd">{"Select at least one role or person before saving."}</PageWord></p>}
  </>}
  <p className="calendar-audience-summary"><strong><PageWord id="sectioncopy.ecb44e51f87a12dd7685">{"Visible to:"}</PageWord></strong> {audienceLabel(value)}</p><p className="muted"><PageWord id="sectioncopy.3afd1c705b4ef1efa663">{"Managers at this location can also view and manage calendar updates."}</PageWord></p>
 </fieldset>
}
