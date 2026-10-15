import {PageWord} from './PageDesign'
import {useEffect,useId,useRef,type ReactNode,type CSSProperties} from 'react'
import './CalendarStudio.css'
export function CalendarDialog({title,children,onClose,busy=false,style}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean;style?:CSSProperties}){
 const ref=useRef<HTMLDialogElement>(null),id=useId()
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=ref.current;dialog?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog?.close();document.body.style.overflow=overflow;previous?.focus()}},[])
 return <dialog ref={ref} className="calendar-dialog" style={style} aria-labelledby={id} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}><header data-design-block="section.f892390ff1bd138a095b" className="calendar-dialog-header"><div><p className="eyebrow"><PageWord id="sectioncopy.4c38dec38dfd6ef08ed0">{"On the calendar"}</PageWord></p><h2 id={id}>{title}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close day details"><PageWord id="sectioncopy.c61cb38e2f9414e80654">{"✕"}</PageWord></button></header><div className="calendar-dialog-body">{children}</div></dialog>
}
