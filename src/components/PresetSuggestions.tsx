import { useEffect, useRef, useState } from 'react'
export type PresetSuggestion={key:string;title:string;category:string;body:string}
export function presetsFromPost(text:string):PresetSuggestion[]{
 const chunks:string[]=[]
 for(const paragraph of text.replace(/\r\n?/g,'\n').trim().split(/\n\s*\n/)){
  let current='';for(const line of paragraph.split('\n')){if(current&&current.length+line.length+1>3900){chunks.push(current);current=''}for(let offset=0;offset<line.length;offset+=3900){const part=line.slice(offset,offset+3900);if(current.length+part.length+1>3900){chunks.push(current);current=''}current+=(current?'\n':'')+part}}if(current.trim())chunks.push(current.trim())
 }
 return chunks.map((body,index)=>{const first=body.split('\n')[0].trim(),title=(first.length<=100?first:first.slice(0,97)+'…')||'Post section '+(index+1);const category=/uniform|vest|hair|black pants/i.test(body)?'uniform':/hours|opening time|closing time|brunch.*\d|happy hour.*\d/i.test(first)?'hours':/special|feature|taco|dessert|cocktail/i.test(first)?'specials':'service';return {key:String(index),title,category,body}})
}
const presetKey=(p:PresetSuggestion)=>JSON.stringify([p.title.trim(),p.category,p.body.trim()])
export function PresetSuggestions({postText,disabled,onReview,onSave}:{postText:string;disabled:boolean;onReview:(preset:PresetSuggestion,savedId?:string)=>void;onSave:(preset:PresetSuggestion)=>Promise<string>}){
 const [drafts,setDrafts]=useState<PresetSuggestion[]>([]),[message,setMessage]=useState(''),[saved,setSaved]=useState<Record<string,string>>({}),[errors,setErrors]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[savingKey,setSavingKey]=useState('')
 const active=useRef(true)
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 const lock=useRef(false),savedRef=useRef<Record<string,string>>({})
 const locked=disabled||busy
 async function saveSections(sections:PresetSuggestion[]){
  if(disabled||lock.current)return
  lock.current=true;setBusy(true);setMessage('');let count=0,failed=0
  try{for(const p of sections){if(!active.current)break;const key=presetKey(p);if(savedRef.current[key])continue
   setSavingKey(key);setErrors(v=>{const next={...v};delete next[key];return next})
   try{const id=await onSave(p);savedRef.current={...savedRef.current,[key]:id};setSaved(savedRef.current);count++}
   catch(e){failed++;setErrors(v=>({...v,[key]:String((e as {message?:string}).message??e)}))}
  }
  setMessage(count+' preset'+(count===1?'':'s')+' saved.'+(failed?' '+failed+' could not be saved. Retry the sections below.':' Edit them later in your preset library.'))
  }finally{setBusy(false);setSavingKey('');lock.current=false}
 }
 return <section data-design-block="section.368853c0dcdb00fc2b13" className="feed-card"><h4>Save post sections as presets</h4><p>Generate reusable sections, then save one or save them all. They save privately for any day. Edit them whenever you’re ready.</p><button type="button" disabled={locked||!postText.trim()} onClick={()=>{setDrafts(presetsFromPost(postText));setErrors({});setMessage('Sections are ready. Choose Save preset or Save all presets.')}}>Generate presets from post</button>
 {drafts.length>0&&<button type="button" disabled={locked||drafts.every(p=>!!saved[presetKey(p)])} onClick={()=>void saveSections(drafts)}>{busy?'Saving presets…':'Save all presets'}</button>}
 {message&&<p role="status">{message}</p>}
 {drafts.map(p=>{const key=presetKey(p),isSaved=!!saved[key];return <article data-design-block="section.b9c4516cb14636ada39f" className="feed-card" key={p.key}><strong>{p.title}</strong>{isSaved&&<p role="status">Saved to your private preset library.</p>}<details><summary>Read section</summary><p className="feed-body">{p.body}</p></details><div className="feed-actions"><button type="button" disabled={locked||isSaved} onClick={()=>void saveSections([p])}>{savingKey===key?'Saving…':isSaved?'Saved':'Save preset'}</button><button type="button" disabled={locked} onClick={()=>onReview(p,saved[key])}>{isSaved?'Edit saved preset':'Edit section'}</button><button type="button" disabled={locked} onClick={()=>setDrafts(v=>v.filter(x=>x.key!==p.key))}>{isSaved?'Hide section':'Dismiss section'}</button></div>{errors[key]&&<p role="alert">{errors[key]}</p>}</article>})}
 </section>
}
