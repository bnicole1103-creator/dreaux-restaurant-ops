import { StockBoard } from '../components/StockBoard'
import { PreshiftReadReceipt,usePreshiftReadReceipts } from '../components/PreshiftReadReceipts'
import { ScreenText } from "../components/ScreenText"
import { MySections } from '../components/MySections'
import { HomeOperations } from '../components/HomeOperations'
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
type Post={id:string;version:number;title:string;body:string;shift_date:string;media?:MediaAsset[];presentation?:{title?:PostColor;text?:PostColor;accent?:PostColor;titleFont?:FontName;textFont?:FontName}}
export function DashboardPage(){
 const [location,setLocation]=useState(''),[name,setName]=useState(''),[error,setError]=useState(''),[day,setDay]=useState(serviceDay),[today,setToday]=useState(quizToday),[refresh,setRefresh]=useState(0)
 const [posts,setPosts]=useState<Post[]>([]),[postError,setPostError]=useState(''),[quiz,setQuiz]=useState<Quiz|null>(null),[result,setResult]=useState<QuizResult|null>(null),[quizError,setQuizError]=useState(''),[loading,setLoading]=useState(true)
 const reads=usePreshiftReadReceipts(location,posts)
 useEffect(()=>{let live=true;void loadTenantData().then(t=>{const loc=t.locations[0];if(!loc)throw Error('No active location found.');if(live){setLocation(loc.id);setName(loc.name||t.organization.name)}}).catch(e=>{if(live)setError(String((e as {message?:string}).message??e))});return()=>{live=false}},[])
 useEffect(()=>{const update=()=>{if(document.visibilityState==='visible'){setDay(serviceDay());setToday(quizToday());setRefresh(v=>v+1)}};const timer=setInterval(update,30000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update)}},[])
 useEffect(()=>{if(!location)return;let live=true;setLoading(true);void(async()=>{const [feed,quizData]=await Promise.allSettled([supabase.rpc('preshift_feed',{p_location_id:location,p_limit:1000}),supabase.rpc('quiz_staff_load',{p_location_id:location,p_date:today})]);if(!live)return
 if(feed.status==='fulfilled'&&!feed.value.error){setPosts((feed.value.data?.posts??[]).filter((p:Post)=>p.shift_date===today));setPostError('')}else{setPostError(String(feed.status==='rejected'?feed.reason:feed.value.error?.message));setPosts([])}
 if(quizData.status==='fulfilled'&&!quizData.value.error){setQuiz(quizData.value.data?.quiz??null);setResult(quizData.value.data?.result??null);setQuizError('')}else{setQuizError(String(quizData.status==='rejected'?quizData.reason:quizData.value.error?.message));setQuiz(null);setResult(null)}setLoading(false)
 })();return()=>{live=false}},[location,today,refresh])
 return <section className="page staff-home"><p className="eyebrow"><ScreenText id="DashboardPage.bc6d13d141d31c9c">Your shift starts here</ScreenText></p><h1>{name||'Home'}</h1><p>{quizDateLabel(today)}</p>{error&&<p role="alert">{error}</p>}{!location&&!error&&<p role="status"><ScreenText id="DashboardPage.a1d1c867053fcd8f">Loading your restaurant…</ScreenText></p>}
 {location&&<>
<StockBoard location={location}/>
 <section className="home-section"><div className="home-section-heading"><h2><ScreenText id="DashboardPage.fa3c874b7ec2f04f">Today’s Pre-Shift</ScreenText></h2><Link to="/preshift"><ScreenText id="DashboardPage.438fb1924659b005">Open feed →</ScreenText></Link></div>{postError&&<p role="alert">{postError}</p>}{reads.error&&<p role="alert">Read receipts: {reads.error} <button type="button" onClick={reads.reload}>Retry</button></p>}{loading&&<p role="status"><ScreenText id="DashboardPage.5899d053d78dbc90">Loading today’s posts…</ScreenText></p>}{!loading&&!postError&&!posts.length&&<p><ScreenText id="DashboardPage.7d5117c94d1c7c83">No pre-shift published for today.</ScreenText></p>}{posts.map(p=><article className="home-post" key={p.id} style={postStyle(p.presentation)}><h3 style={{color:postColors[p.presentation?.title??'brown']?.ink,fontFamily:appFonts[p.presentation?.titleFont??'system']?.css}}>{p.title}</h3><details><summary><ScreenText id="DashboardPage.b9bdfa05f2a58e58">Read pre-shift · </ScreenText>{quizDateLabel(p.shift_date)}</summary><div className="home-post-body" style={{color:postColors[p.presentation?.text??'brown']?.ink,fontFamily:appFonts[p.presentation?.textFont??'system']?.css}}>{p.body}</div><PostMedia assets={p.media??[]}/><PreshiftReadReceipt location={location} postId={p.id} version={p.version} status={reads.rows[p.id]} manager={reads.manager} onChange={reads.reload}/></details></article>)}</section>
 <section className="home-section"><div className="home-section-heading"><h2><ScreenText id="DashboardPage.05c55bb281e731f2">Today’s Quiz</ScreenText></h2><Link to="/quizzes"><ScreenText id="DashboardPage.ad20f179d16eca06">Quiz history →</ScreenText></Link></div>{quizError&&<p role="alert">{quizError}</p>}{loading&&<p role="status"><ScreenText id="DashboardPage.f6d279821b18fae7">Loading quiz…</ScreenText></p>}{!loading&&!quizError&&(quiz?<article className="home-quiz-card"><h3>{quiz.title}</h3><p><ScreenText id="DashboardPage.8e884be7d9d9f347">Pre-shift quiz · </ScreenText>{quizDateLabel(quiz.quiz_date)}</p>{result?<><p><strong><ScreenText id="DashboardPage.9700412bbfc801f1">Submitted · </ScreenText>{result.score}/{result.total} ({result.percent}%)</strong></p><p><ScreenText id="DashboardPage.a0295d2dc9305b4a">Quiz points: </ScreenText>{result.reward_points??0}</p><Link className="home-action" to="/quizzes"><ScreenText id="DashboardPage.80608ce5299ec4c7">View my results</ScreenText></Link></>:<><p>{quiz.questions.length}<ScreenText id="DashboardPage.c52440f9c488fc63"> questions · Not submitted yet</ScreenText></p><Link className="home-action" to="/quizzes"><ScreenText id="DashboardPage.80d4c0570ae8d48f">Take today’s quiz</ScreenText></Link>
</>}</article>:<p><ScreenText id="DashboardPage.51fc46349f9e7a35">No quiz published for today.</ScreenText></p>)}</section>
<MySections location={location} date={day} refresh={refresh}/><section className="home-section"><div className="home-section-heading"><h2><ScreenText id="DashboardPage.983f4f14a77a4ee8">My Task Lists</ScreenText></h2><Link to="/tasks"><ScreenText id="DashboardPage.5bd7afd0d47d85c7">All lists / Assign tasks →</ScreenText></Link></div><p className="muted"><ScreenText id="DashboardPage.eab2baa316a5794f">Service day: </ScreenText>{serviceDateLabel(day)}</p><AssignedTaskLists location={location} day={day} refresh={refresh}/></section>
<HomeOperations location={location} today={today} refresh={refresh}/>
</>}
 </section>
}
