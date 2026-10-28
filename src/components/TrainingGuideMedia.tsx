import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {guideVideoBucket} from '../lib/trainingGuideStyle'
import {mediaLink} from '../lib/mediaLinks'
export function TrainingGuideMedia({path,url}:{path?:string;url?:string}){
 const [signed,setSigned]=useState(''),[error,setError]=useState('')
 useEffect(()=>{let live=true;setSigned('');setError('');if(!path)return;const refresh=async()=>{const r=await supabase.storage.from(guideVideoBucket).createSignedUrl(path,3600);if(live){if(r.error)setError(r.error.message);else setSigned(r.data.signedUrl)}};void refresh();const timer=setInterval(()=>void refresh(),40*60*1000);return()=>{live=false;clearInterval(timer)}},[path])
 const link=url?mediaLink(url):null
 if(!path&&!link)return null
 return <section className="training-guide-video" aria-label="Training video">{error&&<p role="alert">Unable to load video: {error}</p>}{path&&!signed&&!error&&<p role="status">Loading video…</p>}{signed?<video controls playsInline preload="metadata" src={signed}/>:link?.embed?<iframe src={link.embed} title="Training video" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>:link&&/\.(mp4|webm|mov)(?:$|\?)/i.test(link.url)?<video controls playsInline preload="metadata" src={link.url}/>:null}{link&&<a href={link.url} target="_blank" rel="noreferrer">Open video link ↗</a>}</section>
}
