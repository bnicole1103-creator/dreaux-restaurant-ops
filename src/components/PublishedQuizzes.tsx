import { ScreenText } from "./ScreenText"
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { quizError } from '../pages/QuizzesPage'
export type PublishedQuiz = {id:string; quiz_date:string; title:string; version:number; question_count:number; submission_count:number;published?:boolean}
export function PublishedQuizzes({location,refresh,disabled,onEdit,onRemove,throughDate,future=false}:{location:string;refresh:number;disabled:boolean;throughDate?:string;future?:boolean;onEdit:(date:string)=>void;onRemove:(quiz:PublishedQuiz)=>Promise<void>}) {
 const [quizzes,setQuizzes]=useState<PublishedQuiz[]>([])
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 useEffect(()=>{if(!location)return;let live=true;setLoading(true);setError('');void (async()=>{
  try{const {data,error}=await supabase.rpc(future?'quiz_manager_future':'quiz_manager_published',{p_location_id:location});if(error)throw error;if(live)setQuizzes(data ?? [])}
  catch(e){if(live){setError(quizError(e));setQuizzes([])}}finally{if(live)setLoading(false)}
 })();return()=>{live=false}},[location,refresh,future])
 const visible=quizzes.filter(q=>!throughDate || q.quiz_date<=throughDate)
 return <article className="mod-review"><h2>{future?'Future quizzes':'Published quizzes'}</h2>
 <p>{future?'Prepare drafts and schedule quizzes for future dates. Scheduled quizzes appear to staff on their quiz date.':'Edit published quizzes or remove them from staff access. Completed scores are preserved.'}</p>
 {error && <p role="alert">{error}</p>}{loading && <p role="status"><ScreenText id="PublishedQuizzes.ffb407bdb85192c4">Loading published quizzes…</ScreenText></p>}
 {!loading && !error && visible.length===0 && <p>{future?'No future quizzes yet. Choose a future date below to build one.':'No published quizzes for today or earlier.'}</p>}
 {visible.map(q=><article className="quiz-question" key={q.id}><h3>{q.title}</h3><p>{q.quiz_date} · {q.question_count}<ScreenText id="PublishedQuizzes.480e872324288a23"> questions · </ScreenText>{future?(q.published?'Scheduled':'Draft'):q.submission_count+' submissions'}</p><div className="quiz-actions"><button type="button" disabled={disabled || loading} onClick={()=>onEdit(q.quiz_date)}>{future?'Edit future quiz':'Edit quiz / View scores'}</button>{(!future || q.published) && <button type="button" disabled={disabled || loading} onClick={()=>void onRemove(q)}>{future?'Unpublish scheduled quiz':'Remove published quiz'}</button>}</div></article>)}
 </article>
}
