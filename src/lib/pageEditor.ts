import {appFonts} from './appearance'
import type {DesignChange,Design} from '../components/PageDesign'
export type EditorItem={id:string;label:string;parent?:string;groupLabel?:string;movable:boolean;presentable:boolean;words:{id:string;text:string}[]}
export const validId=(id:string)=>/^[A-Za-z0-9_.-]{1,160}$/.test(id)
export const validColor=(value:unknown):value is string=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)
export const safePageLink=(value:unknown):value is string=>typeof value==='string'&&/^\/[A-Za-z0-9/_?=&%.-]*$/.test(value)&&!value.startsWith('//')
/** Keep DOM identity and permission boundaries; change only sibling order. */
export function sectionSiblings(changes:Design['changes'],items:EditorItem[],id:string,visibleOnly=false){
 const selected=items.find(x=>x.id===id)
 if(!selected?.movable||!selected.parent)return []
 return items.filter(x=>x.movable&&x.parent===selected.parent&&(!visibleOnly||!changes[x.id]?.hidden))
  .sort((a,b)=>(changes[a.id]?.order??items.indexOf(a)+1)-(changes[b.id]?.order??items.indexOf(b)+1)||items.indexOf(a)-items.indexOf(b))
}
export function moveSectionTo(changes:Design['changes'],items:EditorItem[],id:string,position:number){
 const siblings=sectionSiblings(changes,items,id),visible=siblings.filter(x=>!changes[x.id]?.hidden)
 const from=visible.findIndex(x=>x.id===id)
 if(from<0||!Number.isInteger(position)||position<0||position>=visible.length||position===from)return changes
 const reordered=[...visible],picked=reordered.splice(from,1)[0];reordered.splice(position,0,picked)
 let i=0;const next={...changes}
 // Hidden siblings keep their slots; every visible item gets an unambiguous rank.
 siblings.map(x=>changes[x.id]?.hidden?x:reordered[i++]).forEach((x,n)=>{next[x.id]={...next[x.id],parent:x.parent,order:n+1};delete next[x.id].x;delete next[x.id].y;next[x.id].offsetX=0;next[x.id].offsetY=0})
 return next
}
export function moveSection(changes:Design['changes'],items:EditorItem[],id:string,direction:number){
 const visible=sectionSiblings(changes,items,id,true),from=visible.findIndex(x=>x.id===id)
 return moveSectionTo(changes,items,id,from+direction)
}
function layoutOwner(node:HTMLElement){
 let parent=node.parentElement
 if(parent?.dataset.designContent==='true'){
  parent=parent.parentElement
  if(parent?.hasAttribute('data-design-dialog'))parent=parent.parentElement
 }
 return parent
}
const layoutRoots=(id:string)=>':is([data-layout-group="'+id+'"],[data-design-block="'+id+'"])'
const layoutHosts=(id:string)=>{const root=layoutRoots(id);return [root,root+'>[data-design-content]',root+'>[data-design-dialog]>[data-design-content]']}
/** Only block/contents hosts need a flex fallback. Existing grids and rows stay intact. */
export function syncOrderHosts(doc:Document,changes:Design['changes']){
 doc.querySelectorAll('[data-design-order-flow]').forEach(n=>n.removeAttribute('data-design-order-flow'))
 const hosts=new Set<HTMLElement>()
 for(const[id,value]of Object.entries(changes)){
  if(!validId(id)||!value.parent||!validId(value.parent)||!Number.isInteger(value.order))continue
  doc.querySelectorAll<HTMLElement>(layoutHosts(value.parent).join(',')).forEach(host=>{
   if(Array.from(host.children).some(n=>(n as HTMLElement).dataset.designBlock===id))hosts.add(host)
  })
 }
 for(const host of hosts){
  // Transparent wrappers share their ancestor's flex/grid formatting context.
  // Giving this wrapper a box traps its children in a separate order group.
  if(host.dataset.layoutTransparent==='true')continue
  const display=doc.defaultView?.getComputedStyle(host).display??''
  if(!['flex','inline-flex','grid','inline-grid'].includes(display))host.setAttribute('data-design-order-flow','true')
 }
}
/** Give otherwise unmarked controls a reproducible identity under their unique static block.
 * Repeated data rows retain their component's record identities; never guess from employee names. */
