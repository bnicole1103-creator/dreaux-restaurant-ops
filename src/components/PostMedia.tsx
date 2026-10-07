// page-designer-instrumented
import { PageWord } from "./PageDesign"
import { ScreenText } from "./ScreenText"
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
export type MediaAsset={path:string;kind:'image'|'video';name:string;caption:string}
export function PostMedia({assets}:{assets:MediaAsset[]}){
 const [urls,setUrls]=useState<Record<string,string>>({});const [error,setError]=useState('')
 const paths=assets.map(a=>a.path).join('|')
 useEffect(()=>{let live=true;setUrls({});async function refresh(){if(!assets.length)return;const r=await supabase.storage.from('preshift-media').createSignedUrls(assets.map(a=>a.path),3600);if(live){setError((r.error||r.data?.some(a=>a.error))?'Unable to load an attachment. Refresh to try again.':'');setUrls(Object.fromEntries((r.data??[]).filter(a=>a.signedUrl).map(a=>[a.path!,a.signedUrl!])))}}void refresh();const timer=setInterval(()=>void refresh(),2700000);return()=>{live=false;clearInterval(timer)}},[paths])
 return <div data-design-block="copy.70b36070d837740b.1" className="post-media-grid">{assets.map(a=><figure key={a.path}>{urls[a.path]?(a.kind==='image'?<img src={urls[a.path]} alt={a.caption||a.name} loading="lazy" />:<video src={urls[a.path]} controls playsInline preload="metadata" aria-label={a.caption||a.name} />):<p data-design-block="copy.6a0ae9ea6fefcc7b.1"><ScreenText id="PostMedia.91ac02e781801e15">Loading </ScreenText>{a.name}<PageWord id="copy.20a1c66e311447ef.1">…</PageWord></p>}{a.caption&&<figcaption>{a.caption}</figcaption>}</figure>)}{error&&<p data-design-block="copy.953aab76d7f9258a.1" role="alert">{error}</p>}</div>
}
