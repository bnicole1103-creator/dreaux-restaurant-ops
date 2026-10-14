import {useEffect,useState} from 'react'
import {stickerBank,emptyDecorations,type Decorations} from '../lib/stickerBank'
import {loadTenantData} from '../lib/tenant'
import {supabase} from '../lib/supabase'
import './StickerBank.css'
export function StickerDisplay({config}:{config:Decorations}){
 if(!config.enabled||!config.items.length)return null
 return <div className="sticker-decoration-row" aria-hidden="true">{(['left','banner','right'] as const).map(spot=><div key={spot} className={'sticker-slot sticker-slot-'+spot}>{config.items.filter(i=>i.spot===spot).map(item=>{const entry=stickerBank.find(s=>s[0]===item.id);return entry?<span key={item.key} className="decoration-sticker" style={{fontSize:item.size,transform:'rotate('+item.rotation+'deg)'}}>{entry[1]}</span>:null})}</div>)}</div>
}
export function AppStickerDecorations(){
 const [config,setConfig]=useState<Decorations>(emptyDecorations)
 useEffect(()=>{let live=true,running=false;async function load(){if(running)return;running=true;try{const tenant=await loadTenantData(),location=tenant.locations[0]?.id;if(!location)return;const r=await supabase.rpc('app_decorations_get',{p_location_id:location});if(live&&!r.error)setConfig(r.data.config??emptyDecorations)}catch{/* Decorations never prevent the app from loading. */}finally{running=false}}void load();const focus=()=>{if(document.visibilityState==='visible')void load()};const timer=setInterval(focus,60000);window.addEventListener('focus',focus);window.addEventListener('decorations-saved',focus);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('decorations-saved',focus)}},[])
 return <StickerDisplay config={config}/>
}
