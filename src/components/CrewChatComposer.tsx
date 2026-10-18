import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {crewMediaBucket,crewMediaTypes,crewMediaAccept,validateCrewFiles,type CrewMediaAsset} from '../lib/crewMedia'
import {responseStyle,bubbleStyle,type ChatWallStyle} from '../lib/chatWallStyle'
import './CrewChatMedia.css'
type Draft={id:string;file:File;url:string}
type Props={location:string;date:string;style:ChatWallStyle;disabled:boolean;nameReady:boolean;onSent:()=>void;onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void}
export function CrewChatComposer({location,date,style,disabled,nameReady,onSent,onDirty,onBusy}:Props){
 const [body,setBody]=useState(''),[files,setFiles]=useState<Draft[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[phase,setPhase]=useState('')
 const input=useRef<HTMLInputElement>(null),box=useRef<HTMLTextAreaElement>(null),lock=useRef(false),alive=useRef(true),draftFiles=useRef<Draft[]>([]),callbacks=useRef({onSent,onDirty,onBusy})
 callbacks.current={onSent,onDirty,onBusy};draftFiles.current=files
 const attempt=useRef<{id:string;key:string;paths:Map<string,string>}|null>(null)
 async function cleanup(paths:string[]){if(paths.length)try{await supabase.storage.from(crewMediaBucket).remove(paths)}catch{/* Linked, sent media stays protected by storage policy. */}}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;for(const f of draftFiles.current)URL.revokeObjectURL(f.url);void cleanup([...(attempt.current?.paths.values()??[])]);callbacks.current.onDirty(false);callbacks.current.onBusy(false)}},[])
 useEffect(()=>{callbacks.current.onDirty(!!body.trim()||files.length>0)},[body,files])
 function addFiles(selected:File[]){try{validateCrewFiles(selected,files.length);setFiles(v=>[...v,...selected.map(file=>({id:crypto.randomUUID(),file,url:URL.createObjectURL(file)}))]);setError('')}catch(e){setError(String((e as Error).message))}}
 function emoji(value:string){const start=box.current?.selectionStart??body.length,end=box.current?.selectionEnd??body.length;const next=body.slice(0,start)+value+body.slice(end);if(next.length>2000)return;setBody(next);requestAnimationFrame(()=>{box.current?.focus();box.current?.setSelectionRange(start+value.length,start+value.length)})}
 async function send(){
  if(lock.current||disabled||!nameReady||!body.trim()&&!files.length)return
  lock.current=true;setBusy(true);callbacks.current.onBusy(true);setError('')
  const key=JSON.stringify([body.trim(),files.map(f=>f.id)])
  try{
   const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)throw Error('Sign in again before sending.')
   if(attempt.current?.key!==key){void cleanup([...(attempt.current?.paths.values()??[])]);attempt.current={id:crypto.randomUUID(),key,paths:new Map()}}
   const request=attempt.current!,assets:CrewMediaAsset[]=[]
   for(const [index,item] of files.entries()){
    if(!alive.current)return
    setPhase('Uploading '+(index+1)+' of '+files.length+'…')
    let path=request.paths.get(item.id)
    if(!path){path=location+'/'+user.id+'/'+request.id+'/'+crypto.randomUUID()+'.'+crewMediaTypes[item.file.type]
     const r=await supabase.storage.from(crewMediaBucket).upload(path,item.file,{contentType:item.file.type,upsert:false});if(r.error)throw r.error;if(!alive.current){void cleanup([path]);return}request.paths.set(item.id,path)
    }
    assets.push({path,kind:item.file.type.startsWith('image/')?'image':'video',name:item.file.name.slice(0,180)||'Attachment'})
   }
   if(!alive.current)return
   setPhase('Sending…');const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000)
   try{const r=await supabase.rpc('crew_message_send_media',{p_location_id:location,p_date:date,p_request:request.id,p_body:body.trim(),p_media:assets}).abortSignal(controller.signal);if(r.error)throw r.error}finally{clearTimeout(timer)}
   attempt.current=null
   if(alive.current){for(const f of files)URL.revokeObjectURL(f.url);setFiles([]);setBody('');callbacks.current.onDirty(false);window.dispatchEvent(new Event('crew-chat-updated'));callbacks.current.onSent()}
  }catch(e){if(alive.current)setError(String((e as {message?:string})?.message??'Send was not confirmed. Retry to check the same message.'))}
  finally{lock.current=false;if(alive.current){setBusy(false);setPhase('');callbacks.current.onBusy(false)}}
 }
 return <form className="crew-composer" onSubmit={e=>{e.preventDefault();void send()}}>
  <label>Message the crew<textarea ref={box} style={{...responseStyle(style),...bubbleStyle(style),color:responseStyle(style).color}} maxLength={2000} rows={2} placeholder="Write a message or add photos and videos…" value={body} disabled={busy||disabled} onChange={e=>setBody(e.target.value)}/></label>
  <input ref={input} className="crew-file-input" type="file" multiple accept={crewMediaAccept} aria-label="Choose chat photos or videos" disabled={busy||disabled||!nameReady} onChange={e=>{addFiles(Array.from(e.target.files??[]));e.target.value=''}}/>
  <button type="button" disabled={busy||disabled||!nameReady||files.length>=6} onClick={()=>input.current?.click()}>Add photos / videos</button><small>Up to 6 attachments · 50 MB each</small>
  {files.length>0&&<div className="crew-draft-media">{files.map((f,i)=><figure key={f.id}>{f.file.type.startsWith('image/')?<img src={f.url} alt={f.file.name}/>:<video src={f.url} controls playsInline preload="metadata" aria-label={f.file.name}/>}<figcaption>{f.file.name}</figcaption><button type="button" aria-label={'Remove attachment '+(i+1)} disabled={busy||disabled} onClick={()=>{URL.revokeObjectURL(f.url);setFiles(v=>v.filter(x=>x.id!==f.id))}}>Remove</button></figure>)}</div>}
  <div className="wall-emoji-bar" aria-label="Add an emoji">{['✨','😊','🥂','💛','🎉','💪','🙌','😂','🔥','🤝'].map(v=><button type="button" key={v} disabled={busy||disabled} aria-label={'Add '+v} onClick={()=>emoji(v)}>{v}</button>)}</div>
  {error&&<p role="alert">{error} Your draft is kept for retry.</p>}{phase&&<p role="status">{phase}</p>}
  <div><small>{body.length}/2000</small><button type="submit" disabled={busy||disabled||!nameReady||!body.trim()&&!files.length}>{busy?'Sending…':'Send message ↗'}</button></div>
 </form>
}
