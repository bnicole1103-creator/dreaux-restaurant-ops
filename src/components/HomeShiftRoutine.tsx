import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {useAppAccess} from './AppAccess'
import {PageWord} from './PageDesign'
import {supabase} from '../lib/supabase'
import {serviceDateLabel} from '../lib/serviceDay'
import './HomeShiftRoutine.css'
type Post={id:string;version:number;title:string;shift_date:string}
type Quiz={quiz:{id:string;title:string};result:unknown|null}
type Task={id:string;phase:string;items:string[];checks:{index:number}[]}
type Section={id:string;name:string;tables:string}
type Viewing={required:boolean;applies_to_me?:boolean;credited_ms?:number;visible_ms?:number}
type Result<T>={data:T|null;error:string}
type State={posts:Result<Post[]>;quizzes:Result<Quiz[]>;required:Result<string[]>;sections:Result<Section[]>;tasks:Result<Task[]>;viewing:Result<Viewing[]>}
const blank=():State=>({posts:{data:null,error:''},quizzes:{data:null,error:''},required:{data:null,error:''},sections:{data:null,error:''},tasks:{data:null,error:''},viewing:{data:null,error:''}})
const message=(e:unknown)=>String((e as {message?:string})?.message??e)
export function HomeShiftRoutine({location,day,quizDate,refresh=0}:{location:string;day:string;quizDate:string;refresh?:number}){
 const access=useAppAccess(),postsAllowed=access.ready&&access.can('home','posts')&&access.can('posts','feed'),quizAllowed=access.ready&&access.can('home','quiz')&&access.can('quizzes','published'),sectionsAllowed=access.ready&&access.can('home','sections')&&access.can('floor','sections'),tasksAllowed=access.ready&&access.can('home','tasks')&&access.can('tasks','mine')
 const preview=new URLSearchParams(window.location.search).has('wording-preview')||new URLSearchParams(window.location.search).has('staff-preview')
 const [state,setState]=useState<State>(blank),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0)
 useEffect(()=>{
  let live=true;const controllers=new Set<AbortController>();setState(blank());setLoading(true)
  if(!location||!access.ready||preview){setLoading(false);return}
  async function call(name:string,args:Record<string,unknown>){const c=new AbortController();controllers.add(c);const timer=setTimeout(()=>c.abort(),20000);try{const r=await supabase.rpc(name,args).abortSignal(c.signal);if(r.error)throw r.error;return r.data}finally{clearTimeout(timer);controllers.delete(c)}}
  async function source<K extends keyof State>(key:K,read:()=>Promise<State[K]['data']>){try{const data=await read();if(live)setState(s=>({...s,[key]:{data,error:''}}))}catch(e){if(live)setState(s=>({...s,[key]:{data:null,error:message(e)}}))}}
  const jobs:Promise<void>[]=[]
  if(postsAllowed)jobs.push(source('posts',async()=>{const d=await call('preshift_feed',{p_location_id:location,p_limit:1000});if(!Array.isArray(d?.posts))throw Error('Pre-shift posts were not returned.');const posts=(d.posts as Post[]).filter(p=>p.shift_date===quizDate);if(d.posts.length>=1000)throw Error('The feed may be incomplete. Open the post feed to check today’s posts.');
   if(posts.length>30){if(live)setState(s=>({...s,viewing:{data:null,error:'Open posts to check viewing status; more than 30 posts are listed.'}}))}
   else await source('viewing',async()=>{const rows=await Promise.all(posts.map(p=>call('preshift_minute_status',{p_location_id:location,p_post_id:p.id})));if(rows.some(r=>typeof r?.required!=='boolean'))throw Error('Viewing status was not returned.');return rows as Viewing[]});return posts}))
  if(quizAllowed){jobs.push(source('quizzes',async()=>{const d=await call('quiz_staff_day_v2',{p_location_id:location,p_date:quizDate});if(!Array.isArray(d?.quizzes)||d.quizzes.some((q:Quiz)=>!q?.quiz?.id))throw Error('Today’s quizzes were not returned.');return d.quizzes as Quiz[]}));jobs.push(source('required',async()=>{const d=await call('quiz_staff_month',{p_location_id:location,p_month:quizDate.slice(0,7)+'-01'});if(!Array.isArray(d?.requirements)||d.requirements.some((r:{quiz_id?:string})=>typeof r?.quiz_id!=='string'))throw Error('Your required quiz list was not returned.');return d.requirements.map((r:{quiz_id:string})=>r.quiz_id)}))}
  if(sectionsAllowed)jobs.push(source('sections',async()=>{const d=await call('floor_sections_for_day',{p_location_id:location,p_date:day,p_only_me:true});if(!Array.isArray(d)||d.some((s:Section)=>typeof s?.name!=='string'||typeof s?.tables!=='string'))throw Error('Your sections were not returned.');return d as Section[]}))
  if(tasksAllowed)jobs.push(source('tasks',async()=>{const d=await call('staff_tasks_day',{p_location_id:location,p_day:day,p_team:false});if(!Array.isArray(d)||d.some((t:Task)=>!t||!Array.isArray(t.items)||!Array.isArray(t.checks)))throw Error('Your task lists were not returned.');return d as Task[]}))
  void Promise.allSettled(jobs).finally(()=>{if(live)setLoading(false)})
  return()=>{live=false;for(const c of controllers)c.abort()}
 },[location,day,quizDate,refresh,retry,preview,access.ready,postsAllowed,quizAllowed,sectionsAllowed,tasksAllowed])
 if(!postsAllowed&&!quizAllowed&&!sectionsAllowed&&!tasksAllowed)return null
 const required=state.quizzes.data?.filter(q=>state.required.data?.includes(q.quiz.id))??[],submitted=required.filter(q=>q.result!=null).length,optional=state.quizzes.data?.filter(q=>!state.required.data?.includes(q.quiz.id)).length??0
 const opening=state.tasks.data?.filter(t=>['Morning','Opening'].includes(t.phase))??[],total=opening.reduce((n,t)=>n+t.items.length,0),done=opening.reduce((n,t)=>n+new Set(t.checks.filter(c=>Number.isInteger(c.index)&&c.index>=0&&c.index<t.items.length).map(c=>c.index)).size,0),later=(state.tasks.data?.length??0)-opening.length
 const timed=state.viewing.data?.filter(v=>v.required&&v.applies_to_me!==false)??[],viewed=timed.filter(v=>(v.credited_ms??v.visible_ms??0)>=60000).length
 const pending=(error:string,data:unknown)=>error?'Could not check — '+error:data===null?'Checking…':''
 const postsText=pending(state.posts.error,state.posts.data)||(!state.posts.data?.length?'No pre-shift published for this date.':`${state.posts.data.length} post${state.posts.data.length===1?'':'s'} to review. `+(state.viewing.error?'Viewing status unavailable.':state.viewing.data===null?'Checking viewing requirements…':timed.length?`${viewed}/${timed.length} timed viewing requirements met.`:'No timed viewing requirement listed.'))
 const quizzesText=pending(state.quizzes.error,state.quizzes.data)||pending(state.required.error,state.required.data)||(required.length?`${submitted}/${required.length} required quizzes submitted.`+(optional?` ${optional} additional quiz${optional===1?'':'zes'} available.`:''):state.quizzes.data?.length?`${state.quizzes.data.length} published; none listed as required for you today.`:'No published quiz for this date.')
 const sectionsText=pending(state.sections.error,state.sections.data)||(state.sections.data?.length?state.sections.data.map(s=>s.name+(s.tables?' · '+s.tables:'')).join(' / '):'No section published for you. Check with management if you need one.')
 const tasksText=pending(state.tasks.error,state.tasks.data)||(opening.length?`${done}/${total} opening tasks complete.`:'No opening task lists assigned.')+(state.tasks.data&&later?` ${later} other list${later===1?'':'s'} available for this service day.`:'')
 return <details className="home-shift-routine" open data-design-block="home.routine.card" data-layout-label="Start my shift card"><summary><span><strong><PageWord id="home.routine.title">Start my shift</PageWord></strong><small><PageWord id="home.routine.subtitle">Pre-shift · quizzes · section · opening tasks</PageWord></small></span></summary>{preview?<p>Live routine status is paused in the editor preview.</p>:<><p className="routine-date">Work service day: {serviceDateLabel(day)}{quizDate!==day&&<> · Posts and quizzes: {serviceDateLabel(quizDate)}</>}</p><ol>
 {postsAllowed&&<li data-design-block="home.routine.posts"><div><strong><PageWord id="home.routine.posts.title">Read today’s pre-shift</PageWord></strong><p>{postsText}</p></div><Link to="/preshift/feed">Open posts →</Link></li>}
 {quizAllowed&&<li data-design-block="home.routine.quizzes"><div><strong><PageWord id="home.routine.quizzes.title">Complete required quizzes</PageWord></strong><p>{quizzesText}</p></div><Link to="/quizzes">Open quizzes →</Link></li>}
 {sectionsAllowed&&<li data-design-block="home.routine.sections"><div><strong><PageWord id="home.routine.sections.title">Check my section</PageWord></strong><p>{sectionsText}</p></div><Link to="/floor">Open floor →</Link></li>}
 {tasksAllowed&&<li data-design-block="home.routine.tasks"><div><strong><PageWord id="home.routine.tasks.title">Complete opening tasks</PageWord></strong><p>{tasksText}</p></div><Link to="/tasks">Open my lists →</Link></li>}
 </ol><div className="routine-footer"><small>Opening a page does not mark work complete. Saved records refresh when you return to Home. Viewing time does not confirm understanding.</small><button type="button" disabled={loading} onClick={()=>setRetry(v=>v+1)}>{loading?'Checking…':'Refresh my routine'}</button></div></>}</details>
}
