import { useEffect,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { quizToday } from '../pages/QuizzesPage'
import { QuizBuilderPage } from '../pages/QuizBuilderPage'
import { validGeneratedQuiz } from '../lib/generatedQuiz'
import type { GeneratedQuiz } from '../lib/generatedQuiz'
import './GeneratedQuizModal.css'
export function QuizDraftModal({draft,onClose}:{draft:GeneratedQuiz;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null)
 const state=useRef({dirty:false,busy:true})
 function close(){
  if(state.current.busy)return
  if(state.current.dirty&&!window.confirm('Discard unsaved quiz changes? Your saved bank questions will remain available.'))return
  onClose()
 }
 const closeRef=useRef(close);closeRef.current=close
 useEffect(()=>{
  const d=dialog.current;if(!d)return
  d.showModal()
  const cancel=(e:Event)=>{e.preventDefault();closeRef.current()}
  d.addEventListener('cancel',cancel)
  return()=>{d.removeEventListener('cancel',cancel);d.close()}
 },[])
 return createPortal(<dialog ref={dialog} className="generated-quiz-modal" aria-label="Quiz editor">
  <button type="button" className="generated-quiz-close" onClick={close}>Close quiz editor</button>
  {draft.warnings.map((w,i)=><p role="status" key={i}>{w}</p>)}
  <QuizBuilderPage publishedView={draft.date<=quizToday()} initialDate={draft.date} generatedDraft={draft}
   onStateChange={s=>{state.current=s}}/>
 </dialog>,document.body)
}
export function GeneratePreshiftQuiz({location,date,title,body,disabled,allowPaste=false,onSaved}:{
 location:string;date:string;title:string;body:string;disabled:boolean;allowPaste?:boolean;onSaved?:()=>void
}) {
 const [busy,setBusy]=useState(false),[count,setCount]=useState(10),[error,setError]=useState('')
 const [draft,setDraft]=useState<GeneratedQuiz|null>(null)
 const [content,setContent]=useState(''),[quizDate,setQuizDate]=useState(date),[topic,setTopic]=useState('')
 const request=useRef<string|null>(null)
 const actualBody=allowPaste?content:body
 const actualDate=allowPaste?quizDate:date
 const actualTitle=allowPaste?(topic.trim()||'Daily Pre-Shift Quiz'):title
 useEffect(()=>{request.current=null},[actualBody,actualDate,actualTitle,count])
 async function generate(){
  if(!actualBody.trim()||busy)return
  setBusy(true);setError('');request.current??=crypto.randomUUID()
  try{
   const r=await supabase.functions.invoke('preshift-quiz-generate',{body:{
    location_id:location,date:actualDate,title:actualTitle,body:actualBody,count,request_id:request.current
   }})
   if(r.error){
    let detail=''
    try{const context=(r.error as {context?:Response}).context;if(context)detail=(await context.json()).error??''}catch{}
    throw Error(detail||r.error.message)
   }
   const result={...r.data,location,date:actualDate}
   if(!validGeneratedQuiz(result))throw Error('No usable questions were generated. Add more specific source information.')
   setDraft(result);request.current=null
  }catch(e){setError(String((e as {message?:string}).message??e))}
  finally{setBusy(false)}
 }
 function changed(){request.current=null}
 return <article className="feed-card">
  <h3>{allowPaste?'Create a quiz from any content':'Generate a quiz from this pre-shift'}</h3>
  <p>Paste pre-shift notes, recipes, menu details, or training content. Choose a question count; the editor opens with the questions already added.</p>
  {allowPaste&&<fieldset disabled={busy||disabled}>
   <label>Quiz date<input type="date" value={quizDate} onChange={e=>{setQuizDate(e.target.value);changed()}}/></label>
   <label>Topic / title<input maxLength={160} value={topic} placeholder="Cocktail recipes, Tuesday specials, guest service…" onChange={e=>{setTopic(e.target.value);changed()}}/></label>
   <label>Content to turn into questions<textarea rows={9} maxLength={30000} value={content} onChange={e=>{setContent(e.target.value);changed()}} placeholder="Paste any content here. Only the facts in this box will be used."/></label>
  </fieldset>}
  <label>How many questions?<input type="number" min={1} max={30} step={1} value={count}
   disabled={disabled||busy} onChange={e=>{setCount(Number(e.target.value));changed()}}/></label>
  <button type="button" className="primary-button"
   disabled={disabled||busy||!location||!actualDate||actualBody.trim().length<30||!Number.isInteger(count)||count<1||count>30}
   onClick={()=>void generate()}>{busy?'Generating quiz…':'Generate quiz'}</button>
  <p>Generated questions are saved automatically to the question bank by subject and source date. The quiz itself remains a draft until you save or publish. Limited source material may produce fewer questions.</p>
  {error&&<p role="alert">{error}</p>}
  {draft&&<QuizDraftModal draft={draft} onClose={()=>{setDraft(null);onSaved?.()}}/>}
 </article>
}
