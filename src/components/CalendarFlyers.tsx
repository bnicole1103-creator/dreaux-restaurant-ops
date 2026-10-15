import {PageWord} from './PageDesign'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import type {CalendarFlyer} from './CalendarData'
export function CalendarFlyers({assets}:{assets:CalendarFlyer[]}){
 const [urls,setUrls]=useState<Record<string,string>>({}),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 const paths=assets.map(a=>a.path).join('|')
 useEffect(()=>{let live=true;setUrls({});setError('');async function load(){try{if(!assets.length)return;const r=await supabase.storage.from('calendar-media').createSignedUrls(assets.map(a=>a.path),3600);if(r.error||r.data?.some(a=>a.error))throw Error('Could not load a flyer.');if(live)setUrls(Object.fromEntries((r.data??[]).map(a=>[a.path!,a.signedUrl!])))}catch(e){if(live)setError(String((e as Error).message))}}void load();const timer=setInterval(()=>void load(),2700000);return()=>{live=false;clearInterval(timer)}},[paths,retry])
 return <div className="calendar-flyers">{assets.map(a=><figure key={a.path}>{urls[a.path]?<a href={urls[a.path]} target="_blank" rel="noreferrer"><img src={urls[a.path]} alt={a.caption||a.name} loading="lazy"/></a>:<p><PageWord id="sectioncopy.9427d8f0b5d200a8e281">{"Loading flyer…"}</PageWord></p>}{a.caption&&<figcaption>{a.caption}</figcaption>}</figure>)}{error&&<p role="alert">{error} <button type="button" onClick={()=>setRetry(v=>v+1)}><PageWord id="sectioncopy.eeef54db6b9b1303c448">{"Retry flyers"}</PageWord></button></p>}</div>
}
