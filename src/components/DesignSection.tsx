import {createContext,createElement,forwardRef,useContext,useEffect,useId,useRef,useState} from 'react'
import type {HTMLAttributes,ReactNode} from 'react'
import {usePageDesign} from './PageDesign'
import {editorPreviewActive} from '../lib/screenEditorSelection'
import './DesignSection.css'
const Presented=createContext(false)
type Props=HTMLAttributes<HTMLElement>&{as?:'div'|'section'|'article'|'header'|'aside';'data-design-block':string;children?:ReactNode;'data-layout-item'?:string;'data-layout-label'?:string}
/** Original permission boundaries and business components remain in the same React tree. */
export const DesignSection=forwardRef<HTMLElement,Props>(function DesignSection({as='section',children,...props},ref){
 const {changes}=usePageDesign(),change=changes[props['data-design-block']]??{},nested=useContext(Presented)
 const preview=editorPreviewActive(window.location.search,window.parent!==window)
 const mode=nested?'inline':change.presentation??'inline'
 const title=change.panelTitle||props['data-layout-label']||change.title||'Open section'
 const contentId=useId(),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null)
 const [expanded,setExpanded]=useState(change.defaultOpen??false),[opened,setOpened]=useState(false)
 useEffect(()=>{setExpanded(change.defaultOpen??false)},[change.defaultOpen,mode])
 useEffect(()=>{const d=dialog.current;if(!d)return;if(opened&&mode==='popup'&&!preview){if(!d.open)d.showModal()}else if(d.open)d.close()},[opened,mode,preview])
 useEffect(()=>{setOpened(false)},[mode,preview])
 // The preview shows content for selection; its capture guard blocks business actions.
 const body=mode==='inline'?children:<Presented.Provider value={true}>{children}</Presented.Provider>
 let content:ReactNode=body
 if(mode==='collapse')content=<><button type="button" className="design-panel-trigger" aria-expanded={preview||expanded} aria-controls={contentId} onClick={()=>setExpanded(v=>!v)}>{title}<span aria-hidden="true">{preview||expanded?'−':'+'}</span></button><div id={contentId} hidden={!preview&&!expanded}>{body}</div></>
 if(mode==='popup')content=<><button ref={trigger} type="button" className="design-panel-trigger" aria-haspopup="dialog" aria-controls={contentId} onClick={()=>setOpened(true)}>{title}<span aria-hidden="true">↗</span></button>{preview?<div className="design-popup-preview" id={contentId}><p>Popup contents · {title}</p>{body}</div>:<dialog ref={dialog} id={contentId} className="design-section-dialog" aria-label={title} onCancel={()=>setOpened(false)} onClose={()=>{setOpened(false);trigger.current?.focus()}} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close()}}><div className="design-dialog-heading"><strong>{title}</strong><button type="button" aria-label={'Close '+title} onClick={()=>dialog.current?.close()}>Close ×</button></div>{body}</dialog>}</>
 return createElement(as,{...props,ref,'data-design-presentable':nested?undefined:'true','data-presentation':mode},content)
})
