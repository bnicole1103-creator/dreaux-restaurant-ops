import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
export type DesignChange={text?:string;hidden?:boolean;x?:number;y?:number;order?:number;parent?:string}
export type Design={version:number;changes:Record<string,DesignChange>}
let current:Design={version:0,changes:{}}
const subscribers=new Set<()=>void>()
const subscribe=(fn:()=>void)=>{subscribers.add(fn);return()=>{subscribers.delete(fn)}}
export function setPageDesign(value:Design){current=value;subscribers.forEach(fn=>fn())}
export function PageWord({id:baseId,children,instance=false}:{id:string;children:ReactNode;instance?:boolean}){
 const design=useSyncExternalStore(subscribe,()=>current,()=>current)
 const id=instance?baseId+'.v'+Array.from(String(children)).reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619)>>>0,2166136261).toString(16):baseId
 const change=design.changes[id],preview=new URLSearchParams(window.location.search).has('wording-preview')
 if(change?.hidden&&!preview)return null
 return <span data-design-word={id} data-design-hidden={change?.hidden?'true':undefined} style={{display:change?.x||change?.y?'inline-block':undefined,position:change?.x||change?.y?'relative':undefined,left:change?.x||undefined,top:change?.y||undefined,opacity:change?.hidden ? .4 : undefined}}>{typeof (change?.text??children)==='string'?String(change?.text??children).split(/(\s+)/).map((word,index)=>{if(!word.trim())return word;const tokenId=id+'.w'+index,token=design.changes[tokenId];if(token?.hidden&&!preview)return null;return <span key={tokenId} data-design-word={tokenId} style={{display:token?.x||token?.y?'inline-block':undefined,position:token?.x||token?.y?'relative':undefined,left:token?.x||undefined,top:token?.y||undefined,opacity:token?.hidden ? .4 : undefined}}>{token?.text??word}</span>}):change?.text??children}</span>
}
export function PageDesignLoader(){
 const {pathname}=useLocation(),[design,setDesign]=useState<Design>({version:0,changes:{}})
 useEffect(()=>{let live=true,seq=0;setPageDesign({version:0,changes:{}});setDesign({version:0,changes:{}})
 async function refresh(){const ticket=++seq;try{const guest=pathname.match(/^\/(walk-in|guest-feedback)\/([0-9a-f-]{36})$/i);let result
 if(guest)result=await supabase.rpc('page_design_public',{p_key:guest[2],p_kind:guest[1],p_page:pathname.replace(guest[2],':key')})
 else{const session=await supabase.auth.getSession();if(!session.data.session)return;const tenant=await loadTenantData();const id=tenant.locations[0]?.id;if(!id)return;result=await supabase.rpc('page_design_load',{p_location_id:id,p_page:pathname})}
 if(!result.error&&live&&ticket===seq){setPageDesign(result.data);setDesign(result.data)}}catch{/* Keep the original screen when customization is unavailable. */}}
 void refresh();const timer=setInterval(()=>void refresh(),30000);const focus=()=>void refresh();window.addEventListener('focus',focus);const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{seq++;setPageDesign({version:0,changes:{}});setDesign({version:0,changes:{}});void refresh()})
 return()=>{live=false;seq++;clearInterval(timer);window.removeEventListener('focus',focus);subscription.unsubscribe()}},[pathname])
 let css='';const preview=new URLSearchParams(window.location.search).has('wording-preview')
 for(const [id,value] of Object.entries(design.changes)){if(!/^[A-Za-z0-9_.-]+$/.test(id))continue;const selector='[data-design-block="'+id+'"]';if(value.hidden)css+=selector+'{'+(preview?'opacity:.4;':'display:none!important;')+'}';if(value.order!==undefined&&value.parent&&/^[A-Za-z0-9_.-]+$/.test(value.parent)){css+='[data-design-block="'+value.parent+'"]{display:flex!important;flex-direction:column!important;}'+selector+'{order:'+value.order+'!important;}'}if(value.x||value.y)css+=selector+'{position:relative;left:'+(value.x??0)+'px;top:'+(value.y??0)+'px;}'}
 return <style>{css}</style>
}

export function PageInput({designId,...props}:import('react').InputHTMLAttributes<HTMLInputElement>&{designId:string}){
 const design=useSyncExternalStore(subscribe,()=>current,()=>current),change=design.changes[designId]
 return <input {...props} data-design-word={designId} placeholder={change?.hidden?'':change?.text??props.placeholder}/>
}
export function PageOption({designId,children,...props}:import('react').OptionHTMLAttributes<HTMLOptionElement>&{designId:string}){
 const design=useSyncExternalStore(subscribe,()=>current,()=>current),change=design.changes[designId]
 const original=(node:ReactNode):string=>{if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(original).join('');if(typeof node==='object'&&'props' in node)return original((node.props as {children?:ReactNode}).children);return ''}
 return <option {...props} value={props.value??original(children).replace(/\s+/g,' ').trim()} data-design-word={designId} hidden={change?.hidden||props.hidden}>{change?.text??children}</option>
}
