import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadTenantData } from '../lib/tenant'
import { supabase } from '../lib/supabase'
import { AssignedTaskLists } from '../components/AssignedTaskLists'
import { serviceDay,serviceDateLabel } from '../lib/serviceDay'
import { quizToday,quizDateLabel,type Quiz,type QuizResult } from './QuizzesPage'
import { postStyle,postColors,type PostColor } from '../lib/postStyle'
import { appFonts,type FontName } from '../lib/appearance'
import { PostMedia,type MediaAsset } from '../components/PostMedia'
import './TasksPage.css'
import './Appearance.css'
type Post={id:string;title:string;body:string;shift_date:string;media?:MediaAsset[];presentation?:{title?:PostColor;text?:PostColor;accent?:PostColor;titleFont?:FontName;textFont?:FontName}}
export function DashboardPage(){
 const [location,setLocation]=useState(''),[name,setName]=useState(''),[error,setError]=useState(''),[day,setDay]=useState(serviceDay),[today,setToday]=useState(quizToday),[refresh,setRefresh]=useState(0)
 const [posts,setPosts]=useState<Post[]>([]),[postError,setPostError]=useState(''),[quiz,setQuiz]=useState<Quiz|null>(null),[result,setResult]=useState<QuizResult|null>(null),[quizError,setQuizError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{let live=true;void loadTenantData().then(t=>{const loc=t.locations[0];if(!loc)throw Error('No active location found.');if(live){setLocation(loc.id);setName(loc.name||t.organization.name)}}).catch(e=>{if(live)setError(String((e as {message?:string}).message??e))});return()=>{live=false}},[])
 useEffect(()=>{const update=()=>{if(document.visibilityState==='visible'){setDay(serviceDay());setToday(quizToday());setRefresh(v=>v+1)}};const timer=setInterval(update,30000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update)}},[])
 useEffect(()=>{if(!location)return;let live=true;setLoading(true);void(async()=>{const [feed,quizData]=await Promise.allSettled([supabase.rpc('preshift_feed',{p_location_id:location,p_limit:1000}),supabase.rpc('quiz_staff_load',{p_location_id:location,p_date:today})]);if(!live)return
 if(feed.status==='fulfilled'&&!feed.value.error){setPosts((feed.value.data?.posts??[]).filter((p:Post)=>p.shift_date===today));setPostError('')}else{setPostError(String(feed.status==='rejected'?feed.reason:feed.value.error?.message));setPosts([])}
 if(quizData.status==='fulfilled'&&!quizData.value.error){setQuiz(quizData.value.data?.quiz??null);setResult(quizData.value.data?.result??null);setQuizError('')}else{setQuizError(String(quizData.status==='rejected'?quizData.reason:quizData.value.error?.message));setQuiz(null);setResult(null)}setLoading(false)
 })();return()=>{live=false}},[location,today,refresh])
 return <section className="page staff-home"><p className="eyebrow">Your shift starts here</p><h1>{name||'Home'}</h1><p>{quizDateLabel(today)}</p>{error&&<p role="alert">{error}</p>}{!location&&!error&&<p role="status">Loading your restaurant…</p>}
 {location&&<><section className="home-section"><div className="home-section-heading"><h2>My Task Lists</h2><Link to="/tasks">All lists / Assign tasks →</Link></div><p className="muted">Service day: {serviceDateLabel(day)}</p><AssignedTaskLists location={location} day={day} refresh={refresh}/></section>
 <section className="home-section"><div className="home-section-heading"><h2>Today’s Pre-Shift</h2><Link to="/preshift">Open feed →</Link></div>{postError&&<p role="alert">{postError}</p>}{loading&&<p role="status">Loading today’s posts…</p>}{!loading&&!postError&&!posts.length&&<p>No pre-shift published for today.</p>}{posts.map(p=><article className="home-post" key={p.id} style={postStyle(p.presentation)}><h3 style={{color:postColors[p.presentation?.title??'brown']?.ink,fontFamily:appFonts[p.presentation?.titleFont??'system']?.css}}>{p.title}</h3><details><summary>Read pre-shift · {quizDateLabel(p.shift_date)}</summary><div className="home-post-body" style={{color:postColors[p.presentation?.text??'brown']?.ink,fontFamily:appFonts[p.presentation?.textFont??'system']?.css}}>{p.body}</div><PostMedia assets={p.media??[]}/></details></article>)}</section>
 <section className="home-section"><div className="home-section-heading"><h2>Today’s Quiz</h2><Link to="/quizzes">Quiz history →</Link></div>{quizError&&<p role="alert">{quizError}</p>}{loading&&<p role="status">Loading quiz…</p>}{!loading&&!quizError&&(quiz?<article className="home-quiz-card"><h3>{quiz.title}</h3><p>Pre-shift quiz · {quizDateLabel(quiz.quiz_date)}</p>{result?<><p><strong>Submitted · {result.score}/{result.total} ({result.percent}%)</strong></p><p>Quiz points: {result.reward_points??0}</p><Link className="home-action" to="/quizzes">View my results</Link></>:<><p>{quiz.questions.length} questions · Not submitted yet</p><Link className="home-action" to="/quizzes">Take today’s quiz</Link></>}</article>:<p>No quiz published for today.</p>)}</section></>}
 </section>
}
