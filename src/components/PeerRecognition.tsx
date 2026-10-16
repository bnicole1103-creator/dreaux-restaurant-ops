import { TeamProfileName } from './TeamProfileName'
import {PageWord} from './PageDesign'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
type Vote={recipient_id:string;voter_id:string|null;id:string;day:string;recipient:string;voter:string|null;reason:string}
export function PeerRecognition({location,from,to}:{location:string;from:string;to:string}) {
 const [rows,setRows]=useState<Vote[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 useEffect(()=>{let live=true;if(!location||!from||!to)return;setLoading(true);setRows([]);setError('');void(async()=>{try{const r=await supabase.rpc('closeout_peer_recognition',{p_location_id:location,p_from:from,p_to:to});if(r.error)throw r.error;if(live)setRows(r.data??[])}catch(e){if(live)setError((e as Error).message)}finally{if(live)setLoading(false)}})();return()=>{live=false}},[location,from,to])
 return <section data-design-block="section.23b61d0650f4025b3c6b" className="card"><h2><PageWord id="sectioncopy.d7fca1c2e1eed8642f56">{"Peer recognition"}</PageWord></h2>{loading?<p role="status"><PageWord id="sectioncopy.d29190e993538cece668">{"Loading votes…"}</PageWord></p>:error?<p role="alert"><PageWord id="sectioncopy.6fb385e78955ef55ce16">{"Could not load votes: "}</PageWord>{error}</p>:rows.length?<ul>{rows.map(v=><li key={v.id}><strong><TeamProfileName locationId={location} userId={v.recipient_id} name={v.recipient}/></strong>{v.voter&&<> · from <TeamProfileName locationId={location} userId={v.voter_id} name={v.voter}/></>}<PageWord id="sectioncopy.67ed5107cae9567fd8c3">{" · "}</PageWord>{v.day}{v.reason&&<p>{v.reason}</p>}</li>)}</ul>:<p><PageWord id="sectioncopy.46cfe16a32f7c79da3d6">{"No recognition votes in this period."}</PageWord></p>}</section>
}
