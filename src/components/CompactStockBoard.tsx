import {DesignSection} from './DesignSection'
import {PageWord} from './PageDesign'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {StockBoard} from './StockBoard'
import {CalendarDialog} from './CalendarDialog'
export function CompactStockBoard({location}:{location:string}){
 const [items,setItems]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[open,setOpen]=useState(false),[loading,setLoading]=useState(true)
 useEffect(()=>{let live=true;async function load(){const r=await supabase.rpc('stock_board_load',{p_location_id:location,p_date:null});if(!live)return;setLoading(false);if(r.error)setError(r.error.message);else{setItems((r.data.items??[]).filter((i:{restocked_at?:string})=>!i.restocked_at));setError('')}}void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},15000);return()=>{live=false;clearInterval(timer)}},[location,open])
 return <><DesignSection as="aside" data-design-block="section.4a09fb7e2fe2b8783b24" className="home-compact-stock" aria-label="86 board"><div><h2><PageWord id="sectioncopy.a4e72afb5883f657dd79">{"86 board "}</PageWord><small>{items.length}</small></h2><button type="button" onClick={()=>setOpen(true)}><PageWord id="sectioncopy.f33e34b4050098c77351">{"Open board →"}</PageWord></button></div>{error&&<p role="alert">{error}</p>}{loading&&<p role="status"><PageWord id="sectioncopy.5749727a6461dcf362a5">{"Loading 86 items…"}</PageWord></p>}{!loading&&!error&&<ul>{items.length?items.map(i=><li key={i.id}>{i.name}</li>):<li><PageWord id="sectioncopy.ce769de263944791e658">{"Everything available"}</PageWord></li>}</ul>}</DesignSection>{open&&<CalendarDialog title="86 board" onClose={()=>setOpen(false)}><StockBoard location={location}/></CalendarDialog>}</>
}
