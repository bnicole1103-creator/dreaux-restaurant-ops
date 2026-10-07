// page-designer-instrumented
import { PageWord } from "./PageDesign"
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
 return <article data-design-block="copy.f60183e8b2c533b2.1" className="mod-review"><h2 data-design-block="copy.7415c5a0f8281c99.1">{future?<PageWord id="copy.85710cca59404450.1">{"Future quizzes"}</PageWord>:<PageWord id="copy.14790133a41dab0d.1">{"Published quizzes"}</PageWord>}</h2>
 <p data-design-block="copy.aed2997e5c52bc11.1">{future?<PageWord id="copy.ce9d0828621bd075.1">{"Prepare drafts and schedule quizzes for future dates. Scheduled quizzes appear to staff on their quiz date."}</PageWord>:<PageWord id="copy.0404a265e99a0645.1">{"Edit published quizzes or remove them from staff access. Completed scores are preserved."}</PageWord>}</p>
 {error && <p data-design-block="copy.7be48a0499910521.1" role="alert">{error}</p>}{loading && <p data-design-block="copy.33d0e9b744495acb.1" role="status"><ScreenText id="PublishedQuizzes.ffb407bdb85192c4">Loading published quizzes…</ScreenText></p>}
 {!loading && !error && visible.length===0 && <p data-design-block="copy.aed2997e5c52bc11.2">{future?<PageWord id="copy.68dfe46e7926e974.1">{"No future quizzes yet. Choose a future date below to build one."}</PageWord>:<PageWord id="copy.ee227736b2321cc5.1">{"No published quizzes for today or earlier."}</PageWord>}</p>}
 {visible.map(q=><article data-design-block="copy.39d70554e5b3ca5c.1" className="quiz-question" key={q.id}><h3 data-design-block="copy.66eb54530f70def7.1">{q.title}</h3><p data-design-block="copy.aed2997e5c52bc11.3">{q.quiz_date}<PageWord id="copy.98400a24bb87c28c.1">· </PageWord>{q.question_count}<ScreenText id="PublishedQuizzes.480e872324288a23"> questions · </ScreenText>{future?(q.published?<PageWord id="copy.88658858f4331937.1">{"Scheduled"}</PageWord>:<PageWord id="copy.a658941df430332d.1">{"Draft"}</PageWord>):q.submission_count+' submissions'}</p><div data-design-block="copy.138b68fbd3ca2acf.1" className="quiz-actions"><button data-design-block="copy.a18205b3d2102033.1" type="button" disabled={disabled || loading} onClick={()=>onEdit(q.quiz_date)}>{future?<PageWord id="copy.4a742564f978b64b.1">{"Edit future quiz"}</PageWord>:<PageWord id="copy.d80904b3f2882660.1">{"Edit quiz / View scores"}</PageWord>}</button>{(!future || q.published) && <button data-design-block="copy.879069c1cb5b3cba.1" type="button" disabled={disabled || loading} onClick={()=>void onRemove(q)}>{future?<PageWord id="copy.e8aac7ed384ebbe4.1">{"Unpublish scheduled quiz"}</PageWord>:<PageWord id="copy.04aa45c76f18b196.1">{"Remove published quiz"}</PageWord>}</button>}</div></article>)}
 </article>
}
