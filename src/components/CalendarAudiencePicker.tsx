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
 return <fieldset className="calendar-audience-picker" disabled={disabled}><legend>Who can see this calendar update?</legend>
  <label>Visibility<select value={value.mode} onChange={e=>onChange(e.target.value==='all'?everyoneCalendarAudience():{mode:'selected',roles:[],users:[]})}><option value="all">Everyone at this location</option><option value="selected">Selected roles or people</option></select></label>
  {loading&&<p role="status">Loading employees…</p>}{error&&<p role="alert">Could not load the audience list: {error} <button type="button" onClick={()=>setRetry(v=>v+1)}>Try again</button></p>}
  {value.mode==='selected'&&<><p>Anyone in a checked role or selected by name can see it.</p><div className="calendar-audience-roles" role="group" aria-label="Role groups">{calendarRoles.map(([id,label])=><label key={id}><input type="checkbox" checked={value.roles.includes(id)} onChange={e=>toggle('roles',id,e.target.checked)}/><span>{label}</span></label>)}</div>
   <label>Find employees<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or role"/></label>
   <div className="calendar-audience-people" role="group" aria-label="Specific employees">{listed.map(p=><label key={p.id}><input type="checkbox" checked={value.users.includes(p.id)} onChange={e=>toggle('users',p.id,e.target.checked)}/><span>{p.name}<small>{p.role.replace(/_/g,' ')}</small></span></label>)}</div>
   {!loading&&!error&&!listed.length&&<p>No matching employees.</p>}
   {unknown.length>0&&<p role="alert">{unknown.length} selected employee account(s) are no longer available. <button type="button" onClick={()=>onChange({...value,users:value.users.filter(id=>!unknown.includes(id))})}>Remove unavailable people</button></p>}
   {!value.roles.length&&!value.users.length&&<p role="status">Select at least one role or person before saving.</p>}
  </>}
  <p className="calendar-audience-summary"><strong>Visible to:</strong> {audienceLabel(value)}</p><p className="muted">Managers at this location can also view and manage calendar updates.</p>
 </fieldset>
}
