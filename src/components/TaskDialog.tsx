import {useEffect,useId,useRef,type ReactNode} from 'react'
import '../pages/TaskWorkflow.css'
export function TaskDialog({title,children,onClose,busy=false}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean}){
 const ref=useRef<HTMLDialogElement>(null),id=useId()
 useEffect(()=>{const prior=document.activeElement as HTMLElement|null,dialog=ref.current,overflow=document.body.style.overflow;dialog?.showModal();document.body.style.overflow='hidden';return()=>{dialog?.close();document.body.style.overflow=overflow;prior?.focus()}},[])
 return <dialog ref={ref} className="task-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}><header><h2 id={id}>{title}</h2><button type="button" disabled={busy} aria-label="Close task dialog" onClick={onClose}>✕</button></header><div className="task-dialog-body">{children}</div></dialog>
}
