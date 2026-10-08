import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ScreenText } from './ScreenText'
import { submissionLabel } from '../lib/submissionTime'

type Reports = {
  stock: { name: string; added_by_name: string; added_at: string }[]
  disposals: { id: string; employee: string; submitted_at: string; lines: {brand:string;size:string;quantity:number}[] }[]
}
export function ManagerRecap({location,day,refresh,title,lines}:{location:string;day:string;refresh:number;title:string;lines:string[]}) {
  const [reports,setReports]=useState<Reports|null>(null)
  const [error,setError]=useState(''),[notice,setNotice]=useState('')
  useEffect(()=>{let live=true;setReports(null);setError('');setNotice('');void supabase.rpc('manager_recap_reports',{p_location_id:location,p_day:day}).then(r=>{
    if(!live)return
    if(r.error)setError(r.error.message);else setReports(r.data)
  });return()=>{live=false}},[location,day,refresh])
  const stock=reports?.stock.map(i=>`${i.name} — ${i.added_by_name}, ${submissionLabel(i.added_at)}`)??[]
  const disposals=reports?.disposals.flatMap(s=>s.lines.map(l=>`${l.brand} · ${l.size} · ${l.quantity} bottle${l.quantity===1?'':'s'} — ${s.employee}, ${submissionLabel(s.submitted_at)}`))??[]
  const total=reports?.disposals.reduce((n,s)=>n+s.lines.reduce((v,l)=>v+Number(l.quantity),0),0)??0
  async function copy(){try{await navigator.clipboard.writeText([title,...lines.map(l=>'• '+l),'• 86 items:',...(stock.length?stock:['No outstanding 86 items.']).map(l=>'  • '+l),`• Disposal report: ${total} bottles`,...(disposals.length?disposals:['No disposal sheets submitted.']).map(l=>'  • '+l)].join('\n'));setNotice('Recap copied.')}catch{setNotice('Copy was unavailable. Select and copy the recap text.')}}
  return <section className="card"><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><h2>{title}</h2><button type="button" disabled={!reports||!!error} onClick={()=>void copy()}><ScreenText id="CloseoutSummary.2f68c5951f51442a">Copy Recap</ScreenText></button></div>
    <ul style={{lineHeight:1.7}}>{lines.map((l,i)=><li key={i}>{l}</li>)}
      <li><strong><ScreenText id="ManagerRecap.stock">86 items</ScreenText></strong>{reports&&<ul>{stock.length?stock.map((l,i)=><li key={i}>{l}</li>):<li>No outstanding 86 items.</li>}</ul>}</li>
      <li><strong><ScreenText id="ManagerRecap.disposals">Disposal report</ScreenText></strong>{reports&&<>: {total} bottles across {reports.disposals.length} submitted sheets<ul>{disposals.length?disposals.map((l,i)=><li key={i}>{l}</li>):<li>No disposal sheets submitted.</li>}</ul></>}</li>
    </ul>{!reports&&!error&&<p role="status">Loading 86 items and disposals…</p>}{error&&<p role="alert">86 and disposal reports could not load: {error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>
}
