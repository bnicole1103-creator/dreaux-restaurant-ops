import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {crewMediaBucket,type CrewMediaAsset} from '../lib/crewMedia'
import './CrewChatMedia.css'
export function CrewMessageMedia({assets}:{assets:CrewMediaAsset[]}){
 const [urls,setUrls]=useState<Record<string,string>>({}),[error,setError]=useState(''),[retry,setRetry]=useState(0),[opened,setOpened]=useState<string|null>(null)
 const dialog=useRef<HTMLDialogElement>(null),paths=assets.map(a=>a.path).join('|')
 useEffect(()=>{let live=true;setUrls({});setError('');async function load(){try{const r=await supabase.storage.from(crewMediaBucket).createSignedUrls(assets.map(a=>a.path),900);if(!live)return;if(r.error||r.data?.some(a=>a.error))setError('An attachment could not load.');setUrls(Object.fromEntries((r.data??[]).filter(a=>a.signedUrl).map(a=>[a.path!,a.signedUrl!])))}catch{if(live)setError('Attachments are unavailable.')}}void load();const timer=setInterval(()=>void load(),600000);return()=>{live=false;clearInterval(timer)}},[paths,retry])
 useEffect(()=>{if(opened&&!dialog.current?.open)dialog.current?.showModal();if(!opened&&dialog.current?.open)dialog.current?.close()},[opened])
 const selected=assets.find(a=>a.path===opened)
 return <div className="crew-message-media">{assets.map(a=><figure key={a.path}>{urls[a.path]?(a.kind==='image'?<button type="button" className="crew-image-open" aria-label={'Open photo '+a.name} onClick={()=>setOpened(a.path)}><img src={urls[a.path]} alt={a.name} loading="lazy"/></button>:<><video src={urls[a.path]} controls playsInline preload="metadata" aria-label={a.name}/><a href={urls[a.path]} target="_blank" rel="noreferrer">Open video ↗</a></>):<span>Loading {a.name}…</span>}</figure>)}{error&&<p role="alert">{error} <button type="button" onClick={()=>setRetry(v=>v+1)}>Retry attachments</button></p>}<dialog ref={dialog} className="crew-photo-dialog" aria-label="Chat photo" onCancel={()=>setOpened(null)} onClose={()=>setOpened(null)} onClick={e=>{if(e.target===e.currentTarget)setOpened(null)}}>{selected&&<><button type="button" autoFocus onClick={()=>setOpened(null)}>Close photo ✕</button><img src={urls[selected.path]} alt={selected.name}/></>}</dialog></div>
}
