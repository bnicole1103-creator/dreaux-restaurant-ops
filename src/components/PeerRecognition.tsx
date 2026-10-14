import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
type Vote={id:string;day:string;recipient:string;voter:string|null;reason:string}
export function PeerRecognition({location,from,to}:{location:string;from:string;to:string}) {
 const [rows,setRows]=useState<Vote[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 useEffect(()=>{let live=true;if(!location||!from||!to)return;setLoading(true);setRows([]);setError('');void(async()=>{try{const r=await supabase.rpc('closeout_peer_recognition',{p_location_id:location,p_from:from,p_to:to});if(r.error)throw r.error;if(live)setRows(r.data??[])}catch(e){if(live)setError((e as Error).message)}finally{if(live)setLoading(false)}})();return()=>{live=false}},[location,from,to])
 return <section className="card"><h2>Peer recognition</h2>{loading?<p role="status">Loading votes…</p>:error?<p role="alert">Could not load votes: {error}</p>:rows.length?<ul>{rows.map(v=><li key={v.id}><strong>{v.recipient}</strong>{v.voter?` · from ${v.voter}`:''} · {v.day}{v.reason&&<p>{v.reason}</p>}</li>)}</ul>:<p>No recognition votes in this period.</p>}</section>
}
