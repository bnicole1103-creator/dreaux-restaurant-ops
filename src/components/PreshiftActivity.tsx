import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PreshiftReadReceipt,usePreshiftReadReceipts } from './PreshiftReadReceipts'
export function PreshiftOpenTracker({location,postId,version,source}:{location:string;postId:string;version:number;source:'home'|'feed'}){
 const anchor=useRef<HTMLSpanElement>(null),[error,setError]=useState('')
 useEffect(()=>{
  if(!location||!postId||!version||new URLSearchParams(window.location.search).has('wording-preview'))return
  const details=source==='home'?anchor.current?.closest('details'):null
  const target=source==='home'?details:anchor.current?.closest('article')?.querySelector('.feed-body')
  if(!target)return
  let live=true,busy=false,recorded=false,inView=false
  async function record(){if(!live||busy||recorded||document.visibilityState!=='visible'||(details&&!details.open))return;busy=true;try{const r=await supabase.rpc('preshift_record_open',{p_location_id:location,p_post_id:postId,p_version:version,p_source:source});if(r.error)throw r.error;recorded=true;if(live)setError('')}catch(e){if(live)setError('Could not record this opening: '+String((e as {message?:string})?.message??e))}finally{busy=false}}
  const toggle=()=>{if(details?.open)void record();else recorded=false}
  const visible=()=>{if(document.visibilityState==='visible'&&(details?.open||(!details&&inView)))void record()}
  const observer=!details?new IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting);if(inView)void record()},{threshold:0.1}):null
  if(observer)observer.observe(target)
  details?.addEventListener('toggle',toggle);document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible)
  if(details?.open)void record()
  return()=>{live=false;observer?.disconnect();details?.removeEventListener('toggle',toggle);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible)}
 },[location,postId,version,source])
 return <span ref={anchor}>{error&&<span role="alert">{error} Close and reopen the post or refresh to retry.</span>}</span>
}
export function HomePreshiftRead({location,postId,version}:{location:string;postId:string;version:number}){
 const reads=usePreshiftReadReceipts(location,[{id:postId,version}])
 return <><PreshiftOpenTracker location={location} postId={postId} version={version} source="home"/>{reads.error&&<p role="alert">{reads.error}</p>}<PreshiftReadReceipt location={location} postId={postId} version={version} status={reads.rows[postId]} manager={reads.manager} onChange={reads.reload}/></>
}
