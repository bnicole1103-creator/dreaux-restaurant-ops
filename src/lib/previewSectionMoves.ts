import {sectionSiblings,type EditorItem} from './pageEditor'
import type {Design} from '../components/PageDesign'

type Options={items:()=>EditorItem[];changes:()=>Design['changes'];blocked:()=>boolean;move:(id:string,position:number)=>boolean}
export type PreviewSectionMoves={select:(id:string)=>void;refresh:()=>void;handle:(event:Event)=>boolean;destroy:()=>void}
/** Editor-owned controls live outside the app's React tree and never call business actions. */
export function attachPreviewSectionMoves(doc:Document,win:Window,options:Options):PreviewSectionMoves{
 const bar=doc.createElement('div');bar.dataset.editorIgnore='true';bar.dataset.editorMoveControls='true';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Selected section movement');bar.hidden=true
 const style=doc.createElement('style');style.textContent='[data-editor-move-controls]{position:fixed!important;inset:8px 8px auto!important;z-index:2147483647!important;display:flex!important;align-items:center!important;gap:6px!important;flex-wrap:wrap!important;padding:10px!important;border:2px solid #795036!important;border-radius:12px!important;background:#fff8ef!important;color:#493024!important;font:14px Arial,sans-serif!important;box-shadow:0 4px 20px #0003!important;box-sizing:border-box!important}[data-editor-move-controls][hidden]{display:none!important}[data-editor-move-controls] button{min-width:44px!important;min-height:44px!important;margin:0!important;padding:8px!important;border:1px solid #b59a78!important;border-radius:8px!important;background:#f0e1cf!important;color:#493024!important;font:14px Arial,sans-serif!important;cursor:pointer!important}[data-editor-move-controls] button:disabled{opacity:.45!important}[data-editor-move-controls] [data-move-action=drag]{touch-action:none!important;user-select:none!important;-webkit-user-select:none!important;cursor:grab!important}[data-editor-move-title]{flex:1 1 100%;font-weight:bold!important}[data-editor-drop-target]{outline:4px solid #b8672e!important;outline-offset:4px!important}[data-editor-selected]{outline:3px solid #795036!important;outline-offset:4px!important}'
 const title=doc.createElement('span');title.dataset.editorMoveTitle='true';title.setAttribute('aria-live','polite');bar.append(title)
 function button(action:string,label:string){const node=doc.createElement('button');node.type='button';node.dataset.moveAction=action;node.textContent=label;node.setAttribute('aria-label',label);bar.append(node);return node}
 const up=button('up','↑ Move up'),down=button('down','↓ Move down'),grip=button('drag','⠿ Drag section'),close=button('close','Close controls');up.textContent='↑ Up';down.textContent='↓ Down';grip.textContent='⠿ Move';close.textContent='×'
 doc.head.append(style);doc.body.append(bar)
 let selected='',drag:{pointer:number;startY:number;target:number;from:number;moved:boolean;y:number}|null=null,scrollFrame=0
 const siblings=()=>sectionSiblings(options.changes(),options.items(),selected,true)
 function node(id:string){return doc.querySelector<HTMLElement>('[data-design-block="'+id+'"]')}
 function clearTarget(){doc.querySelectorAll('[data-editor-drop-target]').forEach(n=>n.removeAttribute('data-editor-drop-target'))}
 function refresh(){
  const item=options.items().find(x=>x.id===selected),list=siblings(),index=list.findIndex(x=>x.id===selected)
  if(!item||!node(selected)){bar.hidden=true;return}
  bar.hidden=false
  title.textContent=item.label+' · '+(index<0?'Choose a movable section':list.length<2?'Only section in this group':'Position '+(index+1)+' of '+list.length)
  up.disabled=options.blocked()||index<=0;down.disabled=options.blocked()||index<0||index>=list.length-1;grip.disabled=options.blocked()||list.length<2||index<0
 }
 function select(id:string){selected=id;doc.querySelectorAll('[data-editor-selected]').forEach(n=>n.removeAttribute('data-editor-selected'));node(id)?.setAttribute('data-editor-selected','true');refresh()}
 function destination(y:number){
  if(!drag)return
  const remaining=siblings().filter(item=>item.id!==selected)
  let position=remaining.length
  for(let i=0;i<remaining.length;i++){const rect=node(remaining[i].id)?.getBoundingClientRect();if(rect&&y<rect.top+rect.height/2){position=i;break}}
  drag.target=position;clearTarget();const target=remaining[Math.min(position,remaining.length-1)];if(target)node(target.id)?.setAttribute('data-editor-drop-target','true')
  title.textContent='Release to place '+(options.items().find(x=>x.id===selected)?.label||'section')+' at position '+(position+1)
 }
 function autoScroll(){
  if(!drag)return
  const delta=drag.y>win.innerHeight-64?18:drag.y<100?-18:0
  if(delta){win.scrollBy(0,delta);destination(drag.y)}
  scrollFrame=win.requestAnimationFrame(autoScroll)
 }
 function end(cancel=false){
  const finished=drag;drag=null;win.cancelAnimationFrame(scrollFrame);clearTarget()
  if(finished){try{grip.releasePointerCapture(finished.pointer)}catch{/* Capture may already have been released. */}
   if(!cancel&&finished.moved&&finished.target!==finished.from){const moved=options.move(selected,finished.target);if(!moved)title.textContent='Move could not be applied. Reload the preview and try again.'}
  }
  refresh()
 }
 const cancel=()=>end(true);win.addEventListener('blur',cancel)
 function handle(event:Event){
  const element=event.target as Element|null,control=element?.closest?.('[data-editor-move-controls]'),action=element?.closest<HTMLElement>('[data-move-action]')?.dataset.moveAction
  if(control!==bar&&!drag)return false
  event.stopImmediatePropagation()
  if(event.type==='pointermove'&&drag){const e=event as PointerEvent;if(e.pointerId!==drag.pointer)return true;if(e.cancelable)e.preventDefault();drag.y=e.clientY;drag.moved=drag.moved||Math.abs(e.clientY-drag.startY)>6;if(drag.moved)destination(e.clientY);return true}
  if((event.type==='pointerup'||event.type==='pointercancel')&&drag){if((event as PointerEvent).pointerId!==drag.pointer)return true;if(event.cancelable)event.preventDefault();end(event.type==='pointercancel');return true}
  if(event.type==='pointerdown'&&action==='drag'&&!grip.disabled){const e=event as PointerEvent;if(e.cancelable)e.preventDefault();const index=siblings().findIndex(x=>x.id===selected);drag={pointer:e.pointerId,startY:e.clientY,y:e.clientY,target:index,from:index,moved:false};try{grip.setPointerCapture(e.pointerId)}catch{/* Mouse fallback still uses window events. */}scrollFrame=win.requestAnimationFrame(autoScroll);return true}
  if(event.type==='click'){
   if(event.cancelable)event.preventDefault()
   if(action==='close'){bar.hidden=true;selected='';doc.querySelectorAll('[data-editor-selected]').forEach(n=>n.removeAttribute('data-editor-selected'));return true}
   if(!options.blocked()&&(action==='up'||action==='down')){const list=siblings(),index=list.findIndex(x=>x.id===selected),position=index+(action==='up'?-1:1);if(index>=0&&position>=0&&position<list.length)options.move(selected,position);refresh()}
   return true
  }
  // Allow keyboard activation of these editor controls; application controls stay blocked.
  if(event.type==='keydown'&&['Enter',' '].includes((event as KeyboardEvent).key))return true
  return true
 }
 return{select,refresh,handle,destroy(){win.removeEventListener('blur',cancel);end(true);bar.remove();style.remove();doc.querySelectorAll('[data-editor-selected]').forEach(n=>n.removeAttribute('data-editor-selected'))}}
}
