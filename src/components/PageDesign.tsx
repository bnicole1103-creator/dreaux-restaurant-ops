import {managementWording} from '../lib/managementWording'
import {mergeStaffChanges,staffLayoutPreview} from '../lib/staffLayout'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadTenantData } from '../lib/tenant'
import { blockedPreviewEvents,editorPreviewActive,preventPreviewDefault } from '../lib/screenEditorSelection'
// Install before the preview app mounts. The parent editor captures at window.
if(typeof window!=='undefined'&&editorPreviewActive(window.location.search,window.parent!==window)){
 const blockPreviewAction=(event:Event)=>{if(event.cancelable&&preventPreviewDefault(event.type))event.preventDefault();event.stopImmediatePropagation()}
 blockedPreviewEvents.forEach(type=>document.addEventListener(type,blockPreviewAction,{capture:true,passive:false}))
}
import type {FontName} from '../lib/appearance'
import {designCss,syncOrderHosts,validId,ensureElementIds} from '../lib/pageEditor'
export type DesignChange={offsetX?:number;offsetY?:number;width?:number;minHeight?:number;iconSize?:number;presentation?:'inline'|'collapse'|'popup';panelTitle?:string;defaultOpen?:boolean;color?:string;background?:string;borderColor?:string;fontSize?:number;align?:'left'|'center'|'right';kind?:'note'|'link';title?:string;href?:string;linkLabel?:string;font?:FontName;text?:string;hidden?:boolean;x?:number;y?:number;order?:number;parent?:string}
export type Design={version:number;changes:Record<string,DesignChange>}
let current:Design={version:0,changes:{}}
const subscribers=new Set<()=>void>()
const subscribe=(fn:()=>void)=>{subscribers.add(fn);return()=>{subscribers.delete(fn)}}
export function usePageDesign(){return useSyncExternalStore(subscribe,()=>current,()=>current)}
export function setPageDesign(value:Design){current=value;subscribers.forEach(fn=>fn())}
export function PageWord({id:baseId,children,instance=false}:{id:string;children:ReactNode;instance?:boolean}){
 const design=useSyncExternalStore(subscribe,()=>current,()=>current)
 const id=instance?baseId+'.v'+Array.from(String(children)).reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619)>>>0,2166136261).toString(16):baseId
 children=typeof children==='string'?managementWording(children):children
 const change=design.changes[id],preview=(new URLSearchParams(window.location.search).has('wording-preview')||staffLayoutPreview())
 if(change?.hidden&&!preview)return null
 return <span data-design-word={id} data-design-hidden={change?.hidden?'true':undefined} style={{display:change?.x||change?.y?'inline-block':undefined,position:change?.x||change?.y?'relative':undefined,left:change?.x||undefined,top:change?.y||undefined,opacity:change?.hidden ? .4 : undefined}}>{typeof (change?.text??children)==='string'?managementWording(String(change?.text??children)).split(/(\s+)/).map((word,index)=>{if(!word.trim())return word;const tokenId=id+'.w'+index,token=design.changes[tokenId];if(token?.hidden&&!preview)return null;return <span key={tokenId} data-design-word={tokenId} style={{display:token?.x||token?.y?'inline-block':undefined,position:token?.x||token?.y?'relative':undefined,left:token?.x||undefined,top:token?.y||undefined,opacity:token?.hidden ? .4 : undefined}}>{token?.text??word}</span>}):change?.text??children}</span>
}
export function PageDesignLoader(){
 const {pathname}=useLocation(),[design,setDesign]=useState<Design>({version:0,changes:{}})
 const baseRef=useRef<Design>({version:0,changes:{}}),layersRef=useRef<{all:Record<string,DesignChange>;role:Record<string,DesignChange>}>({all:{},role:{}}),draftRef=useRef<{scope:string;changes:Record<string,DesignChange>}|null>(null)
 const editorDraft=useRef<Design|null>(null)
 function applyStaff(){const l=layersRef.current,d=draftRef.current;const merged={...baseRef.current,changes:mergeStaffChanges(baseRef.current.changes,d?.scope==='all'?d.changes:l.all,d&&d.scope!=='all'?d.changes:l.role,editorDraft.current?.changes??{})};setPageDesign(merged);setDesign(merged)}
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(!editorPreviewActive(window.location.search,window.parent!==window)||event.source!==window.parent||event.origin!==window.location.origin||event.data?.type!=='page-editor-draft'||event.data.page!==pathname)return;editorDraft.current=event.data.design;applyStaff()};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[pathname])
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(!staffLayoutPreview()||event.source!==window.parent||event.origin!==window.location.origin||event.data?.type!=='staff-layout-draft')return;draftRef.current={scope:event.data.scope,changes:event.data.changes};applyStaff()};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[pathname])
 useEffect(()=>{editorDraft.current=null;let live=true,seq=0;setPageDesign({version:0,changes:{}});setDesign({version:0,changes:{}})
 async function refresh(){const ticket=++seq;try{const guest=pathname.match(/^\/(walk-in|guest-feedback)\/([0-9a-f-]{36})$/i);let result
 if(guest)result=await supabase.rpc('page_design_public',{p_key:guest[2],p_kind:guest[1],p_page:pathname.replace(guest[2],':key')})
 else{const session=await supabase.auth.getSession();if(!session.data.session)return;const tenant=await loadTenantData();const id=tenant.locations[0]?.id;if(!id)return;result=await supabase.rpc('page_design_load',{p_location_id:id,p_page:pathname});const scoped=await supabase.rpc('staff_layout_load',{p_location_id:id,p_page:pathname});layersRef.current=scoped.error?{all:{},role:{}}:scoped.data}
 if(!result.error&&live&&ticket===seq){baseRef.current=result.data;applyStaff()}}catch{/* Keep the original screen when customization is unavailable. */}}
 void refresh();const timer=setInterval(()=>void refresh(),30000);const focus=()=>void refresh();window.addEventListener('focus',focus);const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{seq++;setPageDesign({version:0,changes:{}});setDesign({version:0,changes:{}});void refresh()})
 return()=>{live=false;seq++;clearInterval(timer);window.removeEventListener('focus',focus);subscription.unsubscribe()}},[pathname])
 const [depths,setDepths]=useState<Record<string,number>>({})
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>|undefined;const measure=()=>{const next:Record<string,number>={};for(const id of Object.keys(design.changes)){if(!validId(id))continue;let node=document.querySelector('[data-design-block="'+id+'"],[data-design-word="'+id+'"]'),n=0;while(node){n++;node=node.parentElement}next[id]=n}setDepths(old=>JSON.stringify(old)===JSON.stringify(next)?old:next)};measure();const observer=new MutationObserver(()=>{if(timer)clearTimeout(timer);timer=setTimeout(measure,40)});observer.observe(document.body,{childList:true,subtree:true});return()=>{observer.disconnect();if(timer)clearTimeout(timer)}},[design.changes])
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined
  const apply=()=>{ensureElementIds(document);syncOrderHosts(document,design.changes)}
  apply()
  const observer=new MutationObserver(()=>{if(timer)clearTimeout(timer);timer=setTimeout(apply,40)})
  observer.observe(document.body,{childList:true,subtree:true})
  return()=>{observer.disconnect();if(timer)clearTimeout(timer);document.querySelectorAll('[data-design-order-flow]').forEach(n=>n.removeAttribute('data-design-order-flow'))}
 },[design.changes])
 const preview=editorPreviewActive(window.location.search,window.parent!==window)||staffLayoutPreview()
 const depth=(id:string)=>depths[id]??0
 return <style>{designCss(design.changes,preview,depth)}</style>
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