export function ensureElementIds(doc:Document){
 const original=Array.from(doc.querySelectorAll<HTMLElement>('[data-design-block]:not([data-auto-element])')),counts=new Map<string,number>(),seen=new Map<string,number>()
 original.forEach(n=>counts.set(n.dataset.designBlock!,1+(counts.get(n.dataset.designBlock!)??0)))
 for(const n of Array.from(doc.querySelectorAll<HTMLElement>('button,input:not([type=hidden]):not([type=file]),select,textarea,a[href],img,label'))){
  if((n.dataset.designBlock&&!n.dataset.autoElement)||n.closest('[data-editor-ignore]'))continue
  const owner=n.parentElement?.closest<HTMLElement>('[data-design-block]:not([data-auto-element])'),id=owner?.dataset.designBlock
  if(!id||counts.get(id)!==1)continue
  const semantic=[id,n.tagName,n.getAttribute('type')||'',n.getAttribute('name')||'',n.getAttribute('aria-label')||'',n.getAttribute('href')||''].join('|'),rank=seen.get(semantic)??0;seen.set(semantic,rank+1)
  const key=semantic+'|'+rank;let hash=2166136261;for(const c of key)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0
  n.dataset.designBlock='element.'+hash.toString(16);n.dataset.autoElement='true'
 }
}
export function editorItems(doc:Document):EditorItem[]{
 ensureElementIds(doc)
 const nodes=Array.from(doc.querySelectorAll<HTMLElement>('[data-design-block]'))
 const counts=new Map<string,number>();nodes.forEach(n=>counts.set(n.dataset.designBlock!,1+(counts.get(n.dataset.designBlock!)??0)))
 return nodes.filter(n=>counts.get(n.dataset.designBlock!)===1&&!n.closest('[data-editor-ignore]')).map(n=>{
  const parent=layoutOwner(n),group=parent?.dataset.layoutGroup
  // Reorder only explicit layout slots, or semantic siblings in an existing instrumented container.
  const semantic='section[data-design-block],article[data-design-block],header[data-design-block],aside[data-design-block],details[data-design-block],fieldset[data-design-block],nav[data-design-block],form[data-design-block],div[data-design-block]'
  const safe=!n.dataset.layoutTransparent&&!!parent?.dataset.designBlock&&n.matches(semantic)&&Array.from(n.parentElement?.children??[]).filter(c=>c.matches(semantic)).length>1
  const movable=!!n.dataset.layoutItem&&!!group||safe
  const words=Array.from(n.querySelectorAll<HTMLElement>('[data-design-word]')).filter(w=>!/\.w\d+$/.test(w.dataset.designWord??'')).filter((w,i,a)=>a.findIndex(x=>x.dataset.designWord===w.dataset.designWord)===i).map(w=>({id:w.dataset.designWord!,text:w instanceof doc.defaultView!.HTMLInputElement?(w as HTMLInputElement).placeholder:w.textContent??''}))
  const label=n.dataset.layoutLabel||n.querySelector('h1,h2,h3,legend,summary')?.textContent?.trim()||(n.textContent??'').replace(/\s+/g,' ').trim().slice(0,70)||'Section'
  return {id:n.dataset.designBlock!,label,parent:movable?(group||parent?.dataset.designBlock):undefined,groupLabel:movable?(parent?.dataset.layoutLabel||'Page sections'):undefined,movable,presentable:n.dataset.designPresentable==='true',words}
 })
}
export function designCss(changes:Record<string,DesignChange>,preview:boolean,depth:(id:string)=>number=()=>0){
 let css='[data-layout-transparent="true"]{display:contents!important;}[data-design-order-flow="true"]{display:flex!important;flex-direction:column!important;gap:16px;}';const words:string[]=[]
 for(const[id,v]of Object.entries(changes).sort(([a],[b])=>depth(a)-depth(b))){
  if(!validId(id))continue
  const block='[data-design-block="'+id+'"]',word='[data-design-word="'+id+'"]',selector=block+','+word
  if(v.hidden)css+=selector+'{'+(preview?'opacity:.35!important;':'display:none!important;')+'}'
  if(Number.isInteger(v.order)&&Math.abs(v.order!)<=2000&&v.parent&&validId(v.parent)){
   css+=layoutHosts(v.parent).map(host=>host+'>'+block).join(',')+'{order:'+v.order+'!important;}'
  }
  const offsetX=v.offsetX??v.x,offsetY=v.offsetY??v.y
  if(offsetX||offsetY||v.offsetX===0||v.offsetY===0)css+=block+'{position:relative!important;left:'+(Number.isFinite(offsetX)?offsetX:0)+'px!important;top:'+(Number.isFinite(offsetY)?offsetY:0)+'px!important;}'
  if(Number.isInteger(v.width)&&v.width!>=44&&v.width!<=2000)css+=block+'{box-sizing:border-box!important;width:'+v.width+'px!important;max-width:100%!important;}'
  if(Number.isInteger(v.minHeight)&&v.minHeight!>=44&&v.minHeight!<=2000)css+=block+'{min-height:'+v.minHeight+'px!important;}'
  if(Number.isInteger(v.iconSize)&&v.iconSize!>=16&&v.iconSize!<=160)css+=block+' svg{width:'+v.iconSize+'px!important;height:'+v.iconSize+'px!important;}'
  let typography=''
  if(v.font&&Object.prototype.hasOwnProperty.call(appFonts,v.font))typography+='font-family:'+appFonts[v.font].css+'!important;'
  if(validColor(v.color))typography+='color:'+v.color+'!important;'
  if(Number.isInteger(v.fontSize)&&v.fontSize!>=12&&v.fontSize!<=64)typography+='font-size:'+v.fontSize+'px!important;'
  if(typography){css+=block+','+block+' *{'+typography+'}';words.push(word+','+word+' *{'+typography+'}')}
  if(validColor(v.background))css+=block+'{background:'+v.background+'!important;}'
  if(validColor(v.borderColor))css+=block+'{border:1px solid '+v.borderColor+'!important;}'
  if(v.align&&['left','center','right'].includes(v.align))css+=selector+'{text-align:'+v.align+'!important;}'
 }
 return css+words.join('')
}
