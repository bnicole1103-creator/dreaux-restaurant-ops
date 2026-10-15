import {PreshiftMinuteRule} from '../components/PreshiftMinuteRule'
import {StaffFeedComposer} from '../components/StaffFeedComposer'
import {SalesTargetPreview} from '../components/SalesTargetPreview'
import {mergePostTargets,clearPostTargets} from '../lib/postTargets'
import {AccessSection} from '../components/AppAccess'
import {PosterStyleControls} from '../components/PosterStyleControls'
import {defaultCalendarLook,type CalendarLook} from '../lib/calendarLook'
import '../components/PosterCalendar.css'
import { PostDiscussion } from '../components/PostDiscussion'
import { PreshiftPostGenerator } from '../components/PreshiftPostGenerator'
import { PostNotificationControl } from '../components/PostNotificationControl'
import { PreshiftOpenTracker } from '../components/PreshiftActivity'
// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
import { ReservationPostNotes, mergeReservationNotes } from '../components/ReservationShiftNotes'
import { PreshiftDrafts, type PostDraft } from '../components/PreshiftDrafts'
import { PreshiftReadReceipt,usePreshiftReadReceipts } from '../components/PreshiftReadReceipts'
import { GeneratePreshiftQuiz } from '../components/GeneratePreshiftQuiz'
import { ScreenText } from "../components/ScreenText"
import { PreshiftSections, type SectionChanges } from '../components/PreshiftSections'
import { PreshiftArchive } from '../components/PreshiftArchive'
import { PreshiftPresetBuilder } from '../components/PreshiftPresetBuilder'
import { appFonts, type FontName } from '../lib/appearance'
import { PostMedia, type MediaAsset } from '../components/PostMedia'
import './Appearance.css'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { useManagementAccess } from '../components/ManagementAccess'
import './PreshiftFeedPage.css'
import { postColors, type PostColor, postStyle } from '../lib/postStyle'
type Post={id:string;title:string;body:string;shift_date:string;pinned:boolean;version:number;created_at:string;updated_at:string;author:string;presentation?:{title?:PostColor;text?:PostColor;accent?:PostColor;titleFont?:FontName;textFont?:FontName;design?:CalendarLook};media?:MediaAsset[]}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const stamp=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value))
const day=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}).format(new Date(value+'T12:00:00Z'))
const message=(e:unknown)=>String((e as {message?:string})?.message ?? e)
export function PreshiftFeedPage(){
 const navigate=useNavigate(),route=useLocation()
 const requestedView=route.pathname.split('/').filter(Boolean)[1]??'feed'
 const view=['feed','write','generate','presets','drafts','archive'].includes(requestedView)?requestedView:'feed'
 const requestedPost=new URLSearchParams(route.search).get('post')
 const workspace=['write','generate','presets','drafts'].includes(view)
 useEffect(()=>{if(view==='feed'&&requestedPost)requestAnimationFrame(()=>document.getElementById('feed-post-'+requestedPost)?.scrollIntoView({block:'center'}))},[view,requestedPost,route.key])
 const heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{requestAnimationFrame(()=>{heading.current?.scrollIntoView({block:'start'});heading.current?.focus()})},[view])
 const [generating,setGenerating]=useState(false)
 const [draft,setDraft]=useState<PostDraft|null>(null);const [scheduleTime,setScheduleTime]=useState('');const [draftSections,setDraftSections]=useState<SectionChanges|null>(null)
 const archive=view==='archive';const access=useManagementAccess();const [location,setLocation]=useState('');const [posts,setPosts]=useState<Post[]>([]);const [total,setTotal]=useState(0)
 const [limit,setLimit]=useState(1000);const [refresh,setRefresh]=useState(0);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false)
 const [error,setError]=useState('');const [formError,setFormError]=useState('');const [notice,setNotice]=useState('');const [editing,setEditing]=useState<Post|null>(null)
 const [reservationsLoading,setReservationsLoading]=useState(false)
 const [sectionsLoading,setSectionsLoading]=useState(false)
 const [sectionChanges,setSectionChanges]=useState<SectionChanges|null>(null)
 const [builderKey,setBuilderKey]=useState(0)
 const [compose,setCompose]=useState(false);const [title,setTitle]=useState('');const [body,setBody]=useState('');const [date,setDate]=useState(today);const [pinned,setPinned]=useState(false)
 const [titleColor,setTitleColor]=useState<PostColor>('brown');const [textColor,setTextColor]=useState<PostColor>('brown');const [accentColor,setAccentColor]=useState<PostColor>('tan');const bodyInput=useRef<HTMLTextAreaElement>(null)
 const [postLook,setPostLook]=useState<CalendarLook>(defaultCalendarLook)
 const [titleFont,setTitleFont]=useState<FontName>('system');const [textFont,setTextFont]=useState<FontName>('system');const [media,setMedia]=useState<MediaAsset[]>([]);const [uploading,setUploading]=useState(false);const pending=useRef<string[]>([])
 async function discardUploads(){const paths=pending.current;pending.current=[];if(paths.length)await supabase.storage.from('preshift-media').remove(paths)}
 async function upload(files:File[]){setUploading(true);setFormError('');try{if(files.length+media.length>6)throw new Error('Use up to 6 photos or videos.');const {data,error}=await supabase.auth.getUser();if(error||!data.user)throw new Error('Sign in again before uploading.');for(const file of Array.from(files)){const types:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};if(!types[file.type])throw new Error('Use JPG, PNG, WebP, GIF, MP4, MOV or WebM.');if(file.size>50*1024*1024)throw new Error('Each attachment must be 50 MB or smaller.');const path=location+'/'+data.user.id+'/'+crypto.randomUUID()+'.'+types[file.type];const r=await supabase.storage.from('preshift-media').upload(path,file,{contentType:file.type,upsert:false});if(r.error)throw r.error;pending.current.push(path);const asset:MediaAsset={path,kind:file.type.startsWith('image/')?'image':'video',name:file.name.slice(0,255),caption:''};setMedia(v=>[...v,asset])}}catch(e){setFormError(message(e))}finally{setUploading(false)}}
 const reads=usePreshiftReadReceipts(location,posts)
 const [updated,setUpdated]=useState('');const editor=useRef<HTMLHeadingElement>(null)
 const focusedPost=useRef('')
 useEffect(()=>{const key=route.key+':'+requestedPost;if(view==='feed'&&requestedPost&&posts.some(p=>p.id===requestedPost)&&focusedPost.current!==key){focusedPost.current=key;requestAnimationFrame(()=>document.getElementById('feed-post-'+requestedPost)?.scrollIntoView({block:'center'}))}},[posts,requestedPost,view,route.key])
 useEffect(()=>{let active=true;void loadTenantData().then(t=>{if(!t.locations[0])throw new Error('No active location.');if(active)setLocation(t.locations[0].id)}).catch(e=>{if(active){setError(message(e));setLoading(false)}});return()=>{active=false}},[])
 useEffect(()=>{if(!location)return;let active=true;let fetching=false
  const fetchPosts=async()=>{if(fetching)return;fetching=true;try{const r=await supabase.rpc('preshift_feed',{p_location_id:location,p_limit:limit});if(r.error)throw r.error;if(active){setPosts(r.data?.posts??[]);setTotal(r.data?.total??0);setUpdated(stamp(new Date().toISOString()));setError('')}}catch(e){if(active)setError(message(e))}finally{fetching=false;if(active)setLoading(false)}}
  const visible=()=>{if(document.visibilityState==='visible')void fetchPosts()}
  void fetchPosts();const timer=setInterval(visible,15000);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible)
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible)}
 },[location,limit,refresh])
 async function start(post:Post|null,destination='write'){if(saving||uploading||generating)return;if(compose && (title.trim() || body.trim()) && !window.confirm('Discard the post you are currently editing?'))return;await discardUploads();setMedia(post?.media??[]);setPostLook(post?.presentation?.design??defaultCalendarLook);setTitleFont(post?.presentation?.titleFont??'script');setTextFont(post?.presentation?.textFont??'system');setTitleColor(post?.presentation?.title ?? 'brown');setTextColor(post?.presentation?.text ?? 'brown');setAccentColor(post?.presentation?.accent ?? 'tan');setDraft(null);setDraftSections(null);setScheduleTime('');setSectionChanges(null);setEditing(post);setTitle(post?.title ?? '');setBody(post?.body ?? '');setDate(post?.shift_date ?? today());setPinned(post?.pinned ?? false);setFormError('');setNotice('');setCompose(true);setBuilderKey(v=>v+1);navigate('/preshift/'+destination);setTimeout(()=>editor.current?.focus(),0)}
 async function save(mode:'publish'|'draft'|'schedule'='publish'){
  if(generating)return;
  if(sectionsLoading||reservationsLoading){setFormError('Wait for shift details to load, or turn off reservation notes if unavailable.');return};setSaving(true);setFormError('');setNotice('');
  try{
   const content={title,body,shift_date:date,pinned,presentation:{title:titleColor,text:textColor,accent:accentColor,titleFont,textFont,design:postLook},media,source:sectionChanges?.source??null,sections:sectionChanges?.rows??null}
   if(mode!=='publish'||draft){
    const saved=await supabase.rpc('preshift_draft_save',{p_location_id:location,p_id:draft?.id??null,p_version:draft?.version??null,p_content:content,p_publish_local:mode==='schedule'?scheduleTime:null});if(saved.error)throw saved.error;
    pending.current=[];
    const next={id:saved.data as string,version:draft?draft.version+1:1,content,editable:true,status:mode==='schedule'?'scheduled':'draft',publish_at:null,last_error:null,author:draft?.author??''} as PostDraft;setDraft(next);setRefresh(v=>v+1);
    if(mode==='publish'){const r=await supabase.rpc('preshift_draft_publish',{p_location_id:location,p_id:next.id,p_version:next.version});if(r.error)throw r.error;}
   }else{
    const r=await supabase.rpc('preshift_post_save_sections',{p_location_id:location,p_id:editing?.id??null,p_version:editing?.version??null,p_title:title,p_body:body,p_shift_date:date,p_pinned:pinned,p_presentation:content.presentation,p_media:media,p_source:content.source,p_sections:content.sections});if(r.error)throw r.error;
   }
   pending.current=[];setCompose(false);setEditing(null);setDraft(null);setNotice(mode==='draft'?'Draft saved.':mode==='schedule'?'Post scheduled in Central time.':editing?'Post updated.':'Post published.');setRefresh(v=>v+1);navigate(mode==='publish'?'/preshift':'/preshift/drafts')
  }catch(e){setFormError(message(e))}finally{setSaving(false)}
 }
 async function resumeDraft(item:PostDraft){
  if(saving||uploading||generating)return;if(compose&&(title.trim()||body.trim())&&!window.confirm('Discard the post you are currently editing?'))return;
  await discardUploads();const c=item.content;setPostLook((c.presentation as {design?:CalendarLook})?.design??defaultCalendarLook);setDraft(item);setEditing(null);setTitle(c.title);setBody(c.body);setDate(c.shift_date);setPinned(c.pinned);setMedia(c.media??[]);
  setTitleColor(c.presentation.title??'brown');setTextColor(c.presentation.text??'brown');setAccentColor(c.presentation.accent??'tan');setTitleFont(c.presentation.titleFont??'system');setTextFont(c.presentation.textFont??'system');
  const sections=c.source&&c.sections?{source:c.source,rows:c.sections}:null;setDraftSections(sections);setSectionChanges(sections);setScheduleTime(item.publish_at?new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(item.publish_at)).replace(' ','T'):'');
  setFormError('');setNotice('');setCompose(true);setBuilderKey(v=>v+1);navigate('/preshift/write');setTimeout(()=>{editor.current?.scrollIntoView({block:'start',behavior:'smooth'});editor.current?.focus()},0)
 }
 async function remove(post:Post){if(!window.confirm('Remove "'+post.title+'" from the feed?'))return;setSaving(true);setNotice('');try{const r=await supabase.rpc('preshift_post_remove',{p_location_id:location,p_id:post.id,p_version:post.version});if(r.error)throw r.error;setNotice('Post removed.');if(editing?.id===post.id)setCompose(false);setRefresh(v=>v+1)}catch(e){setError(message(e))}finally{setSaving(false)}}
 function changeServiceDay(next:string){
  if(!next)return
  setDate(next);setSectionChanges(null);setDraftSections(null);setScheduleTime('')
  setBuilderKey(v=>v+1);setBody(v=>mergeReservationNotes(clearPostTargets(v),''));setNotice('Service day changed. Review the post wording and reload any Floor sections for this date.')
 }
 function openTool(destination:string){
  if(saving||uploading||generating)return
  setFormError('');setNotice('')
  if(compose || destination==='drafts' || destination==='archive')navigate('/preshift/'+destination)
  else void start(null,destination)
 }
 const editorRoute=useRef('')
 useEffect(()=>{
  if(compose){editorRoute.current=route.key;return}
  if(editorRoute.current===route.key)return
  if(!access.manager||!location||compose||saving)return
  if(view==='write'&&requestedPost){
   if(loading)return
   const target=posts.find(p=>p.id===requestedPost)
   if(!target&&total>posts.length&&limit<1000){setLoading(true);setLimit(1000);return}
   if(!target){setFormError('This post could not be loaded. Refresh the feed, check access, or confirm it has not been removed.');return}
   editorRoute.current=route.key;void start(target,'write');return
  }
  if(['write','generate','presets'].includes(view)){editorRoute.current=route.key;void start(null,view)}
 },[route.key,view,requestedPost,access.manager,location,compose,saving,loading,posts,total,limit])
 const titles:Record<string,string>={feed:'Posts',write:editing?'Edit post':draft?'Edit draft':'Write a post',generate:'Pre-shift builder',presets:'Use a preset',drafts:'Drafts & scheduled posts',archive:'Past posts'}
 if(workspace&&!access.loading&&!access.manager)return <section data-design-block="section.ea91af1b0f85cac04d73" className="preshift-feed"><h1><PageWord id="sectioncopy.97a68cb6c70f8a3fbe8b">{"Manager access required"}</PageWord></h1><p>{access.error||'Only managers can create and manage posts.'}</p><Link to="/preshift"><PageWord id="sectioncopy.eed51547249dc621c8e1">{"Back to feed"}</PageWord></Link></section>
 if(!['feed','write','generate','presets','drafts','archive'].includes(view))return <section data-design-block="section.c0a4bd54ba885df4e940" className="preshift-feed"><h1><PageWord id="sectioncopy.8af7175354c19d8c0504">{"Page not found"}</PageWord></h1><Link to="/preshift"><PageWord id="sectioncopy.2285fc80040b9a3f685d">{"Back to feed"}</PageWord></Link></section>
 return <section data-design-block="copy.10b31307eaa6e907.1" className="preshift-feed">
  <p className="eyebrow"><ScreenText id="PreshiftFeedPage.d71405fe359398cf">Team updates</ScreenText></p>
  <h1 data-design-block={view==='feed'?'copy.54da1f51649c1c8c.1':'copy.PreshiftWorkspace.title.'+view} ref={heading} tabIndex={-1}><ScreenText id={view==='feed'?'PostsFeed.title':'PostsTools.title.'+view}>{titles[view]}</ScreenText></h1>
  {view==='feed'?<>
   <p><ScreenText id="PostsFeed.intro">Announcements, flyers, shift updates, and everything the team needs to know.</ScreenText></p>
   {location&&<AccessSection page="posts" section="feed"><StaffFeedComposer location={location} onPublished={()=>{setNotice('Post published.');setRefresh(v=>v+1)}}/></AccessSection>}
   {access.manager&&<nav className="preshift-tools" aria-label="Post tools" data-design-block="copy.PreshiftWorkspace.tools">
    {([['write',compose?'Continue post':'Write a post'],['generate','Pre-shift builder'],['presets','Use a preset'],['drafts','Drafts & scheduled posts']] as const).map(([destination,label])=><button key={destination} type="button" disabled={saving||uploading||generating||!location} onClick={()=>openTool(destination)}><ScreenText id={'PostsTools.button.'+destination}>{label}</ScreenText></button>)}
   </nav>}
   <div className="feed-actions"><Link to="/quizzes"><ScreenText id="PreshiftFeedPage.530b78d4332310fb">Take today’s quiz →</ScreenText></Link><button type="button" onClick={()=>setRefresh(v=>v+1)}><ScreenText id="PreshiftFeedPage.e5e12a67d3fe28f9">Refresh feed</ScreenText></button><Link to="/preshift/archive"><ScreenText id="PostsFeed.archive">Past posts</ScreenText></Link></div>
  </>:<nav data-design-block="section.c463f53c45b4ed27a713" className="feed-actions" aria-label="Posts navigation"><button type="button" disabled={saving||uploading||generating} onClick={()=>navigate('/preshift')}><ScreenText id="PreshiftWorkspace.back">← Back to feed</ScreenText></button>{compose&&view!=='write'&&access.manager&&<button type="button" disabled={saving||uploading||generating} onClick={()=>navigate('/preshift/write')}><ScreenText id="PreshiftWorkspace.continue">Continue editing post</ScreenText></button>}</nav>}
  {access.error && <p data-design-block="copy.661fa37c9faf5162.1" role="alert">{access.error}</p>}{error && <p data-design-block="copy.661fa37c9faf5162.2" role="alert">{error}</p>}{notice && <p data-design-block="copy.f365d770b3e83532.1" role="status" className="preshift-confirmation">{notice}</p>}
  {!compose&&formError&&<p role="alert">{formError}</p>}
  {view==='write' && compose && access.manager && <form data-design-block="copy.7e5b7cd584f90a97.1" className="feed-card feed-editor" onSubmit={e=>{e.preventDefault();void save('publish')}}><h2 data-design-block="copy.1073053cd87771f1.1" ref={editor} tabIndex={-1}>{editing?<PageWord id="copy.5966bf049fff20ad.1">{"Edit post"}</PageWord>:draft?<PageWord id="copy.823ce04784e004ce.1">{"Edit draft"}</PageWord>:<PageWord id="copy.6be9566af0baa318.1">{"New post"}</PageWord>}</h2>
   <label data-design-block="copy.7297067b09724b8b.1"><ScreenText id="PreshiftFeedPage.c893d3f335bc3d7f">Post date</ScreenText><input type="date" required value={date} disabled={saving||uploading||generating} onChange={e=>changeServiceDay(e.target.value)} /></label><p data-design-block="copy.810e8272d4819441.2"><ScreenText id="PreshiftFeedPage.640ad606e6e0e07a">The post date connects this post with that day on the calendar. Save a draft, publish now, or choose a separate publication time below.</ScreenText></p>
   <label data-design-block="copy.7297067b09724b8b.2"><ScreenText id="PreshiftFeedPage.421ea77bd55d50ed">Title</ScreenText><input required maxLength={160} value={title} disabled={saving||uploading||generating} onChange={e=>setTitle(e.target.value)} /></label>
   <label data-design-block="copy.7297067b09724b8b.3"><ScreenText id="PreshiftFeedPage.9bc98d09920bda9d">Post</ScreenText><textarea ref={bodyInput} required maxLength={12000} rows={8} value={body} disabled={saving||uploading||generating} onChange={e=>setBody(e.target.value)} placeholder="Today’s specials, service priorities, menu notes, and team reminders…" /></label>
   <div className="feed-actions"><button type="button" disabled={saving||uploading||generating} onClick={()=>openTool('generate')}><PageWord id="sectioncopy.7b2e6c80d3a9160345d3">{"Generate from notes"}</PageWord></button><button type="button" disabled={saving||uploading||generating} onClick={()=>openTool('presets')}><PageWord id="sectioncopy.91f7d887a0d16adfec0e">{"Add preset wording"}</PageWord></button></div>
   <details className="preshift-extra"><summary><ScreenText id="PreshiftWorkspace.formatting">Colors, fonts & emojis</ScreenText></summary>
<details className="preshift-extra"><summary><PageWord id="sectioncopy.1fc1de4692838cb7ede4">{"Post templates, outline & color wheels ✨"}</PageWord></summary><PosterStyleControls look={postLook} onChange={look=>{setPostLook(look);setTitleFont(look.font)}}/></details>
   <div data-design-block="copy.5061e3328d3ab076.1" className="post-color-tools">{([['Title color',titleColor,setTitleColor],['Text color',textColor,setTextColor],['Card accent',accentColor,setAccentColor]] as const).map(([label,value,setter])=><label data-design-block="copy.c2cb24672705f7ec.1" key={label}>{label}<select value={value} disabled={saving||uploading||generating} onChange={e=>setter(e.target.value as PostColor)}>{Object.entries(postColors).map(([key,c])=><option key={key} value={key}>{c.label}</option>)}</select></label>)}</div>
   <div data-design-block="copy.5061e3328d3ab076.2" className="post-color-tools">{([['Title font',titleFont,setTitleFont],['Post font',textFont,setTextFont]] as const).map(([label,value,setter])=><label data-design-block="copy.c2cb24672705f7ec.2" key={label}>{label}<select value={value} disabled={saving||uploading||generating} onChange={e=>setter(e.target.value as FontName)}>{Object.entries(appFonts).map(([key,font])=><option key={key} value={key}>{font.label}</option>)}</select></label>)}</div>
   <div data-design-block="copy.640b425a1c9959aa.1" className="emoji-tools" aria-label="Add an emoji to the post">{['✨','🍸','🥂','🍽️','🔥','🎉','💋','✅','🚨','🤝','⏰','📣','🦞','🌮'].map(emoji=><button data-design-block="copy.2d6790dc376a3801.1" type="button" key={emoji} disabled={saving||uploading||generating} aria-label={'Insert '+emoji} onClick={()=>{const input=bodyInput.current;const start=input?.selectionStart ?? body.length;const end=input?.selectionEnd ?? start;setBody(v=>(v.slice(0,start)+emoji+v.slice(end)).slice(0,12000));requestAnimationFrame(()=>{input?.focus();input?.setSelectionRange(start+emoji.length,start+emoji.length)})}}>{emoji}</button>)}</div>
   </details>
   <AccessSection page="settings" section="sales"><details className="preshift-extra"><summary>Add sales targets to post</summary><SalesTargetPreview location={location} date={date} disabled={saving||uploading||generating} onAdd={text=>{setBody(mergePostTargets(body,text));setNotice('Sales targets added. Review the post, then save or publish.')}}/></details></AccessSection>
   <details className="preshift-extra"><summary><ScreenText id="PreshiftWorkspace.reservations">Reservation notes</ScreenText></summary>
   <ReservationPostNotes key={builderKey} location={location} date={date} disabled={saving||uploading||generating} editing={!!editing||!!draft||!!body.trim()} onLoading={setReservationsLoading} onChange={text=>setBody(mergeReservationNotes(body,text))}/>
   </details>
   <details className="preshift-extra"><summary><ScreenText id="PreshiftWorkspace.sections">Floor sections</ScreenText></summary>
   <PreshiftSections initial={sectionChanges??draftSections} key={builderKey} location={location} date={date} disabled={saving||uploading||generating} onLoading={setSectionsLoading} onChange={value=>{setSectionChanges(value);if(value)setBody(v=>v.split('\n\n── Sections ──\n')[0])}}/>
   </details>
   <details className="preshift-extra"><summary><ScreenText id="PreshiftWorkspace.attachments">Photos & videos</ScreenText><PageWord id="sectioncopy.b48667314b9f3dac93e3">{" ("}</PageWord>{media.length}<PageWord id="sectioncopy.0eeb69d86b6af1f8031d">{")"}</PageWord></summary>
   <label data-design-block="copy.7297067b09724b8b.4"><ScreenText id="PreshiftFeedPage.e59d76e749e16b23">Photos and videos</ScreenText><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" disabled={saving||uploading||generating||media.length>=6} onChange={e=>{if(e.target.files)void upload(Array.from(e.target.files));e.target.value=''}} /></label><p data-design-block="copy.810e8272d4819441.3"><ScreenText id="PreshiftFeedPage.93298a425cc00b8f">Up to 6 attachments · 50 MB each. Videos play when staff tap Play.</ScreenText></p>{uploading&&<p data-design-block="copy.f365d770b3e83532.2" role="status"><ScreenText id="PreshiftFeedPage.7b282a454be608ff">Uploading attachment…</ScreenText></p>}
   {media.map(a=><div data-design-block="copy.cc0cff1aab3097c5.1" className="media-edit-row" key={a.path}><span>{a.name}</span><label data-design-block="copy.7297067b09724b8b.5"><ScreenText id="PreshiftFeedPage.ebecddb5f399fe93">Caption</ScreenText><input value={a.caption} maxLength={500} disabled={saving||uploading||generating} onChange={e=>setMedia(v=>v.map(x=>x.path===a.path?{...x,caption:e.target.value}:x))} /></label><button data-design-block="copy.70a00de27f07f151.1" type="button" disabled={saving||uploading||generating} onClick={()=>setMedia(v=>v.filter(x=>x.path!==a.path))}><ScreenText id="PreshiftFeedPage.1bf6f8c4776d3c31">Remove attachment</ScreenText></button></div>)}<PostMedia assets={media} />
   </details>
   <details className="post-preview"><summary><ScreenText id="PreshiftFeedPage.01b18dbf82541188">Preview post</ScreenText></summary><article data-design-block="copy.548f6029dd544e6e.1" className="feed-card" style={postStyle({accent:accentColor,design:postLook})}><h2 data-design-block="copy.ad744e74bbe60685.1" style={{color:postColors[titleColor].ink,fontFamily:appFonts[titleFont].css}}>{title || "Your title"}</h2><p data-design-block="copy.dd86e8363ae1cf2a.1" className="feed-body" style={{color:postColors[textColor].ink,fontFamily:appFonts[textFont].css}}>{body || "Your post will appear here."}</p></article></details>
   <label data-design-block="copy.183a5fa43b58ea4c.1" className="feed-check"><input type="checkbox" checked={pinned} disabled={saving||uploading||generating} onChange={e=>setPinned(e.target.checked)} /><ScreenText id="PreshiftFeedPage.8d46c454e24ba298">Pin to the top</ScreenText></label>
   {formError && <p data-design-block="copy.661fa37c9faf5162.3" role="alert">{formError}</p>}<div data-design-block="copy.ecf01b60090e7c90.2" className="feed-actions">{!editing&&<button data-design-block="copy.dc16c7ae92664153.1" type="button" disabled={saving||uploading||generating||sectionsLoading} onClick={()=>void save('draft')}>{saving?<PageWord id="copy.a6e42d56856a1f83.1">{"Saving…"}</PageWord>:<PageWord id="copy.99c5de3d06db8de8.1">{"Save draft"}</PageWord>}</button>}<button data-design-block="copy.25d39570b974e38e.1" type="submit" className="primary-button" disabled={saving||uploading||generating||sectionsLoading||!title.trim()||!body.trim()}>{saving?<PageWord id="copy.a6e42d56856a1f83.2">{"Saving…"}</PageWord>:editing?<PageWord id="copy.606f8ae98a2ea3ef.1">{"Save changes"}</PageWord>:<PageWord id="copy.0e7cd057a72960ab.1">{"Publish now"}</PageWord>}</button><button data-design-block="copy.151574c132003f58.1" type="button" disabled={saving||uploading||generating} onClick={()=>{void discardUploads();setCompose(false);setDraft(null);setEditing(null);navigate('/preshift')}}><ScreenText id="PreshiftFeedPage.d5c515dcd12201f0">Cancel</ScreenText></button></div>
   {!editing&&<details className="preshift-extra"><summary><ScreenText id="PreshiftWorkspace.schedule">Schedule publication</ScreenText></summary><fieldset data-design-block="copy.2a232ff775d870ff.1" className="post-schedule"><legend><PageWord id="copy.d73f4a036e52dfd8.1">Schedule publication</PageWord></legend><label data-design-block="copy.7297067b09724b8b.6"><PageWord id="copy.7672529cb2af577b.1">Publish date and time (Central)</PageWord><input type="datetime-local" value={scheduleTime} disabled={saving||uploading||generating} onChange={e=>setScheduleTime(e.target.value)}/></label><p data-design-block="copy.810e8272d4819441.4"><PageWord id="copy.56bbb37eea718966.1">Staff see the post after it publishes. Saving a scheduled post as a draft cancels its schedule. During daylight saving changes, choose a time outside 1–3 AM.</PageWord></p><button data-design-block="copy.ebebcf9c0425faa5.1" type="button" disabled={saving||uploading||generating||sectionsLoading||!scheduleTime||!title.trim()||!body.trim()} onClick={()=>void save('schedule')}><PageWord id="copy.5555b90a2fb51b1d.1">Schedule post</PageWord></button></fieldset></details>}
   <details className="preshift-extra"><summary><ScreenText id="PreshiftWorkspace.quiz">Generate a quiz from this post</ScreenText></summary>
   <AccessSection page="posts" section="builder"><GeneratePreshiftQuiz location={location} date={date} title={title} body={body} disabled={saving||uploading||generating||sectionsLoading}/></AccessSection>
   </details>
  </form>}
  {access.manager&&compose&&(view==='generate'||view==='presets')&&<section data-design-block="section.1f79dd78caf1ccee937d" className="feed-card feed-editor preshift-tool-page">
   <label><ScreenText id="PreshiftWorkspace.serviceDate">Service day</ScreenText><input type="date" value={date} disabled={saving||uploading||generating} onChange={e=>changeServiceDay(e.target.value)}/></label>
   {view==='generate'?<PreshiftPostGenerator postText={body} key={'generator-'+builderKey} location={location} date={date} disabled={saving||uploading} onBusy={setGenerating} onUse={generated=>{if(body.trim()&&!window.confirm('Replace the current post title and wording with this generated draft?'))return false;setTitle(generated.title);setBody(generated.body);setFormError('');setNotice('Generated draft added. Review before saving or publishing.');navigate('/preshift/write');return true}}/>:<AccessSection page="posts" section="builder"><PreshiftPresetBuilder key={builderKey} location={location} date={date} disabled={saving||uploading||generating} onInsert={text=>{const next=[body.trim(),text].filter(Boolean).join('\n\n');if(next.length>12000)throw new Error('These +ADDs exceed the 12,000-character post limit. Shorten the +ADDs or the post first.');setBody(next);setFormError('');setNotice('Preset wording added to your post. Review before publishing.');navigate('/preshift/write')}} /></AccessSection>}
  </section>}
  {view==='drafts'&&access.manager&&location&&<PreshiftDrafts location={location} refresh={refresh} disabled={saving||uploading||generating} onEdit={item=>void resumeDraft(item)} onChange={()=>setRefresh(v=>v+1)} onPublished={()=>{setNotice('Post published.');setRefresh(v=>v+1);navigate('/preshift')}}/>}
  {view==='feed'&&reads.error&&<p data-design-block="copy.661fa37c9faf5162.4" role="alert"><PageWord id="copy.fe89fad625458008.1">Read receipts: </PageWord>{reads.error} <button data-design-block="copy.8c44df52baae29ca.1" type="button" onClick={reads.reload}><PageWord id="copy.26436eb453620487.1">Retry</PageWord></button></p>}
  {archive&&<PreshiftArchive location={location}/>}
  {view==='feed'&&<>
  {loading && <p data-design-block="copy.f365d770b3e83532.3" role="status"><ScreenText id="PreshiftFeedPage.556bf6b828d8489e">Loading feed…</ScreenText></p>}{!loading && !error && posts.length===0 && <p data-design-block="copy.810e8272d4819441.5"><ScreenText id="PostsFeed.empty">No posts yet.</ScreenText></p>}
  <p role="status">{posts.length} published post{posts.length===1?'':'s'} loaded.</p>
  {requestedPost&&!loading&&!error&&!posts.some(p=>p.id===requestedPost)&&<p role="alert">This post is not in the feed response. It may have been removed or its audience or location may differ.</p>}
  {posts.map(post=><article id={'feed-post-'+post.id} data-design-block="copy.dcb850761b22206a.1" className="feed-card" key={post.id} style={postStyle(post.presentation)}>{post.pinned && <p data-design-block="copy.2c3383537b7aa671.2" className="eyebrow"><ScreenText id="PreshiftFeedPage.c57b262f53318483">Pinned</ScreenText></p>}<p data-design-block="copy.702c4c060fd0e15d.1" className="feed-meta"><ScreenText id="PostsFeed.date">Post · </ScreenText>{day(post.shift_date)}</p><h2 data-design-block="copy.4b65e4f808844007.1" style={{color:postColors[post.presentation?.title ?? "brown"]?.ink,fontFamily:appFonts[post.presentation?.titleFont??"system"]?.css}}>{post.title}</h2><p data-design-block="copy.2e5f65ad751e2a76.1" className="feed-body" style={{color:postColors[post.presentation?.text ?? "brown"]?.ink,fontFamily:appFonts[post.presentation?.textFont??"system"]?.css}}>{post.body}</p><PreshiftMinuteRule location={location} postId={post.id}/><PostMedia assets={post.media??[]} /><PreshiftOpenTracker location={location} postId={post.id} version={post.version} source="feed"/><AccessSection page="posts" section="receipts"><PreshiftReadReceipt location={location} postId={post.id} version={post.version} status={reads.rows[post.id]} manager={reads.manager} onChange={reads.reload}/></AccessSection><AccessSection page="posts" section="discussion"><PostDiscussion location={location} postId={post.id}/></AccessSection><p data-design-block="copy.702c4c060fd0e15d.2" className="feed-meta"><ScreenText id="PreshiftFeedPage.1e6fff57198154b6">Posted by </ScreenText>{post.author}<PageWord id="copy.e5311f33d5c752bd.1">· </PageWord>{stamp(post.created_at)}<ScreenText id="PreshiftFeedPage.46c613c9e74f96b8"> CT</ScreenText>{post.version>1 && <><ScreenText id="PreshiftFeedPage.c8bacbc661d5f322"> · Edited </ScreenText>{stamp(post.updated_at)}<ScreenText id="PreshiftFeedPage.996abd7b978793c1"> CT</ScreenText></>}</p>
   {access.manager && <div data-design-block="copy.ecf01b60090e7c90.4" className="feed-actions"><button data-design-block="copy.364a94b08b14e4e2.1" disabled={saving||uploading||generating} onClick={()=>void start(post)}><ScreenText id="PreshiftFeedPage.25c4d03e2c2c91c8">Edit post</ScreenText></button><button data-design-block="copy.57ba8065c73d73d4.1" disabled={saving||uploading||generating} onClick={()=>void remove(post)}><ScreenText id="PreshiftFeedPage.8cef789752aceade">Remove post</ScreenText></button></div>}
   {access.gm && <PostNotificationControl location={location} category="preshift" objectId={post.id} version={post.version} serviceDate={post.shift_date}/>}
  </article>)}
  {total>posts.length && limit<1000 && <button data-design-block="copy.9813f5b5f88f9ba8.1" onClick={()=>setLimit(v=>Math.min(1000,v+50))}><ScreenText id="PreshiftFeedPage.81a21a22be59bc9e">Load older posts</ScreenText></button>}{limit>=1000 && total>1000 && <p data-design-block="copy.810e8272d4819441.6"><ScreenText id="PreshiftFeedPage.c130725dc596fd00">Showing the latest 1,000 posts.</ScreenText></p>}
  {updated && <p data-design-block="copy.702c4c060fd0e15d.3" className="feed-meta"><ScreenText id="PreshiftFeedPage.696d486f4fa2510d">Updated </ScreenText>{updated}<ScreenText id="PreshiftFeedPage.0738782d960aed1b"> CT · Checks for new posts every 15 seconds while this page is open.</ScreenText></p>}
 </>}
 </section>
}
