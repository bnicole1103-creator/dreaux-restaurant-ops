import {useEffect,useRef,useState,type ReactNode} from 'react'
import {createPortal} from 'react-dom'

/** Nonmodal tool window: no backdrop, focus trap, or page scroll lock. */
export function FloorFloatingPanel({title,open,onClose,children}:{title:string;open:boolean;onClose:()=>void;children:ReactNode}){
 const [position,setPosition]=useState({x:12,y:120}),[collapsed,setCollapsed]=useState(false)
 const panel=useRef<HTMLElement>(null),drag=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null)
 const clamp=(x:number,y:number)=>({x:Math.max(0,Math.min(x,window.innerWidth-Math.min(420,window.innerWidth-16))),y:Math.max(0,Math.min(y,window.innerHeight-64))})
 useEffect(()=>{if(open){setCollapsed(false);setPosition(p=>clamp(p.x,p.y))}},[open])
 useEffect(()=>{const resize=()=>setPosition(p=>clamp(p.x,p.y));window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[])
 return createPortal(<section ref={panel} hidden={!open} aria-label={title} className="floor-floating-panel" style={{left:position.x,top:position.y}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose()}}}>
  <header className="floor-floating-header"><button type="button" className="floor-panel-drag" aria-label={`Move ${title} panel. Use arrow keys or drag.`} onKeyDown={e=>{const delta:Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(delta[e.key]){e.preventDefault();const [x,y]=delta[e.key];setPosition(p=>clamp(p.x+x,p.y+y))}}} onPointerDown={e=>{if(e.button!==0)return;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:position.x,top:position.y};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const d=drag.current;if(d?.id===e.pointerId)setPosition(clamp(d.left+e.clientX-d.x,d.top+e.clientY-d.y))}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>⠿ {title}</button><button type="button" aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)} aria-label={collapsed?'Expand panel':'Minimize panel'}>{collapsed?'+':'−'}</button><button type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button></header>
  <div hidden={collapsed} className="floor-floating-body" style={{maxHeight:`min(60dvh, ${Math.max(60,window.innerHeight-position.y-64)}px)`}}>{children}</div>
 </section>,document.body)
}
