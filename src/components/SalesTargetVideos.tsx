import {TrackedVideo} from './TrackedVideo'
import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {targetVideoBucket,targetVideoFile} from '../lib/targetVideo'
import {DesignSection} from './DesignSection'
import './SalesTargetVideos.css'
type Clip={id:string;title:string;caption:string;path:string;version:number}
type Draft={id:string;title:string;caption:string;path:string;version:number;file:File|null}
const message=(e:unknown)=>String((e as {message?:string})?.message||'Unable to update sales coaching clips. Please retry.')
export function SalesTargetVideos({location,compact=false}:{location:string;compact?:boolean}){
 const [clips,setClips]=useState<Clip[]>([]),[canManage,setCanManage]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[draft,setDraft]=useState<Draft|null>(null)
 const [urls,setUrls]=useState<Record<string,string>>({}),[mediaError,setMediaError]=useState(''),[failed,setFailed]=useState<Record<string,boolean>>({})
 const [selected,setSelected]=useState('')
 const lock=useRef(false),live=useRef(true),uploaded=useRef('')
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 useEffect(()=>{let active=true;setLoading(true);setError('')
  void (async()=>{try{const r=await supabase.rpc('sales_target_clips_load',{p_location_id:location});if(r.error)throw r.error;if(active){setClips(r.data.clips??[]);setCanManage(r.data.can_manage===true)}}catch(e){if(active){setError(message(e));setCanManage(false)}}finally{if(active)setLoading(false)}})()
  return()=>{active=false}
 },[location,refresh])
 const paths=clips.map(c=>c.path).join('|')
 useEffect(()=>{let active=true;setUrls({});setFailed({});setMediaError('')
  async function sign(){if(!clips.length)return;try{const r=await supabase.storage.from(targetVideoBucket).createSignedUrls(clips.map(c=>c.path),3600);if(r.error)throw r.error;if(active){setUrls(Object.fromEntries((r.data??[]).filter(x=>x.signedUrl).map(x=>[x.path!,x.signedUrl!])));setMediaError(r.data?.some(x=>x.error)?'A video could not load. Try reloading the clips.':'')}}catch(e){if(active)setMediaError(message(e))}}
  void sign();const timer=setInterval(()=>void sign(),2700000);const focus=()=>{if(document.visibilityState==='visible')void sign()};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus)
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus)}
 },[paths,refresh])
 async function save(){if(!draft||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('')
  try{let path=draft.path
   if(draft.file){const format=targetVideoFile(draft.file);path=location+'/'+draft.id+'/clip.'+format.extension
    if(uploaded.current!==path){const r=await supabase.storage.from(targetVideoBucket).upload(path,draft.file,{contentType:format.mime,upsert:false});if(r.error)throw r.error;uploaded.current=path}}
   if(!path)throw Error('Choose a video before publishing.')
   const r=await supabase.rpc('sales_target_clip_save',{p_location_id:location,p_id:draft.id,p_version:draft.version,p_title:draft.title.trim(),p_caption:draft.caption,p_path:path});if(r.error)throw r.error
   if(live.current){uploaded.current='';setDraft(null);setNotice('Sales coaching clip published.');setRefresh(v=>v+1)}
  }catch(e){if(live.current)setError(message(e))}finally{lock.current=false;if(live.current)setBusy(false)}
 }
 async function cancel(){if(lock.current)return;lock.current=true;setBusy(true)
  try{if(uploaded.current){const r=await supabase.storage.from(targetVideoBucket).remove([uploaded.current]);if(r.error)throw r.error}uploaded.current='';if(live.current)setDraft(null)}catch(e){if(live.current)setError(message(e))}finally{lock.current=false;if(live.current)setBusy(false)}
 }
 async function remove(clip:Clip){if(lock.current||!window.confirm('Remove “'+clip.title+'” from sales coaching?'))return;lock.current=true;setBusy(true);setError('');setNotice('')
  try{const r=await supabase.rpc('sales_target_clip_remove',{p_location_id:location,p_id:clip.id,p_version:clip.version});if(r.error)throw r.error
   if(live.current){setClips(list=>list.filter(c=>c.id!==clip.id));setNotice('Clip removed.')}
   const clean=await supabase.storage.from(targetVideoBucket).remove([r.data]);if(clean.error&&live.current)setNotice('Clip removed from the page. Its stored video could not be deleted; contact your administrator for storage cleanup.')
  }catch(e){if(live.current)setError(message(e))}finally{lock.current=false;if(live.current)setBusy(false)}
 }
 const activeClip=clips.find(c=>c.id===selected)??clips[0]
 const content=<>
  <div className="target-clips-heading">{!compact&&<h3>Sales coaching clips</h3>}<button type="button" disabled={busy||loading} onClick={()=>setRefresh(v=>v+1)}>Reload clips</button></div>
  {!compact&&<p>Quick tips to help you reach your sales goal.</p>}
  {compact&&clips.length>1&&<label>Choose video<select aria-label="Choose sales coaching video" value={activeClip?.id??''} onChange={e=>setSelected(e.target.value)}>{clips.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
  {loading&&<p role="status">Loading coaching clips…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!loading&&!error&&!clips.length&&<p>No coaching clips posted yet.</p>}
  <div className="target-clips-grid">{clips.filter(c=>!compact||c.id===activeClip?.id).map(clip=><article key={clip.id} data-design-block={'target.clip.'+clip.id}>
   <h4>{clip.title}</h4>{urls[clip.path]?<><TrackedVideo key={clip.id} source="sales" path={clip.path} src={urls[clip.path]} controls playsInline preload="none" aria-label={clip.title} onError={()=>setFailed(v=>({...v,[clip.path]:true}))}/>{failed[clip.path]&&<p role="status">This video format may not play on this device. Try opening it below.</p>}{failed[clip.path]&&<a href={urls[clip.path]} target="_blank" rel="noreferrer">Open video ↗</a>}</>:<p role="status">{mediaError?'Video unavailable. Reload clips to retry.':'Loading video…'}</p>}
   {clip.caption&&<p className="target-clip-caption">{clip.caption}</p>}
   {canManage&&<div className="target-clip-actions"><button type="button" disabled={busy||!!draft} onClick={()=>{uploaded.current='';setError('');setDraft({...clip,file:null})}}>Edit caption / title</button><button type="button" disabled={busy||!!draft} onClick={()=>void remove(clip)}>Remove clip</button></div>}
  </article>)}</div>{mediaError&&<p role="alert">{mediaError}</p>}
  {canManage&&!draft&&<button type="button" disabled={busy} onClick={()=>{uploaded.current='';setError('');setNotice('');setDraft({id:crypto.randomUUID(),title:'',caption:'',path:'',version:0,file:null})}}>Add coaching video</button>}
  {canManage&&draft&&<form className="target-clip-editor" onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}>
   <legend>{draft.version?'Edit coaching clip':'Add coaching video'}</legend>
   <label>Video title<input required maxLength={160} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
   {!draft.version&&<label>Short video<input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={!!uploaded.current} onChange={e=>{const file=e.target.files?.[0];if(!file)return;try{targetVideoFile(file);setError('');setDraft({...draft,file,id:crypto.randomUUID()})}catch(err){setError(message(err));e.target.value='';setDraft({...draft,file:null})}}}/><small>MP4 recommended · MOV or WebM also accepted · up to 50 MB per clip.</small></label>}
   <label>Coaching note or transcript (optional)<textarea rows={3} maxLength={1000} value={draft.caption} onChange={e=>setDraft({...draft,caption:e.target.value})}/></label>
   <div className="target-clip-actions"><button type="submit" disabled={!draft.title.trim()||(!draft.path&&!draft.file)}>{busy?'Saving…':draft.version?'Save clip details':'Publish coaching clip'}</button><button type="button" onClick={()=>void cancel()}>Cancel</button></div>
  </fieldset></form>}
 </>
 if(!compact)return <DesignSection as="section" data-design-block="home.targets.coaching" data-layout-label="Sales coaching clips" className="sales-target-clips" aria-label="Sales coaching clips">{content}</DesignSection>
 return <section data-design-block="home.targets.coaching" data-layout-label="Sales video" className="sales-target-inline" aria-label="Sales coaching clips">{content}</section>
}
