import { useEffect,useRef } from 'react'
import type { PropsWithChildren } from 'react'
import './PresetEditorModal.css'
export function PresetEditorModal({busy,onClose,children}:PropsWithChildren<{busy:boolean;onClose:()=>void}>){
 const dialog=useRef<HTMLDialogElement>(null),closeRef=useRef(onClose),busyRef=useRef(busy)
 closeRef.current=onClose;busyRef.current=busy
 useEffect(()=>{const d=dialog.current;if(!d)return;d.showModal();const cancel=(e:Event)=>{e.preventDefault();if(!busyRef.current)closeRef.current()};d.addEventListener('cancel',cancel);return()=>{d.removeEventListener('cancel',cancel);d.close()}},[])
 return <dialog className="preset-editor-modal" ref={dialog} aria-labelledby="preset-editor-title"><button type="button" className="preset-editor-close" disabled={busy} aria-label="Close preset editor" onClick={onClose}>×</button>{children}</dialog>
}
