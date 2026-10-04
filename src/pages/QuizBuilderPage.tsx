import { QuizUpload } from '../components/QuizUpload'
import { QuizRequiredStaff } from '../components/QuizRequiredStaff'
import { submissionLabel } from '../lib/submissionTime'
import { PublishedQuizzes } from '../components/PublishedQuizzes'
import type { PublishedQuiz } from '../components/PublishedQuizzes'
import { QuizQuestionBank } from '../components/QuizQuestionBank'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { quizToday, quizTomorrow, quizError } from './QuizzesPage'
import type { Quiz, Question, QuizResult } from './QuizzesPage'
import './QuizzesPage.css'
import './QuizWorkspace.css'
type Submission={user_id:string;name:string;submitted_at:string;result:QuizResult}
type DraftQuestion=Question&{editorKey:string}
const draftQuestion=(q:Question):DraftQuestion=>({...q,options:[...q.options],editorKey:crypto.randomUUID()})
const emptyQuestion=():DraftQuestion=>draftQuestion({prompt:'',category:'Guest service',options:['','','',''],correct:0,explanation:''})
export function QuizBuilderPage({publishedView=false}:{publishedView?:boolean}) {
 const [params]=useSearchParams()
 const [location,setLocation]=useState('')
 const [date,setDate]=useState(()=>{const d=params.get('date') ?? '';return publishedView?(/^\d{4}-\d{2}-\d{2}$/.test(d) && d<=quizToday()?d:quizToday()):quizTomorrow()})
 const [title,setTitle]=useState('Daily Pre-Shift Quiz')
 const [instructions,setInstructions]=useState('Read the pre-shift before answering. Choose one answer for each question.')
 const [questions,setQuestions]=useState<DraftQuestion[]>([])
 const [version,setVersion]=useState(0)
 const [quizId,setQuizId]=useState('')
 const [published,setPublished]=useState(false)
 const [results,setResults]=useState<Submission[]>([])
 const [busy,setBusy]=useState(true)
 const [dirty,setDirty]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [listRefresh,setListRefresh]=useState(0)
 const [editorReload,setEditorReload]=useState(0)
 const [addMenu,setAddMenu]=useState(false),[bankOpen,setBankOpen]=useState(false)
 const [removed,setRemoved]=useState<{question:DraftQuestion;index:number}|null>(null)
 const chooser=useRef<HTMLDivElement>(null),bankPanel=useRef<HTMLDivElement>(null)
 function chooseAdd(){setAddMenu(true);requestAnimationFrame(()=>chooser.current?.scrollIntoView({behavior:'smooth',block:'center'}))}
 function writeQuestion(){const q=emptyQuestion();setQuestions(v=>v.length<50?[...v,q]:v);setDirty(true);setAddMenu(false);requestAnimationFrame(()=>{const field=document.getElementById('quiz-question-'+q.editorKey);field?.scrollIntoView({behavior:'smooth',block:'center'});field?.focus()})}
 function browseBank(){setBankOpen(true);setAddMenu(false);requestAnimationFrame(()=>bankPanel.current?.scrollIntoView({behavior:'smooth',block:'start'}))}
 function removeQuestion(q:DraftQuestion,index:number){setQuestions(v=>v.filter(x=>x.editorKey!==q.editorKey));setRemoved({question:q,index});setDirty(true);setMessage('Question removed. Save the quiz to keep this change.')}
 function undoRemove(){if(!removed||questions.length>=50)return;const item=removed;setQuestions(v=>{const next=[...v];next.splice(Math.min(item.index,next.length),0,item.question);return next});setRemoved(null);setDirty(true);setMessage('Question restored.')}

 function apply(q:Quiz|null){setQuizId(q?.id ?? '');setTitle(q?.title ?? 'Daily Pre-Shift Quiz');setInstructions(q?.instructions ?? 'Read the pre-shift before answering. Choose one answer for each question.');setQuestions((q?.questions ?? []).map(draftQuestion));setRemoved(null);setAddMenu(false);setBankOpen(false);setVersion(q?.version ?? 0);setPublished(q?.published ?? false);setDirty(false)}
 useEffect(()=>{let live=true;void loadTenantData().then(t=>{if(!t.locations[0])throw new Error('No active location.');if(live)setLocation(t.locations[0].id)}).catch(e=>{if(live){setError(quizError(e));setBusy(false)}});return()=>{live=false}},[])
 useEffect(()=>{if(!location)return;let live=true;setBusy(true);setError('');setMessage('');apply(null);setResults([]);void supabase.rpc('quiz_manager_load',{p_location_id:location,p_date:date}).then(({data,error})=>{if(!live)return;if(error)setError(error.message);else{apply(data.quiz);setResults(data.results)}setBusy(false)});return()=>{live=false}},[location,date,editorReload])
 function update(i:number,patch:Partial<Question>){setQuestions(q=>q.map((x,n)=>n===i?{...x,...patch}:x));setDirty(true)}
 function move(i:number,delta:number){setQuestions(q=>{const next=[...q];[next[i],next[i+delta]]=[next[i+delta],next[i]];return next});setDirty(true)}
 async function save(publish:boolean){if(!publishedView && date<quizTomorrow()){setError('Choose a future date. Manage today’s quiz from the main Quizzes page.');return}setBusy(true);setError('');setMessage('');try{
  const {data,error}=await supabase.rpc('quiz_manager_save',{p_location_id:location,p_date:date,p_title:title,p_instructions:instructions,p_questions:questions.map(({editorKey,...question})=>question),p_publish:publish,p_version:version});if(error)throw error;apply(data);setListRefresh(v=>v+1);setMessage(publish?(publishedView?'Published changes saved.':'Quiz scheduled. Staff can open it on its quiz date.'):'Draft saved. Staff cannot see it.')
 }catch(e){setError(quizError(e))}finally{setBusy(false)}}
 function openPublished(nextDate:string){if(dirty && !window.confirm('Discard unsaved edits and open this published quiz?'))return;setDate(nextDate);setEditorReload(v=>v+1)}
 async function removePublished(q:PublishedQuiz){
  if(!window.confirm('Remove "'+q.title+'" ('+q.quiz_date+') from staff access? Submissions will be preserved and the quiz saved as a draft.'+(q.quiz_date===date && dirty?' Unsaved edits to this quiz will be discarded.':'')))return
  setBusy(true);setError('');setMessage('')
  try{const {error}=await supabase.rpc('quiz_manager_remove',{p_location_id:location,p_quiz_id:q.id,p_version:q.version});if(error)throw error;setListRefresh(v=>v+1);if(q.quiz_date===date)setEditorReload(v=>v+1);else setMessage('Quiz removed from staff access. Its draft and submissions are preserved.')}
  catch(e){setError(quizError(e))}finally{setBusy(false)}
 }
 return <section className="mod-page quiz-page quiz-workspace"><Link to="/quizzes">← Daily Quizzes</Link><p className="eyebrow">Manager only</p><h1>{publishedView?'Manage Published Quiz':'Build Future Quizzes'}</h1>
 {!publishedView && <PublishedQuizzes future location={location} refresh={listRefresh} disabled={busy || !location} onEdit={openPublished} onRemove={removePublished} />}
 <label>Quiz date<input type="date" min={publishedView?undefined:quizTomorrow()} max={publishedView?quizToday():undefined} value={date} disabled={busy} onChange={e=>{if(!e.target.value || (!publishedView && e.target.value<quizTomorrow()) || (publishedView && e.target.value>quizToday()) || (dirty && !window.confirm('Discard unsaved edits and open another date?')))return;setDate(e.target.value)}} /></label>
 <p>{published?(publishedView?'Published':'Scheduled'):'Draft'}{dirty?' · Unsaved changes':''}</p>
 {results.length>0 && <p>Existing scores and submitted answers are preserved. Edits apply to staff who have not submitted. Staff who already submitted cannot retake this quiz.</p>}
 {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{busy && <p>Loading…</p>}
 <QuizUpload disabled={busy || !location} date={date} onApply={(upload,append)=>{if(append && questions.length+upload.questions.length>50){setMessage('Choose fewer questions. A quiz can contain up to 50.');return false}if(!append && questions.length && !window.confirm('Replace the current questions? Saved submissions stay unchanged.'))return false;setQuestions(v=>append?[...v,...upload.questions.map(draftQuestion)]:upload.questions.map(draftQuestion));setRemoved(null);if(!append){if(upload.title)setTitle(upload.title);if(upload.instructions)setInstructions(upload.instructions)}setDirty(true);setMessage('Questions loaded. Review and edit them below, then save or publish.');return true}} />
 <div ref={bankPanel}><QuizQuestionBank location={location} open={bankOpen} onOpenChange={setBankOpen} disabled={busy || !location} questions={questions} onAdd={items=>{setQuestions(v=>[...v,...items.map(draftQuestion)].slice(0,50));setDirty(true);setMessage(`${items.length} questions added from the bank. Save the quiz to keep them.`)}} /></div>
 <fieldset disabled={busy || !location} className="quiz-editor">
 <details className="quiz-settings"><summary>Quiz title and instructions</summary>
 <label>Title<input maxLength={200} value={title} onChange={e=>{setTitle(e.target.value);setDirty(true)}} /></label>
 <label>Instructions<textarea maxLength={4000} value={instructions} onChange={e=>{setInstructions(e.target.value);setDirty(true)}} /></label>
 </details>
 <div className="quiz-list-heading"><h2>Questions ({questions.length}/50)</h2><p>Add an existing question from the bank or write a new one. Open “Edit answers” to change the choices.</p><button type="button" disabled={questions.length>=50} onClick={chooseAdd}>＋ Add question</button></div>
 <div ref={chooser}>{addMenu&&<div className="mod-review" role="group" aria-label="Add a question"><h3>How would you like to add a question?</h3><div className="quiz-actions"><button type="button" disabled={questions.length>=50} onClick={writeQuestion}>Write a question</button><button type="button" disabled={questions.length>=50} onClick={browseBank}>Choose from the bank</button><button type="button" onClick={()=>setAddMenu(false)}>Cancel</button></div></div>}</div>
 {removed&&<div role="status" className="mod-review"><p>Removed: {removed.question.prompt||'Blank question'}</p><button type="button" disabled={questions.length>=50} onClick={undoRemove}>Undo remove</button></div>}
 {questions.length===0 && <p className="quiz-empty">Start with a new question or add questions from the bank.</p>}
 {questions.map((q,i)=><article className="mod-review quiz-edit-card" key={q.editorKey}><h3>Question {i+1}</h3>
 <label>Category<input list="quiz-categories" maxLength={100} value={q.category} onChange={e=>update(i,{category:e.target.value})} /></label>
 <label>Question<textarea id={'quiz-question-'+q.editorKey} maxLength={2000} value={q.prompt} onChange={e=>update(i,{prompt:e.target.value})} /></label>
 <details className="quiz-answer-panel"><summary>Edit answers · {q.options.filter(o=>o.trim()).length} choices{q.options[q.correct]?.trim()?" · Answer selected":" · Add answers"}</summary>
 {q.options.map((option,n)=><div className="quiz-option-editor" key={n}><label>Choice {n+1}<input maxLength={1000} value={option} onChange={e=>update(i,{options:q.options.map((o,j)=>j===n?e.target.value:o)})} /></label>
 <label className="quiz-choice"><input type="radio" name={`correct-${q.editorKey}`} checked={q.correct===n} onChange={()=>update(i,{correct:n})} />Correct answer</label>
 {q.options.length>2 && <button type="button" onClick={()=>update(i,{options:q.options.filter((_,j)=>j!==n),correct:q.correct===n?0:q.correct>n?q.correct-1:q.correct})}>Remove choice</button>}
 </div>)}
 <div className="quiz-actions">{q.options.length<6 && <button type="button" onClick={()=>update(i,{options:[...q.options,'']})}>Add choice</button>}
 <button type="button" onClick={()=>{if(window.confirm('Replace the choices with True and False?'))update(i,{options:['True','False'],correct:0})}}>Use True / False</button></div>
 <label>Explanation shown after submission (optional)<textarea maxLength={2000} value={q.explanation} onChange={e=>update(i,{explanation:e.target.value})} /></label>
 </details>
 <div className="quiz-actions quiz-question-tools"><button type="button" disabled={i===0} onClick={()=>move(i,-1)}>Move up</button><button type="button" disabled={i===questions.length-1} onClick={()=>move(i,1)}>Move down</button><button type="button" onClick={()=>removeQuestion(q,i)}>Remove question</button></div>
 </article>)}
 <datalist id="quiz-categories">{['Guest service','Menu knowledge','Cocktails','Specials','Cash handling','Reservations','Teamwork','Policies'].map(c=><option value={c} key={c} />)}</datalist>
 <div className="quiz-actions"><button type="button" disabled={questions.length>=50} onClick={chooseAdd}>Add question</button><button type="button" onClick={()=>void save(false)}>Save Draft{published?' / Unpublish':''}</button><button type="button" className="primary-button" onClick={()=>{if(window.confirm(results.length>0?'Publish these changes? Existing scores stay unchanged; staff who have not submitted will receive the updated quiz.':'Publish this quiz for staff?'))void save(true)}}>{publishedView?'Publish Changes':'Schedule Quiz'}</button></div>
 </fieldset>
 {published && quizId && <QuizRequiredStaff location={location} quizId={quizId} />}
 {publishedView && <article className="mod-review"><h2>Team scores ({results.length} submitted)</h2>{results.length===0?<p>No submissions yet.</p>:results.map(r=><details key={r.user_id}><summary>{r.name}: {r.result.score}/{r.result.total} ({r.result.percent}%)</summary><p>Submitted: {submissionLabel(r.submitted_at)}</p>{r.result.questions.map((q,i)=><p key={i}>{i+1}. {q.prompt} — {q.selected} ({q.correct?'correct':'incorrect'})</p>)}</details>)}</article>}
 </section>
}



