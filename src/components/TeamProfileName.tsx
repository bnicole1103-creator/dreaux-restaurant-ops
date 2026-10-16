import {TeamProfileWeek} from './TeamProfileWeek'
import {useEffect,useRef,useState,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {supabase} from '../lib/supabase'
import {loadTenantData} from '../lib/tenant'
import {EmployeeProfile} from './EmployeeProfile'
import './TeamProfile.css'
type Person={user_id:string;name:string;role:string;status:string;photo:string|null;can_analyze:boolean}
function BasicDialog({person,error,busy,onClose,location}:{person:Person|null;error:string;busy:boolean;onClose:()=>void;location:string}){
 const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{const d=dialog.current;d?.showModal();return()=>d?.close()},[])
 return createPortal(<dialog className="wt-dialog team-profile-dialog" ref={dialog} onCancel={onClose} aria-label="Team profile"><button type="button" className="wt-close" aria-label="Close team profile" onClick={onClose}>×</button>{busy&&<p role="status">Opening team profile…</p>}{error&&<p role="alert">{error}</p>}{person&&<>{person.photo&&<img className="team-profile-photo" src={person.photo} alt=""/>}<h2>{person.name}</h2><p>{person.role.replace(/_/g,' ')} · {person.status}</p><TeamProfileWeek locationId={location} userId={person.user_id}/><p>Detailed activity and analysis are available to this employee and management.</p></>}</dialog>,document.body)
}
export function TeamProfileName({userId,employeeKey,locationId,name,children,postId}:{postId?:string;userId?:string|null;employeeKey?:string|null;locationId?:string;name?:string;children?:ReactNode}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[person,setPerson]=useState<Person|null>(null),[location,setLocation]=useState('')
 const sequence=useRef(0),trigger=useRef<HTMLButtonElement>(null)
 useEffect(()=>()=>{sequence.current++},[])
 function close(){sequence.current++;setOpen(false);setBusy(false);setPerson(null);setError('');trigger.current?.focus()}
 async function show(){if(busy)return;const token=++sequence.current;setOpen(true);setBusy(true);setPerson(null);setError('');try{
  const loc=locationId||(await loadTenantData()).locations[0]?.id;if(!loc)throw Error('No active location.');
  const r=postId?await supabase.rpc('team_profile_post_author',{p_location_id:loc,p_post_id:postId}):await supabase.rpc('team_profile_resolve',{p_location_id:loc,p_user_id:userId||null,p_employee_key:employeeKey||null});if(r.error)throw r.error;
  if(sequence.current===token){setPerson(r.data);setLocation(loc)}
 }catch(e){if(sequence.current===token)setError(String((e as Error).message??e))}finally{if(sequence.current===token)setBusy(false)}}
 return <><button ref={trigger} className="team-profile-name" type="button" aria-label={'Open team profile for '+(name??'employee')} onClick={e=>{e.stopPropagation();void show()}}>{children??name??'Team member'}</button>{open&&(person?.can_analyze?<EmployeeProfile key={person.user_id} locationId={location} userId={person.user_id} onClose={close}/>:<BasicDialog location={location} person={person} error={error} busy={busy} onClose={close}/>)}</>
}

