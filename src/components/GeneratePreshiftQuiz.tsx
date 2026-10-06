import { useEffect,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { quizToday } from '../pages/QuizzesPage'
import { QuizBuilderPage } from '../pages/QuizBuilderPage'
import { validGeneratedQuiz } from '../lib/generatedQuiz'
import type { GeneratedQuiz } from '../lib/generatedQuiz'
import './GeneratedQuizModal.css'
function QuizDraftModal({draft,onClose}:{draft:GeneratedQuiz;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null)
 function close(){if(window.confirm('Close the quiz editor? Save your quiz first to keep any edits.'))onClose()}
 const closeRef=useRef(close);closeRef.current=close
 useEffect(()=>{const d=dialog.current;if(!d)return;d.showModal();const cancel=(e:Event)=>{e.preventDefault();closeRef.current()};d.addEventListener('cancel',cancel);return()=>{d.removeEventListener('cancel',cancel);d.close()}},[])
 return createPortal(<dialog ref={dialog} className="generated-quiz-modal" aria-label="Review generated quiz"><button type="button" className="generated-quiz-close" onClick={close}>Close quiz editor</button><QuizBuilderPage publishedView={draft.date<=quizToday()} initialDate={draft.date} generatedDraft={draft}/></dialog>,document.body)
}
export function GeneratePreshiftQuiz({location,date,title,body,disabled}:{location:string;date:string;title:string;body:string;disabled:boolean}){
 const [busy,setBusy]=useState(false),[count,setCount]=useState(10),[error,setError]=useState(''),[draft,setDraft]=useState<GeneratedQuiz|null>(null)
 async function generate(){
  if(!body.trim()||busy)return
  setBusy(true);setError('')
  try{
   const r=await supabase.functions.invoke('preshift-quiz-generate',{body:{location_id:location,date,title,body,count}})
   if(r.error){let detail='';try{const context=(r.error as {context?:Response}).context;if(context)detail=(await context.json()).error??''}catch{}throw Error(detail||r.error.message)}
   const result={...r.data,location,date}
   if(!validGeneratedQuiz(result))throw Error('No usable questions were generated. Add more specific information to the post and try again.')
   setDraft(result)
  }catch(e){setError(String((e as {message?:string}).message??e))}finally{setBusy(false)}
 }
 return <div className="feed-card"><h3>Generate a quiz from this pre-shift</h3><p>Use the post text above. Add any chosen preset sections to the post first. You can edit the generated questions, write your own, or add questions from the bank before publishing.</p><label>Number of questions<select value={count} disabled={disabled||busy} onChange={e=>setCount(Number(e.target.value))}>{[5,10,15,20].map(n=><option key={n} value={n}>{n}</option>)}</select></label><button type="button" className="primary-button" disabled={disabled||busy||!location||!date||!body.trim()} onClick={()=>void generate()}>{busy?'Generating quiz…':'Generate quiz'}</button><p>A quiz editor opens here for review. Your pre-shift stays in place. Fewer questions may be returned if the post has limited information.</p>{error&&<p role="alert">{error}</p>}{draft&&<QuizDraftModal draft={draft} onClose={()=>setDraft(null)}/>}</div>
}
