import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {StockBoard} from './StockBoard'
import {CalendarDialog} from './CalendarDialog'
export function CompactStockBoard({location}:{location:string}){
 const [items,setItems]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[open,setOpen]=useState(false),[loading,setLoading]=useState(true)
 useEffect(()=>{let live=true;async function load(){const r=await supabase.rpc('stock_board_load',{p_location_id:location,p_date:null});if(!live)return;setLoading(false);if(r.error)setError(r.error.message);else{setItems((r.data.items??[]).filter((i:{restocked_at?:string})=>!i.restocked_at));setError('')}}void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},15000);return()=>{live=false;clearInterval(timer)}},[location,open])
 return <><aside className="home-compact-stock" aria-label="86 board"><div><h2>86 board <small>{items.length}</small></h2><button type="button" onClick={()=>setOpen(true)}>Open board →</button></div>{error&&<p role="alert">{error}</p>}{loading&&<p role="status">Loading 86 items…</p>}{!loading&&!error&&<ul>{items.length?items.map(i=><li key={i.id}>{i.name}</li>):<li>Everything available</li>}</ul>}</aside>{open&&<CalendarDialog title="86 board" onClose={()=>setOpen(false)}><StockBoard location={location}/></CalendarDialog>}</>
}
