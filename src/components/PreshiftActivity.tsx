import {AccessSection} from './AppAccess'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PreshiftReadReceipt,usePreshiftReadReceipts } from './PreshiftReadReceipts'
export function PreshiftOpenTracker({location,postId,version,source}:{location:string;postId:string;version:number;source:'home'|'feed'}){
 const anchor=useRef<HTMLSpanElement>(null),[error,setError]=useState('')
 useEffect(()=>{
  if(!location||!postId||!version||new URLSearchParams(window.location.search).has('wording-preview'))return
  const details=source==='home'?anchor.current?.closest('details'):null
  const target=source==='home'?(details?.querySelector('.home-post-body')??details):anchor.current?.closest('article')?.querySelector('.feed-body')
  if(!target)return
  const session=crypto.randomUUID()
  let live=true,inView=false,activeAt:number|null=null,total=0,sending=false,pending=false,opened=false
  const eligible=()=>inView&&document.visibilityState==='visible'&&document.hasFocus()&&(!details||details.open)
  function sample(){const now=performance.now();if(activeAt!==null)total+=Math.max(0,now-activeAt);activeAt=eligible()?now:null}
  async function flush(){sample();if(sending){pending=true;return}if(!opened&&total===0&&!eligible())return;sending=true
   try{
    if(!opened){const r=await supabase.rpc('preshift_record_open',{p_location_id:location,p_post_id:postId,p_version:version,p_source:source});if(r.error)throw r.error;opened=true}
    const r=await supabase.rpc('preshift_record_view_time',{p_location_id:location,p_post_id:postId,p_version:version,p_session:session,p_source:source,p_visible_ms:Math.floor(total)});if(r.error)throw r.error
    if(live)setError('')
   }catch(e){if(live)setError('Viewing receipt could not save: '+String((e as {message?:string})?.message??e))}
   finally{sending=false;if(pending){pending=false;void flush()}}
  }
  const change=()=>{sample();void flush()}
  const observer=new IntersectionObserver(entries=>{sample();inView=entries.some(e=>e.isIntersecting);change()},{threshold:0})
  observer.observe(target)
  details?.addEventListener('toggle',change);document.addEventListener('visibilitychange',change);window.addEventListener('focus',change);window.addEventListener('blur',change);window.addEventListener('pagehide',change)
  const timer=setInterval(()=>{if(eligible()||activeAt!==null)void flush()},10000)
  return()=>{sample();inView=false;activeAt=null;live=false;void flush();clearInterval(timer);observer.disconnect();details?.removeEventListener('toggle',change);document.removeEventListener('visibilitychange',change);window.removeEventListener('focus',change);window.removeEventListener('blur',change);window.removeEventListener('pagehide',change)}
 },[location,postId,version,source])
 return <span ref={anchor}>{error&&<span role="alert">{error}</span>}</span>
}
export function HomePreshiftRead({location,postId,version}:{location:string;postId:string;version:number}){
 const reads=usePreshiftReadReceipts(location,[{id:postId,version}])
 return <><PreshiftOpenTracker location={location} postId={postId} version={version} source="home"/>{reads.error&&<p role="alert">{reads.error}</p>}<AccessSection page="posts" section="receipts"><PreshiftReadReceipt location={location} postId={postId} version={version} status={reads.rows[postId]} manager={reads.manager} onChange={reads.reload}/></AccessSection></>
}
