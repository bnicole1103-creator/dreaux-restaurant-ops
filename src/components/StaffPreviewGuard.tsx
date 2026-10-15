import {PageWord} from './PageDesign'
import {useEffect,useState} from 'react'
import {staffPreviewActive} from '../lib/staffPreviewClient'
if(staffPreviewActive){
 const stop=(event:Event)=>{const target=event.target as Element;if(event.type==='click'&&target?.closest('summary'))return;if(event.type==='keydown'&&!['Enter',' '].includes((event as KeyboardEvent).key))return;if(event.cancelable)event.preventDefault();event.stopImmediatePropagation()}
 ;['click','submit','change','input','beforeinput','keydown','drop'].forEach(type=>document.addEventListener(type,stop,{capture:true,passive:false}))
}
export function StaffPreviewGuard(){
 const [error,setError]=useState('')
 useEffect(()=>{if(!staffPreviewActive)return;const failed=(e:Event)=>setError(String((e as CustomEvent).detail));window.addEventListener('staff-preview-error',failed);return()=>window.removeEventListener('staff-preview-error',failed)},[])
 if(!staffPreviewActive)return null
 return <aside data-design-block="section.4ccb2904e1b34e3e96b9" className="staff-preview-notice" role="status"><strong><PageWord id="sectioncopy.567927b9bb4ee2bcd2f4">{"Read-only employee preview"}</PageWord></strong><span><PageWord id="sectioncopy.c761dc1e005af4fc95be">{"Forms, scheduling, notifications and read receipts cannot be submitted here. Device push permission is not simulated."}</PageWord></span>{error&&<p role="alert">{error}</p>}</aside>
}
