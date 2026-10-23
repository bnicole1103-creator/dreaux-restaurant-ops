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
 siblings.map(x=>changes[x.id]?.hidden?x:reordered[i++]).forEach((x,n)=>{next[x.id]={...next[x.id],parent:x.parent,order:n+1};delete next[x.id].x;delete next[x.id].y})
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
  const display=doc.defaultView?.getComputedStyle(host).display??''
  if(!['flex','inline-flex','grid','inline-grid'].includes(display))host.setAttribute('data-design-order-flow','true')
 }
}
export function editorItems(doc:Document):EditorItem[]{
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
 let css='[data-design-order-flow="true"]{display:flex!important;flex-direction:column!important;gap:16px;}';const words:string[]=[]
 for(const[id,v]of Object.entries(changes).sort(([a],[b])=>depth(a)-depth(b))){
  if(!validId(id))continue
  const block='[data-design-block="'+id+'"]',word='[data-design-word="'+id+'"]',selector=block+','+word
  if(v.hidden)css+=selector+'{'+(preview?'opacity:.35!important;':'display:none!important;')+'}'
  if(Number.isInteger(v.order)&&Math.abs(v.order!)<=2000&&v.parent&&validId(v.parent)){
   css+=layoutHosts(v.parent).map(host=>host+'>'+block).join(',')+'{order:'+v.order+'!important;}'
  }
  if(v.x||v.y)css+=block+'{position:relative;left:'+(Number.isFinite(v.x)?v.x:0)+'px;top:'+(Number.isFinite(v.y)?v.y:0)+'px;}'
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
