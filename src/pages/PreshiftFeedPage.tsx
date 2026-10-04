import { PreshiftSections } from '../components/PreshiftSections'
import { PreshiftArchive } from '../components/PreshiftArchive'
import { PreshiftPresetBuilder } from '../components/PreshiftPresetBuilder'
import { appFonts, type FontName } from '../lib/appearance'
import { PostMedia, type MediaAsset } from '../components/PostMedia'
import './Appearance.css'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { useManagementAccess } from '../components/ManagementAccess'
import './PreshiftFeedPage.css'
import { postColors, type PostColor, postStyle } from '../lib/postStyle'
type Post={id:string;title:string;body:string;shift_date:string;pinned:boolean;version:number;created_at:string;updated_at:string;author:string;presentation?:{title?:PostColor;text?:PostColor;accent?:PostColor;titleFont?:FontName;textFont?:FontName};media?:MediaAsset[]}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const stamp=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value))
const day=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}).format(new Date(value+'T12:00:00Z'))
const message=(e:unknown)=>String((e as {message?:string})?.message ?? e)
export function PreshiftFeedPage(){
 const [archive,setArchive]=useState(false);const access=useManagementAccess();const [location,setLocation]=useState('');const [posts,setPosts]=useState<Post[]>([]);const [total,setTotal]=useState(0)
 const [limit,setLimit]=useState(50);const [refresh,setRefresh]=useState(0);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false)
 const [error,setError]=useState('');const [formError,setFormError]=useState('');const [notice,setNotice]=useState('');const [editing,setEditing]=useState<Post|null>(null)
 const [builderKey,setBuilderKey]=useState(0)
 const [compose,setCompose]=useState(false);const [title,setTitle]=useState('');const [body,setBody]=useState('');const [date,setDate]=useState(today);const [pinned,setPinned]=useState(false)
 const [titleColor,setTitleColor]=useState<PostColor>('brown');const [textColor,setTextColor]=useState<PostColor>('brown');const [accentColor,setAccentColor]=useState<PostColor>('tan');const bodyInput=useRef<HTMLTextAreaElement>(null)
 const [titleFont,setTitleFont]=useState<FontName>('system');const [textFont,setTextFont]=useState<FontName>('system');const [media,setMedia]=useState<MediaAsset[]>([]);const [uploading,setUploading]=useState(false);const pending=useRef<string[]>([])
 async function discardUploads(){const paths=pending.current;pending.current=[];if(paths.length)await supabase.storage.from('preshift-media').remove(paths)}
 async function upload(files:File[]){setUploading(true);setFormError('');try{if(files.length+media.length>6)throw new Error('Use up to 6 photos or videos.');const {data,error}=await supabase.auth.getUser();if(error||!data.user)throw new Error('Sign in again before uploading.');for(const file of Array.from(files)){const types:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};if(!types[file.type])throw new Error('Use JPG, PNG, WebP, GIF, MP4, MOV or WebM.');if(file.size>50*1024*1024)throw new Error('Each attachment must be 50 MB or smaller.');const path=location+'/'+data.user.id+'/'+crypto.randomUUID()+'.'+types[file.type];const r=await supabase.storage.from('preshift-media').upload(path,file,{contentType:file.type,upsert:false});if(r.error)throw r.error;pending.current.push(path);const asset:MediaAsset={path,kind:file.type.startsWith('image/')?'image':'video',name:file.name.slice(0,255),caption:''};setMedia(v=>[...v,asset])}}catch(e){setFormError(message(e))}finally{setUploading(false)}}
 const [updated,setUpdated]=useState('');const editor=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{let active=true;void loadTenantData().then(t=>{if(!t.locations[0])throw new Error('No active location.');if(active)setLocation(t.locations[0].id)}).catch(e=>{if(active){setError(message(e));setLoading(false)}});return()=>{active=false}},[])
 useEffect(()=>{if(!location)return;let active=true;let fetching=false
  const fetchPosts=async()=>{if(fetching)return;fetching=true;try{const r=await supabase.rpc('preshift_feed',{p_location_id:location,p_limit:limit});if(r.error)throw r.error;if(active){setPosts(r.data.posts);setTotal(r.data.total);setUpdated(stamp(new Date().toISOString()));setError('')}}catch(e){if(active)setError(message(e))}finally{fetching=false;if(active)setLoading(false)}}
  const visible=()=>{if(document.visibilityState==='visible')void fetchPosts()}
  void fetchPosts();const timer=setInterval(visible,15000);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible)
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible)}
 },[location,limit,refresh])
 async function start(post:Post|null){if(saving||uploading)return;if(compose && (title.trim() || body.trim()) && !window.confirm('Discard the post you are currently editing?'))return;await discardUploads();setMedia(post?.media??[]);setTitleFont(post?.presentation?.titleFont??'system');setTextFont(post?.presentation?.textFont??'system');setTitleColor(post?.presentation?.title ?? 'brown');setTextColor(post?.presentation?.text ?? 'brown');setAccentColor(post?.presentation?.accent ?? 'tan');setEditing(post);setTitle(post?.title ?? '');setBody(post?.body ?? '');setDate(post?.shift_date ?? today());setPinned(post?.pinned ?? false);setFormError('');setNotice('');setCompose(true);setBuilderKey(v=>v+1);setTimeout(()=>editor.current?.focus(),0)}
 async function save(){setSaving(true);setFormError('');setNotice('');try{const r=await supabase.rpc('preshift_post_save_full',{p_location_id:location,p_id:editing?.id ?? null,p_version:editing?.version ?? null,p_title:title,p_body:body,p_shift_date:date,p_pinned:pinned,p_presentation:{title:titleColor,text:textColor,accent:accentColor,titleFont,textFont},p_media:media});if(r.error)throw r.error;pending.current=[];setCompose(false);setEditing(null);setNotice(editing?'Post updated.':'Post published.');setRefresh(v=>v+1)}catch(e){setFormError(message(e))}finally{setSaving(false)}}
 async function remove(post:Post){if(!window.confirm('Remove "'+post.title+'" from the feed?'))return;setSaving(true);setNotice('');try{const r=await supabase.rpc('preshift_post_remove',{p_location_id:location,p_id:post.id,p_version:post.version});if(r.error)throw r.error;setNotice('Post removed.');if(editing?.id===post.id)setCompose(false);setRefresh(v=>v+1)}catch(e){setError(message(e))}finally{setSaving(false)}}
 return <section className="preshift-feed"><p className="eyebrow">Team updates</p><h1>Pre-Shift Feed</h1><p>Read your pre-shift updates before taking the daily quiz.</p>
  <div className="feed-actions"><Link to="/quizzes">Take today’s quiz →</Link><button type="button" onClick={()=>setRefresh(v=>v+1)}>Refresh feed</button>{access.manager && <button type="button" className="primary-button" disabled={saving || uploading || !location} onClick={()=>void start(null)}>New post</button>}</div>
  {access.error && <p role="alert">{access.error}</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  {compose && access.manager && <form className="feed-card feed-editor" onSubmit={e=>{e.preventDefault();void save()}}><h2 ref={editor} tabIndex={-1}>{editing?'Edit post':'New pre-shift post'}</h2>
   <label>Shift date<input type="date" required value={date} disabled={saving||uploading} onChange={e=>setDate(e.target.value)} /></label><p>Posts appear immediately. The shift date tells staff which shift this update is for.</p>
   <PreshiftPresetBuilder key={builderKey} location={location} date={date} disabled={saving||uploading} onInsert={text=>{const next=[body.trim(),text].filter(Boolean).join('\n\n');if(next.length>12000)throw new Error('These chunks exceed the 12,000-character post limit. Shorten the chunks or the post first.');setBody(next);setFormError('')}} />
   <label>Title<input required maxLength={160} value={title} disabled={saving||uploading} onChange={e=>setTitle(e.target.value)} /></label>
   <div className="post-color-tools">{([['Title color',titleColor,setTitleColor],['Text color',textColor,setTextColor],['Card accent',accentColor,setAccentColor]] as const).map(([label,value,setter])=><label key={label}>{label}<select value={value} disabled={saving||uploading} onChange={e=>setter(e.target.value as PostColor)}>{Object.entries(postColors).map(([key,c])=><option key={key} value={key}>{c.label}</option>)}</select></label>)}</div>
   <div className="post-color-tools">{([['Title font',titleFont,setTitleFont],['Post font',textFont,setTextFont]] as const).map(([label,value,setter])=><label key={label}>{label}<select value={value} disabled={saving||uploading} onChange={e=>setter(e.target.value as FontName)}>{Object.entries(appFonts).map(([key,font])=><option key={key} value={key}>{font.label}</option>)}</select></label>)}</div>
   <div className="emoji-tools" aria-label="Add an emoji to the post">{['✨','🍸','🥂','🍽️','🔥','🎉','💋','✅','🚨','🤝','⏰','📣','🦞','🌮'].map(emoji=><button type="button" key={emoji} disabled={saving||uploading} aria-label={'Insert '+emoji} onClick={()=>{const input=bodyInput.current;const start=input?.selectionStart ?? body.length;const end=input?.selectionEnd ?? start;setBody(v=>(v.slice(0,start)+emoji+v.slice(end)).slice(0,12000));requestAnimationFrame(()=>{input?.focus();input?.setSelectionRange(start+emoji.length,start+emoji.length)})}}>{emoji}</button>)}</div>
   <PreshiftSections location={location} date={date} disabled={saving||uploading} onInsert={text=>{const next=[body.trim(),text.trim()].filter(Boolean).join('\n\n');if(next.length>12000)throw Error('Post is too long. Shorten it before inserting sections.');setBody(next)}}/>
   <label>Post<textarea ref={bodyInput} required maxLength={12000} rows={8} value={body} disabled={saving||uploading} onChange={e=>setBody(e.target.value)} placeholder="Today’s specials, service priorities, menu notes, and team reminders…" /></label>
   <label>Photos and videos<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" disabled={saving||uploading||media.length>=6} onChange={e=>{if(e.target.files)void upload(Array.from(e.target.files));e.target.value=''}} /></label><p>Up to 6 attachments · 50 MB each. Videos play when staff tap Play.</p>{uploading&&<p role="status">Uploading attachment…</p>}
   {media.map(a=><div className="media-edit-row" key={a.path}><span>{a.name}</span><label>Caption<input value={a.caption} maxLength={500} disabled={saving||uploading} onChange={e=>setMedia(v=>v.map(x=>x.path===a.path?{...x,caption:e.target.value}:x))} /></label><button type="button" disabled={saving||uploading} onClick={()=>setMedia(v=>v.filter(x=>x.path!==a.path))}>Remove attachment</button></div>)}<PostMedia assets={media} />
   <details className="post-preview"><summary>Preview post</summary><article className="feed-card" style={postStyle({accent:accentColor})}><h2 style={{color:postColors[titleColor].ink,fontFamily:appFonts[titleFont].css}}>{title || "Your title"}</h2><p className="feed-body" style={{color:postColors[textColor].ink,fontFamily:appFonts[textFont].css}}>{body || "Your pre-shift message will appear here."}</p></article></details>
   <label className="feed-check"><input type="checkbox" checked={pinned} disabled={saving||uploading} onChange={e=>setPinned(e.target.checked)} />Pin to the top</label>
   {formError && <p role="alert">{formError}</p>}<div className="feed-actions"><button className="primary-button" disabled={saving || uploading || !title.trim() || !body.trim()}>{saving?'Saving…':editing?'Save changes':'Publish post'}</button><button type="button" disabled={saving||uploading} onClick={()=>{void discardUploads();setCompose(false)}}>Cancel</button></div>
  </form>}
  <button type="button" onClick={()=>setArchive(v=>!v)}>{archive?'Back to feed':'Search past pre-shifts'}</button>
  {archive&&<PreshiftArchive location={location}/>}
  {!archive&&<>
  {loading && <p role="status">Loading feed…</p>}{!loading && !error && posts.length===0 && <p>No pre-shift posts yet.</p>}
  {posts.map(post=><article className="feed-card" key={post.id} style={postStyle(post.presentation)}>{post.pinned && <p className="eyebrow">Pinned</p>}<p className="feed-meta">Pre-Shift · {day(post.shift_date)}</p><h2 style={{color:postColors[post.presentation?.title ?? "brown"]?.ink,fontFamily:appFonts[post.presentation?.titleFont??"system"]?.css}}>{post.title}</h2><p className="feed-body" style={{color:postColors[post.presentation?.text ?? "brown"]?.ink,fontFamily:appFonts[post.presentation?.textFont??"system"]?.css}}>{post.body}</p><PostMedia assets={post.media??[]} /><div className="feed-actions"><Link className="primary-button" to="/quizzes">Take the pre-shift quiz →</Link></div><p className="feed-meta">Posted by {post.author} · {stamp(post.created_at)} CT{post.version>1 && <> · Edited {stamp(post.updated_at)} CT</>}</p>
   {access.manager && <div className="feed-actions"><button disabled={saving||uploading} onClick={()=>void start(post)}>Edit post</button><button disabled={saving||uploading} onClick={()=>void remove(post)}>Remove post</button></div>}
  </article>)}
  {total>posts.length && limit<1000 && <button onClick={()=>setLimit(v=>Math.min(1000,v+50))}>Load older posts</button>}{limit>=1000 && total>1000 && <p>Showing the latest 1,000 posts.</p>}
  {updated && <p className="feed-meta">Updated {updated} CT · Checks for new posts every 15 seconds while this page is open.</p>}
 </>}
 </section>
}



