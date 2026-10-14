import { useEffect,useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Question } from '../pages/QuizzesPage'
import { quizError } from '../pages/QuizzesPage'
import './QuizQuestionBank.css'
type Entry={id:string;source:string;quiz_date:string|null;review:boolean;version:number;question:Question}
export function QuizQuestionBank({location,disabled,questions,onAdd,open,onOpenChange}:{
 location:string;disabled:boolean;questions:Question[];onAdd:(questions:Question[])=>void;open?:boolean;onOpenChange?:(open:boolean)=>void
}){
 const [expanded,setExpanded]=useState(false),[bank,setBank]=useState<Entry[]>([])
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [search,setSearch]=useState(''),[category,setCategory]=useState('All'),[day,setDay]=useState('All')
 const [selected,setSelected]=useState<string[]>([]),[refresh,setRefresh]=useState(0)
 const [editing,setEditing]=useState<Entry|null>(null),[edit,setEdit]=useState<Question|null>(null)
 const [importDate,setImportDate]=useState(''),[importTitle,setImportTitle]=useState('Imported quiz'),[importQuestions,setImportQuestions]=useState<Question[]>([])
 useEffect(()=>{
  if(!location)return
  let live=true;setBusy(true);setError('')
  void supabase.rpc('quiz_question_bank_by_day',{p_location_id:location}).then(r=>{
   if(!live)return
   if(r.error)setError(quizError(r.error));else setBank(r.data??[])
   setBusy(false)
  })
  return()=>{live=false}
 },[location,refresh])
 const filtered=bank.filter(e=>(category==='All'||e.question.category===category)&&(day==='All'||(e.quiz_date??'Undated')===day)&&
  (e.question.prompt+' '+e.question.category+' '+e.source).toLowerCase().includes(search.trim().toLowerCase()))
 const chosen=bank.filter(e=>selected.includes(e.id))
 function add(items:Entry[]){
  if(items.length+questions.length>50){setError('A quiz can contain up to 50 questions. Add fewer bank questions.');return}
  onAdd(items.map(e=>({...e.question,options:[...e.question.options]})))
  setSelected([]);setMessage(items.length+' question(s) added. Edit the copies in your quiz.')
 }
 async function save(){
  if(!editing||!edit)return
  setBusy(true);setError('')
  try{
   const r=await supabase.rpc('quiz_bank_edit_entry',{p_location_id:location,p_id:editing.id,p_version:editing.version,p_question:edit})
   if(r.error)throw r.error
   setEditing(null);setEdit(null);setRefresh(v=>v+1);setMessage('Bank question saved. Existing quiz copies stay unchanged.')
  }catch(e){setError(quizError(e))}finally{setBusy(false)}
 }
 async function importFile(file:File){
  try{
   if(file.size>1000000)throw Error('Choose a JSON file smaller than 1 MB.')
   const parsed=JSON.parse(await file.text()),list=Array.isArray(parsed)?parsed:parsed.questions
   if(!Array.isArray(list)||!list.length||list.length>50)throw Error('Use a file with 1–50 questions.')
   setImportQuestions(list.map((q:Question)=>({...q,category:q.category||'Training',explanation:q.explanation||''})))
   if(parsed.quiz_date)setImportDate(parsed.quiz_date)
   if(parsed.title)setImportTitle(String(parsed.title).slice(0,200))
  }catch(e){setImportQuestions([]);setError(quizError(e))}
 }
 async function importSet(){
  setBusy(true);setError('')
  try{
   const r=await supabase.rpc('quiz_bank_import',{p_location_id:location,p_date:importDate,p_title:importTitle,p_questions:importQuestions})
   if(r.error)throw r.error
   setImportQuestions([]);setRefresh(v=>v+1);setMessage('Dated questions imported.')
  }catch(e){setError(quizError(e))}finally{setBusy(false)}
 }
 return <details className="quiz-bank" open={open??expanded} onToggle={e=>{
  const next=e.currentTarget.open;setExpanded(next);if(next!==open)onOpenChange?.(next)
 }}>
  <summary><strong>Question Bank ({bank.length}) — subject and day</strong></summary>
  <p>Every entry can be added and edited. Edit a bank question to update the reusable original; edit its copy in a quiz to change only that quiz.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <fieldset disabled={busy||disabled||!location}>
   <label>Search<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <div className="quiz-bank-filters">
    <label>Subject<select value={category} onChange={e=>setCategory(e.target.value)}>
     <option>All</option>{[...new Set(bank.map(e=>e.question.category))].sort().map(c=><option key={c}>{c}</option>)}
    </select></label>
    <label>Source day<select value={day} onChange={e=>setDay(e.target.value)}>
     <option>All</option>{[...new Set(bank.map(e=>e.quiz_date??'Undated'))].sort().reverse().map(d=><option key={d}>{d}</option>)}
    </select></label>
   </div>
   <div className="quiz-actions">
    <button type="button" onClick={()=>setSelected(filtered.map(e=>e.id))}>Select filtered questions</button>
    <button type="button" disabled={!chosen.length} onClick={()=>add(chosen)}>Add selected ({chosen.length})</button>
    <button type="button" onClick={()=>setRefresh(v=>v+1)}>Refresh bank</button>
   </div>
   {!bank.length&&<p>{busy?'Loading bank…':'No questions in the bank yet.'}</p>}
   {filtered.map(e=><article className="quiz-bank-item" key={e.id}>
    <label className="quiz-choice"><input type="checkbox" checked={selected.includes(e.id)}
     onChange={()=>setSelected(v=>v.includes(e.id)?v.filter(id=>id!==e.id):[...v,e.id])}/><span>{e.question.prompt}</span></label>
    <p className="muted">{e.question.category} · {e.quiz_date??'Undated'} · {e.source}</p>
    {e.review&&<p className="muted">Review source facts, recipes, prices and policies before publishing.</p>}
    <details><summary>Choices and correct answer</summary><ol type="A">{e.question.options.map((o,i)=><li key={i}>{o}{i===e.question.correct?' — Correct':''}</li>)}</ol><p>{e.question.explanation}</p></details>
    <button type="button" onClick={()=>add([e])}>Add this question</button>
    <button type="button" onClick={()=>{
     if(editing&&!window.confirm('Discard the unsaved bank edit?'))return
     setEditing(e);setEdit({...e.question,options:[...e.question.options]})
    }}>Edit bank question</button>
    {editing?.id===e.id&&edit&&<div className="mod-review">
     <label>Question<textarea rows={3} maxLength={2000} value={edit.prompt} onChange={x=>setEdit({...edit,prompt:x.target.value})}/></label>
     <label>Subject<input maxLength={100} value={edit.category} onChange={x=>setEdit({...edit,category:x.target.value})}/></label>
     {edit.options.map((option,i)=><label key={i}>{String.fromCharCode(65+i)}<input maxLength={1000} value={option} onChange={x=>setEdit({...edit,options:edit.options.map((v,n)=>n===i?x.target.value:v)})}/></label>)}
     <label>Correct answer<select value={edit.correct} onChange={x=>setEdit({...edit,correct:Number(x.target.value)})}>{edit.options.map((o,i)=><option key={i} value={i}>{String.fromCharCode(65+i)} · {o}</option>)}</select></label>
     <label>Explanation<textarea rows={3} maxLength={2000} value={edit.explanation} onChange={x=>setEdit({...edit,explanation:x.target.value})}/></label>
     <button type="button" onClick={()=>void save()}>Save bank question</button>
     <button type="button" onClick={()=>{setEditing(null);setEdit(null)}}>Cancel bank edit</button>
    </div>}
   </article>)}
   <details><summary>Import an older quiz from JSON</summary>
    <label>Quiz date<input type="date" value={importDate} onChange={e=>setImportDate(e.target.value)}/></label>
    <label>Title<input maxLength={200} value={importTitle} onChange={e=>setImportTitle(e.target.value)}/></label>
    <label>Questions file<input type="file" accept=".json,application/json" onChange={e=>{if(e.target.files?.[0])void importFile(e.target.files[0]);e.target.value=''}}/></label>
    <button type="button" disabled={!importQuestions.length||!importDate||!importTitle.trim()} onClick={()=>void importSet()}>Import {importQuestions.length} questions</button>
   </details>
  </fieldset>
 </details>
}
