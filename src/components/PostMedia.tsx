import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
export type MediaAsset={path:string;kind:'image'|'video';name:string;caption:string}
export function PostMedia({assets}:{assets:MediaAsset[]}){
 const [urls,setUrls]=useState<Record<string,string>>({});const [error,setError]=useState('')
 const paths=assets.map(a=>a.path).join('|')
 useEffect(()=>{let live=true;setUrls({});async function refresh(){if(!assets.length)return;const r=await supabase.storage.from('preshift-media').createSignedUrls(assets.map(a=>a.path),3600);if(live){setError((r.error||r.data?.some(a=>a.error))?'Unable to load an attachment. Refresh to try again.':'');setUrls(Object.fromEntries((r.data??[]).filter(a=>a.signedUrl).map(a=>[a.path!,a.signedUrl!])))}}void refresh();const timer=setInterval(()=>void refresh(),2700000);return()=>{live=false;clearInterval(timer)}},[paths])
 return <div className="post-media-grid">{assets.map(a=><figure key={a.path}>{urls[a.path]?(a.kind==='image'?<img src={urls[a.path]} alt={a.caption||a.name} loading="lazy" />:<video src={urls[a.path]} controls playsInline preload="metadata" aria-label={a.caption||a.name} />):<p>Loading {a.name}…</p>}{a.caption&&<figcaption>{a.caption}</figcaption>}</figure>)}{error&&<p role="alert">{error}</p>}</div>
}
