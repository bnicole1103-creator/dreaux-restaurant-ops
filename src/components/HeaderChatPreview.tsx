import {crewMediaLabel,type CrewMediaAsset} from '../lib/crewMedia'
import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {loadTenantData} from '../lib/tenant'
import {calendarToday} from '../lib/calendarDates'
import {bubbleStyle,nameStyle} from '../lib/chatWallStyle'
import './HeaderChatPreview.css'
type Post={media?:CrewMediaAsset[];id:string;user_id:string;name:string;photo:string|null;body:string;created_at:string;wall_style?:unknown}
export function HeaderChatPreview({enabled}:{enabled:boolean}){
 const [posts,setPosts]=useState<Post[]>([]),[day,setDay]=useState(calendarToday),[state,setState]=useState<'loading'|'ready'|'error'|'hidden'>('loading'),[retry,setRetry]=useState(0);const location=useRef('')
 useEffect(()=>{if(!enabled){setPosts([]);setState('hidden');return}let live=true,running=false;let active:AbortController|null=null
 async function load(){if(running||document.visibilityState==='hidden')return;running=true;const date=calendarToday();let timer:ReturnType<typeof setTimeout>|undefined
 try{if(!location.current){const t=await loadTenantData();if(!live)return;location.current=t.locations[0]?.id??''}if(!location.current)throw Error('No location');const controller=new AbortController();active=controller;const r=await Promise.race([supabase.rpc('crew_room_load',{p_location_id:location.current,p_date:date,p_before:null}).abortSignal(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Chat unavailable'))},15000)})]);if(!live)return;if(r.error)throw r.error;if(!r.data?.can_chat){setPosts([]);setState('hidden');return}if(!Array.isArray(r.data.messages))throw Error('Chat unavailable');const latest=new Map<string,Post>();for(const post of r.data.messages as Post[]){if(!post.user_id||(!post.body&&!post.media?.length))continue;const prior=latest.get(post.user_id);if(!prior||Date.parse(post.created_at)>=Date.parse(prior.created_at))latest.set(post.user_id,post)}setPosts([...latest.values()].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,8));setDay(date);setState('ready')
 }catch{if(live){setPosts([]);setState('error')}}finally{if(timer)clearTimeout(timer);running=false;active=null}}
 void load();const timer=setInterval(()=>void load(),15000),refresh=()=>void load();window.addEventListener('focus',refresh);window.addEventListener('crew-chat-updated',refresh);document.addEventListener('visibilitychange',refresh);return()=>{live=false;active?.abort();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('crew-chat-updated',refresh);document.removeEventListener('visibilitychange',refresh)}
 },[enabled,retry])
 if(!enabled||state==='hidden')return null
 const room='/schedule?date='+day+'#crew-chat'
 return <nav className="header-chat-strip" aria-label="Recent crew chat"><Link className="header-chat-label" to={room}><span aria-hidden="true">◌</span> Crew chat <span aria-hidden="true">↗</span></Link><div className="header-chat-speakers">{state==='loading'&&<span className="header-chat-empty" role="status">Opening crew chat…</span>}{state==='error'&&<button className="header-chat-retry" type="button" onClick={()=>setRetry(v=>v+1)}>Chat unavailable · Retry</button>}{state==='ready'&&!posts.length&&<Link className="header-chat-empty" to={room}>No messages yet · Say hello</Link>}{posts.map(p=><Link className="header-chat-speaker" key={p.user_id} to={'/schedule?date='+day+'&speaker='+encodeURIComponent(p.user_id)+'#crew-chat'} aria-label={'Open crew chat with '+p.name+': '+crewMediaLabel(p.media,p.body)} title={p.name+': '+crewMediaLabel(p.media,p.body)}><span className="header-chat-photo" style={{borderColor:nameStyle(p.wall_style).color}}>{p.photo?<img src={p.photo} alt="" loading="lazy"/>:<span aria-hidden="true">{p.name.split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('')}</span>}</span><span className="header-chat-snippet" style={bubbleStyle(p.wall_style)}><strong>{p.name}</strong><span>{crewMediaLabel(p.media,p.body)}</span></span></Link>)}</div></nav>
}
