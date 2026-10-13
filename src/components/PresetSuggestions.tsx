import { useState } from 'react'
export type PresetSuggestion={key:string;title:string;category:string;body:string}
export function presetsFromPost(text:string):PresetSuggestion[]{
 const chunks:string[]=[]
 for(const paragraph of text.replace(/\r\n?/g,'\n').trim().split(/\n\s*\n/)){
  let current='';for(const line of paragraph.split('\n')){if(current&&current.length+line.length+1>3900){chunks.push(current);current=''}for(let offset=0;offset<line.length;offset+=3900){const part=line.slice(offset,offset+3900);if(current.length+part.length+1>3900){chunks.push(current);current=''}current+=(current?'\n':'')+part}}if(current.trim())chunks.push(current.trim())
 }
 return chunks.map((body,index)=>{const first=body.split('\n')[0].trim(),title=(first.length<=100?first:first.slice(0,97)+'…')||'Post section '+(index+1);const category=/uniform|vest|hair|black pants/i.test(body)?'uniform':/hours|opening time|closing time|brunch.*\d|happy hour.*\d/i.test(first)?'hours':/special|feature|taco|dessert|cocktail/i.test(first)?'specials':'service';return {key:String(index),title,category,body}})
}
export function PresetSuggestions({postText,disabled,onReview}:{postText:string;disabled:boolean;onReview:(preset:PresetSuggestion)=>void}){
 const [drafts,setDrafts]=useState<PresetSuggestion[]>([]),[message,setMessage]=useState('')
 return <section className="feed-card"><h4>Generate presets from this post</h4><p>Split the text currently in the Post box into reusable sections. Review each section, choose its visibility, then save it. Dates, names and prices stay exactly as written—edit them if they should be reusable.</p><button type="button" disabled={disabled||!postText.trim()} onClick={()=>{const generated=presetsFromPost(postText);setDrafts(generated);setMessage(generated.length+' preset drafts generated. Nothing has been saved yet.')}}>Generate presets from post</button>{message&&<p role="status">{message}</p>}{drafts.map(p=><article className="feed-card" key={p.key}><strong>{p.title}</strong><details><summary>Read generated section</summary><p className="feed-body">{p.body}</p></details><button type="button" disabled={disabled} onClick={()=>onReview(p)}>Review and save preset</button><button type="button" disabled={disabled} onClick={()=>setDrafts(v=>v.filter(x=>x.key!==p.key))}>Dismiss draft</button></article>)}</section>
}
