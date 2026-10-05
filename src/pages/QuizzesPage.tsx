import { ScreenText } from "../components/ScreenText"
import { submissionLabel } from '../lib/submissionTime'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { useManagementAccess } from '../components/ManagementAccess'
import { PublishedQuizzes } from '../components/PublishedQuizzes'
import type { PublishedQuiz } from '../components/PublishedQuizzes'
import './ManagerCloseoutPage.css'
import './QuizzesPage.css'
export type Question = {prompt:string;category:string;options:string[];correct:number;explanation:string}
export type Quiz = {id:string;version:number;quiz_date:string;title:string;instructions:string;questions:Question[];published:boolean}
export type QuizResult = {score:number;total:number;percent:number;reward_points?:number;questions:{prompt:string;category:string;selected:string;correct_answer:string;correct:boolean;explanation:string}[]}
type Attempt={quiz_id:string;quiz_date:string;title:string;submitted_at:string;result:QuizResult;running_score:number;earned_points:number}
type Monthly={points:number;correct:number;requirements:{quiz_id:string;due_at:string}[];penalties:{entry_key:string;business_date:string;points:number;description:string}[];possible:number;completed:number;attempts:Attempt[]}
export function quizToday(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(t:string)=>p.find(x=>x.type===t)?.value;return `${get('year')}-${get('month')}-${get('day')}`}
export function quizTomorrow(){const d=new Date(`${quizToday()}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
export function quizDateLabel(day:string){return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}).format(new Date(`${day}T12:00:00Z`))}
export function quizError(e:unknown){return String((e as {message?:string})?.message ?? e)}
export function QuizResults({result}:{result:QuizResult}){
 return <article className="mod-review"><h3><ScreenText id="QuizzesPage.415b1b5046913963">Your score: </ScreenText>{result.score} / {result.total} ({result.percent}%)</h3>
  {result.questions.map((q,i)=><article className="quiz-question" key={i}><h4>{i+1}. {q.prompt}</h4><p>{q.correct?'Correct':'Incorrect'}<ScreenText id="QuizzesPage.a96b839a58105eb0"> · Your answer: </ScreenText>{q.selected}</p><p><ScreenText id="QuizzesPage.9d4db8d05a3c92fd">Correct answer: </ScreenText>{q.correct_answer}</p>{q.explanation && <p>{q.explanation}</p>}</article>)}
 </article>
}
function CompletedQuiz({title,date,result,running,monthly,submittedAt,earned}:{title:string;date:string;result:QuizResult;running?:number;monthly?:number;submittedAt?:string;earned?:number}){
 return <details className="quiz-completed"><summary><span><strong><ScreenText id="QuizzesPage.246cabe13c327bdc">Pre-Shift Quiz · </ScreenText>{quizDateLabel(date)}</strong><span className="quiz-card-title">{title}</span></span><span className="quiz-card-score">{result.score}/{result.total} · {result.percent}%<span className="quiz-card-title"><ScreenText id="QuizzesPage.9590afcd98be4b71">View answers and quiz points</ScreenText></span></span></summary>
  <p><ScreenText id="QuizzesPage.77476d75d9140c97">Submitted: </ScreenText>{submissionLabel(submittedAt)}</p><p><ScreenText id="QuizzesPage.ef21706a6f8b637a">Quiz points earned: </ScreenText><strong>{earned ?? result.reward_points ?? (result.score===result.total?5:result.score*5>=result.total*4?3:0)}</strong>{running!==undefined && <><ScreenText id="QuizzesPage.74e997483f95abd8"> · Running quiz score through this quiz: </ScreenText><strong>{running}</strong></>}{monthly!==undefined && <><ScreenText id="QuizzesPage.01e8804e8e0a8c89"> · Monthly reward points: </ScreenText><strong>{monthly}</strong></>}</p>
  <QuizResults result={result} />
 </details>
}
export function QuizzesPage(){
 const access=useManagementAccess();const navigate=useNavigate()
 const [location,setLocation]=useState('');const [date,setDate]=useState(quizToday)
 const [month,setMonth]=useState(()=>quizToday().slice(0,7));const [refresh,setRefresh]=useState(0)
 const [quiz,setQuiz]=useState<Quiz|null>(null);const [result,setResult]=useState<QuizResult|null>(null)
 const [monthly,setMonthly]=useState<Monthly|null>(null);const [answers,setAnswers]=useState<Record<number,number>>({})
 const [busy,setBusy]=useState(true);const [monthBusy,setMonthBusy]=useState(true);const [error,setError]=useState('');const [monthError,setMonthError]=useState('')
 useEffect(()=>{let live=true;void loadTenantData().then(t=>{if(!t.locations[0])throw new Error('No active location.');if(live)setLocation(t.locations[0].id)}).catch(e=>{if(live){setError(quizError(e));setBusy(false);setMonthBusy(false)}});return()=>{live=false}},[])
 useEffect(()=>{const check=()=>setDate(quizToday());const visible=()=>{if(document.visibilityState==='visible')check()};const timer=setInterval(check,30000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',visible)}},[])
 useEffect(()=>{setMonth(date.slice(0,7))},[date])
 useEffect(()=>{if(!location)return;let live=true;setBusy(true);setError('');setQuiz(null);setResult(null);setAnswers({});void (async()=>{
  try{const {data,error}=await supabase.rpc('quiz_staff_load',{p_location_id:location,p_date:date});if(error)throw error;if(live){setQuiz(data.quiz);setResult(data.result)}}catch(e){if(live)setError(quizError(e))}finally{if(live)setBusy(false)}
 })();return()=>{live=false}},[location,date,refresh])
 useEffect(()=>{if(!location)return;let live=true;setMonthBusy(true);setMonthError('');setMonthly(null);void (async()=>{
  try{const {data,error}=await supabase.rpc('quiz_staff_month',{p_location_id:location,p_month:month+'-01'});if(error)throw error;if(live)setMonthly(data)}catch(e){if(live)setMonthError(quizError(e))}finally{if(live)setMonthBusy(false)}
 })();return()=>{live=false}},[location,month,refresh])
 async function submit(){
  if(!quiz || !window.confirm('Submit your answers? You can submit this quiz once.'))return
  setBusy(true);setError('')
  try{const {data,error}=await supabase.rpc('quiz_staff_submit',{p_quiz_id:quiz.id,p_version:quiz.version,p_answers:quiz.questions.map((_,i)=>answers[i] ?? null)});if(error)throw error;setResult(data);setRefresh(v=>v+1)}catch(e){setError(quizError(e))}finally{setBusy(false)}
 }
 async function remove(q:PublishedQuiz){
  if(Object.keys(answers).length && !result && !window.confirm('Discard your unsaved quiz answers?'))return
  if(!window.confirm('Remove "'+q.title+'" from staff access? Completed scores and answers will be preserved.'))return
  setBusy(true);setError('')
  try{const {error}=await supabase.rpc('quiz_manager_remove',{p_location_id:location,p_quiz_id:q.id,p_version:q.version});if(error)throw error;setRefresh(v=>v+1)}catch(e){setError(quizError(e))}finally{setBusy(false)}
 }
 const ownToday=monthly?.attempts.find(a=>a.quiz_date===date)
 const otherAttempts=monthly?.attempts.filter(a=>!(quiz && result && a.quiz_date===date)) ?? []
 return <section className="mod-page quiz-page"><p className="eyebrow"><ScreenText id="QuizzesPage.15c8c5ead821decf">Pre-shift preparation</ScreenText></p><h1><ScreenText id="QuizzesPage.38584cb9f2b57db7">Daily Quizzes</ScreenText></h1>
  <div className="quiz-actions">{access.manager && <Link className="quiz-builder-link" to="/quizzes/build"><ScreenText id="QuizzesPage.84f911a877a2c179">Build Future Quizzes / Question Bank →</ScreenText></Link>}<button type="button" disabled={busy} onClick={()=>{if(Object.keys(answers).length && !result && !window.confirm('Discard your answers and reload the quiz?'))return;setRefresh(v=>v+1)}}><ScreenText id="QuizzesPage.879f2447f6bb95b8">Refresh</ScreenText></button></div>
  <h2><ScreenText id="QuizzesPage.6e4f183331ca689e">Today · </ScreenText>{quizDateLabel(date)}</h2>
  {error && <p role="alert">{error}</p>}{busy && <p role="status"><ScreenText id="QuizzesPage.6799e69e289fa08d">Loading…</ScreenText></p>}
  {!busy && !quiz && !error && <article className="mod-review"><h3><ScreenText id="QuizzesPage.1d72b99728971f78">No quiz published for today</ScreenText></h3><p><ScreenText id="QuizzesPage.21286979d56c5fd7">Your manager will publish today’s pre-shift quiz here.</ScreenText></p>{access.manager && <Link to={'/quizzes/manage?date='+date}><ScreenText id="QuizzesPage.0904328e9a0b32e1">Create / Publish Today’s Quiz →</ScreenText></Link>}</article>}
  {quiz && monthly?.requirements?.find(r=>r.quiz_id===quiz.id) && <p><ScreenText id="QuizzesPage.cf3a03ebcb629cd4">This quiz is required for you. Deadline: </ScreenText>{submissionLabel(monthly.requirements.find(r=>r.quiz_id===quiz.id)?.due_at)}.</p>}
  {quiz && (result?<CompletedQuiz title={quiz.title} date={date} result={result} submittedAt={ownToday?.submitted_at} earned={ownToday?.earned_points} running={ownToday?.running_score} monthly={month===date.slice(0,7)?monthly?.points:undefined} />:<article className="mod-review"><h3><ScreenText id="QuizzesPage.3780149cd908fc4d">Pre-Shift Quiz · </ScreenText>{quizDateLabel(date)}</h3><p>{quiz.title}</p>{quiz.instructions && <p className="quiz-instructions">{quiz.instructions}</p>}
   <form onSubmit={e=>{e.preventDefault();void submit()}}>{quiz.questions.map((q,i)=><fieldset className="quiz-question" key={i} disabled={busy}><legend>{i+1}. {q.prompt}</legend><p className="muted">{q.category}</p>{q.options.map((option,n)=><label className="quiz-choice" key={n}><input type="radio" name={'question-'+i} checked={answers[i]===n} required onChange={()=>setAnswers(v=>({...v,[i]:n}))} /><span>{option}</span></label>)}</fieldset>)}<button className="primary-button" disabled={busy || quiz.questions.some((_,i)=>answers[i]===undefined)}><ScreenText id="QuizzesPage.b60395f153d3e55e">Submit Quiz</ScreenText></button></form>
  </article>)}
  <article className="mod-review"><h2><ScreenText id="QuizzesPage.0cb69b9dbee3b5dd">My Monthly Quiz Scores</ScreenText></h2><label><ScreenText id="QuizzesPage.76488090a5a6664f">Month</ScreenText><input type="month" value={month} max={date.slice(0,7)} onChange={e=>{if(e.target.value)setMonth(e.target.value)}} /></label>
   {monthError && <p role="alert">{monthError}</p>}{monthBusy && <p role="status"><ScreenText id="QuizzesPage.2932d9f524945dc5">Loading quiz points…</ScreenText></p>}
   {monthly && <><p className="quiz-month-total"><strong>{monthly.correct} / {monthly.possible}</strong><ScreenText id="QuizzesPage.c867c300a82de4b2"> correct answers</ScreenText></p><p>{monthly.completed}<ScreenText id="QuizzesPage.e88d2571ca0c7ec0"> quizzes completed · </ScreenText>{monthly.points}<ScreenText id="QuizzesPage.8e8d6815000b8987"> reward points</ScreenText></p></>}
   
   {monthly?.penalties.map(p=><p key={p.entry_key}>{p.business_date} · {p.description}: {p.points}<ScreenText id="QuizzesPage.630cf41c7a0e6dc8"> points</ScreenText></p>)}
   <h3><ScreenText id="QuizzesPage.3c438183031c1c95">Completed quizzes</ScreenText></h3>{monthly && otherAttempts.length===0 && <p>{ownToday && quiz && result?'Today’s completed quiz is shown above.':'No other quizzes completed this month.'}</p>}
   {otherAttempts.map(a=><CompletedQuiz key={a.quiz_id} title={a.title} date={a.quiz_date} result={a.result} submittedAt={a.submitted_at} earned={a.earned_points} running={a.running_score} monthly={monthly?.points} />)}
  </article>
  {access.manager && <details><summary><ScreenText id="QuizzesPage.26d09c58d141e83c">Manage Published Quizzes / Team Scores</ScreenText></summary><PublishedQuizzes location={location} refresh={refresh} disabled={busy || !location} throughDate={date} onEdit={d=>navigate('/quizzes/manage?date='+d)} onRemove={remove} /></details>}
 </section>
}


