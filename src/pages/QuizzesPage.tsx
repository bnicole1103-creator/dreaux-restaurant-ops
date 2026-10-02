import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { useManagementAccess } from '../components/ManagementAccess'
import './ManagerCloseoutPage.css'
import './QuizzesPage.css'
export type Question = {prompt: string; category: string; options: string[]; correct: number; explanation: string}
export type Quiz = {id: string; version: number; quiz_date: string; title: string; instructions: string; questions: Question[]; published: boolean}
export type QuizResult = {score: number; total: number; percent: number; questions: {prompt: string; category: string; selected: string; correct_answer: string; correct: boolean; explanation: string}[]}
export function quizToday() {return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
export function quizError(e: unknown) {return String((e as {message?:string})?.message ?? e)}
export function QuizResults({result}: {result: QuizResult}) {
 return <article className="mod-review"><h2>Your score: {result.score} / {result.total} ({result.percent}%)</h2>
 {result.questions.map((q,i)=><article className="quiz-question" key={i}><h3>{i+1}. {q.prompt}</h3><p>{q.correct ? 'Correct' : 'Incorrect'} · Your answer: {q.selected}</p>{!q.correct && <p>Correct answer: {q.correct_answer}</p>}{q.explanation && <p>{q.explanation}</p>}</article>)}
 </article>
}
export function QuizzesPage() {
 const access=useManagementAccess()
 const [location,setLocation]=useState('')
 const [date,setDate]=useState(quizToday)
 const [quiz,setQuiz]=useState<Quiz | null>(null)
 const [result,setResult]=useState<QuizResult | null>(null)
 const [answers,setAnswers]=useState<Record<number,number>>({})
 const [busy,setBusy]=useState(true)
 const [error,setError]=useState('')
 useEffect(()=>{let live=true;void loadTenantData().then(t=>{if(!t.locations[0]) throw new Error('No active location.');if(live)setLocation(t.locations[0].id)}).catch(e=>{if(live){setError(quizError(e));setBusy(false)}});return()=>{live=false}},[])
 useEffect(()=>{if(!location)return;let live=true;setBusy(true);setError('');setQuiz(null);setResult(null);setAnswers({});void supabase.rpc('quiz_staff_load',{p_location_id:location,p_date:date}).then(({data,error})=>{if(!live)return;if(error)setError(error.message);else{setQuiz(data.quiz);setResult(data.result)}setBusy(false)});return()=>{live=false}},[location,date])
 async function submit() {
  if(!quiz || !window.confirm('Submit your answers? You can submit this quiz once.'))return
  setBusy(true);setError('')
  try{const {data,error}=await supabase.rpc('quiz_staff_submit',{p_quiz_id:quiz.id,p_version:quiz.version,p_answers:quiz.questions.map((_,i)=>answers[i] ?? null)});if(error)throw error;setResult(data)}catch(e){setError(quizError(e))}finally{setBusy(false)}
 }
 return <section className="mod-page quiz-page"><p className="eyebrow">Pre-shift preparation</p><h1>Daily Quizzes</h1><p>Complete your quiz before service. Each quiz allows one submission.</p>
 {access.manager && <Link className="quiz-builder-link" to="/quizzes/build">Build Quiz / View Team Scores →</Link>}
 <label>Quiz date<input type="date" value={date} max={quizToday()} disabled={busy} onChange={e=>{if(e.target.value)setDate(e.target.value)}} /></label>
 {error && <p role="alert">{error}</p>}
 {busy && <p role="status">Loading…</p>}
 {!busy && !quiz && !error && <article className="mod-review"><h2>No quiz published for this date</h2><p>Your manager will publish the daily quiz here.</p></article>}
 {quiz && <><h2>{quiz.title}</h2>{quiz.instructions && <p className="quiz-instructions">{quiz.instructions}</p>}
 {result ? <QuizResults result={result} /> : <form onSubmit={e=>{e.preventDefault();void submit()}}>
 {quiz.questions.map((q,i)=><fieldset className="quiz-question" key={i} disabled={busy}><legend>{i+1}. {q.prompt}</legend><p className="muted">{q.category}</p>
 {q.options.map((option,n)=><label className="quiz-choice" key={n}><input type="radio" name={`question-${i}`} checked={answers[i]===n} required onChange={()=>setAnswers(v=>({...v,[i]:n}))} /><span>{option}</span></label>)}
 </fieldset>)}
 <button className="primary-button" disabled={busy || quiz.questions.some((_,i)=>answers[i]===undefined)}>{busy?'Submitting…':'Submit Quiz'}</button></form>}
 </>}
 </section>
}
