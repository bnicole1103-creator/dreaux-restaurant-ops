import { useEffect,useState } from 'react'
import { Link } from 'react-router-dom'
import { loadSalesTargets } from '../lib/loadSalesTargets'
import { calculateTargets,salesMoney,targetsChunk } from '../lib/salesTargets'
export function SalesTargetPreview({location,date,disabled,onAdd}:{location:string;date:string;disabled:boolean;onAdd:(text:string)=>void}){
 const [data,setData]=useState<Awaited<ReturnType<typeof loadSalesTargets>>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0)
 useEffect(()=>{let live=true;setData(null);setError('');setLoading(true);void loadSalesTargets(location,date).then(d=>{if(live)setData(d)}).catch(e=>{if(live)setError(String(e.message??e))}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[location,date,refresh])
 const t=data?calculateTargets(date,data.inputs,data.shifts):null
 return <section className="feed-card"><h3>Automatic sales targets</h3><p>From six matching weekdays and the published 7shifts schedule for {date}.</p><Link to="/settings/sales-targets">Sales target setup →</Link> <button type="button" disabled={loading||disabled} onClick={()=>setRefresh(v=>v+1)}>Refresh targets</button>{loading&&<p role="status">Loading sales targets…</p>}{error&&<p role="alert">{error}</p>}{t&&<><p>Team goal: <strong>{salesMoney(t.total)}</strong> · Bar {salesMoney(t.bar)} · Floor {salesMoney(t.floor)}</p>{t.issues.map(issue=><p key={issue} role="alert">{issue}</p>)}<button type="button" disabled={disabled||!t.ready} onClick={()=>{try{onAdd(targetsChunk(date,data!.inputs,data!.shifts))}catch(e){setError(String((e as Error).message))}}}>Add calculated sales targets</button><p><small>Inserted targets are an editable snapshot for this post. Refresh and add again if the schedule changes before publishing.</small></p></>}</section>
}
