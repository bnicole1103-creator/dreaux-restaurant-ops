import { QuizQuestionBank } from '../components/QuizQuestionBank'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { quizToday, quizError } from './QuizzesPage'
import type { Quiz, Question, QuizResult } from './QuizzesPage'
import './QuizzesPage.css'
type Submission={user_id:string;name:string;submitted_at:string;result:QuizResult}
const emptyQuestion=():Question=>({prompt:'',category:'Guest service',options:['','','',''],correct:0,explanation:''})
export function QuizBuilderPage() {
 const [location,setLocation]=useState('')
 const [date,setDate]=useState(quizToday)
 const [title,setTitle]=useState('Daily Pre-Shift Quiz')
 const [instructions,setInstructions]=useState('Read the pre-shift before answering. Choose one answer for each question.')
 const [questions,setQuestions]=useState<Question[]>([])
 const [version,setVersion]=useState(0)
 const [published,setPublished]=useState(false)
 const [results,setResults]=useState<Submission[]>([])
 const [busy,setBusy]=useState(true)
 const [dirty,setDirty]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const locked=results.length>0
 function apply(q:Quiz|null){setTitle(q?.title ?? 'Daily Pre-Shift Quiz');setInstructions(q?.instructions ?? 'Read the pre-shift before answering. Choose one answer for each question.');setQuestions(q?.questions ?? []);setVersion(q?.version ?? 0);setPublished(q?.published ?? false);setDirty(false)}
 useEffect(()=>{let live=true;void loadTenantData().then(t=>{if(!t.locations[0])throw new Error('No active location.');if(live)setLocation(t.locations[0].id)}).catch(e=>{if(live){setError(quizError(e));setBusy(false)}});return()=>{live=false}},[])
 useEffect(()=>{if(!location)return;let live=true;setBusy(true);setError('');setMessage('');apply(null);setResults([]);void supabase.rpc('quiz_manager_load',{p_location_id:location,p_date:date}).then(({data,error})=>{if(!live)return;if(error)setError(error.message);else{apply(data.quiz);setResults(data.results)}setBusy(false)});return()=>{live=false}},[location,date])
 function update(i:number,patch:Partial<Question>){setQuestions(q=>q.map((x,n)=>n===i?{...x,...patch}:x));setDirty(true)}
 function move(i:number,delta:number){setQuestions(q=>{const next=[...q];[next[i],next[i+delta]]=[next[i+delta],next[i]];return next});setDirty(true)}
 async function save(publish:boolean){setBusy(true);setError('');setMessage('');try{
  const {data,error}=await supabase.rpc('quiz_manager_save',{p_location_id:location,p_date:date,p_title:title,p_instructions:instructions,p_questions:questions,p_publish:publish,p_version:version});if(error)throw error;apply(data);setMessage(publish?'Quiz published. Staff can open it on its quiz date.':'Draft saved. Staff cannot see it.')
 }catch(e){setError(quizError(e))}finally{setBusy(false)}}
 return <section className="mod-page quiz-page"><Link to="/quizzes">← Daily Quizzes</Link><p className="eyebrow">Manager only</p><h1>Daily Quiz Builder</h1>
 <label>Quiz date<input type="date" value={date} disabled={busy} onChange={e=>{if(!e.target.value || (dirty && !window.confirm('Discard unsaved edits and open another date?')))return;setDate(e.target.value)}} /></label>
 <p>{published?'Published':'Draft'}{dirty?' · Unsaved changes':''}</p>
 {locked && <p>This quiz has submissions and is locked to preserve staff scores. Choose another date to build the next quiz.</p>}
 {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{busy && <p>Loading…</p>}
 <QuizQuestionBank location={location} disabled={busy || locked || !location} questions={questions} onAdd={items=>{setQuestions(v=>[...v,...items].slice(0,50));setDirty(true)}} />
 <fieldset disabled={busy || locked || !location} className="quiz-editor">
 <label>Title<input maxLength={200} value={title} onChange={e=>{setTitle(e.target.value);setDirty(true)}} /></label>
 <label>Instructions<textarea maxLength={4000} value={instructions} onChange={e=>{setInstructions(e.target.value);setDirty(true)}} /></label>
 {questions.map((q,i)=><article className="mod-review" key={i}><h2>Question {i+1}</h2>
 <label>Category<input list="quiz-categories" maxLength={100} value={q.category} onChange={e=>update(i,{category:e.target.value})} /></label>
 <label>Question<textarea maxLength={2000} value={q.prompt} onChange={e=>update(i,{prompt:e.target.value})} /></label>
 {q.options.map((option,n)=><div className="quiz-option-editor" key={n}><label>Choice {n+1}<input maxLength={1000} value={option} onChange={e=>update(i,{options:q.options.map((o,j)=>j===n?e.target.value:o)})} /></label>
 <label className="quiz-choice"><input type="radio" name={`correct-${i}`} checked={q.correct===n} onChange={()=>update(i,{correct:n})} />Correct answer</label>
 {q.options.length>2 && <button type="button" onClick={()=>update(i,{options:q.options.filter((_,j)=>j!==n),correct:q.correct===n?0:q.correct>n?q.correct-1:q.correct})}>Remove choice</button>}
 </div>)}
 <div className="quiz-actions">{q.options.length<6 && <button type="button" onClick={()=>update(i,{options:[...q.options,'']})}>Add choice</button>}
 <button type="button" onClick={()=>{if(window.confirm('Replace the choices with True and False?'))update(i,{options:['True','False'],correct:0})}}>Use True / False</button></div>
 <label>Explanation shown after submission (optional)<textarea maxLength={2000} value={q.explanation} onChange={e=>update(i,{explanation:e.target.value})} /></label>
 <div className="quiz-actions"><button type="button" disabled={i===0} onClick={()=>move(i,-1)}>Move up</button><button type="button" disabled={i===questions.length-1} onClick={()=>move(i,1)}>Move down</button><button type="button" onClick={()=>{if(window.confirm('Remove this question?')){setQuestions(v=>v.filter((_,n)=>n!==i));setDirty(true)}}}>Remove question</button></div>
 </article>)}
 <datalist id="quiz-categories">{['Guest service','Menu knowledge','Cocktails','Specials','Cash handling','Reservations','Teamwork','Policies'].map(c=><option value={c} key={c} />)}</datalist>
 <div className="quiz-actions"><button type="button" disabled={questions.length>=50} onClick={()=>{setQuestions(v=>[...v,emptyQuestion()]);setDirty(true)}}>Add question</button><button type="button" onClick={()=>void save(false)}>Save Draft{published?' / Unpublish':''}</button><button type="button" className="primary-button" onClick={()=>{if(window.confirm('Publish this quiz for staff?'))void save(true)}}>Publish Quiz</button></div>
 </fieldset>
 <article className="mod-review"><h2>Team scores ({results.length} submitted)</h2>{results.length===0?<p>No submissions yet.</p>:results.map(r=><details key={r.user_id}><summary>{r.name}: {r.result.score}/{r.result.total} ({r.result.percent}%)</summary><p>Submitted: {new Date(r.submitted_at).toLocaleString()}</p>{r.result.questions.map((q,i)=><p key={i}>{i+1}. {q.prompt} — {q.selected} ({q.correct?'correct':'incorrect'})</p>)}</details>)}</article>
 </section>
}
