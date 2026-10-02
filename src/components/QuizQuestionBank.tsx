import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Question } from '../pages/QuizzesPage'
import { quizError } from '../pages/QuizzesPage'
import './QuizQuestionBank.css'
type Entry={id:string;source:string;review:boolean;question:Question}
export function QuizQuestionBank({location,disabled,questions,onAdd}:{location:string;disabled:boolean;questions:Question[];onAdd:(questions:Question[])=>void}) {
 const [bank,setBank]=useState<Entry[]>([])
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [search,setSearch]=useState('')
 const [category,setCategory]=useState('All')
 const [source,setSource]=useState('All')
 const [limit,setLimit]=useState(20)
 const [selected,setSelected]=useState<string[]>([])
 const [reviewed,setReviewed]=useState(false)
 const [message,setMessage]=useState('')
 useEffect(()=>{if(!location)return;let live=true;setBusy(true);setError('');setBank([]);setSelected([]);setReviewed(false);void (async()=>{try{const {data,error}=await supabase.rpc('quiz_question_bank',{p_location_id:location});if(error)throw error;if(live)setBank(data ?? [])}catch(e){if(live)setError(quizError(e))}finally{if(live)setBusy(false)}})();return()=>{live=false}},[location])
 const normalize=(s:string)=>s.trim().toLocaleLowerCase()
 const existing=new Set(questions.map(q=>normalize(q.prompt)))
 const chosen=bank.filter(e=>selected.includes(e.id) && !existing.has(normalize(e.question.prompt)))
 const requiresReview=chosen.some(e=>e.review)
 const filtered=bank.filter(e=>(category==='All'||e.question.category===category)&&(source==='All'||e.source===source)&&normalize(e.question.prompt+' '+e.question.category+' '+e.source).includes(normalize(search)))
 function toggle(id:string){setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);setReviewed(false);setMessage('')}
 function add(){if(!chosen.length || chosen.length+questions.length>50 || (requiresReview&&!reviewed))return;onAdd(chosen.map(e=>({...e.question,options:[...e.question.options]})));setMessage(`${chosen.length} questions added. You can edit them below before publishing.`);setSelected([]);setReviewed(false)}
 return <details className="quiz-bank" open><summary><strong>Question Bank ({bank.length})</strong></summary><p>Choose questions from our previous quizzes. Adding a question copies it into this daily quiz so you can edit it before publishing.</p>
 {busy&&<p role="status">Loading question bank…</p>}{error&&<p role="alert">{error}</p>}
 <fieldset disabled={disabled||busy||!location} className="quiz-bank-controls">
 <label>Search questions<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setLimit(20)}} /></label>
 <div className="quiz-bank-filters"><label>Category<select value={category} onChange={e=>{setCategory(e.target.value);setLimit(20)}}><option>All</option>{[...new Set(bank.map(e=>e.question.category))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
 <label>Original quiz<select value={source} onChange={e=>{setSource(e.target.value);setLimit(20)}}><option>All</option>{[...new Set(bank.map(e=>e.source))].map(s=><option key={s}>{s}</option>)}</select></label></div>
 <p>{filtered.length} matching questions · {chosen.length} selected · {questions.length}/50 in daily quiz</p>
 {filtered.slice(0,limit).map(e=>{const added=existing.has(normalize(e.question.prompt));return <article className="quiz-bank-item" key={e.id}><label className="quiz-choice"><input type="checkbox" checked={selected.includes(e.id)&&!added} disabled={added} onChange={()=>toggle(e.id)} /><span>{e.question.prompt}{added?' — Already in this quiz':''}</span></label><p className="muted">{e.question.category} · {e.source}{e.review?' · Review current recipe, price or policy':''}</p><details><summary>Preview answers</summary><ul>{e.question.options.map((o,i)=><li key={i}>{o}{i===e.question.correct?' — Correct answer':''}</li>)}</ul></details></article>})}
 {!busy&&!error&&!filtered.length&&<p>No matching questions.</p>}
 {filtered.length>limit&&<button type="button" onClick={()=>setLimit(v=>v+20)}>Show more questions</button>}
 {requiresReview&&<label className="quiz-choice"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} /><span>I will verify the older recipes, prices and policies in these selected questions before publishing.</span></label>}
 {chosen.length+questions.length>50&&<p role="alert">Choose fewer questions. A daily quiz can contain up to 50.</p>}
 <button type="button" className="primary-button" disabled={!chosen.length||chosen.length+questions.length>50||(requiresReview&&!reviewed)} onClick={add}>Add Selected Questions ({chosen.length})</button>
 </fieldset>{message&&<p role="status">{message}</p>}</details>
}
