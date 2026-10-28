import {DesignSection} from './DesignSection'
import {PageWord} from './PageDesign'
import { useEffect,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { quizToday } from '../pages/QuizzesPage'
import { QuizBuilderPage } from '../pages/QuizBuilderPage'
import { validGeneratedQuiz } from '../lib/generatedQuiz'
import type { GeneratedQuiz } from '../lib/generatedQuiz'
import './GeneratedQuizModal.css'
import { WorkflowTabs } from './WorkflowTabs'
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
  <button type="button" className="generated-quiz-close" onClick={close}><PageWord id="sectioncopy.d6258ce5a3f0b5d7ca6d">{"Close quiz editor"}</PageWord></button>
  {draft.warnings.map((w,i)=><p role="status" key={i}>{w}</p>)}
  <QuizBuilderPage publishedView={draft.date<=quizToday()} initialDate={draft.date} generatedDraft={draft}
   onStateChange={s=>{state.current=s}}/>
 </dialog>,document.body)
}
export function GeneratePreshiftQuiz({location,date,title,body,disabled,allowPaste=false,onSaved,heading,countOptions,onBusy}:{
 location:string;date:string;title:string;body:string;disabled:boolean;allowPaste?:boolean;onSaved?:()=>void;heading?:string;countOptions?:number[];onBusy?:(v:boolean)=>void
}) {
 const [busy,setBusy]=useState(false),[count,setCount]=useState(10),[error,setError]=useState('')
 const [draft,setDraft]=useState<GeneratedQuiz|null>(null)
 const [generatorTab,setGeneratorTab]=useState('content')
 const [content,setContent]=useState(''),[quizDate,setQuizDate]=useState(date),[topic,setTopic]=useState('')
 const activity=useRef(onBusy);activity.current=onBusy
 useEffect(()=>{activity.current?.(busy);return()=>activity.current?.(false)},[busy])
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
   if(r.data?.generator_version!=='2026-10-28-practical-v2')throw Error('Deploy the updated preshift-quiz-generate function to use the practical question generator. Your source is still here.')
   const result={...r.data,location,date:actualDate}
   if(!validGeneratedQuiz(result))throw Error('No usable questions were generated. Add more specific source information.')
   setDraft(result);request.current=null
  }catch(e){setError(String((e as {message?:string}).message??e))}
  finally{setBusy(false)}
 }
 function changed(){request.current=null}
 return <DesignSection as="article" data-design-block="section.18490ee77f1ddb9b4a85" className="feed-card quiz-source-workflow">
  <h3>{heading??(allowPaste?'Create a quiz from any content':'Generate a quiz from this pre-shift')}</h3>
  <p><PageWord id="sectioncopy.f7f5c11ec4fbb95094f3">{"Use daily notes, recipes and menu details to test realistic guest situations, recipe mistakes and service decisions. Questions must be supported by your source. Review the generated editor, then save or publish for the chosen day."}</PageWord></p>
  {allowPaste&&<WorkflowTabs id="quiz-source" label="Generate quiz steps" tabs={[{key:'content',label:'1 · Content'},{key:'generate',label:'2 · Generate'}]} active={generatorTab} disabled={busy} onChange={setGeneratorTab}/>}
  <div role="tabpanel" id="quiz-source-content-panel" aria-labelledby="quiz-source-content-tab" hidden={allowPaste&&generatorTab!=='content'}>
  {allowPaste&&<fieldset data-design-block="section.1b2ff3be7fbcc375755e" disabled={busy||disabled}>
   {/* quiz-source-settings-moved */}
   <label><PageWord id="sectioncopy.b5a99f3c7de6b5225e24">{"Content to turn into questions"}</PageWord><textarea rows={9} maxLength={30000} value={content} onChange={e=>{setContent(e.target.value);changed()}} placeholder="Paste any content here. Only the facts in this box will be used."/></label>
  </fieldset>}
  {allowPaste&&<button type="button" disabled={busy||disabled||actualBody.trim().length<30} onClick={()=>setGeneratorTab('generate')}><PageWord id="sectioncopy.78a70e027489f575131c">{"Continue to quiz setup →"}</PageWord></button>}
  </div>
  <div role="tabpanel" id="quiz-source-generate-panel" aria-labelledby="quiz-source-generate-tab" hidden={allowPaste&&generatorTab!=='generate'}>
  {allowPaste&&<fieldset data-design-block="section.92df1374013015ca4674" disabled={busy||disabled}>
   <label><PageWord id="sectioncopy.3ab309ca6f7f1bd66653">{"Quiz date"}</PageWord><input type="date" value={quizDate} onChange={e=>{setQuizDate(e.target.value);changed()}}/></label>
   <label><PageWord id="sectioncopy.0f2d273e67ee421e5156">{"Topic / title"}</PageWord><input maxLength={160} value={topic} placeholder="Cocktail recipes, Tuesday specials, guest service…" onChange={e=>{setTopic(e.target.value);changed()}}/></label>
  </fieldset>}
  <label><PageWord id="sectioncopy.4cdd68c082fac18c0b59">{"How many questions?"}</PageWord>{countOptions?<select aria-label="How many questions?" value={count} disabled={disabled||busy} onChange={e=>{setCount(Number(e.target.value));changed()}}>{countOptions.map(n=><option key={n} value={n}>{n}</option>)}</select>:<input type="number" min={1} max={30} step={1} value={count}
   disabled={disabled||busy} onChange={e=>{setCount(Number(e.target.value));changed()}}/>}</label>
  <button type="button" className="primary-button"
   disabled={disabled||busy||!location||!actualDate||actualBody.trim().length<30||!Number.isInteger(count)||count<1||count>30}
   onClick={()=>void generate()}>{busy?'Generating quiz…':'Generate quiz'}</button>
  <p><PageWord id="sectioncopy.ecb0e61eb781235f59d9">{"Generated answers are checked against the source before questions are saved to the question bank by subject and source date. The quiz itself remains a draft until you save or publish. Limited source material may produce fewer questions."}</PageWord></p>
  </div>
  {error&&<p role="alert">{error}</p>}
  {draft&&<QuizDraftModal draft={draft} onClose={()=>{setDraft(null);onSaved?.()}}/>}
 </DesignSection>
}
