import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { submissionLabel } from '../lib/submissionTime'
type Staff={user_id:string;name:string;required:boolean;submitted:boolean}
export function QuizRequiredStaff({location,quizId}:{location:string;quizId:string}) {
 const [staff,setStaff]=useState<Staff[]>([]);const [due,setDue]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('')
 useEffect(()=>{let live=true;setBusy(true);setError('');setMessage('');setStaff([]);void supabase.rpc('quiz_manager_roster',{p_location_id:location,p_quiz_id:quizId}).then(({data,error})=>{if(!live)return;if(error)setError(error.message);else{setStaff(data.staff);setDue(data.due_at)}setBusy(false)});return()=>{live=false}},[location,quizId])
 const closed=!!due&&Date.now()>=new Date(due).getTime()
 async function save(){setBusy(true);setError('');setMessage('');try{const {error}=await supabase.rpc('quiz_manager_set_roster',{p_location_id:location,p_quiz_id:quizId,p_users:staff.filter(s=>s.required).map(s=>s.user_id)});if(error)throw error;setMessage('Required staff saved.')}catch(e){setError(String((e as {message?:string}).message??e))}finally{setBusy(false)}}
 return <article className="mod-review"><h2>Staff Required to Take This Quiz</h2><p>Select staff working this day. Only selected staff receive a 10-point deduction if they miss the deadline.</p><p>Deadline: {submissionLabel(due)}</p><p>Late submission does not remove the missed-quiz deduction. The GM can waive it in Points.</p>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{closed&&<p>The deadline has passed. Point corrections are available to the GM in Points.</p>}<fieldset disabled={busy||closed}>{staff.map(s=><label key={s.user_id} className="quiz-choice"><input type="checkbox" checked={s.required} onChange={e=>setStaff(rows=>rows.map(r=>r.user_id===s.user_id?{...r,required:e.target.checked}:r))} />{s.name}{s.submitted?' · Submitted':''}</label>)}<button type="button" onClick={()=>void save()}>Save Required Staff</button></fieldset></article>
}
