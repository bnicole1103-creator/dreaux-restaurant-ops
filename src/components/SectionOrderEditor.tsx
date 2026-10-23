import {useEffect,useRef,useState} from 'react'
import type {Design} from './PageDesign'
import {sectionSiblings,type EditorItem} from '../lib/pageEditor'

type Props={items:EditorItem[];changes:Design['changes'];rootGroup:string;filter:string;selectedId?:string;disabled?:boolean;onSelect:(item:EditorItem)=>void;onMove:(id:string,position:number)=>void;onHide:(id:string)=>void;onLocate:(id:string)=>void}
/** Moves stay inside a section's existing group; no components are reparented. */
export function SectionOrderEditor({items,changes,rootGroup,filter,selectedId,disabled=false,onSelect,onMove,onHide,onLocate}:Props){
 const [scope,setScope]=useState('main'),[picked,setPicked]=useState<string|null>(null),[dragged,setDragged]=useState<string|null>(null),[announcement,setAnnouncement]=useState('')
 const rows=useRef<HTMLDivElement>(null)
 useEffect(()=>{setScope('main');setPicked(null);setDragged(null)},[rootGroup])
 const groups=new Map<string,{label:string;rows:EditorItem[]}>()
 for(const item of items.filter(x=>x.movable&&x.parent)){
  if(!groups.has(item.parent!))groups.set(item.parent!,{label:item.groupLabel||'Page sections',rows:sectionSiblings(changes,items,item.id,true)})
 }
 const main=groups.get(rootGroup)?.rows.length&&groups.get(rootGroup)!.rows.length>1?rootGroup:[...groups].find(([,g])=>g.rows.length>1)?.[0]??rootGroup
 const active=scope==='main'?main:scope
 const match=(item:EditorItem)=>item.label.toLowerCase().includes(filter.trim().toLowerCase())
 const pickedItem=items.find(x=>x.id===picked)
 function move(item:EditorItem,position:number){
  onMove(item.id,position);setAnnouncement(item.label+' moved to position '+(position+1)+'. Save page to keep this order.');setPicked(null);setDragged(null)
 }
 function drop(target:EditorItem,after:boolean){
  const id=dragged||picked,source=items.find(x=>x.id===id)
  if(!source||source.parent!==target.parent||source.id===target.id)return
  const siblings=sectionSiblings(changes,items,source.id,true),remaining=siblings.filter(x=>x.id!==source.id),targetIndex=remaining.findIndex(x=>x.id===target.id)
  move(source,targetIndex+(after?1:0))
 }
 return <div className="section-order-editor" ref={rows}>
  <label>Section group<select aria-label="Section group" value={scope} disabled={disabled} onChange={e=>{setScope(e.target.value);setPicked(null)}}><option value="main">Main sections</option><option value="all">All groups</option>{[...groups].map(([id,g])=><option key={id} value={id}>{g.label} · {g.rows.length} sections</option>)}</select></label>
  <p>Choose a position to jump there, or tap Move then Place before/after another section. On a computer, you can also drag the grip.</p>
  {pickedItem&&<div className="editor-move-banner" role="status">Moving <strong>{pickedItem.label}</strong>. Choose a destination in this group.<button type="button" onClick={()=>setPicked(null)}>Cancel move</button></div>}
  <p className="editor-order-announcement" role="status" aria-live="polite">{announcement}</p>
  {[...groups].filter(([id])=>scope==='all'||id===active).map(([id,group])=>{
   const visible=group.rows.filter(match)
   if(!visible.length)return null
   return <section className="editor-order-group" key={id} aria-label={group.label}><h3>{group.label}</h3>{visible.map(item=>{
    const position=group.rows.findIndex(x=>x.id===item.id),canPlace=!!pickedItem&&pickedItem.parent===item.parent&&pickedItem.id!==item.id
    return <div key={item.id} data-order-id={item.id} className={'editor-section-row'+(selectedId===item.id?' is-selected':'')+(picked===item.id?' is-moving':'')}
     onDragOver={e=>{const source=items.find(x=>x.id===dragged);if(!disabled&&source?.parent===item.parent){e.preventDefault();e.dataTransfer.dropEffect='move'}}}
     onDrop={e=>{e.preventDefault();if(disabled)return;drop(item,e.clientY>e.currentTarget.getBoundingClientRect().top+e.currentTarget.getBoundingClientRect().height/2)}}>
     <div className="editor-order-heading"><button type="button" className="editor-drag-grip" aria-label={'Drag '+item.label} title="Drag to reorder, or use Move and position controls" draggable={!disabled&&group.rows.length>1}
      disabled={disabled||group.rows.length<2} onClick={()=>setPicked(picked===item.id?null:item.id)}
      onDragStart={e=>{if(disabled){e.preventDefault();return}setDragged(item.id);setPicked(null);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',item.id)}} onDragEnd={()=>setDragged(null)}>⠿</button>
      <button type="button" className="editor-section-name" disabled={disabled} onClick={()=>onSelect(item)}>{item.label}<small>Position {position+1} of {group.rows.length}</small></button></div>
     <label>Move to position<select aria-label={'Position for '+item.label} disabled={disabled||group.rows.length<2} value={position} onChange={e=>move(item,Number(e.target.value))}>{group.rows.map((target,i)=><option key={target.id} value={i}>{i+1} · {target.label}</option>)}</select></label>
     <div className="editor-row-actions"><button type="button" aria-label={'Move '+item.label+' up'} disabled={disabled||position===0} onClick={()=>move(item,position-1)}>↑ Up</button><button type="button" aria-label={'Move '+item.label+' down'} disabled={disabled||position===group.rows.length-1} onClick={()=>move(item,position+1)}>↓ Down</button><button type="button" disabled={disabled||group.rows.length<2} aria-pressed={picked===item.id} onClick={()=>{setPicked(picked===item.id?null:item.id);setAnnouncement('')}}>Move</button><button type="button" disabled={disabled} onClick={()=>onLocate(item.id)}>Find in preview</button>{item.id!=='page.content'&&<button type="button" disabled={disabled} onClick={()=>onHide(item.id)}>Hide</button>}</div>
     {canPlace&&<div className="editor-place-actions"><button type="button" disabled={disabled} aria-label={'Place '+pickedItem!.label+' before '+item.label} onClick={()=>drop(item,false)}>Place before</button><button type="button" disabled={disabled} aria-label={'Place '+pickedItem!.label+' after '+item.label} onClick={()=>drop(item,true)}>Place after</button></div>}
    </div>
   })}</section>
  })}
  {![...groups].some(([id,g])=>(scope==='all'||id===active)&&g.rows.some(match))&&<p>No matching sections in this group. Choose All groups or clear the search.</p>}
 </div>
}
