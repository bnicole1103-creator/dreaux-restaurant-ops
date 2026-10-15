import {PageWord} from './PageDesign'
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
  <summary><strong><PageWord id="sectioncopy.a4643affd4e3c87f5cdd">{"Question Bank ("}</PageWord>{bank.length}<PageWord id="sectioncopy.56dbcab1ed951d28baca">{") — subject and day"}</PageWord></strong></summary>
  <p><PageWord id="sectioncopy.c6d045c30c179475d7d9">{"Every entry can be added and edited. Edit a bank question to update the reusable original; edit its copy in a quiz to change only that quiz."}</PageWord></p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <fieldset data-design-block="section.3c7490630fa0002431b6" disabled={busy||disabled||!location}>
   <label><PageWord id="sectioncopy.c0e1dec158f6bcf509c3">{"Search"}</PageWord><input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <div className="quiz-bank-filters">
    <label><PageWord id="sectioncopy.7cd75a89d7f4f971da2c">{"Subject"}</PageWord><select value={category} onChange={e=>setCategory(e.target.value)}>
     <option>All</option>{[...new Set(bank.map(e=>e.question.category))].sort().map(c=><option key={c}>{c}</option>)}
    </select></label>
    <label><PageWord id="sectioncopy.13f49ce9a7450612fc91">{"Source day"}</PageWord><select value={day} onChange={e=>setDay(e.target.value)}>
     <option>All</option>{[...new Set(bank.map(e=>e.quiz_date??'Undated'))].sort().reverse().map(d=><option key={d}>{d}</option>)}
    </select></label>
   </div>
   <div className="quiz-actions">
    <button type="button" onClick={()=>setSelected(filtered.map(e=>e.id))}><PageWord id="sectioncopy.afc8bc0b4f88d2396070">{"Select filtered questions"}</PageWord></button>
    <button type="button" disabled={!chosen.length} onClick={()=>add(chosen)}><PageWord id="sectioncopy.cc98a82082a28c5e71d8">{"Add selected ("}</PageWord>{chosen.length}<PageWord id="sectioncopy.b599e68b3cb68aa7291e">{")"}</PageWord></button>
    <button type="button" onClick={()=>setRefresh(v=>v+1)}><PageWord id="sectioncopy.12f140aaf333079cfcd5">{"Refresh bank"}</PageWord></button>
   </div>
   {!bank.length&&<p>{busy?'Loading bank…':'No questions in the bank yet.'}</p>}
   {filtered.map(e=><article data-design-block="section.3c7a5f385d33c9f682e3" className="quiz-bank-item" key={e.id}>
    <label className="quiz-choice"><input type="checkbox" checked={selected.includes(e.id)}
     onChange={()=>setSelected(v=>v.includes(e.id)?v.filter(id=>id!==e.id):[...v,e.id])}/><span>{e.question.prompt}</span></label>
    <p className="muted">{e.question.category}<PageWord id="sectioncopy.551eb41eaf384e4262a0">{" · "}</PageWord>{e.quiz_date??'Undated'}<PageWord id="sectioncopy.f16ee50a64fc5118b2bc">{" · "}</PageWord>{e.source}</p>
    {e.review&&<p className="muted"><PageWord id="sectioncopy.a7312579162bbabfc30c">{"Review source facts, recipes, prices and policies before publishing."}</PageWord></p>}
    <details><summary><PageWord id="sectioncopy.2549f1bfe9b55977ff4e">{"Choices and correct answer"}</PageWord></summary><ol type="A">{e.question.options.map((o,i)=><li key={i}>{o}{i===e.question.correct?' — Correct':''}</li>)}</ol><p>{e.question.explanation}</p></details>
    <button type="button" onClick={()=>add([e])}><PageWord id="sectioncopy.0765ee130f985fc902d8">{"Add this question"}</PageWord></button>
    <button type="button" onClick={()=>{
     if(editing&&!window.confirm('Discard the unsaved bank edit?'))return
     setEditing(e);setEdit({...e.question,options:[...e.question.options]})
    }}><PageWord id="sectioncopy.8057278ef65fcb3b4a77">{"Edit bank question"}</PageWord></button>
    {editing?.id===e.id&&edit&&<div className="mod-review">
     <label><PageWord id="sectioncopy.240c11ffbd8921432ec5">{"Question"}</PageWord><textarea rows={3} maxLength={2000} value={edit.prompt} onChange={x=>setEdit({...edit,prompt:x.target.value})}/></label>
     <label><PageWord id="sectioncopy.1c01bf79cc36ab38dd23">{"Subject"}</PageWord><input maxLength={100} value={edit.category} onChange={x=>setEdit({...edit,category:x.target.value})}/></label>
     {edit.options.map((option,i)=><label key={i}>{String.fromCharCode(65+i)}<input maxLength={1000} value={option} onChange={x=>setEdit({...edit,options:edit.options.map((v,n)=>n===i?x.target.value:v)})}/></label>)}
     <label><PageWord id="sectioncopy.a9f48ae9ba69e15ef8dd">{"Correct answer"}</PageWord><select value={edit.correct} onChange={x=>setEdit({...edit,correct:Number(x.target.value)})}>{edit.options.map((o,i)=><option key={i} value={i}>{String.fromCharCode(65+i)} · {o}</option>)}</select></label>
     <label><PageWord id="sectioncopy.d60aba1a4ac1aca2c2f0">{"Explanation"}</PageWord><textarea rows={3} maxLength={2000} value={edit.explanation} onChange={x=>setEdit({...edit,explanation:x.target.value})}/></label>
     <button type="button" onClick={()=>void save()}><PageWord id="sectioncopy.dc6324e7171892094cd2">{"Save bank question"}</PageWord></button>
     <button type="button" onClick={()=>{setEditing(null);setEdit(null)}}><PageWord id="sectioncopy.eeec30e59694257da57b">{"Cancel bank edit"}</PageWord></button>
    </div>}
   </article>)}
   <details><summary><PageWord id="sectioncopy.525e84c5fe8c521803a8">{"Import an older quiz from JSON"}</PageWord></summary>
    <label><PageWord id="sectioncopy.e28bd4dec9304415c9eb">{"Quiz date"}</PageWord><input type="date" value={importDate} onChange={e=>setImportDate(e.target.value)}/></label>
    <label><PageWord id="sectioncopy.79f945015534b9bb0a8a">{"Title"}</PageWord><input maxLength={200} value={importTitle} onChange={e=>setImportTitle(e.target.value)}/></label>
    <label><PageWord id="sectioncopy.33dc24c826495f8ebbb5">{"Questions file"}</PageWord><input type="file" accept=".json,application/json" onChange={e=>{if(e.target.files?.[0])void importFile(e.target.files[0]);e.target.value=''}}/></label>
    <button type="button" disabled={!importQuestions.length||!importDate||!importTitle.trim()} onClick={()=>void importSet()}><PageWord id="sectioncopy.8e547d6c9c359696d5f2">{"Import "}</PageWord>{importQuestions.length}<PageWord id="sectioncopy.c60e0d48acd08cad1039">{" questions"}</PageWord></button>
   </details>
  </fieldset>
 </details>
}
