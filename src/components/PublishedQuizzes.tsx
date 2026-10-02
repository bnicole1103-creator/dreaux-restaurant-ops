import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { quizError } from '../pages/QuizzesPage'
export type PublishedQuiz = {id:string; quiz_date:string; title:string; version:number; question_count:number; submission_count:number}
export function PublishedQuizzes({location,refresh,disabled,onEdit,onRemove}:{location:string;refresh:number;disabled:boolean;onEdit:(date:string)=>void;onRemove:(quiz:PublishedQuiz)=>Promise<void>}) {
 const [quizzes,setQuizzes]=useState<PublishedQuiz[]>([])
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 useEffect(()=>{if(!location)return;let live=true;setLoading(true);setError('');void (async()=>{
  try{const {data,error}=await supabase.rpc('quiz_manager_published',{p_location_id:location});if(error)throw error;if(live)setQuizzes(data ?? [])}
  catch(e){if(live){setError(quizError(e));setQuizzes([])}}finally{if(live)setLoading(false)}
 })();return()=>{live=false}},[location,refresh])
 return <article className="mod-review"><h2>Published quizzes</h2>
 <p>Edit a quiz or remove it from staff access. Removing preserves submissions and saves the quiz as a draft.</p>
 {error && <p role="alert">{error}</p>}{loading && <p role="status">Loading published quizzes…</p>}
 {!loading && !error && quizzes.length===0 && <p>No published quizzes yet.</p>}
 {quizzes.map(q=><article className="quiz-question" key={q.id}><h3>{q.title}</h3><p>{q.quiz_date} · {q.question_count} questions · {q.submission_count} submissions</p><div className="quiz-actions"><button type="button" disabled={disabled || loading} onClick={()=>onEdit(q.quiz_date)}>Edit quiz / View scores</button><button type="button" disabled={disabled || loading} onClick={()=>void onRemove(q)}>Remove published quiz</button></div></article>)}
 </article>
}
