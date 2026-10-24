import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {loadLocationTeam,type TeamMember} from '../lib/team'
import {TeamProfileName} from './TeamProfileName'
import {CloseoutReceiptWallet} from './CloseoutReceiptWallet'
import type {Question} from './CloseoutConfig'

type Review={user_id:string;rating:number;reason:string}
type Detail={reviews:Review[];questions:Question[];answers:Record<string,unknown>;team:TeamMember[]}
export function ManagerCloseoutDetails({location,day,shift,refresh}:{location:string;day:string;shift:string;refresh:number}){
 const [data,setData]=useState<Detail|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{let active=true;setData(null);setError('');void(async()=>{
  try{
   const [saved,answers,team]=await Promise.all([supabase.rpc('mod_get_closeout',{p_shift_id:shift}),supabase.rpc('closeout_manager_answers',{p_shift_id:shift}),loadLocationTeam(location).catch(()=>[])])
   if(saved.error)throw saved.error;if(answers.error)throw answers.error
   if(!saved.data)throw Error('This manager closeout is no longer available. Refresh the summary.')
   if(active)setData({reviews:saved.data.reviews??[],questions:answers.data?.questions??[],answers:answers.data?.answers??{},team})
  }catch(e){if(active)setError(String((e as {message?:string}).message??e))}
 })();return()=>{active=false}},[location,shift,refresh,retry])
 return <section className="manager-closeout-detail" aria-label="Saved manager closeout details">
  {error?<p role="alert">Could not load saved reviews and answers: {error} <button type="button" onClick={()=>setRetry(v=>v+1)}>Retry details</button></p>:!data?<p role="status">Loading saved reviews and answers…</p>:<>
   <h3>Staff ratings and reasons</h3>
   {data.reviews.length?<ul>{data.reviews.map(r=>{const person=data.team.find(m=>m.user_id===r.user_id),name=person?.profile?.preferred_name||person?.profile?.full_name||'Employee name unavailable';return <li key={r.user_id}><TeamProfileName locationId={location} userId={r.user_id} name={name}/> · <strong>{r.rating}/10</strong><p style={{whiteSpace:'pre-wrap'}}>{r.reason||'Reason not recorded'}</p></li>})}</ul>:<p>No saved staff reviews were returned.</p>}
   <h3>Saved manager answers</h3>
   {data.questions.length?<dl>{data.questions.map(q=><div key={q.id}><dt>{q.label}</dt><dd>{String(data.answers[q.id]??'Not recorded')}</dd></div>)}</dl>:<p>No custom question snapshot was returned for this closeout.</p>}
  </>}
  <CloseoutReceiptWallet submittedOnly location={location} day={day} shiftId={shift} label="Submitted receipts for this manager closeout"/>
 </section>
}
